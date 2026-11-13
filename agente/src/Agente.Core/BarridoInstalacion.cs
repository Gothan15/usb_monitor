// -*- coding: utf-8 -*-
// El barrido final de una desinstalación limpia: cuando el agente
// se desinstala, su carpeta de instalación (la que crea la
// instalación remota, C:\USBMonitor) también desaparece. Como el
// ejecutable vive EN esa carpeta, el borrado no puede hacerlo el
// propio proceso en marcha: se encarga a un cmd desprendido que
// reintenta hasta que todos los procesos del agente hayan salido.
//
// Aquí vive la parte pura y comprobable: si una carpeta puede
// barrerse sin peligro y cómo se construye esa orden. El
// lanzamiento lo hace el instalador. Las rutas se tratan con las
// reglas de Windows siempre: el agente solo corre en Windows y
// así las pruebas valen en cualquier máquina.
using System;
using System.Collections.Generic;
using System.IO;

namespace USBMonitor.Agente.Core;

/// <summary>Reglas del barrido de la carpeta tras desinstalar.</summary>
public static class BarridoInstalacion
{
    /// <summary>Normaliza una ruta de Windows: barras hacia atrás y sin barra final.</summary>
    private static string Normalizar(string ruta) =>
        ruta.Trim().Replace('/', '\\').TrimEnd('\\');

    /// <summary>Las carpetas del sistema que jamás se barren.</summary>
    private static IReadOnlyCollection<string> CarpetasDelSistema()
    {
        var lista = new List<string>();
        foreach (var especial in new[]
                 {
                     Environment.SpecialFolder.Windows,
                     Environment.SpecialFolder.ProgramFiles,
                     Environment.SpecialFolder.ProgramFilesX86,
                     Environment.SpecialFolder.CommonProgramFiles,
                 })
        {
            var ruta = Environment.GetFolderPath(especial);
            if (!string.IsNullOrEmpty(ruta)) lista.Add(ruta);
        }
        return lista;
    }

    /// <summary>
    /// Una carpeta solo se barre si es una ruta absoluta de
    /// Windows (letra de unidad o UNC), no es la raíz ni una
    /// carpeta del sistema y no trae comillas ni saltos que
    /// rompan la orden del cmd. Ante la duda no se barre: la
    /// desinstalación sigue sin ello.
    /// </summary>
    public static bool EsCarpetaSegura(string? carpeta) =>
        EsCarpetaSegura(carpeta, CarpetasDelSistema());

    /// <summary>La misma regla con la lista del sistema dada (para las pruebas).</summary>
    public static bool EsCarpetaSegura(
        string? carpeta, IReadOnlyCollection<string> carpetasDelSistema)
    {
        if (string.IsNullOrWhiteSpace(carpeta)) return false;
        if (carpeta.IndexOfAny(new[] { '"', '\r', '\n' }) >= 0) return false;
        var ruta = Normalizar(carpeta);
        // Absoluta de Windows: «X:\...» o «\\servidor\...».
        var esUnidad = ruta.Length >= 3
                       && char.IsLetter(ruta[0]) && ruta[1] == ':' && ruta[2] == '\\';
        var esUnc = ruta.StartsWith("\\\\", StringComparison.Ordinal);
        if (!esUnidad && !esUnc) return false;
        // La raíz de la unidad («C:») tras normalizar, jamás.
        if (esUnidad && ruta.Length == 2) return false;
        if (esUnidad && ruta.Length == 3 && ruta[2] == '\\') return false;
        foreach (var sistema in carpetasDelSistema)
        {
            if (!string.IsNullOrEmpty(sistema) && string.Equals(
                    ruta, Normalizar(sistema),
                    StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }

    /// <summary>
    /// La orden para cmd.exe: cuarenta intentos de borrar la
    /// carpeta con una pausa entre ellos; en cuanto desaparece,
    /// el cmd sale. Los procesos del agente pueden tardar en
    /// soltar el ejecutable: el reintento es el mecanismo.
    /// </summary>
    public static string ConstruirOrdenBarrido(string carpeta)
    {
        var destino = Normalizar(carpeta);
        return $"/c for /L %i in (1,1,40) do @(rd /s /q \"{destino}\" 2>nul & if not exist \"{destino}\" exit & ping -n 4 127.0.0.1 >nul)";
    }
}
