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
    private const string EvApagadoArmado = "SHUTDOWN_ARMED";
    private const string EvApagadoCancelado = "SHUTDOWN_CANCELLED";

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

    // Relanzamiento del compañero en la sesión del usuario.
    private int _chequeosSinCompanero;
    private DateTime _ultimoLanzamientoCompanero = DateTime.MinValue;

    // Detección por eventos: Win32_DeviceChangeEvent despierta al
    // bucle de detección en el acto (conectar/extraer hardware);
    // sin vigilante disponible, el bucle sondea cada 1,5 s.
    private readonly SemaphoreSlim _senalDispositivos = new(0, 1);
    private ManagementEventWatcher? _vigiaDispositivos;

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
            // Línea base también para el apagado: lo que ya estaba
            // enchufado al arrancar el servicio NO lo arma (si no,
            // un equipo con un dispositivo desconocido enchufado
            // entraría en un bucle de apagados al encender).
            lock (_lockApagado)
                foreach (var clave in iniciales.Keys)
                    _clavesDelArranque.Add(clave);

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
            IniciarVigiaDispositivos();
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
            // Una cuenta atrás de apagado no sobrevive a la parada
            // del servicio (p. ej. al desinstalar): sin esto, el
            // temporizador de Windows seguiría corriendo sin agente.
            CancelarApagado("el servicio se está deteniendo");
            try
            {
                _vigiaDispositivos?.Stop();
                _vigiaDispositivos?.Dispose();
            }
            catch { /* cierre best-effort */ }
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

    /// <summary>
    /// Vigilante WMI de cambios de hardware: cada evento despierta
    /// al bucle de detección al instante en vez de esperar al
    /// sondeo. Los eventos se funden en una sola señal (la
    /// enumeración ya distingue qué llegó y qué se fue). Si WMI no
    /// deja suscribirse, el bucle se queda con su sondeo de 1,5 s.
    /// </summary>
    private void IniciarVigiaDispositivos()
    {
        try
        {
            _vigiaDispositivos = new ManagementEventWatcher(
                new WqlEventQuery("SELECT * FROM Win32_DeviceChangeEvent"));
            _vigiaDispositivos.EventArrived += (_, _) =>
            {
                try
                {
                    if (_senalDispositivos.CurrentCount == 0)
                        _senalDispositivos.Release();
                }
                catch { /* el servicio se está deteniendo */ }
            };
            _vigiaDispositivos.Start();
            Log.Info("Vigilante de eventos de dispositivos activo: detección inmediata.");
        }
        catch (Exception exc)
        {
            Log.Advertencia(
                $"Sin vigilante de eventos ({exc.Message}): la detección queda por sondeo.");
            _vigiaDispositivos = null;
        }
    }

    /// <summary>
    /// Veredicto de la lista blanca SOLO desde la caché local, sin
    /// tocar la red: sirve para bloquear y enseñar la ventana sin
    /// esperar al panel. null = aún no se sabe (el vigía lo
    /// completa en ≤5 s consultando al panel).
    /// </summary>
    private bool? EnWhitelistCacheada(string serial)
    {
        if (string.IsNullOrEmpty(serial)) return false;
        lock (_lockConocidos)
        {
            if (_cacheWhitelist.TryGetValue(serial, out var cache) &&
                DateTime.UtcNow - cache.Marca < TimeSpan.FromSeconds(60))
                return cache.Valor;
        }
        return null;
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
    private List<object> PendientesLocalesActuales()
    {
        return _motor.Bloqueados().Select(reg => (object)new
        {
            clave = reg.Dispositivo.Clave,
            serial = reg.Dispositivo.Serial,
            nombre = reg.Dispositivo.NombreVisible,
            letra = reg.Dispositivo.Letra,
            tipo = reg.Dispositivo.Tipo,
            en_whitelist = reg.EnWhitelist,
        }).ToList();
    }

    private void RefrescarPendientesLocales()
    {
        EscribirPendientesLocales(PendientesLocalesActuales());
    }

    /// <summary>
    /// Anota el bloqueo en pending_local.json ANTES de ejecutar
    /// las capas: la ventana del compañero tiene que salir en
    /// cuanto el dispositivo se detecta, no cuando la cadena de
    /// bloqueo termine (en memorias y discos puede tardar
    /// segundos y el teléfono, que cede al instante, salía
    /// siempre primero). Al volver de Bloquear, el refresco
    /// normal sustituye lo provisional por el estado real del
    /// motor — y lo retira si ninguna capa logró bloquear.
    /// </summary>
    private void EscribirPendienteProvisional(Dispositivo disp, bool? enWl)
    {
        if (_motor.Registro(disp.Clave)?.Estado == EstadoBloqueo.Bloqueado) return;
        var pendientes = PendientesLocalesActuales();
        pendientes.Add(new
        {
            clave = disp.Clave,
            serial = disp.Serial,
            nombre = disp.NombreVisible,
            letra = disp.Letra,
            tipo = disp.Tipo,
            en_whitelist = enWl,
        });
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
        if (disp.Tipo == TipoDispositivo.Impresora)
        {
            // Las impresoras solo se detectan: evento de conexión
            // y presencia en la lista de conectados (vía el latido),
            // sin bloqueo, sin contraseña y sin registro de bloqueo.
            _cliente.Evento(EvConectado, disp.Letra, disp.Serial);
            Log.Info($"Impresora USB detectada (sin bloqueo): {disp.Nombre}");
            return;
        }
        if (disp.Tipo == TipoDispositivo.Red && _baseRed.Contains(disp.Clave))
        {
            Log.Info($"Red USB de línea base, sin bloquear: {disp.Nombre}");
            return;
        }
        _cliente.Evento(EvConectado, disp.Letra, disp.Serial);
        // El veredicto sale de la CACHÉ, sin esperar a la red: la
        // ventana de credenciales tiene que aparecer en cuanto el
        // dispositivo queda bloqueado, no cuando el panel responda
        // (con un panel lento, la consulta y el registro tardaban
        // segundos y la ventana salía tarde). Si el veredicto no
        // está en caché se bloquea con null: el vigía lo consulta,
        // lo anota y registra el bloqueo en el panel en ≤5 s; el
        // compañero muestra el formulario mientras tanto y la
        // autorización la sigue decidiendo el servidor.
        var enWl = EnWhitelistCacheada(disp.Serial);
        EscribirPendienteProvisional(disp, enWl);
        var reg = _motor.Bloquear(disp, enWl);
        if (reg.Estado == EstadoBloqueo.Bloqueado)
        {
            _cliente.Evento(
                EvBloqueado, disp.Letra, disp.Serial,
                reg.Capa + (reg.Degradado ? " (degradado)" : ""), enWl);
            // pending_local.json ANTES que cualquier llamada al
            // panel: es el archivo que hace aparecer la ventana.
            RefrescarPendientesLocales();
            if (enWl is not null)
                await RegistrarEnPanelAsync(disp, enWl.Value).ConfigureAwait(false);
            if (_compartida.LockSessionOnInsert)
            {
                try { LockWorkStation(); } catch { /* bloquear sesión es best-effort */ }
            }
        }
        // Veredicto confirmado de fuera de la lista: si el ajuste
        // está activo, se arma el apagado (idempotente por equipo
        // y dispositivo; ArmarApagado filtra tipos y línea base).
        if (enWl == false) ArmarApagado(disp);
        RefrescarPendientesLocales();
    }

    private async Task RegistrarEnPanelAsync(Dispositivo disp, bool enWl)
    {
        if (_pendientesRegistrados.Contains(disp.Clave)) return;
        var pid = await _cliente.RegistrarBloqueoAsync(
            disp.Letra, disp.Serial, disp.NombreVisible, enWl).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(pid)) _pendientesRegistrados.Add(disp.Clave);
    }

    private async Task AlExtraerAsync(string clave, Dispositivo disp)
    {
        if (disp.Tipo == TipoDispositivo.Impresora)
        {
            // Nunca se bloqueó ni se registró: solo el evento.
            _cliente.Evento(EvDesconectado, disp.Letra, disp.Serial);
            return;
        }
        _motor.AlExtraer(clave);
        DesarmarApagado(clave, disp, "el dispositivo se extrajo");
        await _cliente.CerrarBloqueoAsync(disp.Letra, disp.Serial).ConfigureAwait(false);
        _cliente.Evento(EvDesconectado, disp.Letra, disp.Serial);
        _pendientesRegistrados.Remove(clave);
        RefrescarPendientesLocales();
    }

    // ── apagado ante dispositivos fuera de la lista blanca ────────
    // Ajuste del panel «shutdownOnNonWhitelisted» (apagado por
    // defecto). Se arma SOLO con veredicto confirmado de «fuera de
    // la lista» (false; jamás con «sin veredicto») y SOLO ante
    // inserciones: lo presente al arrancar el servicio es línea
    // base, como la red USB, para que un equipo no entre en un
    // bucle de apagados con el dispositivo aún enchufado.
    //
    // Sin condiciones de carrera, por construcción:
    //  - Todo el estado (causantes, cuenta en curso, línea base)
    //    vive bajo _lockApagado y SOLO se toca dentro de él.
    //  - Armar es idempotente por dispositivo (un HashSet) y hay
    //    una única cuenta atrás por equipo: la lanza el único hilo
    //    que voltea _apagadoEnCurso.
    //  - La llamada a shutdown.exe se hace DENTRO del lock, a
    //    propósito: armar (/s) y cancelar (/a) quedan serializados
    //    y un «/a» jamás puede adelantarse a su «/s», que dejaría
    //    una cuenta huérfana sin causante que la detenga. La
    //    utilidad responde en milisegundos; la cuenta atrás en sí
    //    es del sistema operativo, sin temporizadores del agente.
    //  - La cuenta se cancela cuando el ÚLTIMO causante desaparece
    //    (extracción o desbloqueo, incluido el de emergencia), si
    //    el ajuste se desactiva en el panel o si el servicio se
    //    detiene. Windows además permite abortarla a mano con
    //    «shutdown /a» durante la cuenta.
    // La cuenta atrás la define el panel (shutdownCountdownSeconds,
    // 60 por defecto, acotada a 10–600 en ConfigCompartida).
    private readonly object _lockApagado = new();
    private readonly HashSet<string> _apagadoCausantes = new();
    private readonly HashSet<string> _clavesDelArranque = new();
    private bool _apagadoEnCurso;

    private void ArmarApagado(Dispositivo disp)
    {
        // Solo dispositivos gobernados por la lista blanca: las
        // impresoras nunca se bloquean ni se juzgan, y la red USB
        // tiene su propia regla de línea base.
        if (disp.Tipo is not (TipoDispositivo.Disco or TipoDispositivo.Telefono or TipoDispositivo.Optico))
            return;
        if (!_compartida.ShutdownOnNonWhitelisted) return;
        var segundos = _compartida.ShutdownCountdownSeconds;
        var armado = false;
        lock (_lockApagado)
        {
            if (_clavesDelArranque.Contains(disp.Clave)) return;
            _apagadoCausantes.Add(disp.Clave);
            if (_apagadoEnCurso) return;
            var mensaje =
                $"USBMonitor: dispositivo no autorizado ({disp.Nombre}). " +
                $"El equipo se apagara en {segundos} segundos.";
            if (EjecutarShutdownExe("/s", "/t",
                    segundos.ToString(), "/c", mensaje))
            {
                _apagadoEnCurso = true;
                armado = true;
            }
        }
        if (armado)
        {
            _cliente.Evento(EvApagadoArmado, disp.Letra, disp.Serial);
            Log.Advertencia(
                $"Apagado ARMADO ({segundos} s) por dispositivo " +
                $"fuera de la lista blanca: {disp.Nombre} ({disp.Serial})");
        }
        else
        {
            Log.Error($"No se pudo armar el apagado por {disp.Nombre}");
        }
    }

    /// <summary>El causante desapareció (extracción/desbloqueo): si era el último, se aborta la cuenta.</summary>
    private void DesarmarApagado(string clave, Dispositivo? disp, string motivo)
    {
        var cancelado = false;
        lock (_lockApagado)
        {
            if (!_apagadoCausantes.Remove(clave)) return;
            if (_apagadoCausantes.Count > 0 || !_apagadoEnCurso) return;
            EjecutarShutdownExe("/a");
            _apagadoEnCurso = false;
            cancelado = true;
        }
        if (cancelado)
        {
            if (disp is not null)
                _cliente.Evento(EvApagadoCancelado, disp.Letra, disp.Serial);
            Log.Info($"Apagado cancelado: {motivo}");
        }
    }

    /// <summary>Cancela cualquier cuenta en curso y olvida los causantes (ajuste off, parada del servicio).</summary>
    private void CancelarApagado(string motivo)
    {
        var cancelado = false;
        lock (_lockApagado)
        {
            _apagadoCausantes.Clear();
            if (!_apagadoEnCurso) return;
            EjecutarShutdownExe("/a");
            _apagadoEnCurso = false;
            cancelado = true;
        }
        if (cancelado) Log.Info($"Apagado cancelado: {motivo}");
    }

    private static bool EjecutarShutdownExe(params string[] argumentos)
    {
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = "shutdown.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argumento in argumentos) info.ArgumentList.Add(argumento);
            using var proceso = Process.Start(info);
            if (proceso is null) return false;
            if (!proceso.WaitForExit(5000))
            {
                try { proceso.Kill(); } catch { /* ya terminó */ }
                return false;
            }
            return proceso.ExitCode == 0;
        }
        catch (Exception exc)
        {
            Log.Advertencia($"shutdown.exe ({string.Join(" ", argumentos)}): {exc.Message}");
            return false;
        }
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
            if (_vigiaDispositivos is not null)
            {
                // Despierta al instante con un evento de hardware;
                // el tope de 5 s reconcilia por si algún evento se
                // pierde (un sondeo lento de respaldo, no el camino
                // normal).
                try
                {
                    await _senalDispositivos
                        .WaitAsync(TimeSpan.FromSeconds(5), ct)
                        .ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
            else if (!await EsperarAsync(1500, ct).ConfigureAwait(false)) return;
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
                // Registro en el panel de los bloqueos que aún no
                // constan allí: los creados sin red (falta el veredicto
                // de la lista blanca) y los cuyo registro falló a
                // mitad (p. ej. un timeout del panel), que antes
                // quedaban sin reintento y no se podían desbloquear.
                foreach (var reg in _motor.Bloqueados())
                {
                    if (reg.EnWhitelist is null)
                    {
                        var enWl = await EnWhitelistAsync(reg.Dispositivo.Serial)
                            .ConfigureAwait(false);
                        if (enWl is null) continue;
                        reg.EnWhitelist = enWl;
                        if (enWl == false) ArmarApagado(reg.Dispositivo);
                        RefrescarPendientesLocales();
                    }
                    // No-op si ya está registrado.
                    await RegistrarEnPanelAsync(reg.Dispositivo, reg.EnWhitelist.Value)
                        .ConfigureAwait(false);
                }
                VigilarCompanero();
            }
            catch (Exception exc)
            {
                Log.Error($"Vigía: {exc.Message}");
            }
            if (!await EsperarAsync(5000, ct).ConfigureAwait(false)) return;
        }
    }

    /// <summary>
    /// El compañero tiene que estar SIEMPRE vivo en la sesión del
    /// usuario: si no está (la tarea de inicio de sesión no lo
    /// lanzó en esta sesión, se cerró la ventana o murió), el
    /// servicio lo relanza él mismo en la sesión de consola activa.
    /// Dos chequeos seguidos sin compañero (~10 s) y un intento
    /// cada 30 s como máximo; si WMI no sabe, no se actúa a ciegas.
    /// </summary>
    private void VigilarCompanero()
    {
        var enMarcha = CompaneroEnMarcha();
        if (enMarcha is null) return;
        if (enMarcha.Value)
        {
            _chequeosSinCompanero = 0;
            return;
        }
        _chequeosSinCompanero++;
        if (_chequeosSinCompanero < 2) return;
        if (DateTime.UtcNow - _ultimoLanzamientoCompanero < TimeSpan.FromSeconds(30)) return;
        _ultimoLanzamientoCompanero = DateTime.UtcNow;
        LanzadorCompanero.IntentarLanzar();
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
        // Escalera corta: hay una persona esperando frente a la
        // ventana; la de 10/30/60 s dejaba el «Autorizado» pintado
        // un buen rato con el dispositivo ya en vías de liberarse.
        if (_motor.LiberarConReintentos(objetivo.Clave, new[] { 1, 2, 5 }))
        {
            _cliente.Evento(EvDesbloqueado, objetivo.Letra, objetivo.Serial);
            DesarmarApagado(objetivo.Clave, objetivo, "el dispositivo se desbloqueó");
        }
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
                // Si el ajuste se apagó en el panel (por la config
                // periódica o por el empuje en caliente), una cuenta
                // atrás en curso se cancela: no-op si no hay ninguna.
                if (!_compartida.ShutdownOnNonWhitelisted)
                    CancelarApagado("el ajuste se desactivó en el panel");
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
                reg.Dispositivo.Letra, reg.Dispositivo.NombreVisible))
            .ToList();
    }

    private bool ProcesarEmergenciaLocal(string serial)
    {
        foreach (var reg in _motor.Bloqueados())
        {
            if (reg.Dispositivo.Serial != serial) continue;
            if (!_motor.LiberarConReintentos(reg.Dispositivo.Clave, new[] { 1, 2, 5 })) return false;
            _cliente.Evento(EvEmergencia, reg.Dispositivo.Letra, reg.Dispositivo.Serial);
            DesarmarApagado(reg.Dispositivo.Clave, reg.Dispositivo, "desbloqueo de emergencia local");
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
