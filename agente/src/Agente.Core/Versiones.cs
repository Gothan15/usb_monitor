using System.Diagnostics;

namespace USBMonitor.Agente.Core;

/// <summary>
/// Lectura de la versión de un ejecutable desde su propio recurso
/// de versión (el VERSIONINFO del PE): la misma verdad que enseñan
/// las Propiedades del archivo en Windows y que el panel lee del
/// paquete que se le sube. Antes vivía en el cliente de GitHub de
/// la caja de herramientas; al desaparecer ese canal, la lectura
/// queda aquí, que es donde la caja la sigue necesitando para
/// enseñar qué versión corre este equipo.
/// </summary>
public static class Versiones
{
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
}
