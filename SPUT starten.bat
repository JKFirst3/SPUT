@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PORT=4173"

cd /d "%PROJECT_DIR%" || (
  echo Der SPUT-Ordner wurde nicht gefunden.
  pause
  exit /b 1
)

echo SPUT wird gestartet ...
echo Projektordner: %PROJECT_DIR%

where npm >nul 2>&1 || (
  echo npm wurde nicht gefunden. Bitte Node.js installieren.
  pause
  exit /b 1
)

set "SPUT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "SPUT_PID=%%P"

if defined SPUT_PID (
  echo SPUT laeuft bereits auf http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  exit /b 0
)

echo Server wird im Hintergrund gestartet ...
start "" /b cmd /c "npm start > \"%PROJECT_DIR%.sput.log\" 2>&1"

for /L %%I in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  set "SPUT_PID="
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "SPUT_PID=%%P"
  if defined SPUT_PID goto :started
)

echo SPUT konnte nicht gestartet werden. Details stehen in .sput.log.
pause
exit /b 1

:started
echo SPUT laeuft auf http://localhost:%PORT%
start "" "http://localhost:%PORT%"
exit /b 0
