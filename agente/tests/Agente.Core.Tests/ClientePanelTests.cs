// -*- coding: utf-8 -*-
// Pruebas del cliente del panel: cola persistente FIFO y ProbarConexion.
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class ClientePanelTests
{
    [Fact]
    public async Task Cola_VaciaEnOrdenFIFOYQuedaPersistida()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200, """{"ok":true}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);

        using var cliente = new ClientePanel(config, manejador, datos);
        cliente.Evento("CONNECTED", letra: "E:", serial: "S1");
        cliente.Evento("BLOCKED", letra: "E:", serial: "S1", enWhitelist: true);
        cliente.Evento("DISCONNECTED", letra: "E:", serial: "S1");
        Assert.Equal(3, cliente.EventosEnCola);

        // La cola sobrevive a un «reinicio» del cliente.
        using var cliente2 = new ClientePanel(config, manejador, datos);
        Assert.Equal(3, cliente2.EventosEnCola);

        var enviados = await cliente2.VaciarColaAsync();
        Assert.Equal(3, enviados);
        Assert.Equal(0, cliente2.EventosEnCola);
        Assert.Equal(3, manejador.Cuerpos.Count);
        Assert.Contains("\"event\":\"CONNECTED\"", manejador.Cuerpos[0]);
        Assert.Contains("\"event\":\"BLOCKED\"", manejador.Cuerpos[1]);
        Assert.Contains("\"whitelisted\":true", manejador.Cuerpos[1]);
        Assert.Contains("\"event\":\"DISCONNECTED\"", manejador.Cuerpos[2]);
        // Sin whitelisted cuando no se informa (como el Python).
        Assert.DoesNotContain("whitelisted", manejador.Cuerpos[0]);
        // Sin equipoId registrado aún, manda el puente legado: la
        // cabecera con el token antiguo va en cada llamada.
        Assert.All(manejador.Autorizaciones, a => Assert.Equal("AgentToken token-prueba", a));

        var salud = cliente2.Salud();
        Assert.Equal(3, salud.Ok);
        Assert.Equal(0, salud.Fallos);
        Assert.Equal("HTTP 200", salud.DetalleUltimoExito);
    }

    [Fact]
    public async Task Cola_AnteUnFalloSeConservaYElOrdenSeMantiene()
    {
        var estado = 500;
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(estado, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);
        cliente.Evento("CONNECTED", serial: "S1");
        cliente.Evento("BLOCKED", serial: "S1");

        Assert.Equal(0, await cliente.VaciarColaAsync());
        Assert.Equal(2, cliente.EventosEnCola);
        Assert.Equal(1, cliente.Salud().Fallos);

        estado = 200;
        Assert.Equal(2, await cliente.VaciarColaAsync());
        Assert.Equal(0, cliente.EventosEnCola);
        Assert.Contains("\"event\":\"CONNECTED\"", manejador.Cuerpos[^2]);
        Assert.Contains("\"event\":\"BLOCKED\"", manejador.Cuerpos[^1]);
    }

    [Fact]
    public async Task ProbarConexion_TodoCorrecto()
    {
        using var oido = new TcpListener(IPAddress.Loopback, 0);
        oido.Start();
        var puerto = ((IPEndPoint)oido.LocalEndpoint).Port;
        var manejador = new ManejadorFalso(solicitud =>
            solicitud.RequestUri!.AbsolutePath == "/api/agent/ping"
                ? ManejadorFalso.Json(200, """{"ok":true,"serverTime":"2026-11-01T00:00:00","pc":"PC"}""")
                : ManejadorFalso.Json(200, """{"ok":true,"startupNetworkDelay":15,"lockSessionOnInsert":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(puerto);
        using var cliente = new ClientePanel(config, manejador, datos);

        var pasos = await cliente.ProbarConexionAsync();

        Assert.Equal(4, pasos.Count);
        Assert.All(pasos, paso => Assert.True(paso.Ok, $"{paso.Paso}: {paso.Detalle}"));
        Assert.Equal("Resolución del host", pasos[0].Paso);
        Assert.Equal("Puerto TCP", pasos[1].Paso);
        Assert.Equal("HTTP del panel", pasos[2].Paso);
        Assert.Equal("Credencial y ajustes", pasos[3].Paso);
        oido.Stop();
    }

    [Fact]
    public async Task ProbarConexion_Ping404_AvisaDelDespliegue()
    {
        using var oido = new TcpListener(IPAddress.Loopback, 0);
        oido.Start();
        var puerto = ((IPEndPoint)oido.LocalEndpoint).Port;
        var manejador = new ManejadorFalso(solicitud =>
            solicitud.RequestUri!.AbsolutePath == "/api/agent/ping"
                ? ManejadorFalso.Json(404, """{"ok":false}""")
                : ManejadorFalso.Json(200, """{"ok":true}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(puerto);
        using var cliente = new ClientePanel(config, manejador, datos);

        var pasos = await cliente.ProbarConexionAsync();

        Assert.True(pasos[0].Ok);
        Assert.True(pasos[1].Ok);
        Assert.False(pasos[2].Ok);
        Assert.Contains("falta desplegar /api/agent/ping", pasos[2].Detalle);
        Assert.True(pasos[3].Ok);
        oido.Stop();
    }

    [Fact]
    public async Task ProbarConexion_Config401_CredencialRechazada()
    {
        using var oido = new TcpListener(IPAddress.Loopback, 0);
        oido.Start();
        var puerto = ((IPEndPoint)oido.LocalEndpoint).Port;
        var manejador = new ManejadorFalso(solicitud =>
            solicitud.RequestUri!.AbsolutePath == "/api/agent/ping"
                ? ManejadorFalso.Json(200, """{"ok":true}""")
                : ManejadorFalso.Json(401, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(puerto);
        using var cliente = new ClientePanel(config, manejador, datos);

        var pasos = await cliente.ProbarConexionAsync();

        Assert.False(pasos[3].Ok);
        Assert.Contains("credencial rechazada", pasos[3].Detalle);
        oido.Stop();
    }

    [Fact]
    public async Task DuenoEquipo_ConDuenoAsignado()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200,
            """{"ok":true,"pcName":"PC","ownerUsername":"gothan","unlockMode":"OWNER_OR_ADMIN","passwordUnlockEnabled":true}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var resultado = await cliente.DuenoEquipoAsync();

        Assert.Equal(200, resultado.EstadoHttp);
        Assert.NotNull(resultado.Datos);
        Assert.Equal("gothan", resultado.Datos!.OwnerUsername);
        Assert.Equal("OWNER_OR_ADMIN", resultado.Datos.UnlockMode);
        Assert.True(resultado.Datos.PasswordUnlockEnabled);
        Assert.StartsWith("/api/agent/owner?pcName=", manejador.Rutas[^1]);
    }

    [Fact]
    public async Task DuenoEquipo_SinAsignar_NoEsErrorYEquipoInexistente_Si()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200,
            """{"ok":true,"pcName":"PC","ownerUsername":null,"unlockMode":"OWNER_OR_ADMIN","passwordUnlockEnabled":true}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var sinDueno = await cliente.DuenoEquipoAsync();
        Assert.Equal(200, sinDueno.EstadoHttp);
        Assert.NotNull(sinDueno.Datos);
        Assert.Null(sinDueno.Datos!.OwnerUsername);

        var manejador404 = new ManejadorFalso(_ =>
            ManejadorFalso.Json(404, """{"ok":false,"error":"Equipo no encontrado"}"""));
        using var cliente404 = new ClientePanel(config, manejador404, datos);
        var noExiste = await cliente404.DuenoEquipoAsync();
        Assert.Equal(404, noExiste.EstadoHttp);
        Assert.Null(noExiste.Datos);
    }

    [Fact]
    public async Task Enrolar_DeclaraTodasLasIpsDeLaMaquina()
    {
        // El código de una instalación remota queda atado a la
        // IP del empuje, que puede ser la de OTRO adaptador (una
        // VM con bridged y NAT): el enrolamiento declara todas
        // las IPv4 de la máquina para que el panel empareje por
        // cualquiera, no solo por la de origen de la conexión.
        var manejador = new ManejadorFalso(solicitud =>
            solicitud.RequestUri!.AbsolutePath == "/api/agent/enroll"
                ? ManejadorFalso.Json(200, """{"ok":true,"equipoId":"eq-1","huella":"abc"}""")
                : ManejadorFalso.Json(404, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var ok = await cliente.EnrolarConCodigoAsync("ABCD-EFGH-JKMN");

        Assert.True(ok);
        var cuerpo = Assert.Single(manejador.Cuerpos);
        Assert.Contains("\"pcName\"", cuerpo);
        Assert.Contains("\"codigo\":\"ABCD-EFGH-JKMN\"", cuerpo);
        Assert.Contains("\"clavePublica\"", cuerpo);
        using var doc = JsonDocument.Parse(cuerpo);
        var ips = doc.RootElement.GetProperty("ips")
            .EnumerateArray()
            .Select(e => e.GetString())
            .ToList();
        Assert.Equal(Configuracion.IpsPc, ips);
        Assert.All(ips, ip => Assert.False(IPAddress.IsLoopback(IPAddress.Parse(ip!))));
    }
}
