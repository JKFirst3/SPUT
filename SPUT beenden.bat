@echo off
setlocal

set "PORT=4173"
echo SPUT wird beendet ...

set "SPUT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "SPUT_PID=%%P"

if not defined SPUT_PID (
  echo Es laeuft aktuell kein SPUT-Server auf Port %PORT%.
  pause
  exit /b 0
)

for %%P in (%SPUT_PID%) do (
  powershell -NoProfile -Command "$process = Get-CimInstance Win32_Process -Filter 'ProcessId = %%P'; if ($process.Name -eq 'node.exe' -and $process.CommandLine -match 'server[\\/]index\\.js') { exit 0 }; exit 1" >nul 2>&1
  if not errorlevel 1 (
    echo Beende SPUT-Prozess %%P auf Port %PORT% ...
    taskkill /PID %%P /T >nul 2>&1
  ) else (
    echo Port %PORT% wird von einem anderen Prozess verwendet. Dieser wurde nicht beendet.
  )
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul && (
  echo SPUT konnte nicht vollstaendig beendet werden.
  pause
  exit /b 1
)

echo SPUT wurde beendet.
exit /b 0
