// Pruebas del espaciado graduado entre intentos de
// enrolamiento: pronto al principio (un fallo pasajero no
// debe costar la ventana de señal de la tarea) y a
// 5 minutos cuando la cosa persiste.
using System;
using USBMonitor.Agente.Core;
using Xunit;

public class ReintentoCredencialTests
{
    [Theory]
    [InlineData(0, 30)]
    [InlineData(1, 30)]
    [InlineData(2, 60)]
    [InlineData(3, 120)]
    [InlineData(4, 300)]
    [InlineData(10, 300)]
    public void LaEsperaCreceConLosFallosYSeQuedaEnCincoMinutos(
        int fallos,
        int segundos)
    {
        Assert.Equal(
            TimeSpan.FromSeconds(segundos),
            ReintentoCredencial.EsperaTrasFallos(fallos));
    }
}
