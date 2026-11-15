// -*- coding: utf-8 -*-
// Pruebas de la captura de evidencia: el gestor de la carpeta
// (solicitud → paquete → subida) y el cuerpo que va al panel.
// La captura Win32 en sí vive en el compañero y no se prueba aquí.
using System.Text.Json;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class EvidenciaTests
{
    private const string Clave = "USB\\VID_0781&PID_5567\\123456";

    private static string CarpetaNueva() =>
        GestorEvidencia.Carpeta(Fabrica.DirectorioTemporal());

    [Fact]
    public void NombreSeguro_NoLlevaCaracteresDeRutaYEsEstable()
    {
        var nombre = GestorEvidencia.NombreSeguro(Clave);
        Assert.DoesNotContain("\\", nombre);
        Assert.DoesNotContain("/", nombre);
        Assert.Equal(nombre, GestorEvidencia.NombreSeguro(Clave.ToLowerInvariant()));
    }

    [Fact]
    public void Solicitar_UnaSolaVezPorBloqueo()
    {
        var carpeta = CarpetaNueva();
        Assert.True(GestorEvidencia.Solicitar(carpeta, Clave, "S1", "2026-11-05T12:00:00Z"));
        // La segunda petición para el mismo bloqueo se ignora.
        Assert.False(GestorEvidencia.Solicitar(carpeta, Clave, "S1", "2026-11-05T12:00:01Z"));

        var solicitudes = GestorEvidencia.ListarSolicitudes(carpeta);
        var unica = Assert.Single(solicitudes);
        Assert.Equal(Clave, unica.Clave);
        Assert.Equal("S1", unica.Serial);
    }

    [Fact]
    public void Solicitar_ConPaqueteYaCapturadoNoSeRepite()
    {
        var carpeta = CarpetaNueva();
        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia { Clave = Clave });
        Assert.False(GestorEvidencia.Solicitar(carpeta, Clave, "S1", "2026-11-05T12:00:00Z"));
        Assert.Empty(GestorEvidencia.ListarSolicitudes(carpeta));
    }

    [Fact]
    public void Paquete_IdaYVueltaConservaLosCamposDelContrato()
    {
        var carpeta = CarpetaNueva();
        var paquete = new PaqueteEvidencia
        {
            Clave = Clave,
            Serial = "S1",
            CapturedAt = "2026-11-05T12:00:05Z",
            ForegroundProcess = "WINWORD",
            ForegroundTitle = "informe.docx - Word",
            Processes = new() { new ProcesoEvidencia { Proceso = "WINWORD", Titulo = "informe.docx - Word" } },
            BrowserTabs = new() { new PestanaNavegador { Navegador = "chrome", Titulo = "Panel", Url = "http://panel" } },
            TabsComplete = false,
            Nota = "sin captura de pantalla",
            ImagenBase64 = "AAAA",
        };
        GestorEvidencia.GuardarPaquete(carpeta, paquete);

        // Las solicitudes y los paquetes no se mezclan al listar.
        Assert.Empty(GestorEvidencia.ListarSolicitudes(carpeta));
        var leido = Assert.Single(GestorEvidencia.ListarPaquetes(carpeta));
        Assert.Equal(Clave, leido.Clave);
        Assert.Equal("WINWORD", leido.ForegroundProcess);
        Assert.Equal("informe.docx - Word", leido.Processes[0].Titulo);
        Assert.Equal("http://panel", leido.BrowserTabs[0].Url);
        Assert.False(leido.TabsComplete);
        Assert.Equal("AAAA", leido.ImagenBase64);

        // El JSON del paquete usa los nombres del contrato.
        var ruta = GestorEvidencia.RutaPaquete(carpeta, Clave);
        var json = File.ReadAllText(ruta);
        Assert.Contains("\"capturedAt\"", json);
        Assert.Contains("\"browserTabs\"", json);
        Assert.Contains("\"tabsComplete\"", json);
        Assert.Contains("\"imagenBase64\"", json);

        // Y un paquete sin nota ni imagen no escribe esas claves.
        var carpeta2 = CarpetaNueva();
        GestorEvidencia.GuardarPaquete(carpeta2,
            new PaqueteEvidencia { Clave = Clave, CapturedAt = "2026-11-05T12:00:05Z" });
        var jsonLimpio = File.ReadAllText(GestorEvidencia.RutaPaquete(carpeta2, Clave));
        Assert.DoesNotContain("imagenBase64", jsonLimpio);
        Assert.DoesNotContain("\"nota\"", jsonLimpio);
    }

    [Fact]
    public void BorrarSolicitudYPaquete()
    {
        var carpeta = CarpetaNueva();
        GestorEvidencia.Solicitar(carpeta, Clave, "S1", "2026-11-05T12:00:00Z");
        GestorEvidencia.BorrarSolicitud(carpeta, Clave);
        Assert.Empty(GestorEvidencia.ListarSolicitudes(carpeta));
        // Tras borrar la solicitud se puede volver a pedir (p. ej.
        // la captura anterior nunca llegó a paquete).
        Assert.True(GestorEvidencia.Solicitar(carpeta, Clave, "S1", "2026-11-05T12:00:02Z"));

        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia { Clave = Clave });
        GestorEvidencia.BorrarPaquete(carpeta, Clave);
        Assert.Empty(GestorEvidencia.ListarPaquetes(carpeta));
    }

    [Fact]
    public void TopePaquetes_BorraLosMasAntiguos()
    {
        var carpeta = CarpetaNueva();
        for (var i = 0; i < 5; i++)
        {
            var clave = $"USB\\VID_000{i}";
            GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia
            {
                Clave = clave,
                CapturedAt = $"2026-11-05T12:00:0{i}Z",
            });
            // Antigüedad creciente y determinista por fecha del archivo.
            File.SetLastWriteTimeUtc(
                GestorEvidencia.RutaPaquete(carpeta, clave),
                new DateTime(2026, 11, 5, 12, 0, i, DateTimeKind.Utc));
        }
        var borradas = GestorEvidencia.AplicarTopePaquetes(carpeta, maximo: 3);
        Assert.Equal(2, borradas.Count);
        Assert.Contains("USB\\VID_0000", borradas);
        Assert.Contains("USB\\VID_0001", borradas);
        Assert.Equal(3, GestorEvidencia.ListarPaquetes(carpeta).Count);
        // Las solicitudes no cuentan para el tope ni se borran.
        GestorEvidencia.Solicitar(carpeta, "USB\\VID_9999", "S9", "2026-11-05T12:01:00Z");
        Assert.Single(GestorEvidencia.ListarSolicitudes(carpeta));
    }

    [Fact]
    public async Task SubirEvidencia_EnviaElCuerpoDelContrato()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(200, """{"ok":true,"id":"ev1"}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);

        var paquete = new PaqueteEvidencia
        {
            Clave = Clave,
            Serial = "S1",
            CapturedAt = "2026-11-05T12:00:05Z",
            ForegroundProcess = "explorer",
            Processes = new() { new ProcesoEvidencia { Proceso = "explorer" } },
            BrowserTabs = new(),
            TabsComplete = true,
        };
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Subida,
            await cliente.SubirEvidenciaAsync("bloqueo-7", paquete));

        var ruta = Assert.Single(manejador.Rutas);
        Assert.Equal("/api/usb-event/evidence", ruta);
        using var doc = JsonDocument.Parse(Assert.Single(manejador.Cuerpos));
        var raiz = doc.RootElement;
        Assert.Equal("bloqueo-7", raiz.GetProperty("pendingUnlockId").GetString());
        Assert.Equal("S1", raiz.GetProperty("serialNumber").GetString());
        Assert.Equal("explorer", raiz.GetProperty("processes")[0].GetProperty("proceso").GetString());
        Assert.True(raiz.GetProperty("tabsComplete").GetBoolean());
        // Sin imagen ni nota, las claves ni viajan.
        Assert.False(raiz.TryGetProperty("imagenBase64", out _));
    }

    [Fact]
    public async Task SubirEvidencia_BloqueoInexistenteEsRechazoPermanente()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(404, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);
        var paquete = new PaqueteEvidencia { Clave = Clave, CapturedAt = "2026-11-05T12:00:05Z" };
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Permanente,
            await cliente.SubirEvidenciaAsync("no-existe", paquete));
    }

    [Fact]
    public async Task SubirEvidencia_ErrorDelPanelEsFalloPasajero()
    {
        var manejador = new ManejadorFalso(_ => ManejadorFalso.Json(500, """{"ok":false}"""));
        var (config, datos) = Fabrica.ConfiguracionEnPuerto(9);
        using var cliente = new ClientePanel(config, manejador, datos);
        var paquete = new PaqueteEvidencia { Clave = Clave, CapturedAt = "2026-11-05T12:00:05Z" };
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Pasajera,
            await cliente.SubirEvidenciaAsync("bloqueo-7", paquete));
    }

    [Fact]
    public void ClasificarSubida_Solo400Y404SonPermanentes()
    {
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Subida,
            ClientePanel.ClasificarSubidaEvidencia(200, aceptada: true));
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Permanente,
            ClientePanel.ClasificarSubidaEvidencia(400, aceptada: false));
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Permanente,
            ClientePanel.ClasificarSubidaEvidencia(404, aceptada: false));
        // Ni la red caída, ni un 429, ni un 401 (la credencial se
        // arregla re-enrolando) condenan la evidencia.
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Pasajera,
            ClientePanel.ClasificarSubidaEvidencia(null, aceptada: false));
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Pasajera,
            ClientePanel.ClasificarSubidaEvidencia(429, aceptada: false));
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Pasajera,
            ClientePanel.ClasificarSubidaEvidencia(401, aceptada: false));
        Assert.Equal(
            ClientePanel.ResultadoSubidaEvidencia.Pasajera,
            ClientePanel.ClasificarSubidaEvidencia(200, aceptada: false));
    }

    [Fact]
    public void Solicitar_DosInstanciasDelMismoDispositivo_Conviven()
    {
        var carpeta = CarpetaNueva();
        // El primer bloqueo pide su foto; el segundo, del mismo
        // pendrive y con el primer paquete aún sin subir, pide
        // la suya: ya no se queda sin foto.
        Assert.True(GestorEvidencia.Solicitar(
            carpeta, Clave, "S1", "2026-11-05T12:00:00Z", "bloqueo-1", "bloqueo-1"));
        Assert.False(GestorEvidencia.Solicitar(
            carpeta, Clave, "S1", "2026-11-05T12:00:01Z", "bloqueo-1", "bloqueo-1"));
        Assert.True(GestorEvidencia.Solicitar(
            carpeta, Clave, "S1", "2026-11-05T12:05:00Z", "bloqueo-2", "bloqueo-2"));
        Assert.Equal(2, GestorEvidencia.ListarSolicitudes(carpeta).Count);
    }

    [Fact]
    public void PaquetesPorInstancia_NoSePisanNiSeBorranJuntos()
    {
        var carpeta = CarpetaNueva();
        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia
        {
            Clave = Clave, Instancia = "bloqueo-1", BloqueoId = "bloqueo-1",
            CapturedAt = "2026-11-05T12:00:05Z",
        });
        GestorEvidencia.GuardarPaquete(carpeta, new PaqueteEvidencia
        {
            Clave = Clave, Instancia = "bloqueo-2", BloqueoId = "bloqueo-2",
            CapturedAt = "2026-11-05T12:05:05Z",
        });
        Assert.Equal(2, GestorEvidencia.ListarPaquetes(carpeta).Count);

        GestorEvidencia.BorrarPaquete(carpeta, Clave, "bloqueo-1");
        var restante = Assert.Single(GestorEvidencia.ListarPaquetes(carpeta));
        Assert.Equal("bloqueo-2", restante.Instancia);
        Assert.Equal("bloqueo-2", restante.BloqueoId);
    }

    [Fact]
    public void MoverPaqueteADescartadas_SacaElPaqueteDeLaCola()
    {
        var carpeta = CarpetaNueva();
        GestorEvidencia.GuardarPaquete(carpeta,
            new PaqueteEvidencia { Clave = Clave, CapturedAt = "2026-11-05T12:00:05Z" });

        Assert.True(GestorEvidencia.MoverPaqueteADescartadas(carpeta, Clave));
        Assert.Empty(GestorEvidencia.ListarPaquetes(carpeta));
        var descartadas = GestorEvidencia.CarpetaDescartadas(carpeta);
        Assert.Single(GestorEvidencia.ListarPaquetes(descartadas));
        // Sin paquete no hay nada que mover.
        Assert.False(GestorEvidencia.MoverPaqueteADescartadas(carpeta, Clave));
    }

    [Fact]
    public void AplicarTopeEdad_MueveSoloLosPaquetesViejos()
    {
        var carpeta = CarpetaNueva();
        var ahora = new DateTime(2026, 11, 15, 12, 0, 0, DateTimeKind.Utc);
        GestorEvidencia.GuardarPaquete(carpeta,
            new PaqueteEvidencia { Clave = Clave, CapturedAt = "2026-11-05T12:00:05Z" });
        GestorEvidencia.GuardarPaquete(carpeta,
            new PaqueteEvidencia { Clave = "USB\\VID_0002", CapturedAt = "2026-11-14T12:00:05Z" });
        // El viejo lleva 10 días en disco; el nuevo, 1.
        File.SetLastWriteTimeUtc(
            GestorEvidencia.RutaPaquete(carpeta, Clave), ahora.AddDays(-10));
        File.SetLastWriteTimeUtc(
            GestorEvidencia.RutaPaquete(carpeta, "USB\\VID_0002"), ahora.AddDays(-1));

        var movidas = GestorEvidencia.AplicarTopeEdad(carpeta, dias: 7, ahora);

        Assert.Equal(new[] { Clave }, movidas);
        Assert.Single(GestorEvidencia.ListarPaquetes(carpeta));
        Assert.Single(GestorEvidencia.ListarPaquetes(
            GestorEvidencia.CarpetaDescartadas(carpeta)));
    }
}
