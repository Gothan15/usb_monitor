// -*- coding: utf-8 -*-
// Pruebas del diario del apagado: la decisión de reconciliación
// al arrancar (adoptar, cancelar la huérfana, registrar la
// vencida) y la persistencia del estado en disco.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class ApagadoPersistidoTests
{
    private const string ClaveA = "USB\\VID_0001";
    private const string ClaveB = "USB\\VID_0002";
    private static readonly DateTime Ahora = new(2026, 11, 15, 12, 0, 0, DateTimeKind.Utc);

    private static EstadoApagado Estado(
        bool cuenta = true, string vence = "2026-11-15T12:01:00.0000000Z",
        params string[] causantes) => new()
        {
            Causantes = causantes.ToList(),
            CuentaEnCurso = cuenta,
            VenceUtc = vence,
            Segundos = 60,
        };

    [Fact]
    public void Decidir_SinDiarioOSinCuenta_NoHayNadaQueReconciliar()
    {
        Assert.Equal(
            AccionReconciliacionApagado.Nada,
            ReconciliacionApagado.Decidir(null, new[] { ClaveA }, Ahora).Accion);
        Assert.Equal(
            AccionReconciliacionApagado.Nada,
            ReconciliacionApagado.Decidir(
                Estado(cuenta: false, causantes: new[] { ClaveA }),
                new[] { ClaveA }, Ahora).Accion);
        Assert.Equal(
            AccionReconciliacionApagado.Nada,
            ReconciliacionApagado.Decidir(
                Estado(causantes: Array.Empty<string>()),
                new[] { ClaveA }, Ahora).Accion);
    }

    [Fact]
    public void Decidir_CuentaEnPlazoConCausanteConectado_SeAdopta()
    {
        var (accion, vivos) = ReconciliacionApagado.Decidir(
            Estado(causantes: new[] { ClaveA, ClaveB }),
            new[] { ClaveB }, Ahora);
        Assert.Equal(AccionReconciliacionApagado.AdoptarCuenta, accion);
        Assert.Equal(new[] { ClaveB }, vivos);
    }

    [Fact]
    public void Decidir_CuentaEnPlazoSinCausantes_SeCancelaLaHuerfana()
    {
        var (accion, vivos) = ReconciliacionApagado.Decidir(
            Estado(causantes: new[] { ClaveA }),
            Array.Empty<string>(), Ahora);
        Assert.Equal(AccionReconciliacionApagado.CancelarCuenta, accion);
        Assert.Empty(vivos);
    }

    [Fact]
    public void Decidir_PlazoVencido_NoSeRearmaAunqueElCausanteSiga()
    {
        var (accion, _) = ReconciliacionApagado.Decidir(
            Estado(vence: "2026-11-15T11:59:00.0000000Z", causantes: new[] { ClaveA }),
            new[] { ClaveA }, Ahora);
        Assert.Equal(AccionReconciliacionApagado.RegistrarVencida, accion);
    }

    [Fact]
    public void Decidir_VencimientoIlegible_SeAdoptaPorSeguridad()
    {
        // Sin vencimiento legible no se sabe si la cuenta de
        // Windows sigue corriendo: adoptar el estado permite
        // cancelarla si el causante se extrae.
        var (accion, vivos) = ReconciliacionApagado.Decidir(
            Estado(vence: "", causantes: new[] { ClaveA }),
            new[] { ClaveA }, Ahora);
        Assert.Equal(AccionReconciliacionApagado.AdoptarCuenta, accion);
        Assert.Equal(new[] { ClaveA }, vivos);
    }

    [Fact]
    public void Gestor_GuardarLeerYBorrar()
    {
        var datos = Fabrica.DirectorioTemporal();
        Assert.Null(GestorApagado.Leer(datos));

        GestorApagado.Guardar(datos, Estado(causantes: new[] { ClaveA }));
        var leido = GestorApagado.Leer(datos);
        Assert.NotNull(leido);
        Assert.True(leido.CuentaEnCurso);
        Assert.Equal(new[] { ClaveA }, leido.Causantes);
        Assert.Equal(60, leido.Segundos);

        GestorApagado.Borrar(datos);
        Assert.Null(GestorApagado.Leer(datos));
        // Borrar dos veces no es un error.
        GestorApagado.Borrar(datos);
    }
}
