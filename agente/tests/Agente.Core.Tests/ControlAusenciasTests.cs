// Pruebas del control de ausencias con gracia: una enumeración sin
// el dispositivo NO es una extracción hasta que la ausencia dura
// el período completo, y reaparecer a tiempo lo olvida todo.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class ControlAusenciasTests
{
    private static readonly DateTime T0 = new(2026, 11, 8, 12, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Gracia = TimeSpan.FromSeconds(6);

    [Fact]
    public void La_primera_ausencia_no_confirma()
    {
        var control = new ControlAusencias(Gracia);
        Assert.False(control.AusenciaConfirmada("CLAVE", T0));
    }

    [Fact]
    public void Dentro_de_la_gracia_no_confirma()
    {
        var control = new ControlAusencias(Gracia);
        Assert.False(control.AusenciaConfirmada("CLAVE", T0));
        Assert.False(control.AusenciaConfirmada("CLAVE", T0 + TimeSpan.FromSeconds(3)));
        Assert.False(control.AusenciaConfirmada("CLAVE", T0 + TimeSpan.FromSeconds(5.9)));
    }

    [Fact]
    public void Cumplida_la_gracia_confirma_una_sola_vez()
    {
        var control = new ControlAusencias(Gracia);
        Assert.False(control.AusenciaConfirmada("CLAVE", T0));
        Assert.True(control.AusenciaConfirmada("CLAVE", T0 + Gracia));
        // Confirmada y olvidada: la siguiente ausencia empieza de cero.
        Assert.False(control.AusenciaConfirmada("CLAVE", T0 + Gracia + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void Reaparecer_dentro_de_la_gracia_lo_olvida_todo()
    {
        var control = new ControlAusencias(Gracia);
        Assert.False(control.AusenciaConfirmada("CLAVE", T0));
        control.MarcarPresente("CLAVE");
        // Si vuelve a faltar, la gracia corre desde la NUEVA ausencia.
        Assert.False(control.AusenciaConfirmada("CLAVE", T0 + TimeSpan.FromSeconds(4)));
        Assert.False(control.AusenciaConfirmada("CLAVE", T0 + TimeSpan.FromSeconds(8)));
        Assert.True(control.AusenciaConfirmada("CLAVE", T0 + TimeSpan.FromSeconds(10.1)));
    }

    [Fact]
    public void Las_claves_son_independientes()
    {
        var control = new ControlAusencias(Gracia);
        Assert.False(control.AusenciaConfirmada("UNA", T0));
        Assert.False(control.AusenciaConfirmada("OTRA", T0 + TimeSpan.FromSeconds(5)));
        Assert.True(control.AusenciaConfirmada("UNA", T0 + Gracia));
        Assert.False(control.AusenciaConfirmada("OTRA", T0 + Gracia));
    }
}
