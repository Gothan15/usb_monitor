// -*- coding: utf-8 -*-
// La ventana anti-parpadeo de los dispositivos YA desbloqueados.
//
// Al liberar un dispositivo, su nodo PnP se reactiva y Windows
// lo re-enumera: desaparece de la enumeración unos segundos y
// vuelve. Si esa ausencia se procesa como una extracción de
// verdad, el desbloqueo se cierra en el panel y la reaparición
// se trata como una conexión nueva: otro bloqueo y otra
// contraseña para el mismo dispositivo que nunca se fue (y si
// la contraseña original llega tarde, el panel ya cerró su
// bloqueo y responde «contraseña incorrecta»).
//
// La regla: la «extracción» de un dispositivo liberado no se
// cierra al momento; se anota aquí y solo se da por buena si
// la ventana (90 s) vence sin que el dispositivo reaparezca.
// Si reaparece dentro de la ventana, sigue liberado.
namespace USBMonitor.Agente.Core;

/// <summary>Anota las extracciones de dispositivos liberados y su ventana de gracia.</summary>
public sealed class LiberadosRecientes
{
    /// <summary>Cuánto se espera antes de dar por buena la extracción de un liberado.</summary>
    public static readonly TimeSpan Ventana = TimeSpan.FromSeconds(90);

    private readonly object _candado = new();
    private readonly Dictionary<string, DateTime> _desde = new();

    /// <summary>El dispositivo liberado desapareció de la enumeración en `ahora`.</summary>
    public void Marcar(string clave, DateTime ahora)
    {
        lock (_candado) _desde[clave] = ahora;
    }

    /// <summary>¿La ausencia anotada sigue dentro de la ventana?</summary>
    public bool SigueVigente(string clave, DateTime ahora)
    {
        lock (_candado)
            return _desde.TryGetValue(clave, out var inicio) &&
                   ahora - inicio < Ventana;
    }

    /// <summary>Olvida la anotación (reapareció, o su cierre ya se procesó).</summary>
    public void Olvidar(string clave)
    {
        lock (_candado) _desde.Remove(clave);
    }

    /// <summary>
    /// Devuelve las claves cuya ventana ya venció y las retira
    /// de la lista: su extracción se da por buena y su
    /// desbloqueo se cierra en ese momento.
    /// </summary>
    public List<string> TomarExpiradas(DateTime ahora)
    {
        lock (_candado)
        {
            var vencidas = _desde
                .Where(par => ahora - par.Value >= Ventana)
                .Select(par => par.Key)
                .ToList();
            foreach (var clave in vencidas) _desde.Remove(clave);
            return vencidas;
        }
    }
}
