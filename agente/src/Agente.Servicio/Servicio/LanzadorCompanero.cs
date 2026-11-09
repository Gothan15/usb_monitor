// -*- coding: utf-8 -*-
// Relanzamiento del compañero dentro de la sesión del usuario.
//
// El servicio vive en la sesión 0 y el compañero (la ventana de la
// contraseña) tiene que vivir en la sesión interactiva. Hasta ahora
// dependía de la tarea programada de inicio de sesión y de que
// `schtasks /Run` acertara tras instalar: si la tarea se creaba
// para otra cuenta (p. ej. el asistente se ejecutó elevado con las
// credenciales de OTRO administrador) o el usuario cerraba la
// ventana, el compañero desaparecía y ningún bloqueo podía
// desbloquearse hasta abrirlo a mano desde la caja de herramientas.
//
// Esto es la vía directa: con el token de la sesión de consola
// activa se crea el proceso del compañero EN esa sesión
// (CreateProcessAsUser). Lo invoca el vigía del servicio cuando el
// compañero lleva dos chequeos seguidos sin aparecer.
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Lanza el compañero en la sesión de consola activa, si la hay.</summary>
public static class LanzadorCompanero
{
    private static readonly Registrador Log = Registro.Obtener("servicio");

    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const int TokenPrimary = 1;
    private const int SecurityImpersonation = 2;
    private const uint TokenAllAccess = 0xF01FF;

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ProcessIdToSessionId(uint proceso, out uint sesion);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sesion, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(
        IntPtr token, uint acceso, IntPtr atributos,
        int nivelImpersonacion, int tipoToken, out IntPtr tokenNuevo);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr entorno, IntPtr token, bool heredar);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr entorno);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr token,
        string? aplicacion,
        StringBuilder lineaComandos,
        IntPtr atributosProceso,
        IntPtr atributosHilo,
        [MarshalAs(UnmanagedType.Bool)] bool heredarHandles,
        uint banderas,
        IntPtr entorno,
        string? directorio,
        ref StartupInfo startup,
        out ProcessInformation proceso);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Cb;
        public string? Reservado;
        public string? Escritorio;
        public string? Titulo;
        public int X;
        public int Y;
        public int Ancho;
        public int Alto;
        public int ContarCharsX;
        public int ContarCharsY;
        public int ColorFondo;
        public int Banderas;
        public short MostrarVentana;
        public short Reservado2;
        public IntPtr ReservadoPtr;
        public IntPtr StdEntrada;
        public IntPtr StdSalida;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Proceso;
        public IntPtr Hilo;
        public uint IdProceso;
        public uint IdHilo;
    }

    /// <summary>
    /// Intenta dejar un compañero corriendo en la sesión activa.
    /// Devuelve false (con el motivo en el registro) si no hay
    /// sesión de usuario o si Windows rechaza la creación; quien
    /// llama reintenta más tarde, nunca es un error fatal.
    /// </summary>
    public static bool IntentarLanzar()
    {
        uint sesion = WTSGetActiveConsoleSessionId();
        if (sesion == 0xFFFFFFFF)
        {
            Log.Debug("Relanzar compañero: no hay sesión de consola activa.");
            return false;
        }
        if (ProcessIdToSessionId((uint)Environment.ProcessId, out uint propia) &&
            propia == sesion)
        {
            // El servicio no está en la sesión 0 (modo debug): el
            // compañero ya puede lanzarse por la vía normal.
            Log.Debug("Relanzar compañero: el servicio ya está en la sesión activa.");
            return false;
        }
        if (!WTSQueryUserToken(sesion, out IntPtr tokenUsuario))
        {
            Log.Advertencia(
                $"Relanzar compañero: WTSQueryUserToken falló (error {Marshal.GetLastWin32Error()}).");
            return false;
        }

        IntPtr tokenPrimario = IntPtr.Zero;
        IntPtr entorno = IntPtr.Zero;
        try
        {
            if (!DuplicateTokenEx(
                    tokenUsuario, TokenAllAccess, IntPtr.Zero,
                    SecurityImpersonation, TokenPrimary, out tokenPrimario))
            {
                Log.Advertencia(
                    $"Relanzar compañero: DuplicateTokenEx falló (error {Marshal.GetLastWin32Error()}).");
                return false;
            }
            CreateEnvironmentBlock(out entorno, tokenPrimario, false);

            string exe = Instalador.RutaExe();
            var startup = new StartupInfo
            {
                Cb = Marshal.SizeOf<StartupInfo>(),
                Escritorio = @"winsta0\default",
            };
            var linea = new StringBuilder($"\"{exe}\" prompt");
            bool ok = CreateProcessAsUser(
                tokenPrimario, exe, linea,
                IntPtr.Zero, IntPtr.Zero, false,
                CreateUnicodeEnvironment, entorno,
                Path.GetDirectoryName(exe), ref startup, out var proceso);
            if (!ok)
            {
                Log.Advertencia(
                    $"Relanzar compañero: CreateProcessAsUser falló (error {Marshal.GetLastWin32Error()}).");
                return false;
            }
            CloseHandle(proceso.Hilo);
            CloseHandle(proceso.Proceso);
            Log.Info(
                $"Compañero relanzado en la sesión {sesion} (pid {proceso.IdProceso}).");
            return true;
        }
        finally
        {
            if (entorno != IntPtr.Zero) DestroyEnvironmentBlock(entorno);
            if (tokenPrimario != IntPtr.Zero) CloseHandle(tokenPrimario);
            CloseHandle(tokenUsuario);
        }
    }
}
