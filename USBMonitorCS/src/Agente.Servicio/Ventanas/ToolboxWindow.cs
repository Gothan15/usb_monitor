using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Caja de herramientas del administrador.
///
/// Estado, control e instalación del servicio, servidor, credencial,
/// acciones de recuperación y cola del registro, todo en UNA sola
/// pantalla de dos columnas sin desplazamiento (ver DISENO-UI.md).
/// Ninguna operación de red, WMI o servicio se ejecuta en el hilo
/// de la ventana.
/// </summary>
public sealed class ToolboxWindow : Window
{
    private const string NombreServicio = "USBMonitorService";

    private readonly Configuracion _config = new();
    private readonly ClientePanel _cliente;
    private readonly Registrador _log = Registro.Obtener("gui");
    private readonly DispatcherTimer _temporizadorEstado;
    private readonly DispatcherTimer _temporizadorRegistro;

    private readonly Ellipse _puntoEstado;
    private readonly TextBlock _textoEstado;
    private readonly TextBlock _textoServicio;
    private readonly TextBlock _textoActualizacion;
    private readonly Button _botonUpdate;
    private readonly Button _botonCancelarUpdate;
    private InfoRelease? _releaseNueva;
    private CancellationTokenSource? _ctsUpdate;
    private bool _descargandoUpdate;
    private readonly TextBlock _textoResumen;
    private readonly TextBlock _textoDueno;
    private readonly List<Button> _botonesServicio = new();
    private readonly Button _botonProbar;
    private readonly TextBox _host;
    private readonly TextBox _puerto;
    private readonly ComboBox _esquema;
    private readonly PasswordBox _codigoEnroll;
    private readonly TextBlock _textoCredencial;
    private readonly TextBox _registro;

    private bool _refrescandoEstado;
    private bool _refrescandoRegistro;
    private bool _operandoServicio;
    private bool _probando;

    // Dueño asignado del equipo según el panel (caché de 30 s).
    private DuenoEquipoRespuesta? _duenoCache;
    private int _duenoCacheEstado;
    private DateTime _duenoCacheCuando = DateTime.MinValue;

    public ToolboxWindow()
    {
        _cliente = new ClientePanel(_config);

        Title = "USBMonitor — Gestión del agente";
        Width = 960;
        Height = 700;
        MinWidth = 900;
        MinHeight = 660;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Tema.AplicarVentana(this);
        // Misma presentación que el compañero remodelado: tonos de
        // blanco, sin azul (pedido de Gothan el 2026-11-07).
        Background = new SolidColorBrush(Color.FromRgb(0xF5, 0xF3, 0xEF));

        // ── Distribución en UNA sola pantalla, sin desplazamiento ──
        // Inspiración (diseños humanos, ver DISENO-UI.md): los
        // ajustes de PowerToys y de macOS agrupan por secciones con
        // etiquetas a la izquierda y controles a la derecha, y las
        // utilidades compactas tipo Raycast enseñan todo de un
        // vistazo. Aquí: cabecera con el estado siempre visible,
        // dos columnas (control a la izquierda, configuración a la
        // derecha) y el registro como cinta inferior de alto fijo.
        // Antes las secciones iban apiladas en una columna con
        // ScrollViewer y había que bajar para llegar al registro.
        var raiz = new Grid { Margin = new Thickness(0) };
        raiz.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        raiz.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        raiz.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        raiz.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        raiz.Children.Add(ConstruirCabecera());

        var estado = ConstruirFranjaEstado(out _puntoEstado, out _textoEstado, out _textoResumen, out _textoDueno);
        estado.Margin = new Thickness(20, 12, 20, 0);
        Grid.SetRow(estado, 1);
        raiz.Children.Add(estado);

        var columnas = new Grid { Margin = new Thickness(20, 12, 20, 12) };
        columnas.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        columnas.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
        columnas.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(columnas, 2);
        raiz.Children.Add(columnas);

        var izquierda = new StackPanel();
        izquierda.Children.Add(ConstruirSeccionServicio(out _textoServicio));
        izquierda.Children.Add(ConstruirSeccionActualizacion(out _textoActualizacion, out _botonUpdate, out _botonCancelarUpdate));
        izquierda.Children.Add(ConstruirSeccionAcciones());
        Grid.SetColumn(izquierda, 0);
        columnas.Children.Add(izquierda);

        var derecha = new StackPanel();
        derecha.Children.Add(ConstruirSeccionServidor(out _host, out _puerto, out _esquema, out _botonProbar));
        derecha.Children.Add(ConstruirSeccionCredencial(out _codigoEnroll, out _textoCredencial));
        Grid.SetColumn(derecha, 2);
        columnas.Children.Add(derecha);

        var registro = ConstruirSeccionRegistro(out _registro);
        registro.Margin = new Thickness(20, 0, 20, 16);
        Grid.SetRow(registro, 3);
        raiz.Children.Add(registro);

        Content = raiz;

        _temporizadorEstado = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _temporizadorEstado.Tick += async (_, _) => await RefrescarEstadoAsync();
        _temporizadorRegistro = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _temporizadorRegistro.Tick += async (_, _) => await RefrescarRegistroAsync();

        Loaded += async (_, _) =>
        {
            await RefrescarEstadoAsync();
            await RefrescarRegistroAsync();
            await ComprobarUpdateGitHubAsync(silencioso: true);
            _temporizadorEstado.Start();
            _temporizadorRegistro.Start();
        };

        Closed += (_, _) =>
        {
            _temporizadorEstado.Stop();
            _temporizadorRegistro.Stop();
            _cliente.Dispose();
        };
    }

    // ── Construcción de secciones ────────────────────────────────

    private static Border ConstruirCabecera()
    {
        var marca = new TextBlock
        {
            Text = "USBMONITOR",
            FontFamily = Tema.FuenteTexto,
            FontSize = 10.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x8A, 0x8F, 0x98))
        };
        marca.SetValue(Typography.CapitalsProperty, FontCapitals.SmallCaps);
        var titulo = new TextBlock
        {
            Text = "Gestión del agente",
            FontFamily = new FontFamily("Segoe UI Light"),
            FontSize = 20,
            Foreground = new SolidColorBrush(Color.FromRgb(0x22, 0x25, 0x2A)),
            Margin = new Thickness(0, 1, 0, 0)
        };
        var subtitulo = new TextBlock
        {
            Text = "Herramienta interna del equipo — todo en una pantalla, sin desplazarse.",
            FontFamily = Tema.FuenteTexto,
            FontSize = 12,
            Foreground = Tema.TintaAtenuada,
            Margin = new Thickness(0, 2, 0, 0)
        };
        var textos = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0)
        };
        textos.Children.Add(marca);
        textos.Children.Add(titulo);
        textos.Children.Add(subtitulo);

        var fila = new Grid();
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var icono = CrearIconoMarca();
        Grid.SetColumn(icono, 0);
        Grid.SetColumn(textos, 1);
        fila.Children.Add(icono);
        fila.Children.Add(textos);

        var degradado = new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(0, 1)
        };
        degradado.GradientStops.Add(new GradientStop(Color.FromRgb(0xFC, 0xFC, 0xFA), 0));
        degradado.GradientStops.Add(new GradientStop(Color.FromRgb(0xEF, 0xED, 0xE6), 1));

        var pila = new StackPanel();
        pila.Children.Add(new Border
        {
            Background = degradado,
            Padding = new Thickness(20, 13, 20, 12),
            Child = fila
        });
        pila.Children.Add(new Border
        {
            Height = 2,
            Background = new SolidColorBrush(Color.FromRgb(0xC0, 0x9A, 0x3B))
        });
        return new Border { Child = pila };
    }

    private static Border ConstruirFranjaEstado(
        out Ellipse punto,
        out TextBlock textoEstado,
        out TextBlock textoResumen,
        out TextBlock textoDueno)
    {
        var contenido = new StackPanel();

        // Estado general: palabra con punto de color, como el panel.
        var filaEstado = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center
        };
        punto = Tema.PuntoEstado(Tema.Ambar);
        filaEstado.Children.Add(punto);
        textoEstado = new TextBlock
        {
            Text = "Consultando…",
            FontFamily = Tema.FuenteTexto,
            FontSize = 13.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = Tema.Tinta
        };
        filaEstado.Children.Add(textoEstado);
        contenido.Children.Add(filaEstado);

        textoResumen = Tema.TextoDatos("servidor — · bloqueados ahora: —", 12);
        textoResumen.Foreground = Tema.TintaAtenuada;
        textoResumen.Margin = new Thickness(16, 4, 0, 0);
        contenido.Children.Add(textoResumen);

        textoDueno = Tema.TextoDatos("dueño asignado: …", 12);
        textoDueno.Foreground = Tema.TintaAtenuada;
        textoDueno.Margin = new Thickness(16, 2, 0, 0);
        textoDueno.TextWrapping = TextWrapping.Wrap;
        contenido.Children.Add(textoDueno);

        return TarjetaCalida(contenido, new Thickness(0), new Thickness(16, 12, 16, 12));
    }

    private Border ConstruirSeccionServicio(out TextBlock textoServicio)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Servicio"));

        textoServicio = Tema.TextoDatos("servicio: …", 12.5);
        textoServicio.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(textoServicio);

        var fila = new UniformGrid { Columns = 3 };
        fila.Children.Add(BotonServicio("Iniciar", "start", "Iniciando…"));
        fila.Children.Add(BotonServicio("Detener", "stop", "Deteniendo…"));
        var reiniciar = BotonServicio("Reiniciar", "restart", "Reiniciando…");
        reiniciar.Margin = new Thickness(0);
        fila.Children.Add(reiniciar);
        contenido.Children.Add(fila);

        var filaInstalacion = new UniformGrid { Columns = 2, Margin = new Thickness(0, 8, 0, 0) };
        var instalar = Tema.BotonPrimario("Instalar servicio");
        instalar.Background = Carbon;
        instalar.BorderBrush = Carbon;
        instalar.Click += async (_, _) => await InstalarAsync(instalar);
        _botonesServicio.Add(instalar);
        filaInstalacion.Children.Add(instalar);

        var desinstalar = Tema.BotonSecundario("Desinstalar servicio");
        desinstalar.Margin = new Thickness(0);
        desinstalar.Click += async (_, _) => await DesinstalarAsync(desinstalar);
        _botonesServicio.Add(desinstalar);
        filaInstalacion.Children.Add(desinstalar);
        contenido.Children.Add(filaInstalacion);

        return TarjetaCalida(contenido, new Thickness(0, 0, 0, 12), new Thickness(16));
    }

    private Border ConstruirSeccionActualizacion(
        out TextBlock textoActualizacion, out Button botonUpdate,
        out Button botonCancelar)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Actualización"));

        // La versión DEL ARCHIVO: la que el ejecutable declara en
        // su propio recurso de versión (la misma que el panel lee
        // del paquete), no una cadena escrita a mano en el código.
        var instalada = Tema.TextoDatos(
            $"Versión del archivo: {ClienteGitHub.VersionArchivoActual() ?? ClientePanel.VersionAgente}",
            12.5);
        instalada.Margin = new Thickness(0, 0, 0, 6);
        contenido.Children.Add(instalada);

        textoActualizacion = Tema.TextoDatos(
            "Pulsa «Buscar actualizaciones» para ver si GitHub " +
            "tiene una versión más nueva que la de este archivo.", 12.5);
        textoActualizacion.TextWrapping = TextWrapping.Wrap;
        textoActualizacion.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(textoActualizacion);

        var fila = new UniformGrid { Columns = 2 };
        botonUpdate = Tema.BotonPrimario("Buscar actualizaciones");
        botonUpdate.Background = Carbon;
        botonUpdate.BorderBrush = Carbon;
        botonUpdate.Click += async (_, _) => await AlPulsarBotonUpdateAsync();
        fila.Children.Add(botonUpdate);

        botonCancelar = Tema.BotonSecundario("Cancelar");
        botonCancelar.Margin = new Thickness(0);
        botonCancelar.Visibility = Visibility.Collapsed;
        botonCancelar.Click += (_, _) => _ctsUpdate?.Cancel();
        fila.Children.Add(botonCancelar);
        contenido.Children.Add(fila);

        return TarjetaCalida(contenido, new Thickness(0, 0, 0, 12), new Thickness(16));
    }

    /// <summary>
    /// El único botón de la sección cambia con el estado: primero
    /// busca; si hay versión nueva, SE SUSTITUYE por el de
    /// actualizar; si una descarga quedó a medias, por el de
    /// reanudar (lo bajado se conserva en el temporal).
    /// </summary>
    private async Task AlPulsarBotonUpdateAsync()
    {
        if (_descargandoUpdate) return;
        if (_releaseNueva is null)
            await ComprobarUpdateGitHubAsync(silencioso: false);
        else
            await DescargarYAplicarUpdateAsync();
    }

    private async Task ComprobarUpdateGitHubAsync(bool silencioso)
    {
        _botonUpdate.IsEnabled = false;
        if (!silencioso)
            _textoActualizacion.Text = "Comprobando en GitHub…";
        try
        {
            var release = await ClienteGitHub.UltimaReleaseAsync();
            var actual = ClienteGitHub.VersionArchivoActual();
            if (release is null)
            {
                if (!silencioso)
                    _textoActualizacion.Text =
                        "No se pudo comprobar: GitHub no responde. " +
                        "¿Tiene internet esta PC?";
                return;
            }
            if (ClienteGitHub.CompararVersiones(release.Version, actual) > 0)
            {
                _releaseNueva = release;
                var parcial = RutaZipParcial(release);
                var avisoParcial = File.Exists(parcial)
                    ? " Ya hay una descarga empezada: se reanudará."
                    : "";
                _textoActualizacion.Text =
                    $"Hay una versión más nueva: la v{release.Version} " +
                    $"(este archivo es la v{actual ?? "?"}).{avisoParcial}";
                _botonUpdate.Content = $"Actualizar a v{release.Version}";
            }
            else
            {
                _textoActualizacion.Text =
                    $"Este equipo está al día: la última Release es " +
                    $"la v{release.Version}.";
            }
        }
        catch (Exception exc)
        {
            _log.Error($"Comprobar actualización en GitHub: {exc.Message}");
            if (!silencioso)
                _textoActualizacion.Text = "No se pudo comprobar la actualización.";
        }
        finally
        {
            _botonUpdate.IsEnabled = true;
        }
    }

    private static string CarpetaUpdate() =>
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "USBMonitorActualizacion");

    private static string RutaZipParcial(InfoRelease release) =>
        System.IO.Path.Combine(CarpetaUpdate(),
            $"USBMonitorService-{release.Etiqueta}.zip.parcial");

    private async Task DescargarYAplicarUpdateAsync()
    {
        var release = _releaseNueva!;
        _descargandoUpdate = true;
        _ctsUpdate = new CancellationTokenSource();
        _botonUpdate.IsEnabled = false;
        _botonUpdate.Content = "Descargando…";
        _botonCancelarUpdate.Visibility = Visibility.Visible;
        var parcial = RutaZipParcial(release);
        try
        {
            var progreso = new Progress<double>(p =>
                _textoActualizacion.Text =
                    $"Descargando la v{release.Version} de GitHub… {p:P0} " +
                    $"({p * release.TamanoZip / 1048576:0} de {release.TamanoZip / 1048576:0} MB). " +
                    "Si la red corta, lo bajado se conserva y se reanuda.");
            var ok = await ClienteGitHub.DescargarZipAsync(
                release, parcial, progreso, _ctsUpdate.Token);
            if (!ok)
            {
                _textoActualizacion.Text =
                    "La descarga no se pudo completar tras varios " +
                    "intentos. Lo bajado se conserva en esta PC: " +
                    "pulsa «Reanudar descarga» para seguir desde ahí.";
                _botonUpdate.Content = "Reanudar descarga";
                return;
            }

            _textoActualizacion.Text =
                "Descarga completa. Comprobando el archivo…";
            var carpeta = CarpetaUpdate();
            var rutaNuevo = System.IO.Path.Combine(carpeta, "USBMonitorService.exe.nuevo");
            using (var zip = System.IO.Compression.ZipFile.OpenRead(parcial))
            {
                var entrada = zip.Entries.FirstOrDefault(e =>
                    e.Name.Equals("USBMonitorService.exe",
                        StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidOperationException(
                        "El zip de la Release no trae USBMonitorService.exe.");
                using var origen = entrada.Open();
                using var destino = File.Create(rutaNuevo);
                await origen.CopyToAsync(destino, _ctsUpdate.Token);
            }
            try { File.Delete(parcial); } catch { /* el zip ya cumplió */ }

            // La prueba de que bajó EL archivo correcto: el exe
            // descargado declara en su PE la versión de la Release.
            var versionLeida = ClienteGitHub.VersionDeArchivo(rutaNuevo);
            if (ClienteGitHub.CompararVersiones(versionLeida, release.Version) != 0)
            {
                _textoActualizacion.Text =
                    $"El archivo descargado dice ser la versión " +
                    $"{versionLeida ?? "desconocida"} y no la " +
                    $"v{release.Version}: no se aplica.";
                _botonUpdate.Content = $"Actualizar a v{release.Version}";
                return;
            }

            await AplicarUpdateAsync(rutaNuevo, release);
        }
        catch (OperationCanceledException)
        {
            _textoActualizacion.Text =
                "Descarga cancelada: lo bajado se queda guardado y " +
                "se reanudará la próxima vez.";
            _botonUpdate.Content = "Reanudar descarga";
        }
        catch (Exception exc)
        {
            _log.Error($"Descargar/aplicar actualización: {exc.Message}");
            _textoActualizacion.Text =
                $"No se pudo completar la actualización: {exc.Message}";
            _botonUpdate.Content = $"Actualizar a v{release.Version}";
        }
        finally
        {
            _descargandoUpdate = false;
            _botonCancelarUpdate.Visibility = Visibility.Collapsed;
            _botonUpdate.IsEnabled = true;
            _ctsUpdate?.Dispose();
            _ctsUpdate = null;
        }
    }

    /// <summary>
    /// Lanza la copia aplicadora (el modo «aplicar-actualizacion»
    /// del propio programa, el mismo que usa el servicio cuando
    /// el panel manda la orden) con elevación, porque parar el
    /// servicio y sustituir el ejecutable la exige. La aplicadora
    /// cierra los procesos del exe instalado — esta ventana
    /// incluida —, así que la caja se despide y se cierra sola.
    /// </summary>
    private async Task AplicarUpdateAsync(string rutaNuevo, InfoRelease release)
    {
        string instalado;
        try
        {
            instalado = Instalador.RutaExeInstalado();
        }
        catch (Exception exc)
        {
            _textoActualizacion.Text =
                $"No se localizó el ejecutable instalado: {exc.Message}";
            _botonUpdate.Content = $"Actualizar a v{release.Version}";
            return;
        }

        var carpeta = CarpetaUpdate();
        var aplicador = System.IO.Path.Combine(carpeta, "USBMonitorAplicador.exe");
        File.Copy(instalado, aplicador, overwrite: true);
        try
        {
            var proceso = Process.Start(new ProcessStartInfo
            {
                FileName = aplicador,
                Arguments = $"aplicar-actualizacion \"{rutaNuevo}\"",
                UseShellExecute = true,
                Verb = "runas",
                WorkingDirectory = carpeta,
            });
            if (proceso is null)
                throw new InvalidOperationException("Process.Start devolvió null.");
        }
        catch (System.ComponentModel.Win32Exception)
        {
            _textoActualizacion.Text =
                "Se necesitan permisos de administrador para aplicar " +
                "la actualización (acepta el aviso de Windows).";
            _botonUpdate.Content = $"Actualizar a v{release.Version}";
            return;
        }

        _textoActualizacion.Text =
            $"Aplicando la v{release.Version}: el servicio se " +
            "reiniciará con la versión nueva y esta ventana se " +
            "cerrará. Vuelve a abrirla para comprobar la versión " +
            "del archivo.";
        _botonUpdate.Content = "Aplicando…";
        _botonUpdate.IsEnabled = false;
        await Task.Delay(1800);
        Close();
    }

    private Button BotonServicio(string texto, string accion, string gerundio)
    {
        var boton = Tema.BotonSecundario(texto);
        boton.Click += async (_, _) => await ControlarServicioAsync(accion, boton, gerundio);
        _botonesServicio.Add(boton);
        return boton;
    }

    private Border ConstruirSeccionServidor(
        out TextBox host,
        out TextBox puerto,
        out ComboBox esquema,
        out Button botonProbar)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Servidor"));

        contenido.Children.Add(FilaCampo("Host / IP", host = Tema.CampoTexto(datos: true)));
        ResaltarAlEnfocar(host);
        _host.Text = _config.HostServidor;

        // Puerto y esquema comparten fila: son los dos datos cortos
        // del servidor y así la tarjeta no crece hacia abajo.
        var filaDoble = new Grid { Margin = new Thickness(0, 0, 0, 2) };
        filaDoble.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(92) });
        filaDoble.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(96) });
        filaDoble.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(70) });
        filaDoble.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var etiquetaPuerto = Tema.EtiquetaCampo("Puerto");
        etiquetaPuerto.Margin = new Thickness(0, 5, 0, 0);
        filaDoble.Children.Add(etiquetaPuerto);
        puerto = Tema.CampoTexto(datos: true);
        ResaltarAlEnfocar(puerto);
        Grid.SetColumn(puerto, 1);
        filaDoble.Children.Add(puerto);
        _puerto.Text = _config.PuertoServidor.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var etiquetaEsquema = Tema.EtiquetaCampo("Esquema");
        etiquetaEsquema.Margin = new Thickness(10, 5, 0, 0);
        Grid.SetColumn(etiquetaEsquema, 2);
        filaDoble.Children.Add(etiquetaEsquema);
        esquema = Tema.Selector();
        esquema.Items.Add("http");
        esquema.Items.Add("https");
        esquema.SelectedItem = _config.EsquemaServidor;
        Grid.SetColumn(esquema, 3);
        filaDoble.Children.Add(esquema);
        contenido.Children.Add(filaDoble);

        var botones = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 8, 0, 0)
        };
        var guardar = Tema.BotonPrimario("Guardar servidor");
        guardar.Background = Carbon;
        guardar.BorderBrush = Carbon;
        guardar.Click += (_, _) => GuardarServidor();
        botones.Children.Add(guardar);

        botonProbar = Tema.BotonSecundario("Probar conexión");
        botonProbar.Margin = new Thickness(0);
        botonProbar.Click += async (_, _) => await ProbarConexionAsync();
        botones.Children.Add(botonProbar);
        contenido.Children.Add(botones);

        return TarjetaCalida(contenido, new Thickness(0, 0, 0, 12), new Thickness(16));
    }

    private static Grid FilaCampo(string etiqueta, Control campo)
    {
        var fila = new Grid { Margin = new Thickness(0, 0, 0, 7) };
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(92) });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var texto = Tema.EtiquetaCampo(etiqueta);
        texto.Margin = new Thickness(0, 5, 0, 0);
        Grid.SetColumn(texto, 0);
        fila.Children.Add(texto);
        Grid.SetColumn(campo, 1);
        fila.Children.Add(campo);
        return fila;
    }

    private Border ConstruirSeccionCredencial(
        out PasswordBox codigo, out TextBlock textoCredencial)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Credencial del equipo"));

        textoCredencial = Tema.TextoDatos(TextoEstadoCredencial(), 12.5);
        textoCredencial.TextWrapping = TextWrapping.Wrap;
        textoCredencial.Margin = new Thickness(0, 0, 0, 8);
        contenido.Children.Add(textoCredencial);

        contenido.Children.Add(Tema.EtiquetaCampo("Código de enrolamiento (para dar de alta o recuperar)"));
        codigo = Tema.CampoContrasena();
        codigo.Margin = new Thickness(0, 0, 0, 8);
        contenido.Children.Add(codigo);

        var enrolar = Tema.BotonPrimario("Enrolar con el código");
        enrolar.Background = Carbon;
        enrolar.BorderBrush = Carbon;
        enrolar.Click += async (_, _) => await EnrolarDesdeCajaAsync();
        contenido.Children.Add(enrolar);

        var nota = Tema.TextoDatos(
            "El código lo genera el administrador en Equipos → " +
            "Credencial del equipo; vale 30 minutos y se gasta al " +
            "usarlo. La clave de este equipo nace aquí y nunca sale " +
            "de la PC. Revocar la credencial se hace en el panel.",
            11.5);
        nota.TextWrapping = TextWrapping.Wrap;
        nota.Margin = new Thickness(0, 8, 0, 0);
        contenido.Children.Add(nota);

        return TarjetaCalida(contenido, new Thickness(0, 0, 0, 12), new Thickness(16));
    }

    /// <summary>Con qué se acredita hoy este equipo, en una frase.</summary>
    private string TextoEstadoCredencial()
    {
        if (_config.TieneClave)
        {
            var huella = _cliente.Identidad?.Huella;
            return huella is not null
                ? $"Clave registrada en el panel (huella {huella[..12]}…). Este equipo firma sus peticiones."
                : "Clave presente en esta PC.";
        }
        if (_config.CodigoEnrolamiento is not null)
            return "Hay un código de enrolamiento pendiente: el servicio lo gastará al arrancar para registrar la clave.";
        if (_config.TokenLegado is not null)
            return "Este equipo aún guarda el token del sistema anterior: se migrará solo a la clave en cuanto el servicio hable con el panel.";
        return "Sin credencial: este equipo no puede hablar con el panel. Enrola con un código.";
    }

    private async Task EnrolarDesdeCajaAsync()
    {
        string codigo = _codigoEnroll.Password.Trim();
        if (string.IsNullOrWhiteSpace(codigo))
        {
            Tema.AvisarError("Escribe el código de enrolamiento.", "Vacío");
            return;
        }
        var ok = await _cliente.EnrolarConCodigoAsync(codigo);
        _codigoEnroll.Clear();
        if (ok)
        {
            _textoCredencial.Text = TextoEstadoCredencial();
            Tema.Avisar(
                "El panel registró la clave de este equipo. Reinicia el servicio para que firme ya con ella.",
                "Equipo enrolado");
        }
        else
        {
            Tema.AvisarError(
                "El panel no aceptó el código. Comprueba que sea el " +
                "vigente para este equipo (caduca a los 30 minutos y " +
                "se gasta al primer uso) y que el panel responda.",
                "Credencial");
        }
    }

    private Border ConstruirSeccionAcciones()
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Acciones"));

        var rejilla = new UniformGrid { Columns = 2 };
        var restaurar = Tema.BotonDestructivo("Restaurar todo");
        restaurar.Click += async (_, _) => await RestaurarTodoAsync(restaurar);
        rejilla.Children.Add(restaurar);

        var emergencia = Tema.BotonSecundario("Página de emergencia");
        emergencia.Margin = new Thickness(0);
        emergencia.Click += (_, _) => AbrirEmergencia();
        rejilla.Children.Add(emergencia);

        var companero = Tema.BotonSecundario("Compañero");
        companero.Margin = new Thickness(0, 8, 8, 0);
        companero.Click += (_, _) => LanzarModo("prompt");
        rejilla.Children.Add(companero);

        var visor = Tema.BotonSecundario("Visor de seriales");
        visor.Margin = new Thickness(0, 8, 0, 0);
        visor.Click += (_, _) => LanzarModo("visor");
        rejilla.Children.Add(visor);

        contenido.Children.Add(rejilla);
        return TarjetaCalida(contenido, new Thickness(0), new Thickness(16));
    }

    private Border ConstruirSeccionRegistro(out TextBox registro)
    {
        var contenido = new StackPanel();

        var cabecera = new Grid { Margin = new Thickness(0, 0, 0, 7) };
        cabecera.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cabecera.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var etiqueta = Tema.EtiquetaSeccion("Registro · últimas líneas");
        etiqueta.Margin = new Thickness(0);
        cabecera.Children.Add(etiqueta);
        var abrir = Tema.BotonSecundario("Abrir registro completo");
        abrir.Margin = new Thickness(0);
        abrir.Padding = new Thickness(10, 3, 10, 3);
        abrir.FontSize = 12;
        abrir.Click += (_, _) => AbrirRegistroCompleto();
        Grid.SetColumn(abrir, 1);
        cabecera.Children.Add(abrir);
        contenido.Children.Add(cabecera);

        // Cinta de alto fijo SIN barras: enseña siempre la cola del
        // registro (RefrescarRegistroAsync se queda pegado al
        // final) y el archivo entero se abre con el botón.
        registro = new TextBox
        {
            Height = 78,
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            Background = new SolidColorBrush(Color.FromRgb(0xEF, 0xEE, 0xE9)),
            Foreground = Tema.Tinta,
            BorderBrush = new SolidColorBrush(Color.FromRgb(0xD8, 0xD3, 0xC8)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8),
            FontFamily = Tema.FuenteDatos,
            FontSize = 11.5
        };
        contenido.Children.Add(registro);
        return TarjetaCalida(contenido, new Thickness(0), new Thickness(16, 12, 16, 12));
    }

    // ── Piezas de la presentación remodelada (como el compañero) ──

    /// <summary>Carbón neutro de los botones principales (sin azul).</summary>
    private static readonly Brush Carbon =
        new SolidColorBrush(Color.FromRgb(0x26, 0x26, 0x2B));

    /// <summary>Tarjeta del tema con el borde en gris cálido.</summary>
    private static Border TarjetaCalida(
        UIElement contenido, Thickness margen, Thickness relleno)
    {
        var tarjeta = Tema.Tarjeta(contenido, margen, relleno);
        tarjeta.BorderBrush =
            new SolidColorBrush(Color.FromRgb(0xD8, 0xD3, 0xC8));
        return tarjeta;
    }

    /// <summary>Al enfocar un campo, su borde pasa a dorado oscuro.</summary>
    private static void ResaltarAlEnfocar(Control campo)
    {
        campo.GotFocus += (_, _) =>
            campo.BorderBrush = new SolidColorBrush(Color.FromRgb(0xA8, 0x82, 0x2F));
        campo.LostFocus += (_, _) => campo.BorderBrush = Tema.Borde;
    }

    /// <summary>
    /// La marca de la casa: la brújula NORTHSTAR del tema claro,
    /// desde su PNG propio incrustado. Antes se decodificaba el
    /// .ico del programa y, si esa decodificación fallaba, la
    /// reserva era una baldosa carbón lisa: en la práctica, un
    /// «icono negro» que parecía la marca rota. El PNG no tiene
    /// ese modo de fallo y la reserva nueva es la inicial dorada.
    /// </summary>
    private static UIElement CrearIconoMarca()
    {
        try
        {
            var imagen = new Image
            {
                Source = new System.Windows.Media.Imaging.BitmapImage(
                    new Uri("pack://application:,,,/brujula-clara-256.png", UriKind.Absolute)),
                Width = 36,
                Height = 36,
                Stretch = Stretch.Uniform
            };
            RenderOptions.SetBitmapScalingMode(
                imagen, BitmapScalingMode.HighQuality);
            return imagen;
        }
        catch
        {
            // Reserva: la inicial de la marca en dorado, jamás una
            // baldosa negra.
            var borde = new Border
            {
                Width = 36,
                Height = 36,
                CornerRadius = new CornerRadius(9),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0xC0, 0x9A, 0x3B)),
                BorderThickness = new Thickness(1.5)
            };
            borde.Child = new TextBlock
            {
                Text = "N",
                FontFamily = Tema.FuenteTexto,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0xC0, 0x9A, 0x3B)),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            return borde;
        }
    }

    private void AbrirRegistroCompleto()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = DatosVentanas.RutaAgenteLog,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Tema.AvisarError(
                $"No se pudo abrir el registro: {ex.Message}",
                "Registro");
            _log.Excepcion("No se pudo abrir el registro completo desde la caja de herramientas", ex);
        }
    }

    // ── Estado ───────────────────────────────────────────────────

    private async Task RefrescarEstadoAsync()
    {
        if (_refrescandoEstado)
        {
            return;
        }
        _refrescandoEstado = true;

        try
        {
            EstadoFoto foto = await Task.Run(ObtenerEstado);
            _textoServicio.Text = $"servicio: {foto.Servicio}";
            _textoResumen.Text =
                $"servidor {foto.UrlBase} · bloqueados ahora: {foto.Bloqueados} · " +
                $"nodos por restaurar: {foto.NodosPorRestaurar}";
            _textoDueno.Text = foto.Dueno;
            _textoDueno.Foreground = foto.Dueno.Contains("SIN ASIGNAR")
                ? Tema.Ambar
                : Tema.TintaAtenuada;

            string palabraServicio = foto.Servicio switch
            {
                "en ejecución" => "En ejecución",
                "detenido" => "Detenido",
                "no instalado" => "No instalado",
                "sin acceso" => "Sin acceso",
                _ => foto.Servicio
            };
            _textoEstado.Text = $"{palabraServicio} · {foto.Conexion}";
            _puntoEstado.Fill = foto.Servicio switch
            {
                "en ejecución" when foto.Conexion == "Sin conexión" => Tema.Rojo,
                "en ejecución" => Tema.Verde,
                "detenido" => Tema.Rojo,
                _ => Tema.Ambar
            };
            // El punto respira solo con el servicio en marcha y
            // conectado: es la señal de «vivo» de la franja.
            if (foto.Servicio == "en ejecución" && foto.Conexion != "Sin conexión")
            {
                Tema.Pulsar(_puntoEstado);
            }
            else
            {
                Tema.DetenerPulso(_puntoEstado);
            }
        }
        catch (Exception ex)
        {
            _log.Excepcion("No se pudo refrescar el estado de la caja de herramientas", ex);
        }
        finally
        {
            _refrescandoEstado = false;
        }
    }

    private EstadoFoto ObtenerEstado()
    {
        string servicio;
        try
        {
            using var controlador = new ServiceController(NombreServicio);
            controlador.Refresh();
            servicio = controlador.Status switch
            {
                ServiceControllerStatus.Running => "en ejecución",
                ServiceControllerStatus.Stopped => "detenido",
                ServiceControllerStatus.StartPending => "arrancando…",
                ServiceControllerStatus.StopPending => "deteniéndose…",
                ServiceControllerStatus.Paused => "en pausa",
                _ => "desconocido"
            };
        }
        catch (InvalidOperationException)
        {
            servicio = "no instalado";
        }
        catch (Exception)
        {
            servicio = "sin acceso";
        }

        int bloqueados = 0;
        try
        {
            string ruta = DatosVentanas.RutaBloqueosLocales;
            if (File.Exists(ruta))
            {
                using JsonDocument documento = JsonDocument.Parse(File.ReadAllText(ruta));
                if (documento.RootElement.ValueKind == JsonValueKind.Array)
                {
                    bloqueados = documento.RootElement.GetArrayLength();
                }
            }
        }
        catch
        {
            // El resumen no debe tumbar la ventana.
        }

        int nodos = 0;
        try
        {
            nodos = new Diario().DispositivosDeshabilitados.Count;
        }
        catch
        {
            // Sin diario legible: se informa cero y el servicio lo reconcilia.
        }

        SaludConexion salud = _cliente.Salud();
        string conexion = salud.UltimaLlamada.Cuando is null
            ? "Conexión sin comprobar"
            : salud.UltimaLlamada.Ok ? "Conectado" : "Sin conexión";

        return new EstadoFoto(servicio, _config.UrlBase, bloqueados, nodos, conexion, TextoDueno());
    }

    /// <summary>
    /// Línea del dueño asignado: se pregunta al panel como mucho
    /// cada 30 s y se cachea. Es la respuesta a «¿de quién es la
    /// contraseña que vale en esta PC?»: sin dueño asignado, un
    /// usuario normal NO puede desbloquear aunque su contraseña
    /// sea correcta, y eso hay que verlo aquí sin abrir el panel.
    /// </summary>
    private string TextoDueno()
    {
        if (DateTime.Now - _duenoCacheCuando > TimeSpan.FromSeconds(30))
        {
            try
            {
                var resultado = _cliente.DuenoEquipoAsync().GetAwaiter().GetResult();
                _duenoCache = resultado.Datos;
                _duenoCacheEstado = resultado.EstadoHttp;
                _duenoCacheCuando = DateTime.Now;
            }
            catch
            {
                // Se conserva la última foto buena.
            }
        }

        if (_duenoCache is { } datos)
        {
            if (datos.UnlockMode == "ADMIN_ONLY")
            {
                return "dueño asignado: da igual — esta PC está en modo «solo administradores»";
            }
            if (!string.IsNullOrWhiteSpace(datos.OwnerUsername))
            {
                return $"dueño asignado: {datos.OwnerUsername} " +
                    "(su contraseña desbloquea esta PC; también la de un administrador)";
            }
            return "dueño asignado: SIN ASIGNAR — solo un administrador puede " +
                "desbloquear en esta PC; asigna un usuario a este equipo en " +
                "el panel (Usuarios → su equipo)";
        }

        return _duenoCacheEstado == 0
            ? "dueño asignado: sin conexión para comprobarlo"
            : $"dueño asignado: sin comprobar (el panel respondió {_duenoCacheEstado})";
    }

    private sealed record EstadoFoto(
        string Servicio,
        string UrlBase,
        int Bloqueados,
        int NodosPorRestaurar,
        string Conexion,
        string Dueno);

    // ── Servicio e instalación ──────────────────────────────────

    private async Task ControlarServicioAsync(string accion, Button boton, string gerundio)
    {
        if (_operandoServicio)
        {
            return;
        }
        _operandoServicio = true;
        FijarBotonesServicio(true);
        object? previo = Tema.MarcarOcupado(boton, gerundio);

        try
        {
            await Task.Run(() => ControlarServicio(accion));
            // Al arrancar el servicio desde esta sesión, el
            // compañero se abre también aquí y ahora: no se espera
            // a la tarea programada ni al vigía del servicio.
            if (accion is "start" or "restart")
            {
                LanzarModo("prompt");
            }
        }
        catch (Exception ex)
        {
            Tema.AvisarError(
                $"No se pudo completar la operación sobre el servicio " +
                $"(¿falta administrador?): {ex.Message}",
                "Servicio");
            _log.Excepcion($"No se pudo {accion} el servicio", ex);
        }
        finally
        {
            _operandoServicio = false;
            Tema.RestaurarBoton(boton, previo);
            FijarBotonesServicio(false);
            await RefrescarEstadoAsync();
        }
    }

    private static void ControlarServicio(string accion)
    {
        using var controlador = new ServiceController(NombreServicio);
        var limite = TimeSpan.FromSeconds(30);

        if (accion == "start")
        {
            if (controlador.Status != ServiceControllerStatus.Running)
            {
                controlador.Start();
                controlador.WaitForStatus(ServiceControllerStatus.Running, limite);
            }
            return;
        }

        if (accion == "stop")
        {
            if (controlador.Status != ServiceControllerStatus.Stopped)
            {
                controlador.Stop();
                controlador.WaitForStatus(ServiceControllerStatus.Stopped, limite);
            }
            return;
        }

        if (accion == "restart")
        {
            if (controlador.Status != ServiceControllerStatus.Stopped)
            {
                controlador.Stop();
                controlador.WaitForStatus(ServiceControllerStatus.Stopped, limite);
            }
            controlador.Start();
            controlador.WaitForStatus(ServiceControllerStatus.Running, limite);
        }
    }

    private async Task InstalarAsync(Button boton)
    {
        if (!ComprobarAdministrador("Instalar el servicio"))
        {
            return;
        }
        if (Tema.Confirmar(
                "Se registra el servicio de USBMonitor, se crea la tarea " +
                "del compañero al iniciar sesión y se arranca. ¿Continuar?",
                "Instalar servicio") != MessageBoxResult.Yes)
        {
            return;
        }

        FijarBotonesServicio(true);
        object? previo = Tema.MarcarOcupado(boton, "Instalando…");
        try
        {
            string resumen = await Task.Run(() => Instalador.Instalar());
            Tema.Avisar(resumen, "Instalar servicio");
        }
        catch (Exception ex)
        {
            Tema.AvisarError(ex.Message, "Instalar servicio");
            _log.Excepcion("No se pudo instalar el servicio desde la caja de herramientas", ex);
        }
        finally
        {
            Tema.RestaurarBoton(boton, previo);
            FijarBotonesServicio(false);
        }
        await RefrescarEstadoAsync();
    }

    private async Task DesinstalarAsync(Button boton)
    {
        if (!ComprobarAdministrador("Desinstalar el servicio"))
        {
            return;
        }
        if (Tema.Confirmar(
                "Se restaura todo lo bloqueado, se detiene el servicio y " +
                "se quita de Windows, junto con la tarea del compañero. " +
                "¿Continuar?",
                "Desinstalar servicio") != MessageBoxResult.Yes)
        {
            return;
        }

        FijarBotonesServicio(true);
        object? previo = Tema.MarcarOcupado(boton, "Desinstalando…");
        try
        {
            string resumen = await Task.Run(() => Instalador.Desinstalar());
            Tema.Avisar(resumen, "Desinstalar servicio");
        }
        catch (Exception ex)
        {
            Tema.AvisarError(ex.Message, "Desinstalar servicio");
            _log.Excepcion("No se pudo desinstalar el servicio desde la caja de herramientas", ex);
        }
        finally
        {
            Tema.RestaurarBoton(boton, previo);
            FijarBotonesServicio(false);
        }
        await RefrescarEstadoAsync();
    }

    private static bool ComprobarAdministrador(string titulo)
    {
        if (EsAdministrador())
        {
            return true;
        }
        Tema.AvisarError(
            "Esta operación requiere ejecutar la caja de herramientas " +
            "como administrador.",
            titulo);
        return false;
    }

    private static bool EsAdministrador() => Instalador.EsAdmin();

    private void FijarBotonesServicio(bool deshabilitar)
    {
        foreach (Button boton in _botonesServicio)
        {
            boton.IsEnabled = !deshabilitar;
        }
    }

    // ── Servidor y credencial ───────────────────────────────────

    private void GuardarServidor()
    {
        if (!int.TryParse(_puerto.Text.Trim(), out int puerto) ||
            puerto < 1 || puerto > 65535)
        {
            Tema.AvisarError("El puerto debe ser un número entre 1 y 65535.", "Puerto inválido");
            return;
        }

        string host = _host.Text.Trim();
        if (string.IsNullOrWhiteSpace(host))
        {
            host = "localhost";
        }
        string esquema = _esquema.SelectedItem?.ToString() ?? "http";

        bool ok = _config.Guardar(new Dictionary<string, object?>
        {
            ["serverHost"] = host,
            ["serverPort"] = puerto,
            ["serverScheme"] = esquema
        });

        if (ok)
        {
            Tema.Avisar(
                "Reinicia el servicio para aplicar la nueva dirección.",
                "Servidor guardado");
            _ = RefrescarEstadoAsync();
        }
        else
        {
            Tema.AvisarError("No se pudo guardar server.json.", "Servidor");
        }
    }

    private async Task ProbarConexionAsync()
    {
        if (_probando)
        {
            return;
        }
        _probando = true;
        _botonProbar.IsEnabled = false;
        object? previo = Tema.MarcarOcupado(_botonProbar, "Probando…");

        try
        {
            List<PasoPruebaConexion> resultados =
                await _cliente.ProbarConexionAsync();
            var lineas = new List<string>
            {
                $"— Prueba de conexión a {_config.UrlBase} —"
            };
            foreach (PasoPruebaConexion paso in resultados)
            {
                string marca = paso.Ok ? "✓" : "✗";
                string ms = paso.Ms.ToString(
                    "0", System.Globalization.CultureInfo.InvariantCulture);
                lineas.Add($"{marca} {paso.Paso}: {paso.Detalle} ({ms} ms)");
            }

            string texto = string.Join(Environment.NewLine, lineas);
            _log.Info($"Prueba de conexión:{Environment.NewLine}{texto}");
            AgregarAlRegistro(texto);
        }
        catch (Exception ex)
        {
            string texto = $"✗ Prueba de conexión interrumpida: {ex.Message}";
            _log.Excepcion("Prueba de conexión interrumpida", ex);
            AgregarAlRegistro(texto);
        }
        finally
        {
            _probando = false;
            _botonProbar.IsEnabled = true;
            Tema.RestaurarBoton(_botonProbar, previo);
            await RefrescarEstadoAsync();
        }
    }

    // ── Acciones ─────────────────────────────────────────────────

    private async Task RestaurarTodoAsync(Button boton)
    {
        if (Tema.Confirmar(
                "Se reactivan los dispositivos que el agente deshabilitó y se " +
                "sueltan los volúmenes retenidos. ¿Continuar?",
                "Restaurar todo") != MessageBoxResult.Yes)
        {
            return;
        }

        boton.IsEnabled = false;
        object? previo = Tema.MarcarOcupado(boton, "Restaurando…");
        try
        {
            ResumenRestauracion resumen =
                await Task.Run(() => Instalador.RestaurarSinServicio());
            Tema.Avisar(
                $"Reactivados: {resumen.Reactivados} · " +
                $"Volúmenes restaurados: {resumen.VolumenesRestaurados} · " +
                $"Sin revertir: {resumen.SinRevertir.Count}",
                "Restauración");
        }
        catch (Exception ex)
        {
            Tema.AvisarError(ex.Message, "Restaurar todo");
            _log.Excepcion("No se pudo ejecutar la restauración desde la caja de herramientas", ex);
        }
        finally
        {
            Tema.RestaurarBoton(boton, previo);
            boton.IsEnabled = true;
        }
        await RefrescarEstadoAsync();
    }

    private void AbrirEmergencia()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:5001/desbloquear",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Tema.AvisarError(
                $"No se pudo abrir la página de emergencia: {ex.Message}",
                "Página de emergencia");
        }
    }

    private void LanzarModo(string modo)
    {
        try
        {
            LanzadorModos.Lanzar(modo);
        }
        catch (Exception ex)
        {
            Tema.AvisarError(ex.Message, "Abrir herramienta");
            _log.Excepcion($"No se pudo abrir el modo {modo}", ex);
        }
    }

    // ── Registro ─────────────────────────────────────────────────

    private async Task RefrescarRegistroAsync()
    {
        if (_refrescandoRegistro)
        {
            return;
        }
        _refrescandoRegistro = true;

        try
        {
            string texto = await Task.Run(LeerColaRegistro);
            if (_registro.Text == texto)
            {
                return;
            }

            // La cinta no tiene barras: se queda siempre pegada a
            // la cola del registro, que es lo único que cabe.
            _registro.Text = texto;
            _registro.ScrollToEnd();
        }
        catch (Exception ex)
        {
            _log.Excepcion("No se pudo refrescar el registro de la caja de herramientas", ex);
        }
        finally
        {
            _refrescandoRegistro = false;
        }
    }

    private static string LeerColaRegistro()
    {
        string ruta = DatosVentanas.RutaAgenteLog;
        if (!File.Exists(ruta))
        {
            return string.Empty;
        }

        using var flujo = new FileStream(
            ruta,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var lector = new StreamReader(flujo);
        var lineas = new List<string>();
        while (lector.ReadLine() is string linea)
        {
            lineas.Add(linea);
            if (lineas.Count > 60)
            {
                lineas.RemoveAt(0);
            }
        }
        return string.Join(Environment.NewLine, lineas);
    }

    private void AgregarAlRegistro(string texto)
    {
        if (!string.IsNullOrEmpty(_registro.Text))
        {
            _registro.AppendText(Environment.NewLine);
        }
        _registro.AppendText(texto);
        _registro.ScrollToEnd();
    }
}
