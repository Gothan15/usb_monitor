// -*- coding: utf-8 -*-
// Bloqueo de la sesión del usuario pedido por el servicio.
//
// El problema: el servicio corre en la sesión 0 de Windows,
// aislada del escritorio del usuario desde Vista.
// LockWorkStation() bloquea la sesión del proceso que llama:
// desde el servicio no bloquea nada que el usuario vea, y como
// la llamada nativa devuelve un bool que nadie miraba (ni
// lanza excepción), el fallo era invisible — el ajuste
// «bloquear la sesión al insertar» y el peldaño 2 de la
// escalera llamaban a la API y no pasaba nada.
//
// El arreglo: el servicio deja la petición en
// <datos>/bloqueo_sesion.json y el compañero, que sí vive en
// la sesión del usuario y sondea los datos cada segundo, la
// ejecuta con su propia llamada a LockWorkStation. El mismo
// patrón que la captura de evidencia, que nació sabiendo que
// el servicio no puede tocar el escritorio.
//
// La petición caduca a los 30 s: bloquear la sesión un minuto
// después de la inserción no protege nada y sí molesta — si
// el compañero no estaba en marcha, la petición se olvida.
using System.Globalization;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>La petición de bloqueo de sesión que viaja al compañero.</summary>
public sealed class SolicitudBloqueoSesion
{
    /// <summary>Instante ISO (UTC) en que el servicio pidió el bloqueo.</summary>
    [JsonPropertyName("instanteUtc")] public string InstanteUtc { get; set; } = "";
    /// <summary>Por qué se pide (para el registro): inserción o escalera.</summary>
    [JsonPropertyName("motivo")] public string Motivo { get; set; } = "";
}

/// <summary>La decisión pura: ¿la petición sigue siendo ejecutable?</summary>
public static class VigenciaBloqueoSesion
{
    /// <summary>Segundos que una petición sigue valiendo.</summary>
    public const int SegundosVigencia = 30;

    /// <summary>
    /// True si la petición es reciente (entre 0 y
    /// SegundosVigencia segundos). Un instante ilegible NO se
    /// ejecuta: sin hora fiable no hay forma de saber si la
    /// petición es de ahora o de ayer.
    /// </summary>
    public static bool EsEjecutable(SolicitudBloqueoSesion? solicitud, DateTime ahoraUtc)
    {
        if (solicitud is null) return false;
        if (!DateTime.TryParse(
                solicitud.InstanteUtc, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var instante))
            return false;
        var edad = ahoraUtc - instante;
        return edad.TotalSeconds >= 0 && edad.TotalSeconds <= SegundosVigencia;
    }
}

/// <summary>La petición en disco: escribir, leer y borrar `bloqueo_sesion.json`.</summary>
public static class GestorBloqueoSesion
{
    public const string NombreArchivo = "bloqueo_sesion.json";

    public static string Ruta(string directorioDatos) =>
        Path.Combine(directorioDatos, NombreArchivo);

    /// <summary>Deja la petición para el compañero (escritura atómica).</summary>
    public static void Solicitar(string directorioDatos, string motivo, DateTime ahoraUtc) =>
        ArchivoJson.EscribirAtomico(Ruta(directorioDatos), new SolicitudBloqueoSesion
        {
            InstanteUtc = ahoraUtc.ToString("o", CultureInfo.InvariantCulture),
            Motivo = motivo,
        });

    /// <summary>La petición guardada, o null si no hay ninguna.</summary>
    public static SolicitudBloqueoSesion? Leer(string directorioDatos) =>
        ArchivoJson.Leer<SolicitudBloqueoSesion>(Ruta(directorioDatos));

    /// <summary>Borra la petición: ya ejecutada o caducada.</summary>
    public static void Borrar(string directorioDatos)
    {
        try
        {
            var ruta = Ruta(directorioDatos);
            if (File.Exists(ruta)) File.Delete(ruta);
        }
        catch
        {
            // Best-effort: una petición rebelde caduca sola por
            // su instante en la siguiente lectura.
        }
    }
}
