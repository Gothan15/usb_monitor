using System.Text.Json;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>
/// El desfase entre el reloj de este equipo y el del panel,
/// PERSISTIDO en disco y compartido por todos los procesos.
///
/// El desfase se aprende de la cabecera Date de las respuestas
/// del panel y compensa las marcas al firmar (la ventana de
/// firma es de ±300 s). Vivía solo en la memoria de cada
/// ClientePanel: cada proceso — servicio, compañero, caja de
/// herramientas, cada ClientePanel efímero del asistente —
/// nacía con desfase cero y firmaba mal hasta su primera
/// respuesta. En un equipo con el reloj desviado (las VM lo
/// pierden al restaurar una instantánea), el compañero que se
/// abre al iniciar sesión podía pasarse sus primeros intentos
/// rechazado sin que nada estuviera «roto»: solo desalineado.
///
/// Ahora el último desfase aprendido se guarda en
/// desfase_reloj.json del directorio de datos: cualquier
/// proceso que arranque lo lee ANTES de su primera firma, y
/// quien aprenda uno nuevo lo deja escrito para los demás.
/// </summary>
public static class DesfaseReloj
{
    /// <summary>Nombre del archivo en el directorio de datos.</summary>
    public const string NombreArchivo = "desfase_reloj.json";

    /// <summary>Forma del archivo guardado.</summary>
    private sealed class Ficha
    {
        [JsonPropertyName("desfaseSeg")]
        public long DesfaseSeg { get; set; }

        [JsonPropertyName("aprendidoEn")]
        public string? AprendidoEn { get; set; }
    }

    /// <summary>
    /// ¿Merece la pena reescribir el archivo? Solo si el
    /// desfase cambió de verdad (≥ 5 s): las respuestas llegan
    /// cada pocos segundos y reescribir por un segundo de
    /// deriva sería golpear el disco sin ganar precisión.
    /// </summary>
    public static bool DebePersistir(long guardado, long nuevo) =>
        Math.Abs(nuevo - guardado) >= 5;

    /// <summary>
    /// El desfase guardado, en segundos; 0 si no hay archivo o
    /// no se puede leer (un archivo corrupto no debe tumbar el
    /// arranque de ningún proceso: se firma sin compensar y el
    /// aprendizaje en vivo lo repondrá).
    /// </summary>
    public static long Cargar(string? directorioDatos = null)
    {
        try
        {
            var ruta = Path.Combine(
                directorioDatos ?? Registro.DirectorioDatos,
                NombreArchivo);
            if (!File.Exists(ruta)) return 0;
            var ficha = JsonSerializer.Deserialize<Ficha>(
                File.ReadAllText(ruta));
            return ficha?.DesfaseSeg ?? 0;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>
    /// Guarda el desfase de forma atómica (archivo temporal y
    /// reemplazo): servicio y compañero pueden escribir a la
    /// vez y un corte a mitad no debe dejar un JSON roto que
    /// otro proceso lea como cero… o como error. Cualquier
    /// fallo se traga: persistir es una mejora, no un requisito.
    /// </summary>
    public static void Guardar(long desfaseSeg, string? directorioDatos = null)
    {
        try
        {
            var directorio = directorioDatos ?? Registro.DirectorioDatosCreado();
            Directory.CreateDirectory(directorio);
            var ruta = Path.Combine(directorio, NombreArchivo);
            var temporal = ruta + $".{Environment.ProcessId}.tmp";
            var ficha = new Ficha
            {
                DesfaseSeg = desfaseSeg,
                AprendidoEn = DateTimeOffset.UtcNow.ToString("o"),
            };
            File.WriteAllText(temporal, JsonSerializer.Serialize(ficha));
            File.Move(temporal, ruta, overwrite: true);
        }
        catch
        {
            // Sin persistencia se sigue como antes: en memoria.
        }
    }
}
