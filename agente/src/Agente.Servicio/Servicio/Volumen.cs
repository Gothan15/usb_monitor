// -*- coding: utf-8 -*-
// Candado de volumen: FSCTL_LOCK_VOLUME + FSCTL_DISMOUNT_VOLUME con
// el handle retenido. Espejo de nucleo/volumen.py.
//
// Mientras el servicio conserva el handle, Windows no puede remontar
// el volumen: ni lectura ni escritura por el sistema de archivos. Al
// soltar el handle, el volumen vuelve solo (el automontaje de Windows
// no se toca en la v2: tocarlo fue parte del problema de la v1).
//
// El bloqueo solo se da por bueno tras la SONDA: listar la raíz del
// volumen tiene que fallar. Sin sonda no hay bloqueo «confirmado».
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Operaciones FSCTL sobre volúmenes y sonda de accesibilidad.</summary>
public static class Volumen
{
    private static readonly Registrador Log = Registro.Obtener("volumen");

    private const uint FsctlLockVolume = 0x00090018;
    private const uint FsctlDismountVolume = 0x00090020;

    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    private static extern SafeFileHandle CreateFileW(
        string nombre, uint acceso, uint compartir, IntPtr seguridad,
        uint creacion, uint atributos, IntPtr plantilla);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "DeviceIoControl")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(
        SafeFileHandle dispositivo, uint codigo, IntPtr entrada, uint tamEntrada,
        IntPtr salida, uint tamSalida, out uint devueltos, IntPtr solapado);

    /// <summary>Ruta de la raíz del volumen: "X:\".</summary>
    public static string RutaVolumen(string letra)
    {
        var limpia = letra.Trim().TrimEnd('\\', '/').TrimEnd(':');
        return $"{limpia}:\\";
    }

    /// <summary>Normaliza una letra a la forma "X:".</summary>
    public static string NormalizarLetra(string letra)
    {
        var limpia = letra.Trim().ToUpperInvariant().TrimEnd('\\', '/', ':');
        return limpia + ":";
    }

    /// <summary>Sonda: True si la raíz del volumen se puede listar.</summary>
    public static bool EsAccesible(string letra)
    {
        try
        {
            _ = Directory.GetFileSystemEntries(RutaVolumen(letra));
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Handle retenido sobre un volumen desmontado.</summary>
    public sealed class CandadoVolumen
    {
        private SafeFileHandle? _handle;

        public CandadoVolumen(string letra)
        {
            Letra = NormalizarLetra(letra);
        }

        public string Letra { get; }

        private bool Abrir()
        {
            var ruta = $@"\\.\{Letra}";
            var handle = CreateFileW(
                ruta, GenericRead | GenericWrite, FileShareRead | FileShareWrite,
                IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                Log.Advertencia($"CreateFileW({ruta}) falló: {Marshal.GetLastWin32Error()}");
                return false;
            }
            _handle = handle;
            return true;
        }

        private bool Ioctl(uint codigo)
        {
            if (_handle is null || _handle.IsInvalid) return false;
            return DeviceIoControl(
                _handle, codigo, IntPtr.Zero, 0, IntPtr.Zero, 0, out _, IntPtr.Zero);
        }

        /// <summary>Bloquea, desmonta y verifica con la sonda.</summary>
        public bool Bloquear(int intentos = 8, int esperaMs = 400)
        {
            if (_handle is null && !Abrir()) return false;
            var cedio = false;
            for (var i = 0; i < intentos; i++)
            {
                if (Ioctl(FsctlLockVolume)) { cedio = true; break; }
                Thread.Sleep(esperaMs);
            }
            if (!cedio)
            {
                Log.Advertencia($"FSCTL_LOCK_VOLUME no cedió para {Letra}");
                Soltar();
                return false;
            }
            if (!Ioctl(FsctlDismountVolume))
            {
                Log.Advertencia($"FSCTL_DISMOUNT_VOLUME falló para {Letra}");
                Soltar();
                return false;
            }
            if (EsAccesible(Letra))
            {
                Log.Advertencia($"Sonda: {Letra} sigue accesible tras desmontar");
                Soltar();
                return false;
            }
            return true;
        }

        public void Soltar()
        {
            try { _handle?.Dispose(); } catch { /* soltar nunca lanza */ }
            _handle = null;
        }
    }
}

/// <summary>Registro de candados por letra, seguro entre hilos.</summary>
public sealed class CandadosVolumen
{
    private readonly object _lock = new();
    private readonly Dictionary<string, Volumen.CandadoVolumen> _candados = new();

    public bool Bloquear(string letra)
    {
        var clave = Volumen.NormalizarLetra(letra);
        lock (_lock)
        {
            if (_candados.ContainsKey(clave))
                return true; // ya retenido por este proceso
            var candado = new Volumen.CandadoVolumen(clave);
            if (!candado.Bloquear()) return false;
            _candados[clave] = candado;
            return true;
        }
    }

    public void Soltar(string letra)
    {
        var clave = Volumen.NormalizarLetra(letra);
        Volumen.CandadoVolumen? candado;
        lock (_lock)
        {
            if (!_candados.Remove(clave, out candado)) return;
        }
        candado.Soltar();
    }

    public void SoltarTodos()
    {
        List<Volumen.CandadoVolumen> candados;
        lock (_lock)
        {
            candados = new List<Volumen.CandadoVolumen>(_candados.Values);
            _candados.Clear();
        }
        foreach (var candado in candados) candado.Soltar();
    }

    public bool Retenida(string letra)
    {
        lock (_lock) return _candados.ContainsKey(Volumen.NormalizarLetra(letra));
    }
}
