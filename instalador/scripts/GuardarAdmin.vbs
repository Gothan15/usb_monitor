' ================================================================
' USB Monitor — Panel · paso de las credenciales iniciales
' ----------------------------------------------------------------
' Por qué existe este VBScript: las acciones diferidas de un MSI
' se ejecutan como SYSTEM y NO pueden leer las propiedades que el
' usuario escribió en el asistente (ADMIN_USER / ADMIN_PASSWORD).
' Esta acción es INMEDIATA y va incrustada en el MSI (Binary), así
' que se ejecuta mientras la interfaz vive, con la sesión abierta.
'
' Deja usuario+contraseña en «acceso-inicial.ini» dentro de
' DATADIR, con la ACL cerrada (el propio usuario, SYSTEM y
' Administradores, por SID para que da igual el idioma de
' Windows). Configurar-Panel.ps1 (diferido, SYSTEM) lo lee para
' crear la cuenta y lo DESTRUYE acto seguido.
'
' Si no hay contraseña (instalación silenciosa o actualización),
' no escribe nada: el script de configuración genera entonces una
' contraseña y la deja en PRIMER-ACCESO.txt.
' ================================================================
Option Explicit

Dim fso, shell, carpetaDatos, rutaIni, archivo, clave, usuario
clave = Session.Property("ADMIN_PASSWORD")
usuario = Session.Property("ADMIN_USER")
If Len(clave) = 0 Then WScript.Quit 0
If Len(usuario) = 0 Then usuario = "admin"

carpetaDatos = Session.Property("CommonAppDataFolder") & "USBMonitor"
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists(carpetaDatos) Then fso.CreateFolder(carpetaDatos)

rutaIni = carpetaDatos & "\acceso-inicial.ini"
Set archivo = fso.CreateTextFile(rutaIni, True)
archivo.WriteLine "usuario=" & usuario
archivo.WriteLine "clave=" & clave
archivo.Close

' ACL mínima por SID (independiente del idioma):
'   *S-1-5-18        SYSTEM
'   *S-1-5-32-544    Administradores
'   el SID del usuario que instala (UserSID)
Set shell = CreateObject("WScript.Shell")
shell.Run "icacls """ & rutaIni & """ /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F *" & _
          Session.Property("UserSID") & ":F", 0, True
WScript.Quit 0
