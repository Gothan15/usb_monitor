// -*- coding: utf-8 -*-
// Detección y clasificación de dispositivos (WMI). Espejo de
// nucleo/dispositivos.py.
//
// Tipos: DISCO (memorias, carcasas USBSTOR y carcasas UAS: disco SCSI
// con ancestro USB — un SATA interno también es SCSI y jamás debe
// clasificar), TELEFONO (WPD/MTP, sin letra, por serial), OPTICO
// (unidades de CD/DVD USB físicas) y RED (adaptadores USB; el servicio
// aplica la regla de línea base sobre ellos).
//
// La clasificación vive en funciones puras (ClasificarDisco,
// LimpiarSerial) separadas de WMI para poder probarla sin Windows.
using System.Management;
using System.Text.RegularExpressions;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Tipos de dispositivo vigilable (mismos textos que el agente Python).</summary>
public static class TipoDispositivo
{
    public const string Disco = "DISCO";
    public const string Telefono = "TELEFONO";
    public const string Optico = "OPTICO";
    public const string Red = "RED";
}

/// <summary>Un dispositivo presente, tal como lo ve la enumeración.</summary>
public sealed class Dispositivo
{
    public required string InstanciaPnP { get; init; }
    public required string Serial { get; init; }
    public required string Nombre { get; init; }
    public required string Tipo { get; init; }
    public List<string> Letras { get; init; } = new();
    public long Tamano { get; init; }

    /// <summary>Clave estable del dispositivo (instancia normalizada).</summary>
    public string Clave => InstanciaPnP.Trim().ToUpperInvariant();

    /// <summary>Primera letra de unidad, o null (teléfonos, discos sin montar).</summary>
    public string? Letra => Letras.Count > 0 ? Letras[0] : null;
}

/// <summary>Enumeración WMI de dispositivos vigilables.</summary>
public sealed class Detector
{
    private static readonly Registrador Log = Registro.Obtener("dispositivos");

    private readonly Func<string, List<string>> _ancestrosDe;
    private readonly object _lockCache = new();
    private readonly Dictionary<string, List<string>> _cacheAncestros = new();

    /// <param name="ancestrosDe">
    /// Resolvedor de ancestros PnP (instancia -> instancias padre).
    /// Se inyecta para poder probar la clasificación sin Windows;
    /// por defecto es <see cref="Pnp.Ancestros"/>.
    /// </param>
    public Detector(Func<string, List<string>>? ancestrosDe = null)
    {
        _ancestrosDe = ancestrosDe ?? (instancia => Pnp.Ancestros(instancia));
    }

    // ── clasificación pura ────────────────────────────────────────

    /// <summary>
    /// Serial utilizable: sin espacios extremos ni sufijos de instancia.
    /// Lección de la v1: de un id de instancia puede salir un «serial»
    /// como «0» (del sufijo &amp;0) o «N/A»; eso no identifica nada.
    /// </summary>
    public static string LimpiarSerial(string? bruto)
    {
        if (string.IsNullOrWhiteSpace(bruto)) return "";
        var serial = bruto.Trim();
        if (EsSerialInvalido(serial)) return "";
        // Cola típica de id de instancia: \&0 o &0 al final.
        serial = Regex.Replace(serial, "&0$", "").Trim();
        if (serial.Length == 0 || EsSerialInvalido(serial)) return "";
        return serial;
    }

    private static bool EsSerialInvalido(string serial)
    {
        return serial.ToUpperInvariant() is "N/A" or "NA" or "NONE" or "NULL" or "0";
    }

    public static string SerialDesdeInstancia(string? instancia)
    {
        if (string.IsNullOrEmpty(instancia)) return "";
        var partes = instancia.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        return partes.Length == 0 ? "" : LimpiarSerial(partes[^1]);
    }

    /// <summary>DISCO si el disco es externo USB; null si no debe vigilarse.</summary>
    public static string? ClasificarDisco(string? instancia, List<string>? ancestros, string modelo = "")
    {
        var superior = (instancia ?? "").ToUpperInvariant();
        if (superior.StartsWith("USBSTOR\\DISK")) return TipoDispositivo.Disco;
        if (superior.StartsWith("SCSI\\DISK"))
        {
            // Carcasa UAS o disco interno: solo cuenta con ancestro USB.
            foreach (var ancestro in ancestros ?? new List<string>())
            {
                var a = ancestro.ToUpperInvariant();
                if (a.StartsWith("USB\\") || a.Contains("\\USB\\")) return TipoDispositivo.Disco;
            }
            return null;
        }
        return null;
    }

    public static bool EsOpticoUsb(string? instancia, string modelo = "")
    {
        var superior = (instancia ?? "").ToUpperInvariant();
        if (!superior.StartsWith("USBSTOR\\CDROM")) return false;
        // Unidades virtuales (montadores de imágenes): no se vigilan.
        return !(modelo ?? "").ToLowerInvariant().Contains("virtual");
    }

    // ── WMI ───────────────────────────────────────────────────────

    private static string? Texto(ManagementBaseObject obj, string propiedad)
    {
        try
        {
            var valor = obj[propiedad];
            return valor?.ToString();
        }
        catch (Exception)
        {
            return null;
        }
    }

    private List<string> AncestrosDe(string instancia)
    {
        lock (_lockCache)
        {
            if (_cacheAncestros.TryGetValue(instancia, out var cacheados)) return cacheados;
        }
        List<string> ancestros;
        try
        {
            ancestros = _ancestrosDe(instancia);
        }
        catch (Exception)
        {
            ancestros = new List<string>();
        }
        lock (_lockCache) _cacheAncestros[instancia] = ancestros;
        return ancestros;
    }

    private static List<string> LetrasDeDisco(ManagementObject disco)
    {
        var letras = new List<string>();
        try
        {
            foreach (ManagementObject particion in disco.GetRelated("Win32_DiskPartition"))
            {
                foreach (ManagementObject logico in particion.GetRelated("Win32_LogicalDisk"))
                {
                    var deviceId = Texto(logico, "DeviceID");
                    if (!string.IsNullOrEmpty(deviceId)) letras.Add(deviceId.ToUpperInvariant());
                }
            }
        }
        catch (Exception exc)
        {
            Log.Debug($"Letras del disco no resueltas: {exc.Message}");
        }
        return letras;
    }

    /// <summary>Foto actual de los dispositivos vigilables, por clave.</summary>
    public Dictionary<string, Dispositivo> Enumerar()
    {
        var encontrados = new Dictionary<string, Dispositivo>();

        // Discos
        try
        {
            using var buscador = new ManagementObjectSearcher("SELECT * FROM Win32_DiskDrive");
            foreach (ManagementObject disco in buscador.Get())
            {
                var instancia = Texto(disco, "PNPDeviceID") ?? "";
                if (instancia.Length == 0) continue;
                var ancestros = new List<string>();
                if (instancia.ToUpperInvariant().StartsWith("SCSI\\"))
                {
                    // Solo las carcasas SCSI necesitan mirar al padre.
                    ancestros = AncestrosDe(instancia);
                }
                var modelo = Texto(disco, "Model") ?? "";
                var tipo = ClasificarDisco(instancia, ancestros, modelo);
                if (tipo is null) continue;
                var serial = LimpiarSerial(Texto(disco, "SerialNumber"));
                if (serial.Length == 0) serial = SerialDesdeInstancia(instancia);
                long tamano = 0;
                try { tamano = Convert.ToInt64(disco["Size"] ?? 0); } catch { /* sin tamaño */ }
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = serial,
                    Nombre = (modelo.Length > 0 ? modelo : "Disco USB").Trim(),
                    Tipo = tipo,
                    Letras = LetrasDeDisco(disco),
                    Tamano = tamano,
                };
                encontrados[disp.Clave] = disp;
            }
        }
        catch (Exception exc)
        {
            Log.Advertencia($"Enumerando discos: {exc.Message}");
        }

        // Ópticas USB
        try
        {
            using var buscador = new ManagementObjectSearcher("SELECT * FROM Win32_CDROMDrive");
            foreach (ManagementObject cd in buscador.Get())
            {
                var instancia = Texto(cd, "PNPDeviceID") ?? "";
                var caption = Texto(cd, "Caption") ?? "";
                if (!EsOpticoUsb(instancia, caption)) continue;
                var letra = Texto(cd, "Drive");
                var serial = LimpiarSerial(Texto(cd, "SerialNumber"));
                if (serial.Length == 0) serial = SerialDesdeInstancia(instancia);
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = serial,
                    Nombre = (caption.Length > 0 ? caption : "Unidad óptica USB").Trim(),
                    Tipo = TipoDispositivo.Optico,
                    Letras = string.IsNullOrEmpty(letra)
                        ? new List<string>()
                        : new List<string> { letra.ToUpperInvariant() },
                };
                encontrados[disp.Clave] = disp;
            }
        }
        catch (Exception exc)
        {
            Log.Debug($"Enumerando ópticas: {exc.Message}");
        }

        // Teléfonos (WPD/MTP)
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT * FROM Win32_PnPEntity WHERE PNPClass = 'WPD'");
            foreach (ManagementObject entidad in buscador.Get())
            {
                var instancia = Texto(entidad, "PNPDeviceID") ?? "";
                if (instancia.Length == 0) continue;
                var nombre = Texto(entidad, "Name") ?? "";
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = SerialDesdeInstancia(instancia),
                    Nombre = (nombre.Length > 0 ? nombre : "Teléfono").Trim(),
                    Tipo = TipoDispositivo.Telefono,
                };
                encontrados[disp.Clave] = disp;
            }
        }
        catch (Exception exc)
        {
            Log.Debug($"Enumerando WPD: {exc.Message}");
        }

        // Red por USB (tethering, docks)
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE");
            foreach (ManagementObject adaptador in buscador.Get())
            {
                var instancia = Texto(adaptador, "PNPDeviceID") ?? "";
                if (!instancia.ToUpperInvariant().StartsWith("USB\\")) continue;
                var nombre = Texto(adaptador, "Name") ?? "";
                var serial = LimpiarSerial(Texto(adaptador, "MACAddress"));
                if (serial.Length == 0) serial = SerialDesdeInstancia(instancia);
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = serial,
                    Nombre = (nombre.Length > 0 ? nombre : "Red USB").Trim(),
                    Tipo = TipoDispositivo.Red,
                };
                encontrados[disp.Clave] = disp;
            }
        }
        catch (Exception exc)
        {
            Log.Debug($"Enumerando red USB: {exc.Message}");
        }

        return encontrados;
    }

    /// <summary>Formato de /api/usb-event/connected-status: solo con letra.</summary>
    public static List<UnidadConectada> UnidadesParaEstado(IEnumerable<Dispositivo> dispositivos)
    {
        var unidades = new List<UnidadConectada>();
        foreach (var disp in dispositivos)
        {
            foreach (var letra in disp.Letras)
            {
                unidades.Add(new UnidadConectada
                {
                    DriveLetter = letra,
                    VolumeName = disp.Nombre,
                    SerialNumber = disp.Serial,
                    Model = disp.Nombre,
                    Size = disp.Tamano,
                });
            }
        }
        return unidades;
    }
}
