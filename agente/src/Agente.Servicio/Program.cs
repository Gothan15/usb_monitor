// -*- coding: utf-8 -*-
// USBMonitor en C# — UN solo ejecutable para todo el agente.
// Espejo de los modos de servicio.py:
//
//   (ninguno)    el servicio, bajo el SCM de Windows (o la caja de
//                herramientas si se lanza a mano con doble clic)
//   gui          la caja de herramientas del administrador (o el
//                asistente de configuración, si es la primera vez:
//                el equipo aún no tiene credencial)
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
//   fijar-codigo guarda el código de enrolamiento cifrado y sale (lo usa
//                Install-Service.ps1 tras escribir server.json)
//   instalar-remoto
//                instalación sin asistente para el empujón del panel
//                (SMB+RPC): escribe server.json y el código que trae
//                en los argumentos e instala, sin abrir ventanas
//   aplicar-actualizacion
//                sustituye el ejecutable instalado por otro ya
//                descargado y verificado, y rearranca el servicio;
//                lo lanza el propio agente desde una COPIA temporal
//                de sí mismo (el archivo en uso no se puede pisar)
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

            case "fijar-codigo":
                Registro.Configurar("agente.log");
                if (args.Length < 2 || string.IsNullOrWhiteSpace(args[1]))
                {
                    Console.WriteLine("Falta el código: USBMonitorService.exe fijar-codigo <valor>");
                    return 1;
                }
                if (new Configuracion().GuardarCodigoEnrolamiento(args[1].Trim()))
                {
                    Console.WriteLine("Código de enrolamiento guardado (cifrado): el servicio lo gastará al arrancar.");
                    return 0;
                }
                Console.WriteLine("No se pudo guardar el código.");
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

            case "instalar-remoto":
                Registro.Configurar("agente.log");
                if (WindowsServiceHelpers.IsWindowsService())
                {
                    // Quien lanza este modo es el SCM (el servicio
                    // temporal del empujón): hay que hablar el
                    // protocolo de servicios. Como proceso de
                    // consola a secas, el instalador trabajaba sin
                    // decir «ya arranqué», Windows lo daba por no
                    // respondido a los ~30 s (error 1053) y el
                    // empujador se rendía —a veces matándolo a
                    // mitad de la instalación— aunque en el destino
                    // todo pareciera ir bien.
                    EjecutarInstaladorRemotoComoServicio(args);
                    return 0;
                }
                return InstalarRemoto(args);

            case "aplicar-actualizacion":
                Registro.Configurar("agente.log");
                if (args.Length < 2 || string.IsNullOrWhiteSpace(args[1]))
                {
                    Console.WriteLine(
                        "Falta el ejecutable nuevo: USBMonitorService.exe aplicar-actualizacion <ruta>");
                    return 1;
                }
                try
                {
                    Console.WriteLine(Instalador.AplicarActualizacion(args[1].Trim()));
                    return 0;
                }
                catch (Exception exc)
                {
                    Console.WriteLine($"No se pudo actualizar: {exc.Message}");
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
                PresentarConsola();
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
    /// Instalación sin asistente para el empujón del panel
    /// (modelo Kaspersky: SMB + servicio temporal). Sintaxis:
    ///   instalar-remoto --servidor <host>[:<puerto>] --codigo <valor>
    /// Escribe la configuración del panel y el código de enrolamiento y
    /// después instala como el modo `instalar`, sin abrir ninguna
    /// ventana: quien lo lanza es un servicio temporal en sesión 0.
    /// </summary>
    internal static int InstalarRemoto(string[] args)
    {
        try
        {
            return InstalarRemotoPasos(args);
        }
        finally
        {
            // Proceso corto: sin este vuelco final, las líneas
            // del registro que aún estén en el búfer (se vuelca
            // cada 2 s) se pierden al salir. Era media historia
            // de por qué la instalación remota no dejaba rastro
            // en agente.log; la otra media es que este modo no
            // escribía ni una línea: solo hablaba por una consola
            // que, corriendo como servicio, no existe.
            Registro.Vaciar();
        }
    }

    private static int InstalarRemotoPasos(string[] args)
    {
        var log = Registro.Obtener("instalador-remoto");
        var servidor = LeerOpcion(args, "--servidor");
        var codigo = LeerOpcion(args, "--codigo");
        if (string.IsNullOrWhiteSpace(servidor) || string.IsNullOrWhiteSpace(codigo))
        {
            log.Error("Instalación remota sin --servidor o sin --codigo: no se toca nada.");
            Console.WriteLine(
                "Uso: USBMonitorService.exe instalar-remoto --servidor <host>[:<puerto>] --codigo <valor>");
            return 2;
        }

        // La dirección se interpreta con la misma regla que el
        // resto del agente (DireccionServidor): el corte a mano
        // que había aquí dejaba el host como «172.29.176.1:» si
        // el servidor venía como «host::3000», y esa URL
        // imposible ciega al agente entero.
        var partes = DireccionServidor.IntentarInterpretar(servidor);
        if (partes is null)
        {
            log.Error($"Dirección del panel inválida en --servidor («{servidor}»): no se toca nada.");
            Console.WriteLine(
                "La dirección del panel no es válida: usa host[:puerto].");
            return 2;
        }
        var host = partes.Host;
        var puerto = partes.Puerto ?? 3000;

        // El código NO se escribe nunca en el registro: solo se
        // dice que llegó y dónde apunta el panel.
        log.Info($"Instalación remota iniciada: panel en {host}:{puerto}, código de enrolamiento recibido.");
        var configuracion = new Configuracion();
        if (!configuracion.Guardar(new Dictionary<string, object?>
            {
                ["serverHost"] = host,
                ["serverPort"] = puerto,
            }))
        {
            log.Error("No se pudo escribir server.json con la dirección del panel.");
            Console.WriteLine("No se pudo escribir server.json.");
            return 1;
        }
        if (!configuracion.GuardarCodigoEnrolamiento(codigo.Trim()))
        {
            log.Error("No se pudo guardar el código de enrolamiento en server.json.");
            Console.WriteLine("No se pudo guardar el código de enrolamiento.");
            return 1;
        }
        log.Info("Configuración escrita: dirección del panel y código (cifrado). Se instala el servicio…");

        string resumen;
        try
        {
            resumen = Instalador.Instalar();
        }
        catch (Exception exc)
        {
            log.Excepcion("La instalación del servicio falló", exc);
            Console.WriteLine($"No se pudo instalar: {exc.Message}");
            return 1;
        }
        log.Info(resumen);
        Console.WriteLine(resumen);

        // Instalación remota = nadie delante de la PC: se deja
        // en el escritorio público el acceso directo a la caja
        // de herramientas, para que quien llegue al equipo la
        // encuentre sin saber rutas. Es un adorno útil, no parte
        // de la instalación: si falla, queda en el registro y el
        // resultado sigue siendo «instalado».
        Instalador.CrearAccesoDirectoEscritorio();
        log.Info("Instalación remota terminada: el servicio gastará el código al arrancar y el equipo se enrolará solo.");
        return 0;
    }

    /// <summary>
    /// El modo `instalar-remoto` corriendo COMO servicio de
    /// Windows: el anfitrión responde al SCM en cuanto arranca
    /// (así desaparece el error 1053) y el trabajo de verdad
    /// corre en segundo plano dentro de ServicioInstaladorRemoto,
    /// que al terminar detiene el servicio con su código de
    /// salida: el empujador lo espera y lo lee como el de
    /// cualquier servicio.
    /// </summary>
    private static void EjecutarInstaladorRemotoComoServicio(string[] args)
    {
        var builder = Host.CreateDefaultBuilder(Array.Empty<string>());
        builder.UseWindowsService(options =>
        {
            options.ServiceName = ServicioInstaladorRemoto.NombreServicioTemporal;
        });
        builder.ConfigureServices(servicios =>
        {
            servicios.AddSingleton(new ParametrosInstalacionRemota(args));
            servicios.AddHostedService<ServicioInstaladorRemoto>();
        });
        builder.Build().Run();
    }

    /// <summary>Valor de una opción «--nombre valor» en los argumentos.</summary>
    private static string? LeerOpcion(string[] args, string nombre)
    {
        for (var i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], nombre, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }
        return null;
    }

    /// <summary>
    /// Primera vez en este equipo: no hay credencial de ninguna
    /// clase (ni clave ni código pendiente), así que el equipo no
    /// está dado de alta en el panel y toca pasar por el asistente
    /// de configuración. Si la configuración no se puede ni leer,
    /// también es primera vez.
    /// </summary>
    private static bool EsPrimeraVez()
    {
        try
        {
            var config = new Configuracion();
            return !config.TieneClave &&
                   config.CodigoEnrolamiento is null;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// La portada de la consola en el modo de depuración: marco y
    /// nombre, sin adornos de relleno. Solo sale en consola
    /// interactiva (el servicio de Windows no tiene dónde pintarla).
    /// </summary>
    private static void PresentarConsola()
    {
        try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
        catch { /* la consola heredada manda */ }
        const int ancho = 62;
        var marco = new string('═', ancho - 2);
        string Fila(string texto)
        {
            if (texto.Length > ancho - 4)
                texto = texto[..(ancho - 4)];
            return $"║  {texto.PadRight(ancho - 4)}  ║";
        }
        Console.WriteLine($"╔{marco}╗");
        Console.WriteLine(Fila("USBMONITOR · AGENTE DE MONITOREO USB"));
        Console.WriteLine(Fila("Modo consola — depuración en esta ventana"));
        Console.WriteLine($"╠{marco}╣");
        Console.WriteLine(Fila($"Equipo     {Environment.MachineName}"));
        Console.WriteLine(Fila($"Arranque   {DateTime.Now:yyyy-MM-dd HH:mm:ss}"));
        Console.WriteLine($"╚{marco}╝");
        Console.WriteLine();
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
