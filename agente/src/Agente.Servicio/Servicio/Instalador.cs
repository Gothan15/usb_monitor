// -*- coding: utf-8 -*-
// Instalación y desinstalación desde el propio ejecutable, y la
// restauración independiente. Espejo de servicio.py:
//
//   - Instalar: registra el servicio desde donde vive el exe,
//     recuperación automática (reiniciar al fallar, 3 veces), tarea
//     del compañero al iniciar sesión, y arranca.
//   - Desinstalar: orden sin huella — parar (la parada ya restaura),
//     restaurar lo que pudiera quedar, quitar servicio y tarea.
//   - RestaurarSinServicio: revierte el diario sin el servicio; lo
//     usan el desinstalador, el modo `restaurar` y «Restaurar todo».
using System.Diagnostics;
using Microsoft.Win32;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Registro del servicio en Windows y restauración sin servicio.</summary>
public static class Instalador
{
    public const string NombreServicio = "USBMonitorService";
    public const string NombreTarea = "USBMonitorCompanero";
    private const string NombreVisible = "USB Monitor Service";
    private const string Descripcion =
        "Supervisa dispositivos USB, los bloquea y exige la " +
        "contraseña del dueño o de un administrador para usarlos.";

    // ── advapi32 (registro del servicio) ──────────────────────────
    private const uint ScManagerAllAccess = 0xF003F;
    private const uint ServiceAllAccess = 0xF01FF;
    private const uint ServiceQueryStatus = 0x0004;
    private const uint ServiceDelete = 0x10000;
    private const uint ServiceWin32OwnProcess = 0x00000010;
    private const uint ServiceAutoStart = 0x00000002;
    private const uint ServiceErrorNormal = 0x00000001;
    private const uint ServiceConfigDescription = 1;

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string? maquina, string? baseDatos, uint acceso);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr scm, string nombre, uint acceso);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateService(
        IntPtr scm, string nombreServicio, string nombreVisible, uint acceso,
        uint tipoServicio, uint tipoInicio, uint controlError, string rutaBinario,
        string? grupoCarga, IntPtr etiqueta, string? dependencias,
        string? cuenta, string? contrasena);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ChangeServiceConfig2(IntPtr servicio, uint nivel, ref ServiceDescription info);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteService(IntPtr servicio);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceDescription
    {
        public string? LpDescription;
    }

    // ── utilidades ────────────────────────────────────────────────
    public static bool EsAdmin()
    {
        try
        {
            using var identidad = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identidad).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Ruta del ejecutable en ejecución: el servicio se registra desde
    /// donde vive (C:\USBMonitor o donde se haya colocado).
    /// </summary>
    public static string RutaExe()
    {
        return Environment.ProcessPath
               ?? Path.Combine(AppContext.BaseDirectory, "USBMonitorService.exe");
    }

    /// <summary>
    /// Ruta del ejecutable que el servicio tiene registrado
    /// (ImagePath en el registro). Difiere de RutaExe() cuando
    /// quien corre es una COPIA del exe — el actualizador, por
    /// ejemplo —: lo instalado es lo que manda.
    /// </summary>
    public static string RutaExeInstalado()
    {
        try
        {
            using var clave = Registry.LocalMachine.OpenSubKey(
                $@"SYSTEM\CurrentControlSet\Services\{NombreServicio}");
            if (clave?.GetValue("ImagePath") is string imagen
                && !string.IsNullOrWhiteSpace(imagen))
            {
                var ruta = imagen.Trim().Trim('"');
                var corte = ruta.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
                if (corte > 0)
                    ruta = ruta[..(corte + 4)];
                if (ruta.Length > 0)
                    return ruta;
            }
        }
        catch
        {
            // Sin acceso al registro: se cae a la ruta en ejecución.
        }
        return RutaExe();
    }

    /// <summary>Estado del servicio con las palabras de la caja de herramientas.</summary>
    public static string EstadoServicio()
    {
        try
        {
            var servicios = ServiceController.GetServices();
            var encontrado = servicios.FirstOrDefault(s => s.ServiceName == NombreServicio);
            if (encontrado is null) return "no instalado";
            return encontrado.Status switch
            {
                ServiceControllerStatus.Running => "en ejecución",
                ServiceControllerStatus.Stopped => "detenido",
                ServiceControllerStatus.StartPending => "arrancando…",
                ServiceControllerStatus.StopPending => "deteniéndose…",
                ServiceControllerStatus.Paused => "en pausa",
                _ => "desconocido",
            };
        }
        catch (Exception)
        {
            return "sin acceso";
        }
    }

    private static readonly Registrador LogInstalador = Registro.Obtener("instalador");

    private static int Ejecutar(string programa, params string[] argumentos)
    {
        // Los comandos auxiliares (sc.exe, schtasks.exe) nunca tumban
        // la instalación, pero su resultado SÍ queda en el registro:
        // un `schtasks /Run` fallido era invisible y dejaba al equipo
        // sin compañero hasta el siguiente inicio de sesión.
        try
        {
            var psi = new ProcessStartInfo(programa)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argumento in argumentos) psi.ArgumentList.Add(argumento);
            using var proceso = Process.Start(psi);
            if (proceso is null)
            {
                LogInstalador.Advertencia($"{programa}: no se pudo iniciar el proceso.");
                return -1;
            }
            // Las dos salidas se leen EN PARALELO y la espera va
            // con límite de verdad: antes se leía stdout hasta el
            // final, luego stderr, y el WaitForExit(30000) solo
            // llegaba DESPUÉS de ambas lecturas — un hijo que
            // llenara una tubería o se quedara colgado dejaba la
            // lectura bloqueada para siempre. En el modo
            // `instalar-remoto` eso significaba que el servicio
            // temporal nunca terminaba: su proceso (este mismo
            // exe) seguía vivo y el ejecutable quedaba «en uso»
            // sin remedio. Ahora, a los 30 s sin salir, se mata.
            var lecturaSalida = proceso.StandardOutput.ReadToEndAsync();
            var lecturaErrores = proceso.StandardError.ReadToEndAsync();
            if (!proceso.WaitForExit(30000))
            {
                try { proceso.Kill(entireProcessTree: true); } catch { /* ya salió */ }
                LogInstalador.Advertencia($"{programa} {string.Join(" ", argumentos)}: sin salida en 30 s; proceso terminado.");
                return -1;
            }
            string salida = lecturaSalida.GetAwaiter().GetResult();
            string errores = lecturaErrores.GetAwaiter().GetResult();
            string detalle = string.Join(" ", argumentos);
            if (proceso.ExitCode != 0)
            {
                string texto = (errores + " " + salida).Trim();
                LogInstalador.Advertencia(
                    $"{programa} {detalle} -> código {proceso.ExitCode}: {texto}");
            }
            else
            {
                LogInstalador.Debug($"{programa} {detalle} -> OK");
            }
            return proceso.ExitCode;
        }
        catch (Exception exc)
        {
            LogInstalador.Advertencia($"{programa}: {exc.Message}");
            return -1;
        }
    }

    /// <summary>
    /// Crea (o refresca) la tarea del compañero al iniciar
    /// sesión. La vía clásica (schtasks /Create sin cuenta) la
    /// traduce Windows a la identidad de quien instala; cuando
    /// quien instala es el servicio temporal de la instalación
    /// remota (cuenta SYSTEM), esa traducción falla con el
    /// error 1332 y la tarea no nace — se vio en la VM el
    /// 2026-11-08. En ese caso se crea desde una definición
    /// XML cuyo sujeto es el GRUPO Usuarios: vale para quien
    /// inicie sesión, sin traducir ninguna cuenta.
    /// </summary>
    private static void CrearTareaCompanero(string exe)
    {
        if (Ejecutar("schtasks.exe", "/Create", "/TN", NombreTarea,
                "/TR", $"\"{exe}\" prompt", "/SC", "ONLOGON",
                "/RL", "LIMITED", "/F") == 0)
            return;
        var rutaXml = Path.Combine(
            Path.GetTempPath(), "USBMonitorCompanero.xml");
        try
        {
            File.WriteAllText(
                rutaXml, ConstruirXmlTareaCompanero(exe),
                System.Text.Encoding.Unicode);
            if (Ejecutar("schtasks.exe", "/Create", "/TN", NombreTarea,
                    "/XML", rutaXml, "/F") == 0)
                LogInstalador.Info(
                    "Tarea del compañero creada desde la definición XML (sujeto: grupo Usuarios).");
        }
        finally
        {
            try { File.Delete(rutaXml); } catch { /* temporal */ }
        }
    }

    /// <summary>La definición XML de la tarea del compañero (grupo Usuarios, al iniciar sesión, sin límite de tiempo).</summary>
    internal static string ConstruirXmlTareaCompanero(string exe) =>
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
        "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n" +
        "  <RegistrationInfo><Description>Compañero de USB Monitor: muestra los avisos de bloqueo en la sesión del usuario.</Description></RegistrationInfo>\r\n" +
        "  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>\r\n" +
        "  <Principals><Principal id=\"Autor\"><GroupId>S-1-5-32-545</GroupId><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n" +
        "  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>" +
        "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>" +
        "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>" +
        "<Enabled>true</Enabled><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>\r\n" +
        $"  <Actions Context=\"Autor\"><Exec><Command>{EscaparXml(exe)}</Command><Arguments>prompt</Arguments></Exec></Actions>\r\n" +
        "</Task>\r\n";

    /// <summary>Escapa los caracteres con significado en XML.</summary>
    private static string EscaparXml(string texto) => texto
        .Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
        .Replace("\"", "&quot;").Replace("'", "&apos;");

    // ── restauración independiente ────────────────────────────────
    /// <summary>
    /// Revierte el diario sin el servicio: reactiva nodos y suelta
    /// volúmenes anotados. Lo invocan el desinstalador, el modo
    /// `restaurar` y el botón «Restaurar todo» de la caja de
    /// herramientas.
    /// </summary>
    public static ResumenRestauracion RestaurarSinServicio()
    {
        var diario = new Diario();
        var candados = new CandadosVolumen();
        candados.SoltarTodos();
        return diario.RestaurarTodo(Pnp.Habilitar, _ => true);
    }

    // ── instalar / desinstalar ────────────────────────────────────
    /// <summary>
    /// Registra el servicio en Windows, crea la tarea del compañero
    /// al iniciar sesión, ajusta la recuperación automática y arranca.
    /// Devuelve un resumen para mostrar. Requiere administrador.
    /// </summary>
    public static string Instalar()
    {
        var exe = RutaExe();
        if (EstadoServicio() != "no instalado")
        {
            // Reparación: el segundo empujón tras uno cortado a
            // medias. El servicio ya existe y es ESTE ejecutable:
            // no hay nada que registrar — se refresca la tarea
            // del compañero y se pone en marcha, para que gaste
            // el código que el instalador remoto acaba de
            // escribir en server.json. Si el servicio registrado
            // apuntara a OTRO ejecutable, sí sería un conflicto.
            var instalado = RutaExeInstalado();
            if (!string.Equals(
                    Path.GetFullPath(instalado), Path.GetFullPath(exe),
                    StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"El servicio ya está instalado desde otra ruta ({instalado}); no se toca.");
            CrearTareaCompanero(exe);
            using var existente = new ServiceController(NombreServicio);
            if (existente.Status == ServiceControllerStatus.Stopped)
                existente.Start();
            LogInstalador.Info(
                "Instalar sobre un servicio ya registrado (reparación): tarea refrescada y servicio en marcha.");
            return $"El servicio ya estaba instalado desde {exe}: queda en marcha.";
        }

        var scm = OpenSCManager(null, null, ScManagerAllAccess);
        if (scm == IntPtr.Zero)
            throw new InvalidOperationException(
                $"No se pudo abrir el gestor de servicios (error {Marshal.GetLastWin32Error()}).");
        try
        {
            var svc = CreateService(
                scm, NombreServicio, NombreVisible, ServiceAllAccess,
                ServiceWin32OwnProcess, ServiceAutoStart, ServiceErrorNormal,
                $"\"{exe}\"", null, IntPtr.Zero, null, null, null);
            if (svc == IntPtr.Zero)
                throw new InvalidOperationException(
                    $"CreateService falló (error {Marshal.GetLastWin32Error()}).");
            try
            {
                var descripcion = new ServiceDescription { LpDescription = Descripcion };
                ChangeServiceConfig2(svc, ServiceConfigDescription, ref descripcion);
            }
            catch (Exception)
            {
                // La descripción es cosmética: nunca bloquea la instalación.
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

        // Recuperación automática: reiniciar al fallar (1 min), 3 veces.
        Ejecutar("sc.exe", "failure", NombreServicio,
            "reset=", "86400", "actions=", "restart/60000/restart/60000/restart/60000");
        // El compañero al iniciar sesión: el mismo exe en modo prompt.
        CrearTareaCompanero(exe);
        // Y a correr AHORA, en la sesión actual: sin esto el
        // compañero no existe hasta el próximo inicio de sesión y
        // ningún bloqueo podría desbloquearse tras instalar.
        Ejecutar("schtasks.exe", "/Run", "/TN", NombreTarea);

        using var controlador = new ServiceController(NombreServicio);
        controlador.Start();
        return $"Servicio instalado desde {exe} y en marcha.";
    }

    /// <summary>
    /// Sustituye el ejecutable instalado por otro ya descargado y
    /// verificado (la verificación de hash la hace quien llama:
    /// este modo solo intercambia y rearranca). Lo lanza el propio
    /// agente DESDE UNA COPIA temporal de sí mismo, nunca desde el
    /// archivo instalado: el intercambio es por renombrado
    /// (renombrar un exe en uso está permitido y crear otro en su
    /// sitio también), la versión saliente queda en
    /// «&lt;exe&gt;.anterior» y si la nueva no arranca se restaura
    /// sola. El compañero en sesión de usuario se cierra antes del
    /// cambio: el servicio lo relanza al arrancar.
    /// </summary>
    public static string AplicarActualizacion(string rutaNuevo)
    {
        if (!File.Exists(rutaNuevo))
            throw new FileNotFoundException("No existe el ejecutable nuevo.", rutaNuevo);
        var destino = RutaExeInstalado();
        if (string.Equals(
                Path.GetFullPath(rutaNuevo), Path.GetFullPath(destino),
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "El ejecutable nuevo es el que ya está instalado.");
        if (EstadoServicio() == "no instalado")
            throw new InvalidOperationException(
                "El servicio no está instalado: no hay nada que actualizar.");

        var respaldo = destino + ".anterior";
        using var controlador = new ServiceController(NombreServicio);
        var estabaEnMarcha = controlador.Status is
            ServiceControllerStatus.Running or ServiceControllerStatus.StartPending;

        if (controlador.Status != ServiceControllerStatus.Stopped)
        {
            try { controlador.Stop(); }
            catch { /* ya parado o parándose: lo fija la espera */ }
            try
            {
                controlador.WaitForStatus(
                    ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60));
            }
            catch { /* el renombrado no depende de que haya parado */ }
        }

        CerrarProcesosDelExe(destino);

        if (File.Exists(respaldo))
            File.Delete(respaldo);
        File.Move(destino, respaldo);
        try
        {
            File.Copy(rutaNuevo, destino);
        }
        catch
        {
            File.Move(respaldo, destino);
            if (estabaEnMarcha)
            {
                try { controlador.Start(); }
                catch { /* el error que se propaga es el de la copia */ }
            }
            throw;
        }

        try
        {
            controlador.Refresh();
            controlador.Start();
            controlador.WaitForStatus(
                ServiceControllerStatus.Running, TimeSpan.FromSeconds(60));
        }
        catch (Exception exc)
        {
            // Vuelta atrás: la versión anterior sigue en el respaldo.
            try
            {
                controlador.Refresh();
                if (controlador.Status != ServiceControllerStatus.Stopped)
                    controlador.Stop();
            }
            catch { /* la restauración del archivo no depende de esto */ }
            try
            {
                File.Delete(destino);
                File.Move(respaldo, destino);
                controlador.Start();
            }
            catch { /* se propaga el fallo original, no este */ }
            throw new InvalidOperationException(
                $"La versión nueva no arrancó ({exc.Message}); se restauró la anterior.",
                exc);
        }

        return $"Agente actualizado en {destino}; la versión anterior queda en {respaldo}.";
    }

    /// <summary>
    /// Cierra los procesos que corren desde el ejecutable dado
    /// (el compañero en la sesión del usuario) salvo este proceso.
    /// Sin piedad pero sin bloqueo: si alguno no muere, el
    /// intercambio por renombrado sigue adelante igual.
    /// </summary>
    private static void CerrarProcesosDelExe(string rutaExe)
    {
        foreach (var proceso in Process.GetProcesses())
        {
            try
            {
                if (proceso.Id == Environment.ProcessId)
                    continue;
                var suya = proceso.MainModule?.FileName;
                if (suya is not null && string.Equals(
                        suya, rutaExe, StringComparison.OrdinalIgnoreCase))
                {
                    proceso.Kill();
                    proceso.WaitForExit(3000);
                }
            }
            catch
            {
                // Sin acceso a ese proceso: no es asunto del actualizador.
            }
            finally
            {
                proceso.Dispose();
            }
        }
    }

    /// <summary>
    /// Orden sin huella: parar (la parada ya restaura), restaurar lo
    /// que pudiera quedar, quitar el servicio y la tarea. No borra los
    /// archivos del ejecutable: eso se hace a mano.
    ///
    /// El orden del apagado importa (síntoma de 2026-11-08: «se
    /// desinstala y el proceso se queda funcionando»):
    ///   1. Se para el SERVICIO primero, porque su vigía relanza
    ///      al compañero si desaparece: matar al compañero con el
    ///      servicio vivo era perder el tiempo.
    ///   2. Se quitan el servicio y la tarea de inicio de sesión
    ///      (lo que podría volver a arrancar algo al reiniciar o
    ///      al entrar un usuario).
    ///   3. AL FINAL se cierran los procesos que queden corriendo
    ///      desde el ejecutable instalado —el compañero en la
    ///      sesión del usuario, un visor, otra caja de
    ///      herramientas, incluso el propio servicio si su parada
    ///      no llegó a tiempo— salvo ESTE proceso, que sale por
    ///      su cuenta al terminar el modo desinstalar (y la caja
    ///      de herramientas se cierra a sí misma tras el aviso).
    /// Resultado: cero procesos del agente en marcha.
    /// </summary>
    public static string Desinstalar()
    {
        if (EstadoServicio() == "no instalado")
            throw new InvalidOperationException("El servicio no está instalado.");
        // La ruta instalada se lee ANTES de borrar el servicio:
        // después, el barrido de procesos ya no sabría qué
        // ejecutable buscar en el registro.
        var rutaExe = RutaExeInstalado();
        try
        {
            using var controlador = new ServiceController(NombreServicio);
            if (controlador.Status != ServiceControllerStatus.Stopped)
            {
                controlador.Stop();
                controlador.WaitForStatus(
                    ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            }
        }
        catch (Exception)
        {
            // Como en el Python: se sigue con la restauración igualmente.
        }

        RestaurarSinServicio();

        var scm = OpenSCManager(null, null, ScManagerAllAccess);
        if (scm != IntPtr.Zero)
        {
            try
            {
                var svc = OpenService(scm, NombreServicio, ServiceDelete | ServiceQueryStatus);
                if (svc != IntPtr.Zero)
                {
                    try { DeleteService(svc); }
                    finally { CloseServiceHandle(svc); }
                }
            }
            finally
            {
                CloseServiceHandle(scm);
            }
        }
        Ejecutar("schtasks.exe", "/Delete", "/TN", NombreTarea, "/F");
        BorrarAccesoDirectoEscritorio();
        CerrarProcesosDelExe(rutaExe);
        return "Servicio desinstalado, sistema restaurado y procesos del agente cerrados.";
    }

    /// <summary>
    /// La desinstalación completa que piden el panel y la caja de
    /// herramientas: la de siempre (servicio, tarea, restauración,
    /// procesos) y además el barrido de la carpeta de instalación
    /// — la que la instalación remota crea en C:\USBMonitor —,
    /// encargado a un cmd desprendido que reintenta hasta que los
    /// procesos del agente salgan, porque el ejecutable vive
    /// dentro y ningún proceso puede borrar su propia casa en
    /// marcha. La carpeta de datos de ProgramData se queda: es el
    /// rastro (registros y diario), no la instalación.
    /// </summary>
    public static string DesinstalarLimpio()
    {
        var carpeta = Path.GetDirectoryName(RutaExeInstalado());
        var resumen = Desinstalar();
        if (!BarridoInstalacion.EsCarpetaSegura(carpeta))
        {
            LogInstalador.Advertencia(
                $"Carpeta de instalación no barrida (ruta no segura): {carpeta}");
            return resumen + " La carpeta de instalación no se borró: su ruta no se reconoció como segura.";
        }
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = BarridoInstalacion.ConstruirOrdenBarrido(carpeta!),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
            LogInstalador.Info($"Barrido de la carpeta de instalación encargado: {carpeta}");
            return resumen + $" La carpeta {carpeta} se borrará en cuanto salgan los procesos del agente.";
        }
        catch (Exception exc)
        {
            LogInstalador.Advertencia($"No se pudo encargar el barrido de {carpeta}: {exc.Message}");
            return resumen + " La carpeta de instalación no se pudo borrar automáticamente.";
        }
    }

    // ── acceso directo en el escritorio ───────────────────────

    private const string NombreAccesoDirecto = "USB Monitor.lnk";

    /// <summary>
    /// Ruta del acceso directo: el escritorio PÚBLICO
    /// (C:\Users\Public\Desktop). La instalación remota corre
    /// como SYSTEM, sin usuario concreto: el escritorio público
    /// es el que ven todos los que entren en la PC.
    /// </summary>
    private static string RutaAccesoDirecto()
    {
        var escritorio = Environment.GetFolderPath(
            Environment.SpecialFolder.CommonDesktopDirectory);
        return Path.Combine(escritorio, NombreAccesoDirecto);
    }

    /// <summary>
    /// Crea (o refresca) el acceso directo a la caja de
    /// herramientas en el escritorio público: apunta al
    /// ejecutable SIN argumentos —el doble clic de siempre, que
    /// abre el asistente la primera vez y la caja después— con
    /// el icono del propio exe. Idempotente: guardar sobre la
    /// misma ruta sustituye el .lnk, reinstalar no duplica
    /// nada. Nunca tumba una instalación: quien llama decide
    /// con el bool, y el motivo queda en el registro.
    /// </summary>
    public static bool CrearAccesoDirectoEscritorio()
    {
        try
        {
            var exe = RutaExe();
            var enlace = (IShellLinkW)new ShellLink();
            try
            {
                enlace.SetPath(exe);
                enlace.SetWorkingDirectory(Path.GetDirectoryName(exe) ?? "");
                enlace.SetDescription("Caja de herramientas de USB Monitor");
                enlace.SetIconLocation(exe, 0);
                ((IPersistFile)enlace).Save(RutaAccesoDirecto(), true);
            }
            finally
            {
                Marshal.ReleaseComObject(enlace);
            }
            LogInstalador.Info(
                $"Acceso directo creado en el escritorio público: {RutaAccesoDirecto()}");
            return true;
        }
        catch (Exception exc)
        {
            LogInstalador.Advertencia(
                $"No se pudo crear el acceso directo del escritorio: {exc.Message}");
            return false;
        }
    }

    /// <summary>Quita el acceso directo si está (al desinstalar).</summary>
    private static void BorrarAccesoDirectoEscritorio()
    {
        try
        {
            var ruta = RutaAccesoDirecto();
            if (File.Exists(ruta))
                File.Delete(ruta);
        }
        catch
        {
            // Un .lnk huérfano es cosmético; la desinstalación no
            // puede caer por él.
        }
    }

    // IShellLink (Unicode) e IPersistFile, a mano como el resto
    // de la interop de esta casa: sin paquetes de interop.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder archivo, int tamano, IntPtr datos, int banderas);
        void GetIDList(out IntPtr idLista);
        void SetIDList(IntPtr idLista);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder descripcion, int tamano);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string descripcion);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder carpeta, int tamano);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string carpeta);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder argumentos, int tamano);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string argumentos);
        void GetHotkey(out short tecla);
        void SetHotkey(short tecla);
        void GetShowCmd(out int mostrar);
        void SetShowCmd(int mostrar);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder icono, int tamano, out int indice);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icono, int indice);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string ruta, int reservado);
        void Resolve(IntPtr ventana, int banderas);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string archivo);
    }

    [ComImport, Guid("0000010B-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        void GetClassID(out Guid clase);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string archivo, int modo);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string archivo, [MarshalAs(UnmanagedType.Bool)] bool recordar);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string archivo);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string archivo);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046"),
     ClassInterface(ClassInterfaceType.None)]
    private class ShellLink
    {
    }
}
