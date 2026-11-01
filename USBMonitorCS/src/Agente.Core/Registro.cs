// -*- coding: utf-8 -*-
// Registro (log) del agente: un solo logger raíz con rotación.
// Espejo de USBMonitor/nucleo/registro.py.
using System.Globalization;

namespace USBMonitor.Agente.Core;

/// <summary>Niveles del registro, espejo de los de Python.</summary>
public enum NivelRegistro
{
    Debug,
    Info,
    Advertencia,
    Error,
}

/// <summary>Escritor de archivo con rotación por tamaño (archivo.1, .2, …).</summary>
internal sealed class EscritorRotativo
{
    private readonly string _ruta;
    private readonly long _maxBytes;
    private readonly int _copias;
    private readonly object _cerrojo = new();

    public EscritorRotativo(string ruta, long maxBytes, int copias)
    {
        _ruta = ruta;
        _maxBytes = maxBytes;
        _copias = copias;
    }

    public void Escribir(string linea)
    {
        lock (_cerrojo)
        {
            try
            {
                var directorio = Path.GetDirectoryName(_ruta);
                if (!string.IsNullOrEmpty(directorio))
                    Directory.CreateDirectory(directorio);
                RotarSiHaceFalta(Encoding_Contar(linea));
                File.AppendAllText(_ruta, linea + Environment.NewLine);
            }
            catch
            {
                // El log nunca tumba al agente.
            }
        }
    }

    private static int Encoding_Contar(string linea) =>
        System.Text.Encoding.UTF8.GetByteCount(linea) + 2;

    private void RotarSiHaceFalta(int bytesNuevos)
    {
        if (_copias <= 0 || !File.Exists(_ruta))
            return;
        if (new FileInfo(_ruta).Length + bytesNuevos <= _maxBytes)
            return;
        var ultima = $"{_ruta}.{_copias}";
        if (File.Exists(ultima))
            File.Delete(ultima);
        for (var i = _copias - 1; i >= 1; i--)
        {
            var origen = $"{_ruta}.{i}";
            if (File.Exists(origen))
                File.Move(origen, $"{_ruta}.{i + 1}");
        }
        File.Move(_ruta, $"{_ruta}.1");
    }
}

/// <summary>Logger con nombre (usbmonitor.&lt;nombre&gt;), como en Python.</summary>
public sealed class Registrador
{
    private readonly string _nombre;

    internal Registrador(string nombre) => _nombre = nombre;

    public void Debug(string mensaje) => Registro.Emitir(NivelRegistro.Debug, _nombre, mensaje);
    public void Info(string mensaje) => Registro.Emitir(NivelRegistro.Info, _nombre, mensaje);
    public void Advertencia(string mensaje) => Registro.Emitir(NivelRegistro.Advertencia, _nombre, mensaje);
    public void Error(string mensaje) => Registro.Emitir(NivelRegistro.Error, _nombre, mensaje);

    /// <summary>Error con la traza completa de la excepción.</summary>
    public void Excepcion(string mensaje, Exception excepcion) =>
        Registro.Emitir(NivelRegistro.Error, _nombre, $"{mensaje}: {excepcion}");
}

/// <summary>
/// Punto único de registro. La carpeta de datos es
/// <c>ProgramData\USBMonitor</c> en Windows y la temporal del sistema
/// fuera de Windows (nunca una ruta «C:» relativa, como en Python).
/// </summary>
public static class Registro
{
    private static readonly object Cerrojo = new();
    private static EscritorRotativo? _escritor;
    private static bool _consola = true;
    private static string? _directorioPersonalizado;

    public static string DirectorioDatos
    {
        get
        {
            if (_directorioPersonalizado is not null)
                return _directorioPersonalizado;
            if (OperatingSystem.IsWindows())
            {
                var programData = Environment.GetEnvironmentVariable("ProgramData") ?? @"C:\ProgramData";
                return Path.Combine(programData, "USBMonitor");
            }
            return Path.Combine(Path.GetTempPath(), "USBMonitor");
        }
    }

    /// <summary>Fija la carpeta de datos (pruebas y modos especiales).</summary>
    public static void FijarDirectorioDatos(string directorio) => _directorioPersonalizado = directorio;

    public static string DirectorioDatosCreado()
    {
        var directorio = DirectorioDatos;
        Directory.CreateDirectory(directorio);
        return directorio;
    }

    /// <summary>Configura el archivo principal (5 MB × 5), una vez por proceso.</summary>
    public static void Configurar(string nombreArchivo = "agente.log", bool consola = true)
    {
        lock (Cerrojo)
        {
            _consola = consola;
            _escritor = new EscritorRotativo(
                Path.Combine(DirectorioDatosCreado(), nombreArchivo),
                5 * 1024 * 1024,
                5);
        }
    }

    public static Registrador Obtener(string nombre) => new(nombre);

    internal static void Emitir(NivelRegistro nivel, string nombre, string mensaje)
    {
        var token = nivel switch
        {
            NivelRegistro.Debug => "DEBUG",
            NivelRegistro.Info => "INFO",
            NivelRegistro.Advertencia => "ADVERTENCIA",
            _ => "ERROR",
        };
        var linea = string.Create(
            CultureInfo.InvariantCulture,
            $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{token}] {nombre}: {mensaje}");
        lock (Cerrojo)
        {
            _escritor?.Escribir(linea);
        }
        if (_consola && nivel >= NivelRegistro.Info)
        {
            try { Console.WriteLine(linea); } catch { /* sin consola */ }
        }
    }

    /// <summary>
    /// Latido de depuración: cada 1 s añade la línea del proveedor a
    /// <c>latido.log</c> (rotativo 2 MB × 3). Activo por defecto; se
    /// apaga con la variable de entorno USBMONITOR_DEPURACION=0.
    /// </summary>
    public static Task IniciarLatido(Func<string> linea, CancellationToken cancelacion)
    {
        if (Environment.GetEnvironmentVariable("USBMONITOR_DEPURACION") == "0")
            return Task.CompletedTask;
        var escritor = new EscritorRotativo(
            Path.Combine(DirectorioDatosCreado(), "latido.log"),
            2 * 1024 * 1024,
            3);
        return Task.Run(async () =>
        {
            while (!cancelacion.IsCancellationRequested)
            {
                string texto;
                try
                {
                    texto = linea();
                }
                catch (Exception exc)
                {
                    texto = $"latido: el proveedor falló: {exc.Message}";
                }
                var marca = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                escritor.Escribir($"{marca} [INFO] latido: {texto}");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), cancelacion).ConfigureAwait(false);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }
        }, cancelacion);
    }
}
