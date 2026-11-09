// -*- coding: utf-8 -*-
// Detección y clasificación de dispositivos (WMI). Espejo de
// nucleo/dispositivos.py.
//
// Tipos: DISCO (memorias, carcasas USBSTOR y carcasas UAS: disco SCSI
// con ancestro USB — un SATA interno también es SCSI y jamás debe
// clasificar), TELEFONO (WPD/MTP, sin letra, por serial), OPTICO
// (unidades de CD/DVD USB físicas), RED (adaptadores USB; el servicio
// aplica la regla de línea base sobre ellos) e IMPRESORA (impresoras
// USB: solo se detectan y se reportan, nunca se bloquean).
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
    public const string Impresora = "IMPRESORA";
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

    /// <summary>
    /// Etiqueta de volumen por letra (lo que Windows muestra en
    /// el Explorador: «KINGSTON», «TRABAJO»…). El modelo WMI del
    /// disco no sirve como nombre visible: en muchas memorias es
    /// genérico («Generic Flash Disk USB Device») y el panel y
    /// los eventos enseñaban ese texto en vez del nombre real.
    /// </summary>
    public Dictionary<string, string> Etiquetas { get; init; } = new();

    /// <summary>Etiqueta de la primera letra con volumen, si hay.</summary>
    public string? EtiquetaVolumen =>
        Letras.Count > 0 &&
        Etiquetas.TryGetValue(Letras[0], out var etiqueta) &&
        !string.IsNullOrWhiteSpace(etiqueta)
            ? etiqueta
            : null;

    /// <summary>Nombre para enseñar: la etiqueta si existe; si no, el modelo.</summary>
    public string NombreVisible => EtiquetaVolumen ?? Nombre;

    /// <summary>Nombre para enseñar de una letra concreta.</summary>
    public string EtiquetaDe(string letra) =>
        Etiquetas.TryGetValue(letra, out var etiqueta) &&
        !string.IsNullOrWhiteSpace(etiqueta)
            ? etiqueta
            : Nombre;

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

    /// <summary>
    /// Impresora tras el bus USB: su nodo es USBPRINT\… (el
    /// dispositivo de impresión) o el propio nodo USB\… de clase
    /// impresora. Las virtuales (PDF, XPS) no cuelgan de USB y
    /// quedan fuera por el prefijo.
    /// </summary>
    public static bool EsImpresoraUsb(string? instancia)
    {
        var superior = (instancia ?? "").ToUpperInvariant();
        return superior.StartsWith("USBPRINT\\") || superior.StartsWith("USB\\");
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

    private static List<(string Letra, string Etiqueta)> LetrasDeDisco(ManagementObject disco)
    {
        var letras = new List<(string, string)>();
        try
        {
            foreach (ManagementObject particion in disco.GetRelated("Win32_DiskPartition"))
            {
                foreach (ManagementObject logico in particion.GetRelated("Win32_LogicalDisk"))
                {
                    var deviceId = Texto(logico, "DeviceID");
                    if (string.IsNullOrEmpty(deviceId)) continue;
                    var etiqueta = (Texto(logico, "VolumeName") ?? "").Trim();
                    letras.Add((deviceId.ToUpperInvariant(), etiqueta));
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
                var letras = LetrasDeDisco(disco);
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = serial,
                    Nombre = (modelo.Length > 0 ? modelo : "Disco USB").Trim(),
                    Tipo = tipo,
                    Letras = letras.Select(l => l.Letra).ToList(),
                    Etiquetas = letras
                        .Where(l => l.Etiqueta.Length > 0)
                        .ToDictionary(l => l.Letra, l => l.Etiqueta),
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
                if (!EstaPresente(entidad)) continue;
                // Solo dispositivos WPD tras un bus USB (regla del
                // agente Python): sin este filtro, los volúmenes de
                // almacenamiento (STORAGE\Volume\{guid}#...) entran
                // como «teléfonos» fantasma con un GUID por serial
                // cuando una memoria consigue montar su volumen.
                if (!instancia.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase)) continue;
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

        // Impresoras USB (solo detección: nunca se bloquean)
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT * FROM Win32_PnPEntity WHERE PNPClass = 'Printer'");
            foreach (ManagementObject entidad in buscador.Get())
            {
                var instancia = Texto(entidad, "PNPDeviceID") ?? "";
                if (!EstaPresente(entidad)) continue;
                if (!EsImpresoraUsb(instancia)) continue;
                var nombre = Texto(entidad, "Name") ?? "";
                var disp = new Dispositivo
                {
                    InstanciaPnP = instancia,
                    Serial = SerialDesdeInstancia(instancia),
                    Nombre = (nombre.Length > 0 ? nombre : "Impresora USB").Trim(),
                    Tipo = TipoDispositivo.Impresora,
                };
                encontrados[disp.Clave] = disp;
            }
        }
        catch (Exception exc)
        {
            Log.Debug($"Enumerando impresoras: {exc.Message}");
        }

        // Red por USB (tethering, docks)
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE");
            foreach (ManagementObject adaptador in buscador.Get())
            {
                var instancia = Texto(adaptador, "PNPDeviceID") ?? "";
                if (!EstaPresente(adaptador)) continue;
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

    /// <summary>
    /// ¿El dispositivo está enchufado AHORA? Win32_PnPEntity y
    /// Win32_NetworkAdapter enumeran también los dispositivos
    /// FANTASMA: nodos que Windows recuerda de conexiones pasadas
    /// (código de error 45, «no conectado a este equipo»). Sin
    /// este filtro, un teléfono, una impresora o un adaptador de
    /// red USB seguían en la enumeración para siempre tras
    /// desenchufarlos: el agente los reportaba como conectados
    /// en cada latido y en el panel nunca desaparecían.
    /// Presente = cualquier código que no sea 45; el 22
    /// (deshabilitado) sigue contando como presente, que es como
    /// se ven los discos bloqueados por PnP en Win32_DiskDrive.
    /// Si el código no se puede leer, se asume presente.
    /// </summary>
    private static bool EstaPresente(ManagementObject entidad)
    {
        try
        {
            var codigo = entidad["ConfigManagerErrorCode"];
            return codigo is null || Convert.ToUInt32(codigo) != 45;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// Formato de /api/usb-event/connected-status: una entrada por
    /// letra y, para lo que no tiene letra, una por dispositivo.
    /// Cada entrada lleva su deviceKind: sin él, un adaptador de
    /// red o una impresora se veían en el panel como si fueran
    /// memorias.
    /// </summary>
    public static List<UnidadConectada> UnidadesParaEstado(IEnumerable<Dispositivo> dispositivos)
    {
        var unidades = new List<UnidadConectada>();
        foreach (var disp in dispositivos)
        {
            if (disp.Letras.Count == 0)
            {
                // Sin letra (bloqueado por PnP, teléfono WPD…): el
                // dispositivo ESTÁ conectado y tiene que verse en
                // el panel. Antes solo se reportaban las letras y
                // el panel nunca lo veía (o lo daba por
                // desconectado): una memoria bloqueada desaparecía
                // de «Dispositivos USB» de su equipo.
                unidades.Add(new UnidadConectada
                {
                    DriveLetter = null,
                    VolumeName = disp.NombreVisible,
                    SerialNumber = disp.Serial,
                    Model = disp.Nombre,
                    Size = disp.Tamano,
                    DeviceKind = disp.Tipo,
                });
                continue;
            }
            foreach (var letra in disp.Letras)
            {
                unidades.Add(new UnidadConectada
                {
                    DriveLetter = letra,
                    VolumeName = disp.EtiquetaDe(letra),
                    SerialNumber = disp.Serial,
                    Model = disp.Nombre,
                    Size = disp.Tamano,
                    DeviceKind = disp.Tipo,
                });
            }
        }
        return unidades;
    }
}
