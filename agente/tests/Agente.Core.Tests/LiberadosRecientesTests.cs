// -*- coding: utf-8 -*-
// Pruebas de la ventana anti-parpadeo de los liberados: una
// ausencia breve tras el desbloqueo es la re-enumeración, no
// una extracción; solo la ausencia larga cierra el desbloqueo.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class LiberadosRecientesTests
{
    private static readonly DateTime Ahora =
        new(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void SigueVigente_DentroDeLaVentana()
    {
        var liberados = new LiberadosRecientes();
        liberados.Marcar("clave-1", Ahora);
        Assert.True(liberados.SigueVigente("clave-1", Ahora.AddSeconds(10)));
        Assert.True(liberados.SigueVigente("clave-1", Ahora.AddSeconds(89)));
    }

    [Fact]
    public void SigueVigente_FueraDeLaVentanaNo()
    {
        var liberados = new LiberadosRecientes();
        liberados.Marcar("clave-1", Ahora);
        Assert.False(liberados.SigueVigente("clave-1", Ahora.AddSeconds(91)));
        Assert.False(liberados.SigueVigente("clave-otra", Ahora));
    }

    [Fact]
    public void TomarExpiradas_SoloLasVencidasYLasRetira()
    {
        var liberados = new LiberadosRecientes();
        liberados.Marcar("vieja", Ahora);
        liberados.Marcar("nueva", Ahora.AddSeconds(60));
        var vencidas = liberados.TomarExpiradas(Ahora.AddSeconds(100));
        Assert.Equal(new[] { "vieja" }, vencidas);
        // La retirada es definitiva: no vuelve a salir.
        Assert.Empty(liberados.TomarExpiradas(Ahora.AddSeconds(100)));
        Assert.True(liberados.SigueVigente("nueva", Ahora.AddSeconds(100)));
    }

    [Fact]
    public void Olvidar_QuitaLaAnotacion()
    {
        var liberados = new LiberadosRecientes();
        liberados.Marcar("clave-1", Ahora);
        liberados.Olvidar("clave-1");
        Assert.False(liberados.SigueVigente("clave-1", Ahora.AddSeconds(5)));
    }
}
