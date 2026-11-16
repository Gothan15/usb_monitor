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
    private const string EvApagadoRecuperado = "SHUTDOWN_RECOVERED";
    private const string EvApagadoHuerfano = "SHUTDOWN_ORPHANED";
    private const string EvEscaleraAviso = "ESCALATION_WARNING";
    private const string EvEscaleraBloqueo = "ESCALATION_LOCK";

    private readonly Configuracion _configuracion = new();
    private readonly ClientePanel _cliente;
    private readonly Diario _diario = new();
    private readonly Emergencia _emergencia = new();
    private readonly Detector _detector = new();
    private readonly CandadosVolumen _candados = new();
    private readonly MotorBloqueo _motor;
    private readonly ConfigCompartida _compartida = new();
    private readonly ActualizadorAgente _actualizador;
    private ServidorLocal? _servidorLocal;

    private readonly object _lockConocidos = new();
    private Dictionary<string, Dispositivo> _conocidos = new();

    // Extracciones con gracia anti-parpadeo: una ausencia solo es
    // extracción si dura 6 s sin reaparecer (ver ControlAusencias:
    // la enumeración parpadea justo en las transiciones PnP, que
    // es cuando el vigilante de eventos despierta a este bucle).
    private readonly ControlAusencias _ausencias = new(TimeSpan.FromSeconds(6));

    // Extracciones vetadas por la guarda anti-parpadeo cuyo
    // aviso YA salió al registro. El veto se repite en cada
    // barrido mientras el parpadeo dure (en ENDUSER-PC, el
    // 2026-11-11, la misma advertencia salió cada ~18 s durante
    // una hora y tapó todo lo demás); el veto sigue siendo
    // fail-closed igual, pero se anuncia una sola vez por
    // episodio. Se olvida cuando el dispositivo reaparece o la
    // extracción por fin se procesa.
    private readonly HashSet<string> _vetosExtraccionAvisados = new();

    // Firma (serial|letra) del último conjunto conectado que ya
    // consta en el panel: el bucle de detección avisa AL INSTANTE
    // cuando cambia, sin esperar al latido de 30 s — así «Ver USB»
    // enseña el momento exacto, como hacía el agente antiguo, que
    // sondeaba el conjunto y reportaba en cuanto cambiaba la foto.
    private string _firmaConectados = "";
    private readonly object _lockFirmaConectados = new();
    private HashSet<string> _baseRed = new();
    private readonly HashSet<string> _pendientesRegistrados = new();

    // Captura de evidencia: el id del bloqueo en el panel por clave
    // (la subida del paquete lo necesita, también tras la extracción)
    // y las instancias («clave|instancia») con la foto ya solicitada
    // en este arranque: por bloqueo concreto, no por dispositivo.
    private readonly object _lockEvidencia = new();
    private readonly Dictionary<string, string> _idsBloqueoPanel = new();
    private readonly HashSet<string> _evidenciaSolicitada = new();
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
    // MinValue a propósito: el PRIMER intento de credencial (el
    // enrolamiento con el código que dejó la instalación remota)
    // tiene que salir en la primera vuelta del latido, no a los
    // 5 minutos. Con UtcNow aquí, un agente recién empujado no
    // podía enrolarse hasta pasados 5 min de servicio, y el
    // panel —que espera la primera señal solo 3 min desde que
    // empieza el empujón— daba la instalación por fallida
    // siempre. El espaciado de 5 min entre reintentos se
    // mantiene: el bloque del latido estampa la hora al intentar.
    private DateTime _ultimoIntentoCredencial = DateTime.MinValue;
    private DateTime _ultimaConfig = DateTime.MinValue;

    // Transiciones del compañero para el latido de depuración.
    private bool? _companeroLatido;
    private int _fallosPingSeguidos;
    private DateTime _companeroDesde = DateTime.UtcNow;

    private static string ArchivoPendientes =>
        Path.Combine(Registro.DirectorioDatos, "pending_local.json");

    private static string ArchivoApagadoLocal =>
        Path.Combine(Registro.DirectorioDatos, "apagado_local.json");

    // Escalera de respuesta: las ofensas por dispositivo (en
    // disco, sobreviven a los reinicios) y el peldaño aplicado a
    // cada bloqueo vivo, que es lo que pending_local.json le
    // cuenta a la ventana del compañero.
    private readonly RegistroOfensas _ofensas = new(Registro.DirectorioDatos);
    private readonly object _lockRespuesta = new();
    private readonly Dictionary<string, int> _nivelPorClave = new();
    // Nombre visible del causante de la cuenta en curso, para la
    // banda de cuenta atrás del compañero (apagado_local.json).
    private string? _apagadoNombreVisible;

    public AgenteWorker()
    {
        _cliente = new ClientePanel(_configuracion);
        _motor = new MotorBloqueo(_diario, _candados, PonerSoloLectura, QuitarSoloLectura);
        _actualizador = new ActualizadorAgente(_cliente);
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
            // Canal de órdenes: la configuración inicial también
            // concilia una actualización que quedó EN_CURSO en el
            // reinicio anterior (confirmarla exige poco: la
            // descarga, si toca, va en segundo plano).
            if (remota?.Comandos is { Count: > 0 } ordenesIniciales)
                await ProcesarOrdenesAsync(ordenesIniciales).ConfigureAwait(false);
            // Barrido del respaldo viejo de una actualización:
            // corre siempre al arrancar, haya o no órdenes en la
            // configuración.
            LimpiarRespaldoAnterior();
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
            // Si el agente anterior murió con una cuenta atrás
            // corriendo, su diario lo dice: se reconcilia antes
            // del barrido (adoptar, cancelar la huérfana o
            // registrar la vencida), nunca se ignora.
            ReconciliarApagadoAlArrancar(iniciales);

            // Fase 2: barrido inicial (bloquea lo presente salvo la base).
            foreach (var disp in iniciales.Values)
            {
                if (disp.Tipo == TipoDispositivo.Red) continue;
                await AlLlegarAsync(disp).ConfigureAwait(false);
            }
            // La línea que ata la cadena del arranque: qué
            // quedó en pending_local.json para el compañero.
            // Si un día el cartel no sale con la PC recién
            // encendida, esta línea dice si el bloqueo llegó al
            // archivo (y el fallo está en el compañero o su
            // lanzamiento) o nunca llegó (y está en el barrido).
            var pendientesArranque = PendientesLocalesActuales().Count;
            Log.Info(
                $"Barrido inicial terminado: {pendientesArranque} bloqueo(s) " +
                "en pending_local.json para el compañero.");
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
            nivel = NivelRespuestaDe(reg.Dispositivo.Clave),
        }).ToList();
    }

    /// <summary>El peldaño de la escalera aplicado a este bloqueo (0 = ninguno).</summary>
    private int NivelRespuestaDe(string clave)
    {
        lock (_lockRespuesta)
            return _nivelPorClave.TryGetValue(clave, out var nivel) ? nivel : 0;
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
            nivel = 0,
        });
        EscribirPendientesLocales(pendientes);
    }

    private static void EscribirPendientesLocales(List<object> pendientes)
    {
        // Escritura CON REINTENTOS: el compañero lee este archivo
        // (vigilante + sondeo) y si su lectura coincide con el
        // renombrado, Windows deniega el reemplazo («Access to
        // the path is denied»: pasó dos veces en la prueba real
        // del 2026-11-04, una justo al bloquear una memoria, y el
        // bloqueo se quedaba sin ventana). La lectura es breve;
        // reintentar unos pocos cientos de ms basta para colar la
        // escritura sin perder el aviso.
        try
        {
            Exception? ultimo = null;
            for (int intento = 0; intento < 6; intento++)
            {
                try
                {
                    Directory.CreateDirectory(Registro.DirectorioDatos);
                    var temporal = ArchivoPendientes + ".tmp";
                    File.WriteAllText(temporal, JsonSerializer.Serialize(pendientes));
                    File.Move(temporal, ArchivoPendientes, overwrite: true);
                    return;
                }
                catch (Exception exc) when (exc is IOException or UnauthorizedAccessException)
                {
                    ultimo = exc;
                    Thread.Sleep(120);
                }
            }
            Log.Error($"pending_local.json no se pudo escribir: {ultimo?.Message}");
        }
        catch (Exception exc)
        {
            Log.Error($"pending_local.json no se pudo escribir: {exc.Message}");
        }
    }

    // ── compañero en marcha (ficha PID; WMI de respaldo) ─────────
    private bool? CompaneroEnMarcha()
    {
        lock (_lockCompanero)
        {
            if (DateTime.UtcNow - _companeroCacheMarca < TimeSpan.FromSeconds(5))
                return _companeroCacheValor;
        }
        bool? resultado = CompaneroEnMarchaSegunFicha() ??
                          CompaneroEnMarchaSegunWmi();
        lock (_lockCompanero)
        {
            _companeroCacheValor = resultado;
            _companeroCacheMarca = DateTime.UtcNow;
        }
        return resultado;
    }

    /// <summary>
    /// La vía principal: la ficha que el compañero escribe al
    /// arrancar (CompaneroPid). Si hay ficha, su veredicto
    /// manda — el proceso del PID es el compañero que la
    /// escribió, o no lo es. Sin ficha (un compañero de una
    /// versión anterior aún vivo tras la actualización) se
    /// devuelve null y decide el respaldo.
    /// </summary>
    private static bool? CompaneroEnMarchaSegunFicha()
    {
        var ficha = CompaneroPid.Leer();
        if (ficha is null) return null;
        try
        {
            using var proceso = Process.GetProcessById(ficha.Pid);
            return CompaneroPid.CoincideProceso(
                ficha,
                proceso.ProcessName,
                proceso.SessionId,
                proceso.StartTime.ToUniversalTime());
        }
        catch (ArgumentException)
        {
            // No hay proceso con ese PID: la ficha es de un
            // compañero ya cerrado sin poder borrarla.
            return false;
        }
        catch (Exception exc)
        {
            Log.Debug($"Comprobación por ficha del compañero falló: {exc.Message}");
            return null;
        }
    }

    /// <summary>
    /// El respaldo histórico: buscar texto en las líneas de
    /// comandos por WMI («companero.py» de la época Python o el
    /// modo « prompt» del exe). Solo decide cuando no hay ficha
    /// — un compañero anterior a ella — porque la coincidencia
    /// es frágil: depende del nombre del exe y del argumento.
    /// </summary>
    private bool? CompaneroEnMarchaSegunWmi()
    {
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
            return encontrado;
        }
        catch (Exception exc)
        {
            Log.Debug($"Consulta WMI del compañero falló: {exc.Message}");
            return null;
        }
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
            if (enWl == true)
            {
                // El dispositivo está en la lista: su historial
                // de ofensas se cierra y la escalera se olvida
                // de él.
                _ofensas.Olvidar(disp.Clave);
                lock (_lockRespuesta) _nivelPorClave.Remove(disp.Clave);
            }
            if (_compartida.LockSessionOnInsert)
            {
                try { LockWorkStation(); } catch { /* bloquear sesión es best-effort */ }
            }
        }
        // Veredicto confirmado de fuera de la lista: responde la
        // escalera (o el apagado directo si la escalera está
        // apagada; ResponderFueraDeLista filtra tipos y línea
        // base). Y con su ajuste propio, se pide la foto del
        // momento.
        if (enWl == false)
        {
            ResponderFueraDeLista(disp);
            SolicitarEvidencia(disp);
        }
        RefrescarPendientesLocales();
    }

    private async Task RegistrarEnPanelAsync(Dispositivo disp, bool enWl)
    {
        if (_pendientesRegistrados.Contains(disp.Clave)) return;
        var pid = await _cliente.RegistrarBloqueoAsync(
            disp.Letra, disp.Serial, disp.NombreVisible, enWl).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(pid))
        {
            _pendientesRegistrados.Add(disp.Clave);
            // El id se guarda también tras la extracción: el
            // paquete de evidencia puede tardar más que el bloqueo.
            lock (_lockEvidencia) _idsBloqueoPanel[disp.Clave] = pid;
        }
    }

    /// <summary>
    /// Deja al compañero la solicitud de la foto del momento de un
    /// bloqueo fuera de la lista blanca (ajuste del panel, apagado
    /// por defecto). El servicio no puede capturar nada — sesión 0,
    /// sin escritorio —: escribe la solicitud en la carpeta
    /// `evidencia` y el compañero, que vive en la sesión del
    /// usuario, captura y deja el paquete. Una por BLOQUEO: la
    /// instancia es el id del bloqueo en el panel si ya consta
    /// (el registro va antes en AlLlegarAsync) o el instante de
    /// detección; otro bloqueo del mismo dispositivo crea otra
    /// solicitud aunque la primera foto siga sin subir.
    /// </summary>
    private void SolicitarEvidencia(Dispositivo disp)
    {
        if (!_compartida.CaptureEvidenceOnNonWhitelisted) return;
        var instante = DateTime.UtcNow.ToString("o");
        string? bloqueoId;
        lock (_lockEvidencia) _idsBloqueoPanel.TryGetValue(disp.Clave, out bloqueoId);
        var instancia = !string.IsNullOrEmpty(bloqueoId) ? bloqueoId : instante;
        lock (_lockEvidencia)
        {
            if (!_evidenciaSolicitada.Add(disp.Clave + "|" + instancia)) return;
        }
        try
        {
            var carpeta = GestorEvidencia.Carpeta(Registro.DirectorioDatos);
            if (GestorEvidencia.Solicitar(
                    carpeta, disp.Clave, disp.Serial, instante, instancia, bloqueoId))
                Log.Info($"Evidencia solicitada al compañero: {disp.Nombre} ({disp.Serial})");
        }
        catch (Exception exc)
        {
            Log.Error($"No se pudo solicitar la evidencia de {disp.Nombre}: {exc.Message}");
        }
    }

    /// <summary>
    /// Procesa una extracción confirmada. Devuelve false SOLO si
    /// la guarda anti-parpadeo la rechaza (dispositivo bloqueado
    /// con el nodo aún presente): el llamante conserva su ficha.
    /// </summary>
    private async Task<bool> AlExtraerAsync(string clave, Dispositivo disp)
    {
        if (disp.Tipo == TipoDispositivo.Impresora)
        {
            // Nunca se bloqueó ni se registró: solo el evento.
            _cliente.Evento(EvDesconectado, disp.Letra, disp.Serial);
            return true;
        }
        // Guarda de último recurso: si el dispositivo consta
        // BLOQUEADO y su nodo PnP sigue físicamente presente, no
        // hubo extracción — es la enumeración la que no lo lista,
        // ni con la gracia cumplida. «Extraerlo» reactivaría el
        // nodo y dejaría la memoria accesible estando bloqueada:
        // ante la duda, el bloqueo se mantiene (fail-closed) y la
        // ficha se conserva; ya se procesará cuando el nodo
        // desaparezca de verdad o el dispositivo se desbloquee.
        var registroPrevio = _motor.Registro(clave);
        if (registroPrevio is { Estado: EstadoBloqueo.Bloqueado } &&
            Pnp.EstaPresenteFisicamente(disp.InstanciaPnP))
        {
            // El veto se anuncia una vez por episodio: el
            // barrido volverá por aquí en cada ciclo mientras
            // el parpadeo dure, y repetir la advertencia solo
            // entierra el registro. El bloqueo se mantiene
            // igualmente (fail-closed).
            if (_vetosExtraccionAvisados.Add(clave))
            {
                Log.Advertencia(
                    $"Extracción no creída de {disp.Nombre}: su nodo sigue presente " +
                    "y bloqueado; se mantiene el bloqueo (posible parpadeo de enumeración)");
            }
            return false;
        }
        _vetosExtraccionAvisados.Remove(clave);
        _motor.AlExtraer(clave);
        // El peldaño era de este bloqueo: la ofensa queda en el
        // registro persistente, pero el bloqueo vivo se olvida.
        lock (_lockRespuesta) _nivelPorClave.Remove(clave);
        DesarmarApagado(clave, disp, "el dispositivo se extrajo");
        await _cliente.CerrarBloqueoAsync(disp.Letra, disp.Serial).ConfigureAwait(false);
        _cliente.Evento(EvDesconectado, disp.Letra, disp.Serial);
        _pendientesRegistrados.Remove(clave);
        // El bloqueo terminó: si el dispositivo vuelve a entrar,
        // su foto del momento se pide de nuevo (se olvidan todas
        // las instancias pedidas de esta clave).
        lock (_lockEvidencia)
            _evidenciaSolicitada.RemoveWhere(
                s => s.StartsWith(clave + "|", StringComparison.Ordinal));
        RefrescarPendientesLocales();
        return true;
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
    //  - El estado se refleja en un diario en disco
    //    (apagado.json): si el proceso muere con la cuenta
    //    corriendo, el siguiente agente la reconcilia al
    //    arrancar (ReconciliarApagadoAlArrancar) en vez de
    //    dejarla huérfana.
    // La cuenta atrás la define el panel (shutdownCountdownSeconds,
    // 60 por defecto, acotada a 10–600 en ConfigCompartida).
    private readonly object _lockApagado = new();
    private readonly HashSet<string> _apagadoCausantes = new();
    private readonly HashSet<string> _clavesDelArranque = new();
    private bool _apagadoEnCurso;
    // Vencimiento y duración de la cuenta en curso: el diario en
    // disco (apagado.json) los necesita para reconciliar al
    // arrancar si este proceso muere con la cuenta corriendo.
    private DateTime? _apagadoVenceUtc;
    private int _apagadoSegundos;

    /// <summary>
    /// La respuesta a un dispositivo confirmado fuera de la
    /// lista blanca. Sin escalera (el ajuste por defecto), es el
    /// apagado directo de siempre. Con la escalera activada, la
    /// ofensa se anota en el registro persistente del dispositivo
    /// y responde su peldaño: 1.º aviso en la ventana, 2.º
    /// bloqueo de la sesión, 3.º la cuenta atrás de apagado. El
    /// peldaño queda anotado por clave para que pending_local.json
    /// se lo cuente al compañero.
    /// </summary>
    private void ResponderFueraDeLista(Dispositivo disp)
    {
        if (!_compartida.ShutdownOnNonWhitelisted) return;
        if (disp.Tipo is not (TipoDispositivo.Disco or TipoDispositivo.Telefono or TipoDispositivo.Optico))
            return;
        if (!_compartida.ShutdownEscalationEnabled)
        {
            ArmarApagado(disp);
            return;
        }
        var conteo = _ofensas.Registrar(disp.Clave, DateTime.UtcNow);
        var nivel = RegistroOfensas.NivelPara(conteo);
        lock (_lockRespuesta) _nivelPorClave[disp.Clave] = (int)nivel;
        switch (nivel)
        {
            case NivelRespuesta.Aviso:
                _cliente.Evento(EvEscaleraAviso, disp.Letra, disp.Serial);
                Log.Advertencia(
                    $"Escalera de respuesta: aviso (ofensa 1) por {disp.Nombre} ({disp.Serial}).");
                break;
            case NivelRespuesta.BloqueoSesion:
                _cliente.Evento(EvEscaleraBloqueo, disp.Letra, disp.Serial);
                Log.Advertencia(
                    $"Escalera de respuesta: bloqueo de sesión (ofensa 2) por {disp.Nombre} ({disp.Serial}).");
                try { LockWorkStation(); } catch { /* bloquear sesión es best-effort */ }
                break;
            case NivelRespuesta.Apagado:
                Log.Advertencia(
                    $"Escalera de respuesta: apagado (ofensa {conteo}) por {disp.Nombre} ({disp.Serial}).");
                ArmarApagado(disp);
                break;
        }
    }

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
        var intentoFallido = false;
        var cambio = false;
        lock (_lockApagado)
        {
            if (_clavesDelArranque.Contains(disp.Clave)) return;
            cambio = _apagadoCausantes.Add(disp.Clave);
            if (!_apagadoEnCurso)
            {
                var mensaje =
                    $"USBMonitor: dispositivo no autorizado ({disp.Nombre}). " +
                    $"El equipo se apagara en {segundos} segundos.";
                if (EjecutarShutdownExe("/s", "/t",
                        segundos.ToString(), "/c", mensaje))
                {
                    _apagadoEnCurso = true;
                    _apagadoSegundos = segundos;
                    _apagadoVenceUtc = DateTime.UtcNow.AddSeconds(segundos);
                    _apagadoNombreVisible = disp.NombreVisible;
                    armado = true;
                    cambio = true;
                }
                else
                {
                    intentoFallido = true;
                }
            }
        }
        // El estado (causante nuevo o cuenta recién armada) se
        // refleja en el diario en disco: si este proceso muere,
        // el siguiente agente hereda la verdad y no una amnesia.
        if (cambio) GuardarDiarioApagado();
        if (armado)
        {
            _cliente.Evento(EvApagadoArmado, disp.Letra, disp.Serial);
            Log.Advertencia(
                $"Apagado ARMADO ({segundos} s) por dispositivo " +
                $"fuera de la lista blanca: {disp.Nombre} ({disp.Serial})");
        }
        else if (intentoFallido)
        {
            Log.Error($"No se pudo armar el apagado por {disp.Nombre}");
        }
    }

    /// <summary>El causante desapareció (extracción/desbloqueo): si era el último, se aborta la cuenta.</summary>
    private void DesarmarApagado(string clave, Dispositivo? disp, string motivo)
    {
        var cancelado = false;
        var cambio = false;
        lock (_lockApagado)
        {
            if (!_apagadoCausantes.Remove(clave)) return;
            cambio = true;
            if (_apagadoCausantes.Count == 0 && _apagadoEnCurso)
            {
                EjecutarShutdownExe("/a");
                _apagadoEnCurso = false;
                _apagadoVenceUtc = null;
                cancelado = true;
            }
        }
        if (cambio) GuardarDiarioApagado();
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
            _apagadoVenceUtc = null;
            if (_apagadoEnCurso)
            {
                EjecutarShutdownExe("/a");
                _apagadoEnCurso = false;
                cancelado = true;
            }
        }
        GuardarDiarioApagado();
        if (cancelado) Log.Info($"Apagado cancelado: {motivo}");
    }

    /// <summary>
    /// Refleja el estado del apagado en su diario en disco
    /// (apagado.json, junto al resto del estado del agente): sin
    /// causantes ni cuenta, el diario se borra. Se llama tras
    /// cada cambio de estado; toma el candado por su cuenta
    /// (reentrante si ya se tenía) para fotografiar un estado
    /// coherente.
    /// </summary>
    private void GuardarDiarioApagado()
    {
        EstadoApagado? estado = null;
        lock (_lockApagado)
        {
            if (_apagadoCausantes.Count > 0 || _apagadoEnCurso)
            {
                estado = new EstadoApagado
                {
                    Causantes = _apagadoCausantes.ToList(),
                    CuentaEnCurso = _apagadoEnCurso,
                    VenceUtc = _apagadoVenceUtc?.ToString("o") ?? "",
                    Segundos = _apagadoSegundos,
                };
            }
        }
        if (estado is null)
            GestorApagado.Borrar(Registro.DirectorioDatos);
        else
            GestorApagado.Guardar(Registro.DirectorioDatos, estado);
        EscribirApagadoLocal();
    }

    /// <summary>
    /// El archivo que la ventana del compañero vigila para
    /// pintar la banda de cuenta atrás (apagado_local.json): con
    /// cuenta en curso lleva el nombre del causante y el
    /// vencimiento; sin cuenta, el archivo no existe. Se escribe
    /// con el mismo patrón que pending_local.json (temporal +
    /// renombrado con reintentos: el compañero lo lee cada
    /// segundo y la lectura puede coincidir con el reemplazo).
    /// </summary>
    private void EscribirApagadoLocal()
    {
        try
        {
            bool enCurso;
            DateTime? vence;
            string? nombre;
            lock (_lockApagado)
            {
                enCurso = _apagadoEnCurso;
                vence = _apagadoVenceUtc;
                nombre = _apagadoNombreVisible;
            }
            if (!enCurso)
            {
                if (File.Exists(ArchivoApagadoLocal))
                    File.Delete(ArchivoApagadoLocal);
                return;
            }
            var contenido = JsonSerializer.Serialize(new
            {
                nombre = nombre ?? "Dispositivo no autorizado",
                venceUtc = vence?.ToString("o") ?? "",
            });
            Directory.CreateDirectory(Registro.DirectorioDatos);
            for (int intento = 0; intento < 6; intento++)
            {
                try
                {
                    var temporal = ArchivoApagadoLocal + ".tmp";
                    File.WriteAllText(temporal, contenido);
                    File.Move(temporal, ArchivoApagadoLocal, overwrite: true);
                    return;
                }
                catch (Exception exc) when (exc is IOException or UnauthorizedAccessException)
                {
                    if (intento == 5) throw;
                    Thread.Sleep(50);
                }
            }
        }
        catch (Exception exc)
        {
            // La banda del compañero es un aviso, no un requisito:
            // si el archivo no se deja escribir, el apagado sigue
            // su curso y el fallo queda en el registro.
            Log.Error($"No se pudo escribir apagado_local.json: {exc.Message}");
        }
    }

    /// <summary>
    /// Reconciliación del apagado al arrancar: si el agente
    /// anterior murió con una cuenta atrás en marcha (un
    /// cuelgue, un kill), su diario lo dice y aquí se resuelve —
    /// la cuenta de Windows es del sistema operativo y sigue
    /// corriendo sin agente —. La decisión pura vive en
    /// ReconciliacionApagado (Core); aquí solo se ejecuta.
    /// </summary>
    private void ReconciliarApagadoAlArrancar(
        IReadOnlyDictionary<string, Dispositivo> iniciales)
    {
        var estado = GestorApagado.Leer(Registro.DirectorioDatos);
        if (estado is null) return;
        var (accion, vivos) = ReconciliacionApagado.Decidir(
            estado, iniciales.Keys, DateTime.UtcNow);
        switch (accion)
        {
            case AccionReconciliacionApagado.AdoptarCuenta:
                lock (_lockApagado)
                {
                    foreach (var clave in vivos)
                    {
                        // El causante adoptado deja de ser línea
                        // base: su cuenta sigue viva y tiene que
                        // poder cancelarse al extraerlo.
                        _clavesDelArranque.Remove(clave);
                        _apagadoCausantes.Add(clave);
                    }
                    _apagadoEnCurso = true;
                    _apagadoSegundos = estado.Segundos;
                    _apagadoVenceUtc =
                        DateTimeOffset.TryParse(estado.VenceUtc, out var vence)
                            ? vence.UtcDateTime
                            : null;
                    if (vivos.Count > 0 &&
                        iniciales.TryGetValue(vivos[0], out var causante))
                        _apagadoNombreVisible = causante.NombreVisible;
                }
                // La banda de cuenta atrás del compañero también
                // se entera de la cuenta adoptada.
                EscribirApagadoLocal();
                Log.Advertencia(
                    "Apagado: cuenta atrás recuperada tras el reinicio " +
                    $"del agente ({vivos.Count} causante(s) siguen " +
                    $"conectados); vencía a las {estado.VenceUtc}.");
                _cliente.Evento(EvApagadoRecuperado);
                break;
            case AccionReconciliacionApagado.CancelarCuenta:
                lock (_lockApagado) EjecutarShutdownExe("/a");
                GestorApagado.Borrar(Registro.DirectorioDatos);
                Log.Advertencia(
                    "Apagado: la cuenta atrás heredada quedó sin " +
                    "causantes conectados; cancelada al arrancar.");
                _cliente.Evento(EvApagadoHuerfano);
                break;
            case AccionReconciliacionApagado.RegistrarVencida:
                GestorApagado.Borrar(Registro.DirectorioDatos);
                Log.Advertencia(
                    "Apagado: una cuenta atrás venció mientras el " +
                    "agente no estaba en marcha; no se rearma (lo " +
                    "conectado al arrancar es línea base).");
                _cliente.Evento(EvApagadoHuerfano);
                break;
            default:
                // Sin cuenta viva: el diario es un resto y se olvida.
                GestorApagado.Borrar(Registro.DirectorioDatos);
                break;
        }
        // Sea cual sea el desenlace, el archivo del compañero
        // refleja el estado real tras reconciliar (sin cuenta,
        // no hay archivo ni banda fantasma).
        EscribirApagadoLocal();
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
                    _ausencias.MarcarPresente(clave);
                    // Reapareció: el episodio de veto terminó;
                    // si vuelve a parpadear, se avisa de nuevo.
                    _vetosExtraccionAvisados.Remove(clave);
                    if (!previos.ContainsKey(clave))
                        await AlLlegarAsync(disp).ConfigureAwait(false);
                }
                // Ausencias: solo las CONFIRMADAS (gracia cumplida
                // sin reaparecer) se procesan como extracción; las
                // demás conservan su ficha de conocido — ni se
                // extraen ni, al reaparecer, se tratan como llegada
                // nueva (que era el ciclo bloquea/libera/bloquea).
                var ahora = DateTime.UtcNow;
                var siguientes = new Dictionary<string, Dispositivo>(actuales);
                foreach (var (clave, disp) in previos)
                {
                    if (actuales.ContainsKey(clave)) continue;
                    if (!_ausencias.AusenciaConfirmada(clave, ahora) ||
                        !await AlExtraerAsync(clave, disp).ConfigureAwait(false))
                        siguientes[clave] = disp;
                }
                lock (_lockConocidos) _conocidos = siguientes;
                AvisarConectadosSiCambio(actuales);
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
                Dictionary<string, Dispositivo> fotoActual;
                lock (_lockConocidos)
                    fotoActual = new Dictionary<string, Dispositivo>(_conocidos);
                foreach (var clave in _motor.Vigilar(fotoActual))
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
                        if (enWl == false)
                        {
                            ArmarApagado(reg.Dispositivo);
                            SolicitarEvidencia(reg.Dispositivo);
                        }
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


    /// <summary>
    /// El respaldo «.anterior» (~95 MB) no se queda para siempre:
    /// confirmada la actualización, el ejecutor de órdenes lo
    /// borra al momento; este barrido de arranque retira el que
    /// lleve más de 7 días olvidado (una actualización que nunca
    /// se confirmó ni se reintentó).
    /// </summary>
    private void LimpiarRespaldoAnterior()
    {
        try
        {
            var respaldo = Instalador.RutaExeInstalado() + ".anterior";
            if (File.Exists(respaldo) &&
                File.GetCreationTimeUtc(respaldo) < DateTime.UtcNow.AddDays(-7))
            {
                File.Delete(respaldo);
                Log.Info("Limpieza: retirado el ejecutable anterior (.anterior) de hace más de 7 días.");
            }
        }
        catch { /* la limpieza nunca impide arrancar */ }
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

    /// <summary>
    /// Sube al panel los paquetes de evidencia que el compañero
    /// dejó capturados en la carpeta. Solo cuando consta el id del
    /// bloqueo en el panel: sin id (el registro aún no salió o no
    /// hubo red al bloquear) el paquete espera al siguiente ciclo,
    /// con la misma filosofía que la cola de eventos. Subido =
    /// borrado. El tope de 20 paquetes protege el disco de una PC
    /// que pasa mucho tiempo sin red, el tope por edad (7 días)
    /// saca de la cola lo que ya no subirá, y un rechazo
    /// permanente del panel manda el paquete a la carpeta de
    /// descartadas en vez de reintentarlo para siempre.
    /// </summary>
    private async Task SubirEvidenciasPendientesAsync()
    {
        var carpeta = GestorEvidencia.Carpeta(Registro.DirectorioDatos);
        var vencidas = GestorEvidencia.AplicarTopeEdad(carpeta, 7, DateTime.UtcNow);
        if (vencidas.Count > 0)
        {
            Log.Advertencia(
                "Evidencia: paquetes con más de 7 días sin subir " +
                $"movidos a descartadas ({vencidas.Count}).");
        }
        var borradas = GestorEvidencia.AplicarTopePaquetes(carpeta, 20);
        if (borradas.Count > 0)
        {
            Log.Advertencia(
                "Evidencia: tope de 20 paquetes sin subir alcanzado; " +
                $"borrados los más antiguos ({borradas.Count}).");
        }
        foreach (var paquete in GestorEvidencia.ListarPaquetes(carpeta))
        {
            // Foto diferida dentro de su ventana de gracia
            // (5 min): el compañero aún puede completarla al
            // desbloquear la sesión; subir el paquete ya lo
            // dejaría sin foto para siempre.
            if (paquete.FotoPendiente &&
                DateTime.TryParse(paquete.CapturedAt, out var captura) &&
                DateTime.UtcNow - captura.ToUniversalTime() < TimeSpan.FromMinutes(5))
                continue;
            // El paquete sabe a qué bloqueo pertenece si el id
            // constaba al pedir la foto; si no, manda el último
            // id conocido del dispositivo.
            string? id = paquete.BloqueoId;
            if (string.IsNullOrEmpty(id))
            {
                lock (_lockEvidencia) _idsBloqueoPanel.TryGetValue(paquete.Clave, out id);
            }
            if (string.IsNullOrEmpty(id)) continue;
            var resultado = await _cliente
                .SubirEvidenciaAsync(id, paquete).ConfigureAwait(false);
            switch (resultado)
            {
                case ClientePanel.ResultadoSubidaEvidencia.Subida:
                    GestorEvidencia.BorrarPaquete(carpeta, paquete.Clave, paquete.Instancia);
                    Log.Info(
                        $"Evidencia subida al panel: bloqueo {id}, serial {paquete.Serial}.");
                    break;
                case ClientePanel.ResultadoSubidaEvidencia.Permanente:
                    // El panel lo rechaza para siempre (bloqueo
                    // purgado o id irrecuperable): reintentarlo
                    // solo envenena la cola. A descartadas, con
                    // constancia en el registro.
                    if (GestorEvidencia.MoverPaqueteADescartadas(carpeta, paquete.Clave, paquete.Instancia))
                    {
                        Log.Advertencia(
                            "Evidencia descartada: el panel rechazó " +
                            $"el paquete del bloqueo {id} (serial " +
                            $"{paquete.Serial}) de forma permanente; " +
                            "queda en la carpeta de descartadas.");
                    }
                    break;
                default:
                    // Pasajera: el paquete espera al próximo ciclo.
                    break;
            }
        }
        // La carpeta de descartadas también tiene tope: es una
        // papelera de revisión, no un archivo infinito.
        GestorEvidencia.AplicarTopePaquetes(
            GestorEvidencia.CarpetaDescartadas(carpeta), 20);
    }

    /// <summary>Firma comparable de un conjunto conectado.</summary>
    private static string FirmaConectados(List<UnidadConectada> unidades) =>
        string.Join("\n", unidades
            .Select(u => $"{u.SerialNumber}|{u.DriveLetter ?? ""}")
            .OrderBy(f => f, StringComparer.Ordinal));

    /// <summary>
    /// Si el conjunto conectado cambió respecto a lo último que
    /// consta en el panel, lo envía a connected-status EN EL
    /// MOMENTO, en segundo plano para no frenar la detección. El
    /// latido de 30 s sigue mandándolo como siempre: renueva el
    /// lastSeen que mantiene vivas las filas entre cambios.
    /// </summary>
    private void AvisarConectadosSiCambio(Dictionary<string, Dispositivo> actuales)
    {
        var unidades = Detector.UnidadesParaEstado(actuales.Values);
        var firma = FirmaConectados(unidades);
        lock (_lockFirmaConectados)
        {
            if (firma == _firmaConectados) return;
            _firmaConectados = firma;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                if (!await _cliente.EstadoConectadosAsync(unidades).ConfigureAwait(false))
                    throw new InvalidOperationException("el panel no aceptó el estado");
            }
            catch (Exception exc)
            {
                Log.Error($"Aviso de conectados al cambiar: {exc.Message}");
                // Envío fallido: se olvida la firma para reintentarlo
                // en el próximo cambio; el latido también reconcilia.
                lock (_lockFirmaConectados)
                {
                    if (_firmaConectados == firma) _firmaConectados = "";
                }
            }
        });
    }

    private async Task BucleLatidoAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Ping periódico: la versión del agente SOLO viaja
                // en esta llamada (el panel la guarda como
                // agentVersion al recibirla) y el servicio no la
                // hacía nunca: solo salía al pulsar «Probar
                // conexión» en la caja de herramientas. Sin esto,
                // Equipos enseñaba «Sin anunciar» aunque el latido
                // de conectados renovara lastSeen y el servicio
                // constara como corriendo. Con su propio try para
                // que un fallo de red del ping no se salte el resto
                // del latido.
                try
                {
                    await _cliente.PingAsync().ConfigureAwait(false);
                    if (_fallosPingSeguidos > 0)
                    {
                        Log.Info(
                            $"Latido: el panel responde otra vez (tras {_fallosPingSeguidos} ping(s) fallidos).");
                        _fallosPingSeguidos = 0;
                    }
                }
                catch (Exception excPing)
                {
                    // Solo el primer fallo de la racha: repetir el
                    // error en cada latido (30 s) durante una caída
                    // larga llenaría el registro sin decir nada nuevo.
                    _fallosPingSeguidos++;
                    if (_fallosPingSeguidos == 1)
                        Log.Error($"Latido: ping al panel: {excPing.Message}");
                }
                await _cliente.VaciarColaAsync().ConfigureAwait(false);
                Dictionary<string, Dispositivo> actuales;
                lock (_lockConocidos)
                    actuales = new Dictionary<string, Dispositivo>(_conocidos);
                var unidadesLatido = Detector.UnidadesParaEstado(actuales.Values);
                if (await _cliente.EstadoConectadosAsync(unidadesLatido).ConfigureAwait(false))
                {
                    // El latido también deja constancia de la firma:
                    // el aviso al instante no repite el mismo
                    // conjunto que el latido acaba de mandar.
                    lock (_lockFirmaConectados)
                        _firmaConectados = FirmaConectados(unidadesLatido);
                }
                await SubirEvidenciasPendientesAsync().ConfigureAwait(false);
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
                // Credencial por clave (overhaul 2026-11-08): si
                // este equipo aún no está registrado en el panel,
                // se acredita solo en cuanto puede, sin que nadie
                // visite la PC: con el código de enrolamiento que
                // dejó la instalación (un solo uso) o migrando el
                // token antiguo (se presenta una última vez y se
                // borra). Reintento cada 5 minutos si el panel no
                // responde; una vez registrado, este bloque no
                // vuelve a hacer nada. El intento va por la vía
                // DETALLADA y el rechazo se escribe en el registro
                // con el motivo y la frase del panel: cuando un
                // equipo no se enrola nunca, su agente.log tiene
                // que decir por qué, sin tener que adivinarlo.
                if (_configuracion.EquipoId is null &&
                    ahora - _ultimoIntentoCredencial >= TimeSpan.FromMinutes(5))
                {
                    _ultimoIntentoCredencial = ahora;
                    var codigoPendiente = _configuracion.CodigoEnrolamiento;
                    if (codigoPendiente is not null)
                    {
                        var intento = await _cliente.EnrolarDetalladoAsync(codigoPendiente).ConfigureAwait(false);
                        if (intento.Ok)
                        {
                            _configuracion.BorrarCodigoEnrolamiento();
                            Log.Info("Equipo enrolado con el código de la instalación.");
                        }
                        else
                        {
                            Log.Advertencia($"El enrolamiento con código falló: {intento.Detalle ?? "sin detalle del panel"}" +
                                (intento.Motivo is not null ? $" (motivo: {intento.Motivo})" : "") +
                                " Se reintenta en unos minutos (si el código caducó o ya se gastó, genera otro en Equipos).");
                        }
                    }
                }
                // Con una cuenta atrás en curso, la configuración
                // (y con ella el canal de órdenes) se sondea cada
                // pocos segundos: la orden de detener el apagado
                // desde el panel tiene que llegar mientras la
                // cuenta aún corre, no en el sondeo de 10 minutos.
                var intervaloConfig = ApagadoEnCurso()
                    ? TimeSpan.FromSeconds(5)
                    : TimeSpan.FromSeconds(600);
                if (ahora - _ultimaConfig >= intervaloConfig)
                {
                    _ultimaConfig = ahora;
                    var remota = await _cliente.ConfigRemotaAsync().ConfigureAwait(false);
                    if (remota is not null) _compartida.AplicarRemota(remota);
                    if (remota?.Comandos is { Count: > 0 } ordenes)
                        await ProcesarOrdenesAsync(ordenes).ConfigureAwait(false);
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
            // El latido también respira más rápido con la cuenta
            // en curso, para que el sondeo de órdenes de arriba
            // corra cada pocos segundos y no cada 30.
            if (!await EsperarAsync(ApagadoEnCurso() ? 5000 : 30000, ct)
                    .ConfigureAwait(false)) return;
        }
    }

    /// <summary>
    /// Reparte las órdenes que trae la configuración: las de
    /// «cancelar-apagado» las ejecuta este trabajador (son del
    /// apagado, no del actualizador, que las rechazaría por tipo
    /// desconocido) y el resto van al actualizador en segundo
    /// plano, como siempre.
    /// </summary>
    private async Task ProcesarOrdenesAsync(List<OrdenAgente> ordenes)
    {
        // Cada orden que llega queda escrita: si una se queda
        // sin avanzar, el registro dice al menos que llegó, con
        // su tipo, su estado y su versión objetivo.
        foreach (var orden in ordenes)
        {
            Log.Info(
                $"Orden recibida del panel: {orden.Tipo} {orden.Id} " +
                $"(estado {orden.Estado}, intentos {orden.Intentos}, " +
                $"versión objetivo {orden.VersionObjetivo ?? "—"}).");
        }
        var paraActualizador = new List<OrdenAgente>();
        foreach (var orden in ordenes)
        {
            if (string.Equals(orden.Tipo, "cancelar-apagado",
                    StringComparison.OrdinalIgnoreCase))
                await EjecutarOrdenCancelarApagadoAsync(orden).ConfigureAwait(false);
            else
                paraActualizador.Add(orden);
        }
        if (paraActualizador.Count > 0)
            _actualizador.ProcesarEnSegundoPlano(paraActualizador);
    }

    /// <summary>
    /// Ejecuta una orden «cancelar-apagado» del panel: detiene la
    /// cuenta atrás en curso (si la hay) y la da por hecha. Sin
    /// cuenta, también es HECHA: la orden pide un estado («que
    /// no haya apagado en curso») que ya se cumple.
    /// </summary>
    private async Task EjecutarOrdenCancelarApagadoAsync(OrdenAgente orden)
    {
        if (string.Equals(orden.Estado, "CANCELADA", StringComparison.OrdinalIgnoreCase))
        {
            Log.Info($"Orden {orden.Tipo} {orden.Id} cancelada en el panel: se ignora.");
            return;
        }
        var aceptada = await _cliente.InformarOrdenAsync(orden.Id, "EN_CURSO")
            .ConfigureAwait(false);
        if (!aceptada) return;
        var habia = HayApagadoQueCancelar();
        if (habia)
        {
            CancelarApagado("cancelado desde el panel");
            _cliente.Evento(EvApagadoCancelado);
            Log.Advertencia("Cuenta atrás de apagado cancelada desde el panel.");
        }
        await _cliente.InformarOrdenAsync(
            orden.Id, "HECHA",
            habia
                ? "La cuenta atrás de apagado se canceló."
                : "No había cuenta atrás en curso.").ConfigureAwait(false);
    }

    /// <summary>¿Hay una cuenta atrás de apagado corriendo ahora?</summary>
    private bool ApagadoEnCurso()
    {
        lock (_lockApagado) return _apagadoEnCurso;
    }

    /// <summary>¿Hay algo que cancelar (cuenta corriendo o causantes anotados)?</summary>
    private bool HayApagadoQueCancelar()
    {
        lock (_lockApagado) return _apagadoEnCurso || _apagadoCausantes.Count > 0;
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
