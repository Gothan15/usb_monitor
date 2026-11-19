// ============================================================
//  USB Monitor — Bandeja del panel
// ============================================================
//  Icono de bandeja del sistema (junto al reloj) para el
//  equipo donde corre el panel. Enseña el estado del servicio
//  USBMonitorPanel con un punto de color sobre la brújula y
//  da gobierno rápido sin abrir services.msc:
//
//    · Abrir el panel en el navegador (doble clic también).
//    · Abrir el registro del panel (el .log más reciente del
//      servicio, el de WinSW en la carpeta de datos).
//    · Iniciar, parar y reiniciar el servicio.
//    · «Iniciar con Windows»: el servicio en automático o
//      manual, a elección.
//
//  Parar/iniciar servicios y cambiar su arranque piden
//  administrador. La bandeja corre como el usuario de la
//  sesión (sin elevar, para poder vivir junto al reloj), y
//  cuando se elige una de esas acciones se relanza a sí
//  misma elevada (verbo runas, el aviso de UAC de Windows)
//  en un modo ayudante que hace la acción y sale: los
//  argumentos --iniciar, --parar, --reiniciar,
//  --arranque-auto y --arranque-manual.
//
//  Todo el código va comentado en español, como manda la
//  casa. Sin iconos de emoji: la marca es la brújula y el
//  estado lo dice el punto de color.
// ============================================================

using System.ComponentModel;
using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Net;
using System.Net.Sockets;
using System.ServiceProcess;
using Microsoft.Win32;

namespace USBMonitor.Bandeja;

internal static class Program
{
    // El servicio del panel, tal y como lo registra el
    // instalador (WinSW). Nombre fijo, no negociable.
    private const string NombreServicio = "USBMonitorPanel";

    [STAThread]
    private static int Main(string[] args)
    {
        // Modo ayudante: una acción sobre el servicio y salir.
        // Lo lanza la propia bandeja, ya elevado por UAC.
        if (args.Length > 0)
        {
            return Ayudante.Ejecutar(args[0]);
        }

        // Una sola bandeja por sesión: si ya hay una, la
        // segunda copia sale sin duplicar el icono.
        using var mutex = new Mutex(true, "USBMonitorBandeja-InstanciaUnica", out bool creada);
        if (!creada)
        {
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new ContextoBandeja());
        return 0;
    }

    // --------------------------------------------------------
    //  Lo que la bandeja y el ayudante comparten
    // --------------------------------------------------------

    // Estado del panel, reducido a lo que la bandeja pinta.
    internal enum EstadoPanel
    {
        NoInstalado,
        Corriendo,
        Detenido,
        Transicion,
    }

    // Lee el estado del servicio. Consultarlo no pide
    // administrador; si el servicio no existe, NoInstalado.
    internal static EstadoPanel EstadoActual()
    {
        try
        {
            using var sc = new ServiceController(NombreServicio);
            return sc.Status switch
            {
                ServiceControllerStatus.Running => EstadoPanel.Corriendo,
                ServiceControllerStatus.Stopped => EstadoPanel.Detenido,
                _ => EstadoPanel.Transicion,
            };
        }
        catch (InvalidOperationException)
        {
            return EstadoPanel.NoInstalado;
        }
    }

    // ¿El servicio arranca con Windows? Se lee del registro
    // (Start = 2 es automático; el automático diferido también
    // cuenta como «sí»). Sin servicio, false.
    internal static bool ArranqueConWindows()
    {
        using var clave = Registry.LocalMachine.OpenSubKey(
            $@"SYSTEM\CurrentControlSet\Services\{NombreServicio}");
        return clave?.GetValue("Start") is int inicio && inicio == 2;
    }

    // El puerto del panel, de la clave que escribe el
    // instalador; 3000 si no hay clave o no hay valor.
    internal static int PuertoPanel()
    {
        using var clave = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\USBMonitor\Panel");
        return clave?.GetValue("PanelPort") is int puerto && puerto > 0 ? puerto : 3000;
    }

    // La IPv4 de la ruta por defecto de este equipo: la
    // dirección única en la que el panel sirve sus páginas.
    // El Connect de un socket UDP no envía nada: solo deja
    // que el sistema elija la interfaz de salida, y de ahí
    // se lee la dirección local. Sin red, localhost.
    internal static string DireccionPanel()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Connect("8.8.8.8", 65530);
            return ((IPEndPoint)socket.LocalEndPoint!).Address.ToString();
        }
        catch
        {
            return "localhost";
        }
    }

    // La carpeta de datos del panel, de la misma clave del
    // instalador que ya se lee para el puerto; si la clave no
    // está, la de serie de ProgramData.
    internal static string CarpetaDatos()
    {
        using var clave = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\USBMonitor\Panel");
        return clave?.GetValue("DataDir") is string datos && datos.Length > 0
            ? datos
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "USBMonitor");
    }

    // El archivo de registro más reciente del servicio del
    // panel: WinSW escribe en <Datos>\Registros los
    // USBMonitorPanel.out.log y .err.log y va rotando los
    // viejos con sufijo numérico. Se elige por fecha de
    // escritura, que es el que está recibiendo líneas ahora.
    // Null si aún no hay ninguno (el servicio nunca arrancó).
    internal static string? RutaRegistroPanel()
    {
        try
        {
            var carpeta = Path.Combine(CarpetaDatos(), "Registros");
            return Directory.EnumerateFiles(carpeta, "USBMonitorPanel*.log")
                .OrderByDescending(f => File.GetLastWriteTime(f))
                .FirstOrDefault();
        }
        catch
        {
            return null;
        }
    }

    // Abre el registro del panel con el visor asociado a los
    // .log (el Bloc de notas, de serie). Si todavía no hay
    // archivo, se avisa en un cuadro en vez de no hacer nada:
    // quien pide el registro suele estar persiguiendo un
    // fallo y el silencio no le dice nada.
    internal static void AbrirRegistroPanel()
    {
        var ruta = RutaRegistroPanel();
        if (ruta is null)
        {
            MessageBox.Show(
                "Todavía no hay archivo de registro del panel: el servicio no ha arrancado nunca en este equipo.",
                "USB Monitor — Bandeja",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }
        Process.Start(new ProcessStartInfo(ruta) { UseShellExecute = true });
    }

    // Abre el panel en el navegador predeterminado.
    internal static void AbrirPanel()
    {
        var url = $"http://{DireccionPanel()}:{PuertoPanel()}";
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    // Se relanza elevado con la acción pedida: el aviso de
    // UAC lo pone Windows. Si el usuario lo cancela, no pasa
    // nada (Win32Exception) y la bandeja sigue a lo suyo.
    internal static void LanzarElevado(string accion)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = Application.ExecutablePath,
                Arguments = accion,
                Verb = "runas",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
        catch (Win32Exception)
        {
            // UAC cancelado por el usuario.
        }
    }
}

// ------------------------------------------------------------
//  El modo ayudante: corre elevado, hace una acción y sale
// ------------------------------------------------------------
internal static class Ayudante
{
    private const string NombreServicio = "USBMonitorPanel";
    private static readonly TimeSpan Espera = TimeSpan.FromSeconds(45);

    internal static int Ejecutar(string accion)
    {
        try
        {
            using var sc = new ServiceController(NombreServicio);
            switch (accion)
            {
                case "--iniciar":
                    sc.Start();
                    sc.WaitForStatus(ServiceControllerStatus.Running, Espera);
                    break;
                case "--parar":
                    sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, Espera);
                    break;
                case "--reiniciar":
                    if (sc.Status != ServiceControllerStatus.Stopped)
                    {
                        sc.Stop();
                        sc.WaitForStatus(ServiceControllerStatus.Stopped, Espera);
                    }
                    sc.Start();
                    sc.WaitForStatus(ServiceControllerStatus.Running, Espera);
                    break;
                case "--arranque-auto":
                    ConfigurarArranque("auto");
                    break;
                case "--arranque-manual":
                    ConfigurarArranque("demand");
                    break;
                default:
                    return 2;
            }
            return 0;
        }
        catch (Exception ex)
        {
            // El ayudante no tiene consola: el fallo se dice
            // en un cuadro, para que no muera en silencio.
            MessageBox.Show(
                $"No se pudo completar la acción: {ex.Message}",
                "USB Monitor — Bandeja",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return 1;
        }
    }

    // El tipo de arranque se cambia con sc.exe (la vía de
    // siempre). Ojo: esto NO es el «depend=» de la saga del
    // 1075 — el valor de start= lo guarda el SCM como número,
    // no como cadena, y aquí no hay comillas de PowerShell.
    private static void ConfigurarArranque(string modo)
    {
        using var proceso = Process.Start(new ProcessStartInfo
        {
            FileName = "sc.exe",
            Arguments = $"config {NombreServicio} start= {modo}",
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;
        proceso.WaitForExit();
        if (proceso.ExitCode != 0)
        {
            throw new InvalidOperationException($"sc.exe terminó con código {proceso.ExitCode}.");
        }
    }
}

// ------------------------------------------------------------
//  La bandeja propiamente dicha
// ------------------------------------------------------------
internal sealed class ContextoBandeja : ApplicationContext
{
    // Los colores del punto de estado: verde corriendo, el
    // rojo de la casa parado, el dorado en transición y gris
    // cuando el servicio ni está instalado.
    private static readonly Color ColorCorriendo = Color.FromArgb(63, 163, 77);
    private static readonly Color ColorDetenido = Color.FromArgb(179, 56, 46);
    private static readonly Color ColorTransicion = Color.FromArgb(192, 154, 59);
    private static readonly Color ColorAusente = Color.FromArgb(138, 143, 152);

    private readonly NotifyIcon _icono;
    private readonly System.Windows.Forms.Timer _reloj;
    private readonly ToolStripMenuItem _itemEstado;
    private readonly ToolStripMenuItem _itemIniciar;
    private readonly ToolStripMenuItem _itemParar;
    private readonly ToolStripMenuItem _itemReiniciar;
    private readonly ToolStripMenuItem _itemArranque;
    private readonly ToolStripMenuItem _itemRegistro;
    private readonly Icon _iconoBase;
    private readonly Dictionary<Program.EstadoPanel, Icon> _iconosPorEstado = new();
    private Program.EstadoPanel _estado = Program.EstadoPanel.NoInstalado;

    internal ContextoBandeja()
    {
        // El icono base es el del propio ejecutable (la
        // brújula, incrustada al compilar); si no se pudiera
        // extraer, el genérico del sistema.
        _iconoBase = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _itemEstado = new ToolStripMenuItem("Panel: …") { Enabled = false };
        var itemAbrir = new ToolStripMenuItem("Abrir el panel", null, (_, _) => Program.AbrirPanel());
        _itemRegistro = new ToolStripMenuItem("Abrir el registro del panel", null, (_, _) => Program.AbrirRegistroPanel());
        _itemIniciar = new ToolStripMenuItem("Iniciar", null, (_, _) => Program.LanzarElevado("--iniciar"));
        _itemParar = new ToolStripMenuItem("Parar", null, (_, _) => Program.LanzarElevado("--parar"));
        _itemReiniciar = new ToolStripMenuItem("Reiniciar", null, (_, _) => Program.LanzarElevado("--reiniciar"));
        _itemArranque = new ToolStripMenuItem("Iniciar con Windows", null, AlCambiarArranque);
        var itemSalir = new ToolStripMenuItem("Salir", null, (_, _) => Salir());

        var menu = new ContextMenuStrip();
        menu.Items.Add(_itemEstado);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(itemAbrir);
        menu.Items.Add(_itemRegistro);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_itemIniciar);
        menu.Items.Add(_itemParar);
        menu.Items.Add(_itemReiniciar);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_itemArranque);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(itemSalir);
        // Al abrir el menú se refresca todo: que lo que se
        // ve sea el estado de este segundo, no el del sondeo.
        menu.Opening += (_, _) => Refrescar();

        _icono = new NotifyIcon
        {
            Icon = IconoPara(_estado),
            ContextMenuStrip = menu,
            Visible = true,
        };
        _icono.DoubleClick += (_, _) => Program.AbrirPanel();

        // Sondeo del estado cada 2 s: barato (una consulta al
        // SCM) y deja el punto al día sin que nadie toque nada.
        _reloj = new System.Windows.Forms.Timer { Interval = 2000 };
        _reloj.Tick += (_, _) => Refrescar();
        _reloj.Start();

        Refrescar();
    }

    // «Iniciar con Windows» marcado = servicio en automático.
    // Cambiarlo pide administrador: ayudante elevado con la
    // acción contraria a la actual.
    private void AlCambiarArranque(object? sender, EventArgs e)
    {
        Program.LanzarElevado(Program.ArranqueConWindows() ? "--arranque-manual" : "--arranque-auto");
    }

    // Pone icono, texto y habilitados al día con el estado.
    private void Refrescar()
    {
        _estado = Program.EstadoActual();
        _icono.Icon = IconoPara(_estado);
        _icono.Text = _estado switch
        {
            Program.EstadoPanel.Corriendo => "USB Monitor — Panel: en ejecución",
            Program.EstadoPanel.Detenido => "USB Monitor — Panel: detenido",
            Program.EstadoPanel.Transicion => "USB Monitor — Panel: cambiando de estado…",
            _ => "USB Monitor — Panel: no instalado",
        };
        _itemEstado.Text = _estado switch
        {
            Program.EstadoPanel.Corriendo => "Panel: en ejecución",
            Program.EstadoPanel.Detenido => "Panel: detenido",
            Program.EstadoPanel.Transicion => "Panel: cambiando de estado…",
            _ => "Panel: no instalado",
        };
        _itemIniciar.Enabled = _estado == Program.EstadoPanel.Detenido;
        _itemParar.Enabled = _estado == Program.EstadoPanel.Corriendo;
        _itemReiniciar.Enabled = _estado is Program.EstadoPanel.Corriendo or Program.EstadoPanel.Detenido;
        _itemArranque.Enabled = _estado != Program.EstadoPanel.NoInstalado;
        _itemRegistro.Enabled = _estado != Program.EstadoPanel.NoInstalado;
        _itemArranque.Checked = Program.ArranqueConWindows();
    }

    // El icono de cada estado se dibuja una vez y se guarda:
    // la brújula con un punto de color en la esquina.
    private Icon IconoPara(Program.EstadoPanel estado)
    {
        if (_iconosPorEstado.TryGetValue(estado, out var guardado))
        {
            return guardado;
        }
        var color = estado switch
        {
            Program.EstadoPanel.Corriendo => ColorCorriendo,
            Program.EstadoPanel.Detenido => ColorDetenido,
            Program.EstadoPanel.Transicion => ColorTransicion,
            _ => ColorAusente,
        };
        using var original = _iconoBase.ToBitmap();
        var bmp = new Bitmap(original, new Size(32, 32));
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var d = bmp.Width / 2;
            using var brocha = new SolidBrush(color);
            g.FillEllipse(brocha, bmp.Width - d, bmp.Height - d, d - 1, d - 1);
        }
        var icono = Icon.FromHandle(bmp.GetHicon());
        _iconosPorEstado[estado] = icono;
        return icono;
    }

    // Salir solo quita la bandeja: el servicio sigue a lo
    // suyo (esto no es una forma de parar el panel).
    private void Salir()
    {
        _reloj.Stop();
        _icono.Visible = false;
        _icono.Dispose();
        ExitThread();
    }
}
