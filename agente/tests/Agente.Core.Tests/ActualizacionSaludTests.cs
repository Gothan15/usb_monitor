// Pruebas de las reglas de la actualización: la descarga
// reanudable por rangos y el vigía de salud que restaura la
// versión anterior si la nueva arranca pero no habla.
using System;
using USBMonitor.Agente.Core;
using Xunit;

public class DescargaParcialTests
{
    [Fact]
    public void SinNadaBajadoNoSePideRango()
    {
        Assert.Null(DescargaParcial.CabeceraRango(0));
    }

    [Fact]
    public void ConAlgoBajadoSePideDesdeEseByte()
    {
        Assert.Equal("bytes=1234-", DescargaParcial.CabeceraRango(1234));
    }

    [Fact]
    public void El206SoloAnexaSiSePidioRango()
    {
        Assert.Equal(ModoDescarga.Anexar, DescargaParcial.ModoAlResponder(206, true));
        Assert.Equal(ModoDescarga.Fallo, DescargaParcial.ModoAlResponder(206, false));
    }

    [Fact]
    public void El200SiempreEscribeDeCero()
    {
        Assert.Equal(ModoDescarga.DesdeCero, DescargaParcial.ModoAlResponder(200, true));
        Assert.Equal(ModoDescarga.DesdeCero, DescargaParcial.ModoAlResponder(200, false));
    }

    [Fact]
    public void LosErroresSonFalloYElParcialSeConserva()
    {
        Assert.Equal(ModoDescarga.Fallo, DescargaParcial.ModoAlResponder(404, true));
        Assert.Equal(ModoDescarga.Fallo, DescargaParcial.ModoAlResponder(416, true));
        Assert.Equal(ModoDescarga.Fallo, DescargaParcial.ModoAlResponder(500, false));
    }

    [Fact]
    public void ElPorcentajeSeCalculaYSeAcota()
    {
        Assert.Equal(0, DescargaParcial.Porcentaje(0, 200));
        Assert.Equal(25, DescargaParcial.Porcentaje(50, 200));
        Assert.Equal(100, DescargaParcial.Porcentaje(200, 200));
        Assert.Equal(100, DescargaParcial.Porcentaje(250, 200));
        Assert.Equal(-1, DescargaParcial.Porcentaje(10, 0));
    }
}

public class SaludActualizacionTests
{
    private static readonly DateTime Ahora = new(2026, 11, 14, 12, 0, 0, DateTimeKind.Utc);

    private static MarcadorSalud Marcador(string sha, DateTime creado) => new()
    {
        Sha256Instalado = sha,
        CreadoEnUtc = creado,
    };

    [Fact]
    public void ElVigiaSeArmaSiElExeEsElDelMarcadorYEsReciente()
    {
        var m = Marcador("AB12", Ahora.AddMinutes(-3));
        Assert.True(SaludActualizacion.VigiaArmado(m, "ab12", Ahora));
    }

    [Fact]
    public void ElVigiaNoSeArmaConOtroExeNiSinMarcador()
    {
        var m = Marcador("AB12", Ahora.AddMinutes(-3));
        Assert.False(SaludActualizacion.VigiaArmado(m, "ZZ99", Ahora));
        Assert.False(SaludActualizacion.VigiaArmado(null, "ab12", Ahora));
    }

    [Fact]
    public void UnMarcadorViejoNoArmaNingunVigia()
    {
        var m = Marcador("AB12", Ahora.AddHours(-25));
        Assert.False(SaludActualizacion.VigiaArmado(m, "ab12", Ahora));
    }

    [Fact]
    public void LaSaludSeConfirmaConUnContactoPosteriorAlMarcador()
    {
        var m = Marcador("AB12", Ahora.AddMinutes(-3));
        Assert.True(SaludActualizacion.SaludConfirmada(Ahora.AddMinutes(-1), m));
        Assert.False(SaludActualizacion.SaludConfirmada(Ahora.AddMinutes(-5), m));
        Assert.False(SaludActualizacion.SaludConfirmada(null, m));
    }

    [Fact]
    public void ElPlazoSonDiezMinutosDesdeElIntercambio()
    {
        var creado = Ahora.AddMinutes(-11);
        Assert.True(SaludActualizacion.PlazoVencido(creado, Ahora));
        Assert.False(SaludActualizacion.PlazoVencido(Ahora.AddMinutes(-5), Ahora));
    }

    [Fact]
    public void ElRespaldoSeBorraTrasSieteDiasSinVigia()
    {
        Assert.True(SaludActualizacion.RespaldoTocaBorrar(
            true, false, Ahora.AddDays(-8), Ahora));
        Assert.False(SaludActualizacion.RespaldoTocaBorrar(
            true, false, Ahora.AddDays(-2), Ahora));
    }

    [Fact]
    public void ConVigiaPendienteElRespaldoNoSeToca()
    {
        Assert.False(SaludActualizacion.RespaldoTocaBorrar(
            true, true, Ahora.AddDays(-30), Ahora));
        Assert.False(SaludActualizacion.RespaldoTocaBorrar(
            false, false, Ahora.AddDays(-30), Ahora));
    }
}
