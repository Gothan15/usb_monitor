// -*- coding: utf-8 -*-
// DTOs del contrato con el panel (ver CONTRATO-SERVIDOR.md).
// Nombres de campo exactos: snake_case en /api/usb-event y
// camelCase en el resto, tal como los espera el servidor.
using System.Text.Json;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>Evento para POST /api/usb-event (cuerpo snake_case).</summary>
public sealed class EventoUsb
{
    [JsonPropertyName("pc_name")] public string PcName { get; set; } = "";
    [JsonPropertyName("pc_ip")] public string PcIp { get; set; } = "";
    [JsonPropertyName("pc_user")] public string PcUser { get; set; } = "";
    [JsonPropertyName("event")] public string Tipo { get; set; } = "";
    [JsonPropertyName("drive_letter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; set; }
    [JsonPropertyName("readonly_status")] public string? ReadonlyStatus { get; set; }

    // Python solo incluye la clave cuando hay valor: se omite si es null.
    [JsonPropertyName("whitelisted")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Whitelisted { get; set; }
}

/// <summary>Unidad conectada de POST /api/usb-event/connected-status.</summary>
public sealed class UnidadConectada
{
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("volumeName")] public string? VolumeName { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
    [JsonPropertyName("model")] public string? Model { get; set; }
    [JsonPropertyName("size")] public long? Size { get; set; }
}

/// <summary>Bloqueo pendiente de ejecución de GET /api/usb-unlock/status.</summary>
public sealed class PendienteDesbloqueo
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
}

/// <summary>Respuesta de GET /api/usb-unlock/status.</summary>
internal sealed class RespuestaSondeo
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("unlocked")] public bool Unlocked { get; set; }
    [JsonPropertyName("pendings")] public List<PendienteDesbloqueo>? Pendings { get; set; }
}

/// <summary>Respuesta de POST /api/usb-event/pending-unlock.</summary>
internal sealed class RespuestaRegistroBloqueo
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("id")] public string? Id { get; set; }
}

/// <summary>Respuesta genérica {ok} de varias rutas del agente.</summary>
internal sealed class RespuestaBasica
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
}

/// <summary>Respuesta de GET /api/whitelist/check.</summary>
internal sealed class RespuestaWhitelist
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("allowed")] public bool Allowed { get; set; }
    [JsonPropertyName("entry")] public JsonElement? Entry { get; set; }
}

/// <summary>Ajustes que el agente obedece, de GET /api/agent/config.</summary>
public sealed class ConfigRemota
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("startupNetworkDelay")] public int? StartupNetworkDelay { get; set; }
    [JsonPropertyName("lockSessionOnInsert")] public bool LockSessionOnInsert { get; set; }
}

/// <summary>Respuesta de GET /api/agent/owner-hash.</summary>
public sealed class HashDuenoRespuesta
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("passwordHash")] public string? PasswordHash { get; set; }
}

/// <summary>Respuesta cruda de POST /api/usb-auth.</summary>
internal sealed class RespuestaAuth
{
    [JsonPropertyName("authorized")] public bool Authorized { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

/// <summary>Resultado de autenticar un desbloqueo contra el servidor.</summary>
/// <param name="EstadoHttp">Código HTTP (0 = sin respuesta).</param>
/// <param name="Autorizado">El servidor autorizó el desbloqueo.</param>
/// <param name="Mensaje">Mensaje del servidor (403) o descripción local.</param>
public sealed record ResultadoAutenticacion(int EstadoHttp, bool Autorizado, string Mensaje);

/// <summary>Respuesta de GET /api/agent/ping.</summary>
public sealed class RespuestaPing
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("serverTime")] public string? ServerTime { get; set; }
    [JsonPropertyName("pc")] public string? Pc { get; set; }
}

/// <summary>Intento de desbloqueo sin red, para POST /api/agent/offline-attempts.</summary>
public sealed class IntentoOffline
{
    [JsonPropertyName("usernameTried")] public string UsernameTried { get; set; } = "";
    [JsonPropertyName("result")] public string Result { get; set; } = "";
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
}

/// <summary>Un paso del diagnóstico «Probar conexión».</summary>
public sealed record PasoPruebaConexion(string Paso, bool Ok, string Detalle, double Ms);

/// <summary>Última llamada registrada por el cliente del panel.</summary>
public sealed class UltimaLlamadaInfo
{
    public string Metodo { get; set; } = "";
    public string Ruta { get; set; } = "";
    public bool Ok { get; set; }
    public string Detalle { get; set; } = "";
    public double Ms { get; set; }
    public string? Cuando { get; set; }
}

/// <summary>Foto de la conexión con el panel (espejo de ClientePanel.salud() en Python).</summary>
public sealed class SaludConexion
{
    public string UrlBase { get; set; } = "";
    public string Pc { get; set; } = "";
    public int Ok { get; set; }
    public int Fallos { get; set; }
    public string? UltimoExito { get; set; }
    public string? UltimoFallo { get; set; }
    public string DetalleUltimoExito { get; set; } = "";
    public string DetalleUltimoFallo { get; set; } = "";
    public UltimaLlamadaInfo UltimaLlamada { get; set; } = new();
}

// ── Cuerpos de petición ─────────────────────────────────────────

internal sealed class SolicitudBloqueo
{
    [JsonPropertyName("pcName")] public string PcName { get; set; } = "";
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
    [JsonPropertyName("deviceLabel")] public string? DeviceLabel { get; set; }
    [JsonPropertyName("whitelisted")] public bool Whitelisted { get; set; }
}

internal sealed class SolicitudCierre
{
    [JsonPropertyName("pcName")] public string PcName { get; set; } = "";
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
}

internal sealed class SolicitudEstadoConectados
{
    [JsonPropertyName("pcName")] public string PcName { get; set; } = "";
    [JsonPropertyName("connectedDrives")] public List<UnidadConectada> ConnectedDrives { get; set; } = new();
}

internal sealed class SolicitudAuth
{
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("password")] public string Password { get; set; } = "";
    [JsonPropertyName("pcName")] public string PcName { get; set; } = "";
    [JsonPropertyName("driveLetter")] public string? DriveLetter { get; set; }
    [JsonPropertyName("serialNumber")] public string? SerialNumber { get; set; }
}

internal sealed class SolicitudIntentos
{
    [JsonPropertyName("pcName")] public string PcName { get; set; } = "";
    [JsonPropertyName("attempts")] public List<IntentoOffline> Attempts { get; set; } = new();
}
