// -*- coding: utf-8 -*-
// Cifrado de valores de server.json.
//
// Compatibilidad con el agente Python:
//  - Lectura de valores "ENC:" con Fernet idéntico al de la v1/v2
//    (clave = PBKDF2-HMAC-SHA256 del identificador de la máquina,
//    sal "USBMonitor_Salt_V1", 100 000 iteraciones; Fernet =
//    AES-128-CBC + HMAC-SHA256, token base64url con versión 0x80,
//    timestamp de 8 bytes e IV de 16).
//  - Escritura nueva con DPAPI (ámbito máquina) y prefijo "DPAPI:".
// Fail-closed en todo: un valor ilegible se descarta (""), jamás se
// usa como credencial.
using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace USBMonitor.Agente.Core;

/// <summary>Cifra y descifra valores sueltos (p. ej. el token del agente).</summary>
public interface ICifradorValores
{
    /// <summary>Descifra un valor con prefijo; el texto plano pasa tal cual. "" si no se puede abrir.</summary>
    string Descifrar(string valor);
    /// <summary>Cifra un valor y lo devuelve con su prefijo.</summary>
    string Cifrar(string valor);
}

/// <summary>Identificador estable de la máquina (material de la clave Fernet).</summary>
internal static class IdentificadorMaquina
{
    public static byte[] ObtenerMaterial()
    {
        if (OperatingSystem.IsWindows())
        {
            var uuid = IntentarUuidSmbios();
            if (!string.IsNullOrEmpty(uuid))
                return Encoding.UTF8.GetBytes(uuid);
        }
        var respaldo = $"{Environment.MachineName}-{Environment.GetEnvironmentVariable("COMPUTERNAME") ?? "UNKNOWN"}";
        return Encoding.UTF8.GetBytes(respaldo);
    }

    // El UUID de Win32_ComputerSystemProduct sale de la tabla SMBIOS
    // (tipo 1, bytes 8..23), formateado como lo muestra WMI.
    private static string? IntentarUuidSmbios()
    {
        try
        {
            const uint firmaRsmb = 0x52534D42; // 'RSMB'
            var tamano = GetSystemFirmwareTable(firmaRsmb, 0, IntPtr.Zero, 0);
            if (tamano == 0)
                return null;
            var bufer = Marshal.AllocHGlobal((int)tamano);
            try
            {
                if (GetSystemFirmwareTable(firmaRsmb, 0, bufer, tamano) == 0)
                    return null;
                var datos = new byte[tamano];
                Marshal.Copy(bufer, datos, 0, (int)tamano);
                // RawSMBIOSData: 4 bytes de cabecera + uint de longitud.
                var longitud = BinaryPrimitives.ReadUInt32LittleEndian(datos.AsSpan(4));
                var pos = 8;
                var fin = Math.Min(datos.Length, 8 + (int)longitud);
                while (pos + 4 <= fin)
                {
                    var tipo = datos[pos];
                    var largo = datos[pos + 1];
                    if (largo < 4)
                        break;
                    if (tipo == 1 && largo >= 24)
                    {
                        var uuid = datos.AsSpan(pos + 8, 16);
                        if (uuid.ToArray().All(b => b == 0x00) || uuid.ToArray().All(b => b == 0xFF))
                            return null;
                        var d1 = BinaryPrimitives.ReadUInt32LittleEndian(uuid[..4]);
                        var d2 = BinaryPrimitives.ReadUInt16LittleEndian(uuid.Slice(4, 2));
                        var d3 = BinaryPrimitives.ReadUInt16LittleEndian(uuid.Slice(6, 2));
                        var resto = Convert.ToHexString(uuid[8..]);
                        return $"{d1:X8}-{d2:X4}-{d3:X4}-{resto[..4]}-{resto[4..]}";
                    }
                    // Saltar la estructura y su lista de cadenas (doble cero).
                    var siguiente = pos + largo;
                    while (siguiente + 1 < fin && !(datos[siguiente] == 0 && datos[siguiente + 1] == 0))
                        siguiente++;
                    pos = siguiente + 2;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(bufer);
            }
        }
        catch
        {
            // Sin SMBIOS accesible: manda el respaldo.
        }
        return null;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetSystemFirmwareTable(
        uint firmwareTableProviderSignature,
        uint firmwareTableID,
        IntPtr pFirmwareTableBuffer,
        uint bufferSize);
}

/// <summary>
/// Fernet puro (multiplataforma), bit a bit compatible con el de
/// Python: la clave son 32 bytes derivados con PBKDF2-HMAC-SHA256
/// (los 16 primeros firman, los 16 últimos cifran).
/// </summary>
public sealed class CifradorFernet : ICifradorValores
{
    private static readonly byte[] Sal = Encoding.UTF8.GetBytes("USBMonitor_Salt_V1");
    private const int Iteraciones = 100_000;

    private readonly byte[] _claveFirma;
    private readonly byte[] _claveCifrado;

    /// <param name="material">Material del identificador de máquina (en Python, el UUID o el respaldo).</param>
    public CifradorFernet(byte[] material)
    {
        var derivada = Rfc2898DeriveBytes.Pbkdf2(
            material, Sal, Iteraciones, HashAlgorithmName.SHA256, 32);
        _claveFirma = derivada[..16];
        _claveCifrado = derivada[16..];
    }

    public static CifradorFernet DesdeMaquina() => new(IdentificadorMaquina.ObtenerMaterial());

    public string Cifrar(string valor)
    {
        var iv = RandomNumberGenerator.GetBytes(16);
        byte[] cifrado;
        using (var aes = Aes.Create())
        {
            aes.Key = _claveCifrado;
            aes.IV = iv;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            using var cifrador = aes.CreateEncryptor();
            var plano = Encoding.UTF8.GetBytes(valor);
            cifrado = cifrador.TransformFinalBlock(plano, 0, plano.Length);
        }
        var cuerpo = new byte[1 + 8 + 16 + cifrado.Length];
        cuerpo[0] = 0x80;
        BinaryPrimitives.WriteInt64BigEndian(
            cuerpo.AsSpan(1, 8), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        iv.CopyTo(cuerpo.AsSpan(9, 16));
        cifrado.CopyTo(cuerpo.AsSpan(25));
        using var hmac = new HMACSHA256(_claveFirma);
        var firma = hmac.ComputeHash(cuerpo);
        var token = new byte[cuerpo.Length + firma.Length];
        cuerpo.CopyTo(token, 0);
        firma.CopyTo(token, cuerpo.Length);
        return "ENC:" + Base64UrlCodificar(token);
    }

    public string Descifrar(string valor)
    {
        if (string.IsNullOrEmpty(valor))
            return "";
        var token = valor.StartsWith("ENC:", StringComparison.Ordinal) ? valor[4..] : valor;
        try
        {
            var datos = Base64UrlDecodificar(token);
            // 1 (versión) + 8 (timestamp) + 16 (IV) + ≥16 (cifrado) + 32 (HMAC)
            if (datos.Length < 73 || datos[0] != 0x80)
                return "";
            var cuerpo = datos[..^32];
            var firma = datos[^32..];
            using (var hmac = new HMACSHA256(_claveFirma))
            {
                var esperada = hmac.ComputeHash(cuerpo);
                if (!CryptographicOperations.FixedTimeEquals(esperada, firma))
                    return "";
            }
            var iv = datos.AsSpan(9, 16).ToArray();
            var cifrado = datos.AsSpan(25, datos.Length - 57).ToArray();
            using var aes = Aes.Create();
            aes.Key = _claveCifrado;
            aes.IV = iv;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            using var descifrador = aes.CreateDecryptor();
            var plano = descifrador.TransformFinalBlock(cifrado, 0, cifrado.Length);
            return Encoding.UTF8.GetString(plano);
        }
        catch
        {
            // Fail-closed: un ENC: ilegible se descarta, nunca se usa.
            return "";
        }
    }

    internal static string Base64UrlCodificar(byte[] datos) =>
        Convert.ToBase64String(datos).Replace('+', '-').Replace('/', '_');

    internal static byte[] Base64UrlDecodificar(string texto)
    {
        var limpio = texto.Replace('-', '+').Replace('_', '/');
        var resto = limpio.Length % 4;
        if (resto > 0)
            limpio += new string('=', 4 - resto);
        return Convert.FromBase64String(limpio);
    }
}

/// <summary>
/// DPAPI (ProtectedData, ámbito máquina). Solo Windows: fuera de
/// Windows, cifrar lanza PlatformNotSupportedException y descifrar
/// un valor "DPAPI:" devuelve "" (fail-closed).
/// </summary>
public sealed class CifradorDpapi : ICifradorValores
{
    public string Cifrar(string valor)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("DPAPI solo existe en Windows.");
        var protegido = ProtectedData.Protect(
            Encoding.UTF8.GetBytes(valor), null, DataProtectionScope.LocalMachine);
        return "DPAPI:" + Convert.ToBase64String(protegido);
    }

    public string Descifrar(string valor)
    {
        if (string.IsNullOrEmpty(valor))
            return "";
        if (!valor.StartsWith("DPAPI:", StringComparison.Ordinal))
            return valor;
        if (!OperatingSystem.IsWindows())
            return "";
        try
        {
            var protegido = Convert.FromBase64String(valor[7..]);
            var plano = ProtectedData.Unprotect(protegido, null, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(plano);
        }
        catch
        {
            return "";
        }
    }
}

/// <summary>
/// Fachada que usa Configuracion: lee "ENC:" (Fernet) y "DPAPI:"
/// (DPAPI); escribe con DPAPI en Windows y con Fernet fuera de
/// Windows (el formato ENC: sigue siendo legible por ambos agentes).
/// </summary>
public static class CifradoValores
{
    private static readonly Lazy<CifradorFernet> FernetMaquina = new(CifradorFernet.DesdeMaquina);
    private static readonly CifradorDpapi Dpapi = new();

    public static string Descifrar(string valor)
    {
        if (string.IsNullOrEmpty(valor))
            return "";
        if (valor.StartsWith("ENC:", StringComparison.Ordinal))
            return FernetMaquina.Value.Descifrar(valor);
        if (valor.StartsWith("DPAPI:", StringComparison.Ordinal))
            return Dpapi.Descifrar(valor);
        return valor;
    }

    public static string Cifrar(string valor)
    {
        if (OperatingSystem.IsWindows())
            return Dpapi.Cifrar(valor);
        return FernetMaquina.Value.Cifrar(valor);
    }
}
