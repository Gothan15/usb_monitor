// -*- coding: utf-8 -*-
// Pruebas del id de bloqueo persistente de la evidencia: el id
// se anota en disco (mapa + sello en la solicitud y el paquete)
// en cuanto el registro del bloqueo vuelve del panel, para que
// un reinicio del servicio no deje paquetes huérfanos.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class EvidenciaIdsTests
{
    private const string Clave = @"USB\VID_0781&PID_5567\4C530001";

    [Fact]
    public void AnotarIdBloqueo_SellaLaSolicitudYElMapa()
    {
        var dir = Fabrica.DirectorioTemporal();
        var carpeta = GestorEvidencia.Carpeta(dir);
        Directory.CreateDirectory(carpeta);
        Assert.True(GestorEvidencia.Solicitar(
            carpeta, Clave, "SERIE1", "2026-11-18T10:00:00.0000000Z",
            "bloqueo-1", null));

        GestorEvidencia.AnotarIdBloqueo(carpeta, Clave, "bloqueo-1");

        var solicitudes = GestorEvidencia.ListarSolicitudes(carpeta);
        Assert.Single(solicitudes);
        Assert.Equal("bloqueo-1", solicitudes[0].BloqueoId);
        Assert.Equal(
            "bloqueo-1", GestorEvidencia.CargarIdsBloqueo(carpeta)[Clave]);
    }

    [Fact]
    public void AnotarIdBloqueo_SellaElPaqueteQueLoEsperaba()
    {
        var dir = Fabrica.DirectorioTemporal();
        var carpeta = GestorEvidencia.Carpeta(dir);
        Directory.CreateDirectory(carpeta);
        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia
        {
            Clave = Clave,
            Serial = "SERIE1",
            Instancia = "2026-11-18T10:00:00.0000000Z",
            CapturedAt = "2026-11-18T10:00:05.0000000Z",
            BloqueoId = null,
        });

        GestorEvidencia.AnotarIdBloqueo(carpeta, Clave, "bloqueo-9");

        var paquetes = GestorEvidencia.ListarPaquetes(carpeta);
        Assert.Single(paquetes);
        Assert.Equal("bloqueo-9", paquetes[0].BloqueoId);
    }

    [Fact]
    public void AnotarIdBloqueo_NoPisaElIdQueYaTieneElPaquete()
    {
        var dir = Fabrica.DirectorioTemporal();
        var carpeta = GestorEvidencia.Carpeta(dir);
        Directory.CreateDirectory(carpeta);
        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia
        {
            Clave = Clave,
            Instancia = "instancia-1",
            CapturedAt = "2026-11-18T10:00:05.0000000Z",
            BloqueoId = "bloqueo-original",
        });

        GestorEvidencia.AnotarIdBloqueo(carpeta, Clave, "bloqueo-nuevo");

        var paquetes = GestorEvidencia.ListarPaquetes(carpeta);
        Assert.Equal("bloqueo-original", paquetes[0].BloqueoId);
        // El mapa sí se actualiza: manda para los paquetes futuros.
        Assert.Equal(
            "bloqueo-nuevo", GestorEvidencia.CargarIdsBloqueo(carpeta)[Clave]);
    }

    [Fact]
    public void CargarIdsBloqueo_SinMapaDevuelveVacio()
    {
        var dir = Fabrica.DirectorioTemporal();
        var carpeta = GestorEvidencia.Carpeta(dir);
        Assert.Empty(GestorEvidencia.CargarIdsBloqueo(carpeta));
    }
}
