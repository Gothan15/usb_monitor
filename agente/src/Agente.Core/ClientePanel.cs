// -*- coding: utf-8 -*-
// Cliente del panel, espejo del api.py del agente original en
// Python (retirado) y del contrato auditado (CONTRATO-SERVIDOR.md). Los eventos van con
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
    private IdentidadAgente? _identidad;
    private bool _identidadResuelta;

    /// <summary>
    /// La identidad por clave de este equipo (se crea la primera
    /// vez que hace falta: enrolar, migrar o firmar). Null si no
    /// se pudo ni leer ni crear.
    /// </summary>
    public IdentidadAgente? Identidad
    {
        get
        {
            if (!_identidadResuelta)
            {
                _identidadResuelta = true;
                _identidad = IdentidadAgente.ObtenerOCrear(_config);
            }
            return _identidad;
        }
    }

    /// <summary>
    /// Acredita una petición: firmada con la clave del equipo si
    /// ya hay identidad registrada en el panel; si aún no, con el
    /// token antiguo (puente de migración: solo lo aceptan las
    /// rutas de auto-actualización y la de migración); si no hay
    /// nada, la petición sale desnuda (el enrolamiento).
    /// </summary>
    private void AplicarCredencial(
        HttpRequestMessage solicitud, string metodo, string ruta, byte[] cuerpo)
    {
        var identidad = Identidad;
        var equipoId = _config.EquipoId;
        if (identidad is not null && equipoId is not null)
        {
            var marca = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var nonce = IdentidadAgente.NuevoNonce();
            var firma = identidad.Firmar(metodo, ruta, marca, nonce, cuerpo);
            solicitud.Headers.TryAddWithoutValidation("X-Agente-Id", equipoId);
            solicitud.Headers.TryAddWithoutValidation("X-Agente-Ts", marca);
            solicitud.Headers.TryAddWithoutValidation("X-Agente-Nonce", nonce);
            solicitud.Headers.TryAddWithoutValidation("X-Agente-Firma", firma);
            return;
        }
        var token = _config.TokenLegado;
        if (token is not null)
        {
            solicitud.Headers.TryAddWithoutValidation(
                "Authorization", $"AgentToken {token}");
        }
    }
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
        // Diagnóstico de la credencial (nunca la clave privada):
        // con qué se acredita este equipo al arrancar.
        if (_config.TieneClave)
        {
            Log.Info($"Credencial del equipo: clave registrada (huella {Identidad?.Huella[..12]}…).");
        }
        else if (_config.TokenLegado is not null)
        {
            Log.Info("Credencial del equipo: token antiguo pendiente de migrar a clave.");
        }
        else if (_config.CodigoEnrolamiento is not null)
        {
            Log.Info("Credencial del equipo: código de enrolamiento pendiente de gastar.");
        }
        else
        {
            Log.Info("Credencial del equipo: AUSENTE (sin clave, sin código, sin token antiguo).");
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
        var cuerpoBytes = cuerpo is null
            ? Array.Empty<byte>()
            : JsonSerializer.SerializeToUtf8Bytes(cuerpo, JsonOpciones);
        AplicarCredencial(solicitud, metodo, ruta, cuerpoBytes);
        if (cuerpo is not null)
        {
            var contenido = new ByteArrayContent(cuerpoBytes);
            contenido.Headers.ContentType =
                new System.Net.Http.Headers.MediaTypeHeaderValue("application/json")
                {
                    CharSet = "utf-8",
                };
            solicitud.Content = contenido;
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
                // Solo los 401/403 (la credencial no vale) merecen
                // advertencia: son raros y hay que verlos. El resto
                // de respuestas de error baja a depuración para no
                // llenar el registro cuando el panel está caído y
                // cada sondeo repetiría la misma línea.
                if (estado is 401 or 403)
                    Log.Advertencia($"{metodo} {ruta} -> HTTP {estado} en {reloj.ElapsedMilliseconds} ms");
                else
                    Log.Debug($"{metodo} {ruta} -> HTTP {estado} en {reloj.ElapsedMilliseconds} ms");
            return new RespuestaHttp(estado, texto);
        }
        catch (Exception exc)
        {
            reloj.Stop();
            var detalle = $"sin respuesta: {exc.Message}";
            RegistrarLlamada(metodo, ruta, false, detalle, reloj.Elapsed.TotalMilliseconds);
            // Sin respuesta: depuración. El trabajador ya deja
            // constancia del primer fallo de latido y de la
            // recuperación; repetirla por cada petición llenaría
            // el registro durante cualquier caída del panel.
            Log.Debug($"{metodo} {ruta} sin respuesta ({reloj.ElapsedMilliseconds} ms): {exc.Message}");
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

    /// <summary>
    /// Enrolamiento con código de UN SOLO USO: presenta el código
    /// y la clave pública de este equipo; el panel la registra y
    /// devuelve el id del equipo, que queda guardado. La privada
    /// no sale de la PC ni aquí: solo viaja la pública.
    /// </summary>
    public async Task<bool> EnrolarConCodigoAsync(string codigo) =>
        (await EnrolarDetalladoAsync(codigo).ConfigureAwait(false)).Ok;

    /// <summary>
    /// El mismo enrolamiento, pero devolviendo la respuesta del
    /// panel SIN resumir: estado HTTP, motivo distinguible del
    /// rechazo y su frase. Es lo que enseñan el asistente y la
    /// prueba paso a paso cuando el panel dice que no — antes
    /// todo eso se perdía en un «no aceptado» genérico.
    /// </summary>
    public async Task<ResultadoEnrolamiento> EnrolarDetalladoAsync(string codigo)
    {
        var identidad = Identidad;
        if (identidad is null)
        {
            return new ResultadoEnrolamiento(false, null, "sin-clave-local",
                "No se pudo ni crear ni leer el par de claves de esta PC.");
        }
        var respuesta = await PeticionAsync("POST", "/api/agent/enroll", new SolicitudEnrolamientoCodigo
        {
            PcName = Configuracion.NombrePc,
            Codigo = codigo.Trim(),
            ClavePublica = identidad.ClavePublicaB64,
            // Todas las IPv4 de esta PC: el código puede estar
            // atado a la IP del empuje (otro adaptador) y la
            // conexión puede llegar al panel con otra de origen.
            Ips = Configuracion.IpsPc,
        }).ConfigureAwait(false);
        if (respuesta is null)
        {
            return new ResultadoEnrolamiento(false, null, "sin-respuesta",
                "El panel no respondió a la petición de enrolamiento.");
        }
        var datos = IntentarJson<RespuestaCredencial>(respuesta);
        if (datos is { Ok: true, EquipoId: { Length: > 0 } })
        {
            _config.GuardarEquipoId(datos.EquipoId);
            Log.Info($"Equipo enrolado con código: el panel registró la clave (huella {identidad.Huella[..12]}…).");
            return new ResultadoEnrolamiento(true, respuesta.Estado, null,
                $"El panel registró la clave de este equipo (huella {identidad.Huella[..12]}…).");
        }
        return new ResultadoEnrolamiento(false, respuesta.Estado, datos?.Motivo,
            datos?.Error ?? $"El panel respondió HTTP {respuesta.Estado} sin más detalle.");
    }

    /// <summary>
    /// Consulta el estado de un código SIN gastarlo (la ruta de
    /// solo lectura del panel): de qué equipo es, si caducó.
    /// Null si el panel no respondió o respondió otra cosa.
    /// </summary>
    private async Task<RespuestaEstadoCodigo?> ConsultarEstadoCodigoAsync(string codigo)
    {
        var respuesta = await PeticionAsync("GET",
            "/api/agent/enroll/estado" + Consulta(
                ("pcName", Configuracion.NombrePc),
                ("codigo", codigo.Trim()),
                // Las mismas IPs declaradas que al enrolar, para
                // que la consulta enseñe lo que el enrolamiento
                // de verdad verá.
                ("ips", string.Join(",", Configuracion.IpsPc)))).ConfigureAwait(false);
        return IntentarJson<RespuestaEstadoCodigo>(respuesta);
    }

    // ── prueba de enrolamiento paso a paso ───────────────────

    /// <summary>
    /// La prueba DETALLADA de conexión y enrolamiento: seis
    /// pasos en orden, cada uno con su veredicto y su frase, y
    /// cada uno escrito también en el registro del agente. Sirve
    /// para destapar el fallo real sin adivinar: si el código no
    /// vale, el paso 3 dice por qué ANTES de gastarlo; si el
    /// enrolamiento falla, el paso 5 enseña la respuesta exacta
    /// del panel; y el paso 6 es la prueba de verdad — una
    /// petición firmada, con la diferencia de relojes medida.
    /// No toca el esquema de credenciales: solo mira y, si el
    /// equipo aún no está enrolado y hay código, enrola.
    /// </summary>
    public async Task<List<PasoDiagnosticoEnrolamiento>> DiagnosticoEnrolamientoAsync(
        string? codigoEscrito)
    {
        var pasos = new List<PasoDiagnosticoEnrolamiento>();

        void Registrar(string nombre, Stopwatch reloj, string estado, string detalle)
        {
            reloj.Stop();
            pasos.Add(new PasoDiagnosticoEnrolamiento(
                nombre, estado, detalle, Math.Round(reloj.Elapsed.TotalMilliseconds, 1)));
            if (estado == "fallo")
                Log.Advertencia($"Diagnóstico de enrolamiento · {nombre}: FALLO — {detalle}");
            else
                Log.Info($"Diagnóstico de enrolamiento · {nombre}: {estado} — {detalle}");
        }

        var baseUri = new Uri(_config.UrlBase);
        var host = baseUri.Host;
        var puerto = baseUri.Port;
        var codigo = !string.IsNullOrWhiteSpace(codigoEscrito)
            ? codigoEscrito.Trim()
            : _config.CodigoEnrolamiento;

        // 1 · Panel alcanzable (TCP).
        var reloj = Stopwatch.StartNew();
        var tcpOk = false;
        try
        {
            using var tcp = new TcpClient();
            using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await tcp.ConnectAsync(host, puerto, limite.Token).ConfigureAwait(false);
            tcpOk = true;
            Registrar("1. Panel alcanzable", reloj, "ok",
                $"{host}:{puerto} acepta conexiones.");
        }
        catch (Exception exc)
        {
            Registrar("1. Panel alcanzable", reloj, "fallo",
                $"{host}:{puerto} no acepta conexiones: {exc.Message} " +
                "Revisa que el panel esté arrancado y que esta PC lo vea por red.");
        }

        // 2 · El que responde es el panel (una ruta suya, sin
        // credencial: el panel contesta 401 con su formato; un
        // servidor ajeno contestaría otra cosa).
        reloj = Stopwatch.StartNew();
        if (!tcpOk)
        {
            Registrar("2. Es el panel", reloj, "omitido",
                "Sin conexión TCP no hay nada que identificar.");
        }
        else
        {
            try
            {
                using var solicitud = new HttpRequestMessage(
                    HttpMethod.Get, _config.UrlBase + "/api/auth/session");
                using var respuesta = await _http.SendAsync(solicitud).ConfigureAwait(false);
                var cuerpo = await respuesta.Content.ReadAsStringAsync().ConfigureAwait(false);
                var estado = (int)respuesta.StatusCode;
                if ((estado is 200 or 401 or 403) && cuerpo.Contains("\"ok\""))
                {
                    Registrar("2. Es el panel", reloj, "ok",
                        $"Lo que responde en {_config.UrlBase} es el panel " +
                        $"(HTTP {estado} en /api/auth/session, con su formato de respuesta).");
                }
                else
                {
                    Registrar("2. Es el panel", reloj, "fallo",
                        $"En {_config.UrlBase} responde algo que no parece el panel: " +
                        $"HTTP {estado} en /api/auth/session. Revisa host y puerto del paso anterior del asistente.");
                }
            }
            catch (Exception exc)
            {
                Registrar("2. Es el panel", reloj, "fallo",
                    $"La comprobación HTTP falló: {exc.Message}");
            }
        }

        // 3 · El código, ANTES de gastarlo (consulta sin gastar).
        reloj = Stopwatch.StartNew();
        if (!tcpOk)
        {
            Registrar("3. Código de enrolamiento", reloj, "omitido",
                "Sin conexión con el panel no se puede consultar el código.");
        }
        else if (_config.EquipoId is not null)
        {
            Registrar("3. Código de enrolamiento", reloj, "omitido",
                "Este equipo ya está enrolado: el código ya no hace falta. " +
                "La prueba de su credencial es el paso 6.");
        }
        else if (codigo is null)
        {
            Registrar("3. Código de enrolamiento", reloj, "fallo",
                "No hay código que comprobar: ni escrito en el campo ni " +
                "pendiente de la instalación. Genera uno en el panel, en " +
                "Equipos → Credencial del equipo, para el nombre EXACTO " +
                $"de esta PC ({Configuracion.NombrePc}).");
        }
        else
        {
            var consulta = await ConsultarEstadoCodigoAsync(codigo).ConfigureAwait(false);
            if (consulta is not { Ok: true })
            {
                Registrar("3. Código de enrolamiento", reloj, "fallo",
                    "El panel no respondió a la consulta de estado del código.");
            }
            else if (consulta.Estado == "vigente")
            {
                Registrar("3. Código de enrolamiento", reloj, "ok",
                    consulta.Detalle ?? "El código es de esta PC y sigue vigente.");
            }
            else
            {
                Registrar("3. Código de enrolamiento", reloj, "fallo",
                    consulta.Detalle ?? $"El código no vale (estado: {consulta.Estado}).");
            }
        }

        // 4 · El par de claves de esta PC (nace aquí; la privada
        // se guarda cifrada con DPAPI y nunca sale).
        reloj = Stopwatch.StartNew();
        try
        {
            var yaEstaba = _config.TieneClave;
            var identidad = Identidad;
            if (identidad?.ClavePublicaB64 is null)
            {
                Registrar("4. Par de claves de esta PC", reloj, "fallo",
                    "No se pudo ni crear ni leer el par de claves de esta PC.");
            }
            else
            {
                Registrar("4. Par de claves de esta PC", reloj, "ok",
                    (yaEstaba
                        ? "Clave presente y legible: el cifrado DPAPI de esta PC la abre bien."
                        : "La clave no existía y se acaba de generar en esta PC, guardada cifrada con DPAPI.") +
                    $" Huella pública: {identidad.Huella[..12]}…");
            }
        }
        catch (Exception exc)
        {
            Registrar("4. Par de claves de esta PC", reloj, "fallo",
                $"El par de claves no se pudo leer: {exc.Message}");
        }

        // 5 · El enrolamiento propiamente dicho, con la
        // respuesta exacta del panel si dice que no.
        reloj = Stopwatch.StartNew();
        if (_config.EquipoId is not null)
        {
            Registrar("5. Enrolamiento", reloj, "omitido",
                $"Este equipo ya tiene id en el panel ({_config.EquipoId}): " +
                "no hay nada que registrar. Su credencial se prueba en el paso 6.");
        }
        else if (codigo is null)
        {
            Registrar("5. Enrolamiento", reloj, "fallo",
                "Sin código no hay enrolamiento: mira el paso 3.");
        }
        else if (!tcpOk)
        {
            Registrar("5. Enrolamiento", reloj, "omitido",
                "Sin conexión con el panel no se puede enrolar.");
        }
        else
        {
            var intento = await EnrolarDetalladoAsync(codigo).ConfigureAwait(false);
            if (intento.Ok)
            {
                // El código era de un solo uso y era para el
                // servicio: si quedó guardado, ya está gastado.
                if (_config.CodigoEnrolamiento is not null)
                    _config.BorrarCodigoEnrolamiento();
                Registrar("5. Enrolamiento", reloj, "ok",
                    intento.Detalle ?? "El panel registró la clave de este equipo.");
            }
            else
            {
                Registrar("5. Enrolamiento", reloj, "fallo",
                    $"El panel respondió HTTP {intento.EstadoHttp?.ToString() ?? "—"}" +
                    (intento.Motivo is not null ? $" (motivo: {intento.Motivo})" : "") +
                    $": {intento.Detalle}");
            }
        }

        // 6 · La prueba de verdad: una petición FIRMADA. Y la
        // diferencia de relojes, medida con la hora que el
        // propio panel devuelve: las firmas se rechazan si la
        // diferencia pasa de 300 segundos.
        reloj = Stopwatch.StartNew();
        if (_config.EquipoId is null)
        {
            Registrar("6. Prueba con firma", reloj, "omitido",
                "Aún no hay id de equipo: sin enrolamiento no se puede firmar.");
        }
        else if (!tcpOk)
        {
            Registrar("6. Prueba con firma", reloj, "omitido",
                "Sin conexión con el panel no se puede probar la firma.");
        }
        else
        {
            var respuesta = await PeticionAsync(
                "GET", "/api/agent/ping" + Consulta(
                    ("pcName", Configuracion.NombrePc),
                    ("version", VersionAgente))).ConfigureAwait(false);
            if (respuesta is null)
            {
                Registrar("6. Prueba con firma", reloj, "fallo",
                    "El panel no respondió a la petición firmada.");
            }
            else
            {
                var datos = IntentarJson<RespuestaPing>(respuesta);
                string diferencia = "";
                if (datos?.ServerTime is not null &&
                    DateTimeOffset.TryParse(datos.ServerTime, out var horaPanel))
                {
                    var segundos = Math.Abs(
                        (DateTimeOffset.UtcNow - horaPanel).TotalSeconds);
                    diferencia =
                        $" Hora del panel: {horaPanel:HH:mm:ss} UTC; diferencia con " +
                        $"el reloj de esta PC: {segundos:0} s" +
                        (segundos > 240
                            ? " (peligrosa: a los 300 s las firmas dejan de valer; ajusta el reloj de esta PC)."
                            : ".");
                }
                if (respuesta.Estado == 200 && datos is { Ok: true })
                {
                    Registrar("6. Prueba con firma", reloj, "ok",
                        "El panel ACEPTA la firma de este equipo: queda enrolado de verdad." +
                        diferencia);
                }
                else
                {
                    Registrar("6. Prueba con firma", reloj, "fallo",
                        $"El panel RECHAZA la firma (HTTP {respuesta.Estado}): la credencial " +
                        "pudo ser revocada, la clave registrada en el panel no es esta, o el " +
                        "reloj de esta PC va desviado." + diferencia);
                }
            }
        }

        return pasos;
    }

    /// <summary>
    /// Migración del token antiguo a la clave: presenta el token
    /// por última vez (lo pone AplicarCredencial en la cabecera)
    /// y registra la pública. Si el panel la acepta, el token se
    /// borra de server.json y este equipo ya solo firma.
    /// </summary>
    public async Task<bool> MigrarCredencialAsync()
    {
        var identidad = Identidad;
        if (identidad is null) return false;
        if (_config.TokenLegado is null) return false;
        var respuesta = await PeticionAsync("POST", "/api/agent/migrar-credencial", new SolicitudMigracion
        {
            ClavePublica = identidad.ClavePublicaB64,
        }).ConfigureAwait(false);
        var datos = IntentarJson<RespuestaCredencial>(respuesta);
        if (datos is { Ok: true, EquipoId: { Length: > 0 } })
        {
            _config.GuardarEquipoId(datos.EquipoId);
            _config.BorrarTokenLegado();
            Log.Info("Credencial migrada: el token antiguo se borró y el equipo ya firma con su clave.");
            return true;
        }
        return false;
    }

    /// <summary>Resultado de comprobar la credencial contra el panel.</summary>
    public enum ResultadoPruebaCredencial
    {
        /// <summary>El panel aceptó una petición firmada: enrolado de verdad.</summary>
        Verificada,
        /// <summary>El panel respondió 401/403: la firma no vale (¿revocada?).</summary>
        Rechazada,
        /// <summary>El panel no respondió: no se puede concluir nada.</summary>
        SinRespuesta,
        /// <summary>Este equipo aún no tiene clave registrada que probar.</summary>
        NoAplica,
    }

    /// <summary>
    /// Comprueba la credencial de este equipo CONTRA el panel:
    /// hace una petición firmada ligera y mira la respuesta. Es el
    /// «¿estoy enrolado de verdad?» que enseña la caja de
    /// herramientas: tener la clave en disco no basta si el panel
    /// no la acepta (revocada, registrada otra, panel sin migrar).
    /// </summary>
    public async Task<ResultadoPruebaCredencial> ProbarCredencialAsync()
    {
        if (!_config.TieneClave || _config.EquipoId is null)
            return ResultadoPruebaCredencial.NoAplica;
        var respuesta = await PeticionAsync("GET", "/api/agent/actualizacion")
            .ConfigureAwait(false);
        if (respuesta is null) return ResultadoPruebaCredencial.SinRespuesta;
        return respuesta.Estado switch
        {
            200 => ResultadoPruebaCredencial.Verificada,
            401 or 403 => ResultadoPruebaCredencial.Rechazada,
            _ => ResultadoPruebaCredencial.SinRespuesta,
        };
    }

    /// <summary>
    /// Consulta de actualización para la caja de herramientas:
    /// qué corre este equipo y qué ofrece el panel. Null si el
    /// panel no responde.
    /// </summary>
    public async Task<RespuestaActualizacion?> ConsultarActualizacionAsync()
    {
        var respuesta = await PeticionAsync("GET", "/api/agent/actualizacion")
            .ConfigureAwait(false);
        return IntentarJson<RespuestaActualizacion>(respuesta);
    }

    /// <summary>
    /// Pide la actualización propia: el panel deja la orden en
    /// espera y el servicio la recoge en su siguiente llamada de
    /// configuración y se actualiza solo por el canal de siempre.
    /// </summary>
    public async Task<RespuestaActualizacion?> SolicitarActualizacionAsync()
    {
        var respuesta = await PeticionAsync("POST", "/api/agent/actualizacion")
            .ConfigureAwait(false);
        return IntentarJson<RespuestaActualizacion>(respuesta);
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
            AplicarCredencial(solicitud, "GET", "/api/agent/paquete", Array.Empty<byte>());
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
