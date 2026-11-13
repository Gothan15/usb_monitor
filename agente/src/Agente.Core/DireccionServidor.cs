// -*- coding: utf-8 -*-
// Interpretación de la dirección del servidor escrita a mano.
//
// POR QUÉ EXISTE (registro real del 2026-11-13): en el asistente
// se guardó el host como «172.29.176.1:» — con un ':' final de
// más — y la dirección compuesta quedó «http://172.29.176.1::3000»,
// imposible de parsear. El agente arrancó así y TODAS sus
// peticiones murieron con «Invalid URI: Invalid port specified»
// (latido, sondeo de desbloqueos, eventos) sin que nadie lo
// notara hasta mirar el registro: un dedazo al escribir la
// dirección no puede volver a dejar un agente ciego en silencio.
//
// La regla: la dirección se interpreta SIEMPRE antes de guardarse
// (asistente, caja de herramientas e instalador remoto pasan por
// aquí) y también al leerse, para que un server.json ya roto se
// cure solo. Lo que no se puede interpretar no se guarda: es
// preferible un aviso claro en el momento que un agente mudo.
using System.Globalization;

namespace USBMonitor.Agente.Core;

/// <summary>Las piezas de una dirección del panel ya interpretada.</summary>
/// <param name="Esquema">«http» o «https» si la dirección lo traía; null si no.</param>
/// <param name="Host">La IP o el nombre del equipo del panel, limpio.</param>
/// <param name="Puerto">El puerto si la dirección lo traía; null si no.</param>
public sealed record PartesServidor(string? Esquema, string Host, int? Puerto);

public static class DireccionServidor
{
    /// <summary>
    /// Interpreta lo escrito como dirección del panel: acepta la
    /// dirección entera pegada («http://192.168.1.50:3000»), solo
    /// el host con su puerto («192.168.1.50:3000») o solo el host
    /// («192.168.1.50»), y corrige los dedazos con arreglo seguro
    /// (el ':' duplicado o final). Devuelve null si lo escrito no
    /// puede ser una dirección válida de ninguna manera.
    /// </summary>
    public static PartesServidor? IntentarInterpretar(string? bruto)
    {
        if (string.IsNullOrWhiteSpace(bruto))
            return null;
        var texto = bruto.Trim();

        // Esquema explícito: solo http o https; otro no vale.
        string? esquema = null;
        var corteEsquema = texto.IndexOf("://", StringComparison.Ordinal);
        if (corteEsquema >= 0)
        {
            var candidato = texto[..corteEsquema].ToLowerInvariant();
            if (candidato is not ("http" or "https"))
                return null;
            esquema = candidato;
            texto = texto[(corteEsquema + 3)..];
        }

        // La dirección es solo la autoridad: fuera ruta, consulta
        // o fragmento si la dirección venía pegada de un navegador.
        var corteRuta = texto.IndexOfAny(new[] { '/', '?', '#' });
        if (corteRuta >= 0)
            texto = texto[..corteRuta];
        if (texto.Length == 0)
            return null;

        // IPv6 entre corchetes no se soporta: el panel vive en la
        // IPv4 de la red local.
        if (texto.StartsWith('['))
            return null;

        // El puerto es lo que sigue al ÚLTIMO ':' si son solo
        // dígitos; si tras el ':' hay otra cosa, no es un puerto
        // ni un host válido («host:abc» no se guarda).
        int? puerto = null;
        var cortePuerto = texto.LastIndexOf(':');
        if (cortePuerto >= 0)
        {
            var despues = texto[(cortePuerto + 1)..];
            if (despues.Length > 0 && despues.All(char.IsDigit))
            {
                if (!int.TryParse(despues, NumberStyles.None,
                        CultureInfo.InvariantCulture, out var numero) ||
                    numero < 1 || numero > 65535)
                    return null;
                puerto = numero;
                texto = texto[..cortePuerto];
            }
            else if (despues.Length > 0)
            {
                return null;
            }
            // Con «host:» pelado, el ':' final sobra y se cae abajo.
        }

        // Los ':' finales que queden son siempre un dedazo (el del
        // registro: «172.29.176.1::3000» dejaba el host como
        // «172.29.176.1:»): se recortan.
        var host = texto.TrimEnd(':').Trim();
        if (host.Length == 0)
            return null;
        // Un ':' dentro sería IPv6 sin corchetes u otra basura.
        if (host.Contains(':'))
            return null;
        // El host solo puede llevar letras, dígitos, puntos,
        // guiones y guiones bajos (nombres de equipo de Windows).
        if (host.Any(c => !(char.IsLetterOrDigit(c) || c is '.' or '-' or '_')))
            return null;

        return new PartesServidor(esquema, host, puerto);
    }
}
