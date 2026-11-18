// -*- coding: utf-8 -*-
// Pruebas del marcador de la orden «reiniciar»: se escribe
// antes de reiniciar el servicio y, al volver, la misma orden
// se reconoce como ya ejecutada (no se reinicia dos veces).
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class MarcadorReinicioTests
{
    [Fact]
    public void MarcarYLeer_DevuelveLaOrden()
    {
        var dir = Fabrica.DirectorioTemporal();
        Assert.Null(MarcadorReinicio.OrdenMarcada(dir));
        MarcadorReinicio.Marcar(dir, "orden-123");
        Assert.Equal("orden-123", MarcadorReinicio.OrdenMarcada(dir));
    }

    [Fact]
    public void Limpiar_BorraElMarcador()
    {
        var dir = Fabrica.DirectorioTemporal();
        MarcadorReinicio.Marcar(dir, "orden-123");
        MarcadorReinicio.Limpiar(dir);
        Assert.Null(MarcadorReinicio.OrdenMarcada(dir));
        // Limpiar dos veces no es un error.
        MarcadorReinicio.Limpiar(dir);
    }

    [Fact]
    public void Marcar_OtraOrdenReemplazaElMarcador()
    {
        var dir = Fabrica.DirectorioTemporal();
        MarcadorReinicio.Marcar(dir, "orden-1");
        MarcadorReinicio.Marcar(dir, "orden-2");
        Assert.Equal("orden-2", MarcadorReinicio.OrdenMarcada(dir));
    }
}
