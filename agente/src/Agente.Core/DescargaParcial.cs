// -*- coding: utf-8 -*-
// Reglas puras de la descarga reanudable del paquete de
// actualización: qué cabecera Range pedir según lo ya bajado y
// qué hacer con la respuesta del panel. Sin E/S: se prueban
// solas; el transporte vive en ClientePanel.DescargarPaqueteAsync.
using System;

namespace USBMonitor.Agente.Core;

/// <summary>Qué hacer con el cuerpo de la respuesta al descargar.</summary>
public enum ModoDescarga
{
    /// <summary>Respuesta completa (200): el parcial se descarta y se escribe de cero.</summary>
    DesdeCero,

    /// <summary>Respuesta parcial (206) a un Range pedido: se anexa al parcial.</summary>
    Anexar,

    /// <summary>Otra cosa (error del panel, rango rechazado): la descarga falla y el parcial se conserva.</summary>
    Fallo,
}

/// <summary>Las decisiones de la descarga por rangos.</summary>
public static class DescargaParcial
{
    /// <summary>
    /// La cabecera Range a pedir según lo ya bajado: con nada
    /// bajado no se pide rango (descarga normal); con algo, se
    /// pide desde ese byte hasta el final.
    /// </summary>
    public static string? CabeceraRango(long bytesYaBajados) =>
        bytesYaBajados > 0 ? $"bytes={bytesYaBajados}-" : null;

    /// <summary>
    /// El modo según la respuesta: 206 solo anexa si de verdad se
    /// pidió rango (un 206 sin pedirlo no cuadra con el parcial);
    /// 200 siempre manda escribir de cero (el panel ignoró el
    /// rango o no había parcial); el resto es fallo.
    /// </summary>
    public static ModoDescarga ModoAlResponder(int estadoHttp, bool sePidioRango) =>
        estadoHttp switch
        {
            206 when sePidioRango => ModoDescarga.Anexar,
            200 => ModoDescarga.DesdeCero,
            _ => ModoDescarga.Fallo,
        };

    /// <summary>Porcentaje recibido (0–100); −1 si el total no se conoce.</summary>
    public static int Porcentaje(long recibidos, long total)
    {
        if (total <= 0) return -1;
        var pct = recibidos * 100 / total;
        return pct >= 100 ? 100 : (int)pct;
    }
}
