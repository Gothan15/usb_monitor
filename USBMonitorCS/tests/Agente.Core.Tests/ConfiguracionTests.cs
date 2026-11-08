// -*- coding: utf-8 -*-
// Pruebas de server.json: lectura, prioridad de rutas, la
// credencial por clave (y el token legado de la migración) y el
// guardado.
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
        Assert.Equal("plano123", config.TokenLegado);
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
        Assert.Null(config.TokenLegado);
        Assert.False(config.TieneClave);
        Assert.Null(config.EquipoId);
        Assert.Null(config.CodigoEnrolamiento);
    }

    [Fact]
    public void TokenCifrado_SeLeeEnClaro()
    {
        var cifrado = CifradoValores.Cifrar("token-oculto");
        var (config, _, _) = Crear($$"""{"agentToken":"{{cifrado}}"}""");
        Assert.Equal("token-oculto", config.TokenLegado);
    }

    [Fact]
    public void TokenCifradoIlegible_SeDescarta()
    {
        var (config, _, _) = Crear("""{"agentToken":"ENC:basura-que-no-abre"}""");
        Assert.Null(config.TokenLegado);
    }

    [Fact]
    public void Guardar_FusionaSinPerderClavesYElCodigoVuelve()
    {
        var (config, app, datos) = Crear("""{"serverHost":"viejo.local"}""");
        Assert.True(config.Guardar(new Dictionary<string, object?> { ["serverPort"] = 4000 }));
        Assert.True(config.GuardarCodigoEnrolamiento("CODIGO-1234"));
        Assert.True(config.GuardarEquipoId("equipo-9"));

        var releida = new Configuracion(app, datos);
        Assert.Equal("viejo.local", releida.HostServidor);
        Assert.Equal(4000, releida.PuertoServidor);
        Assert.Equal("CODIGO-1234", releida.CodigoEnrolamiento);
        Assert.Equal("equipo-9", releida.EquipoId);
    }

    [Fact]
    public void BorrarTokenLegado_LoQuitaDelArchivo()
    {
        var (config, app, datos) = Crear("""{"agentToken":"legado","serverHost":"x.local"}""");
        Assert.Equal("legado", config.TokenLegado);
        Assert.True(config.BorrarTokenLegado());

        var releida = new Configuracion(app, datos);
        Assert.Null(releida.TokenLegado);
        Assert.Equal("x.local", releida.HostServidor);
        var crudo = File.ReadAllText(Path.Combine(app, "server.json"));
        Assert.DoesNotContain("agentToken", crudo);
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
