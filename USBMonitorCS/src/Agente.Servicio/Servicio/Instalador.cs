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
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Registro del servicio en Windows y restauración sin servicio.</summary>
public static class Instalador
{
    public const string NombreServicio = "USBMonitorService";
    public const string NombreTarea = "USBMonitorCompanero";
    private const string NombreVisible = "NorthStar USB Service";
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

    private static void Ejecutar(string programa, params string[] argumentos)
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
                return;
            }
            string salida = proceso.StandardOutput.ReadToEnd();
            string errores = proceso.StandardError.ReadToEnd();
            if (!proceso.WaitForExit(30000))
            {
                LogInstalador.Advertencia($"{programa} {string.Join(" ", argumentos)}: sin salida en 30 s.");
                return;
            }
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
        }
        catch (Exception exc)
        {
            LogInstalador.Advertencia($"{programa}: {exc.Message}");
        }
    }

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
            throw new InvalidOperationException("El servicio ya está instalado.");

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
        Ejecutar("schtasks.exe", "/Create", "/TN", NombreTarea,
            "/TR", $"\"{exe}\" prompt", "/SC", "ONLOGON", "/RL", "LIMITED", "/F");
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
    /// </summary>
    public static string Desinstalar()
    {
        if (EstadoServicio() == "no instalado")
            throw new InvalidOperationException("El servicio no está instalado.");
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
        return "Servicio desinstalado y sistema restaurado.";
    }
}
