// -*- coding: utf-8 -*-
// Motor de bloqueo en capas, verificado, con vigía. Espejo de
// nucleo/bloqueo.py.
//
// Capas, en orden (cada una se comprueba contra el sistema, nunca se
// cree el «OK» de una llamada):
//   1. PNP: deshabilitar el nodo del dispositivo y verificar que
//      quedó deshabilitado (código de problema 22).
//   2. VOLUMEN: candado FSCTL (bloquear + desmontar, handle retenido)
//      con sonda de inaccesibilidad. Solo para dispositivos con letra.
//   3. SOLO_LECTURA: último recurso, declarado como degradado.
//
// Concurrencia (sin condiciones de carrera):
//   - Un lock global protege el registro de dispositivos y el mapa de
//     locks por dispositivo; cada transición de un dispositivo
//     (bloquear, liberar, extraer) ocurre bajo SU lock: dos hilos
//     nunca transicionan el mismo dispositivo a la vez. Los lock() de
//     C# son reentrantes por hilo, como los RLock de Python: el vigía
//     puede reaplicar llamando a Bloquear bajo el mismo lock.
//   - Bloquear y liberar son idempotentes.
//
// Sin huella: deshabilitar un nodo se anota en el Diario al momento;
// la anotación solo se borra cuando la reactivación se verifica.
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Capas de bloqueo, en orden de intento.</summary>
public static class CapaBloqueo
{
    public const string Pnp = "PNP";
    public const string Volumen = "VOLUMEN";
    public const string SoloLectura = "SOLO_LECTURA";
}

/// <summary>Estados de un registro de bloqueo.</summary>
public static class EstadoBloqueo
{
    public const string Bloqueado = "BLOQUEADO";
    public const string Liberado = "LIBERADO";
}

/// <summary>Seguimiento de un dispositivo conocido por el motor.</summary>
public sealed class RegistroBloqueo
{
    public required Dispositivo Dispositivo { get; set; }
    public string Estado { get; set; } = EstadoBloqueo.Liberado;
    public string? Capa { get; set; }
    public bool Degradado { get; set; }
    public bool? EnWhitelist { get; set; }
}

/// <summary>Motor de bloqueo en capas con vigía y restauración sin huella.</summary>
public sealed class MotorBloqueo
{
    // Ojo: cualificado entero porque esta clase tiene un método
    // Registro(string) que ocultaría la clase del Core.
    private static readonly Registrador Log =
        global::USBMonitor.Agente.Core.Registro.Obtener("bloqueo");

    private readonly Diario _diario;
    private readonly CandadosVolumen _candados;
    private readonly Func<string, bool>? _ponerSoloLectura;
    private readonly Func<string, bool>? _quitarSoloLectura;

    private readonly object _lockGlobal = new();
    private readonly Dictionary<string, RegistroBloqueo> _registros = new();
    private readonly Dictionary<string, object> _locks = new();

    /// <param name="ponerSoloLectura">Capa degradada (diskpart); la aporta el Worker.</param>
    /// <param name="quitarSoloLectura">Reversión de la capa degradada.</param>
    public MotorBloqueo(
        Diario diario,
        CandadosVolumen candados,
        Func<string, bool>? ponerSoloLectura = null,
        Func<string, bool>? quitarSoloLectura = null)
    {
        _diario = diario;
        _candados = candados;
        _ponerSoloLectura = ponerSoloLectura;
        _quitarSoloLectura = quitarSoloLectura;
    }

    // ── infraestructura de locks ──────────────────────────────────
    private object LockDe(string clave)
    {
        lock (_lockGlobal)
        {
            if (!_locks.TryGetValue(clave, out var candado))
            {
                candado = new object();
                _locks[clave] = candado;
            }
            return candado;
        }
    }

    public RegistroBloqueo? Registro(string clave)
    {
        lock (_lockGlobal)
            return _registros.TryGetValue(clave, out var reg) ? reg : null;
    }

    public List<RegistroBloqueo> Bloqueados()
    {
        lock (_lockGlobal)
            return _registros.Values.Where(r => r.Estado == EstadoBloqueo.Bloqueado).ToList();
    }

    public void Olvidar(string clave)
    {
        lock (_lockGlobal) _registros.Remove(clave);
    }

    // ── bloquear ──────────────────────────────────────────────────
    public RegistroBloqueo Bloquear(Dispositivo disp, bool? enWhitelist)
    {
        var clave = disp.Clave;
        lock (LockDe(clave))
        {
            RegistroBloqueo reg;
            lock (_lockGlobal)
            {
                if (!_registros.TryGetValue(clave, out var existente))
                {
                    reg = new RegistroBloqueo { Dispositivo = disp };
                    _registros[clave] = reg;
                }
                else
                {
                    reg = existente;
                    reg.Dispositivo = disp;
                }
                if (enWhitelist is not null) reg.EnWhitelist = enWhitelist;
            }
            if (reg.Estado == EstadoBloqueo.Bloqueado) return reg;

            // Capa 1: PnP verificado.
            if (Pnp.Deshabilitar(disp.InstanciaPnP))
            {
                _diario.AnotarDeshabilitado(disp.InstanciaPnP, disp.Serial);
                reg.Capa = CapaBloqueo.Pnp;
                reg.Degradado = false;
                reg.Estado = EstadoBloqueo.Bloqueado;
                Log.Info($"Bloqueado por PnP: {disp.Nombre} ({disp.Serial})");
                return reg;
            }

            // Capa 2: candado de volumen (solo con letra).
            var letra = disp.Letra;
            if (letra is not null && _candados.Bloquear(letra))
            {
                reg.Capa = CapaBloqueo.Volumen;
                reg.Degradado = false;
                reg.Estado = EstadoBloqueo.Bloqueado;
                Log.Info($"Bloqueado por volumen: {disp.Nombre} en {letra}");
                return reg;
            }

            // Capa 3: solo lectura, degradado y declarado.
            if (letra is not null && _ponerSoloLectura is not null && _ponerSoloLectura(letra))
            {
                reg.Capa = CapaBloqueo.SoloLectura;
                reg.Degradado = true;
                reg.Estado = EstadoBloqueo.Bloqueado;
                Log.Advertencia($"Bloqueo DEGRADADO (solo lectura) para {disp.Nombre} en {letra}");
                return reg;
            }

            Log.Error($"No se pudo bloquear {disp.Nombre} por ninguna capa");
            return reg;
        }
    }

    // ── liberar ───────────────────────────────────────────────────
    /// <summary>Idempotente: liberar algo no bloqueado devuelve True.</summary>
    public bool Liberar(string clave)
    {
        lock (LockDe(clave))
        {
            RegistroBloqueo? reg;
            lock (_lockGlobal) _registros.TryGetValue(clave, out reg);
            if (reg is null || reg.Estado != EstadoBloqueo.Bloqueado) return true;
            var disp = reg.Dispositivo;
            var ok = true;
            if (reg.Capa == CapaBloqueo.Pnp)
            {
                foreach (var letra in disp.Letras) _candados.Soltar(letra);
                if (Pnp.Habilitar(disp.InstanciaPnP))
                    _diario.QuitarDeshabilitado(disp.InstanciaPnP);
                else
                    ok = false;
            }
            else if (reg.Capa == CapaBloqueo.Volumen)
            {
                foreach (var letra in disp.Letras) _candados.Soltar(letra);
            }
            else if (reg.Capa == CapaBloqueo.SoloLectura)
            {
                if (_quitarSoloLectura is not null && disp.Letra is not null)
                    _quitarSoloLectura(disp.Letra);
            }
            if (ok)
            {
                reg.Estado = EstadoBloqueo.Liberado;
                reg.Capa = null;
                reg.Degradado = false;
                Log.Info($"Liberado: {disp.Nombre} ({disp.Serial})");
            }
            else
            {
                Log.Error($"Liberación incompleta de {disp.Nombre}");
            }
            return ok;
        }
    }

    public bool LiberarConReintentos(string clave, int[]? esperasSegundos = null)
    {
        esperasSegundos ??= new[] { 10, 30, 60 };
        if (Liberar(clave)) return true;
        foreach (var espera in esperasSegundos)
        {
            Thread.Sleep(TimeSpan.FromSeconds(espera));
            if (Liberar(clave)) return true;
        }
        return false;
    }

    // ── extracción ────────────────────────────────────────────────
    /// <summary>
    /// El dispositivo ya no está: se suelta todo y se revierte su nodo
    /// aunque esté desconectado (que la próxima vez entre normal).
    /// Sin esto, la v1 dejó una memoria muerta.
    /// </summary>
    public void AlExtraer(string clave)
    {
        lock (LockDe(clave))
        {
            RegistroBloqueo? reg;
            lock (_lockGlobal)
            {
                if (!_registros.Remove(clave, out reg)) return;
            }
            var disp = reg.Dispositivo;
            foreach (var letra in disp.Letras) _candados.Soltar(letra);
            if (reg.Capa == CapaBloqueo.Pnp || reg.Estado == EstadoBloqueo.Bloqueado)
            {
                if (Pnp.Habilitar(disp.InstanciaPnP))
                    _diario.QuitarDeshabilitado(disp.InstanciaPnP);
            }
        }
    }

    // ── vigía ─────────────────────────────────────────────────────
    /// <summary>
    /// Reaplica el bloqueo a lo que algo haya revivido.
    /// Devuelve las claves reaplicadas (para avisar al panel).
    /// </summary>
    public List<string> Vigilar()
    {
        var reaplicadas = new List<string>();
        foreach (var reg in Bloqueados())
        {
            var disp = reg.Dispositivo;
            var clave = disp.Clave;
            lock (LockDe(clave))
            {
                if (reg.Estado != EstadoBloqueo.Bloqueado) continue;
                var revivido = false;
                if (reg.Capa == CapaBloqueo.Pnp)
                {
                    revivido = Pnp.EstaDeshabilitado(disp.InstanciaPnP) == false;
                }
                else if (reg.Capa == CapaBloqueo.Volumen)
                {
                    revivido = disp.Letra is not null && Volumen.EsAccesible(disp.Letra);
                }
                if (revivido)
                {
                    Log.Advertencia($"Dispositivo revivido, reaplicando: {disp.Nombre}");
                    reg.Estado = EstadoBloqueo.Liberado;
                    reg.Capa = null;
                    Bloquear(disp, reg.EnWhitelist);
                    reaplicadas.Add(clave);
                }
            }
        }
        return reaplicadas;
    }

    // ── restauración total ────────────────────────────────────────
    /// <summary>Libera lo bloqueado y revierte el diario completo.</summary>
    public ResumenRestauracion RestaurarTodo()
    {
        foreach (var reg in Bloqueados())
            Liberar(reg.Dispositivo.Clave);
        _candados.SoltarTodos();
        return _diario.RestaurarTodo(Pnp.Habilitar, _ => true);
    }
}
