// -*- coding: utf-8 -*-
// El marcador de la orden «reiniciar» del panel.
//
// Reiniciar el propio servicio a mitad de una orden tiene una
// trampa: al volver a arrancar, el panel sirve la misma orden
// otra vez (sigue EN_CURSO) y el agente la ejecutaría de nuevo
// — un bucle de reinicios sin fin —. El marcador lo rompe: el
// servicio escribe el id de la orden en disco ANTES de lanzar
// al ayudante que lo reinicia, y al arrancar de nuevo, si la
// orden que llega es la marcada, la informa HECHA sin tocar
// nada y borra el marcador.
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>El marcador en disco de la orden «reiniciar» en curso.</summary>
public static class MarcadorReinicio
{
    /// <summary>Nombre del archivo del marcador, en el directorio de datos.</summary>
    public const string NombreArchivo = "reinicio-orden.json";

    private sealed class Datos
    {
        [JsonPropertyName("ordenId")] public string OrdenId { get; set; } = "";
    }

    /// <summary>Ruta del marcador dentro del directorio de datos.</summary>
    public static string Ruta(string directorioDatos) =>
        Path.Combine(directorioDatos, NombreArchivo);

    /// <summary>Anota que esta orden de reinicio ya se está ejecutando.</summary>
    public static void Marcar(string directorioDatos, string ordenId) =>
        ArchivoJson.EscribirAtomico(
            Ruta(directorioDatos), new Datos { OrdenId = ordenId });

    /// <summary>El id de la orden marcada, o null si no hay marcador.</summary>
    public static string? OrdenMarcada(string directorioDatos)
    {
        var datos = ArchivoJson.Leer<Datos>(Ruta(directorioDatos));
        return datos is null || string.IsNullOrWhiteSpace(datos.OrdenId)
            ? null
            : datos.OrdenId;
    }

    /// <summary>Borra el marcador (la orden ya se informó HECHA).</summary>
    public static void Limpiar(string directorioDatos)
    {
        try { File.Delete(Ruta(directorioDatos)); }
        catch { /* si no se puede borrar, la orden ya no volverá y el marcador queda inofensivo */ }
    }
}
