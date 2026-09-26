@echo off
rem Everlinth: arranca el servidor (si no está en marcha) y abre el cliente Godot.
cd /d "%~dp0"
netstat -ano | findstr ":3000 " | findstr LISTENING >nul
if errorlevel 1 (
  echo Arrancando el servidor...
  start "Everlinth - servidor" cmd /k "npm run build --workspace=shared && npm run build --workspace=server && cd server && node dist/index.js"
  timeout /t 12 /nobreak >nul
)
start "" "C:\Users\mis_2\Desktop\Roi\tools\godot\Godot_v4.7.2-stable_win64.exe" --path "%~dp0godot"
