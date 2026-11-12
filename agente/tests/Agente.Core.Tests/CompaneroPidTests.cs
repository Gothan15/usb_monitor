// -*- coding: utf-8 -*-
// Pruebas de la ficha PID del compañero: ida y vuelta a disco
// y la coincidencia que protege contra los PID reutilizados.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class CompaneroPidTests
{
    [Fact]
    public void Escribir_YLeer_DevuelveLaFichaDelProcesoActual()
    {
        var datos = Fabrica.DirectorioTemporal();
        Assert.Null(CompaneroPid.Leer(datos));

        CompaneroPid.Escribir(datos);
        var ficha = CompaneroPid.Leer(datos);

        Assert.NotNull(ficha);
        Assert.Equal(Environment.ProcessId, ficha!.Pid);
        Assert.False(string.IsNullOrWhiteSpace(ficha.Proceso));

        CompaneroPid.Borrar(datos);
        Assert.Null(CompaneroPid.Leer(datos));
    }

    private static CompaneroPid.Ficha FichaBase() => new()
    {
        Pid = 4321,
        Proceso = "USBMonitorService",
        Sesion = 1,
        Inicio = new DateTime(2026, 11, 12, 7, 0, 0, DateTimeKind.Utc)
            .ToString("o"),
    };

    [Fact]
    public void CoincideProceso_ElMismoProceso_Vale()
    {
        var inicio = new DateTime(2026, 11, 12, 7, 0, 0, DateTimeKind.Utc);
        Assert.True(CompaneroPid.CoincideProceso(
            FichaBase(), "usbmonitorservice", 1, inicio));
    }

    [Fact]
    public void CoincideProceso_PidReutilizadoPorOtroProceso_NoVale()
    {
        var inicio = new DateTime(2026, 11, 12, 7, 0, 0, DateTimeKind.Utc);
        // Otro nombre: el PID ya es de otra aplicación.
        Assert.False(CompaneroPid.CoincideProceso(
            FichaBase(), "explorer", 1, inicio));
        // Otra sesión: no es el compañero de ESTA consola.
        Assert.False(CompaneroPid.CoincideProceso(
            FichaBase(), "USBMonitorService", 2, inicio));
        // Otra hora de arranque: el proceso con ese PID nació
        // después; el de la ficha ya murió.
        Assert.False(CompaneroPid.CoincideProceso(
            FichaBase(), "USBMonitorService", 1, inicio.AddHours(1)));
    }

    [Fact]
    public void CoincideProceso_FichaIncompleta_NoVale()
    {
        var ficha = FichaBase();
        ficha.Inicio = "no-es-una-fecha";
        Assert.False(CompaneroPid.CoincideProceso(
            ficha, "USBMonitorService", 1,
            new DateTime(2026, 11, 12, 7, 0, 0, DateTimeKind.Utc)));
    }
}
