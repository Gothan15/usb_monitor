// -*- coding: utf-8 -*-
// Captura de evidencia: la «foto del momento» de un bloqueo de un
// dispositivo NO autorizado (ajuste del panel
// captureEvidenceOnNonWhitelisted, apagado por defecto).
//
// El reparto de papeles, por sesiones: el SERVICIO (sesión 0, sin
// escritorio) detecta el bloqueo y deja una SOLICITUD en
// <datos>/evidencia; el COMPAÑERO (sesión del usuario) la recoge,
// captura — pantalla, ventana en primer plano, procesos y
// pestañas — y deja el PAQUETE completo en la misma carpeta; el
// servicio lo sube al panel cuando tiene el id del bloqueo y red.
//
// Aquí vive solo lo separable de Windows: los DTOs del paquete y
// el gestor de la carpeta (solicitudes, paquetes, deduplicación y
// tope). La captura en sí (GDI, UI Automation) está en el proceso
// compañero, tras CapturadorEvidencia.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>Solicitud de captura que el servicio deja al compañero.</summary>
public sealed class SolicitudEvidencia
{
    [JsonPropertyName("clave")] public string Clave { get; set; } = "";
    [JsonPropertyName("serial")] public string? Serial { get; set; }
    /// <summary>Instante ISO en que el servicio detectó el bloqueo.</summary>
    [JsonPropertyName("instante")] public string Instante { get; set; } = "";
}

/// <summary>Un proceso de la sesión en el momento de la captura.</summary>
public sealed class ProcesoEvidencia
{
    [JsonPropertyName("proceso")] public string Proceso { get; set; } = "";
    /// <summary>Título de su ventana principal, si tiene (revela el documento abierto).</summary>
    [JsonPropertyName("titulo")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Titulo { get; set; }
}

/// <summary>Una pestaña de navegador (la activa de cada ventana, o una de la lista completa).</summary>
public sealed class PestanaNavegador
{
    [JsonPropertyName("navegador")] public string Navegador { get; set; } = "";
    [JsonPropertyName("titulo")] public string Titulo { get; set; } = "";
    [JsonPropertyName("url")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Url { get; set; }
}

/// <summary>
/// El paquete completo que el compañero deja en la carpeta y el
/// servicio sube al panel. La imagen viaja dentro del propio JSON
/// (base64): simplifica el transporte y el reintento sin red.
/// </summary>
public sealed class PaqueteEvidencia
{
    [JsonPropertyName("clave")] public string Clave { get; set; } = "";
    [JsonPropertyName("serial")] public string? Serial { get; set; }
    /// <summary>Instante ISO de la captura.</summary>
    [JsonPropertyName("capturedAt")] public string CapturedAt { get; set; } = "";
    [JsonPropertyName("foregroundProcess")] public string? ForegroundProcess { get; set; }
    [JsonPropertyName("foregroundTitle")] public string? ForegroundTitle { get; set; }
    [JsonPropertyName("processes")] public List<ProcesoEvidencia> Processes { get; set; } = new();
    [JsonPropertyName("browserTabs")] public List<PestanaNavegador> BrowserTabs { get; set; } = new();
    /// <summary>True si la lista de pestañas es la completa; false si solo van las activas.</summary>
    [JsonPropertyName("tabsComplete")] public bool TabsComplete { get; set; }
    /// <summary>Nota cuando algo no se pudo capturar (p. ej. sin escritorio disponible).</summary>
    [JsonPropertyName("nota")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Nota { get; set; }
    [JsonPropertyName("imagenBase64")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ImagenBase64 { get; set; }
}

/// <summary>
/// Gestor de la carpeta `evidencia`: nombres de archivo seguros a
/// partir de la clave del dispositivo (la instancia PnP lleva
/// barras y no vale como nombre), escritura atómica con la misma
/// mecánica de ArchivoJson y el tope de paquetes sin subir.
/// </summary>
public static class GestorEvidencia
{
    public const string NombreCarpeta = "evidencia";
    private const string SufijoSolicitud = ".solicitud.json";
    private const string SufijoPaquete = ".json";

    /// <summary>Carpeta de evidencia dentro del directorio de datos.</summary>
    public static string Carpeta(string directorioDatos) =>
        Path.Combine(directorioDatos, NombreCarpeta);

    /// <summary>
    /// Nombre de archivo seguro para una clave: la instancia PnP
    /// («USB\VID_…») no puede ser nombre de archivo, así que se usa
    /// la huella SHA-256 de la clave en mayúsculas. La clave real
    /// viaja dentro del JSON, no en el nombre.
    /// </summary>
    public static string NombreSeguro(string clave)
    {
        var huella = SHA256.HashData(Encoding.UTF8.GetBytes(clave.Trim().ToUpperInvariant()));
        return Convert.ToHexString(huella)[..32].ToLowerInvariant();
    }

    public static string RutaSolicitud(string carpeta, string clave) =>
        Path.Combine(carpeta, NombreSeguro(clave) + SufijoSolicitud);

    public static string RutaPaquete(string carpeta, string clave) =>
        Path.Combine(carpeta, NombreSeguro(clave) + SufijoPaquete);

    /// <summary>
    /// Deja una solicitud de captura para un bloqueo. Devuelve
    /// false si ya había una solicitud o un paquete para esa clave
    /// (una sola foto por bloqueo mientras siga bloqueado).
    /// </summary>
    public static bool Solicitar(string carpeta, string clave, string? serial, string instanteIso)
    {
        if (File.Exists(RutaSolicitud(carpeta, clave)) ||
            File.Exists(RutaPaquete(carpeta, clave)))
            return false;
        ArchivoJson.EscribirAtomico(RutaSolicitud(carpeta, clave), new SolicitudEvidencia
        {
            Clave = clave,
            Serial = serial,
            Instante = instanteIso,
        });
        return true;
    }

    /// <summary>Solicitudes pendientes que el compañero aún no ha capturado.</summary>
    public static List<SolicitudEvidencia> ListarSolicitudes(string carpeta)
    {
        var salida = new List<SolicitudEvidencia>();
        if (!Directory.Exists(carpeta)) return salida;
        foreach (var ruta in Directory.EnumerateFiles(carpeta, "*" + SufijoSolicitud))
        {
            var solicitud = ArchivoJson.Leer<SolicitudEvidencia>(ruta);
            if (solicitud is not null && !string.IsNullOrEmpty(solicitud.Clave))
                salida.Add(solicitud);
        }
        return salida;
    }

    /// <summary>Paquetes completos a la espera de subir al panel.</summary>
    public static List<PaqueteEvidencia> ListarPaquetes(string carpeta)
    {
        var salida = new List<PaqueteEvidencia>();
        if (!Directory.Exists(carpeta)) return salida;
        foreach (var ruta in Directory.EnumerateFiles(carpeta, "*" + SufijoPaquete))
        {
            if (ruta.EndsWith(SufijoSolicitud, StringComparison.OrdinalIgnoreCase)) continue;
            var paquete = ArchivoJson.Leer<PaqueteEvidencia>(ruta);
            if (paquete is not null && !string.IsNullOrEmpty(paquete.Clave))
                salida.Add(paquete);
        }
        return salida;
    }

    /// <summary>El compañero guarda el paquete capturado (atómico).</summary>
    public static void GuardarPaquete(string carpeta, PaqueteEvidencia paquete) =>
        ArchivoJson.EscribirAtomico(RutaPaquete(carpeta, paquete.Clave), paquete);

    public static void BorrarSolicitud(string carpeta, string clave) =>
        BorrarSiExiste(RutaSolicitud(carpeta, clave));

    public static void BorrarPaquete(string carpeta, string clave) =>
        BorrarSiExiste(RutaPaquete(carpeta, clave));

    /// <summary>
    /// Tope de paquetes sin subir: si hay más de `maximo`, se
    /// borran los más antiguos (por fecha del archivo) y se
    /// devuelven las claves borradas para que el servicio lo anote
    /// en su registro. Sin tope, una PC sin red acabaría llenando
    /// el disco con capturas de pantalla.
    /// </summary>
    public static List<string> AplicarTopePaquetes(string carpeta, int maximo)
    {
        var borradas = new List<string>();
        if (!Directory.Exists(carpeta)) return borradas;
        var rutas = Directory.EnumerateFiles(carpeta, "*" + SufijoPaquete)
            .Where(r => !r.EndsWith(SufijoSolicitud, StringComparison.OrdinalIgnoreCase))
            .OrderBy(r => File.GetLastWriteTimeUtc(r))
            .ToList();
        while (rutas.Count > maximo)
        {
            var ruta = rutas[0];
            rutas.RemoveAt(0);
            var paquete = ArchivoJson.Leer<PaqueteEvidencia>(ruta);
            BorrarSiExiste(ruta);
            borradas.Add(paquete?.Clave ?? Path.GetFileName(ruta));
        }
        return borradas;
    }

    private static void BorrarSiExiste(string ruta)
    {
        try
        {
            if (File.Exists(ruta)) File.Delete(ruta);
        }
        catch
        {
            // Best-effort: un archivo rebelde se reintenta en el
            // siguiente ciclo o lo barre el tope.
        }
    }
}
