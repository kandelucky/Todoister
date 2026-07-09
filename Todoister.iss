; Inno Setup script for Todoister — per-user install (no admin), Start-menu + uninstaller.
; Compile:  "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" Todoister.iss
; Input:    dist\Todoister\  (PyInstaller onedir output)
; Output:   installer\Todoister-Setup.exe

#define MyAppName "Todoister"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Kandelucky"
#define MyAppExeName "Todoister.exe"
#define MyAppURL "https://github.com/kandelucky/Todoister"

[Setup]
AppId={{8E5C2A14-9B7D-4E3F-A1C6-2D4F9B0E7A33}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=installer
OutputBaseFilename=Todoister-Setup
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\Todoister\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
