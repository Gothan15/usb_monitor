using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Ventana del compañero: pide la contraseña del dueño o de un
/// administrador para un dispositivo bloqueado.
///
/// No detecta dispositivos: sigue el archivo local que escribe el
/// servicio (pending_local.json) con un vigilante de archivos y un
/// sondeo de respaldo de 1 s, para aparecer en cuanto hay un
/// bloqueo. La validación la hace el servidor a través de
/// ClientePanel; esta ventana solo presenta el resultado.
/// </summary>
public sealed class CompaneroWindow : Window
{
    private readonly ClientePanel _cliente = new(new Configuracion());
    private readonly DispatcherTimer _temporizador;
    private readonly DispatcherTimer _latido;
    private readonly ComboBox _selector;
    private readonly TextBlock _detalle;
    private readonly TextBlock _aviso;
    private readonly StackPanel _formulario;
    private readonly TextBox _usuario;
    private readonly PasswordBox _contrasena;
    private readonly Button _boton;
    private readonly TextBlock _mensaje;
    private readonly TextBlock _textoDueno;

    private List<BloqueoLocal> _bloqueos = new();
    private string _firmaArchivo = string.Empty;
    private string? _claveActual;
    private string? _claveMensaje;
    private readonly ScaleTransform _escala = new(0.97, 0.97);
    private bool _leyendo;
    private bool _enviando;
    private bool _cerrando;

    private DuenoEquipoRespuesta? _duenoInfo;
    private DateTime _duenoConsultado = DateTime.MinValue;
    private bool _consultandoDueno;

    public CompaneroWindow()
    {
        Title = "USBMonitor — Dispositivo bloqueado";
        Width = 470;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Visibility = Visibility.Hidden;
        ShowInTaskbar = true;
        Tema.AplicarVentana(this);
        RenderTransform = _escala;
        RenderTransformOrigin = new Point(0.5, 0.5);

        var raiz = new StackPanel { Margin = new Thickness(18, 6, 18, 18) };
        raiz.Children.Add(Tema.TitularVentana("Dispositivo bloqueado"));

        var contenido = new StackPanel();

        _detalle = Tema.TextoDatos("", 12.5);
        _detalle.Foreground = Tema.TintaAtenuada;
        _detalle.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(_detalle);

        // De quién es la contraseña que vale en esta PC (o el aviso
        // de que no hay dueño asignado): lo rellena ConsultarDueno.
        _textoDueno = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 12.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10)
        };
        contenido.Children.Add(_textoDueno);

        _selector = Tema.Selector();
        _selector.Margin = new Thickness(0, 0, 0, 10);
        _selector.Visibility = Visibility.Collapsed;
        _selector.SelectionChanged += (_, _) => ActualizarSeleccion();
        contenido.Children.Add(_selector);

        _aviso = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 13,
            Foreground = Tema.Ambar,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 10),
            Visibility = Visibility.Collapsed
        };
        contenido.Children.Add(_aviso);

        _formulario = new StackPanel();
        _formulario.Children.Add(Tema.EtiquetaCampo("Usuario"));
        _usuario = Tema.CampoTexto();
        _usuario.Margin = new Thickness(0, 0, 0, 9);
        _formulario.Children.Add(_usuario);

        _formulario.Children.Add(Tema.EtiquetaCampo("Contraseña"));
        _contrasena = Tema.CampoContrasena();
        _contrasena.Margin = new Thickness(0, 0, 0, 12);
        _formulario.Children.Add(_contrasena);

        _boton = Tema.BotonPrimario("Desbloquear");
        _boton.HorizontalAlignment = HorizontalAlignment.Left;
        _boton.Click += async (_, _) => await EnviarAsync();
        _formulario.Children.Add(_boton);
        contenido.Children.Add(_formulario);

        _mensaje = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 13,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 12, 0, 0)
        };
        contenido.Children.Add(_mensaje);

        raiz.Children.Add(Tema.Tarjeta(contenido, new Thickness(0, 4, 0, 0), new Thickness(16)));
        Content = raiz;

        KeyDown += async (_, e) =>
        {
            if (e.Key == Key.Enter && _formulario.Visibility == Visibility.Visible)
            {
                await EnviarAsync();
            }
        };

        _temporizador = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(1)
        };
        _temporizador.Tick += async (_, _) => await RevisarArchivoAsync();

        _latido = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(1)
        };
        _latido.Tick += (_, _) => AnotarLatido();

        Loaded += async (_, _) =>
        {
            RegistroVentanas.Info("Ventana del compañero cargada.");
            await RevisarArchivoAsync();
            await ConsultarDuenoAsync();
            IniciarVigilanteArchivo();
            _temporizador.Start();
            _latido.Start();
        };

        Closed += (_, _) =>
        {
            _cerrando = true;
            _temporizador.Stop();
            _latido.Stop();
            _vigilante?.Dispose();
            _cliente.Dispose();
            RegistroVentanas.Info("Ventana del compañero cerrada.");
        };
    }

    private FileSystemWatcher? _vigilante;

    /// <summary>
    /// Vigilante de pending_local.json: el servicio lo escribe en
    /// cuanto bloquea un dispositivo (temporal + renombrado), y la
    /// ventana tiene que salir en ese instante, no en el siguiente
    /// sondeo. Cualquier toque al archivo o a su temporal dispara
    /// una relectura; RevisarArchivoAsync compara la firma y sale
    /// enseguida si nada cambió de verdad. Si el vigilante no puede
    /// crearse, queda el sondeo de 1 s.
    /// </summary>
    private void IniciarVigilanteArchivo()
    {
        try
        {
            _vigilante = new FileSystemWatcher(Registro.DirectorioDatos)
            {
                Filter = "pending_local.json*",
                NotifyFilter = NotifyFilters.LastWrite |
                               NotifyFilters.FileName |
                               NotifyFilters.Size,
                EnableRaisingEvents = true,
            };
            _vigilante.Changed += AlCambiarArchivo;
            _vigilante.Created += AlCambiarArchivo;
            _vigilante.Renamed += AlCambiarArchivo;
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error(
                "Sin vigilante de pending_local.json; queda el sondeo.", ex);
        }
    }

    private void AlCambiarArchivo(object sender, FileSystemEventArgs e)
    {
        _ = Dispatcher.InvokeAsync(async () => await RevisarArchivoAsync());
    }

    /// <summary>
    /// Cerrar la ventana con la X NO termina el compañero: se
    /// oculta y el proceso sigue vigilando pending_local.json.
    /// Antes la X mataba el proceso y la PC se quedaba sin ventana
    /// de desbloqueo hasta que alguien lo relanzara a mano (en los
    /// registros: 150 s sin compañero tras cerrar la ventana). El
    /// proceso termina al cerrar la sesión de Windows o si el
    /// servicio deja de necesitarlo; el servicio, además, relanza
    /// el compañero si alguna vez no está.
    /// </summary>
    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
        RegistroVentanas.Info(
            "Ventana del compañero oculta con la X; el compañero sigue en marcha.");
        base.OnClosing(e);
    }

    /// <summary>
    /// Pregunta al panel quién es el dueño asignado de esta PC
    /// (con caché de 30 s) y pinta la línea informativa. Es solo
    /// orientación para quien está frente a la PC: la autorización
    /// la sigue decidiendo el servidor al enviar la contraseña.
    /// </summary>
    private async Task ConsultarDuenoAsync()
    {
        if (_consultandoDueno ||
            DateTime.Now - _duenoConsultado < TimeSpan.FromSeconds(30))
        {
            return;
        }
        _consultandoDueno = true;
        _duenoConsultado = DateTime.Now;
        try
        {
            var resultado = await _cliente.DuenoEquipoAsync();
            if (resultado.Datos is { } datos)
            {
                _duenoInfo = datos;
                ActualizarTextoDueno();
            }
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("No se pudo consultar el dueño del equipo.", ex);
        }
        finally
        {
            _consultandoDueno = false;
        }
    }

    private void ActualizarTextoDueno()
    {
        if (_duenoInfo is null)
        {
            _textoDueno.Text = string.Empty;
            return;
        }

        if (!_duenoInfo.PasswordUnlockEnabled)
        {
            _textoDueno.Text =
                "El desbloqueo por contraseña está desactivado en el panel.";
            _textoDueno.Foreground = Tema.Ambar;
            return;
        }

        if (_duenoInfo.UnlockMode == "ADMIN_ONLY")
        {
            _textoDueno.Text =
                "Modo de esta PC: solo un administrador puede desbloquear.";
            _textoDueno.Foreground = Tema.TintaAtenuada;
            return;
        }

        if (!string.IsNullOrWhiteSpace(_duenoInfo.OwnerUsername))
        {
            _textoDueno.Text =
                $"Dueño de esta PC: {_duenoInfo.OwnerUsername}. " +
                "Su contraseña vale aquí; también la de un administrador.";
            _textoDueno.Foreground = Tema.TintaAtenuada;
            if (string.IsNullOrWhiteSpace(_usuario.Text))
            {
                _usuario.Text = _duenoInfo.OwnerUsername;
            }
            return;
        }

        _textoDueno.Text =
            "Esta PC no tiene usuario dueño asignado en el panel: " +
            "solo un administrador puede desbloquearla. Asigna un " +
            "usuario a este equipo en el panel (Usuarios).";
        _textoDueno.Foreground = Tema.Ambar;
    }

    private async Task RevisarArchivoAsync()
    {
        if (_leyendo || _cerrando)
        {
            return;
        }

        _leyendo = true;
        try
        {
            string ruta = DatosVentanas.RutaBloqueosLocales;
            string contenido = await Task.Run(() =>
                File.Exists(ruta) ? File.ReadAllText(ruta) : string.Empty);

            if (contenido == _firmaArchivo)
            {
                return;
            }
            _firmaArchivo = contenido;

            List<BloqueoLocal> nuevos = string.IsNullOrWhiteSpace(contenido)
                ? new List<BloqueoLocal>()
                : JsonSerializer.Deserialize<List<BloqueoLocal>>(contenido) ?? new List<BloqueoLocal>();

            _bloqueos = nuevos;
            RefrescarVentana();
            _ = ConsultarDuenoAsync();
        }
        catch (JsonException ex)
        {
            RegistroVentanas.Error("pending_local.json no se pudo interpretar.", ex);
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("No se pudo revisar pending_local.json.", ex);
        }
        finally
        {
            _leyendo = false;
        }
    }

    private void RefrescarVentana()
    {
        if (_bloqueos.Count == 0)
        {
            _claveActual = null;
            _claveMensaje = null;
            _mensaje.Text = string.Empty;
            OcultarConAnimacion();
            return;
        }

        _selector.Items.Clear();
        foreach (BloqueoLocal bloqueo in _bloqueos)
        {
            _selector.Items.Add(new ElementoSelector(bloqueo));
        }

        int indice = _bloqueos.FindIndex(b => b.Clave == _claveActual);
        _selector.SelectedIndex = indice >= 0 ? indice : 0;
        _selector.Visibility = _bloqueos.Count > 1
            ? Visibility.Visible
            : Visibility.Collapsed;

        bool estabaOculta = Visibility != Visibility.Visible;
        Visibility = Visibility.Visible;
        Show();
        Activate();

        if (estabaOculta)
        {
            AnimarEntrada();
            Topmost = true;
            var bajar = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            bajar.Tick += (_, _) =>
            {
                Topmost = false;
                bajar.Stop();
            };
            bajar.Start();
        }

        ActualizarSeleccion();
    }

    private BloqueoLocal? Actual()
    {
        if (_selector.SelectedItem is ElementoSelector elemento)
        {
            return elemento.Bloqueo;
        }
        return _bloqueos.FirstOrDefault();
    }

    private void ActualizarSeleccion()
    {
        BloqueoLocal? actual = Actual();
        if (actual is null)
        {
            return;
        }

        _claveActual = actual.Clave;
        if (_claveMensaje is not null && _claveMensaje != actual.Clave)
        {
            // El mensaje pintado (p. ej. un «Autorizado») era de
            // OTRO dispositivo: no puede seguir en pantalla para
            // este, ni su contraseña a medio escribir.
            _mensaje.Text = string.Empty;
            _claveMensaje = null;
            _contrasena.Clear();
        }
        string letra = string.IsNullOrWhiteSpace(actual.Letra)
            ? "sin letra"
            : actual.Letra;
        string serial = string.IsNullOrWhiteSpace(actual.Serial)
            ? "—"
            : actual.Serial;
        string nombre = string.IsNullOrWhiteSpace(actual.Nombre)
            ? "Dispositivo"
            : actual.Nombre;

        _detalle.Text = $"{nombre}{Environment.NewLine}serial {serial} · unidad {letra}";

        if (actual.EnWhitelist == false)
        {
            _aviso.Text = "USB no listado en la lista blanca: será bloqueado.";
            _aviso.Visibility = Visibility.Visible;
            _formulario.Visibility = Visibility.Collapsed;
        }
        else
        {
            _aviso.Text = string.Empty;
            _aviso.Visibility = Visibility.Collapsed;
            _formulario.Visibility = Visibility.Visible;
        }
    }

    private async Task EnviarAsync()
    {
        if (_enviando)
        {
            return;
        }

        BloqueoLocal? actual = Actual();
        if (actual is null)
        {
            return;
        }

        string usuario = _usuario.Text.Trim();
        string contrasena = _contrasena.Password;
        if (string.IsNullOrWhiteSpace(usuario) || string.IsNullOrEmpty(contrasena))
        {
            PintarMensaje("Escribe tu usuario y tu contraseña.", Tema.Ambar);
            return;
        }

        _enviando = true;
        _boton.IsEnabled = false;
        _usuario.IsEnabled = false;
        _contrasena.IsEnabled = false;
        _boton.Content = "Comprobando…";
        PintarMensaje("", Tema.TintaAtenuada);

        try
        {
            var respuesta = await _cliente.AutenticarDesbloqueoAsync(
                usuario,
                contrasena,
                actual.Letra,
                actual.Serial);

            if (respuesta.Autorizado)
            {
                PintarMensaje(
                    "Autorizado. El dispositivo se está liberando…",
                    Tema.Verde);
                _contrasena.Clear();
                return;
            }

            if (respuesta.EstadoHttp == 403 &&
                !string.IsNullOrWhiteSpace(respuesta.Mensaje))
            {
                PintarMensaje(respuesta.Mensaje, Tema.Ambar);
            }
            else if (respuesta.EstadoHttp == 401)
            {
                PintarMensaje(
                    "Usuario o contraseña incorrectos, o esa cuenta no es " +
                    "la dueña de esta PC ni administradora.",
                    Tema.Rojo);
            }
            else if (respuesta.EstadoHttp == 0)
            {
                PintarMensaje(
                    "Sin conexión con el servidor. Si urge, usa la página " +
                    "de emergencia: http://localhost:5001/desbloquear",
                    Tema.Ambar);
            }
            else
            {
                PintarMensaje(
                    string.IsNullOrWhiteSpace(respuesta.Mensaje)
                        ? "El servidor no autorizó."
                        : respuesta.Mensaje,
                    Tema.Rojo);
            }
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("El envío de la contraseña falló en la ventana.", ex);
            PintarMensaje(
                "Sin conexión con el servidor. Si urge, usa la página " +
                "de emergencia: http://localhost:5001/desbloquear",
                Tema.Ambar);
        }
        finally
        {
            _enviando = false;
            _boton.IsEnabled = true;
            _usuario.IsEnabled = true;
            _contrasena.IsEnabled = true;
            _boton.Content = "Desbloquear";
            _contrasena.Clear();
            _contrasena.Focus();
        }
    }

    private void PintarMensaje(string texto, Brush color)
    {
        _mensaje.Text = texto;
        _mensaje.Foreground = color;
        // El mensaje pertenece al dispositivo en pantalla: si el
        // seleccionado cambia, ActualizarSeleccion lo borra.
        _claveMensaje = _claveActual;
    }

    /// <summary>
    /// Entrada suave al aparecer: fundido y escala breve, en la
    /// línea de las animaciones del panel (nada de parpadeos).
    /// </summary>
    private void AnimarEntrada()
    {
        BeginAnimation(OpacityProperty, null);
        Opacity = 0;
        _escala.ScaleX = 0.97;
        _escala.ScaleY = 0.97;
        BeginAnimation(OpacityProperty,
            new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));
        var escala = new DoubleAnimation(0.97, 1, TimeSpan.FromMilliseconds(220))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        _escala.BeginAnimation(ScaleTransform.ScaleXProperty, escala);
        _escala.BeginAnimation(ScaleTransform.ScaleYProperty, escala);
    }

    /// <summary>
    /// Salida suave al vaciarse los bloqueos: fundido corto y la
    /// ventana se retira; si entra otro bloqueo a mitad del
    /// fundido, la entrada lo cancela y la ventana se queda.
    /// </summary>
    private void OcultarConAnimacion()
    {
        if (Visibility != Visibility.Visible)
        {
            Visibility = Visibility.Hidden;
            return;
        }
        var fundido = new DoubleAnimation(Opacity, 0, TimeSpan.FromMilliseconds(150));
        fundido.Completed += (_, _) =>
        {
            BeginAnimation(OpacityProperty, null);
            Opacity = 1;
            if (_bloqueos.Count == 0)
            {
                Visibility = Visibility.Hidden;
            }
        };
        BeginAnimation(OpacityProperty, fundido);
    }

    private void AnotarLatido()
    {
        try
        {
            string textoArchivo;
            string ruta = DatosVentanas.RutaBloqueosLocales;
            if (File.Exists(ruta))
            {
                double segundos = (DateTime.Now - File.GetLastWriteTime(ruta)).TotalSeconds;
                textoArchivo = $"pending_local.json de hace {segundos:0} s";
            }
            else
            {
                textoArchivo = "pending_local.json: sin archivo";
            }

            string ventana = IsVisible ? "visible" : "retirada";
            RegistroVentanas.Depurar(
                $"latido: bloqueos={_bloqueos.Count}, {textoArchivo}, ventana {ventana}");
        }
        catch (Exception ex)
        {
            RegistroVentanas.Depurar($"latido del compañero falló: {ex.Message}");
        }
    }

    private sealed class ElementoSelector
    {
        public ElementoSelector(BloqueoLocal bloqueo)
        {
            Bloqueo = bloqueo;
        }

        public BloqueoLocal Bloqueo { get; }

        public override string ToString()
        {
            string nombre = string.IsNullOrWhiteSpace(Bloqueo.Nombre)
                ? "Dispositivo"
                : Bloqueo.Nombre;
            return $"{nombre} · {Bloqueo.Serial}";
        }
    }

    /// <summary>Forma exacta de pending_local.json del servicio.</summary>
    private sealed class BloqueoLocal
    {
        [JsonPropertyName("clave")]
        public string? Clave { get; set; }

        [JsonPropertyName("serial")]
        public string? Serial { get; set; }

        [JsonPropertyName("nombre")]
        public string? Nombre { get; set; }

        [JsonPropertyName("letra")]
        public string? Letra { get; set; }

        [JsonPropertyName("tipo")]
        public string? Tipo { get; set; }

        [JsonPropertyName("en_whitelist")]
        public bool? EnWhitelist { get; set; }
    }
}
