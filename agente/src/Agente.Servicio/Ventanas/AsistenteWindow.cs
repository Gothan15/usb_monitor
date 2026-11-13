using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Asistente de configuración de primera vez.
///
/// Guía paso a paso la puesta en marcha de un equipo nuevo:
/// servidor, credencial del equipo y servicio. Es el mismo proceso
/// que hay que repetir en cada PC de la red, así que cada paso
/// explica en llano qué está dejando hecho. Ninguna operación de
/// red o de servicio se ejecuta en el hilo de la ventana.
/// </summary>
public sealed class AsistenteWindow : Window
{
    private const int TotalPasos = 5;

    // La paleta cálida de la caja de herramientas y el compañero
    // (papel, tarjeta crema, borde cálido, carbón y dorado): el
    // asistente habla el mismo idioma visual que el resto del
    // agente, no el tema frío antiguo de Tema.
    private static readonly SolidColorBrush Papel =
        new(Color.FromRgb(0xF5, 0xF3, 0xEF));
    private static readonly SolidColorBrush TarjetaFondo =
        new(Color.FromRgb(0xFC, 0xFC, 0xFA));
    private static readonly SolidColorBrush BordeCalido =
        new(Color.FromRgb(0xD8, 0xD3, 0xC8));
    private static readonly SolidColorBrush Carbon =
        new(Color.FromRgb(0x26, 0x26, 0x2B));
    private static readonly SolidColorBrush Dorado =
        new(Color.FromRgb(0xC0, 0x9A, 0x3B));
    private static readonly SolidColorBrush TintaCalida =
        new(Color.FromRgb(0x22, 0x25, 0x2A));
    private static readonly SolidColorBrush GrisCalido =
        new(Color.FromRgb(0x8A, 0x8F, 0x98));

    private readonly Configuracion _config = new();
    private readonly Registrador _log = Registro.Obtener("gui");

    private readonly TextBlock _indicadorPaso;
    private readonly List<Rectangle> _segmentos = new();
    private readonly List<UIElement> _pasos = new();
    private readonly Button _botonAtras;
    private readonly Button _botonSaltar;
    private readonly Button _botonContinuar;
    private readonly StackPanel _filaNavegacion;

    // Paso 2 · Servidor
    private readonly TextBox _host;
    private readonly TextBox _puerto;
    private readonly ComboBox _esquema;
    private readonly Button _botonProbar;
    private readonly StackPanel _resultadosPrueba;
    private readonly TextBlock _avisoConexion;
    private bool _probando;
    private bool? _ultimaPruebaOk;

    // Paso 3 · Credencial
    private readonly PasswordBox _codigoEnroll;
    private readonly TextBlock _avisoToken;

    // Paso 4 · Servicio
    private readonly TextBlock _textoEstadoServicio;
    private readonly Button _botonInstalarServicio;
    private readonly TextBlock _avisoAdmin;
    private bool _instalando;
    private bool _refrescandoServicio;

    // Paso 5 · Listo
    private readonly StackPanel _resumen;
    private TextBlock? _lineaResumenServicio;

    private int _pasoActual = 1;

    public AsistenteWindow()
    {
        Title = "USBMonitor — Configuración de este equipo";
        Width = 620;
        Height = 660;
        MinWidth = 560;
        MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Tema.AplicarVentana(this);
        Background = Papel;

        var raiz = new StackPanel();
        raiz.Children.Add(ConstruirCabecera());
        var cuerpo = new StackPanel { Margin = new Thickness(18, 10, 18, 18) };
        raiz.Children.Add(cuerpo);

        // Indicador de progreso: «Paso N de 5» y cinco segmentos.
        _indicadorPaso = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 12.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = Tema.TintaAtenuada,
            Margin = new Thickness(0, 2, 0, 6)
        };
        _indicadorPaso.SetValue(
            System.Windows.Documents.Typography.CapitalsProperty,
            FontCapitals.SmallCaps);
        cuerpo.Children.Add(_indicadorPaso);

        var filaSegmentos = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, 0, 0, 14)
        };
        for (int i = 0; i < TotalPasos; i++)
        {
            var segmento = new Rectangle
            {
                Width = 52,
                Height = 3,
                Fill = Tema.Borde,
                Margin = new Thickness(0, 0, 6, 0)
            };
            _segmentos.Add(segmento);
            filaSegmentos.Children.Add(segmento);
        }
        cuerpo.Children.Add(filaSegmentos);

        // Zona de pasos: los cinco paneles conviven y solo se ve uno.
        var zona = new Grid();
        _pasos.Add(ConstruirPasoBienvenida());
        _pasos.Add(ConstruirPasoServidor(out _host, out _puerto, out _esquema,
            out _botonProbar, out _resultadosPrueba, out _avisoConexion));
        _pasos.Add(ConstruirPasoCredencial(out _codigoEnroll, out _avisoToken));
        _pasos.Add(ConstruirPasoServicio(out _textoEstadoServicio,
            out _botonInstalarServicio, out _avisoAdmin));
        _pasos.Add(ConstruirPasoListo(out _resumen));
        foreach (UIElement paso in _pasos)
        {
            zona.Children.Add(paso);
        }
        cuerpo.Children.Add(new Border
        {
            Background = TarjetaFondo,
            BorderBrush = BordeCalido,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(16),
            Margin = new Thickness(0, 0, 0, 14),
            Child = zona
        });

        // Navegación: Atrás y Saltar a la izquierda, Continuar a la derecha.
        _filaNavegacion = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Stretch
        };
        var rejillaNav = new Grid();
        rejillaNav.ColumnDefinitions.Add(
            new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        rejillaNav.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var izquierda = new StackPanel { Orientation = Orientation.Horizontal };
        _botonAtras = Tema.BotonSecundario("Atrás");
        _botonAtras.Background = TarjetaFondo;
        _botonAtras.BorderBrush = BordeCalido;
        _botonAtras.Foreground = TintaCalida;
        _botonAtras.Click += (_, _) => MostrarPaso(_pasoActual - 1);
        izquierda.Children.Add(_botonAtras);
        _botonSaltar = Tema.BotonSecundario("Saltar por ahora");
        _botonSaltar.Background = TarjetaFondo;
        _botonSaltar.BorderBrush = BordeCalido;
        _botonSaltar.Foreground = TintaCalida;
        _botonSaltar.Margin = new Thickness(0);
        _botonSaltar.Click += (_, _) => MostrarPaso(_pasoActual + 1);
        izquierda.Children.Add(_botonSaltar);
        Grid.SetColumn(izquierda, 0);
        rejillaNav.Children.Add(izquierda);

        _botonContinuar = Tema.BotonPrimario("Continuar");
        _botonContinuar.Background = Carbon;
        _botonContinuar.BorderBrush = Carbon;
        _botonContinuar.Margin = new Thickness(0);
        _botonContinuar.Click += async (_, _) => await ContinuarAsync();
        Grid.SetColumn(_botonContinuar, 1);
        rejillaNav.Children.Add(_botonContinuar);
        _filaNavegacion.Children.Add(rejillaNav);
        cuerpo.Children.Add(_filaNavegacion);

        Content = new ScrollViewer
        {
            Content = raiz,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };

        Loaded += (_, _) =>
        {
            _log.Info("Asistente de configuración abierto");
            MostrarPaso(1);
        };
        Closed += (_, _) => _log.Info("Asistente de configuración cerrado");
    }

    // ── Cabecera cálida (la misma receta que la caja de
    //    herramientas: banda crema en degradado, emblema de la
    //    brújula, rótulo en versalitas, título claro y el filete
    //    dorado debajo) ───────────────────────────────────────────

    private Border ConstruirCabecera()
    {
        var marca = new TextBlock
        {
            Text = "USBMONITOR",
            FontFamily = Tema.FuenteTexto,
            FontSize = 10.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = GrisCalido
        };
        marca.SetValue(
            System.Windows.Documents.Typography.CapitalsProperty,
            FontCapitals.SmallCaps);
        var titulo = new TextBlock
        {
            Text = "Configuración de este equipo",
            FontFamily = new FontFamily("Segoe UI Light"),
            FontSize = 20,
            Foreground = TintaCalida,
            Margin = new Thickness(0, 1, 0, 0)
        };
        var subtitulo = new TextBlock
        {
            Text = "Asistente de primera vez — deja este equipo listo y enrolado en el panel.",
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
        pila.Children.Add(new Border { Height = 2, Background = Dorado });

        return new Border { Child = pila };
    }

    /// <summary>El emblema: la brújula clara desde su PNG, como en la caja.</summary>
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
            var borde = new Border
            {
                Width = 36,
                Height = 36,
                CornerRadius = new CornerRadius(9),
                BorderBrush = Dorado,
                BorderThickness = new Thickness(1.5)
            };
            borde.Child = new TextBlock
            {
                Text = "N",
                FontFamily = Tema.FuenteTexto,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = Dorado,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            return borde;
        }
    }

    // ── Navegación ───────────────────────────────────────────────

    private static readonly string[] NombresPasos =
    {
        "Bienvenida", "Servidor", "Credencial del equipo", "Servicio", "Listo"
    };

    private void MostrarPaso(int paso)
    {
        _pasoActual = Math.Clamp(paso, 1, TotalPasos);
        for (int i = 0; i < _pasos.Count; i++)
        {
            _pasos[i].Visibility = i == _pasoActual - 1
                ? Visibility.Visible
                : Visibility.Collapsed;
        }
        for (int i = 0; i < _segmentos.Count; i++)
        {
            _segmentos[i].Fill = i < _pasoActual - 1
                ? Dorado
                : i == _pasoActual - 1 ? Carbon : BordeCalido;
        }
        _indicadorPaso.Text =
            $"Paso {_pasoActual} de {TotalPasos} · {NombresPasos[_pasoActual - 1]}";

        _botonAtras.IsEnabled = _pasoActual > 1;
        _botonSaltar.Visibility = _pasoActual == 3
            ? Visibility.Visible
            : Visibility.Collapsed;
        _filaNavegacion.Visibility = _pasoActual == TotalPasos
            ? Visibility.Collapsed
            : Visibility.Visible;

        if (_pasoActual == 4)
        {
            _ = RefrescarEstadoServicioAsync();
        }
        if (_pasoActual == TotalPasos)
        {
            ConstruirResumen();
            _ = RefrescarResumenServicioAsync();
        }
    }

    private async Task ContinuarAsync()
    {
        switch (_pasoActual)
        {
            case 1:
                MostrarPaso(2);
                break;
            case 2:
                if (GuardarServidorDesdeCampos())
                {
                    MostrarPaso(3);
                }
                break;
            case 3:
                if (await GuardarCredencialDesdeCampoAsync())
                {
                    MostrarPaso(4);
                }
                break;
            case 4:
                MostrarPaso(5);
                break;
        }
    }

    // ── Paso 1 · Bienvenida ──────────────────────────────────────

    private UIElement ConstruirPasoBienvenida()
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Bienvenida"));
        contenido.Children.Add(TextoExplicacion(
            "Este asistente deja este equipo conectado al panel de " +
            "USBMonitor paso a paso: primero la dirección del servidor, " +
            "después la credencial de este equipo y por último el " +
            "servicio que vigila los USB."));
        contenido.Children.Add(TextoExplicacion(
            "Es el mismo proceso en cada PC de la red que quieras " +
            "vigilar: instalar, abrir el asistente y repetir estos pasos."));
        contenido.Children.Add(TextoExplicacion(
            "Puedes cerrar el asistente cuando quieras y volver más " +
            "tarde: lo que ya hayas guardado queda guardado."));
        return contenido;
    }

    private static TextBlock TextoExplicacion(string texto)
    {
        return new TextBlock
        {
            Text = texto,
            FontFamily = Tema.FuenteTexto,
            FontSize = 13.5,
            Foreground = Tema.Tinta,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10)
        };
    }

    private static TextBlock TextoAviso(string texto)
    {
        return new TextBlock
        {
            Text = texto,
            FontFamily = Tema.FuenteTexto,
            FontSize = 12.5,
            Foreground = Tema.Ambar,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0),
            Visibility = Visibility.Collapsed
        };
    }

    // ── Paso 2 · Servidor ────────────────────────────────────────

    private UIElement ConstruirPasoServidor(
        out TextBox host,
        out TextBox puerto,
        out ComboBox esquema,
        out Button botonProbar,
        out StackPanel resultados,
        out TextBlock avisoConexion)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Servidor del panel"));
        contenido.Children.Add(TextoExplicacion(
            "La dirección del equipo donde corre el panel web de " +
            "USBMonitor. Si el panel está en esta misma PC, deja " +
            "«localhost»."));

        contenido.Children.Add(FilaCampo("Host / IP", host = Tema.CampoTexto(datos: true), 300));
        host.Text = _config.HostServidor;
        contenido.Children.Add(FilaCampo("Puerto", puerto = Tema.CampoTexto(datos: true), 110));
        puerto.Text = _config.PuertoServidor.ToString(
            System.Globalization.CultureInfo.InvariantCulture);

        var filaEsquema = new Grid { Margin = new Thickness(0, 0, 0, 7) };
        filaEsquema.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(105) });
        filaEsquema.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var etiquetaEsquema = Tema.EtiquetaCampo("Esquema");
        etiquetaEsquema.Margin = new Thickness(0, 5, 0, 0);
        Grid.SetColumn(etiquetaEsquema, 0);
        filaEsquema.Children.Add(etiquetaEsquema);
        esquema = Tema.Selector();
        esquema.Items.Add("http");
        esquema.Items.Add("https");
        esquema.SelectedItem = _config.EsquemaServidor;
        esquema.Width = 110;
        Grid.SetColumn(esquema, 1);
        filaEsquema.Children.Add(esquema);
        contenido.Children.Add(filaEsquema);

        // Si la dirección cambia tras probar, la prueba ya no vale.
        host.TextChanged += (_, _) => _ultimaPruebaOk = null;
        puerto.TextChanged += (_, _) => _ultimaPruebaOk = null;
        esquema.SelectionChanged += (_, _) => _ultimaPruebaOk = null;

        botonProbar = Tema.BotonSecundario("Probar conexión");
        botonProbar.HorizontalAlignment = HorizontalAlignment.Left;
        botonProbar.Margin = new Thickness(0, 4, 0, 0);
        botonProbar.Click += async (_, _) => await ProbarConexionAsync();
        contenido.Children.Add(botonProbar);

        resultados = new StackPanel { Margin = new Thickness(0, 10, 0, 0) };
        contenido.Children.Add(resultados);

        avisoConexion = TextoAviso(
            "No hubo conexión con el panel con esta dirección. Puedes " +
            "continuar y corregirla después en la caja de herramientas, " +
            "sección Servidor.");
        contenido.Children.Add(avisoConexion);

        return contenido;
    }

    private static Grid FilaCampo(string etiqueta, Control campo, double ancho)
    {
        var fila = new Grid { Margin = new Thickness(0, 0, 0, 7) };
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(105) });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var texto = Tema.EtiquetaCampo(etiqueta);
        texto.Margin = new Thickness(0, 5, 0, 0);
        Grid.SetColumn(texto, 0);
        fila.Children.Add(texto);
        campo.Width = ancho;
        Grid.SetColumn(campo, 1);
        fila.Children.Add(campo);
        return fila;
    }

    /// <summary>
    /// Valida los campos y guarda el servidor en server.json.
    /// Devuelve false si hay algo que corregir (y ya avisó).
    /// </summary>
    private bool GuardarServidorDesdeCampos()
    {
        // La dirección se interpreta antes de guardarla: quien
        // pega la dirección entera («http://172.29.176.1:3000») o
        // deja un dedazo («172.29.176.1:») no puede dejar al
        // agente con una URL imposible — el registro del
        // 2026-11-13 enseñó que guardarla tal cual tumba TODAS
        // las peticiones con «Invalid port specified». Si la
        // dirección escrita trae puerto o esquema propios,
        // mandan ellos: eran parte de lo que se escribió a
        // propósito.
        var partes = DireccionServidor.IntentarInterpretar(_host.Text);
        if (partes is null)
        {
            Tema.AvisarError(
                "La dirección del servidor no es válida. Escribe la IP o el " +
                "nombre del equipo del panel (por ejemplo 192.168.1.50); " +
                "el puerto va en su campo.",
                "Dirección inválida");
            return false;
        }

        int puerto;
        if (partes.Puerto is int puertoPegado)
        {
            puerto = puertoPegado;
        }
        else if (!int.TryParse(_puerto.Text.Trim(), out puerto) ||
                 puerto < 1 || puerto > 65535)
        {
            Tema.AvisarError("El puerto debe ser un número entre 1 y 65535.", "Puerto inválido");
            return false;
        }

        string host = partes.Host;
        string esquema = partes.Esquema ?? (_esquema.SelectedItem?.ToString() ?? "http");

        bool ok = _config.Guardar(new Dictionary<string, object?>
        {
            ["serverHost"] = host,
            ["serverPort"] = puerto,
            ["serverScheme"] = esquema
        });

        if (!ok)
        {
            Tema.AvisarError("No se pudo guardar server.json.", "Servidor");
            return false;
        }
        _log.Info($"Asistente: servidor guardado ({_config.UrlBase})");
        return true;
    }

    private async Task ProbarConexionAsync()
    {
        if (_probando)
        {
            return;
        }
        // La prueba va contra la dirección escrita en los campos:
        // se guarda primero, igual que hará «Continuar».
        if (!GuardarServidorDesdeCampos())
        {
            return;
        }
        _probando = true;
        _botonProbar.IsEnabled = false;
        _botonProbar.Content = "Probando…";
        _resultadosPrueba.Children.Clear();
        _avisoConexion.Visibility = Visibility.Collapsed;

        try
        {
            using var cliente = new ClientePanel(_config);
            List<PasoPruebaConexion> pasos = await cliente.ProbarConexionAsync();
            bool todoOk = pasos.Count > 0 && pasos.All(p => p.Ok);
            _ultimaPruebaOk = todoOk;

            foreach (PasoPruebaConexion paso in pasos)
            {
                string marca = paso.Ok ? "✓" : "✗";
                string ms = paso.Ms.ToString(
                    "0", System.Globalization.CultureInfo.InvariantCulture);
                var linea = Tema.TextoDatos(
                    $"{marca} {paso.Paso}: {paso.Detalle} ({ms} ms)", 12.5);
                linea.Foreground = paso.Ok ? Tema.Verde : Tema.Rojo;
                linea.Margin = new Thickness(0, 0, 0, 3);
                _resultadosPrueba.Children.Add(linea);
            }

            _avisoConexion.Visibility = todoOk
                ? Visibility.Collapsed
                : Visibility.Visible;
            _log.Info(
                $"Asistente: prueba de conexión a {_config.UrlBase} → " +
                (todoOk ? "correcta" : "con fallos"));
        }
        catch (Exception ex)
        {
            _ultimaPruebaOk = false;
            _avisoConexion.Visibility = Visibility.Visible;
            _log.Excepcion("Asistente: prueba de conexión interrumpida", ex);
        }
        finally
        {
            _probando = false;
            _botonProbar.IsEnabled = true;
            _botonProbar.Content = "Probar conexión";
        }
    }

    // ── Paso 3 · Credencial del equipo ───────────────────────────

    private UIElement ConstruirPasoCredencial(
        out PasswordBox codigo, out TextBlock avisoToken)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Credencial del equipo"));
        contenido.Children.Add(TextoExplicacion(
            "Este equipo se acredita ante el panel con un par de " +
            "claves propio: la clave privada nace en esta PC y nunca " +
            "sale de ella, y el panel guarda solo la pública. Para " +
            "registrarla, escribe el código de enrolamiento de un " +
            "solo uso que el administrador genera en el panel " +
            "(Equipos → Credencial del equipo). Si este equipo ya " +
            "tenía el token del sistema anterior, no escribas nada: " +
            "el agente se migra solo a la clave al arrancar."));

        var nombrePc = Tema.TextoDatos(
            $"El nombre de este equipo es {Configuracion.NombrePc}.");
        nombrePc.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(nombrePc);

        contenido.Children.Add(Tema.EtiquetaCampo("Código de enrolamiento"));
        codigo = Tema.CampoContrasena();
        codigo.Margin = new Thickness(0, 0, 0, 4);
        contenido.Children.Add(codigo);

        contenido.Children.Add(new TextBlock
        {
            Text = "El código vale 30 minutos y se gasta al usarlo. " +
                   "Si ahora no lo tienes, pulsa «Saltar por ahora» y " +
                   "enrola después desde la caja de herramientas.",
            FontFamily = Tema.FuenteTexto,
            FontSize = 11.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6, 0, 0)
        });

        avisoToken = TextoAviso(
            "Escribe el código de enrolamiento, o pulsa «Saltar por " +
            "ahora» para dejarlo para después.");
        contenido.Children.Add(avisoToken);

        return contenido;
    }

    private async Task<bool> GuardarCredencialDesdeCampoAsync()
    {
        // Ya acreditado (clave registrada): el paso no tiene
        // nada que guardar.
        if (_config.TieneClave)
        {
            _avisoToken.Visibility = Visibility.Collapsed;
            return true;
        }

        string codigo = _codigoEnroll.Password.Trim();
        if (string.IsNullOrWhiteSpace(codigo))
        {
            _avisoToken.Visibility = Visibility.Visible;
            return false;
        }
        _avisoToken.Visibility = Visibility.Collapsed;

        ResultadoEnrolamiento intento;
        using (var cliente = new ClientePanel(_config))
        {
            intento = await cliente.EnrolarDetalladoAsync(codigo);
        }
        _codigoEnroll.Clear();
        if (!intento.Ok)
        {
            // La respuesta EXACTA del panel, con su motivo
            // distinguible: el «no aceptado» a secas obligaba a
            // adivinar (¿caducado?, ¿de otra PC?, ¿ya gastado?).
            Tema.AvisarError(
                "El panel no aceptó el código de enrolamiento" +
                (intento.Motivo is not null ? $" (motivo: {intento.Motivo})" : "") +
                $": {intento.Detalle} " +
                "Comprueba también el servidor del paso anterior y " +
                "que el código se haya generado en el panel para " +
                "el nombre EXACTO de esta PC (" +
                Environment.MachineName + "). Para el detalle " +
                "completo, la caja de herramientas tiene la prueba " +
                "de enrolamiento paso a paso.", "Credencial");
            return false;
        }
        _log.Info("Asistente: equipo enrolado; clave registrada en el panel");
        return true;
    }

    // ── Paso 4 · Servicio ────────────────────────────────────────

    private UIElement ConstruirPasoServicio(
        out TextBlock textoEstado,
        out Button botonInstalar,
        out TextBlock avisoAdmin)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Servicio de USBMonitor"));
        contenido.Children.Add(TextoExplicacion(
            "El servicio es el programa que vigila los USB de este " +
            "equipo: los detecta, los bloquea y habla con el panel. " +
            "Se instala una sola vez y arranca solo cada vez que " +
            "Windows inicia, sin que nadie tenga que abrir nada."));

        textoEstado = Tema.TextoDatos("servicio: consultando…", 12.5);
        textoEstado.Margin = new Thickness(0, 2, 0, 10);
        contenido.Children.Add(textoEstado);

        botonInstalar = Tema.BotonPrimario("Instalar el servicio y arrancarlo");
        botonInstalar.HorizontalAlignment = HorizontalAlignment.Left;
        botonInstalar.Click += async (_, _) => await InstalarServicioAsync();
        contenido.Children.Add(botonInstalar);

        avisoAdmin = TextoAviso(
            "Para instalar el servicio hacen falta permisos de " +
            "administrador. Cierra el asistente, ábrelo de nuevo como " +
            "administrador (clic derecho sobre el programa → «Ejecutar " +
            "como administrador») y repite este paso. También puedes " +
            "continuar sin instalar y hacerlo después desde la caja " +
            "de herramientas.");
        contenido.Children.Add(avisoAdmin);

        return contenido;
    }

    private async Task RefrescarEstadoServicioAsync()
    {
        if (_refrescandoServicio)
        {
            return;
        }
        _refrescandoServicio = true;

        try
        {
            string estado = await Task.Run(() => Instalador.EstadoServicio());
            bool esAdmin = Instalador.EsAdmin();
            _textoEstadoServicio.Text = $"servicio: {estado}";

            if (estado == "no instalado")
            {
                _botonInstalarServicio.Visibility = Visibility.Visible;
                _botonInstalarServicio.IsEnabled = esAdmin && !_instalando;
                _avisoAdmin.Visibility = esAdmin
                    ? Visibility.Collapsed
                    : Visibility.Visible;
            }
            else
            {
                _botonInstalarServicio.Visibility = Visibility.Collapsed;
                _avisoAdmin.Visibility = Visibility.Collapsed;
                string detalle = estado switch
                {
                    "en ejecución" =>
                        "El servicio ya está instalado y en ejecución. " +
                        "No hay nada que instalar en este paso.",
                    "detenido" =>
                        "El servicio ya está instalado, pero está " +
                        "detenido. Puedes arrancarlo desde la caja de " +
                        "herramientas al terminar.",
                    _ =>
                        "El servicio ya está instalado. No hay nada " +
                        "que instalar en este paso."
                };
                var nota = new TextBlock
                {
                    Text = detalle,
                    FontFamily = Tema.FuenteTexto,
                    FontSize = 12.5,
                    Foreground = Tema.TintaAtenuada,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 0),
                    Tag = "nota-servicio"
                };
                // Una sola nota aunque el paso se refresque varias veces.
                var padre = (Panel)_textoEstadoServicio.Parent;
                foreach (UIElement hijo in padre.Children)
                {
                    if (hijo is FrameworkElement fe && (string?)fe.Tag == "nota-servicio")
                    {
                        padre.Children.Remove(hijo);
                        break;
                    }
                }
                padre.Children.Insert(
                    padre.Children.IndexOf(_textoEstadoServicio) + 1, nota);
            }
        }
        catch (Exception ex)
        {
            _log.Excepcion("Asistente: no se pudo consultar el estado del servicio", ex);
        }
        finally
        {
            _refrescandoServicio = false;
        }
    }

    private async Task InstalarServicioAsync()
    {
        if (_instalando)
        {
            return;
        }
        if (!Instalador.EsAdmin())
        {
            _avisoAdmin.Visibility = Visibility.Visible;
            return;
        }
        _instalando = true;
        _botonInstalarServicio.IsEnabled = false;
        _botonInstalarServicio.Content = "Instalando…";

        try
        {
            string resumen = await Task.Run(() => Instalador.Instalar());
            _log.Info($"Asistente: servicio instalado ({resumen})");
            Tema.Avisar(resumen, "Instalar servicio");
        }
        catch (Exception ex)
        {
            Tema.AvisarError(ex.Message, "Instalar servicio");
            _log.Excepcion("Asistente: no se pudo instalar el servicio", ex);
        }
        finally
        {
            _instalando = false;
            _botonInstalarServicio.Content = "Instalar el servicio y arrancarlo";
            await RefrescarEstadoServicioAsync();
        }
    }

    // ── Paso 5 · Listo ───────────────────────────────────────────

    private UIElement ConstruirPasoListo(out StackPanel resumen)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Listo"));
        contenido.Children.Add(TextoExplicacion(
            "Esto es lo que quedó hecho en este equipo:"));

        resumen = new StackPanel { Margin = new Thickness(0, 2, 0, 12) };
        contenido.Children.Add(resumen);

        var fila = new WrapPanel();
        var abrirToolbox = Tema.BotonPrimario("Abrir la caja de herramientas");
        abrirToolbox.Click += (_, _) => AbrirCajaHerramientas();
        fila.Children.Add(abrirToolbox);

        var terminar = Tema.BotonSecundario("Terminar");
        terminar.Margin = new Thickness(0);
        terminar.Click += (_, _) => Close();
        fila.Children.Add(terminar);
        contenido.Children.Add(fila);

        return contenido;
    }

    private void ConstruirResumen()
    {
        _resumen.Children.Clear();

        // Servidor: según la última prueba de conexión del paso 2.
        if (_ultimaPruebaOk == true)
        {
            _resumen.Children.Add(LineaResumen(true,
                $"Servidor: panel alcanzado en {_config.UrlBase}."));
        }
        else if (_ultimaPruebaOk == false)
        {
            _resumen.Children.Add(LineaResumen(false,
                $"Servidor: no se pudo conectar con el panel ({_config.UrlBase}). " +
                "Revísalo en la caja de herramientas, sección Servidor."));
        }
        else
        {
            _resumen.Children.Add(LineaResumen(null,
                $"Servidor: dirección guardada ({_config.UrlBase}), sin probar la conexión."));
        }

        // Credencial: se lee el estado real, no lo que el usuario dijo.
        bool hayCredencial = _config.TieneClave ||
            _config.CodigoEnrolamiento is not null;
        _resumen.Children.Add(hayCredencial
            ? LineaResumen(true, "Credencial: este equipo puede presentarse al panel.")
            : LineaResumen(false,
                "Credencial: sin registrar. Este equipo aún no puede " +
                "presentarse al panel: enrola con un código desde la " +
                "caja de herramientas, sección Credencial."));

        // Servicio: línea con marcador; el estado real se consulta
        // en segundo plano al mostrar el paso (RefrescarResumenServicioAsync).
        _lineaResumenServicio = LineaResumen(null, "Servicio: consultando…");
        _resumen.Children.Add(_lineaResumenServicio);
    }

    private async Task RefrescarResumenServicioAsync()
    {
        string estado;
        try
        {
            estado = await Task.Run(() => Instalador.EstadoServicio());
        }
        catch (Exception ex)
        {
            _log.Excepcion("Asistente: no se pudo consultar el servicio para el resumen", ex);
            estado = "sin acceso";
        }

        if (_lineaResumenServicio is null)
        {
            return;
        }
        var (ok, texto) = estado switch
        {
            "en ejecución" => ((bool?)true,
                "Servicio: instalado y en ejecución."),
            "no instalado" => ((bool?)false,
                "Servicio: sin instalar. Instálalo desde la caja de " +
                "herramientas, sección Servicio."),
            "sin acceso" => ((bool?)null,
                "Servicio: no se pudo comprobar su estado."),
            _ => ((bool?)null,
                $"Servicio: instalado, pero {estado}.")
        };
        string marca = ok switch { true => "✓", false => "✗", _ => "•" };
        _lineaResumenServicio.Text = $"{marca} {texto}";
        _lineaResumenServicio.Foreground = ok switch
        {
            true => Tema.Verde,
            false => Tema.Rojo,
            _ => Tema.TintaAtenuada
        };
    }

    private static TextBlock LineaResumen(bool? ok, string texto)
    {
        string marca = ok switch { true => "✓", false => "✗", _ => "•" };
        var linea = Tema.TextoDatos($"{marca} {texto}", 12.5);
        linea.Foreground = ok switch
        {
            true => Tema.Verde,
            false => Tema.Rojo,
            _ => Tema.TintaAtenuada
        };
        linea.Margin = new Thickness(0, 0, 0, 5);
        return linea;
    }

    private void AbrirCajaHerramientas()
    {
        try
        {
            _log.Info("Asistente: abriendo la caja de herramientas");
            Hide();
            AppVentanas.EjecutarToolbox();
        }
        catch (Exception ex)
        {
            _log.Excepcion("Asistente: no se pudo abrir la caja de herramientas", ex);
            Show();
            return;
        }
        Close();
    }
}
