// -*- coding: utf-8 -*-
// Pruebas del registro de ofensas de la escalera de respuesta:
// el conteo por dispositivo, su persistencia entre agentes y
// el olvido cuando el dispositivo entra en la lista blanca.
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class RegistroOfensasTests
{
    private const string Clave = "USB\\VID_0781&PID_5567\\123456";
    private static readonly DateTime Ahora = new(2026, 11, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void NivelPara_SubirPorPeldanos()
    {
        Assert.Equal(NivelRespuesta.Ninguno, RegistroOfensas.NivelPara(0));
        Assert.Equal(NivelRespuesta.Aviso, RegistroOfensas.NivelPara(1));
        Assert.Equal(NivelRespuesta.BloqueoSesion, RegistroOfensas.NivelPara(2));
        Assert.Equal(NivelRespuesta.Apagado, RegistroOfensas.NivelPara(3));
        Assert.Equal(NivelRespuesta.Apagado, RegistroOfensas.NivelPara(7));
    }

    [Fact]
    public void Registrar_CuentaPorDispositivoYSobreviveAlReinicio()
    {
        var datos = Fabrica.DirectorioTemporal();
        var registro = new RegistroOfensas(datos);
        Assert.Equal(0, registro.Conteo(Clave));
        Assert.Equal(1, registro.Registrar(Clave, Ahora));
        Assert.Equal(2, registro.Registrar(Clave, Ahora));
        Assert.Equal(0, registro.Conteo("USB\\OTRO"));

        // Un agente nuevo sobre la misma carpeta hereda el conteo.
        var heredado = new RegistroOfensas(datos);
        Assert.Equal(2, heredado.Conteo(Clave));
        Assert.Equal(3, heredado.Registrar(Clave, Ahora));
    }

    [Fact]
    public void Olvidar_CierraElHistorialDelDispositivo()
    {
        var datos = Fabrica.DirectorioTemporal();
        var registro = new RegistroOfensas(datos);
        registro.Registrar(Clave, Ahora);
        registro.Registrar(Clave, Ahora);

        registro.Olvidar(Clave);
        Assert.Equal(0, registro.Conteo(Clave));
        Assert.Equal(0, new RegistroOfensas(datos).Conteo(Clave));
        // Olvidar dos veces no es un error.
        registro.Olvidar(Clave);
    }
}
