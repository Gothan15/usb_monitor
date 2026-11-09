using System.Security.Cryptography;
using System.Text;

namespace USBMonitor.Agente.Core;

/// <summary>
/// La identidad del equipo tras el overhaul de credenciales de
/// 2026-11-08: un par de claves ECDSA P-256 que NACE en esta PC.
///
/// La clave privada se guarda en server.json cifrada con DPAPI
/// (como iba el antiguo token) y nunca sale de la máquina; el
/// panel solo conoce la pública. Cada petición se firma con la
/// cadena canónica
///
///   METODO \n RUTA+QUERY \n MARCA \n NONCE \n SHA256(CUERPO)
///
/// que es EXACTAMENTE la que el panel reconstruye para verificar
/// (lib/agentAuth.ts): cualquier letra distinta y la firma no
/// vale, así que estos dos lados se cambian juntos o no se tocan.
/// </summary>
public sealed class IdentidadAgente : IDisposable
{
    private static readonly Registrador Log = Registro.Obtener("identidad");

    private readonly ECDsa _clave;
    private readonly object _cerrojoFirma = new();

    private IdentidadAgente(ECDsa clave)
    {
        _clave = clave;
        ClavePublicaB64 = Convert.ToBase64String(clave.ExportSubjectPublicKeyInfo());
        Huella = Convert.ToHexString(
            SHA256.HashData(Convert.FromBase64String(ClavePublicaB64))).ToLowerInvariant();
    }

    /// <summary>La clave pública (SPKI en base64): lo único que conoce el panel.</summary>
    public string ClavePublicaB64 { get; }

    /// <summary>SHA-256 de la pública: la huella que enseña el panel.</summary>
    public string Huella { get; }

    /// <summary>
    /// La identidad de esta PC: la que ya guarda server.json o una
    /// recién nacida (que se guarda en el acto). Null si no se
    /// pudo ni leer ni crear: sin identidad no hay conversación.
    /// </summary>
    public static IdentidadAgente? ObtenerOCrear(Configuracion config)
    {
        try
        {
            var guardada = config.LeerClavePrivadaPkcs8B64();
            if (!string.IsNullOrWhiteSpace(guardada))
            {
                var ecdsa = ECDsa.Create();
                ecdsa.ImportPkcs8PrivateKey(Convert.FromBase64String(guardada), out _);
                return new IdentidadAgente(ecdsa);
            }
        }
        catch (Exception exc)
        {
            Log.Error($"La clave privada guardada no se pudo abrir: {exc.Message}");
            return null;
        }

        try
        {
            var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var identidad = new IdentidadAgente(ecdsa);
            var pkcs8B64 = Convert.ToBase64String(ecdsa.ExportPkcs8PrivateKey());
            if (!config.GuardarClavePrivadaPkcs8B64(pkcs8B64))
            {
                Log.Error("No se pudo guardar la clave privada recién creada.");
                identidad.Dispose();
                return null;
            }
            Log.Info($"Identidad nueva creada para este equipo (huella {identidad.Huella[..12]}…).");
            return identidad;
        }
        catch (Exception exc)
        {
            Log.Error($"No se pudo crear la identidad del equipo: {exc.Message}");
            return null;
        }
    }

    /// <summary>La cadena exacta que se firma y que el panel verifica.</summary>
    public static string CadenaCanonica(
        string metodo, string rutaConQuery, string marca, string nonce,
        ReadOnlySpan<byte> cuerpo)
    {
        var hashCuerpo = Convert.ToHexString(SHA256.HashData(cuerpo)).ToLowerInvariant();
        return string.Join("\n",
            metodo.ToUpperInvariant(), rutaConQuery, marca, nonce, hashCuerpo);
    }

    /// <summary>Un nonce nuevo: 16 bytes aleatorios en hexadecimal.</summary>
    public static string NuevoNonce() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    /// <summary>Firma la petición: devuelve la firma en base64url (formato P1363).</summary>
    public string Firmar(
        string metodo, string rutaConQuery, string marca, string nonce,
        ReadOnlySpan<byte> cuerpo)
    {
        var canonica = CadenaCanonica(metodo, rutaConQuery, marca, nonce, cuerpo);
        byte[] firma;
        // ECDsa no admite firmas simultáneas sobre la misma instancia.
        lock (_cerrojoFirma)
        {
            firma = _clave.SignData(
                Encoding.UTF8.GetBytes(canonica),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        return Convert.ToBase64String(firma)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    public void Dispose() => _clave.Dispose();
}
