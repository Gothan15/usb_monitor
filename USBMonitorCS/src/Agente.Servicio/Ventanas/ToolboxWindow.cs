using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Caja de herramientas del administrador.
///
/// Espejo en tema claro de la ventana de gestión del agente Python:
/// estado, control e instalación del servicio, servidor, credencial,
/// acciones de recuperación y cola del registro. Ninguna operación
/// de red, WMI o servicio se ejecuta en el hilo de la ventana.
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
    private readonly TextBlock _textoResumen;
    private readonly List<Button> _botonesServicio = new();
    private readonly Button _botonProbar;
    private readonly TextBox _host;
    private readonly TextBox _puerto;
    private readonly ComboBox _esquema;
    private readonly PasswordBox _token;
    private readonly TextBox _registro;

    private bool _refrescandoEstado;
    private bool _refrescandoRegistro;
    private bool _operandoServicio;
    private bool _probando;

    public ToolboxWindow()
    {
        _cliente = new ClientePanel(_config);

        Title = "USBMonitor — Gestión del agente";
        Width = 700;
        Height = 780;
        MinWidth = 620;
        MinHeight = 640;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Tema.AplicarVentana(this);

        var raiz = new StackPanel { Margin = new Thickness(18, 6, 18, 18) };
        raiz.Children.Add(Tema.TitularVentana(
            "USBMonitor · Gestión del agente",
            "Herramienta interna del equipo"));

        // Estado general: palabra con punto de color, como el panel.
        var filaEstado = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center
        };
        _puntoEstado = Tema.PuntoEstado(Tema.Ambar);
        filaEstado.Children.Add(_puntoEstado);
        _textoEstado = new TextBlock
        {
            Text = "Consultando…",
            FontFamily = Tema.FuenteTexto,
            FontSize = 13.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = Tema.Tinta
        };
        filaEstado.Children.Add(_textoEstado);

        var estado = new StackPanel();
        estado.Children.Add(filaEstado);
        _textoResumen = Tema.TextoDatos("servidor — · bloqueados ahora: —", 12);
        _textoResumen.Foreground = Tema.TintaAtenuada;
        _textoResumen.Margin = new Thickness(16, 5, 0, 0);
        estado.Children.Add(_textoResumen);
        raiz.Children.Add(Tema.Tarjeta(estado, new Thickness(0, 4, 0, 12), new Thickness(14, 11, 14, 11)));

        raiz.Children.Add(ConstruirSeccionServicio(out _textoServicio));
        raiz.Children.Add(ConstruirSeccionServidor(out _host, out _puerto, out _esquema, out _botonProbar));
        raiz.Children.Add(ConstruirSeccionCredencial(out _token));
        raiz.Children.Add(ConstruirSeccionAcciones());
        raiz.Children.Add(ConstruirSeccionRegistro(out _registro));

        Content = new ScrollViewer
        {
            Content = raiz,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };

        _temporizadorEstado = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _temporizadorEstado.Tick += async (_, _) => await RefrescarEstadoAsync();
        _temporizadorRegistro = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _temporizadorRegistro.Tick += async (_, _) => await RefrescarRegistroAsync();

        Loaded += async (_, _) =>
        {
            await RefrescarEstadoAsync();
            await RefrescarRegistroAsync();
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

    private Border ConstruirSeccionServicio(out TextBlock textoServicio)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Servicio"));

        textoServicio = Tema.TextoDatos("servicio: …", 12.5);
        textoServicio.Margin = new Thickness(0, 0, 0, 10);
        contenido.Children.Add(textoServicio);

        var fila = new WrapPanel();
        fila.Children.Add(BotonServicio("Iniciar", async () => await ControlarServicioAsync("start")));
        fila.Children.Add(BotonServicio("Detener", async () => await ControlarServicioAsync("stop")));
        fila.Children.Add(BotonServicio("Reiniciar", async () => await ControlarServicioAsync("restart")));
        contenido.Children.Add(fila);

        var filaInstalacion = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        var instalar = Tema.BotonPrimario("Instalar servicio");
        instalar.Click += async (_, _) => await InstalarAsync();
        _botonesServicio.Add(instalar);
        filaInstalacion.Children.Add(instalar);

        var desinstalar = Tema.BotonSecundario("Desinstalar servicio");
        desinstalar.Click += async (_, _) => await DesinstalarAsync();
        _botonesServicio.Add(desinstalar);
        filaInstalacion.Children.Add(desinstalar);
        contenido.Children.Add(filaInstalacion);

        return Tema.Tarjeta(contenido);
    }

    private Button BotonServicio(string texto, Func<Task> accion)
    {
        var boton = Tema.BotonSecundario(texto);
        boton.Click += async (_, _) => await accion();
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

        contenido.Children.Add(FilaCampo("Host / IP", host = Tema.CampoTexto(datos: true), 300));
        _host.Text = _config.HostServidor;
        contenido.Children.Add(FilaCampo("Puerto", puerto = Tema.CampoTexto(datos: true), 110));
        _puerto.Text = _config.PuertoServidor.ToString(System.Globalization.CultureInfo.InvariantCulture);

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

        var botones = new WrapPanel
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 5, 0, 0)
        };
        var guardar = Tema.BotonPrimario("Guardar servidor");
        guardar.Click += (_, _) => GuardarServidor();
        botones.Children.Add(guardar);

        botonProbar = Tema.BotonSecundario("Probar conexión");
        botonProbar.Margin = new Thickness(0);
        botonProbar.Click += async (_, _) => await ProbarConexionAsync();
        botones.Children.Add(botonProbar);
        contenido.Children.Add(botones);

        return Tema.Tarjeta(contenido);
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

    private Border ConstruirSeccionCredencial(out PasswordBox token)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Credencial del agente"));
        contenido.Children.Add(Tema.EtiquetaCampo("Token del equipo"));

        token = Tema.CampoContrasena();
        token.Margin = new Thickness(0, 0, 0, 9);
        contenido.Children.Add(token);

        var guardar = Tema.BotonPrimario("Guardar credencial");
        guardar.HorizontalAlignment = HorizontalAlignment.Left;
        guardar.Click += (_, _) => GuardarCredencial();
        contenido.Children.Add(guardar);

        contenido.Children.Add(new TextBlock
        {
            Text = "Lo genera un administrador en el panel: Equipos, botón «Token del agente».",
            FontFamily = Tema.FuenteTexto,
            FontSize = 11.5,
            Foreground = Tema.TintaAtenuada,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 9, 0, 0)
        });

        return Tema.Tarjeta(contenido);
    }

    private Border ConstruirSeccionAcciones()
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Acciones"));

        var fila = new WrapPanel();
        var restaurar = Tema.BotonDestructivo("Restaurar todo");
        restaurar.Click += async (_, _) => await RestaurarTodoAsync();
        fila.Children.Add(restaurar);

        var emergencia = Tema.BotonSecundario("Abrir página de emergencia");
        emergencia.Click += (_, _) => AbrirEmergencia();
        fila.Children.Add(emergencia);

        var companero = Tema.BotonSecundario("Compañero");
        companero.Click += (_, _) => LanzarModo("prompt");
        fila.Children.Add(companero);

        var visor = Tema.BotonSecundario("Visor de seriales");
        visor.Margin = new Thickness(0);
        visor.Click += (_, _) => LanzarModo("visor");
        fila.Children.Add(visor);

        contenido.Children.Add(fila);
        return Tema.Tarjeta(contenido);
    }

    private Border ConstruirSeccionRegistro(out TextBox registro)
    {
        var contenido = new StackPanel();
        contenido.Children.Add(Tema.EtiquetaSeccion("Registro"));

        registro = new TextBox
        {
            Height = 180,
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = Tema.SuperficieAtenuada,
            Foreground = Tema.Tinta,
            BorderBrush = Tema.Borde,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8),
            FontFamily = Tema.FuenteDatos,
            FontSize = 11.5
        };
        contenido.Children.Add(registro);
        return Tema.Tarjeta(contenido, new Thickness(0));
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

        return new EstadoFoto(servicio, _config.UrlBase, bloqueados, nodos, conexion);
    }

    private sealed record EstadoFoto(
        string Servicio,
        string UrlBase,
        int Bloqueados,
        int NodosPorRestaurar,
        string Conexion);

    // ── Servicio e instalación ──────────────────────────────────

    private async Task ControlarServicioAsync(string accion)
    {
        if (_operandoServicio)
        {
            return;
        }
        _operandoServicio = true;
        FijarBotonesServicio(true);

        try
        {
            await Task.Run(() => ControlarServicio(accion));
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

    private async Task InstalarAsync()
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
        await RefrescarEstadoAsync();
    }

    private async Task DesinstalarAsync()
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
        _botonProbar.Content = "Probando…";

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
            _botonProbar.Content = "Probar conexión";
            await RefrescarEstadoAsync();
        }
    }

    private void GuardarCredencial()
    {
        string token = _token.Password.Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            Tema.AvisarError("Escribe el token del equipo.", "Vacío");
            return;
        }

        if (_config.GuardarTokenAgente(token))
        {
            _token.Clear();
            Tema.Avisar(
                "Se guardó cifrada en server.json. Reinicia el servicio.",
                "Credencial guardada");
        }
        else
        {
            Tema.AvisarError("No se pudo guardar la credencial.", "Credencial");
        }
    }

    // ── Acciones ─────────────────────────────────────────────────

    private async Task RestaurarTodoAsync()
    {
        if (Tema.Confirmar(
                "Se reactivan los dispositivos que el agente deshabilitó y se " +
                "sueltan los volúmenes retenidos. ¿Continuar?",
                "Restaurar todo") != MessageBoxResult.Yes)
        {
            return;
        }

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

            bool alFinal = _registro.Text.Length == 0 ||
                _registro.VerticalOffset + _registro.ViewportHeight >=
                    _registro.ExtentHeight - 24;

            _registro.Text = texto;
            if (alFinal)
            {
                _registro.ScrollToEnd();
            }
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
