// Pruebas del barrido de la carpeta de instalación: qué
// carpetas pueden borrarse tras desinstalar y cómo queda la
// orden del cmd que lo hace cuando el proceso ya salió.
using System;
using USBMonitor.Agente.Core;
using Xunit;

public class BarridoInstalacionTests
{
    [Fact]
    public void LaCarpetaDeLaInstalacionRemotaSePuedeBarrer()
    {
        Assert.True(BarridoInstalacion.EsCarpetaSegura(@"C:\USBMonitor"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(@"C:\")]
    [InlineData("USBMonitor")] // relativa: sin unidad no se barre
    [InlineData("C:\\USB\"Monitor")] // comillas: romperían la orden
    public void LoDudosoNoSeBarre(string? carpeta)
    {
        Assert.False(BarridoInstalacion.EsCarpetaSegura(carpeta));
    }

    [Fact]
    public void LaCarpetaDeWindowsNoSeBarre()
    {
        var delSistema = new[] { @"C:\Windows", @"C:\Program Files" };
        Assert.False(BarridoInstalacion.EsCarpetaSegura(@"C:\Windows", delSistema));
        Assert.False(BarridoInstalacion.EsCarpetaSegura(@"C:\Program Files", delSistema));
        Assert.True(BarridoInstalacion.EsCarpetaSegura(@"C:\USBMonitor", delSistema));
    }

    [Fact]
    public void LaOrdenReintentaYBaraLaCarpetaPedida()
    {
        var orden = BarridoInstalacion.ConstruirOrdenBarrido(@"C:\USBMonitor");
        Assert.Contains("rd /s /q \"C:\\USBMonitor\"", orden);
        Assert.Contains("(1,1,40)", orden);
        Assert.Contains("if not exist", orden);
    }
}
