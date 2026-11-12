// -*- coding: utf-8 -*-
// Pruebas del freno local de reintentos del compañero: los
// primeros fallos son gratis y la espera crece con techo.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class FrenoReintentosTests
{
    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 0)]    // equivocarse una vez es humano
    [InlineData(2, 0)]    // y dos
    [InlineData(3, 20)]   // al tercero empieza la espera
    [InlineData(4, 40)]
    [InlineData(5, 80)]
    [InlineData(6, 160)]
    [InlineData(7, 300)]  // techo: 5 minutos, nunca más
    [InlineData(30, 300)]
    public void EsperaSegundos_CreceConTecho(int fallos, int esperado)
    {
        Assert.Equal(esperado, FrenoReintentos.EsperaSegundos(fallos));
    }
}
