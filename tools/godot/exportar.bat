@echo off
rem Genera los ejecutables del juego en build\ (necesita las plantillas de exportación
rem de Godot 4.7.2 instaladas: Editor > Gestionar plantillas de exportación, o el .tpz
rem descomprimido en %APPDATA%\Godot\export_templates\4.7.2.stable).
rem Uso: tools\godot\exportar.bat [Windows|Linux|macOS|"Web (ligera)"|todo]
setlocal
cd /d "%~dp0..\.."
set GODOT=C:\Users\mis_2\Desktop\Roi\tools\godot\Godot_v4.7.2-stable_win64_console.exe
set CUAL=%~1
if "%CUAL%"=="" set CUAL=Windows
if /i "%CUAL%"=="todo" (
  call :uno Windows
  call :uno Linux
  call :uno macOS
  call :uno "Web (ligera)"
) else (
  call :uno "%CUAL%"
)
echo Listo: carpeta build\
exit /b 0

:uno
if /i "%~1"=="Windows" if not exist build\windows mkdir build\windows
if /i "%~1"=="Linux" if not exist build\linux mkdir build\linux
if /i "%~1"=="macOS" if not exist build\macos mkdir build\macos
if /i "%~1"=="Web (ligera)" if not exist build\web mkdir build\web
echo Exportando %~1...
"%GODOT%" --headless --path godot --export-release "%~1"
exit /b 0
