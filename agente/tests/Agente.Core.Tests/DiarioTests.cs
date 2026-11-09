// -*- coding: utf-8 -*-
// Pruebas del diario sin huella: anotar, persistir y restaurar.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class DiarioTests
{
    [Fact]
    public void Anotar_PersisteYSeRecarga()
    {
        var datos = Fabrica.DirectorioTemporal();
        var diario = new Diario(datos);
        diario.AnotarDeshabilitado("USBSTOR\\DISK&VEN_SANDISK\\SER123", "SER123");
        diario.AnotarVolumenRetenido("E:", "E:");
        diario.AnotarSoloLectura("F:", "F:");

        var releido = new Diario(datos);
        Assert.True(releido.HayPendientes);
        Assert.True(releido.DispositivosDeshabilitados.ContainsKey("USBSTOR\\DISK&VEN_SANDISK\\SER123"));
        Assert.Equal("SER123", releido.DispositivosDeshabilitados["USBSTOR\\DISK&VEN_SANDISK\\SER123"].Serial);
    }

    [Fact]
    public void RestaurarTodo_SoloBorraLoConfirmado()
    {
        var datos = Fabrica.DirectorioTemporal();
        var diario = new Diario(datos);
        diario.AnotarDeshabilitado("INST-OK", "S1");
        diario.AnotarDeshabilitado("INST-MAL", "S2");
        diario.AnotarAutomontaje(true, true);
        diario.AnotarVolumenRetenido("E:", "E:");

        var resumen = diario.RestaurarTodo(
            rehabilitar: instancia => instancia == "INST-OK",
            fijarAutomontaje: activo => activo,
            revertirVolumen: _ => false);

        Assert.Equal(1, resumen.Reactivados);
        Assert.Equal(true, resumen.Automontaje);
        Assert.Contains("INST-MAL", resumen.SinRevertir);
        Assert.Contains("E:", resumen.SinRevertir);

        // Lo no revertido sigue en el diario para el próximo intento.
        var releido = new Diario(datos);
        Assert.True(releido.HayPendientes);
        Assert.False(releido.DispositivosDeshabilitados.ContainsKey("INST-OK"));
        Assert.True(releido.DispositivosDeshabilitados.ContainsKey("INST-MAL"));

        var segundo = releido.RestaurarTodo(_ => true, _ => true, _ => true);
        Assert.Empty(segundo.SinRevertir);
        Assert.False(new Diario(datos).HayPendientes);
    }

    [Fact]
    public void QuitarDeshabilitado_LimpiaLaAnotacion()
    {
        var datos = Fabrica.DirectorioTemporal();
        var diario = new Diario(datos);
        diario.AnotarDeshabilitado("INST1", null);
        diario.QuitarDeshabilitado("INST1");
        Assert.False(diario.HayPendientes);
        Assert.False(new Diario(datos).HayPendientes);
    }
}
