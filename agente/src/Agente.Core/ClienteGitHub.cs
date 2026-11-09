using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>La Release más reciente del agente publicada en GitHub.</summary>
public sealed class InfoRelease
{
    public required string Version { get; init; }
    public required string Etiqueta { get; init; }
    public required string UrlZip { get; init; }
    public required long TamanoZip { get; init; }
}

/// <summary>
/// Actualización directa desde GitHub, para la caja de
/// herramientas: consultar la última Release del repositorio y
/// descargar su zip con REANUDACIÓN (si la red corta a mitad de
/// los ~95 MB, la siguiente intentona sigue desde el byte donde
/// se quedó, con la cabecera Range de HTTP).
///
/// Es un camino aparte del paquete del panel a propósito: la caja
/// de herramientas es la vía manual y visible para un equipo con
/// internet, mientras el panel sigue mandando en la LAN.
/// </summary>
public static class ClienteGitHub
{
    private static readonly Registrador Log = Registro.Obtener("github");

    private const string UrlUltimaRelease =
        "https://api.github.com/repos/Gothan15/usb_monitor/releases/latest";

    private static readonly HttpClient Http = CrearHttp();

    private static HttpClient CrearHttp()
    {
        var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        // GitHub exige un User-Agent identificable en su API.
        http.DefaultRequestHeaders.UserAgent.ParseAdd("NorthStarUSB-Agente");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }

    // ── Versiones ────────────────────────────────────────────────

    /// <summary>
    /// La versión «X.Y.Z» que un ejecutable declara en su propio
    /// recurso de versión (PE). Null si no declara o no se puede
    /// leer. Es la misma verdad que lee el panel desde el paquete.
    /// </summary>
    public static string? VersionDeArchivo(string ruta)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(ruta);
            return NormalizarVersion(info.ProductVersion) ??
                   NormalizarVersion(info.FileVersion);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// La versión del ejecutable que está corriendo: la de su PE
    /// y, si el sistema no la leyera, la que el propio ensamblado
    /// declara (la misma que el agente anuncia al panel).
    /// </summary>
    public static string? VersionArchivoActual() =>
        (Environment.ProcessPath is { Length: > 0 } ruta
            ? VersionDeArchivo(ruta)
            : null) ?? NormalizarVersion(ClientePanel.VersionAgente);

    /// <summary>«1.0.20.0» o «1.0.20+hash» → «1.0.20»; null si no hay X.Y.Z.</summary>
    public static string? NormalizarVersion(string? cruda)
    {
        if (string.IsNullOrWhiteSpace(cruda)) return null;
        var limpia = cruda.Split('+')[0].Trim();
        var partes = limpia.Split('.');
        if (partes.Length < 3) return null;
        var salida = new int[3];
        for (var i = 0; i < 3; i++)
            if (!int.TryParse(partes[i], out salida[i])) return null;
        return $"{salida[0]}.{salida[1]}.{salida[2]}";
    }

    /// <summary>Comparación numérica de versiones «X.Y.Z»: -1, 0 o 1.</summary>
    public static int CompararVersiones(string? a, string? b)
    {
        var pa = Partes(a);
        var pb = Partes(b);
        for (var i = 0; i < 3; i++)
            if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
        return 0;

        static int[] Partes(string? v)
        {
            var n = NormalizarVersion(v);
            return n is null
                ? new[] { 0, 0, 0 }
                : Array.ConvertAll(n.Split('.'), int.Parse);
        }
    }

    /// <summary>Versión «X.Y.Z» de una etiqueta «agente-vX.Y.Z».</summary>
    public static string? VersionDeEtiqueta(string? etiqueta)
    {
        if (string.IsNullOrWhiteSpace(etiqueta)) return null;
        var limpia = etiqueta.Trim();
        if (limpia.StartsWith("agente-v", StringComparison.OrdinalIgnoreCase))
            limpia = limpia["agente-v".Length..];
        else if (limpia.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            limpia = limpia[1..];
        return NormalizarVersion(limpia);
    }

    // ── Consulta ─────────────────────────────────────────────────

    /// <summary>
    /// La última Release publicada (la marcada Latest, que en
    /// este repositorio es siempre la del agente). Null si GitHub
    /// no responde o la respuesta no trae el zip del agente.
    /// </summary>
    public static async Task<InfoRelease?> UltimaReleaseAsync(
        CancellationToken ct = default)
    {
        try
        {
            using var respuesta = await Http
                .GetAsync(UrlUltimaRelease, HttpCompletionOption.ResponseHeadersRead, ct)
                .ConfigureAwait(false);
            if (!respuesta.IsSuccessStatusCode) return null;
            var datos = await respuesta.Content
                .ReadFromJsonAsync<RespuestaRelease>(ct)
                .ConfigureAwait(false);
            var version = VersionDeEtiqueta(datos?.Etiqueta);
            var activo = datos?.Activos?.FirstOrDefault(a =>
                a.Nombre is not null &&
                a.Nombre.StartsWith("USBMonitorService-", StringComparison.OrdinalIgnoreCase) &&
                a.Nombre.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));
            if (version is null || activo?.UrlDescarga is null) return null;
            return new InfoRelease
            {
                Version = version,
                Etiqueta = datos!.Etiqueta ?? "",
                UrlZip = activo.UrlDescarga,
                TamanoZip = activo.Tamano,
            };
        }
        catch (Exception exc) when (exc is not OperationCanceledException)
        {
            Log.Advertencia($"GitHub no respondió la consulta de la última Release: {exc.Message}");
            return null;
        }
    }

    private sealed class RespuestaRelease
    {
        [JsonPropertyName("tag_name")] public string? Etiqueta { get; set; }
        [JsonPropertyName("assets")] public List<ActivoRelease>? Activos { get; set; }
    }

    private sealed class ActivoRelease
    {
        [JsonPropertyName("name")] public string? Nombre { get; set; }
        [JsonPropertyName("browser_download_url")] public string? UrlDescarga { get; set; }
        [JsonPropertyName("size")] public long Tamano { get; set; }
    }

    // ── Descarga reanudable ──────────────────────────────────────

    /// <summary>
    /// Descarga el zip a `rutaParcial` reanudando desde lo que ya
    /// hubiera (el archivo parcial se CONSERVA entre intentos y
    /// entre sesiones: cerrar la caja no pierde lo bajado).
    /// Reintenta sola unas veces ante cortes de red; si se acaban
    /// los intentos devuelve false y el parcial queda para el
    /// siguiente «Reanudar». True solo cuando el tamaño final
    /// coincide con el de la Release.
    /// </summary>
    public static async Task<bool> DescargarZipAsync(
        InfoRelease release,
        string rutaParcial,
        IProgress<double>? progreso = null,
        CancellationToken ct = default)
    {
        var carpeta = Path.GetDirectoryName(rutaParcial);
        if (!string.IsNullOrEmpty(carpeta)) Directory.CreateDirectory(carpeta);

        const int maxIntentos = 6;
        for (var intento = 1; intento <= maxIntentos; intento++)
        {
            ct.ThrowIfCancellationRequested();
            var yaHay = File.Exists(rutaParcial) ? new FileInfo(rutaParcial).Length : 0;
            if (release.TamanoZip > 0 && yaHay == release.TamanoZip)
            {
                progreso?.Report(1);
                return true;
            }
            if (release.TamanoZip > 0 && yaHay > release.TamanoZip)
            {
                // Parcial imposible (más grande que el total): basura, se rehace.
                File.Delete(rutaParcial);
                yaHay = 0;
            }

            try
            {
                using var solicitud = new HttpRequestMessage(HttpMethod.Get, release.UrlZip);
                if (yaHay > 0)
                    solicitud.Headers.Range = new RangeHeaderValue(yaHay, null);
                using var respuesta = await Http
                    .SendAsync(solicitud, HttpCompletionOption.ResponseHeadersRead, ct)
                    .ConfigureAwait(false);

                // Si el servidor ignora el Range (200 en vez de
                // 206), la descarga empieza de cero en este intento.
                var reanudar = yaHay > 0 &&
                    respuesta.StatusCode == HttpStatusCode.PartialContent;
                if (!reanudar && !respuesta.IsSuccessStatusCode)
                    throw new HttpRequestException($"HTTP {(int)respuesta.StatusCode}");
                var modo = reanudar ? FileMode.Append : FileMode.Create;

                await using var destino = new FileStream(
                    rutaParcial, modo, FileAccess.Write, FileShare.None,
                    bufferSize: 81920, useAsync: true);
                await using var origen = await respuesta.Content
                    .ReadAsStreamAsync(ct).ConfigureAwait(false);

                var bufer = new byte[81920];
                var bajados = reanudar ? yaHay : 0;
                while (true)
                {
                    // Cada lectura tiene su propio margen: 60 s sin
                    // recibir nada cuenta como corte de red.
                    using var corte = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    corte.CancelAfter(TimeSpan.FromSeconds(60));
                    int leidos;
                    try
                    {
                        leidos = await origen.ReadAsync(bufer, corte.Token)
                            .ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        throw new IOException("La descarga se detuvo (60 s sin datos).");
                    }
                    if (leidos == 0) break;
                    await destino.WriteAsync(bufer.AsMemory(0, leidos), ct)
                        .ConfigureAwait(false);
                    bajados += leidos;
                    if (release.TamanoZip > 0)
                        progreso?.Report((double)bajados / release.TamanoZip);
                }
                await destino.FlushAsync(ct).ConfigureAwait(false);
            }
            catch (Exception exc) when (exc is not OperationCanceledException)
            {
                Log.Advertencia(
                    $"Descarga de la actualización cortada (intento {intento}/{maxIntentos}): {exc.Message}");
                if (intento < maxIntentos)
                    await Task.Delay(TimeSpan.FromSeconds(2), ct).ConfigureAwait(false);
                continue;
            }

            var final = File.Exists(rutaParcial) ? new FileInfo(rutaParcial).Length : 0;
            if (release.TamanoZip == 0 || final == release.TamanoZip)
            {
                progreso?.Report(1);
                return true;
            }
            // El flujo terminó pero no cuadra el tamaño: el bucle
            // reanuda desde el parcial en el siguiente intento.
        }
        return false;
    }
}
