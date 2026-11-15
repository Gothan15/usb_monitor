// -*- coding: utf-8 -*-
// Regla pura del espaciado entre intentos de enrolamiento
// con el código que dejó la instalación remota: graduado.
// Los primeros fallos se reintentan pronto (30 s, 1 min,
// 2 min) porque suelen ser pasajeros — el panel ocupado o
// la red despertando, justo lo que pasa al instalar dos PC
// a la vez — y solo si la cosa persiste se espacian a
// 5 minutos, para no machacar un panel caído ni gastar
// intentos contra un código caducado. Sin E/S: se prueba
// sola; el contador de fallos vive en AgenteWorker.
using System;

namespace USBMonitor.Agente.Core;

/// <summary>Cuánto esperar antes del siguiente intento de enrolamiento.</summary>
public static class ReintentoCredencial
{
    /// <summary>
    /// La espera que toca tras <paramref name="fallosConsecutivos"/>
    /// fallos seguidos: 0 o 1 → 30 s; 2 → 1 min; 3 → 2 min;
    /// 4 o más → 5 min.
    /// </summary>
    public static TimeSpan EsperaTrasFallos(int fallosConsecutivos) => fallosConsecutivos switch
    {
        <= 1 => TimeSpan.FromSeconds(30),
        2 => TimeSpan.FromMinutes(1),
        3 => TimeSpan.FromMinutes(2),
        _ => TimeSpan.FromMinutes(5),
    };
}
