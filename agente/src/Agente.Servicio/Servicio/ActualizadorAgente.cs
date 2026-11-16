// -*- coding: utf-8 -*-
// Ejecutor de las órdenes del canal del agente («actualizar» y
// «desinstalar»), a propósito SIMPLE, como la instalación pero
// al revés: el servicio recibe la orden, lo anota todo en
// agente.log y lanza una COPIA temporal de sí mismo con el modo
// que hace la mano de obra (la copia puede parar el servicio
// porque ella no es el servicio). Nada de vigías ni de estados
// intermedios con vida propia: cada paso deja su línea en el
// registro y cada informe al panel deja constancia de si fue
// aceptado o rechazado — una orden nunca más se queda muda.
//
// Actualizar: manifiesto del panel → informe EN_CURSO →
// descarga → verificación de tamaño y SHA-256 → la copia
// («aplicar-actualizacion») para el servicio, renombra el exe
// actual a «.anterior», copia el nuevo y reinicia. Esta
// instancia muere en el intercambio y NO informa del final: al
// rearrancar, la orden sigue EN_CURSO y se concilia — si la
// versión en marcha ya es la objetivo, se informa HECHA; si no,
// se reintenta hasta el tope de intentos.
//
// Desinstalar: informe EN_CURSO → la copia se prepara →
// informe HECHA (el panel borra la fila del equipo al
// recibirla) → la copia («desinstalar-orden») espera un
// temporizador de cortesía para que ese aviso llegue y se
// asiente, y después para el servicio, lo desregistra y borra
// la carpeta de instalación.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Procesa las órdenes («actualizar» y «desinstalar») que trae la configuración.</summary>
public sealed class ActualizadorAgente
{
    /// <summary>El mismo tope que impone el panel al informar.</summary>
    public const int MaxIntentos = 3;

    // Segundos que la copia desinstaladora espera antes de tocar
    // nada: el margen para que el informe HECHA —que el servicio
    // manda ANTES de lanzar la copia— llegue al panel y quede
    // asentado, y para que el servicio vuelque su propio
    // registro antes de que lo paren.
    private const int SegundosEsperaDesinstalacion = 30;

    private static readonly Registrador Log = Registro.Obtener("servicio");

    private readonly ClientePanel _cliente;
    private int _enCurso;

    public ActualizadorAgente(ClientePanel cliente) => _cliente = cliente;

    /// <summary>
    /// Atiende las órdenes en segundo plano (la descarga pesa
    /// ~95 MB: no puede bloquear el latido que la descubrió).
    /// Si una tanda anterior sigue en curso, esta espera al
    /// próximo ciclo de configuración — y queda escrito, que
    /// antes la tanda se descartaba en silencio.
    /// </summary>
    public void ProcesarEnSegundoPlano(List<OrdenAgente> ordenes)
    {
        if (ordenes.Count == 0) return;
        if (Interlocked.Exchange(ref _enCurso, 1) == 1)
        {
            Log.Info(
                $"Órdenes: hay una tanda en curso; {ordenes.Count} orden(es) esperan al próximo ciclo.");
            return;
        }
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

    /// <summary>
    /// Informa al panel dejando eco en el registro: aceptado o
    /// rechazado, el intento queda escrito. Lo importante es que
    /// ningún informe fallido pase sin dejar línea, que era la
    /// enfermedad de antes (una HECHA rechazada por el estado
    /// se tragaba sin ruido y la orden se quedaba abierta para
    /// siempre).
    /// </summary>
    private async Task<bool> InformarAsync(
        OrdenAgente orden, string estado,
        string? detalle = null, string? versionObjetivo = null)
    {
        var aceptado = await _cliente.InformarOrdenAsync(
            orden.Id, estado, detalle, versionObjetivo).ConfigureAwait(false);
        if (aceptado)
            Log.Info($"Orden {orden.Tipo} {orden.Id}: informe {estado} aceptado por el panel.");
        else
            Log.Error(
                $"Orden {orden.Tipo} {orden.Id}: el panel NO aceptó el informe {estado} " +
                "(estado incompatible o sin conexión); la orden seguirá viniendo en la configuración.");
        return aceptado;
    }

    private async Task ProcesarAsync(OrdenAgente orden)
    {
        // Una orden cancelada no se ejecuta ni se informa: el
        // panel la da por terminal y cualquier informe sería
        // rechazado. Solo queda anotarlo.
        if (string.Equals(orden.Estado, "CANCELADA", StringComparison.OrdinalIgnoreCase))
        {
            Log.Info($"Orden {orden.Tipo} {orden.Id} cancelada en el panel: se ignora.");
            return;
        }

        if (string.Equals(orden.Tipo, "desinstalar", StringComparison.OrdinalIgnoreCase))
        {
            await EjecutarDesinstalacionAsync(orden).ConfigureAwait(false);
            return;
        }

        if (!string.Equals(orden.Tipo, "actualizar", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.Equals(orden.Estado, "EN_CURSO", StringComparison.OrdinalIgnoreCase))
            {
                await InformarAsync(orden, "ERROR",
                    $"Tipo de orden no soportado por esta versión del agente: {orden.Tipo}")
                    .ConfigureAwait(false);
            }
            else
            {
                Log.Advertencia(
                    $"Orden {orden.Id}: tipo no soportado ({orden.Tipo}) y ya en curso; se deja como está.");
            }
            return;
        }

        var versionActual = ClientePanel.VersionAgente;

        // Conciliación tras el reinicio de una actualización: la
        // orden quedó EN_CURSO cuando el servicio viejo paró a
        // mitad del intercambio, y la trae la primera
        // configuración del servicio nuevo.
        if (string.Equals(orden.Estado, "EN_CURSO", StringComparison.OrdinalIgnoreCase))
        {
            if (orden.VersionObjetivo is not null &&
                string.Equals(orden.VersionObjetivo, versionActual, StringComparison.Ordinal))
            {
                Log.Info($"Actualización confirmada: ya corre la versión {versionActual}.");
                if (await InformarAsync(orden, "HECHA",
                        $"Actualización confirmada tras el reinicio: versión {versionActual}.")
                        .ConfigureAwait(false))
                {
                    // Asentada: el respaldo ya no hace falta.
                    try
                    {
                        File.Delete(Instalador.RutaExeInstalado() + ".anterior");
                        Log.Info("Respaldo «.anterior» retirado: la actualización quedó asentada.");
                    }
                    catch { /* el borrado es lo de menos */ }
                }
                return;
            }
            if (orden.Intentos >= MaxIntentos)
            {
                await InformarAsync(orden, "ERROR",
                    "La actualización agotó sus intentos sin confirmarse.")
                    .ConfigureAwait(false);
                return;
            }
            Log.Info("La actualización anterior no se confirmó: se reintenta.");
        }

        await EjecutarActualizacionAsync(orden).ConfigureAwait(false);
    }

    /// <summary>
    /// La orden «desinstalar»: el espejo de la instalación
    /// remota. Allí el empujador copiaba el exe y un servicio
    /// temporal lo ejecutaba en modo «instalar-remoto»; aquí el
    /// servicio prepara su propia copia en modo
    /// «desinstalar-orden», informa HECHA al panel —que borra
    /// la fila del equipo al recibirla— y la copia, tras un
    /// temporizador de cortesía, para el servicio, lo
    /// desregistra y borra la carpeta de instalación. El
    /// informe sale del servicio, con su cliente y su
    /// credencial de siempre: la copia no habla con el panel,
    /// solo hace la mano de obra y la deja escrita.
    /// </summary>
    private async Task EjecutarDesinstalacionAsync(OrdenAgente orden)
    {
        Log.Info($"Orden de desinstalación {orden.Id}: empieza el proceso.");

        // Si una copia desinstaladora ya está en marcha, ella
        // manda: lanzar otra pisaría su trabajo a medias.
        if (HayCopiaDesinstaladoraEnMarcha())
        {
            Log.Info("Ya hay una copia desinstaladora trabajando: no se lanza otra.");
            return;
        }

        if (!await InformarAsync(orden, "EN_CURSO").ConfigureAwait(false)) return;
        if (await OrdenCanceladaAsync(orden).ConfigureAwait(false)) return;

        string instalado;
        try
        {
            instalado = Instalador.RutaExeInstalado();
        }
        catch (Exception exc)
        {
            await InformarAsync(orden, "ERROR",
                $"No se pudo localizar el ejecutable instalado: {exc.Message}")
                .ConfigureAwait(false);
            return;
        }
        if (string.IsNullOrWhiteSpace(instalado) || !File.Exists(instalado))
        {
            await InformarAsync(orden, "ERROR",
                "No se localizó el ejecutable instalado.").ConfigureAwait(false);
            return;
        }

        // La copia se prepara ANTES de informar HECHA: si algo
        // falla aquí, la orden se cierra con ERROR y el equipo
        // sigue en el panel, no dado por desinstalado a ciegas.
        string copia;
        try
        {
            var carpeta = Path.Combine(Path.GetTempPath(), "USBMonitorActualizacion");
            Directory.CreateDirectory(carpeta);
            copia = Path.Combine(carpeta, "USBMonitorDesinstalador.exe");
            File.Copy(instalado, copia, overwrite: true);
            Log.Info($"Copia desinstaladora preparada en {copia}.");
        }
        catch (Exception exc)
        {
            await InformarAsync(orden, "ERROR",
                $"No se pudo preparar la desinstalación: {exc.Message}")
                .ConfigureAwait(false);
            return;
        }

        // El aviso de «desinstalado» sale AHORA, del servicio, y
        // la copia espera su temporizador antes de tocar nada:
        // cuando pare el servicio, el panel ya borró la fila.
        if (!await InformarAsync(orden, "HECHA",
                "Desinstalación en marcha: el agente se detiene y se borra solo.")
                .ConfigureAwait(false))
            return;

        try
        {
            var proceso = Process.Start(new ProcessStartInfo
            {
                FileName = copia,
                Arguments = $"desinstalar-orden {orden.Id} {SegundosEsperaDesinstalacion}",
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(copia)!,
            });
            if (proceso is null) throw new InvalidOperationException("Process.Start devolvió null.");
            Log.Info(
                $"Copia desinstaladora lanzada (pid {proceso.Id}): esperará " +
                $"{SegundosEsperaDesinstalacion} s y desinstalará el agente con su carpeta.");
        }
        catch (Exception exc)
        {
            // La orden ya consta HECHA en el panel y no hay
            // marcha atrás desde aquí: queda el registro local
            // como testigo de que la copia no arrancó.
            Log.Error($"La desinstalación se informó pero la copia no arrancó: {exc.Message}");
        }
    }

    /// <summary>¿Sigue viva una copia desinstaladora (el ejecutable temporal de la orden)?</summary>
    private static bool HayCopiaDesinstaladoraEnMarcha()
    {
        try
        {
            return Process.GetProcessesByName("USBMonitorDesinstalador").Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private async Task EjecutarActualizacionAsync(OrdenAgente orden)
    {
        var manifiesto = await _cliente.ManifiestoPaqueteAsync().ConfigureAwait(false);
        if (manifiesto is null)
        {
            await InformarAsync(orden, "ERROR",
                "El panel no tiene paquete de actualización.").ConfigureAwait(false);
            return;
        }
        Log.Info(
            $"Orden de actualización {orden.Id}: paquete del panel = " +
            $"versión {manifiesto.Version}, {manifiesto.Tamano} bytes.");

        // Punto de control: si el administrador canceló mientras
        // tanto, no se informa nada más y no se descarga nada.
        if (await OrdenCanceladaAsync(orden).ConfigureAwait(false)) return;

        var versionActual = ClientePanel.VersionAgente;
        if (manifiesto.Version is not null &&
            string.Equals(manifiesto.Version, versionActual, StringComparison.Ordinal))
        {
            // Ya corre la versión del paquete: la orden se cierra
            // pasando por EN_CURSO, porque el panel solo acepta
            // HECHA desde EN_CURSO. Informar HECHA directamente
            // era rechazado sin dejar rastro y la orden se
            // quedaba abierta para siempre.
            Log.Info($"El equipo ya corre la versión del paquete ({versionActual}): se cierra la orden.");
            if (await InformarAsync(orden, "EN_CURSO", versionObjetivo: manifiesto.Version)
                    .ConfigureAwait(false))
            {
                await InformarAsync(orden, "HECHA",
                    $"El equipo ya corría la versión del paquete ({versionActual}).")
                    .ConfigureAwait(false);
            }
            return;
        }
        if (orden.Intentos >= MaxIntentos)
        {
            await InformarAsync(orden, "ERROR",
                "La actualización agotó sus intentos.").ConfigureAwait(false);
            return;
        }

        if (!await InformarAsync(orden, "EN_CURSO", versionObjetivo: manifiesto.Version)
                .ConfigureAwait(false))
            return;

        var carpeta = Path.Combine(Path.GetTempPath(), "USBMonitorActualizacion");
        var rutaNuevo = Path.Combine(carpeta, "USBMonitorService.exe.nuevo");
        Log.Info($"Descargando el paquete del panel en {rutaNuevo}…");
        if (!await _cliente.DescargarPaqueteAsync(rutaNuevo, async pct =>
            {
                // Progreso en la propia orden (Tareas lo enseña):
                // los informes EN_CURSO dentro del mismo intento
                // no queman cupo de intentos en el panel.
                await _cliente.InformarOrdenAsync(orden.Id, "EN_CURSO",
                    $"Descargando el paquete ({pct} %).").ConfigureAwait(false);
            }).ConfigureAwait(false))
        {
            await InformarAsync(orden, "ERROR",
                "No se pudo descargar el paquete del panel.").ConfigureAwait(false);
            return;
        }

        var info = new FileInfo(rutaNuevo);
        if (manifiesto.Tamano > 0 && info.Length != manifiesto.Tamano)
        {
            await InformarAsync(orden, "ERROR",
                $"El tamaño descargado ({info.Length}) no coincide con el manifiesto ({manifiesto.Tamano}).")
                .ConfigureAwait(false);
            return;
        }
        var hash = Sha256DeArchivo(rutaNuevo);
        if (!string.Equals(hash, manifiesto.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            try { File.Delete(rutaNuevo); } catch { /* el error ya va informado */ }
            await InformarAsync(orden, "ERROR",
                "El SHA-256 del paquete descargado no coincide con el manifiesto: no se aplica.")
                .ConfigureAwait(false);
            return;
        }
        Log.Info("Paquete descargado y verificado (tamaño y SHA-256 correctos).");

        // Último punto de control: la descarga ya está verificada
        // y lo siguiente es lanzar la copia aplicadora; desde que
        // el intercambio arranca, la actualización ya no se puede
        // cancelar. Si la cancelación llegó durante la descarga,
        // se abandona aquí y el temporal se borra.
        if (await OrdenCanceladaAsync(orden).ConfigureAwait(false))
        {
            try { File.Delete(rutaNuevo); } catch { /* temporal */ }
            return;
        }

        string instalado;
        try
        {
            instalado = Instalador.RutaExeInstalado();
        }
        catch (Exception exc)
        {
            await InformarAsync(orden, "ERROR",
                $"No se pudo localizar el ejecutable instalado: {exc.Message}")
                .ConfigureAwait(false);
            return;
        }
        if (string.IsNullOrWhiteSpace(instalado) || !File.Exists(instalado))
        {
            await InformarAsync(orden, "ERROR",
                "El agente no está instalado como servicio en esta PC.")
                .ConfigureAwait(false);
            return;
        }

        await InformarAsync(orden, "EN_CURSO",
            "Aplicando la actualización: el servicio se reiniciará.")
            .ConfigureAwait(false);

        // La copia aplicadora: el modo «aplicar-actualizacion» no
        // puede correr desde el archivo instalado (se renombra a
        // sí mismo), así que se lanza desde una copia temporal.
        // Su receta es la simple: parar el servicio, renombrar el
        // exe actual a «.anterior», copiar el nuevo y reiniciar;
        // cada paso queda en agente.log con la etiqueta
        // «aplicador».
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
            Log.Info(
                $"Copia aplicadora lanzada (pid {proceso.Id}): detendrá el servicio, " +
                "cambiará el ejecutable y lo reiniciará.");
        }
        catch (Exception exc)
        {
            await InformarAsync(orden, "ERROR",
                $"No se pudo lanzar la aplicación de la actualización: {exc.Message}")
                .ConfigureAwait(false);
        }
        // Sin informe final aquí: el servicio va a parar. La orden
        // queda EN_CURSO y se concilia al rearrancar (ver arriba).
    }

    /// <summary>
    /// True si el panel canceló la orden: se abandona sin
    /// informar (la orden es terminal y el informe sería
    /// rechazado). Un silencio del panel NO cancela: sin
    /// respuesta, la orden sigue su curso.
    /// </summary>
    private async Task<bool> OrdenCanceladaAsync(OrdenAgente orden)
    {
        var viva = await _cliente.OrdenSigueVivaAsync(orden.Id).ConfigureAwait(false);
        if (viva == false)
        {
            Log.Info($"La orden {orden.Tipo} {orden.Id} fue cancelada en el panel: se abandona.");
            return true;
        }
        return false;
    }

    private static string Sha256DeArchivo(string ruta)
    {
        using var flujo = File.OpenRead(ruta);
        return Convert.ToHexString(SHA256.HashData(flujo)).ToLowerInvariant();
    }
}
