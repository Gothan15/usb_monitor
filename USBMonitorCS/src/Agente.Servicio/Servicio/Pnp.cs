// -*- coding: utf-8 -*-
// Costuras PnP de Windows (cfgmgr32) — la única puerta del agente a
// los nodos de dispositivo. Espejo de nucleo/pnp.py.
//
// Regla de oro de la v2: ninguna acción se da por buena por el código
// de retorno de la llamada; se VERIFICA leyendo el estado real del
// nodo después (código de problema 22 = deshabilitado).
//
// Los nodos «fantasma» (dispositivo ya extraído) también se localizan:
// reactivar un nodo desconectado es lo que garantiza que esa memoria
// vuelva a entrar normal la próxima vez (el fallo de la v1 con la
// SanDisk Cruzer: quedó deshabilitada para siempre).
using System.Runtime.InteropServices;
using System.Text;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>P/Invoke sobre cfgmgr32 con verificación de estado.</summary>
public static class Pnp
{
    private static readonly Registrador Log = Registro.Obtener("pnp");

    private const uint CmProbDisabled = 22;
    private const uint CmLocateDevnodeNormal = 0x00000000;
    private const uint CmLocateDevnodePhantom = 0x00000001;
    private const int CrSuccess = 0;

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, EntryPoint = "CM_Locate_DevNodeW")]
    private static extern int CM_Locate_DevNodeW(out uint devInst, string deviceId, uint flags);

    [DllImport("cfgmgr32.dll", EntryPoint = "CM_Disable_DevNode")]
    private static extern int CM_Disable_DevNode(uint devInst, uint flags);

    [DllImport("cfgmgr32.dll", EntryPoint = "CM_Enable_DevNode")]
    private static extern int CM_Enable_DevNode(uint devInst, uint flags);

    [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_DevNode_Status")]
    private static extern int CM_Get_DevNode_Status(out uint status, out uint problem, uint devInst, uint flags);

    [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_Parent")]
    private static extern int CM_Get_Parent(out uint parent, uint devInst, uint flags);

    [DllImport("cfgmgr32.dll", EntryPoint = "CM_Get_Device_ID_Size")]
    private static extern int CM_Get_Device_ID_Size(out uint len, uint devInst, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, EntryPoint = "CM_Get_Device_IDW")]
    private static extern int CM_Get_Device_IDW(uint devInst, StringBuilder buffer, uint bufferLen, uint flags);

    private static uint? LocalizarNodo(string instancia, bool fantasma)
    {
        var resultado = CM_Locate_DevNodeW(
            out var devInst, instancia,
            fantasma ? CmLocateDevnodePhantom : CmLocateDevnodeNormal);
        return resultado == CrSuccess ? devInst : null;
    }

    /// <summary>Localiza el nodo, presente o fantasma; null si no existe.</summary>
    public static uint? Localizar(string instancia)
    {
        return LocalizarNodo(instancia, fantasma: false) ?? LocalizarNodo(instancia, fantasma: true);
    }

    private static (uint Estado, uint Problema) EstadoDe(uint devInst)
    {
        var resultado = CM_Get_DevNode_Status(out var status, out var problema, devInst, 0);
        return resultado == CrSuccess ? (status, problema) : (0u, 0u);
    }

    /// <summary>True/False según el nodo; null si el nodo no se puede leer.</summary>
    public static bool? EstaDeshabilitado(string instancia)
    {
        var devInst = Localizar(instancia);
        if (devInst is null) return null;
        var (_, problema) = EstadoDe(devInst.Value);
        return problema == CmProbDisabled;
    }

    private static bool EsperarEstado(string instancia, bool deshabilitado, double segundos = 3.0)
    {
        var limite = DateTime.UtcNow.AddSeconds(segundos);
        while (DateTime.UtcNow <= limite)
        {
            if (EstaDeshabilitado(instancia) == deshabilitado) return true;
            Thread.Sleep(150);
        }
        return EstaDeshabilitado(instancia) == deshabilitado;
    }

    /// <summary>Deshabilita el nodo y VERIFICA que quedó deshabilitado.</summary>
    public static bool Deshabilitar(string instancia, double segundos = 3.0)
    {
        var devInst = LocalizarNodo(instancia, fantasma: false);
        if (devInst is null)
        {
            Log.Advertencia($"No se localizó el nodo para deshabilitar: {instancia}");
            return false;
        }
        if (EstaDeshabilitado(instancia) == true) return true;
        var resultado = CM_Disable_DevNode(devInst.Value, 0);
        if (resultado != CrSuccess)
            Log.Advertencia($"CM_Disable_DevNode({instancia}) -> {resultado}");
        return EsperarEstado(instancia, deshabilitado: true, segundos);
    }

    /// <summary>
    /// Deshabilita EN CADENA y devuelve el nodo que quedó
    /// deshabilitado (null si ninguno cedió). Primero el propio
    /// nodo; si no cede, el nodo USB del dispositivo (USB\VID_…,
    /// jamás el concentrador raíz ni el controlador:
    /// deshabilitarlos tumbaría todos los USB).
    ///
    /// Existe por los DISCOS DUROS externos: su nodo de disco a
    /// menudo no llega al código 22 — Windows lo deja en «necesita
    /// reinicio» por ser un disco fijo con volúmenes montados — y
    /// el bloqueo caía degradado a solo lectura, mientras las
    /// memorias (extraíbles) sí ceden al momento. El nodo USB del
    /// dispositivo sí se puede deshabilitar en caliente y tumba
    /// toda la pila, como al expulsar el dispositivo.
    ///
    /// Las esperas son CORTAS a propósito: un nodo que va a ceder
    /// llega al código 22 en uno o dos segundos; el que no cede
    /// no lo hace ni en diez. Con 10 s por nodo, una memoria
    /// tardaba hasta 20 s en quedar bloqueada y la ventana del
    /// compañero salía tardísimo, mientras un teléfono (cuyo
    /// nodo cede al instante) aparecía enseguida.
    /// </summary>
    public static string? DeshabilitarConCadena(
        string instancia, double segundosPropio = 3, double segundosAncestro = 5)
    {
        if (Deshabilitar(instancia, segundosPropio)) return instancia;
        foreach (var ancestro in Ancestros(instancia))
        {
            var a = ancestro.ToUpperInvariant();
            if (!a.StartsWith("USB\\VID_")) continue;
            if (Deshabilitar(ancestro, segundosAncestro))
            {
                Log.Info($"Bloqueado por el nodo USB del dispositivo: {ancestro}");
                return ancestro;
            }
        }
        return null;
    }

    /// <summary>Habilita el nodo (presente o fantasma) y VERIFICA el resultado.</summary>
    public static bool Habilitar(string instancia)
    {
        var devInst = Localizar(instancia);
        if (devInst is null)
        {
            // El nodo ya no existe en el sistema: nada que revertir.
            Log.Info($"Nodo inexistente al habilitar (nada que revertir): {instancia}");
            return true;
        }
        if (EstaDeshabilitado(instancia) == false) return true;
        var resultado = CM_Enable_DevNode(devInst.Value, 0);
        if (resultado != CrSuccess)
            Log.Advertencia($"CM_Enable_DevNode({instancia}) -> {resultado}");
        return EsperarEstado(instancia, deshabilitado: false);
    }

    private static string? IdDe(uint devInst)
    {
        if (CM_Get_Device_ID_Size(out var largo, devInst, 0) != CrSuccess || largo == 0)
            return null;
        var bufer = new StringBuilder((int)largo + 1);
        if (CM_Get_Device_IDW(devInst, bufer, (uint)bufer.Capacity, 0) != CrSuccess)
            return null;
        return bufer.ToString();
    }

    /// <summary>Instancias padre (hasta <paramref name="maximo"/>), para clasificar discos SCSI.</summary>
    public static List<string> Ancestros(string instancia, int maximo = 3)
    {
        var resultado = new List<string>();
        var devInst = LocalizarNodo(instancia, fantasma: false);
        if (devInst is null) return resultado;
        var actual = devInst.Value;
        for (var i = 0; i < maximo; i++)
        {
            if (CM_Get_Parent(out var padre, actual, 0) != CrSuccess) break;
            actual = padre;
            var identificador = IdDe(actual);
            if (string.IsNullOrEmpty(identificador)) break;
            resultado.Add(identificador);
        }
        return resultado;
    }

    /// <summary>True si algún ancestro pertenece al enumerador USB.</summary>
    public static bool TieneAncestroUsb(string instancia, int maximo = 3)
    {
        foreach (var ancestro in Ancestros(instancia, maximo))
        {
            var a = ancestro.ToUpperInvariant();
            if (a.StartsWith("USB\\") || a.Contains("\\USB\\")) return true;
        }
        return false;
    }
}
