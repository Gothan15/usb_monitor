// ============================================================
//  USB Monitor — App de escritorio: configuración guardada
// ============================================================
//  Lo poco que la ventana recuerda entre aperturas, en un
//  JSON del usuario en %LOCALAPPDATA%\USBMonitor\Escritorio:
//  la URL fijada a mano (si la hay), el zoom y el tamaño y
//  la posición de la ventana. Nada de credenciales: la
//  sesión del panel la guarda WebView2 en su propia carpeta
//  de datos, como haría un navegador.

using System.Text.Json;

namespace USBMonitor.Escritorio;

internal sealed class Configuracion
{
    // URL que el usuario fijó a mano en los ajustes.
    // Vacía = automática (la de la ruta por defecto).
    public string? UrlManual { get; set; }

    // Factor de zoom de la página (1.0 = 100 %).
    public double Zoom { get; set; } = 1.0;

    // Última geometría de la ventana, para reabrir igual.
    public int VentanaX { get; set; } = -1;
    public int VentanaY { get; set; } = -1;
    public int VentanaAncho { get; set; } = 1280;
    public int VentanaAlto { get; set; } = 820;
    public bool VentanaMaximizada { get; set; }

    // La carpeta de la app dentro de los datos del usuario.
    internal static string CarpetaDatos =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "USBMonitor", "Escritorio");

    private static string RutaArchivo => Path.Combine(CarpetaDatos, "configuracion.json");

    // Donde WebView2 guarda su perfil (sesión, caché): sin
    // esto, cada arranque partiría de un perfil en memoria
    // y el login del panel no sobreviviría al cierre.
    internal static string CarpetaWebView2 => Path.Combine(CarpetaDatos, "WebView2");

    // Lee la configuración guardada; si no hay archivo o
    // está dañado, devuelve los valores por defecto.
    internal static Configuracion Cargar()
    {
        try
        {
            if (File.Exists(RutaArchivo))
            {
                var json = File.ReadAllText(RutaArchivo);
                var config = JsonSerializer.Deserialize<Configuracion>(json);
                if (config is not null) return config;
            }
        }
        catch
        {
            // Un JSON ilegible no puede tumbar la app: se
            // sigue con los valores por defecto y el próximo
            // Guardar() lo reescribe limpio.
        }
        return new Configuracion();
    }

    // Guarda la configuración actual. Los fallos de disco
    // se tragan a propósito: perder un ajuste no es motivo
    // para cerrar la ventana con error.
    internal void Guardar()
    {
        try
        {
            Directory.CreateDirectory(CarpetaDatos);
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(RutaArchivo, json);
        }
        catch
        {
            // Sin más: la app sigue funcionando igual.
        }
    }
}
