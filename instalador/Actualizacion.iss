; ================================================================
; USB Monitor — Panel · paquete de ACTUALIZACIÓN (Inno Setup 6)
; ----------------------------------------------------------------
; El instalador completo pesa lo que pesa por lo que casi nunca
; cambia: PostgreSQL, el Node incluido, Redis y, en la variante
; completo, el paquete del agente. Entre una versión del panel y
; la siguiente lo que cambia es el programa del panel, así que
; cada Release publica también este paquete ligero, que trae
; SOLO el programa (la aplicación, los scripts y las plantillas
; de los servicios) y se aplica sobre una instalación existente:
;
;   · Exige que haya una instalación: sin la clave del registro
;     que deja el instalador completo, se niega y lo dice.
;   · No es un producto instalable: no crea entrada en
;     «Aplicaciones instaladas» ni desinstalador propio
;     (Uninstallable=no). Se ejecuta, actualiza y sale.
;   · Para los servicios del panel y de Redis (los archivos que
;     sustituye son los suyos), copia, y reaplica la configuración
;     con los scripts idempotentes de siempre (Redis y panel; la
;     base de datos ni se toca: su servicio queda en marcha).
;
; Cuándo NO vale: en una instalación nueva (no hay nada que
; actualizar) y en una versión cuyas notas digan que cambian
; PostgreSQL, Node o Redis incluidos — ahí toca el instalador
; completo, que es el que los trae.
;
; Compila Construir-Instalador.ps1 con:
;   ISCC /DPanelVersion=X.Y.Z /DPreparado=<árbol>
; ================================================================

#ifndef PanelVersion
  #define PanelVersion "1.0.0"
#endif
#ifndef Preparado
  #define Preparado "..\salida-instalador\preparado"
#endif

[Setup]
; GUID propio y distinto del producto: esto no se instala como
; tal, es un aplicador de actualizaciones.
AppId={{7C4E2A91-3B6D-4F08-9A51-2D8E6B0C4F37}
AppName=USB Monitor — Panel (actualización)
AppVersion={#PanelVersion}
AppPublisher=Gothan
AppComments=Actualización del panel de USB Monitor sobre una instalación existente
; La carpeta destino sale del registro, de la instalación que se
; actualiza; no hay página de carpeta ni falta que hace.
DefaultDirName={reg:HKLM\SOFTWARE\USBMonitor\Panel,InstallDir|{autopf}\USB Monitor Panel}
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
Uninstallable=no
CreateUninstallRegKey=no
LicenseFile=Licencia.rtf
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\src\app\favicon.ico
VersionInfoVersion={#PanelVersion}
WizardStyle=modern
ShowLanguageDialog=no
SetupLogging=yes
OutputDir=..\salida-instalador
OutputBaseFilename=USBMonitor-Panel-{#PanelVersion}-actualizacion

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Solo el programa: la aplicación compilada, las plantillas de
; los servicios (WinSW y sus XML), los scripts del instalador, el
; lanzador y el icono. PostgreSQL, Node y Redis NO viajan aquí.
Source: "{#Preparado}\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\servicio\*"; DestDir: "{app}\servicio"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\raiz\*"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\app\favicon.ico"; DestDir: "{app}"; DestName: "favicon.ico"; Flags: ignoreversion

[Code]
// La misma disciplina que el instalador completo: si un paso
// falla, se nombra, no se borra nada y el motivo queda en el
// registro espejo.
const
  ClavePanel = 'SOFTWARE\USBMonitor\Panel';

var
  PasoFallido: String;

function InitializeSetup: Boolean;
var
  Instalacion: String;
begin
  // Sin instalación previa no hay nada que actualizar: se dice
  // claro y no se toca nada.
  Result := False;
  if not RegQueryStringValue(HKLM, ClavePanel, 'InstallDir',
      Instalacion) then
  begin
    MsgBox('No se ha encontrado una instalación del panel en ' +
      'este equipo, y este paquete solo actualiza: no instala ' +
      'de cero.' + #13#10#13#10 +
      'Usa el instalador completo de la misma versión.',
      mbError, MB_OK);
    Exit;
  end;
  if not DirExists(Instalacion) then
  begin
    MsgBox('La instalación del panel que consta en el registro ' +
      'ya no está en su sitio (' + Instalacion + ').' +
      #13#10#13#10 +
      'Usa el instalador completo de la misma versión.',
      mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

procedure DetenerServiciosAfectados;
var
  Codigo: Integer;
begin
  // Se paran los servicios cuyos archivos se sustituyen (el del
  // panel y el de Redis: sus WinSW viven en servicio\). El de
  // PostgreSQL no se toca: este paquete no trae nada suyo y su
  // servicio queda en marcha todo el rato.
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'foreach ($s in ''USBMonitorPanel'',''USBMonitorRedis'') { ' +
    'if (Get-Service $s -ErrorAction SilentlyContinue) { ' +
    'Stop-Service $s -Force -ErrorAction SilentlyContinue } }"',
    '', SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

function EjecutarScript(Nombre: String): Boolean;
var
  Codigo: Integer;
  Ruta: String;
begin
  Ruta := ExpandConstant('{app}\scripts\') + Nombre;
  Result := Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + Ruta + '"',
    '', SW_SHOW, ewWaitUntilTerminated, Codigo) and (Codigo = 0);
end;

procedure EjecutarPasos;
begin
  // Los mismos scripts idempotentes del instalador completo,
  // sin el de la base de datos: Redis (recoge su plantilla nueva
  // y rearranca) y el panel (refresca el .env, aplica los cambios
  // de la base con Prisma y rearranca el servicio).
  PasoFallido := '';
  if not EjecutarScript('Instalar-Redis.ps1') then
    PasoFallido := 'Redis'
  else if not EjecutarScript('Configurar-Panel.ps1') then
    PasoFallido := 'la configuración del panel';
  if PasoFallido <> '' then
    MsgBox('El paso de ' + PasoFallido + ' ha fallado y la ' +
      'actualización no ha quedado completa.' + #13#10#13#10 +
      'Nada se ha borrado: el motivo está en el registro:' +
      #13#10 + 'C:\ProgramData\USBMonitor-instalacion.log' +
      #13#10#13#10 +
      'Corrige la causa y vuelve a ejecutar este paquete: los ' +
      'pasos ya hechos se detectan y no se repiten.',
      mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    DetenerServiciosAfectados;
  if CurStep = ssPostInstall then
    EjecutarPasos;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    if PasoFallido <> '' then
      WizardForm.FinishedLabel.Caption :=
        'La actualización terminó con un fallo en el paso de ' +
        PasoFallido + '.' + #13#10#13#10 +
        'El motivo está en ' +
        'C:\ProgramData\USBMonitor-instalacion.log; corrígelo y ' +
        'vuelve a ejecutar este paquete.'
    else
      WizardForm.FinishedLabel.Caption :=
        'El panel se ha actualizado a la versión {#PanelVersion}.' +
        #13#10#13#10 +
        'Los datos, las cuentas y la configuración se conservan ' +
        'tal como estaban.';
  end;
end;
