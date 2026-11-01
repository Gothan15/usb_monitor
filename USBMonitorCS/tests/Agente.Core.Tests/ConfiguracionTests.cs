// -*- coding: utf-8 -*-
// Pruebas de server.json: lectura, prioridad de rutas, token y guardado.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class ConfiguracionTests
{
    private static (Configuracion Config, string App, string Datos) Crear(string jsonApp)
    {
        var app = Fabrica.DirectorioTemporal();
        var datos = Fabrica.DirectorioTemporal();
        File.WriteAllText(Path.Combine(app, "server.json"), jsonApp);
        return (new Configuracion(app, datos), app, datos);
    }

    [Fact]
    public void LeeValoresDelArchivo()
    {
        var (config, _, _) = Crear(
            """{"serverHost":"panel.local","serverPort":8443,"serverScheme":"https","agentToken":"plano123"}""");
        Assert.Equal("panel.local", config.HostServidor);
        Assert.Equal(8443, config.PuertoServidor);
        Assert.Equal("https", config.EsquemaServidor);
        Assert.Equal("https://panel.local:8443", config.UrlBase);
        Assert.Equal("plano123", config.TokenAgente);
        Assert.Equal("AgentToken plano123", config.CabecerasAuth()["Authorization"]);
    }

    [Fact]
    public void SinArchivo_ValoresPorDefectoYSinCredencial()
    {
        var app = Fabrica.DirectorioTemporal();
        var datos = Fabrica.DirectorioTemporal();
        var config = new Configuracion(app, datos);
        Assert.Equal("localhost", config.HostServidor);
        Assert.Equal(3000, config.PuertoServidor);
        Assert.Equal("http", config.EsquemaServidor);
        Assert.Null(config.TokenAgente);
        Assert.Empty(config.CabecerasAuth());
    }

    [Fact]
    public void TokenCifrado_SeLeeEnClaro()
    {
        var cifrado = CifradoValores.Cifrar("token-oculto");
        var (config, _, _) = Crear($$"""{"agentToken":"{{cifrado}}"}""");
        Assert.Equal("token-oculto", config.TokenAgente);
    }

    [Fact]
    public void TokenCifradoIlegible_SeDescarta()
    {
        var (config, _, _) = Crear("""{"agentToken":"ENC:basura-que-no-abre"}""");
        Assert.Null(config.TokenAgente);
        Assert.Empty(config.CabecerasAuth());
    }

    [Fact]
    public void Guardar_FusionaSinPerderClavesYElTokenVuelve()
    {
        var (config, app, datos) = Crear("""{"serverHost":"viejo.local"}""");
        Assert.True(config.Guardar(new Dictionary<string, object?> { ["serverPort"] = 4000 }));
        Assert.True(config.GuardarTokenAgente("token-nuevo"));

        var releida = new Configuracion(app, datos);
        Assert.Equal("viejo.local", releida.HostServidor);
        Assert.Equal(4000, releida.PuertoServidor);
        Assert.Equal("token-nuevo", releida.TokenAgente);
    }

    [Fact]
    public void LaCarpetaDeDatosEsElRespaldo()
    {
        var app = Fabrica.DirectorioTemporal();
        var datos = Fabrica.DirectorioTemporal();
        File.WriteAllText(
            Path.Combine(datos, "server.json"),
            """{"serverHost":"desde-datos.local"}""");
        var config = new Configuracion(app, datos);
        Assert.Equal("desde-datos.local", config.HostServidor);
    }
}
