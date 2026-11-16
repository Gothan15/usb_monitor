; ================================================================
; USB Monitor — Panel · instalador (Inno Setup 6)
; ----------------------------------------------------------------
; Sustituye al antiguo .msi de WiX (hasta la 1.4.1). Motivos del
; cambio, pedidos por Gothan tras la primera instalación real:
;   · El MSI copiaba miles de archivos con su contabilidad de
;     reversión y la instalación se hacía muy lenta.
;   · Cuando un paso fallaba, el MSI revertía y BORRABA todo lo
;     instalado, registros incluidos: no quedaba ni el porqué.
; Inno copia rápido, exige administrador de forma nativa y, si un
; paso de la instalación falla, NO deshace lo copiado: el paso
; fallido se anuncia en el propio asistente y todo queda en su
; sitio para poder mirar los registros.
;
; La lógica de instalación NO vive aquí: como con el MSI, la
; hacen los tres scripts de PowerShell (base de datos, Redis y
; panel), que leen su configuración de HKLM\SOFTWARE\USBMonitor\
; Panel. Este guion solo copia los archivos, recoge los datos del
; asistente, deja esa configuración escrita y lanza los scripts
; en orden, comprobando su código de salida.
;
; Compila Construir-Instalador.ps1 con:
;   ISCC /DPanelVersion=X.Y.Z /DPreparado=<árbol> [/DIncluirPaquete=1]
; ================================================================

#ifndef PanelVersion
  #define PanelVersion "1.0.0"
#endif
#ifndef Preparado
  #define Preparado "..\salida-instalador\preparado"
#endif
#ifdef IncluirPaquete
  #define SufijoCompleto "-completo"
#else
  #define SufijoCompleto ""
#endif

[Setup]
; El mismo GUID que el UpgradeCode del MSI: es la identidad del
; producto; las instalaciones nuevas y las actualizaciones se
; reconocen por él.
AppId={{25F59A03-8F5D-4203-95FC-13B799284FD2}
AppName=USB Monitor — Panel
AppVersion={#PanelVersion}
AppPublisher=Gothan
AppComments=Sistema de monitoreo USB — panel de administración
DefaultDirName={autopf}\USB Monitor Panel
DefaultGroupName=USB Monitor
DisableProgramGroupPage=yes
LicenseFile=Licencia.rtf
; Sin administrador ni abre: es el requisito, no una sugerencia.
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\src\app\favicon.ico
UninstallDisplayName=USB Monitor — Panel
UninstallDisplayIcon={app}\favicon.ico
VersionInfoVersion={#PanelVersion}
WizardStyle=modern
ShowLanguageDialog=no
; Inno deja su propio registro de la instalación en %TEMP%
; (Setup Log *.txt) sin que haya que pedirlo: un diagnóstico más.
SetupLogging=yes
OutputDir=..\salida-instalador
OutputBaseFilename=USBMonitor-Panel-{#PanelVersion}{#SufijoCompleto}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "accesodirecto"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos:"

[Dirs]
; La carpeta de datos y sus subcarpetas. Los scripts también las
; crean si faltan; están aquí para que existan antes de que el
; asistente deje acceso-inicial.ini. En la desinstalación Inno
; solo retira carpetas vacías: los datos se quedan, como siempre.
Name: "{commonappdata}\USBMonitor"
Name: "{commonappdata}\USBMonitor\Datos"
Name: "{commonappdata}\USBMonitor\Registros"
Name: "{commonappdata}\USBMonitor\Redis"
Name: "{commonappdata}\USBMonitor\Respaldos"

[Files]
Source: "{#Preparado}\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\pgsql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\redis\*"; DestDir: "{app}\redis"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\servicio\*"; DestDir: "{app}\servicio"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\raiz\*"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\app\favicon.ico"; DestDir: "{app}"; DestName: "favicon.ico"; Flags: ignoreversion
#ifdef IncluirPaquete
Source: "{#Preparado}\paquete-agente\*"; DestDir: "{app}\paquete-agente"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Preparado}\empujador\*"; DestDir: "{app}\empujador"; Flags: recursesubdirs createallsubdirs ignoreversion
#endif

[Icons]
Name: "{group}\Abrir el panel"; Filename: "{app}\AbrirPanel.cmd"; IconFilename: "{app}\favicon.ico"; Comment: "Abre el panel de USB Monitor en el navegador"
Name: "{autodesktop}\USB Monitor — Panel"; Filename: "{app}\AbrirPanel.cmd"; IconFilename: "{app}\favicon.ico"; Tasks: accesodirecto; Comment: "Abre el panel de USB Monitor en el navegador"

[Code]
// ================================================================
// Asistente, configuración y pasos de la instalación.
// El contrato con los scripts de PowerShell es el de siempre:
//   · Valores en HKLM\SOFTWARE\USBMonitor\Panel: InstallDir,
//     DataDir, PanelPort, PgPort, AdminUser y FirewallOk.
//   · La contraseña inicial viaja en acceso-inicial.ini dentro
//     de la carpeta de datos (lo lee Configurar-Panel.ps1 y lo
//     destruye tras crear la cuenta). Nunca va al registro.
// ================================================================

const
  ClavePanel = 'SOFTWARE\USBMonitor\Panel';

var
  PaginaCuenta: TInputQueryWizardPage;
  PaginaPuertos: TInputQueryWizardPage;
  EsActualizacion: Boolean;
  PasoFallido: String;
  PuertoPanel: Integer;
  PuertoBd: Integer;

function DetectarActualizacion: Boolean;
begin
  // Si la clave ya trae un puerto del panel, hay una instalación
  // anterior: se conservan sus puertos y no se pide la cuenta.
  Result := RegValueExists(HKLM, ClavePanel, 'PanelPort');
end;

procedure InitializeWizard;
begin
  EsActualizacion := DetectarActualizacion;
  // La configuración va en DOS páginas, no en una: con los cinco
  // campos juntos y el texto de explicación, la página de la
  // 1.5.0 desbordaba la ventana y el último campo quedaba cortado
  // bajo los botones (visto en el PC de Gothan). Cuenta en una y
  // puertos en otra, cada una con su texto corto.
  PaginaCuenta := CreateInputQueryPage(wpSelectDir,
    'Cuenta de administrador',
    'La cuenta con la que entrarás al panel',
    'Se crea al terminar la instalación. Si dejas la contraseña ' +
    'vacía, se generará una y quedará en PRIMER-ACCESO.txt, ' +
    'dentro de la carpeta de datos.');
  PaginaCuenta.Add('Usuario administrador:', False);
  PaginaCuenta.Add('Contraseña:', True);
  PaginaCuenta.Add('Repite la contraseña:', True);
  PaginaCuenta.Values[0] := 'admin';

  PaginaPuertos := CreateInputQueryPage(PaginaCuenta.ID,
    'Puertos del panel',
    'Dónde escuchará cada pieza',
    'El puerto de la base de datos es interno: solo lo usa el ' +
    'propio panel. Al terminar se abrirá el puerto del panel en ' +
    'el Firewall de Windows (perfiles privado y de dominio).');
  PaginaPuertos.Add('Puerto del panel (la web):', False);
  PaginaPuertos.Add('Puerto de la base de datos (interno):', False);
  PaginaPuertos.Values[0] := '3000';
  PaginaPuertos.Values[1] := '5433';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if EsActualizacion and
     ((PageID = PaginaCuenta.ID) or (PageID = PaginaPuertos.ID)) then
    Result := True;
end;

function PuertoOcupado(Puerto: Integer): Boolean;
var
  Codigo: Integer;
  Parametros: String;
begin
  // Sustituye a ComprobarPuertos.vbs: pregunta a Windows qué
  // conexiones están en escucha en ese puerto. Si PowerShell no
  // pudiera ni ejecutarse, no se bloquea el asistente por ello:
  // los pasos de la instalación dirán la última palabra.
  Parametros := '-NoProfile -ExecutionPolicy Bypass -Command "if ' +
    '(Get-NetTCPConnection -LocalPort ' + IntToStr(Puerto) +
    ' -State Listen -ErrorAction SilentlyContinue) { exit 1 }"';
  Result := Exec('powershell.exe', Parametros, '', SW_HIDE,
    ewWaitUntilTerminated, Codigo) and (Codigo <> 0);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Usuario, Clave1, Clave2: String;
begin
  Result := True;

  if CurPageID = PaginaCuenta.ID then
  begin
    Usuario := Trim(PaginaCuenta.Values[0]);
    Clave1 := PaginaCuenta.Values[1];
    Clave2 := PaginaCuenta.Values[2];
    if Clave1 <> Clave2 then
    begin
      MsgBox('Las contraseñas no coinciden. Escríbela dos veces ' +
        'igual, o déjala vacía en los dos campos para que el ' +
        'instalador genere una.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Usuario = '' then
      PaginaCuenta.Values[0] := 'admin';
  end;

  if CurPageID = PaginaPuertos.ID then
  begin
    PuertoPanel := StrToIntDef(Trim(PaginaPuertos.Values[0]), -1);
    PuertoBd := StrToIntDef(Trim(PaginaPuertos.Values[1]), -1);
    if (PuertoPanel < 1) or (PuertoPanel > 65535) or
       (PuertoBd < 1) or (PuertoBd > 65535) then
    begin
      MsgBox('Los puertos tienen que ser números entre 1 y 65535.',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if PuertoPanel = PuertoBd then
    begin
      MsgBox('El puerto del panel y el de la base de datos no ' +
        'pueden ser el mismo.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if PuertoOcupado(PuertoPanel) then
    begin
      MsgBox('El puerto ' + IntToStr(PuertoPanel) + ' ya está en ' +
        'uso en este equipo. Elige otro para el panel.',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if PuertoOcupado(PuertoBd) then
    begin
      MsgBox('El puerto ' + IntToStr(PuertoBd) + ' ya está en uso ' +
        'en este equipo. Elige otro para la base de datos.',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure DetenerServiciosSiExisten;
var
  Codigo: Integer;
begin
  // En una actualización, los servicios en marcha bloquean los
  // archivos que se van a sustituir: se paran antes de copiar.
  // Si no existen (instalación limpia), no pasa nada.
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'foreach ($s in ''USBMonitorPanel'',''USBMonitorRedis'',''USBMonitorPostgreSQL'') { ' +
    'if (Get-Service $s -ErrorAction SilentlyContinue) { ' +
    'Stop-Service $s -Force -ErrorAction SilentlyContinue } }"',
    '', SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

procedure PrepararConfiguracion;
var
  Datos: String;
  ValorDword: Cardinal;
  Usuario, Clave: String;
  Ini: String;
  Codigo: Integer;
begin
  Datos := ExpandConstant('{commonappdata}\USBMonitor');
  if EsActualizacion then
  begin
    // Se conservan los puertos de la instalación anterior.
    if RegQueryDWordValue(HKLM, ClavePanel, 'PanelPort', ValorDword) then
      PuertoPanel := Integer(ValorDword);
    if RegQueryDWordValue(HKLM, ClavePanel, 'PgPort', ValorDword) then
      PuertoBd := Integer(ValorDword);
  end;
  RegWriteStringValue(HKLM, ClavePanel, 'InstallDir', ExpandConstant('{app}'));
  RegWriteStringValue(HKLM, ClavePanel, 'DataDir', Datos);
  RegWriteDWordValue(HKLM, ClavePanel, 'PanelPort', PuertoPanel);
  RegWriteDWordValue(HKLM, ClavePanel, 'PgPort', PuertoBd);
  RegWriteStringValue(HKLM, ClavePanel, 'FirewallOk', '1');
  if not EsActualizacion then
  begin
    Usuario := Trim(PaginaCuenta.Values[0]);
    if Usuario = '' then Usuario := 'admin';
    RegWriteStringValue(HKLM, ClavePanel, 'AdminUser', Usuario);
    Clave := PaginaCuenta.Values[1];
    if Clave <> '' then
    begin
      // El relevo de GuardarAdmin.vbs: la contraseña va en un
      // archivo con la ACL cerrada, no en el registro.
      Ini := Datos + '\acceso-inicial.ini';
      try
        SaveStringToFile(Ini,
          'usuario=' + Usuario + #13#10 + 'clave=' + Clave + #13#10,
          False);
        Exec('icacls.exe',
          '"' + Ini + '" /inheritance:r /grant:r *S-1-5-18:F ' +
          '*S-1-5-32-544:F "' + ExpandConstant('{username}') + ':F"',
          '', SW_HIDE, ewWaitUntilTerminated, Codigo);
      except
        // Si el archivo no se pudiera dejar, Configurar-Panel
        // generará la contraseña y la dejará en PRIMER-ACCESO.txt.
      end;
    end;
  end;
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
  PasoFallido := '';
  if not EjecutarScript('Instalar-BaseDatos.ps1') then
    PasoFallido := 'la base de datos'
  else if not EjecutarScript('Instalar-Redis.ps1') then
    PasoFallido := 'Redis'
  else if not EjecutarScript('Configurar-Panel.ps1') then
    PasoFallido := 'la configuración del panel';
  if PasoFallido <> '' then
    MsgBox('El paso de ' + PasoFallido + ' ha fallado y la ' +
      'instalación no ha quedado completa.' + #13#10#13#10 +
      'Nada se ha borrado: lo instalado queda en su sitio y el ' +
      'motivo está en el registro:' + #13#10 +
      'C:\ProgramData\USBMonitor-instalacion.log' + #13#10#13#10 +
      'Corrige la causa y vuelve a ejecutar el instalador: los ' +
      'pasos ya hechos se detectan y no se repiten.',
      mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    DetenerServiciosSiExisten;
    PrepararConfiguracion;
  end;
  if CurStep = ssPostInstall then
    EjecutarPasos;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    if PasoFallido <> '' then
      WizardForm.FinishedLabel.Caption :=
        'La instalación terminó con un fallo en el paso de ' +
        PasoFallido + '.' + #13#10#13#10 +
        'Lo instalado no se ha borrado. El motivo está en ' +
        'C:\ProgramData\USBMonitor-instalacion.log; corrígelo y ' +
        'vuelve a ejecutar el instalador.'
    else if EsActualizacion then
      WizardForm.FinishedLabel.Caption :=
        'El panel se ha actualizado. Los datos, las cuentas y la ' +
        'configuración se conservan tal como estaban.'
    else
      WizardForm.FinishedLabel.Caption :=
        'El panel está instalado y en marcha.' + #13#10#13#10 +
        'Ábrelo desde el acceso «Abrir el panel» del menú Inicio. ' +
        'Si dejaste la contraseña vacía en el asistente, la ' +
        'generada está en PRIMER-ACCESO.txt, dentro de ' +
        'C:\ProgramData\USBMonitor.';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Codigo: Integer;
  Ruta: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Antes de que se retire ningún archivo: parar y quitar los
    // tres servicios (el mismo script que usaba el MSI).
    Ruta := ExpandConstant('{app}\scripts\Desinstalar-Servicios.ps1');
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + Ruta + '"',
      '', SW_SHOW, ewWaitUntilTerminated, Codigo);
  end;
  if CurUninstallStep = usPostUninstall then
    RegDeleteKeyIncludingSubkeys(HKLM, ClavePanel);
end;
