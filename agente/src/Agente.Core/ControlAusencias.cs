// -*- coding: utf-8 -*-
// Control de ausencias con período de gracia, para distinguir una
// extracción física de un PARPADEO de la enumeración de Windows.
//
// El problema que resuelve (visto en una PC real el 2026-11-08):
// deshabilitar o habilitar un nodo PnP reordena el árbol de
// dispositivos, y justo en esa transición la enumeración WMI
// (Win32_DiskDrive) puede no listar el disco durante uno o varios
// ciclos — el bucle de detección es despertado por el propio evento
// de cambio de hardware, así que muestrea el sistema en su momento
// más inestable. Si UNA sola enumeración sin el dispositivo se
// trata como extracción, el agente «extrae» un dispositivo que
// sigue enchufado: reactiva su nodo (la memoria vuelve a ser
// accesible con el cartel de contraseña en pantalla), cierra su
// bloqueo en el panel y al siguiente ciclo lo «descubre» de nuevo
// y lo rebloquea; tras un desbloqueo legítimo pasa igual y el
// ciclo se repite (bloquea → se libera solo → bloquea…).
//
// Regla: una ausencia solo es extracción cuando dura el período
// de gracia completo sin que el dispositivo reaparezca. Si
// reaparece antes, nunca se fue.
namespace USBMonitor.Agente.Core;

/// <summary>
/// Lleva la cuenta de desde cuándo falta cada clave en la
/// enumeración. Sin estado compartido fuera de su propio candado.
/// </summary>
public sealed class ControlAusencias
{
    private readonly TimeSpan _gracia;
    private readonly object _candado = new();
    private readonly Dictionary<string, DateTime> _desde = new();

    /// <param name="gracia">Cuánto debe durar una ausencia para darse por extracción.</param>
    public ControlAusencias(TimeSpan gracia)
    {
        _gracia = gracia;
    }

    /// <summary>El dispositivo se vio en esta enumeración: su ausencia, si la había, queda olvidada.</summary>
    public void MarcarPresente(string clave)
    {
        lock (_candado) _desde.Remove(clave);
    }

    /// <summary>
    /// El dispositivo no apareció en esta enumeración. La primera
    /// vez solo se anota el instante y devuelve false; devuelve
    /// true cuando la ausencia ya dura el período de gracia (y
    /// olvida la anotación: la extracción se procesa una vez).
    /// </summary>
    public bool AusenciaConfirmada(string clave, DateTime ahora)
    {
        lock (_candado)
        {
            if (!_desde.TryGetValue(clave, out var inicio))
            {
                _desde[clave] = ahora;
                return false;
            }
            if (ahora - inicio < _gracia) return false;
            _desde.Remove(clave);
            return true;
        }
    }
}
