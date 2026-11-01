// -*- coding: utf-8 -*-
// El agente como BackgroundService. Espejo de la clase Agente de
// servicio.py.
//
// Arranque por fases, para que no haya carreras al inicio:
//   0. configuración remota + espera de red (ajuste del panel),
//   1. reconciliación del diario (lo que un cierre sucio dejó),
//   2. barrido inicial (lo conectado se bloquea; la red USB presente
//      queda como línea base y NO se bloquea),
//   3. recién entonces arrancan los bucles (detección 1,5 s, vigía
//      5 s, sondeo de desbloqueos 3 s, latido 30 s), el servidor
//      local :5001 y el latido de depuración del Core.
//
// Parada ordenada: evento SERVICE_STOP, cola vaciada, TODO
// restaurado y pending_local.json vacío: el agente no deja huella.
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Servicio principal del agente USBMonitor (equivalente a la clase Agente de Python).</summary>
public sealed class AgenteWorker : BackgroundService
{
    private static readonly Registrador Log = Registro.Obtener("servicio");

    // Tipos de evento del panel (mismos textos que el agente Python).
    private const string EvConectado = "CONNECTED";
    private const string EvDesconectado = "DISCONNECTED";
    private const string EvBloqueado = "BLOCKED";
    private const string EvDesbloqueado = "UNLOCKED";
    private const string EvReaplicado = "BLOCK_REAPPLIED";
    private const string EvFalloLiberacion = "UNLOCK_RELEASE_FAILED";
    private const string EvEmergencia = "EMERGENCY_UNLOCK";
    private const string EvArranque = "SERVICE_START";
    private const string EvParada = "SERVICE_STOP";

    private readonly Configuracion _configuracion = new();
    private readonly ClientePanel _cliente;
    private readonly Diario _diario = new();
    private readonly Emergencia _emergencia = new();
    private readonly Detector _detector = new();
    private readonly CandadosVolumen _candados = new();
    private readonly MotorBloqueo _motor;
    private readonly ConfigCompartida _compartida = new();
    private ServidorLocal? _servidorLocal;

    private readonly object _lockConocidos = new();
    private Dictionary<string, Dispositivo> _conocidos = new();
    private HashSet<string> _baseRed = new();
    private readonly HashSet<string> _pendientesRegistrados = new();
    private readonly HashSet<string> _desbloqueosEjecutados = new();
    private readonly Dictionary<string, (bool Valor, DateTime Marca)> _cacheWhitelist = new();

    private readonly object _lockCompanero = new();
    private bool? _companeroCacheValor;
    private DateTime _companeroCacheMarca = DateTime.MinValue;

    private DateTime _inicio = DateTime.UtcNow;
    private DateTime _ultimoHash = DateTime.MinValue;
    private DateTime _ultimaConfig = DateTime.MinValue;

    // Transiciones del compañero para el latido de depuración.
    private bool? _companeroLatido;
    private DateTime _companeroDesde = DateTime.UtcNow;

    private static string ArchivoPendientes =>
        Path.Combine(Registro.DirectorioDatos, "pending_local.json");

    public AgenteWorker()
    {
        _cliente = new ClientePanel(_configuracion);
        _motor = new MotorBloqueo(_diario, _candados, PonerSoloLectura, QuitarSoloLectura);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    // ── ciclo de vida ─────────────────────────────────────────────
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        Log.Info("Parada del servicio pedida por el SCM");
        await base.StopAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await NucleoAsync(stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Parada normal pedida por el SCM o por Ctrl+C en depuración.
        }
        catch (Exception exc)
        {
            Log.Excepcion("EL AGENTE SE DETUVO POR UN ERROR NO CONTROLADO", exc);
            throw;
        }
    }

    private async Task NucleoAsync(CancellationToken ct)
    {
        try
        {
            _inicio = DateTime.UtcNow;
            Log.Info($"Agente v2 arrancando en {Configuracion.NombrePc}");

            // Configuración remota inicial y espera de red.
            var remota = await _cliente.ConfigRemotaAsync().ConfigureAwait(false);
            if (remota is not null) _compartida.AplicarRemota(remota);
            var espera = _compartida.StartupNetworkDelay;
            if (espera > 0)
            {
                Log.Info($"Esperando red {espera} s (ajuste del panel)");
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(espera, 120)), ct)
                    .ConfigureAwait(false);
            }

            // Fase 1: reconciliación del diario.
            var iniciales = _detector.Enumerar();
            lock (_lockConocidos) _conocidos = iniciales;
            var presentes = iniciales.Values
                .Select(d => d.InstanciaPnP.Trim().ToUpperInvariant())
                .ToHashSet();
            foreach (var instancia in _diario.DispositivosDeshabilitados.Keys.ToList())
            {
                if (presentes.Contains(instancia.Trim().ToUpperInvariant())) continue;
                // Quedó deshabilitado y ya no está: se reactiva su
                // nodo fantasma para que la próxima vez entre normal.
                if (Pnp.Habilitar(instancia))
                    _diario.QuitarDeshabilitado(instancia);
            }
            _baseRed = iniciales.Values
                .Where(d => d.Tipo == TipoDispositivo.Red)
                .Select(d => d.Clave)
                .ToHashSet();

            // Fase 2: barrido inicial (bloquea lo presente salvo la base).
            foreach (var disp in iniciales.Values)
            {
                if (disp.Tipo == TipoDispositivo.Red) continue;
                await AlLlegarAsync(disp).ConfigureAwait(false);
            }
            _cliente.Evento(EvArranque);
            await _cliente.VaciarColaAsync().ConfigureAwait(false);

            // Fase 3: servidor local, latido de depuración y bucles.
            _servidorLocal = new ServidorLocal(
                _configuracion, ListaBloqueadosLocal, ProcesarEmergenciaLocal,
                _emergencia, _compartida);
            _servidorLocal.Iniciar();
            _ = Registro.IniciarLatido(LineaLatido, ct);
            Log.Info("Agente v2 en marcha");

            await Task.WhenAll(
                BucleDeteccionAsync(ct),
                BucleVigiaAsync(ct),
                BucleSondeoAsync(ct),
                BucleLatidoAsync(ct)).ConfigureAwait(false);
        }
        finally
        {
            Detener();
        }
    }

    private void Detener()
    {
        try
        {
            Log.Info("Deteniendo el agente: restaurando todo");
            try { _servidorLocal?.Detener(); } catch { /* cierre best-effort */ }
            _cliente.Evento(EvParada);
            try
            {
                _cliente.VaciarColaAsync().Wait(TimeSpan.FromSeconds(5));
            }
            catch { /* sin red en la parada: la cola queda en disco */ }
            try { _motor.RestaurarTodo(); }
            catch (Exception exc) { Log.Excepcion("Restaurando en la parada", exc); }
            EscribirPendientesLocales(new List<object>());
            Log.Info("Agente detenido sin dejar huella");
        }
        catch (Exception exc)
        {
            Log.Excepcion("Error en la parada ordenada", exc);
        }
    }

    // ── whitelist con caché de 60 s (como servicio.py) ────────────
    private async Task<bool?> EnWhitelistAsync(string serial)
    {
        if (string.IsNullOrEmpty(serial)) return false;
        lock (_lockConocidos)
        {
            if (_cacheWhitelist.TryGetValue(serial, out var cache) &&
                DateTime.UtcNow - cache.Marca < TimeSpan.FromSeconds(60))
                return cache.Valor;
        }
        var resultado = await _cliente.ComprobarWhitelistAsync(serial).ConfigureAwait(false);
        if (resultado is not null)
        {
            lock (_lockConocidos)
                _cacheWhitelist[serial] = (resultado.Value, DateTime.UtcNow);
        }
        return resultado;
    }

    // ── handoff al compañero: pending_local.json atómico ─────────
    private void RefrescarPendientesLocales()
    {
        var pendientes = _motor.Bloqueados().Select(reg => (object)new
        {
            clave = reg.Dispositivo.Clave,
            serial = reg.Dispositivo.Serial,
            nombre = reg.Dispositivo.Nombre,
            letra = reg.Dispositivo.Letra,
            tipo = reg.Dispositivo.Tipo,
            en_whitelist = reg.EnWhitelist,
        }).ToList();
        EscribirPendientesLocales(pendientes);
    }

    private static void EscribirPendientesLocales(List<object> pendientes)
    {
        try
        {
            Directory.CreateDirectory(Registro.DirectorioDatos);
            var temporal = ArchivoPendientes + ".tmp";
            File.WriteAllText(temporal, JsonSerializer.Serialize(pendientes));
            File.Move(temporal, ArchivoPendientes, overwrite: true);
        }
        catch (Exception exc)
        {
            Log.Error($"pending_local.json no se pudo escribir: {exc.Message}");
        }
    }

    // ── compañero en marcha (WMI, caché 5 s) ──────────────────────
    private bool? CompaneroEnMarcha()
    {
        lock (_lockCompanero)
        {
            if (DateTime.UtcNow - _companeroCacheMarca < TimeSpan.FromSeconds(5))
                return _companeroCacheValor;
        }
        bool? resultado;
        try
        {
            var encontrado = false;
            using var buscador = new ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process");
            foreach (ManagementObject proceso in buscador.Get())
            {
                var comando = (proceso["CommandLine"]?.ToString() ?? "").ToLowerInvariant();
                if (comando.Length == 0) continue;
                var esCompaneroPy = comando.Contains("companero.py");
                var esModoPrompt = comando.Contains(" prompt") &&
                    (comando.Contains("usbmonitor") || comando.Contains("servicio.py"));
                if (esCompaneroPy || esModoPrompt) { encontrado = true; break; }
            }
            resultado = encontrado;
        }
        catch (Exception exc)
        {
            Log.Debug($"Consulta WMI del compañero falló: {exc.Message}");
            resultado = null;
        }
        lock (_lockCompanero)
        {
            _companeroCacheValor = resultado;
            _companeroCacheMarca = DateTime.UtcNow;
        }
        return resultado;
    }

    // ── llegada y extracción ──────────────────────────────────────
    private async Task AlLlegarAsync(Dispositivo disp)
    {
        if (disp.Tipo == TipoDispositivo.Red && _baseRed.Contains(disp.Clave))
        {
            Log.Info($"Red USB de línea base, sin bloquear: {disp.Nombre}");
            return;
        }
        _cliente.Evento(EvConectado, disp.Letra, disp.Serial);
        var enWl = await EnWhitelistAsync(disp.Serial).ConfigureAwait(false);
        var reg = _motor.Bloquear(disp, enWl);
        if (reg.Estado == EstadoBloqueo.Bloqueado)
        {
            _cliente.Evento(
                EvBloqueado, disp.Letra, disp.Serial,
                reg.Capa + (reg.Degradado ? " (degradado)" : ""), enWl);
            if (enWl is not null)
                await RegistrarEnPanelAsync(disp, enWl.Value).ConfigureAwait(false);
            if (_compartida.LockSessionOnInsert)
            {
                try { LockWorkStation(); } catch { /* bloquear sesión es best-effort */ }
            }
        }
        RefrescarPendientesLocales();
    }

    private async Task RegistrarEnPanelAsync(Dispositivo disp, bool enWl)
    {
        if (_pendientesRegistrados.Contains(disp.Clave)) return;
        var pid = await _cliente.RegistrarBloqueoAsync(
            disp.Letra, disp.Serial, disp.Nombre, enWl).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(pid)) _pendientesRegistrados.Add(disp.Clave);
    }

    private async Task AlExtraerAsync(string clave, Dispositivo disp)
    {
        _motor.AlExtraer(clave);
        await _cliente.CerrarBloqueoAsync(disp.Letra, disp.Serial).ConfigureAwait(false);
        _cliente.Evento(EvDesconectado, disp.Letra, disp.Serial);
        _pendientesRegistrados.Remove(clave);
        RefrescarPendientesLocales();
    }

    // ── bucles ────────────────────────────────────────────────────
    private async Task BucleDeteccionAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var actuales = _detector.Enumerar();
                Dictionary<string, Dispositivo> previos;
                lock (_lockConocidos) previos = new Dictionary<string, Dispositivo>(_conocidos);
                foreach (var (clave, disp) in actuales)
                {
                    if (!previos.ContainsKey(clave))
                        await AlLlegarAsync(disp).ConfigureAwait(false);
                }
                foreach (var (clave, disp) in previos)
                {
                    if (!actuales.ContainsKey(clave))
                        await AlExtraerAsync(clave, disp).ConfigureAwait(false);
                }
                lock (_lockConocidos) _conocidos = actuales;
            }
            catch (Exception exc)
            {
                Log.Error($"Bucle de detección: {exc.Message}");
            }
            if (!await EsperarAsync(1500, ct).ConfigureAwait(false)) return;
        }
    }

    private async Task BucleVigiaAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                foreach (var clave in _motor.Vigilar())
                {
                    var reg = _motor.Registro(clave);
                    if (reg is not null)
                    {
                        _cliente.Evento(EvReaplicado,
                            reg.Dispositivo.Letra, reg.Dispositivo.Serial);
                    }
                }
                // Registro en el panel de bloqueos creados sin red.
                foreach (var reg in _motor.Bloqueados())
                {
                    if (reg.EnWhitelist is not null) continue;
                    var enWl = await EnWhitelistAsync(reg.Dispositivo.Serial)
                        .ConfigureAwait(false);
                    if (enWl is not null)
                    {
                        reg.EnWhitelist = enWl;
                        await RegistrarEnPanelAsync(reg.Dispositivo, enWl.Value)
                            .ConfigureAwait(false);
                        RefrescarPendientesLocales();
                    }
                }
            }
            catch (Exception exc)
            {
                Log.Error($"Vigía: {exc.Message}");
            }
            if (!await EsperarAsync(5000, ct).ConfigureAwait(false)) return;
        }
    }

    private async Task BucleSondeoAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var pendientes = await _cliente.SondearDesbloqueosAsync()
                    .ConfigureAwait(false);
                foreach (var pendiente in pendientes)
                {
                    var idTexto = $"{pendiente.Id}";
                    lock (_desbloqueosEjecutados)
                    {
                        if (_desbloqueosEjecutados.Contains(idTexto)) continue;
                        _desbloqueosEjecutados.Add(idTexto);
                    }
                    EjecutarDesbloqueo(pendiente);
                }
            }
            catch (Exception exc)
            {
                Log.Error($"Sondeo de desbloqueos: {exc.Message}");
            }
            if (!await EsperarAsync(3000, ct).ConfigureAwait(false)) return;
        }
    }

    private void EjecutarDesbloqueo(PendienteDesbloqueo pendiente)
    {
        Dispositivo? objetivo = null;
        foreach (var reg in _motor.Bloqueados())
        {
            var disp = reg.Dispositivo;
            if (!string.IsNullOrEmpty(pendiente.SerialNumber) &&
                disp.Serial == pendiente.SerialNumber) { objetivo = disp; break; }
            if (!string.IsNullOrEmpty(pendiente.DriveLetter) &&
                disp.Letra == pendiente.DriveLetter) { objetivo = disp; break; }
        }
        if (objetivo is null)
        {
            Log.Advertencia(
                $"Desbloqueo sin dispositivo local: id={pendiente.Id} " +
                $"letra={pendiente.DriveLetter} serial={pendiente.SerialNumber}");
            return;
        }
        if (_motor.LiberarConReintentos(objetivo.Clave))
            _cliente.Evento(EvDesbloqueado, objetivo.Letra, objetivo.Serial);
        else
            _cliente.Evento(EvFalloLiberacion, objetivo.Letra, objetivo.Serial);
        RefrescarPendientesLocales();
    }

    private async Task BucleLatidoAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await _cliente.VaciarColaAsync().ConfigureAwait(false);
                Dictionary<string, Dispositivo> actuales;
                lock (_lockConocidos)
                    actuales = new Dictionary<string, Dispositivo>(_conocidos);
                await _cliente.EstadoConectadosAsync(
                    Detector.UnidadesParaEstado(actuales.Values)).ConfigureAwait(false);
                var intentos = _emergencia.IntentosPendientes();
                if (intentos.Count > 0 &&
                    await _cliente.SubirIntentosOfflineAsync(intentos).ConfigureAwait(false))
                {
                    _emergencia.LimpiarIntentos();
                }
                var ahora = DateTime.UtcNow;
                if (ahora - _ultimoHash >= TimeSpan.FromSeconds(600))
                {
                    _ultimoHash = ahora;
                    var datos = await _cliente.HashDuenoAsync().ConfigureAwait(false);
                    if (datos is { Username: { } usuario, PasswordHash: { } hash })
                        _emergencia.GuardarHash(usuario, hash);
                }
                if (ahora - _ultimaConfig >= TimeSpan.FromSeconds(600))
                {
                    _ultimaConfig = ahora;
                    var remota = await _cliente.ConfigRemotaAsync().ConfigureAwait(false);
                    if (remota is not null) _compartida.AplicarRemota(remota);
                }
            }
            catch (Exception exc)
            {
                Log.Error($"Latido: {exc.Message}");
            }
            if (!await EsperarAsync(30000, ct).ConfigureAwait(false)) return;
        }
    }

    private static async Task<bool> EsperarAsync(int ms, CancellationToken ct)
    {
        try
        {
            await Task.Delay(ms, ct).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    // ── servidor local: estado y emergencia ───────────────────────
    private List<ServidorLocal.BlockedInfo> ListaBloqueadosLocal()
    {
        return _motor.Bloqueados()
            .Select(reg => new ServidorLocal.BlockedInfo(
                reg.Dispositivo.Clave, reg.Dispositivo.Serial,
                reg.Dispositivo.Letra, reg.Dispositivo.Nombre))
            .ToList();
    }

    private bool ProcesarEmergenciaLocal(string serial)
    {
        foreach (var reg in _motor.Bloqueados())
        {
            if (reg.Dispositivo.Serial != serial) continue;
            if (!_motor.LiberarConReintentos(reg.Dispositivo.Clave)) return false;
            _cliente.Evento(EvEmergencia, reg.Dispositivo.Letra, reg.Dispositivo.Serial);
            RefrescarPendientesLocales();
            return true;
        }
        return false;
    }

    // ── latido de depuración (1 línea/s en latido.log) ────────────
    private string LineaLatido()
    {
        var ahora = DateTime.UtcNow;
        var enMarchaSeg = (int)(ahora - _inicio).TotalSeconds;
        var companero = CompaneroEnMarcha();
        if (companero is bool enMarcha)
        {
            if (_companeroLatido is null)
            {
                _companeroLatido = enMarcha;
                _companeroDesde = ahora;
            }
            else if (_companeroLatido.Value != enMarcha)
            {
                var duracion = (int)(ahora - _companeroDesde).TotalSeconds;
                if (enMarcha)
                    Log.Info($"El compañero está en marcha de nuevo (estuvo parado {duracion} s)");
                else
                    Log.Advertencia($"El compañero dejó de estar en marcha (estuvo en marcha {duracion} s)");
                _companeroLatido = enMarcha;
                _companeroDesde = ahora;
            }
        }
        var salud = _cliente.Salud();
        var textoCompanero = companero is null ? "desconocido" : companero.Value ? "sí" : "no";
        return $"en_marcha={enMarchaSeg}s companero={textoCompanero} " +
            $"bloqueados={_motor.Bloqueados().Count} cola_eventos={_cliente.EventosEnCola} " +
            $"salud_ok={salud.Ok} salud_fallos={salud.Fallos} " +
            $"ultimo_exito={FormatearInstante(salud.UltimoExito)} " +
            $"ultimo_fallo={FormatearInstante(salud.UltimoFallo)} " +
            $"detalle_ultimo_fallo={salud.DetalleUltimoFallo ?? "-"} " +
            $"url={salud.UrlBase} pc={Configuracion.NombrePc}";
    }

    private static string FormatearInstante(object? valor) => valor switch
    {
        null => "-",
        DateTime instante => instante.ToString("yyyy-MM-ddTHH:mm:ss"),
        _ => valor.ToString() ?? "-",
    };

    // ── capa degradada: solo lectura con diskpart ─────────────────
    private static bool PonerSoloLectura(string letra) => Diskpart(letra, activar: true);

    private static bool QuitarSoloLectura(string letra) => Diskpart(letra, activar: false);

    private static bool Diskpart(string letra, bool activar)
    {
        var volumen = letra.Trim().TrimEnd(':');
        var guion = $"select volume {volumen}\r\n" +
            (activar ? "attributes volume set readonly\r\n"
                     : "attributes volume clear readonly\r\n");
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = "diskpart.exe",
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var proceso = Process.Start(info);
            if (proceso is null) return false;
            proceso.StandardInput.Write(guion);
            proceso.StandardInput.Close();
            if (!proceso.WaitForExit(15000))
            {
                try { proceso.Kill(); } catch { /* ya terminó */ }
                return false;
            }
            return proceso.ExitCode == 0;
        }
        catch (Exception exc)
        {
            Log.Advertencia($"diskpart ({letra}, activar={activar}): {exc.Message}");
            return false;
        }
    }
}
