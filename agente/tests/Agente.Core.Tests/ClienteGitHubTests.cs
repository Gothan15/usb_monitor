using USBMonitor.Agente.Core;
using Xunit;

namespace Agente.Core.Tests;

/// <summary>
/// Las piezas puras del cliente de GitHub: normalizar y comparar
/// versiones y leer la versión de una etiqueta de Release. La
/// red no se prueba aquí: eso se verifica contra GitHub de verdad
/// antes de entregar.
/// </summary>
public class ClienteGitHubTests
{
    [Theory]
    [InlineData("1.0.20", "1.0.20")]
    [InlineData("1.0.20.0", "1.0.20")]
    [InlineData("1.0.20+abcdef", "1.0.20")]
    [InlineData(" 2.3.4 ", "2.3.4")]
    [InlineData("1.0", null)]
    [InlineData("basura", null)]
    [InlineData(null, null)]
    public void NormalizarVersion(string? cruda, string? esperada)
    {
        Assert.Equal(esperada, ClienteGitHub.NormalizarVersion(cruda));
    }

    [Theory]
    [InlineData("agente-v1.0.20", "1.0.20")]
    [InlineData("v1.2.3", "1.2.3")]
    [InlineData("1.2.3", "1.2.3")]
    [InlineData("otra-cosa", null)]
    public void VersionDeEtiqueta(string? etiqueta, string? esperada)
    {
        Assert.Equal(esperada, ClienteGitHub.VersionDeEtiqueta(etiqueta));
    }

    [Theory]
    [InlineData("1.0.20", "1.0.19", 1)]
    [InlineData("1.0.19", "1.0.20", -1)]
    [InlineData("1.0.20", "1.0.20", 0)]
    [InlineData("1.0.20", null, 1)]
    [InlineData("2.0.0", "1.9.9", 1)]
    [InlineData("1.10.0", "1.9.0", 1)]
    public void CompararVersiones(string? a, string? b, int esperado)
    {
        Assert.Equal(esperado, ClienteGitHub.CompararVersiones(a, b));
    }
}
