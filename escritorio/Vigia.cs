// ============================================================
//  USB Monitor — App de escritorio: el vigilante del modo
//  dedicado
// ============================================================
//  En el modo dedicado, el shell de la cuenta del panel no
//  es esta ventana: es este vigilante. Su único trabajo es
//  que la ventana esté siempre abierta: la lanza en modo
//  dedicado (pantalla completa, sin cierre) y, si el
//  proceso muere por lo que sea, la vuelve a lanzar a los
//  pocos segundos. Sin vigilante, una ventana caída en una
//  cuenta sin Explorer dejaría la PC mirando a la nada.
//
//  El vigilante no tiene interfaz: deja constancia en un
//  registro de texto en la carpeta de datos de la app.

using System.Diagnostics;

namespace USBMonitor.Escritorio;

internal sealed class Vigia : ApplicationContext
{
    // Cada cuánto se comprueba si la ventana sigue viva.
    private readonly System.Windows.Forms.Timer _reloj = new() { Interval = 2000 };
    // El proceso de la ventana vigilada, si lo hay.
    private Process? _ventana;
    // Marca de tiempo del último lanzamiento, para no
    // relanzar en bucle cerrado si la ventana muere al nacer.
    private DateTime _ultimoLanzamiento = DateTime.MinValue;

    internal Vigia()
    {
        Registrar("Vigilante iniciado.");
        LanzarVentana();
        _reloj.Tick += (_, _) => Comprobar();
        _reloj.Start();
    }

    // Lanza la ventana en modo dedicado, con el mismo exe.
    private void LanzarVentana()
    {
        try
        {
            _ultimoLanzamiento = DateTime.Now;
            _ventana = Process.Start(new ProcessStartInfo
            {
                FileName = Environment.ProcessPath!,
                Arguments = "--dedicado",
                UseShellExecute = true,
            });
            Registrar($"Ventana lanzada (proceso {_ventana?.Id}).");
        }
        catch (Exception ex)
        {
            Registrar($"No se pudo lanzar la ventana: {ex.Message}");
        }
    }

    // Si la ventana ya no está, se relanza — con una pausa
    // mínima entre lanzamientos para que un fallo al nacer
    // no se convierta en un bucle de procesos.
    private void Comprobar()
    {
        if (_ventana is not null && !_ventana.HasExited) return;
        if ((DateTime.Now - _ultimoLanzamiento).TotalSeconds < 5) return;
        Registrar("La ventana no está: se relanza.");
        LanzarVentana();
    }

    // Registro sencillo en la carpeta de datos: una línea
    // por suceso, y si el archivo crece demasiado se
    // empieza de cero (esto puede correr meses seguidos).
    private static void Registrar(string texto)
    {
        try
        {
            Directory.CreateDirectory(Configuracion.CarpetaDatos);
            var ruta = Path.Combine(Configuracion.CarpetaDatos, "vigia.log");
            if (File.Exists(ruta) && new FileInfo(ruta).Length > 1_000_000)
                File.Delete(ruta);
            File.AppendAllText(ruta, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {texto}\n");
        }
        catch
        {
            // El registro nunca puede tumbar al vigilante.
        }
    }
}
