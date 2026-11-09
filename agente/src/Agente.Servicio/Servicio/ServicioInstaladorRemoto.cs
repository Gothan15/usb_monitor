// -*- coding: utf-8 -*-
// El servicio temporal de la instalación remota: lo crea el
// empujador en el equipo destino (vía SCM remoto) para correr el
// modo `instalar-remoto` del agente, y se borra al terminar.
//
// Hasta la 2.0 el instalador corría como proceso de consola
// dentro del servicio: nunca decía «ya arranqué» al gestor de
// servicios, Windows lo daba por no respondido a los ~30 s
// (error 1053) y el empujador se rendía —a veces matando la
// instalación a medias— aunque el trabajo siguiera su curso.
// Ahora el instalador ES un servicio de verdad: el anfitrión
// responde al SCM en cuanto arranca, el trabajo corre en segundo
// plano y al terminar el servicio se detiene solo con el código
// de salida de la instalación, que es lo que el empujador lee.
using Microsoft.Extensions.Hosting;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio;

/// <summary>Los argumentos con los que el SCM lanzó el instalador.</summary>
public sealed record ParametrosInstalacionRemota(string[] Argumentos);

/// <summary>El instalador remoto como servicio temporal de Windows.</summary>
public sealed class ServicioInstaladorRemoto : BackgroundService
{
    /// <summary>El nombre con el que el empujador crea este servicio.</summary>
    public const string NombreServicioTemporal = "USBMonitorInstalador";

    private static readonly Registrador Log = Registro.Obtener("instalador-remoto");

    private readonly string[] _argumentos;
    private readonly IHostApplicationLifetime _vida;

    public ServicioInstaladorRemoto(
        ParametrosInstalacionRemota parametros,
        IHostApplicationLifetime vida)
    {
        _argumentos = parametros.Argumentos;
        _vida = vida;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // El trabajo corre fuera del hilo de arranque: el
        // anfitrión ya ha dicho «en marcha» al SCM cuando esto
        // empieza, que es justo lo que faltaba con el 1053.
        return Task.Run(() =>
        {
            var salida = 1;
            try
            {
                salida = Program.InstalarRemoto(_argumentos);
            }
            catch (Exception exc)
            {
                Log.Excepcion("La instalación remota explotó fuera de su cauce", exc);
            }
            // El código de salida del PROCESO es el que el SCM
            // anota para el servicio y el que el empujador lee
            // al verlo parado: 0 = instalado, otro = el fallo.
            Environment.ExitCode = salida;
            _vida.StopApplication();
        }, stoppingToken);
    }
}
