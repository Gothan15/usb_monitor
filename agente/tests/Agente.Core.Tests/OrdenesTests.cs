// -*- coding: utf-8 -*-
// Pruebas del canal de órdenes (fase B): la configuración trae las
// órdenes, el manifiesto se lee del panel, el informe de estado se
// envía a su ruta y el paquete se descarga a disco tal cual.
using System.Net;
using System.Text;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class OrdenesTests
{
    [Fact]
    public async Task Config_TraeLasOrdenesDelEquipo()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200, """
            {"ok":true,"startupNetworkDelay":15,"lockSessionOnInsert":false,
             "shutdownOnNonWhitelisted":false,"shutdownCountdownSeconds":60,
             "comandos":[{"id":"cmd1","tipo":"actualizar","estado":"ENTREGADA",
                          "versionObjetivo":"1.0.4","intentos":0}]}
            """));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var remota = await cliente.ConfigRemotaAsync();

        Assert.NotNull(remota);
        var orden = Assert.Single(remota!.Comandos!);
        Assert.Equal("cmd1", orden.Id);
        Assert.Equal("actualizar", orden.Tipo);
        Assert.Equal("ENTREGADA", orden.Estado);
        Assert.Equal("1.0.4", orden.VersionObjetivo);
        Assert.Equal(0, orden.Intentos);
    }

    [Fact]
    public async Task Config_SinOrdenes_ListaVaciaONulaSinRomper()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200,
            """{"ok":true,"startupNetworkDelay":15}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var remota = await cliente.ConfigRemotaAsync();

        Assert.NotNull(remota);
        Assert.True(remota!.Comandos is null || remota.Comandos.Count == 0);
    }

    [Fact]
    public async Task Manifiesto_SeLeeDelPanel_Y404EsNull()
    {
        var estado = 200;
        var manejador = new ManejadorFalso(_ => estado == 200
            ? ManejadorFalso.Json(200, """
                {"ok":true,"version":"1.0.4","sha256":"abc123","tamano":1234,
                 "nombreArchivo":"USBMonitorService.exe"}
                """)
            : ManejadorFalso.Json(404, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var manifiesto = await cliente.ManifiestoPaqueteAsync();
        Assert.NotNull(manifiesto);
        Assert.Equal("1.0.4", manifiesto!.Version);
        Assert.Equal("abc123", manifiesto.Sha256);
        Assert.Equal(1234, manifiesto.Tamano);
        Assert.Contains("/api/agent/paquete/manifiesto", manejador.Rutas[^1]);

        estado = 404;
        Assert.Null(await cliente.ManifiestoPaqueteAsync());
    }

    [Fact]
    public async Task InformarOrden_EnviaElEstado_YUnRechazoEsFalse()
    {
        var estado = 200;
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(estado, """{"ok":true}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        Assert.True(await cliente.InformarOrdenAsync("cmd1", "EN_CURSO", versionObjetivo: "1.0.4"));
        Assert.Contains("/api/agent/comandos/cmd1", manejador.Rutas[^1]);
        Assert.Contains("\"estado\":\"EN_CURSO\"", manejador.Cuerpos[^1]);
        Assert.Contains("\"versionObjetivo\":\"1.0.4\"", manejador.Cuerpos[^1]);

        estado = 409;
        Assert.False(await cliente.InformarOrdenAsync("cmd1", "HECHA"));
    }

    [Fact]
    public async Task DescargarPaquete_GuardaLosBytesTalCual()
    {
        // Puerto libre para un HttpListener real: DescargarPaquete
        // usa su propio HttpClient (el general tiene 8 s de límite).
        using var sonda = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        sonda.Start();
        var puerto = ((IPEndPoint)sonda.LocalEndpoint).Port;
        sonda.Stop();

        var contenido = Encoding.UTF8.GetBytes("exe-simulado-del-paquete");
        using var oido = new HttpListener();
        oido.Prefixes.Add($"http://127.0.0.1:{puerto}/");
        oido.Start();
        var atencion = Task.Run(async () =>
        {
            var ctx = await oido.GetContextAsync();
            Assert.Equal("/api/agent/paquete", ctx.Request.Url!.AbsolutePath);
            // Sin clave registrada la descarga sale desnuda: en
            // producción el panel la rechazaría (el paquete solo
            // baja con la petición firmada).
            Assert.Null(ctx.Request.Headers["Authorization"]);
            ctx.Response.ContentLength64 = contenido.Length;
            await ctx.Response.OutputStream.WriteAsync(contenido);
            ctx.Response.Close();
        });

        var (config, datos) = Fabrica.ConfiguracionEnPuerto(puerto);
        using var cliente = new ClientePanel(config, new ManejadorFalso(
            _ => ManejadorFalso.Json(500, "{}")), datos);
        var destino = Path.Combine(Fabrica.DirectorioTemporal(), "sub", "nuevo.exe");

        Assert.True(await cliente.DescargarPaqueteAsync(destino));
        Assert.Equal(contenido, await File.ReadAllBytesAsync(destino));
        await atencion;
        oido.Stop();
    }
}
