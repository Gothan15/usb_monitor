// -*- coding: utf-8 -*-
// Registro de ofensas por dispositivo: la memoria de la
// escalera de respuesta ante dispositivos fuera de la lista
// blanca.
//
// Sin escalera, el ajuste de apagado actúa a la primera: un
// pendrive desconocido enchufado por error apaga el equipo.
// Con la escalera activada (ajuste del panel
// shutdownEscalationEnabled), la respuesta sube por peldaños
// según cuántas veces ha sido bloqueado ESE dispositivo:
//
//   1.ª vez → aviso en la ventana del compañero.
//   2.ª vez → bloqueo de la sesión de Windows.
//   3.ª vez y siguientes → la cuenta atrás de apagado.
//
// El conteo es por dispositivo (su clave) y SOBREVIVE a los
// reinicios del agente y del equipo: vive en
// <datos>/ofensas.json. Extraer y reinsertar no lo limpia —
// eso es justo lo que se quiere contar —; lo limpia que el
// dispositivo entre en la lista blanca (pasa a ser autorizado
// y su historial deja de tener sentido).
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>Peldaño de la escalera de respuesta para un conteo de ofensas.</summary>
public enum NivelRespuesta
{
    Ninguno,
    Aviso,
    BloqueoSesion,
    Apagado,
}

/// <summary>La ficha de ofensas de un dispositivo.</summary>
public sealed class OfensaDispositivo
{
    [JsonPropertyName("conteo")] public int Conteo { get; set; }
    /// <summary>Instante ISO (UTC) de la última ofensa.</summary>
    [JsonPropertyName("ultima")] public string Ultima { get; set; } = "";
}

/// <summary>La forma en disco del registro de ofensas.</summary>
public sealed class EstadoOfensas
{
    [JsonPropertyName("ofensas")]
    public Dictionary<string, OfensaDispositivo> Ofensas { get; set; } = new();
}

/// <summary>
/// Contador persistente de ofensas por clave de dispositivo.
/// Se carga al construirse y se guarda en cada cambio, con la
/// escritura atómica de ArchivoJson.
/// </summary>
public sealed class RegistroOfensas
{
    public const string NombreArchivo = "ofensas.json";

    private readonly object _lock = new();
    private readonly string _ruta;
    private readonly Dictionary<string, OfensaDispositivo> _ofensas;

    public RegistroOfensas(string? directorioDatos = null)
    {
        _ruta = Path.Combine(
            directorioDatos ?? Registro.DirectorioDatos, NombreArchivo);
        var estado = ArchivoJson.Leer<EstadoOfensas>(_ruta);
        _ofensas = estado?.Ofensas ?? new Dictionary<string, OfensaDispositivo>();
    }

    /// <summary>El peldaño que toca para un conteo dado.</summary>
    public static NivelRespuesta NivelPara(int conteo) => conteo switch
    {
        <= 0 => NivelRespuesta.Ninguno,
        1 => NivelRespuesta.Aviso,
        2 => NivelRespuesta.BloqueoSesion,
        _ => NivelRespuesta.Apagado,
    };

    /// <summary>
    /// Anota una ofensa nueva de este dispositivo y devuelve su
    /// conteo actualizado (el peldaño sale de NivelPara).
    /// </summary>
    public int Registrar(string clave, DateTime ahoraUtc)
    {
        lock (_lock)
        {
            _ofensas.TryGetValue(clave, out var ficha);
            var conteo = (ficha?.Conteo ?? 0) + 1;
            _ofensas[clave] = new OfensaDispositivo
            {
                Conteo = conteo,
                Ultima = ahoraUtc.ToString("o"),
            };
            Guardar();
            return conteo;
        }
    }

    /// <summary>El conteo vigente de un dispositivo (0 si nunca).</summary>
    public int Conteo(string clave)
    {
        lock (_lock)
            return _ofensas.TryGetValue(clave, out var ficha) ? ficha.Conteo : 0;
    }

    /// <summary>
    /// Olvida las ofensas de un dispositivo: se llama cuando el
    /// veredicto de la lista blanca pasa a ser «dentro» — el
    /// dispositivo es autorizado y su historial se cierra.
    /// </summary>
    public void Olvidar(string clave)
    {
        lock (_lock)
        {
            if (_ofensas.Remove(clave))
                Guardar();
        }
    }

    private void Guardar() =>
        ArchivoJson.EscribirAtomico(_ruta, new EstadoOfensas { Ofensas = _ofensas });
}
