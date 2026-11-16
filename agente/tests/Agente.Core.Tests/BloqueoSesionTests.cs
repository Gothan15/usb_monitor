// -*- coding: utf-8 -*-
// Pruebas de la petición de bloqueo de sesión: el servicio la
// deja en disco (sesión 0, no puede bloquear él) y el
// compañero la ejecuta si sigue vigente (30 s).
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class BloqueoSesionTests
{
    private static readonly DateTime Ahora = new(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);

    private static SolicitudBloqueoSesion Solicitud(DateTime instante) => new()
    {
        InstanteUtc = instante.ToString("o"),
        Motivo = "inserción de dispositivo",
    };

    [Fact]
    public void EsEjecutable_PeticionRecienCreada()
    {
        Assert.True(VigenciaBloqueoSesion.EsEjecutable(Solicitud(Ahora), Ahora));
        Assert.True(VigenciaBloqueoSesion.EsEjecutable(
            Solicitud(Ahora.AddSeconds(-30)), Ahora));
    }

    [Fact]
    public void EsEjecutable_PeticionCaducadaNoSeEjecuta()
    {
        Assert.False(VigenciaBloqueoSesion.EsEjecutable(
            Solicitud(Ahora.AddSeconds(-31)), Ahora));
        Assert.False(VigenciaBloqueoSesion.EsEjecutable(
            Solicitud(Ahora.AddHours(-2)), Ahora));
    }

    [Fact]
    public void EsEjecutable_PeticionDelFuturoNoSeEjecuta()
    {
        // Un reloj desfasado no debe bloquear la sesión «por
        // adelantado»: la edad negativa no es ejecutable.
        Assert.False(VigenciaBloqueoSesion.EsEjecutable(
            Solicitud(Ahora.AddSeconds(10)), Ahora));
    }

    [Fact]
    public void EsEjecutable_SinPeticionOConInstanteIlegible()
    {
        Assert.False(VigenciaBloqueoSesion.EsEjecutable(null, Ahora));
        Assert.False(VigenciaBloqueoSesion.EsEjecutable(
            new SolicitudBloqueoSesion { InstanteUtc = "no-es-una-fecha" }, Ahora));
    }

    [Fact]
    public void SolicitarYLeer_ConservaMotivoEInstante()
    {
        var carpeta = Fabrica.DirectorioTemporal();
        try
        {
            GestorBloqueoSesion.Solicitar(carpeta, "escalera de respuesta (ofensa 2)", Ahora);
            var leida = GestorBloqueoSesion.Leer(carpeta);
            Assert.NotNull(leida);
            Assert.Equal("escalera de respuesta (ofensa 2)", leida!.Motivo);
            Assert.True(VigenciaBloqueoSesion.EsEjecutable(leida, Ahora));
        }
        finally
        {
            Directory.Delete(carpeta, recursive: true);
        }
    }

    [Fact]
    public void LeerSinArchivoYBorrar_DejanLaCarpetaSinPeticion()
    {
        var carpeta = Fabrica.DirectorioTemporal();
        try
        {
            Assert.Null(GestorBloqueoSesion.Leer(carpeta));
            GestorBloqueoSesion.Solicitar(carpeta, "inserción de dispositivo", Ahora);
            Assert.True(File.Exists(GestorBloqueoSesion.Ruta(carpeta)));
            GestorBloqueoSesion.Borrar(carpeta);
            Assert.False(File.Exists(GestorBloqueoSesion.Ruta(carpeta)));
            Assert.Null(GestorBloqueoSesion.Leer(carpeta));
        }
        finally
        {
            Directory.Delete(carpeta, recursive: true);
        }
    }
}
