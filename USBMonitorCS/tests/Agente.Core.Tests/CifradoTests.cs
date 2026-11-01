// -*- coding: utf-8 -*-
// Pruebas del Fernet compatible con Python y de la fachada de cifrado.
using System.Text;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class CifradoTests
{
    private static readonly byte[] Material = Encoding.UTF8.GetBytes("11111111-2222-3333-4444-555555555555");

    [Fact]
    public void Fernet_IdaYVuelta()
    {
        var fernet = new CifradorFernet(Material);
        var token = fernet.Cifrar("token-secreto-del-equipo");
        Assert.StartsWith("ENC:", token);
        Assert.Equal("token-secreto-del-equipo", fernet.Descifrar(token));
    }

    [Fact]
    public void Fernet_VectorGenerado_EstructuraDelToken()
    {
        // Vector fijo generado en el propio test con la implementación:
        // tras el base64url va 0x80 | timestamp(8) | IV(16) | cifrado | HMAC(32).
        var fernet = new CifradorFernet(Material);
        var token = fernet.Cifrar("vector");
        var datos = DecodificarBase64Url(token[4..]);
        Assert.Equal(0x80, datos[0]);
        Assert.True(datos.Length >= 1 + 8 + 16 + 16 + 32);
        // Otra instancia con el mismo material abre el mismo vector.
        var otra = new CifradorFernet(Material);
        Assert.Equal("vector", otra.Descifrar(token));
    }

    [Fact]
    public void Fernet_TokenManipulado_FallaCerrado()
    {
        var fernet = new CifradorFernet(Material);
        var token = fernet.Cifrar("no-me-toques");
        var caracteres = token.ToCharArray();
        caracteres[15] = caracteres[15] == 'A' ? 'B' : 'A';
        var manipulado = new string(caracteres);
        Assert.Equal("", fernet.Descifrar(manipulado));
    }

    [Fact]
    public void Fernet_MaterialDistinto_FallaCerrado()
    {
        var token = new CifradorFernet(Material).Cifrar("secreto");
        var otro = new CifradorFernet(Encoding.UTF8.GetBytes("otra-maquina-distinta"));
        Assert.Equal("", otro.Descifrar(token));
    }

    [Fact]
    public void Fachada_EnEstaPlataforma_IdaYVuelta()
    {
        var cifrado = CifradoValores.Cifrar("valor-de-server-json");
        if (OperatingSystem.IsWindows())
            Assert.StartsWith("DPAPI:", cifrado);
        else
            Assert.StartsWith("ENC:", cifrado);
        Assert.Equal("valor-de-server-json", CifradoValores.Descifrar(cifrado));
    }

    [Fact]
    public void Fachada_TextoPlanoPasaYBasuraSeDescarta()
    {
        Assert.Equal("plano", CifradoValores.Descifrar("plano"));
        Assert.Equal("", CifradoValores.Descifrar("ENC:no-es-un-token"));
        if (!OperatingSystem.IsWindows())
            Assert.Equal("", CifradoValores.Descifrar("DPAPI:AAAA"));
    }

    private static byte[] DecodificarBase64Url(string texto)
    {
        var limpio = texto.Replace('-', '+').Replace('_', '/');
        var resto = limpio.Length % 4;
        if (resto > 0)
            limpio += new string('=', 4 - resto);
        return Convert.FromBase64String(limpio);
    }
}
