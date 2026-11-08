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
    private readonly PasswordBox _token;
    private readonly PasswordBox _claveEnroll;
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
        Title = "NorthStar USB — Configuración de este equipo";
        Width = 620;
        Height = 660;
        MinWidth = 560;
        MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Tema.AplicarVentana(this);

        var raiz = new StackPanel { Margin = new Thickness(18, 6, 18, 18) };
        raiz.Children.Add(Tema.TitularVentana(
            "USBMonitor · Configuración de este equipo",
            "Asistente de primera vez"));

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
        raiz.Children.Add(_indicadorPaso);

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
        raiz.Children.Add(filaSegmentos);

        // Zona de pasos: los cinco paneles conviven y solo se ve uno.
        var zona = new Grid();
        _pasos.Add(ConstruirPasoBienvenida());
        _pasos.Add(ConstruirPasoServidor(out _host, out _puerto, out _esquema,
            out _botonProbar, out _resultadosPrueba, out _avisoConexion));
        _pasos.Add(ConstruirPasoCredencial(out _token, out _claveEnroll, out _avisoToken));
        _pasos.Add(ConstruirPasoServicio(out _textoEstadoServicio,
            out _botonInstalarServicio, out _avisoAdmin));
        _pasos.Add(ConstruirPasoListo(out _resumen));
        foreach (UIElement paso in _pasos)
        {
            zona.Children.Add(paso);
        }
        raiz.Children.Add(Tema.Tarjeta(zona, new Thickness(0, 0, 0, 14),
            new Thickness(16)));

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
        _botonAtras.Click += (_, _) => MostrarPaso(_pasoActual - 1);
        izquierda.Children.Add(_botonAtras);
        _botonSaltar = Tema.BotonSecundario("Saltar por ahora");
        _botonSaltar.Margin = new Thickness(0);
        _botonSaltar.Click += (_, _) => MostrarPaso(_pasoActual + 1);
        izquierda.Children.Add(_botonSaltar);
        Grid.SetColumn(izquierda, 0);
        rejillaNav.Children.Add(izquierda);

        _botonContinuar = Tema.BotonPrimario("Continuar");
        _botonContinuar.Margin = new Thickness(0);
        _botonContinuar.Click += async (_, _) => await ContinuarAsync();
        Grid.SetColumn(_botonContinuar, 1);
        rejillaNav.Children.Add(_botonContinuar);
        _filaNavegacion.Children.Add(rejillaNav);
        raiz.Children.Add(_filaNavegacion);

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
            _segmentos[i].Fill = i < _pasoActual ? Tema.Acero : Tema.Borde;
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
                if (await GuardarTokenDesdeCampoAsync())
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
        if (!int.TryParse(_puerto.Text.Trim(), out int puerto) ||
            puerto < 1 || puerto > 65535)
        {
            Tema.AvisarError("El puerto debe ser un número entre 1 y 65535.", "Puerto inválido");
            return false;
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
        out PasswordBox token, out PasswordBox claveEnroll, out TextBlock avisoToken)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Credencial del equipo"));
        contenido.Children.Add(TextoExplicacion(
            "Cada equipo se presenta al panel con su propio token, " +
            "como una contraseña de la máquina. El camino rápido: si " +
            "el administrador generó la clave de enrolamiento de la " +
            "flota (Ajustes → Enrolamiento de agentes), escríbela " +
            "abajo y el panel emite el token de este equipo al " +
            "instante, sin generar ni copiar tokens equipo a " +
            "equipo. El camino de siempre también vale: un token " +
            "generado para este equipo en Equipos → «Token del " +
            "agente»."));

        var nombrePc = Tema.TextoDatos(
            $"El nombre de este equipo es {Configuracion.NombrePc}.");
        nombrePc.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(nombrePc);

        contenido.Children.Add(Tema.EtiquetaCampo("Token del equipo"));
        token = Tema.CampoContrasena();
        token.Margin = new Thickness(0, 0, 0, 4);
        contenido.Children.Add(token);

        var separador = new TextBlock
        {
            Text = "— o, con la clave de enrolamiento de la flota —",
            FontFamily = Tema.FuenteTexto,
            FontSize = 11.5,
            Foreground = Tema.TintaAtenuada,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 12, 0, 8)
        };
        contenido.Children.Add(separador);

        contenido.Children.Add(Tema.EtiquetaCampo("Clave de enrolamiento (flota)"));
        claveEnroll = Tema.CampoContrasena();
        claveEnroll.Margin = new Thickness(0, 0, 0, 4);
        contenido.Children.Add(claveEnroll);

        contenido.Children.Add(new TextBlock
        {
            Text = "Se guarda cifrado en esta PC. Si ahora no tienes el " +
                   "token, pulsa «Saltar por ahora» y pégalo después en " +
                   "la caja de herramientas, sección Credencial.",
            FontFamily = Tema.FuenteTexto,
            FontSize = 11.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6, 0, 0)
        });

        avisoToken = TextoAviso(
            "Escribe el token del equipo o la clave de enrolamiento, " +
            "o pulsa «Saltar por ahora» para dejarlo para después.");
        contenido.Children.Add(avisoToken);

        return contenido;
    }

    private async Task<bool> GuardarTokenDesdeCampoAsync()
    {
        // Con clave de enrolamiento escrita, manda ella: se pide
        // el token propio al panel y se guarda el que devuelva.
        string claveEnroll = _claveEnroll.Password.Trim();
        if (!string.IsNullOrWhiteSpace(claveEnroll))
        {
            _avisoToken.Visibility = Visibility.Collapsed;
            string? emitido;
            using (var cliente = new ClientePanel(_config))
            {
                emitido = await cliente.EnrolarAsync(claveEnroll);
            }
            _claveEnroll.Clear();
            if (emitido is null)
            {
                Tema.AvisarError(
                    "El panel no aceptó la clave de enrolamiento. " +
                    "Comprueba el servidor del paso anterior y que la " +
                    "clave sea la vigente.", "Credencial");
                return false;
            }
            if (!_config.GuardarTokenAgente(emitido))
            {
                Tema.AvisarError("No se pudo guardar la credencial.", "Credencial");
                return false;
            }
            _log.Info("Asistente: equipo enrolado; token propio guardado");
            return true;
        }

        string token = _token.Password.Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            _avisoToken.Visibility = Visibility.Visible;
            return false;
        }
        _avisoToken.Visibility = Visibility.Collapsed;

        if (!_config.GuardarTokenAgente(token))
        {
            Tema.AvisarError("No se pudo guardar la credencial.", "Credencial");
            return false;
        }
        _token.Clear();
        _log.Info("Asistente: token del equipo guardado");
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
        bool hayToken = !string.IsNullOrWhiteSpace(_config.TokenAgente);
        _resumen.Children.Add(hayToken
            ? LineaResumen(true, "Credencial: token del equipo guardado.")
            : LineaResumen(false,
                "Credencial: token del equipo sin guardar. Este equipo aún " +
                "no puede presentarse al panel: pégalo en la caja de " +
                "herramientas, sección Credencial."));

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
