// -*- coding: utf-8 -*-
// Pruebas de la emergencia sin red contra hashes PHC Argon2id.
using System.Text;
using Konscious.Security.Cryptography;
using USBMonitor.Agente.Core;

namespace Agente.Core.Tests;

public class EmergenciaTests
{
    private const string Clave = "ClaveDelDueno.123";

    /// <summary>Genera un PHC $argon2id$ como el que entrega el panel.</summary>
    private static string GenerarPhc(string password)
    {
        var sal = new byte[16];
        for (var i = 0; i < sal.Length; i++)
            sal[i] = (byte)(i + 1);
        using var argon = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = sal,
            MemorySize = 4096,
            Iterations = 3,
            DegreeOfParallelism = 2,
        };
        var hash = argon.GetBytes(32);
        static string B64(byte[] datos) => Convert.ToBase64String(datos).TrimEnd('=');
        return $"$argon2id$v=19$m=4096,t=3,p=2${B64(sal)}${B64(hash)}";
    }

    private static Emergencia CrearConDueno(string datos)
    {
        var emergencia = new Emergencia(datos);
        emergencia.GuardarHash("dueno", GenerarPhc(Clave));
        return emergencia;
    }

    [Fact]
    public void VerificarArgon2id_AciertoFalloYFormatoRaro()
    {
        var phc = GenerarPhc(Clave);
        Assert.True(Emergencia.VerificarArgon2id(phc, Clave));
        Assert.False(Emergencia.VerificarArgon2id(phc, "otra-clave"));
        Assert.False(Emergencia.VerificarArgon2id("esto-no-es-un-phc", Clave));
        Assert.False(Emergencia.VerificarArgon2id("", Clave));
    }

    [Fact]
    public void Verificar_DuenoCorrectoConMayusculasEnElUsuario()
    {
        var emergencia = CrearConDueno(Fabrica.DirectorioTemporal());
        var resultado = emergencia.Verificar("disp-1", "  DUENO ", Clave, "E:", "SER1");
        Assert.True(resultado.Autorizado);
        Assert.Equal("ok", resultado.Motivo);
    }

    [Fact]
    public void Verificar_UsuarioDistintoNoAutoriza()
    {
        var emergencia = CrearConDueno(Fabrica.DirectorioTemporal());
        var resultado = emergencia.Verificar("disp-1", "otro-usuario", Clave, "E:", "SER1");
        Assert.False(resultado.Autorizado);
        Assert.Equal("credenciales", resultado.Motivo);
    }

    [Fact]
    public void SinHashGuardado_MotivoSinHash()
    {
        var emergencia = new Emergencia(Fabrica.DirectorioTemporal());
        var resultado = emergencia.Verificar("disp-1", "dueno", Clave, null, null);
        Assert.False(resultado.Autorizado);
        Assert.Equal("sin_hash", resultado.Motivo);
    }

    [Fact]
    public void CincoFallos_BloqueanAunqueLaClaveSeaLaBuena()
    {
        var emergencia = CrearConDueno(Fabrica.DirectorioTemporal());
        for (var i = 0; i < Emergencia.MaxIntentos; i++)
        {
            var fallo = emergencia.Verificar("disp-x", "dueno", "mala", "E:", "SERX");
            Assert.Equal("credenciales", fallo.Motivo);
        }
        var bloqueado = emergencia.Verificar("disp-x", "dueno", Clave, "E:", "SERX");
        Assert.False(bloqueado.Autorizado);
        Assert.Equal("espera", bloqueado.Motivo);
        // Otro dispositivo no hereda el bloqueo.
        var otro = emergencia.Verificar("disp-y", "dueno", Clave, "F:", "SERY");
        Assert.True(otro.Autorizado);
    }

    [Fact]
    public void Intentos_SeAnotanYSeLimpian()
    {
        var emergencia = CrearConDueno(Fabrica.DirectorioTemporal());
        emergencia.Verificar("disp-1", "dueno", Clave, "E:", "SER1");
        emergencia.Verificar("disp-1", "dueno", "mala", "E:", "SER1");

        var intentos = emergencia.IntentosPendientes();
        Assert.Equal(2, intentos.Count);
        Assert.Equal("OFFLINE_OK", intentos[0].Result);
        Assert.Equal("OFFLINE_FAIL", intentos[1].Result);
        Assert.Equal("dueno", intentos[0].UsernameTried);
        Assert.Equal("E:", intentos[0].DriveLetter);
        Assert.Equal("SER1", intentos[0].SerialNumber);
        Assert.False(string.IsNullOrEmpty(intentos[0].CreatedAt));

        emergencia.LimpiarIntentos();
        Assert.Empty(emergencia.IntentosPendientes());
    }
}
