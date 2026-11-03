' ================================================================
' USB Monitor — Panel · aviso de puertos ocupados
' ----------------------------------------------------------------
' Acción inmediata incrustada en el MSI, invocada con DoAction al
' pulsar «Siguiente» en la página «Configuración del servidor»,
' ANTES de pasar a la confirmación: si el puerto del panel o el de
' la base de datos ya están en uso por otro programa, avisa con un
' MsgBox para que el usuario pueda volver atrás y elegir otros.
' Solo avisa: no bloquea la instalación.
'
' En una actualización NO comprueba nada: los puertos los están
' usando nuestros propios servicios de la versión anterior.
'
' La prueba de puerto intenta escuchar de verdad (TcpListener vía
' PowerShell oculto): código de salida 0 = libre, otro = ocupado.
' ================================================================
Option Explicit

If Len(Session.Property("Installed")) > 0 Then WScript.Quit 0

Dim shell, puertoPanel, puertoBd, ocupados
Set shell = CreateObject("WScript.Shell")
puertoPanel = Session.Property("PANEL_PORT")
puertoBd = Session.Property("PG_PORT")
ocupados = ""

If Not PuertoLibre(puertoPanel, "Any") Then ocupados = ocupados & "  · Puerto del panel: " & puertoPanel & vbCrLf
If Not PuertoLibre(puertoBd, "Loopback") Then ocupados = ocupados & "  · Puerto de la base de datos: " & puertoBd & vbCrLf

If Len(ocupados) > 0 Then
    MsgBox "Aviso: estos puertos ya están en uso por otro programa:" & vbCrLf & vbCrLf & _
           ocupados & vbCrLf & _
           "La instalación puede continuar, pero el panel no arrancará hasta que el puerto quede libre." & vbCrLf & _
           "Si prefieres, vuelve atrás y elige otros puertos.", _
           vbExclamation + vbOKOnly, "USB Monitor — Panel"
End If
WScript.Quit 0

Function PuertoLibre(puerto, direccion)
    Dim comando, codigo
    comando = "powershell.exe -NoProfile -WindowStyle Hidden -Command " & Chr(34) & _
              "try { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::" & direccion & ", " & puerto & "); " & _
              "$l.Start(); $l.Stop(); exit 0 } catch { exit 1 }" & Chr(34)
    codigo = shell.Run(comando, 0, True)
    PuertoLibre = (codigo = 0)
End Function
