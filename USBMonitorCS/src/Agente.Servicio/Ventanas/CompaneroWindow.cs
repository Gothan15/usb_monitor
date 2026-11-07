using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Shapes;
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
    private readonly TextBlock _nombreDispositivo;
    private readonly TextBlock _datosDispositivo;
    private readonly Border _bandaAviso;
    private readonly TextBlock _aviso;
    private readonly Border _bandaMensaje;
    private Border _bordeBandaMensaje = null!;
    private Ellipse _puntoPastilla = null!;
    private TextBlock _textoPastilla = null!;
    private readonly StackPanel _formulario;
    private readonly TextBox _usuario;
    private readonly PasswordBox _contrasena;
    private readonly Button _boton;
    private readonly TextBlock _mensaje;
    private readonly TextBlock _textoDueno;

    private List<BloqueoLocal> _bloqueos = new();
    private readonly object _lockEvidencias = new();
    private readonly HashSet<string> _evidenciasTramitadas = new();
    private string _firmaArchivo = string.Empty;
    private string? _claveActual;
    private string? _claveMensaje;
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
        // Blanco cálido en vez del papel frío del tema: a petición
        // de Gothan, esta ventana va en tonos de blanco, sin azul.
        Background = new SolidColorBrush(Color.FromRgb(0xF5, 0xF3, 0xEF));

        // ── Presentación (remodelada el 2026-11-07 a petición de
        // Gothan: la ventana se veía demasiado simple) ──
        // Cabecera en blanco roto con filete dorado y pastilla de
        // estado, tarjeta blanca con el dispositivo como bloque de
        // identidad (nombre en semibold, serial en Consolas), el
        // dueño tras un filete de acero, y los avisos como bandas
        // con tinte y barra lateral en vez de texto suelto. La
        // lógica no cambia: mismos campos, mismos estados.
        var raiz = new StackPanel { Margin = new Thickness(0) };
        raiz.Children.Add(CrearCabecera());

        var contenido = new StackPanel();

        _nombreDispositivo = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Foreground = Tema.Tinta,
            TextWrapping = TextWrapping.Wrap
        };
        contenido.Children.Add(_nombreDispositivo);

        _datosDispositivo = Tema.TextoDatos("", 12);
        _datosDispositivo.Foreground = Tema.TintaAtenuada;
        _datosDispositivo.Margin = new Thickness(0, 3, 0, 0);
        contenido.Children.Add(_datosDispositivo);

        contenido.Children.Add(new Border
        {
            Height = 1,
            Background = Tema.Borde,
            Margin = new Thickness(0, 14, 0, 12)
        });

        // De quién es la contraseña que vale en esta PC (o el aviso
        // de que no hay dueño asignado): lo rellena ConsultarDueno.
        // Va tras un filete de acero, como un dato de registro.
        _textoDueno = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 12.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap
        };
        contenido.Children.Add(new Border
        {
            BorderBrush = new SolidColorBrush(Color.FromRgb(0xB9, 0xB4, 0xA8)),
            BorderThickness = new Thickness(2, 0, 0, 0),
            Padding = new Thickness(10, 2, 0, 2),
            Child = _textoDueno
        });

        _selector = Tema.Selector();
        _selector.Margin = new Thickness(0, 12, 0, 0);
        _selector.Visibility = Visibility.Collapsed;
        _selector.SelectionChanged += (_, _) => ActualizarSeleccion();
        contenido.Children.Add(_selector);

        // Aviso de «no listado»: banda ámbar con barra lateral, no
        // un renglón de texto suelto sobre la tarjeta.
        _aviso = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x7A, 0x55, 0x10)),
            TextWrapping = TextWrapping.Wrap
        };
        _bandaAviso = CrearBanda(
            _aviso,
            new SolidColorBrush(Color.FromRgb(0xFA, 0xF1, 0xDC)),
            Tema.Ambar);
        _bandaAviso.Margin = new Thickness(0, 12, 0, 0);
        _bandaAviso.Visibility = Visibility.Collapsed;
        contenido.Children.Add(_bandaAviso);

        _formulario = new StackPanel { Margin = new Thickness(0, 14, 0, 0) };
        _formulario.Children.Add(Tema.EtiquetaCampo("Usuario"));
        _usuario = Tema.CampoTexto();
        _usuario.Padding = new Thickness(10, 7, 10, 7);
        _usuario.MinHeight = 36;
        _usuario.Margin = new Thickness(0, 0, 0, 10);
        ResaltarAlEnfocar(_usuario);
        _formulario.Children.Add(_usuario);

        _formulario.Children.Add(Tema.EtiquetaCampo("Contraseña"));
        _contrasena = Tema.CampoContrasena();
        _contrasena.Padding = new Thickness(10, 7, 10, 7);
        _contrasena.MinHeight = 36;
        _contrasena.Margin = new Thickness(0, 0, 0, 14);
        ResaltarAlEnfocar(_contrasena);
        _formulario.Children.Add(_contrasena);

        _boton = Tema.BotonPrimario("Desbloquear");
        _boton.Background = Carbon;
        _boton.BorderBrush = Carbon;
        _boton.HorizontalAlignment = HorizontalAlignment.Stretch;
        _boton.Margin = new Thickness(0);
        _boton.Padding = new Thickness(16, 9, 16, 9);
        _boton.Click += async (_, _) => await EnviarAsync();
        _formulario.Children.Add(_boton);
        contenido.Children.Add(_formulario);

        // Mensajes (error, «Autorizado»): también banda con tinte
        // según el tono, la pinta PintarMensaje.
        _mensaje = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 12.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap
        };
        _bandaMensaje = CrearBanda(_mensaje, Tema.SuperficieAtenuada, Tema.Acero);
        _bandaMensaje.Margin = new Thickness(0, 12, 0, 0);
        _bandaMensaje.Visibility = Visibility.Collapsed;
        contenido.Children.Add(_bandaMensaje);

        var cuerpo = new StackPanel { Margin = new Thickness(20, 16, 20, 18) };
        var tarjeta = Tema.Tarjeta(contenido, new Thickness(0), new Thickness(18));
        tarjeta.BorderBrush = new SolidColorBrush(Color.FromRgb(0xD8, 0xD3, 0xC8));
        cuerpo.Children.Add(tarjeta);
        raiz.Children.Add(cuerpo);
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
        _temporizador.Tick += async (_, _) =>
        {
            await RevisarArchivoAsync();
            RevisarSolicitudesEvidencia();
        };

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
            IniciarVigilanteEvidencia();
            RevisarSolicitudesEvidencia();
            _temporizador.Start();
            _latido.Start();
        };

        Closed += (_, _) =>
        {
            _cerrando = true;
            _temporizador.Stop();
            _latido.Stop();
            _vigilante?.Dispose();
            _vigilanteEvidencia?.Dispose();
            _cliente.Dispose();
            RegistroVentanas.Info("Ventana del compañero cerrada.");
        };
    }

    private FileSystemWatcher? _vigilante;

    /// <summary>
    /// Vigilante de pending_local.json: el servicio lo escribe en
    /// cuanto bloquea un dispositivo (temporal + renombrado), y la
    /// ventana tiene que salir en ese instante, no en el siguiente
    /// sondeo. Solo se vigila el archivo REAL: vigilar también el
    /// temporal despertaba la relectura a mitad del reemplazo y
    /// la lectura abierta le denegaba la escritura al servicio.
    /// RevisarArchivoAsync compara la firma y sale enseguida si
    /// nada cambió de verdad. Si el vigilante no puede crearse,
    /// queda el sondeo de 1 s.
    /// </summary>
    private void IniciarVigilanteArchivo()
    {
        try
        {
            _vigilante = new FileSystemWatcher(Registro.DirectorioDatos)
            {
                Filter = "pending_local.json",
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

    private FileSystemWatcher? _vigilanteEvidencia;

    /// <summary>
    /// Vigilante de la carpeta `evidencia`: el servicio deja ahí la
    /// solicitud de la foto del momento de un bloqueo no autorizado
    /// y la captura no puede esperar al sondeo de 1 s (la pantalla
    /// cambia). El sondeo del temporizador queda de respaldo, como
    /// con pending_local.json.
    /// </summary>
    private void IniciarVigilanteEvidencia()
    {
        try
        {
            var carpeta = GestorEvidencia.Carpeta(Registro.DirectorioDatos);
            Directory.CreateDirectory(carpeta);
            _vigilanteEvidencia = new FileSystemWatcher(carpeta)
            {
                Filter = "*.solicitud.json",
                NotifyFilter = NotifyFilters.LastWrite |
                               NotifyFilters.FileName |
                               NotifyFilters.Size,
                EnableRaisingEvents = true,
            };
            _vigilanteEvidencia.Created += (_, _) =>
                _ = Dispatcher.InvokeAsync(RevisarSolicitudesEvidencia);
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error(
                "Sin vigilante de la carpeta de evidencia; queda el sondeo.", ex);
        }
    }

    /// <summary>
    /// Recoge las solicitudes nuevas y captura cada una en su
    /// propio hilo: la ventana de bloqueo no espera a la captura,
    /// que tarda lo que tarde el escritorio en dejarse fotografiar.
    /// </summary>
    private void RevisarSolicitudesEvidencia()
    {
        try
        {
            var carpeta = GestorEvidencia.Carpeta(Registro.DirectorioDatos);
            foreach (var solicitud in GestorEvidencia.ListarSolicitudes(carpeta))
            {
                var segura = GestorEvidencia.NombreSeguro(solicitud.Clave);
                lock (_lockEvidencias)
                {
                    if (!_evidenciasTramitadas.Add(segura)) continue;
                }
                var pedida = solicitud;
                _ = Task.Run(() => CapturarEvidencia(pedida));
            }
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("No se pudo revisar la carpeta de evidencia.", ex);
        }
    }

    /// <summary>
    /// Captura la foto del momento de un bloqueo y deja el paquete
    /// en la carpeta para que el servicio lo suba. Si esta ventana
    /// está en pantalla, se retira un instante antes de la foto:
    /// la evidencia es el escritorio del usuario, no el aviso. Si
    /// la captura entera fallara, el paquete sale igual, sin imagen
    /// y con la nota — el panel prefiere una evidencia parcial a
    /// ninguna.
    /// </summary>
    private void CapturarEvidencia(SolicitudEvidencia solicitud)
    {
        var estabaVisible = false;
        try
        {
            Dispatcher.Invoke(() =>
            {
                estabaVisible = IsVisible;
                if (estabaVisible) Visibility = Visibility.Hidden;
            });
            if (estabaVisible) Thread.Sleep(120);

            PaqueteEvidencia paquete;
            try
            {
                paquete = CapturadorEvidencia.Capturar(solicitud);
            }
            catch (Exception ex)
            {
                RegistroVentanas.Error("La captura de evidencia falló.", ex);
                paquete = new PaqueteEvidencia
                {
                    Clave = solicitud.Clave,
                    Serial = solicitud.Serial,
                    CapturedAt = DateTime.UtcNow.ToString("o"),
                    Nota = $"La captura falló en el equipo: {ex.Message}",
                };
            }

            var carpeta = GestorEvidencia.Carpeta(Registro.DirectorioDatos);
            GestorEvidencia.GuardarPaquete(carpeta, paquete);
            GestorEvidencia.BorrarSolicitud(carpeta, solicitud.Clave);
            RegistroVentanas.Info(
                $"Evidencia capturada para el bloqueo del serial {solicitud.Serial}.");
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("No se pudo completar la captura de evidencia.", ex);
        }
        finally
        {
            if (estabaVisible)
            {
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_bloqueos.Count > 0) RefrescarVentana();
                });
            }
        }
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

    /// <summary>
    /// Lectura que no bloquea al escritor: el servicio reemplaza
    /// el archivo por renombrado y Windows deniega el reemplazo
    /// si un lector lo tiene abierto sin FileShare.Delete. Con
    /// este modo de apertura, la lectura del compañero nunca
    /// puede tumbar la escritura del servicio.
    /// </summary>
    private static string LeerArchivoCompartido(string ruta)
    {
        if (!File.Exists(ruta)) return string.Empty;
        using var flujo = new FileStream(ruta, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var lector = new StreamReader(flujo);
        return lector.ReadToEnd();
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
            string contenido = await Task.Run(() => LeerArchivoCompartido(ruta));

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
            BorrarMensaje();
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
            // Sin animación de entrada: la ventana aparece tal cual.
            // La entrada animada (fundido + escala del PR #59) se
            // retiró en la caza del «no abre»: era la sospechosa del
            // cierre al arrancar y el compañero no puede permitirse
            // ni un adorno que le cueste el arranque.
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
            BorrarMensaje();
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

        _nombreDispositivo.Text = nombre;
        _datosDispositivo.Text = $"serial {serial} · unidad {letra}";

        if (actual.EnWhitelist == false)
        {
            _aviso.Text = "USB no listado en la lista blanca: será bloqueado.";
            _bandaAviso.Visibility = Visibility.Visible;
            _formulario.Visibility = Visibility.Collapsed;
            PintarPastilla("No autorizado", Tema.Ambar,
                new SolidColorBrush(Color.FromRgb(0x7A, 0x55, 0x10)));
        }
        else
        {
            _aviso.Text = string.Empty;
            _bandaAviso.Visibility = Visibility.Collapsed;
            _formulario.Visibility = Visibility.Visible;
            PintarPastilla("Bloqueado",
                new SolidColorBrush(Color.FromRgb(0xC4, 0x45, 0x3A)),
                new SolidColorBrush(Color.FromRgb(0x8E, 0x2F, 0x28)));
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
        object? previoBoton = Tema.MarcarOcupado(_boton, "Comprobando…");
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
            Tema.RestaurarBoton(_boton, previoBoton);
            _contrasena.Clear();
            _contrasena.Focus();
        }
    }

    private void PintarMensaje(string texto, Brush color)
    {
        _mensaje.Text = texto;
        _mensaje.Foreground = color;
        // La banda toma el tinte del tono: verde al autorizar,
        // rojo al fallar, acero para lo neutro. Se compara por el
        // VALOR del color: Tema.Verde y demás crean una brocha
        // nueva en cada acceso, así que por referencia no casan.
        Color valor = (color as SolidColorBrush)?.Color ?? Colors.Transparent;
        if (valor == Tema.Verde.Color)
        {
            _bandaMensaje.Background =
                new SolidColorBrush(Color.FromRgb(0xE7, 0xF2, 0xEA));
            _bordeBandaMensaje.Background = Tema.Verde;
        }
        else if (valor == Tema.Rojo.Color)
        {
            _bandaMensaje.Background =
                new SolidColorBrush(Color.FromRgb(0xF9, 0xE9, 0xE7));
            _bordeBandaMensaje.Background = Tema.Rojo;
        }
        else if (valor == Tema.Ambar.Color)
        {
            _bandaMensaje.Background =
                new SolidColorBrush(Color.FromRgb(0xFA, 0xF1, 0xDC));
            _bordeBandaMensaje.Background = Tema.Ambar;
        }
        else
        {
            _bandaMensaje.Background = Tema.SuperficieAtenuada;
            _bordeBandaMensaje.Background = Tema.Acero;
        }
        _bandaMensaje.Visibility = string.IsNullOrWhiteSpace(texto)
            ? Visibility.Collapsed
            : Visibility.Visible;
        // El mensaje pertenece al dispositivo en pantalla: si el
        // seleccionado cambia, ActualizarSeleccion lo borra.
        _claveMensaje = _claveActual;
    }

    private void BorrarMensaje()
    {
        _mensaje.Text = string.Empty;
        _bandaMensaje.Visibility = Visibility.Collapsed;
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
        try
        {
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
        catch (Exception ex)
        {
            // Sin fundido, pero oculta igual: el bloqueo ya no está.
            RegistroVentanas.Error(
                "El fundido de salida del compañero falló; se oculta sin animar.", ex);
            try
            {
                BeginAnimation(OpacityProperty, null);
                Opacity = 1;
            }
            catch
            {
                // Ni el restablecimiento: ocultar es lo imprescindible.
            }
            Visibility = Visibility.Hidden;
        }
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

    // ── Piezas de la presentación remodelada ──────────────────

    private static readonly Brush Dorado =
        new SolidColorBrush(Color.FromRgb(0xC0, 0x9A, 0x3B));

    /// <summary>Carbón neutro del botón principal (sin azul).</summary>
    private static readonly Brush Carbon =
        new SolidColorBrush(Color.FromRgb(0x26, 0x26, 0x2B));

    /// <summary>
    /// Cabecera de la ventana: banda en blanco roto en degradado con
    /// la marca de la página, su nombre en versalitas, el título
    /// del estado y la pastilla con el estado a la derecha.
    /// Debajo, el filete dorado de 2 px que separa del cuerpo.
    /// </summary>
    private Border CrearCabecera()
    {
        var marcaIcono = CrearIconoMarca();

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
            Text = "Dispositivo bloqueado",
            FontFamily = new FontFamily("Segoe UI Light"),
            FontSize = 20,
            Foreground = new SolidColorBrush(Color.FromRgb(0x22, 0x25, 0x2A)),
            Margin = new Thickness(0, 1, 0, 0)
        };
        var textos = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0)
        };
        textos.Children.Add(marca);
        textos.Children.Add(titulo);

        _puntoPastilla = new Ellipse
        {
            Width = 7,
            Height = 7,
            Fill = Tema.Blanco,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 6, 0)
        };
        _textoPastilla = new TextBlock
        {
            FontFamily = Tema.FuenteTexto,
            FontSize = 10.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x3A, 0x3D, 0x42)),
            VerticalAlignment = VerticalAlignment.Center
        };
        _textoPastilla.SetValue(Typography.CapitalsProperty, FontCapitals.SmallCaps);
        var filaPastilla = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center
        };
        filaPastilla.Children.Add(_puntoPastilla);
        filaPastilla.Children.Add(_textoPastilla);
        var pastilla = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0xE9, 0xE7, 0xE0)),
            CornerRadius = new CornerRadius(9),
            Padding = new Thickness(9, 3, 9, 3),
            VerticalAlignment = VerticalAlignment.Center,
            Child = filaPastilla
        };

        var fila = new Grid();
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(marcaIcono, 0);
        Grid.SetColumn(textos, 1);
        Grid.SetColumn(pastilla, 2);
        fila.Children.Add(marcaIcono);
        fila.Children.Add(textos);
        fila.Children.Add(pastilla);

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
            Padding = new Thickness(20, 14, 20, 13),
            Child = fila
        });
        pila.Children.Add(new Border { Height = 2, Background = Dorado });
        return new Border { Child = pila };
    }

    /// <summary>
    /// La marca de la casa: el emblema NORTHSTAR, leído del propio
    /// icono de la ventana (el recurso .ico incrustado) para que
    /// la cabecera enseñe EXACTAMENTE el mismo arte que el icono
    /// del programa, sin dibujos paralelos que puedan divergir.
    /// </summary>
    private static UIElement CrearIconoMarca()
    {
        try
        {
            var imagen = new Image
            {
                Source = System.Windows.Media.Imaging.BitmapFrame.Create(
                    new Uri("pack://application:,,,/" + "usb_prompt.ico", UriKind.Absolute)),
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
            // Si el recurso fallara, una baldosa oscura mantiene
            // la cabecera compuesta; la ventana no depende de esto.
            return new Border
            {
                Width = 36,
                Height = 36,
                CornerRadius = new CornerRadius(9),
                Background = new SolidColorBrush(Color.FromRgb(0x17, 0x18, 0x1A))
            };
        }
    }

    private void PintarPastilla(string texto, Brush punto, Brush textoColor)
    {
        _textoPastilla.Text = texto;
        _textoPastilla.Foreground = textoColor;
        _puntoPastilla.Fill = punto;
    }

    /// <summary>
    /// Banda de aviso o de mensaje: tinte de fondo y barra lateral
    /// de 3 px en el color del tono, con el texto dentro. La barra
    /// de la banda de mensaje se guarda aparte porque su color
    /// cambia con cada mensaje (verde/rojo/acero).
    /// </summary>
    private Border CrearBanda(TextBlock texto, Brush fondo, Brush barra)
    {
        var lateral = new Border { Width = 3, Background = barra };
        if (ReferenceEquals(texto, _mensaje))
        {
            _bordeBandaMensaje = lateral;
        }
        texto.Margin = new Thickness(10, 8, 10, 8);
        var fila = new Grid();
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        fila.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(lateral, 0);
        Grid.SetColumn(texto, 1);
        fila.Children.Add(lateral);
        fila.Children.Add(texto);
        return new Border { Background = fondo, Child = fila };
    }

    /// <summary>Al enfocar un campo, su borde pasa a dorado oscuro.</summary>
    private static void ResaltarAlEnfocar(Control campo)
    {
        campo.GotFocus += (_, _) =>
            campo.BorderBrush = new SolidColorBrush(Color.FromRgb(0xA8, 0x82, 0x2F));
        campo.LostFocus += (_, _) => campo.BorderBrush = Tema.Borde;
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
