using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>
/// La ficha del compañero vivo: un archivo pequeño en el
/// directorio de datos con su PID, su sesión, su nombre de
/// proceso y su hora de arranque.
///
/// Hasta ahora el servicio sabía si el compañero vivía
/// buscando texto en las líneas de comandos por WMI
/// («companero.py», « prompt» + «servicio.py»): una
/// coincidencia heredada de la época Python que casaba con el
/// compañero C# casi por accidente — depende de que el exe se
/// llame igual y de que el argumento sea exactamente ese. Si
/// dejaba de casar, el vigía relanzaba compañeros duplicados;
/// si casaba de más, daba por vivo a un compañero muerto y el
/// cartel de credenciales no salía nunca, sin dejar rastro en
/// ningún registro.
///
/// La ficha es la fuente principal: el compañero la escribe
/// al arrancar y la borra al cerrarse. El servicio la lee y
/// comprueba que el proceso sigue vivo y ES ese proceso (los
/// PID se reutilizan: sin comparar nombre, sesión y hora de
/// arranque, un PID reciclado parecería el compañero). La
/// búsqueda WMI queda solo como respaldo para un compañero de
/// una versión anterior que aún no escriba ficha.
/// </summary>
public static class CompaneroPid
{
    /// <summary>Nombre del archivo en el directorio de datos.</summary>
    public const string NombreArchivo = "companero.pid.json";

    /// <summary>La ficha tal como se guarda en disco.</summary>
    public sealed class Ficha
    {
        [JsonPropertyName("pid")]
        public int Pid { get; set; }

        [JsonPropertyName("proceso")]
        public string? Proceso { get; set; }

        [JsonPropertyName("sesion")]
        public int Sesion { get; set; }

        [JsonPropertyName("inicio")]
        public string? Inicio { get; set; }
    }

    private static string Ruta(string? directorioDatos) =>
        Path.Combine(
            directorioDatos ?? Registro.DirectorioDatos,
            NombreArchivo);

    /// <summary>
    /// Escribe la ficha del proceso ACTUAL (la llama el
    /// compañero al arrancar). Escritura atómica como la del
    /// desfase: temporal y reemplazo. Los fallos se tragan:
    /// sin ficha, el servicio cae al respaldo WMI de siempre.
    /// </summary>
    public static void Escribir(string? directorioDatos = null)
    {
        try
        {
            using var actual = Process.GetCurrentProcess();
            var ficha = new Ficha
            {
                Pid = actual.Id,
                Proceso = actual.ProcessName,
                Sesion = actual.SessionId,
                Inicio = actual.StartTime.ToUniversalTime().ToString("o"),
            };
            var ruta = Ruta(directorioDatos);
            var temporal = ruta + $".{actual.Id}.tmp";
            File.WriteAllText(temporal, JsonSerializer.Serialize(ficha));
            File.Move(temporal, ruta, overwrite: true);
        }
        catch
        {
            // La ficha es una mejora de detección, no un requisito.
        }
    }

    /// <summary>Borra la ficha (el compañero al cerrarse).</summary>
    public static void Borrar(string? directorioDatos = null)
    {
        try
        {
            var ruta = Ruta(directorioDatos);
            if (File.Exists(ruta)) File.Delete(ruta);
        }
        catch
        {
            // Una ficha huérfana no engaña a nadie: la
            // comprobación de vida mira el proceso, no el papel.
        }
    }

    /// <summary>La ficha guardada, o null si no hay o no se puede leer.</summary>
    public static Ficha? Leer(string? directorioDatos = null)
    {
        try
        {
            var ruta = Ruta(directorioDatos);
            if (!File.Exists(ruta)) return null;
            return JsonSerializer.Deserialize<Ficha>(File.ReadAllText(ruta));
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// ¿El proceso encontrado por el PID de la ficha ES el
    /// compañero que la escribió? Se comparan nombre, sesión y
    /// hora de arranque: un PID reciclado por otro proceso (u
    /// otra sesión) no coincide en las tres. Pura, para
    /// probarla sin procesos de verdad.
    /// </summary>
    public static bool CoincideProceso(
        Ficha ficha,
        string? nombreProceso,
        int sesionProceso,
        DateTime inicioProcesoUtc)
    {
        if (ficha.Pid <= 0) return false;
        if (!string.Equals(
                ficha.Proceso, nombreProceso,
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        if (ficha.Sesion != sesionProceso) return false;
        if (!DateTime.TryParse(
                ficha.Inicio,
                null,
                System.Globalization.DateTimeStyles.RoundtripKind,
                out var inicioFicha))
        {
            return false;
        }
        // La hora de arranque puede diferir en la precisión del
        // formato al guardar y releer: 2 s de margen.
        return Math.Abs(
            (inicioFicha.ToUniversalTime() - inicioProcesoUtc)
                .TotalSeconds) <= 2;
    }
}
