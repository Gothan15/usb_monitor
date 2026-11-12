namespace USBMonitor.Agente.Core;

/// <summary>
/// El freno LOCAL de reintentos de la ventana del compañero.
///
/// El panel ya frena la fuerza bruta (bloqueo por cuenta y,
/// desde el PR de intentos fallidos, pausa por equipo), pero
/// la ventana dejaba pulsar «Comprobar» sin fricción: en el
/// registro de ENDUSER-PC del 2026-11-11 hay nueve intentos en
/// 29 segundos, a mano o a cabezazos, y cada uno quemaba un
/// intento de la cuenta hasta bloquearla 15 minutos — el
/// castigo caía también sobre el dueño legítimo que simplemente
/// se equivocó de contraseña dos veces y siguió probando.
///
/// Este freno es la primera línea, en la propia ventana: los
/// dos primeros fallos son gratis (equivocarse es humano) y a
/// partir del tercero se espera, cada vez más. No sustituye a
/// los frenos del panel: aunque alguien parchee la ventana, el
/// servidor sigue sin evaluar de más.
/// </summary>
public static class FrenoReintentos
{
    /// <summary>Fallos seguidos que se toleran sin espera.</summary>
    public const int FallosLibres = 2;

    /// <summary>
    /// Segundos de espera tras N fallos consecutivos: 0 hasta
    /// el segundo; 20 al tercero, y el doble cada vez, con
    /// techo de 5 minutos. Pura, para poder probarla sin
    /// ventana ni reloj.
    /// </summary>
    public static int EsperaSegundos(int fallosConsecutivos)
    {
        if (fallosConsecutivos <= FallosLibres) return 0;
        var pasos = fallosConsecutivos - FallosLibres; // 1, 2, 3…
        // Al quinto paso la cuenta ya pasa del techo (20·2⁴ =
        // 320): se devuelve el techo directamente, sin
        // desplazar de más (el desplazamiento sin acotar
        // desborda el entero con decenas de fallos).
        if (pasos >= 5) return 300;
        return 20 * (1 << (pasos - 1)); // 20, 40, 80, 160
    }
}
