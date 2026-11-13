// -*- coding: utf-8 -*-
// Pruebas de la interpretación de la dirección del servidor:
// el dedazo del registro real («http://172.29.176.1::3000») y
// las formas en las que una dirección puede venir escrita.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class DireccionServidorTests
{
    [Fact]
    public void HostSolo_TalCual()
    {
        var partes = DireccionServidor.IntentarInterpretar("192.168.1.50");
        Assert.NotNull(partes);
        Assert.Equal("192.168.1.50", partes.Host);
        Assert.Null(partes.Puerto);
        Assert.Null(partes.Esquema);
    }

    [Fact]
    public void HostConPuerto_SeSeparan()
    {
        var partes = DireccionServidor.IntentarInterpretar("192.168.1.50:8080");
        Assert.NotNull(partes);
        Assert.Equal("192.168.1.50", partes.Host);
        Assert.Equal(8080, partes.Puerto);
    }

    [Fact]
    public void DireccionEnteraPegada_SeInterpretanLasTresPiezas()
    {
        var partes = DireccionServidor.IntentarInterpretar("https://panel.local:8443/");
        Assert.NotNull(partes);
        Assert.Equal("https", partes.Esquema);
        Assert.Equal("panel.local", partes.Host);
        Assert.Equal(8443, partes.Puerto);
    }

    [Fact]
    public void DobleDosPuntos_DelRegistroReal_SeCorrige()
    {
        // El caso de DESKTOP-3OFNR6B (2026-11-13): el host quedó
        // «172.29.176.1:» y todas las peticiones morían con
        // «Invalid URI: Invalid port specified».
        var partes = DireccionServidor.IntentarInterpretar("http://172.29.176.1::3000");
        Assert.NotNull(partes);
        Assert.Equal("http", partes.Esquema);
        Assert.Equal("172.29.176.1", partes.Host);
        Assert.Equal(3000, partes.Puerto);
    }

    [Fact]
    public void DosPuntosFinalesSinPuerto_SeCaen()
    {
        var partes = DireccionServidor.IntentarInterpretar("172.29.176.1:");
        Assert.NotNull(partes);
        Assert.Equal("172.29.176.1", partes.Host);
        Assert.Null(partes.Puerto);
    }

    [Fact]
    public void EspaciosAlrededor_SeRecortan()
    {
        var partes = DireccionServidor.IntentarInterpretar("  localhost  ");
        Assert.NotNull(partes);
        Assert.Equal("localhost", partes.Host);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("http://")]
    [InlineData("ftp://192.168.1.50")]
    [InlineData("192.168.1.50:99999")]
    [InlineData("192.168.1.50:abc")]
    [InlineData("mi equipo")]
    [InlineData("[::1]:3000")]
    public void LoQueNoPuedeSerDireccion_DevuelveNull(string? bruto)
    {
        Assert.Null(DireccionServidor.IntentarInterpretar(bruto));
    }
}
