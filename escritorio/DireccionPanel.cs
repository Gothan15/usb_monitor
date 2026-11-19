// ============================================================
//  USB Monitor — App de escritorio: la dirección del panel
// ============================================================
//  De dónde sale la URL que carga la ventana. El criterio es
//  el mismo que ya usa la bandeja (bandeja/Program.cs) y el
//  que fijó el PR #164: el panel sirve sus páginas en UNA
//  sola dirección, la IPv4 de la ruta por defecto del equipo,
//  y en el puerto que el instalador deja escrito en el
//  registro. Si el usuario fija una URL a mano en los
//  ajustes, manda la suya.

using System.Net;
using System.Net.Sockets;
using Microsoft.Win32;

namespace USBMonitor.Escritorio;

internal static class DireccionPanel
{
    // El puerto del panel, de la clave que escribe el
    // instalador; 3000 si no hay clave o no hay valor.
    internal static int PuertoPanel()
    {
        using var clave = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\USBMonitor\Panel");
        return clave?.GetValue("PanelPort") is int puerto && puerto > 0 ? puerto : 3000;
    }

    // La IPv4 de la ruta por defecto de este equipo: la
    // dirección única en la que el panel sirve sus páginas.
    // El Connect de un socket UDP no envía nada: solo deja
    // que el sistema elija la interfaz de salida, y de ahí
    // se lee la dirección local. Sin red, localhost (el
    // panel responderá con su aviso de dirección, pero la
    // pantalla de espera seguirá reintentando).
    internal static string DireccionLocal()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Connect("8.8.8.8", 65530);
            return ((IPEndPoint)socket.LocalEndPoint!).Address.ToString();
        }
        catch
        {
            return "localhost";
        }
    }

    // La URL automática: esquema http, la IP de la ruta por
    // defecto y el puerto del registro. Es la que se usa
    // mientras el usuario no fije otra a mano.
    internal static string UrlAutomatica() => $"http://{DireccionLocal()}:{PuertoPanel()}";

    // La URL que toca cargar: la manual del usuario si la
    // fijó (y es válida), y si no, la automática.
    internal static string UrlEfectiva(Configuracion config)
    {
        var manual = config.UrlManual?.Trim();
        if (!string.IsNullOrEmpty(manual) && Uri.TryCreate(manual, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return manual.TrimEnd('/');
        }
        return UrlAutomatica();
    }

    // ¿Pertenece esta URL al origen del panel? Sirve para
    // decidir qué se queda dentro de la ventana y qué se
    // abre fuera, en el navegador del sistema: solo es «de
    // la casa» lo que comparte esquema, host y puerto con
    // la URL efectiva del panel.
    internal static bool EsDelPanel(string url, string urlPanel)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var destino)) return false;
        if (!Uri.TryCreate(urlPanel, UriKind.Absolute, out var origen)) return false;
        return destino.Scheme == origen.Scheme
            && string.Equals(destino.Host, origen.Host, StringComparison.OrdinalIgnoreCase)
            && destino.Port == origen.Port;
    }
}
