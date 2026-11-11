// -*- coding: utf-8 -*-
// USBMonitorEmpujador — el empujón de la instalación remota,
// modelo Kaspersky («instalación forzada con recursos del
// sistema operativo»): nada de WinRM ni de SSH.
//
//   · Copia el ejecutable del agente al equipo destino por SMB
//     (recurso administrativo C$), con las credenciales de un
//     administrador local del destino.
//   · Crea en el destino, vía RPC (Service Control Manager
//     remoto), un servicio TEMPORAL que ejecuta el instalador
//     sin asistente del agente (`instalar-remoto`), espera a que
//     termine y lo borra: no queda rastro del empujón, solo el
//     agente ya instalado como servicio propio.
//
// El empujador vive en el equipo del PANEL (Windows) y el panel
// lo lanza como proceso hijo. Habla por stdout en líneas JSON:
//   {"tipo":"progreso","etapa":"copia","detalle":"…","porcentaje":42}
//   {"tipo":"resultado","success":true,"message":"…","checks":[…]}
//
// Modos:
//   --comprobar  abre la sesión SMB y el SCM remoto sin tocar
//                nada y devuelve la lista de requisitos del
//                destino (el mismo contrato que devolvía la
//                comprobación WinRM: id, etiqueta, ok, detalle,
//                consejo).
//   --instalar   el empujón completo. La confirmación final la
//                da el panel por la primera señal del agente,
//                no este programa.
//
// Requisitos del destino (red sin dominio): compartición de
// archivos activa (ADMIN$/C$ alcanzables), cuenta
// administradora local CON contraseña y
// LocalAccountTokenFilterPolicy=1 — sin eso último el SCM
// remoto responde «acceso denegado» aunque la clave sea buena,
// el mismo filtro UAC que sufría WinRM.
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace USBMonitor.Empujador;

internal static class Program
{
    private const string NombreServicioAgente = "USBMonitorService";
    private const string NombreServicioTemporal = "USBMonitorInstalador";
    private const string RutaDestinoLocal = @"C:\USBMonitor";
    private const string NombreExe = "USBMonitorService.exe";

    public static int Main(string[] args)
    {
        // El panel lee el stdout de este proceso como UTF-8
        // (empujador.ts lo decodifica así, línea a línea JSON).
        // Sin fijar la codificación, la consola de Windows
        // escribe en su página de códigos (850 en un Windows en
        // español) y las tildes y signos de los mensajes llegan
        // a la pantalla de la tarea como «?» o caracteres rotos.
        // Se fija antes de imprimir nada, también por stderr.
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        var modo = args.Length > 0 ? args[0].ToLowerInvariant() : null;
        var opciones = new Opciones(args);
        try
        {
            return modo switch
            {
                "--comprobar" => Comprobar(opciones),
                "--instalar" => Instalar(opciones),
                _ => Uso(),
            };
        }
        catch (Exception exc)
        {
            Resultado(false, $"Error inesperado del empujador: {exc.Message}");
            return 1;
        }
    }

    private static int Uso()
    {
        Console.Error.WriteLine(
            "Uso: USBMonitorEmpujador.exe --comprobar|--instalar " +
            "--ip <ip> --usuario <u> --clave <c> " +
            "[--token <t> --servidor <host>[:<puerto>]] [--exe <ruta>]");
        return 2;
    }

    // ── comprobación ─────────────────────────────────────────────

    private static int Comprobar(Opciones o)
    {
        if (!o.ValidaBasica())
            return Uso();
        var checks = new List<object>();

        // 1. ¿Se alcanza el SMB del destino?
        var puertoOk = PuertoAbierto(o.Ip, 445);
        checks.Add(new
        {
            id = "puerto445",
            etiqueta = "SMB alcanzable en el destino (puerto 445)",
            ok = puertoOk,
            detalle = puertoOk
                ? $"El puerto 445 de {o.Ip} acepta conexiones."
                : $"Sin respuesta en {o.Ip}:445 — equipo apagado, fuera de red o compartición de archivos desactivada.",
            consejo = puertoOk
                ? null
                : "En el destino: activa «Compartir archivos e impresoras» y deja la red en perfil Privado.",
        });
        if (!puertoOk)
        {
            Resultado(false,
                "El destino no responde por SMB: sin eso no se puede comprobar nada más.",
                checks);
            return 0;
        }

        // 2. ¿Las credenciales abren la sesión administrativa?
        using var sesion = new SesionSmb(o.Ip, o.Usuario, o.Clave);
        if (!sesion.Abierta)
        {
            checks.Add(new
            {
                id = "sesion",
                etiqueta = "Las credenciales abren sesión en el recurso C$",
                ok = false,
                detalle = sesion.Error,
                consejo = sesion.CodigoError is 1326 or 86
                    ? "La cuenta debe ser administradora local del destino y la contraseña, la suya (sin contraseña no hay instalación remota en grupo de trabajo)."
                    : "Revisa que el destino tenga las comparticiones administrativas (C$) activas.",
            });
            Resultado(false,
                "SMB responde, pero las credenciales no abren la sesión administrativa.",
                checks);
            return 0;
        }
        checks.Add(new
        {
            id = "sesion",
            etiqueta = "Las credenciales abren sesión en el recurso C$",
            ok = true,
            detalle = $"Sesión abierta como {o.Usuario}.",
            consejo = (string?)null,
        });

        // 3. ¿El SCM remoto deja crear servicios? (el filtro UAC)
        var (scmOk, scmDetalle) = ProbarScm(o.Ip);
        checks.Add(new
        {
            id = "scm",
            etiqueta = "El gestor de servicios remoto permite instalar",
            ok = scmOk,
            detalle = scmDetalle,
            consejo = scmOk
                ? null
                : "Casi seguro falta LocalAccountTokenFilterPolicy=1 en el destino: sin él, el administrador local entra recortado por UAC en remoto y el SCM deniega. Se crea con Enable-PSRemoting o a mano en el registro.",
        });

        // 4. ¿El agente ya está instalado? (dato, no bloqueo: la
        // tarea decide si omite este equipo). La respuesta es a
        // TRES estados: true / false / null (no se pudo
        // comprobar). Antes era sí-o-no y «no se pudo preguntar»
        // se contaba como «no», y un «sí» a secas —sin mirar QUÉ
        // servicio era— como instalado: de ahí salían omisiones
        // imposibles en PCs nunca instaladas.
        var yaInstalado = ServicioInstalado(o.Ip, NombreServicioAgente);
        checks.Add(new
        {
            id = "instalado",
            etiqueta = "El agente no está ya instalado",
            ok = yaInstalado == false,
            detalle = yaInstalado switch
            {
                true => "USBMonitorService ya existe en el destino y su binario es el del agente: a este equipo se llega por el canal del agente (actualizar), no empujando.",
                false => "No hay ningún USBMonitorService en el destino.",
                null => "No se pudo comprobar si el agente ya está instalado: el gestor de servicios no dejó consultar el servicio.",
            },
            consejo = (string?)null,
        });

        Resultado(scmOk,
            scmOk
                ? (yaInstalado == true
                    ? "El destino cumple, pero el agente ya está instalado."
                    : "El destino cumple todos los requisitos del empujón.")
                : "El destino responde, pero el gestor de servicios remoto no permite instalar.",
            checks, yaInstalado);
        return 0;
    }

    // ── instalación ──────────────────────────────────────────────

    private static int Instalar(Opciones o)
    {
        if (!o.ValidaBasica() || string.IsNullOrWhiteSpace(o.Codigo) || string.IsNullOrWhiteSpace(o.Servidor))
            return Uso();
        var rutaExeOrigen = o.Exe ?? Path.Combine(AppContext.BaseDirectory, NombreExe);
        if (!File.Exists(rutaExeOrigen))
        {
            Resultado(false, $"No se encuentra el ejecutable del agente: {rutaExeOrigen}");
            return 1;
        }

        Progreso("conexion", $"Abriendo sesión SMB contra {o.Ip}…");
        using var sesion = new SesionSmb(o.Ip, o.Usuario, o.Clave);
        if (!sesion.Abierta)
        {
            Resultado(false, sesion.Error!);
            return 0;
        }

        var carpetaRemota = $@"\\{o.Ip}\C$\USBMonitor";
        var exeRemoto = Path.Combine(carpetaRemota, NombreExe);
        try
        {
            Directory.CreateDirectory(carpetaRemota);
            CopiarConProgreso(rutaExeOrigen, exeRemoto);
        }
        catch (Exception exc)
        {
            Resultado(false, $"No se pudo copiar el agente al destino: {exc.Message}");
            return 0;
        }

        Progreso("servicio", "Creando el servicio temporal de instalación…");
        var (ok, mensaje) = EjecutarInstalacionRemota(o);
        Resultado(ok, mensaje);
        return 0;
    }

    /// <summary>
    /// Crea el servicio temporal en el destino apuntando al exe
    /// ya copiado en modo `instalar-remoto`, lo arranca, espera a
    /// que pare y lo borra SIEMPRE. Devuelve si el instalador
    /// terminó con código 0.
    /// </summary>
    private static (bool, string) EjecutarInstalacionRemota(Opciones o)
    {
        var scm = OpenSCManager(o.Ip, null, ScManagerAllAccess);
        if (scm == IntPtr.Zero)
            return (false,
                $"No se pudo abrir el gestor de servicios de {o.Ip} ({DescribirError(Marshal.GetLastWin32Error())}).");
        try
        {
            BorrarServicioSiExiste(scm, NombreServicioTemporal);

            var orden = $"\"{RutaDestinoLocal}\\{NombreExe}\" instalar-remoto " +
                        $"--servidor {o.Servidor} --codigo {o.Codigo}";
            var svc = CreateService(
                scm, NombreServicioTemporal, "USB Monitor — instalador remoto",
                ServiceAllAccess, ServiceWin32OwnProcess, ServiceDemandStart,
                ServiceErrorNormal, orden, null, IntPtr.Zero, null, null, null);
            if (svc == IntPtr.Zero)
                return (false,
                    $"CreateService falló en el destino ({DescribirError(Marshal.GetLastWin32Error())}).");
            try
            {
                if (!StartService(svc, 0, null))
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error != ErrorServiceAlreadyRunning)
                        return (false,
                            $"El servicio temporal no arrancó ({DescribirError(error)}).");
                }
                var salida = EsperarParada(svc, TimeSpan.FromSeconds(180));
                if (salida is null)
                {
                    // Sin este alto, «retirar» el servicio era solo
                    // marcarlo para borrar: el proceso instalador
                    // seguía vivo (es el propio exe del agente) y
                    // el ejecutable quedaba retenido en el destino
                    // hasta que alguien lo matara a mano. Se le
                    // ordena parar y se espera a que muera antes de
                    // que el finally lo borre.
                    DetenerServicio(svc);
                    return (false,
                        "El instalador remoto no terminó en 180 segundos; el servicio temporal se detuvo y se retiró, y el equipo queda como estaba.");
                }
                return salida.Value == 0
                    ? (true, "El instalador remoto terminó bien: el agente quedó instalado y arrancado.")
                    : (false,
                        $"El instalador remoto terminó con código {salida.Value}: el agente no quedó instalado (su registro está en el destino, agente.log).");
            }
            finally
            {
                DeleteService(svc);
                CloseServiceHandle(svc);
            }
        }
        finally
        {
            CloseServiceHandle(scm);
        }
    }

    /// <summary>
    /// Ordena parar un servicio y espera (poco) a que su proceso
    /// muera: DeleteService sin esto solo marca el servicio para
    /// borrar y el proceso sigue corriendo.
    /// </summary>
    private static void DetenerServicio(IntPtr svc)
    {
        try
        {
            ControlService(svc, ServiceControlStop, out _);
        }
        catch
        {
            // Si ni parar se puede, lo dirá el resultado global.
        }
        _ = EsperarParada(svc, TimeSpan.FromSeconds(15));
    }

    /// <summary>Espera a que el servicio pare; devuelve su código de salida.</summary>
    private static uint? EsperarParada(IntPtr svc, TimeSpan limite)
    {
        var fin = DateTime.UtcNow + limite;
        while (DateTime.UtcNow < fin)
        {
            if (QueryServiceStatusEx(
                    svc, ScStatusProcessInfo, out var estado, Marshal.SizeOf<ServicioEstadoProceso>(),
                    out _)
                && estado.EstadoActual == ServiceStopped)
            {
                return estado.CodigoSalidaWin32;
            }
            Thread.Sleep(500);
        }
        return null;
    }

    private static void BorrarServicioSiExiste(IntPtr scm, string nombre)
    {
        var svc = OpenService(scm, nombre, ServiceAllAccess);
        if (svc == IntPtr.Zero)
            return;
        try
        {
            ControlService(svc, ServiceControlStop, out _);
            DeleteService(svc);
        }
        catch
        {
            // Un resto que no se deja borrar lo dirá CreateService.
        }
        finally
        {
            CloseServiceHandle(svc);
        }
        Thread.Sleep(300);
    }

    private static (bool, string) ProbarScm(string ip)
    {
        var scm = OpenSCManager(ip, null, ScManagerConnect | ScManagerCreateService);
        if (scm == IntPtr.Zero)
        {
            var error = Marshal.GetLastWin32Error();
            return (false, error == ErrorAccessDenied
                ? "Acceso denegado al gestor de servicios: la sesión entra recortada por UAC."
                : $"El gestor de servicios no respondió ({DescribirError(error)}).");
        }
        CloseServiceHandle(scm);
        return (true, "El gestor de servicios acepta crear el servicio de instalación.");
    }

    /// <summary>
    /// ¿Está el agente instalado en el destino? Tres estados:
    /// true (hay un servicio con ese nombre Y su binario es el
    /// ejecutable del agente), false (no hay servicio con ese
    /// nombre) y null (no se pudo comprobar: el SCM no abrió o
    /// la consulta fue denegada). Que el nombre exista no basta:
    /// sin mirar el binario, cualquier servicio homónimo —o un
    /// resto a medio borrar— contaba como «instalado» y la tarea
    /// omitía PCs que nunca tuvieron el agente.
    /// </summary>
    private static bool? ServicioInstalado(string ip, string nombre)
    {
        var scm = OpenSCManager(ip, null, ScManagerConnect);
        if (scm == IntPtr.Zero)
            return null;
        try
        {
            var svc = OpenService(scm, nombre, ServiceQueryStatus | ServiceQueryConfig);
            if (svc == IntPtr.Zero)
            {
                return Marshal.GetLastWin32Error() == ErrorServiceDoesNotExist
                    ? false
                    : null;
            }
            try
            {
                var ruta = RutaBinariaServicio(svc);
                if (ruta is null)
                    return null;
                return ruta.Contains(NombreExe, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                CloseServiceHandle(svc);
            }
        }
        finally
        {
            CloseServiceHandle(scm);
        }
    }

    /// <summary>La ruta del binario de un servicio (QueryServiceConfig).</summary>
    private static string? RutaBinariaServicio(IntPtr svc)
    {
        if (!QueryServiceConfig(svc, IntPtr.Zero, 0, out var necesarios))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != ErrorInsufficientBuffer || necesarios <= 0)
                return null;
        }
        var bufer = Marshal.AllocHGlobal(necesarios);
        try
        {
            if (!QueryServiceConfig(svc, bufer, necesarios, out _))
                return null;
            var config = Marshal.PtrToStructure<ConfiguracionServicio>(bufer);
            return config.RutaBinaria;
        }
        finally
        {
            Marshal.FreeHGlobal(bufer);
        }
    }

    // ── red y copia ──────────────────────────────────────────────

    private static bool PuertoAbierto(string ip, int puerto)
    {
        try
        {
            using var tcp = new TcpClient();
            using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            tcp.ConnectAsync(ip, puerto, limite.Token).AsTask().Wait(limite.Token);
            return tcp.Connected;
        }
        catch
        {
            return false;
        }
    }

    private static void CopiarConProgreso(string origen, string destino)
    {
        var total = new FileInfo(origen).Length;
        Progreso("copia", $"Copiando el agente ({total / 1024 / 1024} MB)…", 0);
        using var entrada = new FileStream(origen, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var salida = new FileStream(destino, FileMode.Create, FileAccess.Write, FileShare.None);
        var bufer = new byte[4 * 1024 * 1024];
        long copiados = 0;
        var ultimoPorcentaje = -1;
        int leidos;
        while ((leidos = entrada.Read(bufer, 0, bufer.Length)) > 0)
        {
            salida.Write(bufer, 0, leidos);
            copiados += leidos;
            var porcentaje = (int)(copiados * 100 / Math.Max(1, total));
            if (porcentaje >= ultimoPorcentaje + 5 || porcentaje == 100)
            {
                ultimoPorcentaje = porcentaje;
                Progreso("copia", $"Copiando el agente… {porcentaje} %", porcentaje);
            }
        }
    }

    // ── salida JSON ──────────────────────────────────────────────

    private static readonly JsonSerializerOptions JsonOpciones = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static void Progreso(string etapa, string detalle, int? porcentaje = null)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(new
        {
            tipo = "progreso",
            etapa,
            detalle,
            porcentaje,
        }, JsonOpciones));
        Console.Out.Flush();
    }

    private static void Resultado(
        bool success, string message, object? checks = null, bool? yaInstalado = null)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(new
        {
            tipo = "resultado",
            success,
            message,
            checks,
            yaInstalado,
        }, JsonOpciones));
        Console.Out.Flush();
    }

    /// <summary>Los códigos de error de Windows que este flujo ve, en claro.</summary>
    private static string DescribirError(int codigo) => codigo switch
    {
        0 => "sin error",
        ErrorAccessDenied => "acceso denegado (5)",
        53 => "ruta de red no encontrada (53): el destino no se alcanza o su SMB está apagado",
        67 => "nombre de red no encontrado (67): la compartición administrativa no existe",
        86 => "contraseña de red no válida (86)",
        1326 => "error de inicio de sesión (1326): usuario o contraseña incorrectos",
        1219 => "ya hay una sesión abierta contra ese equipo con otras credenciales (1219)",
        1722 => "el servidor RPC no está disponible (1722)",
        ErrorServiceDoesNotExist => "el servicio no existe (1060)",
        1053 => "el servicio no respondió a tiempo (1053): el instalador no confirmó su arranque al gestor de servicios",
        _ => $"error de Windows {codigo}",
    };

    private const int ErrorAccessDenied = 5;
    private const int ErrorServiceAlreadyRunning = 1056;
    private const int ErrorServiceDoesNotExist = 1060;
    private const int ErrorInsufficientBuffer = 122;

    // ── sesión SMB (mpr.dll) ─────────────────────────────────────

    /// <summary>
    /// Sesión SMB contra \\IP\C$ con credenciales explícitas.
    /// Abrirla es lo que da acceso a las rutas UNC del destino;
    /// al Dispose se cancela, sin dejar credenciales colgadas en
    /// el equipo del panel.
    /// </summary>
    private sealed class SesionSmb : IDisposable
    {
        private readonly string _recurso;
        public bool Abierta { get; }
        public string? Error { get; }
        public int CodigoError { get; }

        public SesionSmb(string ip, string usuario, string clave)
        {
            _recurso = $@"\\{ip}\C$";
            var recurso = new RecursoRed
            {
                Tipo = ResourceTypeDisk,
                NombreRemoto = _recurso,
            };
            var codigo = WNetAddConnection2(ref recurso, clave, usuario, 0);
            CodigoError = codigo;
            Abierta = codigo == 0;
            Error = Abierta
                ? null
                : $"No se pudo abrir la sesión SMB contra {_recurso}: {DescribirError(codigo)}.";
        }

        public void Dispose()
        {
            if (Abierta)
                WNetCancelConnection2(_recurso, 0, true);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct RecursoRed
    {
        public int Alcance;
        public int Tipo;
        public int TipoPresentacion;
        public int Uso;
        public string? NombreLocal;
        public string? NombreRemoto;
        public string? Comentario;
        public string? Proveedor;
    }

    private const int ResourceTypeDisk = 1;

    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetAddConnection2(
        ref RecursoRed recurso, string? clave, string? usuario, int banderas);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetCancelConnection2(
        string nombre, int banderas, bool forzar);

    // ── SCM remoto (advapi32.dll) ────────────────────────────────

    private const uint ScManagerConnect = 0x0001;
    private const uint ScManagerCreateService = 0x0002;
    private const uint ScManagerAllAccess = 0xF003F;
    private const uint ServiceAllAccess = 0xF01FF;
    private const uint ServiceQueryStatus = 0x0004;
    private const uint ServiceQueryConfig = 0x0001;
    private const uint ServiceWin32OwnProcess = 0x00000010;
    private const uint ServiceDemandStart = 0x00000003;
    private const uint ServiceErrorNormal = 0x00000001;
    private const uint ServiceStopped = 1;
    private const int ServiceControlStop = 1;
    private const int ScStatusProcessInfo = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct ServicioEstadoProceso
    {
        public uint TipoServicio;
        public uint EstadoActual;
        public uint ControlesAceptados;
        public uint CodigoSalidaWin32;
        public uint CodigoSalidaEspecifico;
        public uint PuntoControl;
        public uint EsperaSugerida;
        public uint IdProceso;
        public uint BanderasServicio;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(
        string? maquina, string? baseDatos, uint acceso);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateService(
        IntPtr scm, string nombre, string? nombreVisible, uint acceso,
        uint tipoServicio, uint tipoArranque, uint controlError,
        string orden, string? grupo, IntPtr idGrupo, string? dependencias,
        string? cuenta, string? clave);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(
        IntPtr scm, string nombre, uint acceso);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartService(IntPtr servicio, int numArgumentos, string[]? argumentos);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(
        IntPtr servicio, int nivel, out ServicioEstadoProceso estado,
        int tamano, out int necesarios);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ControlService(
        IntPtr servicio, int control, out ServicioEstadoProceso estado);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceConfig(
        IntPtr servicio, IntPtr configuracion, int tamano, out int necesarios);

    /// <summary>QUERY_SERVICE_CONFIG: solo se lee la ruta del binario.</summary>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ConfiguracionServicio
    {
        public uint TipoServicio;
        public uint TipoArranque;
        public uint ControlError;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? RutaBinaria;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? GrupoCarga;
        public uint IdEtiqueta;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? Dependencias;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? Cuenta;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? NombreVisible;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteService(IntPtr servicio);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr servicio);

    // ── opciones ─────────────────────────────────────────────────

    /// <summary>Argumentos --nombre valor del empujador.</summary>
    private sealed class Opciones(string[] args)
    {
        public string Ip => Leer("--ip") ?? "";
        public string Usuario => Leer("--usuario") ?? "";
        public string Clave => Leer("--clave") ?? "";
        public string? Codigo => Leer("--codigo");
        public string? Servidor => Leer("--servidor");
        public string? Exe => Leer("--exe");

        private string? Leer(string nombre)
        {
            for (var i = 1; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], nombre, StringComparison.OrdinalIgnoreCase))
                    return args[i + 1];
            }
            return null;
        }

        public bool ValidaBasica() =>
            Ip.Length > 0 && Usuario.Length > 0 && Clave.Length > 0;
    }
}
