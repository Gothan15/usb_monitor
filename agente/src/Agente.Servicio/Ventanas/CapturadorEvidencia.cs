using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// La captura en sí de la foto del momento. Vive en el compañero
/// porque es el único proceso del agente dentro de la sesión del
/// usuario: el servicio (sesión 0) no tiene escritorio que
/// fotografiar.
///
/// Cada pieza va envuelta en su propio intento: si la pantalla no
/// se deja capturar (escritorio seguro, sesión a medio bloquear),
/// el paquete sale igualmente con procesos y pestañas, sin imagen
/// y con la nota de por qué. Las pestañas completas son mejor
/// esfuerzo por UI Automation: lo garantizado es la activa de cada
/// ventana, que es el título de la propia ventana del navegador.
/// </summary>
internal static class CapturadorEvidencia
{
    private const int AnchoMaximoCaptura = 1920;
    private const int MaximoProcesos = 200;

    private static readonly Dictionary<string, string> Navegadores = new()
    {
        ["chrome"] = "Chrome",
        ["msedge"] = "Edge",
        ["firefox"] = "Firefox",
    };

    /// <summary>Captura todo lo capturable y arma el paquete.</summary>
    public static PaqueteEvidencia Capturar(SolicitudEvidencia solicitud)
    {
        var paquete = new PaqueteEvidencia
        {
            Clave = solicitud.Clave,
            Serial = solicitud.Serial,
            CapturedAt = DateTime.UtcNow.ToString("o"),
        };
        var notas = new List<string>();

        try
        {
            paquete.ImagenBase64 = CapturarPantallaBase64();
            if (paquete.ImagenBase64 is null)
                notas.Add("No se pudo capturar la pantalla (sin escritorio disponible).");
        }
        catch (Exception ex)
        {
            notas.Add($"No se pudo capturar la pantalla: {ex.Message}");
        }

        try
        {
            var (proceso, titulo) = VentanaEnPrimerPlano();
            paquete.ForegroundProcess = proceso;
            paquete.ForegroundTitle = titulo;
        }
        catch
        {
            // Sin ventana en primer plano legible: el paquete no la lleva.
        }

        try
        {
            paquete.Processes = ProcesosDeLaSesion();
        }
        catch (Exception ex)
        {
            notas.Add($"No se pudo listar los procesos: {ex.Message}");
        }

        try
        {
            var (pestanas, completas) = PestanasDelNavegador();
            paquete.BrowserTabs = pestanas;
            paquete.TabsComplete = completas;
        }
        catch (Exception ex)
        {
            notas.Add($"No se pudieron leer las pestañas: {ex.Message}");
            paquete.TabsComplete = false;
        }

        if (notas.Count > 0)
            paquete.Nota = string.Join(" ", notas);
        return paquete;
    }

    // ── captura de pantalla (GDI → WPF → JPEG) ───────────────────

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int indice);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr ventana);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr ventana, IntPtr dc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleDC(IntPtr dc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int ancho, int alto);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr dc, IntPtr objeto);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr objeto);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool BitBlt(IntPtr dcDestino, int x, int y, int ancho, int alto,
        IntPtr dcOrigen, int xOrigen, int yOrigen, int operacion);

    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;
    private const int SRCCOPY = 0x00CC0020;
    private const int CAPTUREBLT = 0x40000000;

    /// <summary>
    /// La pantalla virtual entera (todos los monitores) en JPEG
    /// base64, calidad 70, escalada a 1920 px de ancho como mucho.
    /// Null si no hay escritorio que capturar.
    /// </summary>
    private static string? CapturarPantallaBase64()
    {
        int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int ancho = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int alto = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (ancho <= 0 || alto <= 0) return null;

        var dcPantalla = GetDC(IntPtr.Zero);
        if (dcPantalla == IntPtr.Zero) return null;
        var dcMemoria = IntPtr.Zero;
        var bitmap = IntPtr.Zero;
        var anterior = IntPtr.Zero;
        try
        {
            dcMemoria = CreateCompatibleDC(dcPantalla);
            bitmap = CreateCompatibleBitmap(dcPantalla, ancho, alto);
            if (dcMemoria == IntPtr.Zero || bitmap == IntPtr.Zero) return null;
            anterior = SelectObject(dcMemoria, bitmap);
            if (!BitBlt(dcMemoria, 0, 0, ancho, alto, dcPantalla, x, y, SRCCOPY | CAPTUREBLT))
                return null;

            BitmapSource imagen = System.Windows.Interop.Imaging
                .CreateBitmapSourceFromHBitmap(
                    bitmap, IntPtr.Zero, Int32Rect.Empty,
                    BitmapSizeOptions.FromEmptyOptions());
            if (ancho > AnchoMaximoCaptura)
            {
                var escala = (double)AnchoMaximoCaptura / ancho;
                imagen = new TransformedBitmap(
                    imagen, new ScaleTransform(escala, escala));
            }
            var codificador = new JpegBitmapEncoder { QualityLevel = 70 };
            codificador.Frames.Add(BitmapFrame.Create(imagen));
            using var flujo = new MemoryStream();
            codificador.Save(flujo);
            return Convert.ToBase64String(flujo.ToArray());
        }
        finally
        {
            if (anterior != IntPtr.Zero && dcMemoria != IntPtr.Zero)
                SelectObject(dcMemoria, anterior);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (dcMemoria != IntPtr.Zero) DeleteDC(dcMemoria);
            ReleaseDC(IntPtr.Zero, dcPantalla);
        }
    }

    // ── ventana en primer plano ──────────────────────────────────

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr ventana, StringBuilder texto, int maximo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr ventana, out uint procesoId);

    /// <summary>Proceso y título de la ventana que el usuario estaba mirando.</summary>
    private static (string? Proceso, string? Titulo) VentanaEnPrimerPlano()
    {
        var ventana = GetForegroundWindow();
        if (ventana == IntPtr.Zero) return (null, null);
        var titulo = new StringBuilder(1024);
        GetWindowText(ventana, titulo, titulo.Capacity);
        string? proceso = null;
        if (GetWindowThreadProcessId(ventana, out var pid) != 0 && pid != 0)
        {
            try { proceso = Process.GetProcessById((int)pid).ProcessName; }
            catch { /* el proceso murió entre medias */ }
        }
        return (proceso, titulo.Length > 0 ? titulo.ToString() : null);
    }

    // ── procesos de la sesión ────────────────────────────────────

    /// <summary>
    /// Procesos en marcha: primero los que tienen ventana (con su
    /// título, que revela el documento abierto), después los
    /// nombres sin ventana, sin duplicados. Tope: 200.
    /// </summary>
    private static List<ProcesoEvidencia> ProcesosDeLaSesion()
    {
        var conVentana = new List<ProcesoEvidencia>();
        var sinVentana = new List<string>();
        var vistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var proceso in Process.GetProcesses())
        {
            try
            {
                var nombre = proceso.ProcessName;
                var titulo = "";
                try { titulo = proceso.MainWindowTitle ?? ""; }
                catch { /* proceso de otra sesión o ya terminado */ }
                if (!string.IsNullOrWhiteSpace(titulo))
                {
                    conVentana.Add(new ProcesoEvidencia
                    {
                        Proceso = nombre,
                        Titulo = titulo.Trim(),
                    });
                }
                else if (vistos.Add(nombre))
                {
                    sinVentana.Add(nombre);
                }
            }
            catch
            {
                // Un proceso que muere a mitad de la enumeración no
                // puede tumbar la lista entera.
            }
            finally
            {
                proceso.Dispose();
            }
        }
        var salida = new List<ProcesoEvidencia>(conVentana);
        foreach (var nombre in sinVentana)
        {
            if (salida.Count >= MaximoProcesos) break;
            salida.Add(new ProcesoEvidencia { Proceso = nombre });
        }
        return salida.Take(MaximoProcesos).ToList();
    }

    // ── pestañas del navegador ───────────────────────────────────

    /// <summary>
    /// Pestañas abiertas. Lo garantizado: la activa de cada ventana
    /// (el título de la ventana). Lo completo, mejor esfuerzo por
    /// UI Automation: enumerar los TabItem de cada ventana de
    /// Chrome/Edge/Firefox; si alguna ventana no se deja, esa
    /// ventana se queda con su activa y el paquete va marcado como
    /// parcial (tabsComplete=false).
    /// </summary>
    private static (List<PestanaNavegador> Pestanas, bool Completas) PestanasDelNavegador()
    {
        var resultado = new List<PestanaNavegador>();
        var completas = true;

        // Ventanas de navegador vivas: (nombre bonito, título, handle).
        var ventanas = new List<(string Navegador, string Titulo, IntPtr Handle)>();
        foreach (var proceso in Process.GetProcesses())
        {
            try
            {
                if (!Navegadores.TryGetValue(proceso.ProcessName.ToLowerInvariant(), out var bonito))
                    continue;
                var titulo = "";
                try { titulo = proceso.MainWindowTitle ?? ""; }
                catch { /* ventana a medio cerrar */ }
                if (proceso.MainWindowHandle != IntPtr.Zero && !string.IsNullOrWhiteSpace(titulo))
                    ventanas.Add((bonito, titulo.Trim(), proceso.MainWindowHandle));
            }
            catch
            {
                // Proceso inaccesible: no es una ventana que contar.
            }
            finally
            {
                proceso.Dispose();
            }
        }

        foreach (var (navegador, titulo, handle) in ventanas)
        {
            var deLaVentana = EnumerarPestanas(handle, navegador);
            if (deLaVentana is null)
            {
                completas = false;
                resultado.Add(new PestanaNavegador { Navegador = navegador, Titulo = titulo });
            }
            else
            {
                resultado.AddRange(deLaVentana);
            }
        }
        return (resultado, completas);
    }

    /// <summary>
    /// TabItem de una ventana por UI Automation, o null si la
    /// ventana no los expone. La URL solo se conoce de la pestaña
    /// seleccionada, si la barra de direcciones la expone.
    /// </summary>
    private static List<PestanaNavegador>? EnumerarPestanas(IntPtr handle, string navegador)
    {
        try
        {
            var raiz = AutomationElement.FromHandle(handle);
            if (raiz is null) return null;
            var condicion = new PropertyCondition(
                AutomationElement.ControlTypeProperty, ControlType.TabItem);
            var elementos = raiz.FindAll(TreeScope.Descendants, condicion);
            if (elementos.Count == 0) return null;

            string? urlActiva = null;
            try { urlActiva = UrlDeLaBarra(raiz); }
            catch { /* la barra no se dejó leer */ }

            var salida = new List<PestanaNavegador>();
            foreach (AutomationElement elemento in elementos)
            {
                var titulo = elemento.Current.Name?.Trim() ?? "";
                if (titulo.Length == 0) continue;
                var seleccionada = false;
                if (elemento.TryGetCurrentPattern(
                        SelectionItemPattern.Pattern, out var patron) &&
                    patron is SelectionItemPattern seleccion)
                {
                    seleccionada = seleccion.Current.IsSelected;
                }
                salida.Add(new PestanaNavegador
                {
                    Navegador = navegador,
                    Titulo = titulo,
                    Url = seleccionada ? urlActiva : null,
                });
            }
            return salida.Count > 0 ? salida : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// La URL escrita en la barra de direcciones de la ventana: el
    /// primer campo de edición cuyo valor parece una URL. Mejor
    /// esfuerzo puro: si no aparece, no hay URL que anotar.
    /// </summary>
    private static string? UrlDeLaBarra(AutomationElement raiz)
    {
        var condicion = new PropertyCondition(
            AutomationElement.ControlTypeProperty, ControlType.Edit);
        var campos = raiz.FindAll(TreeScope.Descendants, condicion);
        foreach (AutomationElement campo in campos)
        {
            if (!campo.TryGetCurrentPattern(ValuePattern.Pattern, out var patron) ||
                patron is not ValuePattern valor)
                continue;
            var texto = valor.Current.Value?.Trim() ?? "";
            if (texto.Contains("://") || texto.StartsWith("www."))
                return texto;
        }
        return null;
    }
}
