// ============================================================
//  USB Monitor — App de escritorio del panel
// ============================================================
//  Punto de entrada. La app es una ventana propia para el
//  panel: carga el mismo servidor de siempre en un WebView2,
//  en su dirección única de red, sin abrir el navegador.
//  No sustituye a nada: el panel, los agentes y la bandeja
//  siguen como están; esto es solo otra puerta al panel,
//  pensada para el equipo que lo sirve (y para quien quiera
//  el panel «como un programa» en cualquier PC de la red).
//
//  Tres modos de arranque, según los argumentos:
//
//   · Sin argumentos: la ventana normal.
//   · --dedicado: la ventana en modo dedicado (pantalla
//     completa fija, sin cierre), para la cuenta del modo
//     servidor dedicado.
//   · --vigia: el vigilante del modo dedicado, que es lo
//     que el shell sustituido de esa cuenta arranca: lanza
//     la ventana en --dedicado y la relanza si se cae.

namespace USBMonitor.Escritorio;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var esVigia = args.Contains("--vigia", StringComparer.OrdinalIgnoreCase);
        var esDedicado = args.Contains("--dedicado", StringComparer.OrdinalIgnoreCase);

        // Instancia única por modo: dos ventanas del panel
        // serían dos sesiones del mismo WebView2 peleando
        // por el mismo perfil en disco, y dos vigilantes se
        // lanzarían ventanas el uno al otro. Cada modo tiene
        // su mutex; el vigilante y su ventana conviven porque
        // usan mutex distintos.
        var nombreMutex = esVigia ? @"Local\USBMonitorEscritorioVigia" : @"Local\USBMonitorEscritorio";
        using var mutex = new Mutex(true, nombreMutex, out bool esLaPrimera);
        if (!esLaPrimera)
        {
            // El vigilante duplicado se va en silencio; la
            // ventana duplicada avisa, que es lo que el
            // usuario espera cuando hace doble clic otra vez.
            if (!esVigia)
            {
                MessageBox.Show(
                    "El panel ya está abierto en la app de escritorio.",
                    "USB Monitor", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return;
        }

        ApplicationConfiguration.Initialize();
        if (esVigia)
            Application.Run(new Vigia());
        else
            Application.Run(new VentanaPrincipal(esDedicado));
    }
}
