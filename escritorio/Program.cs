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

namespace USBMonitor.Escritorio;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // Instancia única: dos ventanas del panel serían dos
        // sesiones del mismo WebView2 peleando por el mismo
        // perfil en disco. Con el mutex, la segunda apertura
        // avisa y se cierra sin tocar nada.
        using var mutex = new Mutex(true, @"Local\USBMonitorEscritorio", out bool esLaPrimera);
        if (!esLaPrimera)
        {
            MessageBox.Show(
                "El panel ya está abierto en la app de escritorio.",
                "USB Monitor", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new VentanaPrincipal());
    }
}
