using System.IO;
using System.Windows;
using System.Windows.Threading;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Punto de entrada reutilizable para las ventanas del agente.
///
/// Program.cs decide el modo (prompt, gui o visor) y llama a uno de
/// estos métodos; aquí se resuelve lo común de WPF: crear la
/// Application si este proceso aún no tiene una, respetar el hilo
/// STA y mantener una única instancia del compañero.
/// </summary>
public static class AppVentanas
{
    private static readonly object CerrojoAplicacion = new();
    private static Mutex? _mutexCompanero;

    public static void EjecutarCompanero()
    {
        RegistroVentanas.Configurar("companero.log");

        bool creada;
        try
        {
            _mutexCompanero = new Mutex(true, @"Local\USBMonitorCompanero", out creada);
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("No se pudo crear el Mutex del compañero.", ex);
            creada = true;
        }

        if (!creada)
        {
            RegistroVentanas.Advertencia(
                "Ya hay un compañero en marcha: este proceso sale.");
            try { _mutexCompanero?.Dispose(); } catch { /* Sin efecto. */ }
            _mutexCompanero = null;
            return;
        }

        try
        {
            RegistroVentanas.Info($"Compañero iniciado, pid {Environment.ProcessId}.");
            EjecutarVentana(() => ConIcono(new CompaneroWindow(), "usb_prompt.ico"));
            RegistroVentanas.Info("Compañero terminado.");
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("EL COMPAÑERO SE CERRÓ POR UN ERROR", ex);
            throw;
        }
        finally
        {
            try { _mutexCompanero?.ReleaseMutex(); } catch { /* Puede no ser dueño en una salida rara. */ }
            try { _mutexCompanero?.Dispose(); } catch { /* Sin efecto. */ }
            _mutexCompanero = null;
        }
    }

    public static void EjecutarToolbox()
    {
        RegistroVentanas.Configurar("agente.log");
        try
        {
            RegistroVentanas.Info($"Caja de herramientas iniciada, pid {Environment.ProcessId}.");
            EjecutarVentana(() => ConIcono(new ToolboxWindow(), "usb_monitor_service.ico"));
            RegistroVentanas.Info("Caja de herramientas cerrada.");
        }
        catch (Exception ex)
        {
            // Como el compañero: que un cierre por error NUNCA sea
            // mudo. Antes esta ruta no registraba nada y un fallo al
            // abrir moría sin dejar ni una línea en agente.log.
            RegistroVentanas.Error("LA CAJA DE HERRAMIENTAS SE CERRÓ POR UN ERROR", ex);
            throw;
        }
    }

    public static void EjecutarAsistente()
    {
        RegistroVentanas.Configurar("agente.log");
        try
        {
            RegistroVentanas.Info($"Asistente de configuración iniciado, pid {Environment.ProcessId}.");
            EjecutarVentana(() => ConIcono(new AsistenteWindow(), "usb_monitor_service.ico"));
            RegistroVentanas.Info("Asistente de configuración cerrado.");
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("EL ASISTENTE SE CERRÓ POR UN ERROR", ex);
            throw;
        }
    }

    public static void EjecutarVisor()
    {
        RegistroVentanas.Configurar("visor.log");
        try
        {
            RegistroVentanas.Info($"Visor iniciado, pid {Environment.ProcessId}.");
            EjecutarVentana(() => ConIcono(new VisorWindow(), "usb_monitor_service.ico"));
            RegistroVentanas.Info("Visor cerrado.");
        }
        catch (Exception ex)
        {
            RegistroVentanas.Error("EL VISOR SE CERRÓ POR UN ERROR", ex);
            throw;
        }
    }

    /// <summary>
    /// Pone a la ventana el icono del proyecto (recurso WPF enlazado
    /// desde USBMonitor\). Si el recurso faltara, la ventana abre
    /// igual con el icono por defecto: el icono nunca es un bloqueo.
    /// </summary>
    private static Window ConIcono(Window ventana, string recurso)
    {
        try
        {
            ventana.Icon = System.Windows.Media.Imaging.BitmapFrame.Create(
                new Uri($"pack://application:,,,/{recurso}", UriKind.Absolute));
        }
        catch
        {
            // Sin efecto: se queda el icono por defecto de WPF.
        }
        return ventana;
    }

    private static void EjecutarVentana(Func<Window> crearVentana)
    {
        // WPF exige STA. Si Program.cs ya marcó el hilo principal no
        // hace falta nada; si no, se abre un hilo STA dedicado y se
        // espera a que la ventana termine antes de devolver el control.
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
        {
            Exception? error = null;
            var hilo = new Thread(() =>
            {
                try { EjecutarVentanaEnEsteHilo(crearVentana); }
                catch (Exception ex) { error = ex; }
            });
            hilo.SetApartmentState(ApartmentState.STA);
            hilo.IsBackground = false;
            hilo.Name = "USBMonitor.Ventanas";
            hilo.Start();
            hilo.Join();
            if (error is not null)
            {
                throw error;
            }
            return;
        }

        EjecutarVentanaEnEsteHilo(crearVentana);
    }

    private static void EjecutarVentanaEnEsteHilo(Func<Window> crearVentana)
    {
        lock (CerrojoAplicacion)
        {
            if (Application.Current is null)
            {
                var aplicacion = new Application
                {
                    ShutdownMode = ShutdownMode.OnMainWindowClose
                };

                // Última red del hilo de la ventana: las excepciones
                // que escapen de los manejadores (temporizadores,
                // eventos de controles) quedan escritas en el registro
                // antes de que el proceso muera, en vez de perderse.
                // No se marca como tratada: el comportamiento ante el
                // error no cambia, solo deja de ser mudo.
                aplicacion.DispatcherUnhandledException += (_, e) =>
                {
                    RegistroVentanas.Error(
                        "Error no controlado en el hilo de la ventana", e.Exception);
                };

                Window ventana = crearVentana();
                aplicacion.MainWindow = ventana;
                ventana.Show();
                aplicacion.Run();
                return;
            }
        }

        // Ya existe una Application en este proceso (uso embebido o
        // una segunda ventana desde la caja de herramientas): se
        // muestra de forma modal sobre el Dispatcher existente.
        Window otra = crearVentana();
        if (Application.Current.Dispatcher.CheckAccess())
        {
            otra.ShowDialog();
        }
        else
        {
            Application.Current.Dispatcher.Invoke(() => otra.ShowDialog());
        }
    }
}

/// <summary>
/// Rutas de datos compartidas por las ventanas. Es el mismo contrato
/// del agente Python: C:\ProgramData\USBMonitor en Windows.
/// </summary>
internal static class DatosVentanas
{
    public static string CarpetaDatos => Registro.DirectorioDatos;

    public static string RutaBloqueosLocales => Path.Combine(CarpetaDatos, "pending_local.json");
    public static string RutaAgenteLog => Path.Combine(CarpetaDatos, "agente.log");
    public static string RutaCompaneroLog => Path.Combine(CarpetaDatos, "companero.log");

    public static void AsegurarCarpeta()
    {
        Directory.CreateDirectory(CarpetaDatos);
    }
}

/// <summary>
/// Adaptador fino sobre el Registro del Core. Mantiene un punto
/// único para el ciclo de vida de la UI (arranque, instancia
/// duplicada, cierre y excepciones) sin que una ventana tenga que
/// configurar el escritor global.
/// </summary>
internal static class RegistroVentanas
{
    private static Registrador? _registrador;

    public static void Configurar(string archivo)
    {
        Registro.Configurar(archivo, consola: false);
        _registrador = Registro.Obtener("ventanas");
    }

    public static void Info(string mensaje) => _registrador?.Info(mensaje);
    public static void Advertencia(string mensaje) => _registrador?.Advertencia(mensaje);
    public static void Depurar(string mensaje) => _registrador?.Debug(mensaje);

    public static void Error(string mensaje, Exception? excepcion = null)
    {
        if (_registrador is null)
        {
            return;
        }

        if (excepcion is null)
        {
            _registrador.Error(mensaje);
        }
        else
        {
            _registrador.Excepcion(mensaje, excepcion);
        }
    }
}

/// <summary>Arranque de otro modo del mismo ejecutable.</summary>
internal static class LanzadorModos
{
    public static void Lanzar(string modo)
    {
        string? proceso = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(proceso))
        {
            proceso = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
        }

        if (string.IsNullOrWhiteSpace(proceso))
        {
            throw new InvalidOperationException("No se pudo localizar este ejecutable.");
        }

        // En desarrollo el proceso puede ser dotnet.exe; en ese caso
        // el primer argumento real es el ensamblado. En producción el
        // ejecutable publicado acepta el modo directamente.
        bool esDotNet = Path.GetFileName(proceso).Equals(
            "dotnet.exe", StringComparison.OrdinalIgnoreCase);
        // Sin Assembly.Location: en el ejecutable de un solo archivo
        // devuelve "" (aviso IL3000 de la CI). La DLL del ensamblado
        // está junto al resto de la salida, en AppContext.BaseDirectory
        // (esta rama solo se usa en desarrollo, con «dotnet run»).
        string argumentos = esDotNet
            ? $"\"{Path.Combine(AppContext.BaseDirectory, typeof(AppVentanas).Assembly.GetName().Name + ".dll")}\" {modo}"
            : modo;

        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = proceso,
            Arguments = argumentos,
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
}
