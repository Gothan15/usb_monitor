// -*- coding: utf-8 -*-
// Pruebas del desfase de reloj persistido: guardar, recargar
// entre «procesos» y no reescribir por deriva mínima.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class DesfaseRelojTests
{
    [Fact]
    public void Guardar_YCargar_DevuelveElDesfase()
    {
        var datos = Fabrica.DirectorioTemporal();
        Assert.Equal(0, DesfaseReloj.Cargar(datos));

        DesfaseReloj.Guardar(3725, datos);
        Assert.Equal(3725, DesfaseReloj.Cargar(datos));

        // Un desfase negativo (reloj adelantado) también vale.
        DesfaseReloj.Guardar(-640, datos);
        Assert.Equal(-640, DesfaseReloj.Cargar(datos));
    }

    [Fact]
    public void Cargar_ArchivoCorrupto_DevuelveCeroSinExplotar()
    {
        var datos = Fabrica.DirectorioTemporal();
        File.WriteAllText(
            Path.Combine(datos, DesfaseReloj.NombreArchivo),
            "{ esto no es json");
        Assert.Equal(0, DesfaseReloj.Cargar(datos));
    }

    [Theory]
    [InlineData(0, 3, false)]     // deriva pequeña: no reescribir
    [InlineData(0, 5, true)]      // cambio real: persistir
    [InlineData(3600, 3596, false)]
    [InlineData(3600, 0, true)]   // el reloj se sincronizó: anotarlo
    public void DebePersistir_SoloConCambiosDeVerdad(
        long guardado, long nuevo, bool esperado)
    {
        Assert.Equal(esperado, DesfaseReloj.DebePersistir(guardado, nuevo));
    }
}
