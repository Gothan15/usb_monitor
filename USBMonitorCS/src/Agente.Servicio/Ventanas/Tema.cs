using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Tema visual compartido del agente en C#.
///
/// Es la traducción a WPF del tema claro del panel web: papel frío,
/// tarjetas blancas, tinta azul marino, acero como acento y esquinas
/// rectas. Las ventanas no definen colores por su cuenta; todo sale
/// de esta clase para que compañero, caja de herramientas y visor se
/// lean como piezas del mismo sistema.
/// </summary>
public static class Tema
{
    public static SolidColorBrush FondoVentana => new(Color.FromRgb(0xEE, 0xF0, 0xF4));
    public static SolidColorBrush Superficie => new(Color.FromRgb(0xFF, 0xFF, 0xFF));
    public static SolidColorBrush SuperficieAtenuada => new(Color.FromRgb(0xE4, 0xE8, 0xEF));
    public static SolidColorBrush Borde => new(Color.FromRgb(0xC9, 0xD2, 0xDE));
    public static SolidColorBrush Tinta => new(Color.FromRgb(0x1D, 0x25, 0x36));
    public static SolidColorBrush TintaAtenuada => new(Color.FromRgb(0x5A, 0x6B, 0x80));
    public static SolidColorBrush Primario => new(Color.FromRgb(0x2F, 0x44, 0x70));
    public static SolidColorBrush Acero => new(Color.FromRgb(0x65, 0x7A, 0x90));
    public static SolidColorBrush Verde => new(Color.FromRgb(0x2F, 0x7D, 0x4F));
    public static SolidColorBrush Ambar => new(Color.FromRgb(0xA8, 0x74, 0x1A));
    public static SolidColorBrush Rojo => new(Color.FromRgb(0xB3, 0x38, 0x2E));
    public static SolidColorBrush Blanco => new(Colors.White);
    public static SolidColorBrush Transparente => new(Colors.Transparent);

    public static FontFamily FuenteTexto => new("Segoe UI");
    public static FontFamily FuenteDatos => new("Consolas");

    public static void AplicarVentana(Window ventana)
    {
        ventana.Background = FondoVentana;
        ventana.Foreground = Tinta;
        ventana.FontFamily = FuenteTexto;
        ventana.FontSize = 13.5;
        ventana.SnapsToDevicePixels = true;
        TextOptions.SetTextFormattingMode(ventana, TextFormattingMode.Display);
    }

    /// <summary>
    /// Entrada suave de ventana: fundido y escala breve al
    /// cargar, en la línea de las animaciones del panel web. El
    /// compañero no la usa: gestiona su propia aparición y
    /// retirada porque nace oculto.
    /// </summary>
    public static void AnimarEntrada(Window ventana)
    {
        var escala = new ScaleTransform(0.98, 0.98);
        ventana.RenderTransform = escala;
        ventana.RenderTransformOrigin = new Point(0.5, 0.5);
        ventana.Opacity = 0;
        ventana.Loaded += (_, _) =>
        {
            ventana.BeginAnimation(Window.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)));
            var animacion = new DoubleAnimation(0.98, 1, TimeSpan.FromMilliseconds(240))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            };
            escala.BeginAnimation(ScaleTransform.ScaleXProperty, animacion);
            escala.BeginAnimation(ScaleTransform.ScaleYProperty, animacion);
        };
    }

    /// <summary>
    /// Spinner del agente: un arco que gira, en el color que se
    /// le pida (dentro de un botón, el de su propio texto). Gira
    /// mientras está en pantalla; al salir de la ventana, la
    /// animación se detiene sola.
    /// </summary>
    public static FrameworkElement CrearSpinner(double tamano, Brush color)
    {
        double grosor = 2;
        double unidades = Math.PI * tamano / grosor;
        var arco = new Ellipse
        {
            Width = tamano,
            Height = tamano,
            Stroke = color,
            StrokeThickness = grosor,
            StrokeDashArray = new DoubleCollection
            {
                unidades * 0.72,
                unidades * 0.28
            },
            StrokeDashCap = PenLineCap.Round,
            VerticalAlignment = VerticalAlignment.Center,
            RenderTransformOrigin = new Point(0.5, 0.5)
        };
        var giro = new RotateTransform();
        arco.RenderTransform = giro;
        arco.Loaded += (_, _) =>
            giro.BeginAnimation(
                RotateTransform.AngleProperty,
                new DoubleAnimation(0, 360, TimeSpan.FromMilliseconds(900))
                {
                    RepeatBehavior = RepeatBehavior.Forever
                });
        arco.Unloaded += (_, _) =>
            giro.BeginAnimation(RotateTransform.AngleProperty, null);
        return arco;
    }

    /// <summary>
    /// Pone un botón «ocupado»: spinner y texto de trabajo
    /// («Probando…», «Instalando…») con su propio color de
    /// texto. Devuelve el contenido anterior, que se repone
    /// con RestaurarBoton al terminar. La habilitación no se
    /// toca aquí: unos botones se apagan en grupo y otros
    /// solos, y eso lo sigue mandando quien llama.
    /// </summary>
    public static object? MarcarOcupado(Button boton, string texto)
    {
        object? previo = boton.Content;
        var fila = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        var spinner = CrearSpinner(13, boton.Foreground);
        spinner.Margin = new Thickness(0, 0, 7, 0);
        fila.Children.Add(spinner);
        fila.Children.Add(new TextBlock
        {
            Text = texto,
            Foreground = boton.Foreground,
            FontFamily = boton.FontFamily,
            FontSize = boton.FontSize,
            FontWeight = boton.FontWeight,
            VerticalAlignment = VerticalAlignment.Center
        });
        boton.Content = fila;
        return previo;
    }

    public static void RestaurarBoton(Button boton, object? contenidoPrevio)
    {
        boton.Content = contenidoPrevio;
    }

    /// <summary>
    /// Pulso suave para un punto de estado: respira entre la
    /// opacidad llena y 0,4, en bucle. DetenerPulso lo deja
    /// fijo en opacidad llena.
    /// </summary>
    public static void Pulsar(Ellipse punto)
    {
        if (punto.Tag is "pulsando")
        {
            return;
        }
        punto.Tag = "pulsando";
        punto.BeginAnimation(
            UIElement.OpacityProperty,
            new DoubleAnimation(1, 0.4, TimeSpan.FromMilliseconds(900))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            });
    }

    public static void DetenerPulso(Ellipse punto)
    {
        if (punto.Tag is not "pulsando")
        {
            return;
        }
        punto.Tag = null;
        punto.BeginAnimation(UIElement.OpacityProperty, null);
        punto.Opacity = 1;
    }

    private static readonly IEasingFunction SalidaCubica =
        new CubicEase { EasingMode = EasingMode.EaseOut };

    /// <summary>
    /// Respuesta al clic: el botón se hunde un 4 % en 60 ms y
    /// vuelve en 140 ms con salida cúbica. Se monta en la
    /// fábrica común, así que vale para todos los botones de
    /// todas las ventanas sin tocar cada una.
    /// </summary>
    private static void PrepararRespuestaClic(Button boton)
    {
        var escala = new ScaleTransform(1, 1);
        boton.RenderTransform = escala;
        boton.RenderTransformOrigin = new Point(0.5, 0.5);
        boton.PreviewMouseDown += (_, _) =>
        {
            if (boton.IsEnabled)
            {
                AnimarEscalaBoton(escala, 0.96, 60, null);
            }
        };
        boton.PreviewMouseUp += (_, _) =>
            AnimarEscalaBoton(escala, 1, 140, SalidaCubica);
        boton.MouseLeave += (_, _) => AnimarEscalaBoton(escala, 1, 140, SalidaCubica);
    }

    private static void AnimarEscalaBoton(
        ScaleTransform escala, double destino, int milisegundos, IEasingFunction? easing)
    {
        var animacion = new DoubleAnimation(destino, TimeSpan.FromMilliseconds(milisegundos))
        {
            EasingFunction = easing
        };
        escala.BeginAnimation(ScaleTransform.ScaleXProperty, animacion);
        escala.BeginAnimation(ScaleTransform.ScaleYProperty, animacion);
    }

    /// <summary>
    /// Cabecera común: filete superior de 2 px en acero, título en
    /// Segoe UI semibold y, si se pide, una línea secundaria atenuada.
    /// </summary>
    public static Border TitularVentana(string titulo, string? subtitulo = null)
    {
        var textos = new StackPanel();

        textos.Children.Add(new TextBlock
        {
            Text = titulo,
            FontFamily = FuenteTexto,
            FontSize = 19,
            FontWeight = FontWeights.SemiBold,
            Foreground = Tinta,
            TextWrapping = TextWrapping.Wrap
        });

        if (!string.IsNullOrWhiteSpace(subtitulo))
        {
            textos.Children.Add(new TextBlock
            {
                Text = subtitulo,
                FontFamily = FuenteTexto,
                FontSize = 12.5,
                Foreground = TintaAtenuada,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 3, 0, 0)
            });
        }

        return new Border
        {
            Background = FondoVentana,
            BorderBrush = Acero,
            BorderThickness = new Thickness(0, 2, 0, 0),
            Padding = new Thickness(0, 12, 0, 10),
            Child = textos
        };
    }

    public static Border Tarjeta(UIElement contenido, Thickness? margen = null, Thickness? relleno = null)
    {
        return new Border
        {
            Background = Superficie,
            BorderBrush = Borde,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(0),
            Padding = relleno ?? new Thickness(14),
            Margin = margen ?? new Thickness(0, 0, 0, 12),
            Child = contenido
        };
    }

    public static TextBlock EtiquetaSeccion(string texto)
    {
        var bloque = new TextBlock
        {
            Text = texto,
            FontFamily = FuenteTexto,
            FontSize = 11.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = TintaAtenuada,
            Margin = new Thickness(0, 0, 0, 9)
        };
        bloque.SetValue(Typography.CapitalsProperty, FontCapitals.SmallCaps);
        return bloque;
    }

    public static TextBlock EtiquetaCampo(string texto)
    {
        var bloque = new TextBlock
        {
            Text = texto,
            FontFamily = FuenteTexto,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = TintaAtenuada,
            Margin = new Thickness(0, 0, 0, 4)
        };
        bloque.SetValue(Typography.CapitalsProperty, FontCapitals.SmallCaps);
        return bloque;
    }

    public static TextBlock TextoDatos(string texto = "", double tamano = 12.5)
    {
        return new TextBlock
        {
            Text = texto,
            FontFamily = FuenteDatos,
            FontSize = tamano,
            Foreground = Tinta,
            TextWrapping = TextWrapping.Wrap
        };
    }

    public static Button BotonPrimario(string texto)
    {
        var boton = CrearBotonBase(texto, Primario, Blanco, Primario);
        boton.FontWeight = FontWeights.SemiBold;
        return boton;
    }

    public static Button BotonSecundario(string texto)
    {
        return CrearBotonBase(texto, Superficie, Tinta, Borde);
    }

    public static Button BotonDestructivo(string texto)
    {
        var boton = CrearBotonBase(texto, Rojo, Blanco, Rojo);
        boton.FontWeight = FontWeights.SemiBold;
        return boton;
    }

    private static Button CrearBotonBase(string texto, Brush fondo, Brush textoColor, Brush borde)
    {
        var boton = new Button
        {
            Content = texto,
            Background = fondo,
            Foreground = textoColor,
            BorderBrush = borde,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 6, 12, 6),
            Margin = new Thickness(0, 0, 8, 0),
            FontFamily = FuenteTexto,
            FontSize = 13,
            Cursor = System.Windows.Input.Cursors.Hand,
            FocusVisualStyle = null
        };
        boton.Template = PlantillaBoton();
        PrepararRespuestaClic(boton);
        return boton;
    }

    private static ControlTemplate PlantillaBoton()
    {
        var plantilla = new ControlTemplate(typeof(Button));

        var borde = new FrameworkElementFactory(typeof(Border));
        borde.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        borde.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        borde.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        borde.SetValue(Border.CornerRadiusProperty, new CornerRadius(0));

        var presentador = new FrameworkElementFactory(typeof(ContentPresenter));
        presentador.SetBinding(ContentPresenter.ContentProperty, new System.Windows.Data.Binding("Content")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        presentador.SetBinding(FrameworkElement.MarginProperty, new System.Windows.Data.Binding("Padding")
        {
            RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)
        });
        presentador.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        presentador.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        borde.AppendChild(presentador);

        plantilla.VisualTree = borde;

        var alPasar = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        alPasar.Setters.Add(new Setter(UIElement.OpacityProperty, 0.88));
        plantilla.Triggers.Add(alPasar);

        var deshabilitado = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        deshabilitado.Setters.Add(new Setter(UIElement.OpacityProperty, 0.55));
        plantilla.Triggers.Add(deshabilitado);

        return plantilla;
    }

    public static TextBox CampoTexto(bool datos = false)
    {
        return new TextBox
        {
            Background = Superficie,
            Foreground = Tinta,
            BorderBrush = Borde,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 6, 8, 6),
            FontFamily = datos ? FuenteDatos : FuenteTexto,
            FontSize = 13,
            VerticalContentAlignment = VerticalAlignment.Center
        };
    }

    public static PasswordBox CampoContrasena()
    {
        return new PasswordBox
        {
            Background = Superficie,
            Foreground = Tinta,
            BorderBrush = Borde,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8, 6, 8, 6),
            FontFamily = FuenteTexto,
            FontSize = 13,
            VerticalContentAlignment = VerticalAlignment.Center
        };
    }

    public static ComboBox Selector()
    {
        return new ComboBox
        {
            Background = Superficie,
            Foreground = Tinta,
            BorderBrush = Borde,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6, 4, 6, 4),
            FontFamily = FuenteTexto,
            FontSize = 13
        };
    }

    public static Ellipse PuntoEstado(Brush color)
    {
        return new Ellipse
        {
            Width = 9,
            Height = 9,
            Fill = color,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 7, 0)
        };
    }

    public static Style EstiloDataGrid()
    {
        var estilo = new Style(typeof(DataGrid));
        estilo.Setters.Add(new Setter(Control.BackgroundProperty, Superficie));
        estilo.Setters.Add(new Setter(Control.ForegroundProperty, Tinta));
        estilo.Setters.Add(new Setter(Control.BorderBrushProperty, Borde));
        estilo.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(1)));
        estilo.Setters.Add(new Setter(Control.FontFamilyProperty, FuenteDatos));
        estilo.Setters.Add(new Setter(Control.FontSizeProperty, 12.5));
        estilo.Setters.Add(new Setter(DataGrid.GridLinesVisibilityProperty, DataGridGridLinesVisibility.Horizontal));
        estilo.Setters.Add(new Setter(DataGrid.HorizontalGridLinesBrushProperty, Borde));
        estilo.Setters.Add(new Setter(DataGrid.HeadersVisibilityProperty, DataGridHeadersVisibility.Column));
        estilo.Setters.Add(new Setter(DataGrid.CanUserAddRowsProperty, false));
        estilo.Setters.Add(new Setter(DataGrid.CanUserDeleteRowsProperty, false));
        estilo.Setters.Add(new Setter(DataGrid.IsReadOnlyProperty, true));
        estilo.Setters.Add(new Setter(DataGrid.SelectionModeProperty, DataGridSelectionMode.Single));
        estilo.Setters.Add(new Setter(DataGrid.AutoGenerateColumnsProperty, false));
        return estilo;
    }

    public static MessageBoxResult Confirmar(string texto, string titulo)
    {
        return MessageBox.Show(texto, titulo, MessageBoxButton.YesNo, MessageBoxImage.Question);
    }

    public static void Avisar(string texto, string titulo)
    {
        MessageBox.Show(texto, titulo, MessageBoxButton.OK, MessageBoxImage.Information);
    }

    public static void AvisarError(string texto, string titulo)
    {
        MessageBox.Show(texto, titulo, MessageBoxButton.OK, MessageBoxImage.Warning);
    }
}
