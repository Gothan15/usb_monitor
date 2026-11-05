// -*- coding: utf-8 -*-
// Servidor local HTTP (127.0.0.1:5001). Espejo del servidor local de
// servicio.py:
//
//   GET  /estado       -> salud y dispositivos bloqueados.
//   GET  /desbloquear  -> la página de emergencia (sin red).
//   POST /desbloquear  -> verifica SOLO con la contraseña del dueño
//                         y el hash local (Emergencia del Core).
//   POST /config       -> el panel empuja ajustes con la propia
//                         credencial del agente (snake_case o camelCase).
//
// El estado vive en ConfigCompartida: lo que /config escribe, el
// worker lo lee en el acto. Nada de esto sale de 127.0.0.1.
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

public sealed class ServidorLocal : IDisposable
{
    private static readonly Registrador Log = Registro.Obtener("local");

    public const int PuertoLocal = 5001;

    private readonly Func<List<BlockedInfo>> _bloqueados;
    private readonly Func<string, bool> _procesarEmergencia;
    private readonly Emergencia _emergencia;
    private readonly Configuracion _configuracion;
    private readonly ConfigCompartida _compartida;
    private HttpListener? _listener;
    private Task? _bucle;

    /// <param name="configuracion">
    /// La misma Configuracion que usa el ClientePanel: /config compara
    /// Authorization contra sus cabeceras, como hace el agente Python.
    /// </param>
    public ServidorLocal(
        Configuracion configuracion,
        Func<List<BlockedInfo>> bloqueados,
        Func<string, bool> procesarEmergencia,
        Emergencia emergencia,
        ConfigCompartida compartida)
    {
        _configuracion = configuracion;
        _bloqueados = bloqueados;
        _procesarEmergencia = procesarEmergencia;
        _emergencia = emergencia;
        _compartida = compartida;
    }

    /// <summary>Línea de «bloqueado» para /estado y la página.</summary>
    public sealed record BlockedInfo(string Clave, string Serial, string? Letra, string Nombre);

    public void Iniciar()
    {
        try
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://127.0.0.1:{PuertoLocal}/");
            _listener.Start();
        }
        catch (Exception exc)
        {
            Log.Advertencia($"Servidor local no disponible en :{PuertoLocal}: {exc.Message}");
            _listener = null;
            return;
        }
        _bucle = Task.Run(BucleAsync);
    }

    public void Detener()
    {
        try { _listener?.Stop(); } catch { /* cierre best-effort */ }
        try { _listener?.Close(); } catch { /* cierre best-effort */ }
        try { _bucle?.Wait(TimeSpan.FromSeconds(2)); } catch { /* cierre best-effort */ }
    }

    public void Dispose() => Detener();

    private async Task BucleAsync()
    {
        while (_listener is { IsListening: true })
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (Exception)
            {
                break; // listener parado
            }
            try
            {
                await AtenderAsync(ctx).ConfigureAwait(false);
            }
            catch (Exception exc)
            {
                Log.Advertencia($"Petición local fallida: {exc.Message}");
            }
        }
    }

    private async Task AtenderAsync(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var ruta = req.Url?.AbsolutePath ?? "/";
        var metodo = req.HttpMethod.ToUpperInvariant();
        if (ruta == "/estado" && metodo == "GET")
        {
            await ResponderJsonAsync(ctx, new
            {
                ok = true,
                pc = Configuracion.NombrePc,
                bloqueados = _bloqueados().Select(b => new
                {
                    serial = b.Serial,
                    letra = b.Letra,
                    nombre = b.Nombre,
                }).ToList(),
            }).ConfigureAwait(false);
        }
        else if (ruta == "/desbloquear" && metodo == "GET")
        {
            await ResponderHtmlAsync(ctx, PaginaDesbloquear("")).ConfigureAwait(false);
        }
        else if (ruta == "/desbloquear" && metodo == "POST")
        {
            await AtenderDesbloquearAsync(ctx).ConfigureAwait(false);
        }
        else if (ruta == "/config" && metodo == "POST")
        {
            await AtenderConfigAsync(ctx).ConfigureAwait(false);
        }
        else
        {
            await ResponderJsonAsync(ctx, new { error = "not_found" }, 404).ConfigureAwait(false);
        }
    }

    private async Task AtenderDesbloquearAsync(HttpListenerContext ctx)
    {
        var cuerpo = await LeerCuerpoAsync(ctx.Request).ConfigureAwait(false);
        Dictionary<string, string> form;
        try
        {
            using var doc = JsonDocument.Parse(
                string.IsNullOrWhiteSpace(cuerpo) ? "{}" : cuerpo);
            form = doc.RootElement.EnumerateObject()
                .ToDictionary(p => p.Name, p => p.Value.ToString());
        }
        catch (Exception)
        {
            form = ParsearFormulario(cuerpo);
        }
        form.TryGetValue("serial", out var serial);
        form.TryGetValue("username", out var username);
        form.TryGetValue("password", out var password);
        serial ??= ""; username ??= ""; password ??= "";

        BlockedInfo? objetivo = null;
        foreach (var b in _bloqueados())
        {
            if (string.Equals(b.Serial, serial, StringComparison.Ordinal)) { objetivo = b; break; }
        }
        string mensaje;
        if (objetivo is null)
        {
            mensaje = "Ese dispositivo ya no está bloqueado.";
        }
        else
        {
            // La clave de los intentos de Emergencia es la del
            // dispositivo (instancia PnP), como en servicio.py.
            var resultado = _emergencia.Verificar(
                objetivo.Clave, username, password,
                letra: objetivo.Letra, serial: objetivo.Serial);
            if (resultado.Autorizado)
            {
                mensaje = _procesarEmergencia(objetivo.Serial)
                    ? "Dispositivo desbloqueado."
                    : "La liberación falló; inténtalo de nuevo.";
            }
            else if (resultado.Motivo == "espera")
            {
                mensaje = "Demasiados intentos: espera 15 minutos.";
            }
            else
            {
                // Mismo texto que servicio.py para credenciales malas
                // y para «sin hash local»: no se distingue el caso.
                mensaje = "No se pudo desbloquear: usuario o contraseña no válidos para el dueño de esta PC.";
            }
        }
        await ResponderHtmlAsync(ctx, PaginaDesbloquear(mensaje)).ConfigureAwait(false);
    }

    private async Task AtenderConfigAsync(HttpListenerContext ctx)
    {
        var cuerpo = await LeerCuerpoAsync(ctx.Request).ConfigureAwait(false);
        if (!Autorizado(ctx.Request))
        {
            await ResponderJsonAsync(ctx, new { error = "unauthorized" }, 401).ConfigureAwait(false);
            return;
        }
        JsonElement datos;
        try
        {
            using var doc = JsonDocument.Parse(
                string.IsNullOrWhiteSpace(cuerpo) ? "{}" : cuerpo);
            datos = doc.RootElement.Clone();
        }
        catch (Exception)
        {
            await ResponderJsonAsync(ctx, new { error = "bad_json" }, 400).ConfigureAwait(false);
            return;
        }
        // El panel empuja en snake_case; también se acepta camelCase.
        if (ObtenerEntero(datos, "startup_network_delay") is { } espera)
            _compartida.StartupNetworkDelay = espera;
        else if (ObtenerEntero(datos, "startupNetworkDelay") is { } espera2)
            _compartida.StartupNetworkDelay = espera2;
        if (ObtenerBool(datos, "lock_session_on_insert") is { } bloquear)
            _compartida.LockSessionOnInsert = bloquear;
        else if (ObtenerBool(datos, "lockSessionOnInsert") is { } bloquear2)
            _compartida.LockSessionOnInsert = bloquear2;
        if (ObtenerBool(datos, "shutdown_on_non_whitelisted") is { } apagar)
            _compartida.ShutdownOnNonWhitelisted = apagar;
        else if (ObtenerBool(datos, "shutdownOnNonWhitelisted") is { } apagar2)
            _compartida.ShutdownOnNonWhitelisted = apagar2;
        if (ObtenerEntero(datos, "shutdown_countdown_seconds") is { } cuenta)
            _compartida.ShutdownCountdownSeconds = cuenta;
        else if (ObtenerEntero(datos, "shutdownCountdownSeconds") is { } cuenta2)
            _compartida.ShutdownCountdownSeconds = cuenta2;
        if (ObtenerBool(datos, "capture_evidence_on_non_whitelisted") is { } evidencia)
            _compartida.CaptureEvidenceOnNonWhitelisted = evidencia;
        else if (ObtenerBool(datos, "captureEvidenceOnNonWhitelisted") is { } evidencia2)
            _compartida.CaptureEvidenceOnNonWhitelisted = evidencia2;
        Log.Info($"Config local actualizada: {cuerpo}");
        await ResponderJsonAsync(ctx, new { ok = true }).ConfigureAwait(false);
    }

    /// <summary>La petición trae la misma credencial con la que el agente llama al panel.</summary>
    private bool Autorizado(HttpListenerRequest req)
    {
        var entrante = req.Headers["Authorization"];
        if (entrante is null) return false;
        foreach (var valor in _configuracion.CabecerasAuth().Values)
        {
            if (string.Equals(entrante, valor, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private static int? ObtenerEntero(JsonElement datos, string clave)
    {
        if (datos.ValueKind != JsonValueKind.Object) return null;
        if (!datos.TryGetProperty(clave, out var valor)) return null;
        if (valor.ValueKind == JsonValueKind.Number && valor.TryGetInt32(out var n)) return n;
        if (valor.ValueKind == JsonValueKind.String && int.TryParse(valor.GetString(), out var s)) return s;
        return null;
    }

    private static bool? ObtenerBool(JsonElement datos, string clave)
    {
        if (datos.ValueKind != JsonValueKind.Object) return null;
        if (!datos.TryGetProperty(clave, out var valor)) return null;
        if (valor.ValueKind == JsonValueKind.True) return true;
        if (valor.ValueKind == JsonValueKind.False) return false;
        return null;
    }

    private static async Task<string> LeerCuerpoAsync(HttpListenerRequest req)
    {
        using var lector = new StreamReader(req.InputStream, req.ContentEncoding ?? Encoding.UTF8);
        return await lector.ReadToEndAsync().ConfigureAwait(false);
    }

    private static Dictionary<string, string> ParsearFormulario(string cuerpo)
    {
        var resultado = new Dictionary<string, string>();
        foreach (var par in cuerpo.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = par.IndexOf('=');
            if (eq < 0) continue;
            resultado[WebUtility.UrlDecode(par[..eq])] = WebUtility.UrlDecode(par[(eq + 1)..]);
        }
        return resultado;
    }

    private static async Task ResponderJsonAsync(HttpListenerContext ctx, object datos, int estado = 200)
    {
        var json = JsonSerializer.Serialize(datos);
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = estado;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = bytes.Length;
        await ctx.Response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        ctx.Response.Close();
    }

    private static async Task ResponderHtmlAsync(HttpListenerContext ctx, string html)
    {
        var bytes = Encoding.UTF8.GetBytes(html);
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        ctx.Response.ContentLength64 = bytes.Length;
        await ctx.Response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        ctx.Response.Close();
    }

    // Página de emergencia en el tema claro del panel (DISENO-UI.md):
    // fondo #EEF0F4, superficie #FFFFFF, tinta #1D2536, primario azul
    // marino #2F4470, acento de acero #657A90, radio 0.
    private string PaginaDesbloquear(string mensaje)
    {
        var bloqueados = _bloqueados();
        var opciones = new StringBuilder();
        foreach (var b in bloqueados)
        {
            opciones.Append("<option value=\"")
                .Append(WebUtility.HtmlEncode(b.Serial)).Append("\">")
                .Append(WebUtility.HtmlEncode(b.Nombre))
                .Append(b.Letra is not null ? $" ({WebUtility.HtmlEncode(b.Letra)})" : "")
                .Append("</option>");
        }
        var aviso = mensaje.Length > 0
            ? $"<p class=\"mensaje\">{WebUtility.HtmlEncode(mensaje)}</p>"
            : "";
        var forma = bloqueados.Count > 0
            ? $"""
              <form method="POST" action="/desbloquear">
                <label>Dispositivo</label>
                <select name="serial">{opciones}</select>
                <label>Usuario del dueño</label>
                <input name="username" autocomplete="username">
                <label>Contraseña del dueño</label>
                <input name="password" type="password" autocomplete="current-password">
                <button type="submit">Desbloquear</button>
              </form>
              """
            : "<p>No hay dispositivos bloqueados.</p>";
        return $$"""
            <!doctype html>
            <html lang="es"><head><meta charset="utf-8">
            <title>Desbloqueo de emergencia — USB Monitor</title>
            <style>
              body { font-family: "Segoe UI", system-ui, sans-serif; background: #EEF0F4;
                     color: #1D2536; margin: 0; padding: 2rem 1rem; }
              main { max-width: 26rem; margin: 0 auto; background: #FFFFFF;
                     border: 1px solid #C9D2DE; border-top: 2px solid #657A90; padding: 1.5rem; }
              h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 .25rem; }
              p.sub { color: #5A6B80; font-size: .85rem; margin: 0 0 1rem; }
              label { display: block; font-size: .7rem; letter-spacing: .08em;
                      text-transform: uppercase; color: #5A6B80; margin: .8rem 0 .25rem; }
              input, select { width: 100%; box-sizing: border-box; padding: .5rem;
                      border: 1px solid #C9D2DE; background: #FFFFFF; color: #1D2536; }
              button { margin-top: 1.2rem; width: 100%; padding: .6rem; border: 0;
                       background: #2F4470; color: #FFFFFF; font-weight: 600; cursor: pointer; }
              .mensaje { background: #EEF0F4; border-left: 2px solid #657A90;
                         padding: .5rem .75rem; font-size: .9rem; }
            </style></head><body><main>
            <h1>Desbloqueo de emergencia</h1>
            <p class="sub">Sin conexión con el servidor: solo con la contraseña del dueño de esta PC.</p>
            {{aviso}}
            {{forma}}
            </main></body></html>
            """;
    }
}
