// -*- coding: utf-8 -*-
// Escritura JSON atómica (temporal + replace), como en el agente Python.
using System.Text.Json;

namespace USBMonitor.Agente.Core;

/// <summary>Ayudante interno de persistencia JSON atómica.</summary>
internal static class ArchivoJson
{
    private static readonly JsonSerializerOptions Opciones = new() { WriteIndented = true };

    public static void EscribirAtomico<T>(string ruta, T datos)
    {
        var directorio = Path.GetDirectoryName(ruta);
        if (!string.IsNullOrEmpty(directorio))
            Directory.CreateDirectory(directorio);
        var temporal = ruta + ".tmp";
        File.WriteAllText(temporal, JsonSerializer.Serialize(datos, Opciones));
        MoverReemplazando(temporal, ruta);
    }

    public static void EscribirAtomico(string ruta, string contenido)
    {
        var directorio = Path.GetDirectoryName(ruta);
        if (!string.IsNullOrEmpty(directorio))
            Directory.CreateDirectory(directorio);
        var temporal = ruta + ".tmp";
        File.WriteAllText(temporal, contenido);
        MoverReemplazando(temporal, ruta);
    }

    private static void MoverReemplazando(string temporal, string destino)
    {
        if (File.Exists(destino))
            File.Replace(temporal, destino, null);
        else
            File.Move(temporal, destino);
    }

    public static T? Leer<T>(string ruta) where T : class
    {
        try
        {
            if (File.Exists(ruta))
                return JsonSerializer.Deserialize<T>(File.ReadAllText(ruta));
        }
        catch
        {
            // Ilegible: quien llama decide el defecto (fail-closed).
        }
        return null;
    }
}
