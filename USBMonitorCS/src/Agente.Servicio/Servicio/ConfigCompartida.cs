// -*- coding: utf-8 -*-
// Ajustes remotos compartidos entre el Worker y el servidor local.
//
// El Worker los siembra desde GET /api/agent/config (camelCase) al
// arrancar y cada 10 minutos; el panel los empuja en caliente con
// POST :5001/config (snake_case, y se acepta también camelCase).
// Ambas vías aterrizan aquí, normalizadas, y se aplican al momento
// sin reiniciar el servicio.
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Estado de ajustes remotos, seguro entre hilos.</summary>
public sealed class ConfigCompartida
{
    private readonly object _lock = new();
    private bool _lockSessionOnInsert;
    private bool _shutdownOnNonWhitelisted;
    private int _startupNetworkDelay;

    /// <summary>Bloquear la sesión de Windows al insertar un USB bloqueado.</summary>
    public bool LockSessionOnInsert
    {
        get { lock (_lock) return _lockSessionOnInsert; }
        set { lock (_lock) _lockSessionOnInsert = value; }
    }

    /// <summary>Apagar el equipo al insertar un dispositivo fuera de la lista blanca.</summary>
    public bool ShutdownOnNonWhitelisted
    {
        get { lock (_lock) return _shutdownOnNonWhitelisted; }
        set { lock (_lock) _shutdownOnNonWhitelisted = value; }
    }

    /// <summary>Espera de red al arrancar el servicio, en segundos.</summary>
    public int StartupNetworkDelay
    {
        get { lock (_lock) return _startupNetworkDelay; }
        set { lock (_lock) _startupNetworkDelay = value; }
    }

    /// <summary>Aplica la respuesta de GET /api/agent/config.</summary>
    public void AplicarRemota(ConfigRemota remota)
    {
        lock (_lock)
        {
            if (remota.StartupNetworkDelay is { } espera) _startupNetworkDelay = espera;
            // LockSessionOnInsert no es anulable en ConfigRemota y la
            // ruta /api/agent/config lo devuelve siempre: se aplica
            // tal cual viene.
            _lockSessionOnInsert = remota.LockSessionOnInsert;
            _shutdownOnNonWhitelisted = remota.ShutdownOnNonWhitelisted;
        }
    }
}
