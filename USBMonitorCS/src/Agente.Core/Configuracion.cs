// -*- coding: utf-8 -*-
// Configuración del agente: vive SOLO en server.json (junto al
// ejecutable o en la carpeta de datos), espejo de
// USBMonitor/nucleo/config.py. Claves: serverHost, serverPort,
// serverScheme, agentToken, sslCert, sslVerify. La credencial es
// solo el token del equipo; un valor cifrado ilegible se descarta
// (fail-closed), nunca se usa como credencial.
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace USBMonitor.Agente.Core;

/// <summary>Lee y escribe server.json con caché por (ruta, mtime).</summary>
public sealed class Configuracion
{
    private const string HostPorDefecto = "localhost";
    private const int PuertoPorDefecto = 3000;

    private static readonly Registrador Log = Registro.Obtener("config");

    private readonly string _directorioApp;
    private readonly string _directorioDatos;
    private readonly object _cerrojo = new();
    private string? _rutaCache;
    private DateTime _mtimeCache;
    private Dictionary<string, JsonElement> _datosCache = new();

    public Configuracion(string? directorioApp = null, string? directorioDatos = null)
    {
        _directorioApp = directorioApp ?? AppContext.BaseDirectory;
        _directorioDatos = directorioDatos ?? Registro.DirectorioDatos;
    }

    public string DirectorioApp => _directorioApp;

    private IEnumerable<string> RutasCandidatas()
    {
        yield return Path.Combine(_directorioApp, "server.json");
        yield return Path.Combine(_directorioDatos, "server.json");
    }

    /// <summary>Contenido del primer server.json legible (vacío si no hay).</summary>
    public IReadOnlyDictionary<string, JsonElement> Cargar()
    {
        foreach (var ruta in RutasCandidatas())
        {
            try
            {
                if (!File.Exists(ruta))
                    continue;
                var mtime = File.GetLastWriteTimeUtc(ruta);
                lock (_cerrojo)
                {
                    if (_rutaCache == ruta && _mtimeCache == mtime)
                        return new Dictionary<string, JsonElement>(_datosCache);
                }
                var datos = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                    File.ReadAllText(ruta)) ?? new Dictionary<string, JsonElement>();
                lock (_cerrojo)
                {
                    _rutaCache = ruta;
                    _mtimeCache = mtime;
                    _datosCache = datos;
                }
                return new Dictionary<string, JsonElement>(datos);
            }
            catch (Exception exc)
            {
                Log.Advertencia($"server.json ilegible en {ruta}: {exc.Message}");
            }
        }
        return new Dictionary<string, JsonElement>();
    }

    /// <summary>Fusiona y escribe server.json junto al ejecutable, atómico.</summary>
    public bool Guardar(IReadOnlyDictionary<string, object?> actualizaciones)
    {
        var destino = Path.Combine(_directorioApp, "server.json");
        lock (_cerrojo)
        {
            var datos = new Dictionary<string, JsonElement>();
            if (File.Exists(destino))
            {
                try
                {
                    datos = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                        File.ReadAllText(destino)) ?? datos;
                }
                catch { datos = new Dictionary<string, JsonElement>(); }
            }
            else
            {
                datos = new Dictionary<string, JsonElement>(Cargar());
            }
            foreach (var (clave, valor) in actualizaciones)
            {
                datos[clave] = JsonSerializer.SerializeToElement(valor);
            }
            try
            {
                ArchivoJson.EscribirAtomico(destino, datos);
                _rutaCache = null;
                _datosCache = new Dictionary<string, JsonElement>();
                return true;
            }
            catch (Exception exc)
            {
                Log.Error($"No se pudo escribir server.json: {exc.Message}");
                return false;
            }
        }
    }

    /// <summary>Guarda el token del equipo ya cifrado (DPAPI/ENC:).</summary>
    public bool GuardarTokenAgente(string tokenPlano) =>
        Guardar(new Dictionary<string, object?> { ["agentToken"] = CifradoValores.Cifrar(tokenPlano) });

    private string Texto(string clave, string defecto = "")
    {
        if (Cargar().TryGetValue(clave, out var valor) && valor.ValueKind == JsonValueKind.String)
        {
            var texto = valor.GetString()?.Trim();
            if (!string.IsNullOrEmpty(texto))
                return texto;
        }
        return defecto;
    }

    // ── Valores efectivos ────────────────────────────────────────

    public string HostServidor => Texto("serverHost", HostPorDefecto) is { Length: > 0 } h ? h : HostPorDefecto;

    public int PuertoServidor
    {
        get
        {
            if (Cargar().TryGetValue("serverPort", out var bruto))
            {
                try
                {
                    if (bruto.ValueKind == JsonValueKind.Number && bruto.TryGetInt32(out var numero))
                        return numero;
                    if (bruto.ValueKind == JsonValueKind.String &&
                        int.TryParse(bruto.GetString(), out var desdeTexto))
                        return desdeTexto;
                }
                catch { /* cae al defecto */ }
                Log.Advertencia($"serverPort inválido en server.json: {bruto}");
            }
            return PuertoPorDefecto;
        }
    }

    public string EsquemaServidor
    {
        get
        {
            var esquema = Texto("serverScheme", "http").ToLowerInvariant();
            return esquema is "http" or "https" ? esquema : "http";
        }
    }

    public string UrlBase => $"{EsquemaServidor}://{HostServidor}:{PuertoServidor}";

    public string? CertificadoTls
    {
        get
        {
            var certificado = Texto("sslCert");
            return certificado.Length > 0 && File.Exists(certificado) ? certificado : null;
        }
    }

    public bool VerificarTls
    {
        get
        {
            if (EsquemaServidor == "http")
                return true;
            if (CertificadoTls is not null)
                return true;
            return !(Cargar().TryGetValue("sslVerify", out var v) &&
                     v.ValueKind == JsonValueKind.False);
        }
    }

    /// <summary>Token del equipo descifrado; null si no hay o no se pudo abrir.</summary>
    public string? TokenAgente
    {
        get
        {
            var bruto = Texto("agentToken");
            if (bruto.Length == 0)
                return null;
            var limpio = CifradoValores.Descifrar(bruto).Trim();
            return limpio.Length > 0 ? limpio : null;
        }
    }

    /// <summary>La única credencial del agente: el token propio del equipo.</summary>
    public Dictionary<string, string> CabecerasAuth()
    {
        var token = TokenAgente;
        return token is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string> { ["Authorization"] = $"AgentToken {token}" };
    }

    // ── Identidad de la máquina ──────────────────────────────────

    public static string NombrePc =>
        (Environment.GetEnvironmentVariable("COMPUTERNAME") is { Length: > 0 } nombre
            ? nombre
            : Dns.GetHostName()).Trim();

    /// <summary>Primera IPv4 válida de la máquina (el panel la exige con formato).</summary>
    public string IpPc
    {
        get
        {
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
                socket.Connect(HostServidor, PuertoServidor);
                if (socket.LocalEndPoint is IPEndPoint extremo)
                    return extremo.Address.ToString();
            }
            catch { /* respaldo */ }
            try
            {
                foreach (var direccion in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (direccion.AddressFamily == AddressFamily.InterNetwork &&
                        !direccion.ToString().StartsWith("127.", StringComparison.Ordinal))
                        return direccion.ToString();
                }
            }
            catch { /* respaldo */ }
            return "127.0.0.1";
        }
    }

    /// <summary>Usuario con la sesión de escritorio activa (para los eventos).</summary>
    public static string UsuarioInteractivo
    {
        get
        {
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    var sesion = WTSGetActiveConsoleSessionId();
                    if (sesion != 0xFFFFFFFF &&
                        WTSQuerySessionInformation(
                            IntPtr.Zero, sesion, WTSInfoClass.WTSUserName,
                            out var bufer, out _))
                    {
                        var nombre = Marshal.PtrToStringUni(bufer);
                        WTSFreeMemory(bufer);
                        if (!string.IsNullOrEmpty(nombre))
                            return nombre;
                    }
                }
                catch { /* respaldo */ }
            }
            return Environment.GetEnvironmentVariable("USERNAME") ?? "Sistema";
        }
    }

    private enum WTSInfoClass
    {
        WTSUserName = 5,
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool WTSQuerySessionInformation(
        IntPtr hServer, uint sessionId, WTSInfoClass wtsInfoClass,
        out IntPtr ppBuffer, out uint pBytesReturned);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr pMemory);
}
