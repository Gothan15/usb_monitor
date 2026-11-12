using USBMonitor.Agente.Core;
using Xunit;

namespace Agente.Core.Tests;

/// <summary>
/// La normalización de versiones del ayudante Versiones: lo que
/// un exe declara en su PE («1.0.20.0», «1.0.20+hash») tiene que
/// salir siempre como «X.Y.Z» limpio, que es la forma en la que
/// el panel la guarda y la enseña. Eran los casos de
/// ClienteGitHubTests que sobrevivieron a ese cliente.
/// </summary>
public class VersionesTests
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
        Assert.Equal(esperada, Versiones.NormalizarVersion(cruda));
    }
}
