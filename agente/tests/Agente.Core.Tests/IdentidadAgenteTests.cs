// -*- coding: utf-8 -*-
// Pruebas de la identidad por clave: la cadena canónica que se
// firma (idéntica a la que el panel reconstruye), el viaje de
// ida y vuelta de la firma contra la clave pública, y que la
// identidad persiste entre arranques.
using System.Security.Cryptography;
using System.Text;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class IdentidadAgenteTests
{
    private static Configuracion ConfigNueva()
    {
        var app = Fabrica.DirectorioTemporal();
        var datos = Fabrica.DirectorioTemporal();
        File.WriteAllText(Path.Combine(app, "server.json"), """{"serverHost":"panel.local"}""");
        return new Configuracion(app, datos);
    }

    [Fact]
    public void CadenaCanonica_FormatoExacto()
    {
        // El hash es el SHA-256 de "{}" en hexadecimal minúscula y
        // el método se normaliza a mayúsculas: esta cadena es el
        // contrato con lib/agentAuth.ts del panel.
        var cadena = IdentidadAgente.CadenaCanonica(
            "post", "/api/agent/ping?x=1", "1700000000", "abc123",
            Encoding.UTF8.GetBytes("{}"));
        Assert.Equal(
            "POST\n/api/agent/ping?x=1\n1700000000\nabc123\n" +
            "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
            cadena);
    }

    [Fact]
    public void CadenaCanonica_CuerpoVacio()
    {
        var cadena = IdentidadAgente.CadenaCanonica(
            "GET", "/api/agent/config", "1", "n", Array.Empty<byte>());
        Assert.EndsWith(
            "\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            cadena);
    }

    [Fact]
    public void FirmarYVerificar_ContraLaClavePublica()
    {
        var config = ConfigNueva();
        using var identidad = IdentidadAgente.ObtenerOCrear(config);
        Assert.NotNull(identidad);

        var cuerpo = Encoding.UTF8.GetBytes("""{"pcName":"PC-1"}""");
        var firma = identidad!.Firmar("POST", "/api/usb-event", "1700000000", "nonce-1", cuerpo);

        // Base64url: sin +, / ni relleno.
        Assert.DoesNotContain("+", firma);
        Assert.DoesNotContain("/", firma);
        Assert.DoesNotContain("=", firma);

        // Verificación con una ECDsa que SOLO tiene la pública
        // (lo que hace el panel con la suya registrada).
        using var publica = ECDsa.Create();
        publica.ImportSubjectPublicKeyInfo(Convert.FromBase64String(identidad.ClavePublicaB64), out _);
        var canonica = IdentidadAgente.CadenaCanonica(
            "POST", "/api/usb-event", "1700000000", "nonce-1", cuerpo);
        var firmaBytes = Convert.FromBase64String(
            firma.Replace('-', '+').Replace('_', '/')
                 .PadRight(firma.Length + (4 - firma.Length % 4) % 4, '='));
        Assert.True(publica.VerifyData(
            Encoding.UTF8.GetBytes(canonica), firmaBytes,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

        // Con otro cuerpo, la misma firma ya no vale.
        var otroCuerpo = Encoding.UTF8.GetBytes("""{"pcName":"PC-2"}""");
        var otraCanonica = IdentidadAgente.CadenaCanonica(
            "POST", "/api/usb-event", "1700000000", "nonce-1", otroCuerpo);
        Assert.False(publica.VerifyData(
            Encoding.UTF8.GetBytes(otraCanonica), firmaBytes,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Fact]
    public void LaIdentidad_PersisteEntreArranques()
    {
        var config = ConfigNueva();
        string huella;
        using (var primera = IdentidadAgente.ObtenerOCrear(config))
        {
            Assert.NotNull(primera);
            huella = primera!.Huella;
        }
        Assert.True(config.TieneClave);

        using var segunda = IdentidadAgente.ObtenerOCrear(config);
        Assert.NotNull(segunda);
        Assert.Equal(huella, segunda!.Huella);

        // La huella es el SHA-256 de la pública (SPKI), como en el panel.
        var esperada = Convert.ToHexString(
            SHA256.HashData(Convert.FromBase64String(segunda.ClavePublicaB64)))
            .ToLowerInvariant();
        Assert.Equal(esperada, segunda.Huella);
    }
}
