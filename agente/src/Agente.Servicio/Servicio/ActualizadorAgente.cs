// -*- coding: utf-8 -*-
// Ejecutor de la orden «actualizar» del canal del agente (fase B
// del plan de instalación remota): el agente se actualiza a sí
// mismo con el paquete que sirve el panel, sin credenciales de
// administrador ni puertos entrantes en el equipo.
//
// Pasos: manifiesto (versión + SHA-256) → informe EN_CURSO →
// descarga a temporal → verificación de tamaño y hash → lanzar
// una COPIA del exe instalado en modo «aplicar-actualizacion»
// (fase A). Esa copia para el servicio y sustituye el archivo:
// esta instancia muere a mitad de la operación y NO informa del
// final. Al rearrancar, la orden sigue EN_CURSO en la siguiente
// configuración y se concilia: si la versión en marcha ya es la
// objetivo, se informa HECHA; si no (la copia restauró la
// anterior), se reintenta hasta el tope de intentos.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Procesa las órdenes «actualizar» que trae la configuración.</summary>
public sealed class ActualizadorAgente
{
    /// <summary>El mismo tope que impone el panel al informar.</summary>
    public const int MaxIntentos = 3;

    private static readonly Registrador Log = Registro.Obtener("servicio");

    private readonly ClientePanel _cliente;
    private int _enCurso;

    public ActualizadorAgente(ClientePanel cliente) => _cliente = cliente;

    /// <summary>
    /// Atiende las órdenes en segundo plano (la descarga pesa
    /// ~140 MB: no puede bloquear el latido que la descubrió).
    /// Una segunda llamada mientras una actualización corre no
    /// hace nada.
    /// </summary>
    public void ProcesarEnSegundoPlano(List<OrdenAgente> ordenes)
    {
        if (ordenes.Count == 0) return;
        if (Interlocked.Exchange(ref _enCurso, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            try
            {
                foreach (var orden in ordenes)
                    await ProcesarAsync(orden).ConfigureAwait(false);
            }
            catch (Exception exc)
            {
                Log.Error($"Órdenes del panel: {exc.Message}");
            }
            finally
            {
                Interlocked.Exchange(ref _enCurso, 0);
            }
        });
    }

    private async Task ProcesarAsync(OrdenAgente orden)
    {
        if (!string.Equals(orden.Tipo, "actualizar", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.Equals(orden.Estado, "EN_CURSO", StringComparison.OrdinalIgnoreCase))
            {
                await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                    $"Tipo de orden no soportado por esta versión del agente: {orden.Tipo}")
                    .ConfigureAwait(false);
            }
            return;
        }

        var versionActual = ClientePanel.VersionAgente;

        // Conciliación tras el reinicio de una actualización.
        if (string.Equals(orden.Estado, "EN_CURSO", StringComparison.OrdinalIgnoreCase))
        {
            if (orden.VersionObjetivo is not null &&
                string.Equals(orden.VersionObjetivo, versionActual, StringComparison.Ordinal))
            {
                Log.Info($"Actualización confirmada: ya corre la versión {versionActual}.");
                await _cliente.InformarOrdenAsync(orden.Id, "HECHA",
                    $"Actualización confirmada tras el reinicio: versión {versionActual}.")
                    .ConfigureAwait(false);
                return;
            }
            if (orden.Intentos >= MaxIntentos)
            {
                await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                    "La actualización agotó sus intentos sin confirmarse.")
                    .ConfigureAwait(false);
                return;
            }
            Log.Info("La actualización anterior no se confirmó: se reintenta.");
        }

        await EjecutarActualizacionAsync(orden).ConfigureAwait(false);
    }

    private async Task EjecutarActualizacionAsync(OrdenAgente orden)
    {
        var manifiesto = await _cliente.ManifiestoPaqueteAsync().ConfigureAwait(false);
        if (manifiesto is null)
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                "El panel no tiene paquete de actualización.").ConfigureAwait(false);
            return;
        }

        var versionActual = ClientePanel.VersionAgente;
        if (manifiesto.Version is not null &&
            string.Equals(manifiesto.Version, versionActual, StringComparison.Ordinal))
        {
            await _cliente.InformarOrdenAsync(orden.Id, "HECHA",
                $"El equipo ya corría la versión del paquete ({versionActual}).")
                .ConfigureAwait(false);
            return;
        }
        if (orden.Intentos >= MaxIntentos)
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                "La actualización agotó sus intentos.").ConfigureAwait(false);
            return;
        }

        var aceptada = await _cliente.InformarOrdenAsync(
            orden.Id, "EN_CURSO", versionObjetivo: manifiesto.Version).ConfigureAwait(false);
        if (!aceptada)
        {
            Log.Error("El panel no aceptó el inicio de la actualización; se deja para el próximo ciclo.");
            return;
        }

        var carpeta = Path.Combine(Path.GetTempPath(), "USBMonitorActualizacion");
        var rutaNuevo = Path.Combine(carpeta, "USBMonitorService.exe.nuevo");
        if (!await _cliente.DescargarPaqueteAsync(rutaNuevo).ConfigureAwait(false))
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                "No se pudo descargar el paquete del panel.").ConfigureAwait(false);
            return;
        }

        var info = new FileInfo(rutaNuevo);
        if (manifiesto.Tamano > 0 && info.Length != manifiesto.Tamano)
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                $"El tamaño descargado ({info.Length}) no coincide con el manifiesto ({manifiesto.Tamano}).")
                .ConfigureAwait(false);
            return;
        }
        var hash = Sha256DeArchivo(rutaNuevo);
        if (!string.Equals(hash, manifiesto.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            try { File.Delete(rutaNuevo); } catch { /* el error ya va informado */ }
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                "El SHA-256 del paquete descargado no coincide con el manifiesto: no se aplica.")
                .ConfigureAwait(false);
            return;
        }

        string instalado;
        try
        {
            instalado = Instalador.RutaExeInstalado();
        }
        catch (Exception exc)
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                $"No se pudo localizar el ejecutable instalado: {exc.Message}")
                .ConfigureAwait(false);
            return;
        }
        if (string.IsNullOrWhiteSpace(instalado) || !File.Exists(instalado))
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                "El agente no está instalado como servicio en esta PC.")
                .ConfigureAwait(false);
            return;
        }

        // La copia aplicadora: el modo «aplicar-actualizacion» no
        // puede correr desde el archivo instalado (se renombra a
        // sí mismo), así que se lanza desde una copia temporal.
        var aplicador = Path.Combine(carpeta, "USBMonitorAplicador.exe");
        try
        {
            File.Copy(instalado, aplicador, overwrite: true);
            var proceso = Process.Start(new ProcessStartInfo
            {
                FileName = aplicador,
                Arguments = $"aplicar-actualizacion \"{rutaNuevo}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = carpeta,
            });
            if (proceso is null) throw new InvalidOperationException("Process.Start devolvió null.");
            Log.Info("Actualización en marcha: la copia aplicadora tomará el relevo y el servicio se reiniciará.");
        }
        catch (Exception exc)
        {
            await _cliente.InformarOrdenAsync(orden.Id, "ERROR",
                $"No se pudo lanzar la aplicación de la actualización: {exc.Message}")
                .ConfigureAwait(false);
        }
        // Sin informe final aquí: el servicio va a parar. La orden
        // queda EN_CURSO y se concilia al rearrancar (ver arriba).
    }

    private static string Sha256DeArchivo(string ruta)
    {
        using var flujo = File.OpenRead(ruta);
        return Convert.ToHexString(SHA256.HashData(flujo)).ToLowerInvariant();
    }
}
