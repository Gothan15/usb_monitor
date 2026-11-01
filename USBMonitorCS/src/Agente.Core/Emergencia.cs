// -*- coding: utf-8 -*-
// Emergencia sin red: desbloqueo local con la contraseña del
// dueño, espejo de USBMonitor/nucleo/emergencia.py. El panel
// entrega el hash Argon2id del dueño (/api/agent/owner-hash); el
// agente lo guarda en dueno.json (mismo archivo que el Python) y,
// sin red, verifica la contraseña localmente contra ese hash.
// Solo el dueño: un administrador no tiene hash local.
//
// Intentos: máximo 5 por dispositivo; al quinto fallo, 15 minutos
// de espera. El contador se persiste (reiniciar el servicio no lo
// resetea). Cada intento queda pendiente de subir al panel.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Konscious.Security.Cryptography;

namespace USBMonitor.Agente.Core;

/// <summary>Hash del dueño guardado para la emergencia sin red.</summary>
public sealed class DuenoGuardado
{
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("passwordHash")] public string PasswordHash { get; set; } = "";
    [JsonPropertyName("actualizado")] public string? Actualizado { get; set; }
}

internal sealed class EntradaEstadoEmergencia
{
    [JsonPropertyName("fallos")] public int Fallos { get; set; }
    [JsonPropertyName("hasta")] public string? Hasta { get; set; }
}

/// <summary>Resultado de verificar una contraseña de emergencia.</summary>
/// <param name="Autorizado">La contraseña es la del dueño.</param>
/// <param name="Motivo">"ok", "credenciales", "sin_hash" o "espera".</param>
public sealed record ResultadoVerificacion(bool Autorizado, string Motivo);

/// <summary>Verificación sin red contra el hash Argon2id del dueño.</summary>
public sealed class Emergencia
{
    public const int MaxIntentos = 5;
    public const int EsperaMinutos = 15;

    private readonly string _archivoDueno;
    private readonly string _archivoEstado;
    private readonly string _archivoIntentos;
    private readonly object _cerrojo = new();

    public Emergencia(string? directorioDatos = null)
    {
        var datos = directorioDatos ?? Registro.DirectorioDatos;
        _archivoDueno = Path.Combine(datos, "dueno.json");
        _archivoEstado = Path.Combine(datos, "emergencia_estado.json");
        _archivoIntentos = Path.Combine(datos, "intentos_pendientes.json");
    }

    // ── hash del dueño ───────────────────────────────────────────

    public void GuardarHash(string username, string passwordHash)
    {
        lock (_cerrojo)
        {
            ArchivoJson.EscribirAtomico(_archivoDueno, new DuenoGuardado
            {
                Username = username,
                PasswordHash = passwordHash,
                Actualizado = Ahora(),
            });
        }
    }

    public DuenoGuardado? Dueno()
    {
        var datos = ArchivoJson.Leer<DuenoGuardado>(_archivoDueno);
        return datos is { PasswordHash.Length: > 0 } ? datos : null;
    }

    // ── verificación ─────────────────────────────────────────────

    /// <summary>Verifica y registra el intento para subirlo al panel.</summary>
    public ResultadoVerificacion Verificar(
        string claveDispositivo,
        string username,
        string password,
        string? letra = null,
        string? serial = null)
    {
        var dueno = Dueno();
        if (dueno is null)
            return new ResultadoVerificacion(false, "sin_hash");

        bool autorizado;
        lock (_cerrojo)
        {
            var estados = LeerEstados();
            estados.TryGetValue(claveDispositivo, out var entrada);
            entrada ??= new EntradaEstadoEmergencia();
            if (entrada.Hasta is not null &&
                DateTime.TryParse(entrada.Hasta, CultureInfo.InvariantCulture,
                    DateTimeStyles.AllowWhiteSpaces, out var hasta) &&
                hasta > DateTime.Now)
            {
                return new ResultadoVerificacion(false, "espera");
            }

            autorizado = false;
            if (string.Equals(
                    username.Trim(), dueno.Username.Trim(),
                    StringComparison.OrdinalIgnoreCase))
            {
                autorizado = VerificarArgon2id(dueno.PasswordHash, password);
            }

            if (autorizado)
            {
                estados.Remove(claveDispositivo);
            }
            else
            {
                var fallos = entrada.Fallos + 1;
                if (fallos >= MaxIntentos)
                {
                    estados[claveDispositivo] = new EntradaEstadoEmergencia
                    {
                        Fallos = 0,
                        Hasta = DateTime.Now.AddMinutes(EsperaMinutos)
                            .ToString("yyyy-MM-ddTHH:mm:ss"),
                    };
                }
                else
                {
                    estados[claveDispositivo] = new EntradaEstadoEmergencia
                    {
                        Fallos = fallos,
                        Hasta = null,
                    };
                }
            }
            ArchivoJson.EscribirAtomico(_archivoEstado, estados);
        }

        AnotarIntento(username, autorizado, letra, serial);
        return new ResultadoVerificacion(autorizado, autorizado ? "ok" : "credenciales");
    }

    /// <summary>
    /// Verifica una contraseña contra un hash PHC Argon2id
    /// ($argon2id$v=19$m=…,t=…,p=…$sal$hash) con los parámetros del
    /// propio PHC. Cualquier formato raro devuelve false.
    /// </summary>
    public static bool VerificarArgon2id(string hashPhc, string password)
    {
        try
        {
            var partes = hashPhc.Split('$');
            // ["", "argon2id", "v=19", "m=..,t=..,p=..", sal, hash]
            if (partes.Length != 6 || partes[1] != "argon2id")
                return false;
            var parametros = partes[3].Split(',')
                .Select(p => p.Split('='))
                .Where(p => p.Length == 2)
                .ToDictionary(p => p[0], p => int.Parse(p[1], CultureInfo.InvariantCulture));
            var sal = DecodificarBase64Phc(partes[4]);
            var esperado = DecodificarBase64Phc(partes[5]);
            using var argon = new Argon2id(Encoding.UTF8.GetBytes(password))
            {
                Salt = sal,
                MemorySize = parametros["m"],
                Iterations = parametros["t"],
                DegreeOfParallelism = parametros["p"],
            };
            var calculado = argon.GetBytes(esperado.Length);
            return CryptographicOperations.FixedTimeEquals(calculado, esperado);
        }
        catch
        {
            return false;
        }
    }

    // El PHC usa base64 estándar sin relleno.
    private static byte[] DecodificarBase64Phc(string texto)
    {
        var resto = texto.Length % 4;
        if (resto > 0)
            texto += new string('=', 4 - resto);
        return Convert.FromBase64String(texto);
    }

    // ── intentos pendientes de subir ─────────────────────────────

    private void AnotarIntento(string username, bool autorizado, string? letra, string? serial)
    {
        var intento = new IntentoOffline
        {
            UsernameTried = username,
            Result = autorizado ? "OFFLINE_OK" : "OFFLINE_FAIL",
            DriveLetter = letra,
            SerialNumber = serial,
            CreatedAt = Ahora(),
        };
        lock (_cerrojo)
        {
            var intentos = IntentosPendientesSinCerrojo();
            intentos.Add(intento);
            if (intentos.Count > 500)
                intentos = intentos[^500..];
            ArchivoJson.EscribirAtomico(_archivoIntentos, intentos);
        }
    }

    public List<IntentoOffline> IntentosPendientes()
    {
        lock (_cerrojo)
        {
            return IntentosPendientesSinCerrojo();
        }
    }

    private List<IntentoOffline> IntentosPendientesSinCerrojo() =>
        ArchivoJson.Leer<List<IntentoOffline>>(_archivoIntentos) ?? new List<IntentoOffline>();

    public void LimpiarIntentos()
    {
        lock (_cerrojo)
        {
            ArchivoJson.EscribirAtomico(_archivoIntentos, new List<IntentoOffline>());
        }
    }

    // ── estado de intentos por dispositivo ───────────────────────

    private Dictionary<string, EntradaEstadoEmergencia> LeerEstados() =>
        ArchivoJson.Leer<Dictionary<string, EntradaEstadoEmergencia>>(_archivoEstado)
        ?? new Dictionary<string, EntradaEstadoEmergencia>();

    private static string Ahora() => DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss");
}
