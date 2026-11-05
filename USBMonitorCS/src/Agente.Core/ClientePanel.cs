// -*- coding: utf-8 -*-
// Cliente del panel, espejo de USBMonitor/nucleo/api.py y del
// contrato auditado (CONTRATO-SERVIDOR.md). Los eventos van con
// cola persistente: sin red se guardan en disco y se suben en orden
// al volver la conexión. El resto de llamadas son directas y
// devuelven null/false ante cualquier fallo, para que quien llama
// decida. NINGÚN método lanza por un fallo de red.
using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace USBMonitor.Agente.Core;

/// <summary>Cliente HTTP del panel con salud de la conexión registrada.</summary>
public sealed class ClientePanel : IDisposable
{
    private const int MaxCola = 2000;

    private static readonly Registrador Log = Registro.Obtener("api");
    private static readonly JsonSerializerOptions JsonOpciones = new();

    private readonly Configuracion _config;
    private readonly HttpClient _http;
    private readonly string _archivoCola;

    private readonly object _cerrojoCola = new();
    private readonly List<EventoUsb> _cola;

    private readonly object _cerrojoSalud = new();
    private int _saludOk;
    private int _saludFallos;
    private DateTime? _ultimoExito;
    private DateTime? _ultimoFallo;
    private string _detalleUltimoExito = "";
    private string _detalleUltimoFallo = "";
    private UltimaLlamadaInfo _ultimaLlamada = new();

    public ClientePanel(
        Configuracion config,
        HttpMessageHandler? manejador = null,
        string? directorioDatos = null)
    {
        _config = config;
        manejador ??= new SocketsHttpHandler
        {
            ConnectTimeout = TimeSpan.FromSeconds(4),
        };
        _http = new HttpClient(manejador)
        {
            Timeout = TimeSpan.FromSeconds(8),
        };
        var datos = directorioDatos ?? Registro.DirectorioDatos;
        _archivoCola = Path.Combine(datos, "cola_eventos.json");
        _cola = LeerCola();
        // Diagnóstico de la credencial: nunca el token, solo su
        // huella SHA-256 (la misma que el panel guarda en la BD),
        // para poder comparar de un vistazo si el panel rechaza.
        var token = _config.TokenAgente;
        if (token is null)
        {
            Log.Info("Credencial del equipo: AUSENTE (sin token legible en server.json).");
        }
        else
        {
            var huella = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(token)))[..12].ToLowerInvariant();
            Log.Info($"Credencial del equipo: presente (largo {token.Length}, huella sha256 {huella}…).");
        }
    }

    public void Dispose() => _http.Dispose();

    // ── salud de la conexión ─────────────────────────────────────

    private void RegistrarLlamada(string metodo, string ruta, bool ok, string detalle, double ms)
    {
        var ahora = DateTime.Now;
        lock (_cerrojoSalud)
        {
            if (ok)
            {
                _saludOk++;
                _ultimoExito = ahora;
                _detalleUltimoExito = detalle;
            }
            else
            {
                _saludFallos++;
                _ultimoFallo = ahora;
                _detalleUltimoFallo = detalle;
            }
            _ultimaLlamada = new UltimaLlamadaInfo
            {
                Metodo = metodo,
                Ruta = ruta,
                Ok = ok,
                Detalle = detalle,
                Ms = Math.Round(ms, 1),
                Cuando = ahora.ToString("yyyy-MM-ddTHH:mm:ss"),
            };
        }
    }

    /// <summary>Foto de la conexión con el panel (espejo de salud() en Python).</summary>
    public SaludConexion Salud()
    {
        lock (_cerrojoSalud)
        {
            return new SaludConexion
            {
                UrlBase = _config.UrlBase,
                Pc = Configuracion.NombrePc,
                Ok = _saludOk,
                Fallos = _saludFallos,
                UltimoExito = _ultimoExito?.ToString("yyyy-MM-ddTHH:mm:ss"),
                UltimoFallo = _ultimoFallo?.ToString("yyyy-MM-ddTHH:mm:ss"),
                DetalleUltimoExito = _detalleUltimoExito,
                DetalleUltimoFallo = _detalleUltimoFallo,
                UltimaLlamada = _ultimaLlamada,
            };
        }
    }

    // ── transporte ───────────────────────────────────────────────

    private sealed record RespuestaHttp(int Estado, string Cuerpo);

    private async Task<RespuestaHttp?> PeticionAsync(
        string metodo, string ruta, object? cuerpo = null)
    {
        var url = _config.UrlBase + ruta;
        using var solicitud = new HttpRequestMessage(new HttpMethod(metodo), url);
        foreach (var (clave, valor) in _config.CabecerasAuth())
            solicitud.Headers.TryAddWithoutValidation(clave, valor);
        if (cuerpo is not null)
        {
            solicitud.Content = new StringContent(
                JsonSerializer.Serialize(cuerpo, JsonOpciones), Encoding.UTF8, "application/json");
        }
        var reloj = Stopwatch.StartNew();
        try
        {
            using var respuesta = await _http.SendAsync(solicitud).ConfigureAwait(false);
            var texto = await respuesta.Content.ReadAsStringAsync().ConfigureAwait(false);
            reloj.Stop();
            var estado = (int)respuesta.StatusCode;
            var ok = estado is >= 200 and < 300;
            RegistrarLlamada(metodo, ruta, ok, $"HTTP {estado}", reloj.Elapsed.TotalMilliseconds);
            if (ok)
                Log.Debug($"{metodo} {ruta} -> HTTP {estado} en {reloj.ElapsedMilliseconds} ms");
            else
                Log.Advertencia($"{metodo} {ruta} -> HTTP {estado} en {reloj.ElapsedMilliseconds} ms");
            return new RespuestaHttp(estado, texto);
        }
        catch (Exception exc)
        {
            reloj.Stop();
            var detalle = $"sin respuesta: {exc.Message}";
            RegistrarLlamada(metodo, ruta, false, detalle, reloj.Elapsed.TotalMilliseconds);
            Log.Advertencia($"{metodo} {ruta} sin respuesta ({reloj.ElapsedMilliseconds} ms): {exc.Message}");
            return null;
        }
    }

    private static T? IntentarJson<T>(RespuestaHttp? respuesta) where T : class
    {
        if (respuesta is null)
            return null;
        try
        {
            return JsonSerializer.Deserialize<T>(respuesta.Cuerpo, JsonOpciones);
        }
        catch
        {
            return null;
        }
    }

    private static string Consulta(params (string Clave, string? Valor)[] parametros)
    {
        var partes = parametros
            .Where(p => p.Valor is not null)
            .Select(p => $"{Uri.EscapeDataString(p.Clave)}={Uri.EscapeDataString(p.Valor!)}");
        var texto = string.Join("&", partes);
        return texto.Length > 0 ? "?" + texto : "";
    }

    // ── prueba de conexión (botón «Probar conexión») ─────────────

    /// <summary>
    /// Diagnóstico paso a paso de la conexión con el panel. Cada
    /// paso devuelve {Paso, Ok, Detalle, Ms} y ninguno lanza.
    /// </summary>
    public async Task<List<PasoPruebaConexion>> ProbarConexionAsync()
    {
        var pasos = new List<PasoPruebaConexion>();

        void Registrar(string nombre, Stopwatch reloj, bool ok, string detalle)
        {
            reloj.Stop();
            pasos.Add(new PasoPruebaConexion(
                nombre, ok, detalle, Math.Round(reloj.Elapsed.TotalMilliseconds, 1)));
        }

        var baseUri = new Uri(_config.UrlBase);
        var host = baseUri.Host;
        var puerto = baseUri.Port;

        // 1. Resolución del host.
        var reloj = Stopwatch.StartNew();
        try
        {
            var direcciones = await Dns.GetHostAddressesAsync(host).ConfigureAwait(false);
            var ip = direcciones.FirstOrDefault()?.ToString() ?? "sin direcciones";
            Registrar("Resolución del host", reloj, true, $"{host} → {ip}");
        }
        catch (Exception exc)
        {
            Registrar("Resolución del host", reloj, false, $"{host} no resuelve: {exc.Message}");
        }

        // 2. Puerto TCP.
        reloj = Stopwatch.StartNew();
        try
        {
            using var tcp = new TcpClient();
            using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await tcp.ConnectAsync(host, puerto, limite.Token).ConfigureAwait(false);
            Registrar("Puerto TCP", reloj, true, $"{host}:{puerto} acepta conexiones");
        }
        catch (Exception exc)
        {
            Registrar("Puerto TCP", reloj, false, $"{host}:{puerto} no acepta conexiones: {exc.Message}");
        }

        // 3. HTTP del panel.
        reloj = Stopwatch.StartNew();
        try
        {
            var respuesta = await PeticionAsync(
                "GET", "/api/agent/ping" + Consulta(
                    ("pcName", Configuracion.NombrePc),
                    ("version", VersionAgente)))
                .ConfigureAwait(false);
            if (respuesta is null)
            {
                Registrar("HTTP del panel", reloj, false,
                    "sin respuesta del panel (red caída o servidor parado)");
            }
            else if (respuesta.Estado == 404)
            {
                Registrar("HTTP del panel", reloj, false,
                    "el panel respondió 404: falta desplegar /api/agent/ping");
            }
            else if (respuesta.Estado == 200)
            {
                var datos = IntentarJson<RespuestaPing>(respuesta);
                if (datos is { Ok: true })
                    Registrar("HTTP del panel", reloj, true, "el panel respondió {ok: true}");
                else
                    Registrar("HTTP del panel", reloj, false,
                        "el panel respondió 200 pero sin {ok: true}");
            }
            else
            {
                Registrar("HTTP del panel", reloj, false,
                    $"el panel respondió HTTP {respuesta.Estado}");
            }
        }
        catch (Exception exc)
        {
            Registrar("HTTP del panel", reloj, false, $"error inesperado: {exc.Message}");
        }

        // 4. Credencial y ajustes.
        reloj = Stopwatch.StartNew();
        try
        {
            var respuesta = await PeticionAsync("GET", "/api/agent/config").ConfigureAwait(false);
            if (respuesta is null)
            {
                Registrar("Credencial y ajustes", reloj, false,
                    "sin respuesta del panel (red caída o servidor parado)");
            }
            else if (respuesta.Estado == 200)
            {
                Registrar("Credencial y ajustes", reloj, true,
                    "token aceptado: ajustes recibidos");
            }
            else if (respuesta.Estado == 401)
            {
                Registrar("Credencial y ajustes", reloj, false,
                    "credencial rechazada (401): revisa el token del equipo");
            }
            else
            {
                Registrar("Credencial y ajustes", reloj, false,
                    $"el panel respondió HTTP {respuesta.Estado}");
            }
        }
        catch (Exception exc)
        {
            Registrar("Credencial y ajustes", reloj, false, $"error inesperado: {exc.Message}");
        }
        return pasos;
    }

    /// <summary>
    /// Versión de este agente (la del ejecutable que corre, p. ej.
    /// «1.0.3»): se lee del ensamblado de entrada, que en el servicio
    /// y en el compañero es el propio USBMonitorService.exe.
    /// </summary>
    public static string VersionAgente { get; } = ObtenerVersionAgente();

    private static string ObtenerVersionAgente()
    {
        try
        {
            var ensamblado = System.Reflection.Assembly.GetEntryAssembly()
                             ?? typeof(ClientePanel).Assembly;
            var cruda = ensamblado
                            .GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>()
                            ?.InformationalVersion
                        ?? ensamblado.GetName().Version?.ToString()
                        ?? "desconocida";
            // La versión informativa puede traer «+<commit>» detrás.
            return cruda.Split('+')[0];
        }
        catch
        {
            return "desconocida";
        }
    }

    /// <summary>Señal de vida: GET /api/agent/ping (renueva lastSeen en el panel).</summary>
    public async Task<bool> PingAsync()
    {
        var respuesta = await PeticionAsync(
            "GET", "/api/agent/ping" + Consulta(
                ("pcName", Configuracion.NombrePc),
                ("version", VersionAgente)))
            .ConfigureAwait(false);
        var datos = IntentarJson<RespuestaPing>(respuesta);
        return respuesta is { Estado: 200 } && datos is { Ok: true };
    }

    // ── cola de eventos (store-and-forward) ──────────────────────

    private List<EventoUsb> LeerCola()
    {
        var datos = ArchivoJson.Leer<List<EventoUsb>>(_archivoCola);
        if (datos is null)
            return new List<EventoUsb>();
        return datos.Count > MaxCola ? datos[^MaxCola..] : datos;
    }

    private void PersistirCola()
    {
        // Con _cerrojoCola tomado.
        try
        {
            ArchivoJson.EscribirAtomico(_archivoCola, _cola);
        }
        catch (Exception exc)
        {
            Log.Error($"No se pudo persistir la cola: {exc.Message}");
        }
    }

    public void EncolarEvento(EventoUsb payload)
    {
        lock (_cerrojoCola)
        {
            _cola.Add(payload);
            while (_cola.Count > MaxCola)
                _cola.RemoveAt(0);
            PersistirCola();
        }
    }

    public int EventosEnCola
    {
        get { lock (_cerrojoCola) { return _cola.Count; } }
    }

    /// <summary>
    /// Sube los eventos en orden FIFO. Devuelve cuántos salieron.
    /// Un evento solo sale de la cola cuando el servidor responde
    /// 2xx: si la red cae a mitad, el resto espera al próximo ciclo
    /// y el orden se conserva.
    /// </summary>
    public async Task<int> VaciarColaAsync()
    {
        var enviados = 0;
        while (true)
        {
            EventoUsb? siguiente;
            lock (_cerrojoCola)
            {
                if (_cola.Count == 0)
                    return enviados;
                siguiente = _cola[0];
            }
            var respuesta = await PeticionAsync("POST", "/api/usb-event", siguiente)
                .ConfigureAwait(false);
            if (respuesta is null || respuesta.Estado is < 200 or >= 300)
                return enviados;
            lock (_cerrojoCola)
            {
                if (_cola.Count > 0 && ReferenceEquals(_cola[0], siguiente))
                    _cola.RemoveAt(0);
                else
                    _cola.Remove(siguiente);
                PersistirCola();
            }
            enviados++;
        }
    }

    // ── eventos ──────────────────────────────────────────────────

    public void Evento(
        string tipo,
        string? letra = null,
        string? serial = null,
        string? soloLectura = null,
        bool? enWhitelist = null)
    {
        EncolarEvento(new EventoUsb
        {
            PcName = Configuracion.NombrePc,
            PcIp = _config.IpPc,
            PcUser = Configuracion.UsuarioInteractivo,
            Tipo = tipo,
            DriveLetter = letra,
            SerialNumber = serial,
            ReadonlyStatus = soloLectura,
            Whitelisted = enWhitelist,
        });
    }

    // ── bloqueos en el panel ─────────────────────────────────────

    /// <summary>Registra un bloqueo; devuelve su id en el panel o null.</summary>
    public async Task<string?> RegistrarBloqueoAsync(
        string? letra, string? serial, string? etiqueta, bool enWhitelist)
    {
        var respuesta = await PeticionAsync("POST", "/api/usb-event/pending-unlock", new SolicitudBloqueo
        {
            PcName = Configuracion.NombrePc,
            DriveLetter = letra,
            SerialNumber = serial,
            DeviceLabel = etiqueta,
            Whitelisted = enWhitelist,
        }).ConfigureAwait(false);
        var datos = IntentarJson<RespuestaRegistroBloqueo>(respuesta);
        return datos is { Ok: true } ? datos.Id : null;
    }

    /// <summary>
    /// Sube la foto del momento de un bloqueo (POST
    /// /api/usb-event/evidence). True solo si el panel la guardó:
    /// ante cualquier fallo (sin red, bloqueo aún no registrado),
    /// el paquete se queda en disco y se reintenta en otro ciclo.
    /// </summary>
    public async Task<bool> SubirEvidenciaAsync(
        string pendingUnlockId, PaqueteEvidencia paquete)
    {
        var respuesta = await PeticionAsync("POST", "/api/usb-event/evidence",
            new SolicitudEvidenciaPanel
            {
                PendingUnlockId = pendingUnlockId,
                SerialNumber = paquete.Serial,
                CapturedAt = paquete.CapturedAt,
                ForegroundProcess = paquete.ForegroundProcess,
                ForegroundTitle = paquete.ForegroundTitle,
                Processes = paquete.Processes,
                BrowserTabs = paquete.BrowserTabs,
                TabsComplete = paquete.TabsComplete,
                Nota = paquete.Nota,
                ImagenBase64 = paquete.ImagenBase64,
            }).ConfigureAwait(false);
        return respuesta is { Estado: 200 } &&
               IntentarJson<RespuestaBasica>(respuesta) is { Ok: true };
    }

    public async Task<bool> CerrarBloqueoAsync(string? letra, string? serial)
    {
        var respuesta = await PeticionAsync("POST", "/api/usb-event/pending-close", new SolicitudCierre
        {
            PcName = Configuracion.NombrePc,
            DriveLetter = letra,
            SerialNumber = serial,
        }).ConfigureAwait(false);
        return IntentarJson<RespuestaBasica>(respuesta) is { Ok: true };
    }

    /// <summary>Bloqueos ya autorizados esperando ejecución (reclamados).</summary>
    public async Task<List<PendienteDesbloqueo>> SondearDesbloqueosAsync()
    {
        var ruta = "/api/usb-unlock/status" + Consulta(
            ("pcName", Configuracion.NombrePc), ("check", "true"));
        var respuesta = await PeticionAsync("GET", ruta).ConfigureAwait(false);
        var datos = IntentarJson<RespuestaSondeo>(respuesta);
        return datos is { Ok: true } ? datos.Pendings ?? new List<PendienteDesbloqueo>()
                                     : new List<PendienteDesbloqueo>();
    }

    // ── consultas ────────────────────────────────────────────────

    /// <summary>True/False según el servidor; null si no se pudo preguntar.</summary>
    public async Task<bool?> ComprobarWhitelistAsync(string serial)
    {
        var ruta = "/api/whitelist/check" + Consulta(("serial", serial));
        var respuesta = await PeticionAsync("GET", ruta).ConfigureAwait(false);
        var datos = IntentarJson<RespuestaWhitelist>(respuesta);
        return datos is { Ok: true } ? datos.Allowed : null;
    }

    public async Task<bool> EstadoConectadosAsync(List<UnidadConectada> unidades)
    {
        var respuesta = await PeticionAsync("POST", "/api/usb-event/connected-status",
            new SolicitudEstadoConectados
            {
                PcName = Configuracion.NombrePc,
                ConnectedDrives = unidades,
            }).ConfigureAwait(false);
        return IntentarJson<RespuestaBasica>(respuesta) is { Ok: true };
    }

    public async Task<ConfigRemota?> ConfigRemotaAsync()
    {
        var respuesta = await PeticionAsync("GET", "/api/agent/config").ConfigureAwait(false);
        var datos = IntentarJson<ConfigRemota>(respuesta);
        return datos is { Ok: true } ? datos : null;
    }

    // ── canal de órdenes: actualización a través del agente ────

    /// <summary>
    /// Manifiesto del paquete que el panel tenga para actualizar
    /// (versión y SHA-256 del exe). Null si el panel no tiene
    /// paquete (404) o no responde.
    /// </summary>
    public async Task<ManifiestoPaquete?> ManifiestoPaqueteAsync()
    {
        var respuesta = await PeticionAsync("GET", "/api/agent/paquete/manifiesto")
            .ConfigureAwait(false);
        var datos = IntentarJson<ManifiestoPaquete>(respuesta);
        return datos is { Ok: true } ? datos : null;
    }

    /// <summary>
    /// Informa al panel del avance de una orden (POST
    /// /api/agent/comandos/:id). True si el panel lo aceptó.
    /// </summary>
    public async Task<bool> InformarOrdenAsync(
        string id, string estado, string? detalle = null, string? versionObjetivo = null)
    {
        var respuesta = await PeticionAsync(
            "POST", $"/api/agent/comandos/{Uri.EscapeDataString(id)}",
            new SolicitudInformeOrden
            {
                Estado = estado,
                Detalle = detalle,
                VersionObjetivo = versionObjetivo,
            }).ConfigureAwait(false);
        return respuesta is { Estado: 200 } &&
               IntentarJson<RespuestaBasica>(respuesta) is { Ok: true };
    }

    /// <summary>
    /// Descarga el exe del paquete a la ruta dada, en flujo (son
    /// ~140 MB: cliente propio con un límite generoso, el general
    /// de 8 s no sirve aquí). False ante cualquier fallo; el
    /// archivo parcial se borra para que un hash nunca se calcule
    /// sobre una descarga a medias creyéndola completa (el tamaño
    /// y el hash se verifican después igualmente).
    /// </summary>
    public async Task<bool> DescargarPaqueteAsync(string rutaDestino)
    {
        try
        {
            var carpeta = Path.GetDirectoryName(rutaDestino);
            if (!string.IsNullOrEmpty(carpeta))
                Directory.CreateDirectory(carpeta);
            using var http = new HttpClient(
                new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromSeconds(4) })
            {
                Timeout = TimeSpan.FromMinutes(15),
            };
            using var solicitud = new HttpRequestMessage(
                HttpMethod.Get, _config.UrlBase + "/api/agent/paquete");
            foreach (var (clave, valor) in _config.CabecerasAuth())
                solicitud.Headers.TryAddWithoutValidation(clave, valor);
            using var respuesta = await http
                .SendAsync(solicitud, HttpCompletionOption.ResponseHeadersRead)
                .ConfigureAwait(false);
            if (!respuesta.IsSuccessStatusCode)
            {
                Log.Error($"Descarga del paquete: el panel respondió {(int)respuesta.StatusCode}.");
                return false;
            }
            await using var origen = await respuesta.Content
                .ReadAsStreamAsync().ConfigureAwait(false);
            await using var destino = new FileStream(
                rutaDestino, FileMode.Create, FileAccess.Write, FileShare.None);
            await origen.CopyToAsync(destino).ConfigureAwait(false);
            return true;
        }
        catch (Exception exc)
        {
            Log.Error($"Descarga del paquete: {exc.Message}");
            try { if (File.Exists(rutaDestino)) File.Delete(rutaDestino); }
            catch { /* la limpieza no tapa el fallo original */ }
            return false;
        }
    }

    public async Task<HashDuenoRespuesta?> HashDuenoAsync()
    {
        var ruta = "/api/agent/owner-hash" + Consulta(("pcName", Configuracion.NombrePc));
        var respuesta = await PeticionAsync("GET", ruta).ConfigureAwait(false);
        var datos = IntentarJson<HashDuenoRespuesta>(respuesta);
        return datos is { Ok: true } ? datos : null;
    }

    /// <summary>
    /// Identidad pública del equipo (GET /api/agent/owner): dueño
    /// asignado y modo de desbloqueo, sin ninguna credencial. La
    /// usan la caja de herramientas y el compañero para decir de
    /// quién es la contraseña que vale en esta PC, o avisar de que
    /// no hay dueño asignado. Nunca lanza.
    /// </summary>
    public async Task<ResultadoDueno> DuenoEquipoAsync()
    {
        var ruta = "/api/agent/owner" + Consulta(("pcName", Configuracion.NombrePc));
        var respuesta = await PeticionAsync("GET", ruta).ConfigureAwait(false);
        if (respuesta is null)
        {
            return new ResultadoDueno(0, null);
        }
        var datos = IntentarJson<DuenoEquipoRespuesta>(respuesta);
        return new ResultadoDueno(
            respuesta.Estado,
            datos is { Ok: true } ? datos : null);
    }

    public async Task<bool> SubirIntentosOfflineAsync(List<IntentoOffline> intentos)
    {
        if (intentos.Count == 0)
            return true;
        var respuesta = await PeticionAsync("POST", "/api/agent/offline-attempts",
            new SolicitudIntentos
            {
                PcName = Configuracion.NombrePc,
                Attempts = intentos,
            }).ConfigureAwait(false);
        return IntentarJson<RespuestaBasica>(respuesta) is { Ok: true };
    }

    // ── desbloqueo (lo usa el compañero) ─────────────────────────

    /// <summary>
    /// Respuesta cruda de /api/usb-auth para la ventana: 200 si
    /// autoriza, 403 con mensaje (fuera de la whitelist o desbloqueo
    /// desactivado) y 401 genérico para credenciales o propiedad no
    /// válidas.
    /// </summary>
    public async Task<ResultadoAutenticacion> AutenticarDesbloqueoAsync(
        string usuario, string contrasena, string? letra, string? serial)
    {
        var respuesta = await PeticionAsync("POST", "/api/usb-auth", new SolicitudAuth
        {
            Username = usuario,
            Password = contrasena,
            PcName = Configuracion.NombrePc,
            DriveLetter = letra,
            SerialNumber = serial,
        }).ConfigureAwait(false);
        if (respuesta is null)
        {
            return new ResultadoAutenticacion(0, false, "Sin conexión con el servidor.");
        }
        var datos = IntentarJson<RespuestaAuth>(respuesta);
        return new ResultadoAutenticacion(
            respuesta.Estado,
            datos?.Authorized ?? false,
            datos?.Message ?? "");
    }
}
