// ============================================================
//  USB Monitor — App de escritorio: la ventana principal
// ============================================================
//  Una ventana con barra propia y un WebView2 que ocupa el
//  resto. La ventana aporta lo que el navegador daba gratis
//  y aquí hay que poner a mano:
//
//   · Espera activa: si el panel aún no responde (el equipo
//     está arrancando, el servicio está detenido), enseña
//     una pantalla de espera de la casa y reintenta sola
//     cada pocos segundos, sin el error feo del navegador.
//   · Confinamiento: la navegación se queda en el origen
//     del panel; cualquier enlace a otro sitio se abre en
//     el navegador del sistema, no dentro de la ventana.
//   · Memoria: recuerda tamaño, posición, zoom y la URL
//     fijada a mano; el perfil de WebView2 persiste, así
//     que la sesión del panel sobrevive al cierre.
//   · Atajos: F5 / Ctrl+R recargar, Alt+←/→ atrás/adelante
//     y Ctrl + +/-/0 zoom los trae el propio WebView2; el
//     F11 de pantalla completa se intercepta con un gancho
//     de teclado, porque WebView2 se queda las teclas y el
//     SDK de WinForms no las pasa a la ventana.
//
//  El modo dedicado (que la app tome toda la PC) NO va
//  aquí: es una decisión aparte, para otro paso.

using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace USBMonitor.Escritorio;

internal sealed class VentanaPrincipal : Form
{
    // Colores de la casa (Herencia): papel, carbón y dorado.
    private static readonly Color ColorPapel = Color.FromArgb(0xF5, 0xF3, 0xEF);
    private static readonly Color ColorCarbon = Color.FromArgb(0x26, 0x26, 0x2B);
    private static readonly Color ColorDorado = Color.FromArgb(0xC0, 0x9A, 0x3B);

    private readonly Configuracion _config = Configuracion.Cargar();
    private readonly WebView2 _web = new();
    private readonly Panel _barra = new();
    private readonly Label _etiquetaDireccion = new();
    private readonly Button _botonAtras = new();
    private readonly Button _botonAdelante = new();
    private readonly Panel _espera = new();
    private readonly Label _esperaDetalle = new();
    private readonly System.Windows.Forms.Timer _relojEspera = new() { Interval = 3000 };
    private readonly System.Windows.Forms.Timer _relojPuntos = new() { Interval = 450 };
    private readonly HttpClient _sonda = new(new HttpClientHandler { AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromSeconds(2),
    };

    // La URL del panel que la ventana está usando ahora.
    private string _urlPanel = string.Empty;
    // ¿Está la pantalla de espera puesta? Mientras lo está,
    // el WebView2 no navega: primero responde la sonda.
    private bool _esperando = true;
    // Estado previo a la pantalla completa, para volver.
    private FormBorderStyle _bordeAnterior;
    private bool _pantallaCompleta;

    internal VentanaPrincipal()
    {
        Text = "USB Monitor — Panel";
        BackColor = ColorPapel;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.Manual;
        RestaurarGeometria();

        ConstruirBarra();
        ConstruirEspera();

        // El WebView2 va debajo de la barra y por debajo de
        // la pantalla de espera (que empieza visible).
        _web.Dock = DockStyle.Fill;
        Controls.Add(_web);
        Controls.Add(_espera);
        Controls.Add(_barra);
        _espera.BringToFront();

        // Cada tick de espera es un intento de sonda.
        _relojEspera.Tick += async (_, _) => await SondarAsync();
        // Los puntos suspensivos de la espera, animados.
        _relojPuntos.Tick += (_, _) => AnimarPuntos();

        Shown += async (_, _) => await ArrancarAsync();
        FormClosing += (_, _) => { QuitarGancho(); GuardarEstado(); };
        InstalarGancho();
    }

    // --------------------------------------------------------
    //  Construcción de la interfaz
    // --------------------------------------------------------

    // La barra superior: navegación, dirección y acciones.
    private void ConstruirBarra()
    {
        _barra.Dock = DockStyle.Top;
        _barra.Height = 44;
        _barra.BackColor = ColorPapel;
        _barra.Padding = new Padding(8, 7, 8, 7);

        ConfigurarBoton(_botonAtras, "←", "Atrás (Alt+←)");
        ConfigurarBoton(_botonAdelante, "→", "Adelante (Alt+→)");
        var botonRecargar = new Button();
        ConfigurarBoton(botonRecargar, "⟳", "Recargar (F5)");
        _botonAtras.Click += (_, _) => { if (_web.CoreWebView2?.CanGoBack == true) _web.CoreWebView2.GoBack(); };
        _botonAdelante.Click += (_, _) => { if (_web.CoreWebView2?.CanGoForward == true) _web.CoreWebView2.GoForward(); };
        botonRecargar.Click += (_, _) => Recargar();

        _botonAtras.Left = 8;
        _botonAdelante.Left = 48;
        botonRecargar.Left = 88;

        // La dirección actual, en solo lectura: la ventana
        // no es un navegador y no hay barra de direcciones
        // editable; la URL se cambia desde Ajustes.
        _etiquetaDireccion.AutoEllipsis = true;
        _etiquetaDireccion.ForeColor = ColorCarbon;
        _etiquetaDireccion.TextAlign = ContentAlignment.MiddleLeft;
        _etiquetaDireccion.Left = 132;
        _etiquetaDireccion.Top = 7;
        _etiquetaDireccion.Height = 30;
        _etiquetaDireccion.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;

        var botonNavegador = new Button();
        ConfigurarBotonTexto(botonNavegador, "En el navegador", "Abrir esta página en el navegador del sistema");
        botonNavegador.Click += (_, _) => AbrirEnNavegador();
        var botonAjustes = new Button();
        ConfigurarBotonTexto(botonAjustes, "Ajustes", "Fijar la dirección del panel a mano");
        botonAjustes.Click += (_, _) => MostrarAjustes();
        var botonCompleta = new Button();
        ConfigurarBotonTexto(botonCompleta, "Pantalla completa", "Pantalla completa (F11)");
        botonCompleta.Click += (_, _) => AlternarPantallaCompleta();

        // Los tres botones de la derecha se anclan al borde
        // y se colocan de derecha a izquierda.
        foreach (var (boton, ancho) in new[] { (botonCompleta, 128), (botonAjustes, 76), (botonNavegador, 118) })
        {
            boton.Width = ancho;
            boton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        }
        botonCompleta.Left = _barra.Width - 136;
        botonAjustes.Left = _barra.Width - 220;
        botonNavegador.Left = _barra.Width - 346;
        _etiquetaDireccion.Width = Math.Max(120, _barra.Width - 490);
        _barra.Resize += (_, _) =>
        {
            botonCompleta.Left = _barra.Width - 136;
            botonAjustes.Left = _barra.Width - 220;
            botonNavegador.Left = _barra.Width - 346;
            _etiquetaDireccion.Width = Math.Max(120, _barra.Width - 490);
        };

        _barra.Controls.Add(_botonAtras);
        _barra.Controls.Add(_botonAdelante);
        _barra.Controls.Add(botonRecargar);
        _barra.Controls.Add(_etiquetaDireccion);
        _barra.Controls.Add(botonNavegador);
        _barra.Controls.Add(botonAjustes);
        _barra.Controls.Add(botonCompleta);
    }

    private void ConfigurarBoton(Button boton, string texto, string pista)
    {
        boton.Text = texto;
        boton.Size = new Size(36, 30);
        boton.Top = 7;
        boton.FlatStyle = FlatStyle.Flat;
        boton.FlatAppearance.BorderSize = 0;
        boton.BackColor = ColorPapel;
        boton.ForeColor = ColorCarbon;
        boton.Font = new Font(Font.FontFamily, 11f);
        new ToolTip().SetToolTip(boton, pista);
    }

    private void ConfigurarBotonTexto(Button boton, string texto, string pista)
    {
        boton.Text = texto;
        boton.Size = new Size(100, 30);
        boton.Top = 7;
        boton.FlatStyle = FlatStyle.Flat;
        boton.FlatAppearance.BorderSize = 0;
        boton.BackColor = ColorPapel;
        boton.ForeColor = ColorCarbon;
        boton.Font = new Font(Font.FontFamily, 9f);
        new ToolTip().SetToolTip(boton, pista);
    }

    // La pantalla de espera: papel, brújula en texto y el
    // aviso de que se está reintentando solo.
    private void ConstruirEspera()
    {
        _espera.Dock = DockStyle.Fill;
        _espera.BackColor = ColorPapel;

        var titulo = new Label
        {
            AutoSize = true,
            Text = "Esperando al panel",
            Font = new Font(Font.FontFamily, 20f, FontStyle.Bold),
            ForeColor = ColorCarbon,
        };
        _esperaDetalle.AutoSize = true;
        _esperaDetalle.Font = new Font(Font.FontFamily, 11f);
        _esperaDetalle.ForeColor = ColorCarbon;

        var linea = new Panel { Size = new Size(64, 3), BackColor = ColorDorado };

        var botonReintentar = new Button
        {
            Text = "Reintentar ahora",
            AutoSize = true,
            FlatStyle = FlatStyle.Flat,
            BackColor = ColorCarbon,
            ForeColor = ColorPapel,
            Padding = new Padding(14, 6, 14, 6),
        };
        botonReintentar.FlatAppearance.BorderSize = 0;
        botonReintentar.Click += async (_, _) => await SondarAsync();

        // Todo centrado con una tabla de una columna.
        var tabla = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
        };
        tabla.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var control in new Control[] { titulo, linea, _esperaDetalle, botonReintentar })
        {
            control.Anchor = AnchorStyles.None;
            tabla.Controls.Add(control);
        }
        tabla.RowStyles.Add(new RowStyle(SizeType.Percent, 38));
        tabla.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tabla.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        tabla.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
        _espera.Controls.Add(tabla);
    }

    private int _puntos;
    private void AnimarPuntos()
    {
        _puntos = (_puntos + 1) % 4;
        _esperaDetalle.Text =
            $"El panel no responde todavía en {_urlPanel}{new string('.', _puntos)}\nSe reintenta solo cada pocos segundos.";
    }

    // --------------------------------------------------------
    //  Arranque y espera activa
    // --------------------------------------------------------

    // Al abrirse la ventana: preparar WebView2 con su
    // perfil persistente y entrar en el ciclo de espera
    // hasta que el panel responda.
    private async Task ArrancarAsync()
    {
        _urlPanel = DireccionPanel.UrlEfectiva(_config);
        _etiquetaDireccion.Text = _urlPanel;
        AnimarPuntos();

        try
        {
            // El perfil vive en la carpeta de datos de la
            // app: la sesión del panel (su login) sobrevive
            // así al cierre de la ventana.
            var entorno = await CoreWebView2Environment.CreateAsync(null, Configuracion.CarpetaWebView2);
            await _web.EnsureCoreWebView2Async(entorno);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            // Sin el runtime de WebView2 no hay ventana que
            // valga: aviso claro y salida. En Windows 11 el
            // runtime ya viene con el sistema; el aviso es
            // para equipos viejos o muy recortados.
            MessageBox.Show(this,
                "Este equipo no tiene el componente WebView2 Runtime, que la ventana necesita para enseñar el panel.\n\n" +
                "Se descarga gratis de Microsoft buscando «WebView2 Runtime» (es el mismo componente que usa Edge).",
                "USB Monitor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var nucleo = _web.CoreWebView2;
        nucleo.Settings.IsStatusBarEnabled = false;
        nucleo.Settings.AreDefaultContextMenusEnabled = true;
        nucleo.Settings.AreDevToolsEnabled = true;
        _web.ZoomFactor = Math.Clamp(_config.Zoom, 0.5, 2.0);

        nucleo.NavigationStarting += AlEmpezarNavegacion;
        nucleo.NewWindowRequested += AlPedirVentanaNueva;
        nucleo.DocumentTitleChanged += (_, _) =>
            Text = string.IsNullOrWhiteSpace(nucleo.DocumentTitle)
                ? "USB Monitor — Panel"
                : $"{nucleo.DocumentTitle} — USB Monitor";
        nucleo.SourceChanged += (_, _) => _etiquetaDireccion.Text = _web.Source?.ToString() ?? _urlPanel;
        nucleo.NavigationCompleted += (_, e) =>
        {
            _botonAtras.Enabled = nucleo.CanGoBack;
            _botonAdelante.Enabled = nucleo.CanGoForward;
            // Si el panel se cae a mitad de sesión, se
            // vuelve a la espera activa en vez de dejar el
            // error del navegador en pantalla.
            if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                VolverAEsperar();
        };
        // Los atajos de siempre (F5, Ctrl+R, Alt+←/→, zoom
        // con Ctrl) los ejecuta el propio WebView2 si esta
        // opción está encendida, que es su valor por defecto.
        nucleo.Settings.AreBrowserAcceleratorKeysEnabled = true;

        _relojPuntos.Start();
        _relojEspera.Start();
        await SondarAsync();
    }

    // Una sonda HTTP ligera: cualquier respuesta del
    // servidor (una página, una redirección, incluso un
    // 401) significa que el panel está vivo. Solo el fallo
    // de transporte cuenta como «todavía no».
    private async Task SondarAsync()
    {
        if (!_esperando) return;
        try
        {
            using var respuesta = await _sonda.GetAsync(_urlPanel);
            // Hay panel: fuera la espera y a navegar.
            _esperando = false;
            _relojEspera.Stop();
            _relojPuntos.Stop();
            _espera.Visible = false;
            _web.CoreWebView2?.Navigate(_urlPanel);
        }
        catch
        {
            // Todavía no responde: la espera sigue y el
            // temporizador volverá a intentarlo.
        }
    }

    // De vuelta a la pantalla de espera (el panel se paró
    // o cambió la dirección fijada en los ajustes).
    private void VolverAEsperar()
    {
        _esperando = true;
        _espera.Visible = true;
        _espera.BringToFront();
        AnimarPuntos();
        _relojPuntos.Start();
        _relojEspera.Start();
        _ = SondarAsync();
    }

    // Recargar: en espera, es otra sonda inmediata; con el
    // panel vivo, recarga la página.
    private void Recargar()
    {
        if (_esperando) { _ = SondarAsync(); return; }
        _web.Reload();
    }

    // --------------------------------------------------------
    //  Confinamiento de la navegación
    // --------------------------------------------------------

    // Nada sale de la ventana hacia otro origen: lo que no
    // sea del panel se cancela aquí y se abre en el
    // navegador del sistema.
    private void AlEmpezarNavegacion(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return;
        if (DireccionPanel.EsDelPanel(e.Uri, _urlPanel)) return;
        e.Cancel = true;
        AbrirFuera(e.Uri);
    }

    // Ventanas nuevas (target=_blank y similares): si el
    // destino es del panel, se navega en esta misma
    // ventana; si es de fuera, al navegador del sistema.
    private void AlPedirVentanaNueva(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (DireccionPanel.EsDelPanel(e.Uri, _urlPanel))
            _web.CoreWebView2.Navigate(e.Uri);
        else
            AbrirFuera(e.Uri);
    }

    // Abre una URL en el navegador predeterminado.
    private static void AbrirFuera(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            // Sin navegador disponible no hay nada que
            // hacer: la ventana sigue en el panel.
        }
    }

    private void AbrirEnNavegador()
    {
        var destino = _esperando ? _urlPanel : _web.Source?.ToString() ?? _urlPanel;
        AbrirFuera(destino);
    }

    // --------------------------------------------------------
    //  Ajustes, pantalla completa y atajos
    // --------------------------------------------------------

    // El diálogo de ajustes: si la URL efectiva cambia, se
    // vuelve a la espera y se sonda la nueva dirección.
    private void MostrarAjustes()
    {
        using var dialogo = new DialogoAjustes(_config);
        if (dialogo.ShowDialog(this) != DialogResult.OK) return;
        _config.UrlManual = dialogo.UrlResultante;
        _config.Guardar();
        var nueva = DireccionPanel.UrlEfectiva(_config);
        if (!string.Equals(nueva, _urlPanel, StringComparison.OrdinalIgnoreCase))
        {
            _urlPanel = nueva;
            _etiquetaDireccion.Text = nueva;
            VolverAEsperar();
        }
    }

    // F11: la ventana sin bordes ni barra, ocupándolo todo;
    // otra vez F11 (o el botón) y vuelve como estaba.
    private void AlternarPantallaCompleta()
    {
        if (!_pantallaCompleta)
        {
            _bordeAnterior = FormBorderStyle;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
            _barra.Visible = false;
            _pantallaCompleta = true;
        }
        else
        {
            FormBorderStyle = _bordeAnterior;
            WindowState = FormWindowState.Normal;
            _barra.Visible = true;
            _pantallaCompleta = false;
        }
    }

    // --------------------------------------------------------
    //  El F11, con gancho de teclado de bajo nivel
    // --------------------------------------------------------
    //  WebView2 procesa el teclado en su propio proceso y
    //  no lo pasa a la ventana: ni ProcessCmdKey ni KeyDown
    //  ven una tecla pulsada con el foco en la página, y el
    //  SDK de WinForms no expone el evento de aceleradores
    //  del controlador. Para el F11 (que WebView2 no trae
    //  de serie) queda el gancho global de bajo nivel,
    //  filtrado para actuar solo cuando esta ventana es la
    //  que está en primer plano.

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_F11 = 0x7A;

    private delegate IntPtr GanchoTeclado(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, GanchoTeclado lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    // El delegado se guarda en un campo: si lo recoge el
    // GC, el gancho queda apuntando a memoria muerta.
    private GanchoTeclado? _delegadoGancho;
    private IntPtr _gancho = IntPtr.Zero;

    private void InstalarGancho()
    {
        _delegadoGancho = AlPasarTeclaPorElGancho;
        using var proceso = Process.GetCurrentProcess();
        using var modulo = proceso.MainModule;
        _gancho = SetWindowsHookEx(WH_KEYBOARD_LL, _delegadoGancho,
            GetModuleHandle(modulo?.ModuleName), 0);
    }

    private void QuitarGancho()
    {
        if (_gancho != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_gancho);
            _gancho = IntPtr.Zero;
        }
    }

    private IntPtr AlPasarTeclaPorElGancho(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)
            && Marshal.ReadInt32(lParam) == VK_F11
            && IsHandleCreated && GetForegroundWindow() == Handle)
        {
            // La conmutación se hace en el hilo de la UI y
            // la tecla no sigue su camino: tragada.
            BeginInvoke(AlternarPantallaCompleta);
            return 1;
        }
        return CallNextHookEx(_gancho, nCode, wParam, lParam);
    }

    // --------------------------------------------------------
    //  Geometría y estado guardados
    // --------------------------------------------------------

    // Reabre la ventana donde y como se cerró, si aquella
    // posición sigue cayendo dentro de alguna pantalla.
    private void RestaurarGeometria()
    {
        var bounds = new Rectangle(_config.VentanaX, _config.VentanaY, _config.VentanaAncho, _config.VentanaAlto);
        if (_config.VentanaX >= 0 && Screen.AllScreens.Any(p => p.WorkingArea.IntersectsWith(bounds)))
        {
            Bounds = bounds;
        }
        else
        {
            Bounds = new Rectangle(80, 60, _config.VentanaAncho, _config.VentanaAlto);
        }
        if (_config.VentanaMaximizada) WindowState = FormWindowState.Maximized;
    }

    // Al cerrar: guardar geometría y zoom para la próxima.
    private void GuardarEstado()
    {
        _config.VentanaMaximizada = WindowState == FormWindowState.Maximized;
        if (WindowState == FormWindowState.Normal)
        {
            _config.VentanaX = Bounds.X;
            _config.VentanaY = Bounds.Y;
            _config.VentanaAncho = Bounds.Width;
            _config.VentanaAlto = Bounds.Height;
        }
        if (_web.CoreWebView2 is not null) _config.Zoom = _web.ZoomFactor;
        _config.Guardar();
    }
}
