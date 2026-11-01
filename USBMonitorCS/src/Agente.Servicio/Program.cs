// -*- coding: utf-8 -*-
// USBMonitor en C# — UN solo ejecutable para todo el agente.
// Espejo de los modos de servicio.py:
//
//   (ninguno)    el servicio, bajo el SCM de Windows (o la caja de
//                herramientas si se lanza a mano con doble clic)
//   gui          la caja de herramientas del administrador (o el
//                asistente de configuración, si es la primera vez:
//                el equipo aún no tiene token)
//   configurar   el asistente de configuración, siempre
//   prompt       el compañero (la ventana de la contraseña); lo
//                arranca la tarea de inicio de sesión
//   visor        el visor de seriales
//   instalar     instala el servicio (y la tarea del compañero) y
//                lo arranca; pide administrador
//   desinstalar  restaura todo, detiene y quita el servicio y la
//                tarea del compañero
//   restaurar    revierte todo lo del diario y sale (lo usa el
//                desinstalador antes de quitar el servicio)
//   debug        el agente en consola, para depurar
//   fijar-token  guarda el token del equipo cifrado y sale (lo usa
//                Install-Service.ps1 tras escribir server.json)
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using USBMonitor.Agente.Core;
using USBMonitor.Agente.Servicio;
using USBMonitor.Agente.Servicio.Ventanas;

namespace USBMonitor.Agente;

internal static class Program
{
    public static int Main(string[] args)
    {
        var modo = args.Length > 0 ? args[0].ToLowerInvariant() : null;
        switch (modo)
        {
            case "prompt":
                // El compañero configura su propio registro (companero.log).
                AppVentanas.EjecutarCompanero();
                return 0;

            case "gui":
                Registro.Configurar("agente.log");
                if (EsPrimeraVez())
                {
                    AppVentanas.EjecutarAsistente();
                }
                else
                {
                    AppVentanas.EjecutarToolbox();
                }
                return 0;

            case "configurar":
                Registro.Configurar("agente.log");
                AppVentanas.EjecutarAsistente();
                return 0;

            case "visor":
                Registro.Configurar("agente.log");
                AppVentanas.EjecutarVisor();
                return 0;

            case "fijar-token":
                Registro.Configurar("agente.log");
                if (args.Length < 2 || string.IsNullOrWhiteSpace(args[1]))
                {
                    Console.WriteLine("Falta el token: USBMonitorService.exe fijar-token <valor>");
                    return 1;
                }
                if (new Configuracion().GuardarTokenAgente(args[1].Trim()))
                {
                    Console.WriteLine("Token del equipo guardado (cifrado).");
                    return 0;
                }
                Console.WriteLine("No se pudo guardar el token.");
                return 1;

            case "instalar":
                Registro.Configurar("agente.log");
                try
                {
                    Console.WriteLine(Instalador.Instalar());
                    return 0;
                }
                catch (Exception exc)
                {
                    Console.WriteLine($"No se pudo instalar: {exc.Message}");
                    Console.WriteLine("Ejecuta este programa como administrador.");
                    return 1;
                }

            case "desinstalar":
                Registro.Configurar("agente.log");
                try
                {
                    Console.WriteLine(Instalador.Desinstalar());
                    return 0;
                }
                catch (Exception exc)
                {
                    Console.WriteLine($"No se pudo desinstalar: {exc.Message}");
                    Console.WriteLine("Ejecuta este programa como administrador.");
                    return 1;
                }

            case "restaurar":
                Registro.Configurar("agente.log");
                var resumen = Instalador.RestaurarSinServicio();
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    reactivados = resumen.Reactivados,
                    sin_revertir = resumen.SinRevertir,
                    automontaje = resumen.Automontaje,
                }));
                return 0;

            case "debug":
                Registro.Configurar("agente.log");
                EjecutarHost(comoServicio: false);
                return 0;

            case null:
                Registro.Configurar("agente.log");
                if (WindowsServiceHelpers.IsWindowsService())
                {
                    Registro.Obtener("servicio").Info("Servicio iniciado por el SCM");
                    EjecutarHost(comoServicio: true);
                }
                else
                {
                    // Lanzado a mano sin argumentos (doble clic): abre
                    // la caja de herramientas en vez de fallar contra
                    // el SCM, como el agente Python. Si es la primera
                    // vez en este equipo, abre el asistente.
                    if (EsPrimeraVez())
                    {
                        AppVentanas.EjecutarAsistente();
                    }
                    else
                    {
                        AppVentanas.EjecutarToolbox();
                    }
                }
                return 0;

            default:
                if (WindowsServiceHelpers.IsWindowsService())
                {
                    Registro.Configurar("agente.log");
                    EjecutarHost(comoServicio: true);
                    return 0;
                }
                Console.WriteLine($"Modo no reconocido: {args[0]}");
                Console.WriteLine("Modos: gui, configurar, prompt, visor, instalar, desinstalar, restaurar, debug");
                return 1;
        }
    }

    /// <summary>
    /// Primera vez en este equipo: aún no hay token guardado, así
    /// que el equipo no está dado de alta en el panel y toca pasar
    /// por el asistente de configuración. Si la configuración no se
    /// puede ni leer, también se considera primera vez.
    /// </summary>
    private static bool EsPrimeraVez()
    {
        try
        {
            return string.IsNullOrWhiteSpace(new Configuracion().TokenAgente);
        }
        catch
        {
            return true;
        }
    }

    private static void EjecutarHost(bool comoServicio)
    {
        // Sin args: el host no necesita los del modo (y un token suelto
        // como «debug» rompería el proveedor de configuración).
        var builder = Host.CreateDefaultBuilder(Array.Empty<string>());
        if (comoServicio)
        {
            builder.UseWindowsService(options =>
            {
                options.ServiceName = Instalador.NombreServicio;
            });
        }
        builder.ConfigureServices(servicios =>
        {
            servicios.AddHostedService<AgenteWorker>();
        });
        builder.Build().Run();
    }
}
