// -*- coding: utf-8 -*-
// Persistencia del apagado ante dispositivos fuera de la lista
// blanca: el diario en disco que le quita la amnesia al agente.
//
// El problema: causantes, cuenta en curso y vencimiento vivían
// solo en la memoria del proceso. La parada ordenada cancela la
// cuenta, pero si el proceso muere con Windows vivo (un cuelgue,
// un kill, un corte de luz que no apaga la máquina), la cuenta
// atrás de Windows — que es del sistema operativo, no del
// agente — sigue corriendo huérfana: el agente nuevo toma el
// dispositivo como línea base al arrancar y jamás la cancela.
// La PC se apaga «sola» y nadie sabe por qué.
//
// El arreglo: cada cambio del estado se refleja en
// <datos>/apagado.json (escritura atómica, como el resto del
// estado del agente). Al arrancar, el servicio lee el diario y
// reconcilia con lo que sigue enchufado, según la decisión pura
// de ReconciliacionApagado:
//
//  - La cuenta sigue en plazo y algún causante sigue conectado:
//    se ADOPTA. La cuenta de Windows sigue corriendo por su
//    lado; el agente recupera los causantes (que dejan de ser
//    línea base) para poder cancelarla si se extraen.
//  - La cuenta sigue en plazo pero ya no queda ningún causante:
//    se CANCELA con «shutdown /a»: era huérfana.
//  - El plazo ya venció sin el agente en marcha: NO se rearma
//    (lo conectado al arrancar es línea base; rearmar crearía
//    el bucle de apagados que la línea base existe para
//    evitar). Se registra el incidente y se olvida.
//  - Sin cuenta en curso no hay nada que reconciliar.
using System.Globalization;
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>La foto del estado del apagado que se guarda en disco.</summary>
public sealed class EstadoApagado
{
    /// <summary>Claves de los dispositivos causantes de la cuenta.</summary>
    [JsonPropertyName("causantes")] public List<string> Causantes { get; set; } = new();
    /// <summary>True si Windows tiene una cuenta atrás corriendo.</summary>
    [JsonPropertyName("cuentaEnCurso")] public bool CuentaEnCurso { get; set; }
    /// <summary>Instante ISO (UTC) en que vence la cuenta; vacío si no se conoce.</summary>
    [JsonPropertyName("venceUtc")] public string VenceUtc { get; set; } = "";
    /// <summary>Segundos de la cuenta que armó el panel, para el registro.</summary>
    [JsonPropertyName("segundos")] public int Segundos { get; set; }
}

/// <summary>Qué hacer al arrancar con el diario heredado.</summary>
public enum AccionReconciliacionApagado
{
    /// <summary>Sin cuenta viva que reconciliar: el diario se olvida.</summary>
    Nada,
    /// <summary>La cuenta sigue en plazo y quedan causantes: se adopta.</summary>
    AdoptarCuenta,
    /// <summary>La cuenta sigue en plazo pero sin causantes: se cancela.</summary>
    CancelarCuenta,
    /// <summary>El plazo venció sin el agente: se registra, no se rearma.</summary>
    RegistrarVencida,
}

/// <summary>La decisión pura de reconciliación, separable de Windows.</summary>
public static class ReconciliacionApagado
{
    /// <summary>
    /// Decide qué hacer con el diario heredado. Devuelve la
    /// acción y los causantes que siguen conectados (la
    /// intersección con `clavesPresentes`). Un vencimiento
    /// ilegible se trata como cuenta viva: adoptar el estado
    /// permite cancelarla si el causante se extrae, y un
    /// «shutdown /a» de más es inocuo si la cuenta ya no existe.
    /// </summary>
    public static (AccionReconciliacionApagado Accion, List<string> CausantesVivos) Decidir(
        EstadoApagado? estado,
        IEnumerable<string> clavesPresentes,
        DateTime ahoraUtc)
    {
        var vivos = new List<string>();
        if (estado is null || !estado.CuentaEnCurso || estado.Causantes.Count == 0)
            return (AccionReconciliacionApagado.Nada, vivos);

        var presentes = new HashSet<string>(clavesPresentes, StringComparer.Ordinal);
        foreach (var clave in estado.Causantes)
            if (presentes.Contains(clave))
                vivos.Add(clave);

        if (!DateTime.TryParse(
                estado.VenceUtc, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var vence))
            return (AccionReconciliacionApagado.AdoptarCuenta, vivos);

        if (ahoraUtc >= vence)
            return (AccionReconciliacionApagado.RegistrarVencida, vivos);

        return vivos.Count > 0
            ? (AccionReconciliacionApagado.AdoptarCuenta, vivos)
            : (AccionReconciliacionApagado.CancelarCuenta, vivos);
    }
}

/// <summary>El diario del apagado: leer, guardar y borrar `apagado.json`.</summary>
public static class GestorApagado
{
    public const string NombreArchivo = "apagado.json";

    public static string Ruta(string directorioDatos) =>
        Path.Combine(directorioDatos, NombreArchivo);

    /// <summary>El estado guardado, o null si no hay diario.</summary>
    public static EstadoApagado? Leer(string directorioDatos) =>
        ArchivoJson.Leer<EstadoApagado>(Ruta(directorioDatos));

    /// <summary>Guarda el estado (escritura atómica).</summary>
    public static void Guardar(string directorioDatos, EstadoApagado estado) =>
        ArchivoJson.EscribirAtomico(Ruta(directorioDatos), estado);

    /// <summary>Borra el diario: ya no hay cuenta que recordar.</summary>
    public static void Borrar(string directorioDatos)
    {
        try
        {
            var ruta = Ruta(directorioDatos);
            if (File.Exists(ruta)) File.Delete(ruta);
        }
        catch
        {
            // Best-effort: un diario rebelde se reconcilia en el
            // siguiente arranque y se vuelve a intentar borrar.
        }
    }
}
