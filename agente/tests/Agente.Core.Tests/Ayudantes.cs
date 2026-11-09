// -*- coding: utf-8 -*-
// Ayudantes de las pruebas: HTTP falso y configuración en temporal.
using System.Net;
using System.Text;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

/// <summary>HttpMessageHandler que responde con una función y graba lo recibido.</summary>
internal sealed class ManejadorFalso : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public ManejadorFalso(Func<HttpRequestMessage, HttpResponseMessage> responder) =>
        _responder = responder;

    public List<string> Rutas { get; } = new();
    public List<string> Cuerpos { get; } = new();
    public List<string?> Autorizaciones { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage solicitud, CancellationToken cancelacion)
    {
        Rutas.Add(solicitud.RequestUri!.PathAndQuery);
        Autorizaciones.Add(solicitud.Headers.Authorization?.ToString());
        Cuerpos.Add(solicitud.Content is null
            ? ""
            : await solicitud.Content.ReadAsStringAsync(cancelacion));
        return _responder(solicitud);
    }

    public static HttpResponseMessage Json(int estado, string cuerpo) => new((HttpStatusCode)estado)
    {
        Content = new StringContent(cuerpo, Encoding.UTF8, "application/json"),
    };
}

internal static class Fabrica
{
    public static string DirectorioTemporal() => Directory.CreateTempSubdirectory().FullName;

    /// <summary>Configuración apuntando a 127.0.0.1:puerto, con server.json real en disco.</summary>
    public static (Configuracion Config, string Datos) ConfiguracionEnPuerto(int puerto)
    {
        var app = DirectorioTemporal();
        var datos = DirectorioTemporal();
        File.WriteAllText(
            Path.Combine(app, "server.json"),
            $$"""{"serverHost":"127.0.0.1","serverPort":{{puerto}},"serverScheme":"http"}""");
        return (new Configuracion(app, datos), datos);
    }
}
