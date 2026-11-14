// -*- coding: utf-8 -*-
// Salud tras actualizar: el marcador que la copia aplicadora
// deja al intercambiar el exe y las reglas del vigía que corre
// en la versión recién instalada.
//
// El hueco que tapa: la vuelta atrás de AplicarActualizacion
// solo comprueba que el servicio nuevo ARRANCa (Running en
// 60 s). Una versión que arranca pero no logra hablar con el
// panel (una firma rota, una configuración mala) se quedaba
// instalada y muda para siempre. Ahora la versión nueva nace
// con un plazo —10 minutos desde el intercambio— para lograr
// una respuesta buena del panel; si no la logra, su propio
// vigía restaura el exe anterior. El marcador vive en la
// carpeta de datos (sobrevive al intercambio) y guarda el hash
// del exe instalado: el vigía solo se arma si el exe en marcha
// ES el del marcador, así un marcador viejo de otro episodio
// no vigila a quien no debe.
using System;
using System.IO;
using System.Security.Cryptography;

namespace USBMonitor.Agente.Core;

/// <summary>El marcador de salud de una actualización recién aplicada.</summary>
public sealed class MarcadorSalud
{
    /// <summary>SHA-256 (hex) del exe que la actualización dejó instalado.</summary>
    public string Sha256Instalado { get; set; } = "";

    /// <summary>Cuándo lo escribió la copia aplicadora (UTC).</summary>
    public DateTime CreadoEnUtc { get; set; }
}

/// <summary>El marcador y las reglas puras del vigía de salud.</summary>
public static class SaludActualizacion
{
    /// <summary>Minutos que la versión nueva tiene para hablar con el panel.</summary>
    public const int MinutosPlazo = 10;

    /// <summary>Un marcador más viejo que esto ya no arma ningún vigía.</summary>
    public static readonly TimeSpan EdadMaximaMarcador = TimeSpan.FromHours(24);

    /// <summary>Días tras los que el respaldo «.anterior» se retira si ya no vigila nadie.</summary>
    public const int DiasRespaldo = 7;

    /// <summary>La ruta del marcador, en la carpeta de datos del agente.</summary>
    public static string RutaMarcador =>
        Path.Combine(Registro.DirectorioDatos, "actualizacion_salud.json");

    /// <summary>SHA-256 (hex en mayúsculas) de un archivo; se lee aunque esté en uso.</summary>
    public static string ShaDeArchivo(string ruta)
    {
        using var flujo = new FileStream(
            ruta, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(flujo));
    }

    /// <summary>Deja el marcador de una actualización recién aplicada.</summary>
    public static void Escribir(string sha256Instalado)
    {
        ArchivoJson.EscribirAtomico(RutaMarcador, new MarcadorSalud
        {
            Sha256Instalado = sha256Instalado,
            CreadoEnUtc = DateTime.UtcNow,
        });
    }

    /// <summary>Lee el marcador; null si no hay o no se puede leer.</summary>
    public static MarcadorSalud? Leer()
    {
        try
        {
            return ArchivoJson.Leer<MarcadorSalud>(RutaMarcador);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Retira el marcador (salud confirmada o episodio cerrado).</summary>
    public static void Borrar()
    {
        try
        {
            if (File.Exists(RutaMarcador)) File.Delete(RutaMarcador);
        }
        catch { /* el borrado nunca rompe nada */ }
    }

    /// <summary>
    /// ¿Debe armarse el vigía? Solo si hay marcador, el exe en
    /// marcha es el que el marcador dice (su hash coincide) y el
    /// marcador no es un resto viejo de otro episodio.
    /// </summary>
    public static bool VigiaArmado(
        MarcadorSalud? marcador, string shaExeActual, DateTime ahoraUtc)
    {
        if (marcador is null) return false;
        if (!string.Equals(
                marcador.Sha256Instalado, shaExeActual,
                StringComparison.OrdinalIgnoreCase))
            return false;
        return ahoraUtc - marcador.CreadoEnUtc < EdadMaximaMarcador;
    }

    /// <summary>
    /// La salud se confirma con UNA respuesta buena del panel
    /// posterior a la creación del marcador (la versión anterior
    /// estaba parada desde el intercambio: cualquier contacto de
    /// después es de la nueva).
    /// </summary>
    public static bool SaludConfirmada(
        DateTime? ultimoContactoOkUtc, MarcadorSalud marcador) =>
        ultimoContactoOkUtc is { } t && t > marcador.CreadoEnUtc;

    /// <summary>¿Venció el plazo sin confirmar la salud?</summary>
    public static bool PlazoVencido(DateTime creadoEnUtc, DateTime ahoraUtc) =>
        ahoraUtc - creadoEnUtc >= TimeSpan.FromMinutes(MinutosPlazo);

    /// <summary>
    /// ¿Toca retirar el respaldo «.anterior»? Solo si existe, no
    /// hay vigía de salud pendiente (nadie puede necesitarlo
    /// para revertir) y lleva más de los días de gracia.
    /// </summary>
    public static bool RespaldoTocaBorrar(
        bool existeRespaldo,
        bool hayMarcadorSalud,
        DateTime? creadoRespaldoUtc,
        DateTime ahoraUtc)
    {
        if (!existeRespaldo || hayMarcadorSalud) return false;
        if (creadoRespaldoUtc is not { } creado) return false;
        return ahoraUtc - creado > TimeSpan.FromDays(DiasRespaldo);
    }
}
