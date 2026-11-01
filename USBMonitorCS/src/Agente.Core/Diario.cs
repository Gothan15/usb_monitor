// -*- coding: utf-8 -*-
// Diario de cambios del sistema — la regla «sin huella», espejo de
// USBMonitor/nucleo/diario.py. Todo cambio persistente que el
// agente hace en Windows queda anotado aquí con su valor original:
// dispositivos deshabilitados (instancia exacta), el estado del
// automontaje, volúmenes retenidos y volúmenes en solo lectura. La
// restauración revierte exactamente eso, y solo borra una
// anotación cuando la reversión se confirma: lo que no se pudo
// revertir sigue en el diario para el próximo intento (al arrancar,
// al parar, al desinstalar o a mano).
using System.Text.Json.Serialization;

namespace USBMonitor.Agente.Core;

/// <summary>Anotación de un dispositivo deshabilitado por PnP.</summary>
public sealed class EntradaDispositivo
{
    [JsonPropertyName("serial")] public string? Serial { get; set; }
    [JsonPropertyName("desde")] public string? Desde { get; set; }
}

/// <summary>Anotación de un cambio sobre un volumen.</summary>
public sealed class EntradaVolumen
{
    [JsonPropertyName("letra")] public string? Letra { get; set; }
    [JsonPropertyName("desde")] public string? Desde { get; set; }
    [JsonPropertyName("datos")] public string? Datos { get; set; }
}

/// <summary>Resumen de una restauración total del diario.</summary>
public sealed class ResumenRestauracion
{
    public int Reactivados { get; set; }
    public int VolumenesRestaurados { get; set; }
    public List<string> SinRevertir { get; set; } = new();
    public bool? Automontaje { get; set; }
}

internal sealed class DatosDiario
{
    [JsonPropertyName("automontaje_original")] public bool? AutomontajeOriginal { get; set; }
    [JsonPropertyName("automontaje_desactivado")] public bool AutomontajeDesactivado { get; set; }
    [JsonPropertyName("dispositivos_deshabilitados")]
    public Dictionary<string, EntradaDispositivo> Dispositivos { get; set; } = new();
    [JsonPropertyName("volumenes_retenidos")]
    public Dictionary<string, EntradaVolumen> VolumenesRetenidos { get; set; } = new();
    [JsonPropertyName("solo_lectura")]
    public Dictionary<string, EntradaVolumen> SoloLectura { get; set; } = new();
}

/// <summary>Diario thread-safe con persistencia atómica en diario.json.</summary>
public sealed class Diario
{
    private static readonly Registrador Log = Registro.Obtener("diario");

    private readonly string _ruta;
    private readonly object _cerrojo = new();
    private readonly DatosDiario _datos;

    public Diario(string? directorioDatos = null)
    {
        _ruta = Path.Combine(directorioDatos ?? Registro.DirectorioDatos, "diario.json");
        _datos = Leer();
    }

    /// <summary>Crea el diario sobre un archivo concreto (pruebas).</summary>
    public Diario(string rutaArchivo, bool esRutaDirecta)
    {
        _ruta = esRutaDirecta ? rutaArchivo : Path.Combine(rutaArchivo, "diario.json");
        _datos = Leer();
    }

    // ── persistencia ─────────────────────────────────────────────

    private DatosDiario Leer()
    {
        var datos = ArchivoJson.Leer<DatosDiario>(_ruta);
        if (datos is null)
        {
            if (File.Exists(_ruta))
                Log.Advertencia("Diario ilegible, se empieza de cero");
            return new DatosDiario();
        }
        datos.Dispositivos ??= new Dictionary<string, EntradaDispositivo>();
        datos.VolumenesRetenidos ??= new Dictionary<string, EntradaVolumen>();
        datos.SoloLectura ??= new Dictionary<string, EntradaVolumen>();
        return datos;
    }

    private void Persistir()
    {
        // Se llama siempre con el cerrojo tomado.
        try
        {
            ArchivoJson.EscribirAtomico(_ruta, _datos);
        }
        catch (Exception exc)
        {
            Log.Error($"No se pudo persistir el diario: {exc.Message}");
        }
    }

    private static string Ahora() => DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss");

    // ── consultas ────────────────────────────────────────────────

    public bool HayPendientes
    {
        get
        {
            lock (_cerrojo)
            {
                return _datos.Dispositivos.Count > 0
                    || _datos.VolumenesRetenidos.Count > 0
                    || _datos.SoloLectura.Count > 0
                    || _datos.AutomontajeDesactivado;
            }
        }
    }

    public IReadOnlyDictionary<string, EntradaDispositivo> DispositivosDeshabilitados
    {
        get
        {
            lock (_cerrojo)
            {
                return new Dictionary<string, EntradaDispositivo>(_datos.Dispositivos);
            }
        }
    }

    // ── anotaciones ──────────────────────────────────────────────

    public void AnotarAutomontaje(bool original, bool desactivado)
    {
        lock (_cerrojo)
        {
            _datos.AutomontajeOriginal ??= original;
            _datos.AutomontajeDesactivado = desactivado;
            Persistir();
        }
    }

    public void AnotarDeshabilitado(string instancia, string? serial)
    {
        lock (_cerrojo)
        {
            _datos.Dispositivos[instancia] = new EntradaDispositivo
            {
                Serial = serial,
                Desde = Ahora(),
            };
            Persistir();
        }
    }

    public void QuitarDeshabilitado(string instancia)
    {
        lock (_cerrojo)
        {
            if (_datos.Dispositivos.Remove(instancia))
                Persistir();
        }
    }

    public void AnotarVolumenRetenido(string clave, string? letra, string? datos = null)
    {
        lock (_cerrojo)
        {
            _datos.VolumenesRetenidos[clave] = new EntradaVolumen
            {
                Letra = letra,
                Desde = Ahora(),
                Datos = datos,
            };
            Persistir();
        }
    }

    public void QuitarVolumenRetenido(string clave)
    {
        lock (_cerrojo)
        {
            if (_datos.VolumenesRetenidos.Remove(clave))
                Persistir();
        }
    }

    public void AnotarSoloLectura(string clave, string? letra, string? datos = null)
    {
        lock (_cerrojo)
        {
            _datos.SoloLectura[clave] = new EntradaVolumen
            {
                Letra = letra,
                Desde = Ahora(),
                Datos = datos,
            };
            Persistir();
        }
    }

    public void QuitarSoloLectura(string clave)
    {
        lock (_cerrojo)
        {
            if (_datos.SoloLectura.Remove(clave))
                Persistir();
        }
    }

    // ── restauración ─────────────────────────────────────────────

    /// <summary>
    /// Revierte todo lo anotado. Solo borra lo confirmado.
    /// <paramref name="rehabilitar"/>(instancia) → true si el
    /// dispositivo quedó habilitado;
    /// <paramref name="fijarAutomontaje"/>(activo) → true si el
    /// automontaje quedó como se pide;
    /// <paramref name="revertirVolumen"/>(clave) → true si el volumen
    /// retenido o en solo lectura quedó liberado.
    /// </summary>
    public ResumenRestauracion RestaurarTodo(
        Func<string, bool> rehabilitar,
        Func<bool, bool>? fijarAutomontaje = null,
        Func<string, bool>? revertirVolumen = null)
    {
        var resumen = new ResumenRestauracion();
        lock (_cerrojo)
        {
            foreach (var instancia in _datos.Dispositivos.Keys.ToList())
            {
                bool ok;
                try { ok = rehabilitar(instancia); }
                catch (Exception exc)
                {
                    Log.Error($"Reactivando {instancia}: {exc.Message}");
                    ok = false;
                }
                if (ok)
                {
                    _datos.Dispositivos.Remove(instancia);
                    resumen.Reactivados++;
                }
                else
                {
                    resumen.SinRevertir.Add(instancia);
                }
            }
            foreach (var (coleccion, _) in new[] { (_datos.VolumenesRetenidos, "retenido"), (_datos.SoloLectura, "solo_lectura") })
            {
                foreach (var clave in coleccion.Keys.ToList())
                {
                    bool ok = false;
                    if (revertirVolumen is not null)
                    {
                        try { ok = revertirVolumen(clave); }
                        catch (Exception exc)
                        {
                            Log.Error($"Revirtiendo volumen {clave}: {exc.Message}");
                            ok = false;
                        }
                    }
                    if (ok)
                    {
                        coleccion.Remove(clave);
                        resumen.VolumenesRestaurados++;
                    }
                    else
                    {
                        resumen.SinRevertir.Add(clave);
                    }
                }
            }
            if (_datos.AutomontajeDesactivado && _datos.AutomontajeOriginal is bool original)
            {
                bool ok = false;
                if (fijarAutomontaje is not null)
                {
                    try { ok = fijarAutomontaje(original); }
                    catch (Exception exc)
                    {
                        Log.Error($"Restaurando automontaje: {exc.Message}");
                        ok = false;
                    }
                }
                if (ok)
                {
                    _datos.AutomontajeDesactivado = false;
                    resumen.Automontaje = original;
                }
                else
                {
                    resumen.SinRevertir.Add("automontaje");
                }
            }
            Persistir();
        }
        if (resumen.SinRevertir.Count > 0)
            Log.Advertencia($"Restauración incompleta: {string.Join(", ", resumen.SinRevertir)}");
        else
            Log.Info($"Restauración completa: {resumen.Reactivados} reactivados, {resumen.VolumenesRestaurados} volúmenes");
        return resumen;
    }
}
