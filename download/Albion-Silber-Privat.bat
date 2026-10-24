@echo off
chcp 65001 >nul
title Albion Silber Tool - Privat-Modus
rem ==================================================================
rem  Startet den Albion Data Client NUR fuer dein Albion Silber Tool.
rem  -i noop  = es wird NICHTS an die oeffentliche Datenbank gesendet.
rem  Die Preise gehen nur an deinen Browser auf diesem PC (Port 8099).
rem ==================================================================

rem --- Admin-Rechte holen (noetig zum Mitlesen der Marktdaten) -------
net session >nul 2>&1
if errorlevel 1 (
  echo Admin-Rechte werden angefragt ...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"

rem --- Albion Data Client suchen -------------------------------------
set "EXE=%ProgramFiles%\Albion Data Client\albiondata-client.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Albion Data Client\albiondata-client.exe"
if not exist "%EXE%" (
  echo.
  echo  [!] Albion Data Client wurde nicht gefunden.
  echo      Bitte zuerst installieren: https://europe.albion-online-data.com/client
  echo.
  start "" "https://europe.albion-online-data.com/client"
  pause
  exit /b 1
)

rem --- Oeffentlichen Autostart abschalten (der wuerde oeffentlich hochladen)
schtasks /Change /TN "Albion Data Client" /DISABLE >nul 2>&1
rem --- Laufende Instanzen beenden ------------------------------------
taskkill /IM albiondata-client.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

rem --- config.yaml fuer den privaten Live-Empfang --------------------
(
  echo EnableWebsockets: true
  echo AllowedWebsocketHosts:
  echo   - hedtes.github.io
  echo   - localhost
) > "%~dp0config.yaml"

rem --- Client privat starten + Tool oeffnen ---------------------------
start "" /D "%~dp0." "%EXE%" -i noop
timeout /t 2 /nobreak >nul
start "" "https://hedtes.github.io/albion-silber-tool/#caerleon"

echo.
echo  ==============================================================
echo   OK - Albion Data Client laeuft im PRIVAT-Modus.
echo   - Nichts wird oeffentlich hochgeladen.
echo   - Im Tool oben rechts muss stehen: "verbunden".
echo   - Im Spiel in Caerleon: Black Market + Markt durchklicken.
echo.
echo   Den oeffentlichen Autostart wieder einschalten (falls gewuenscht):
echo   schtasks /Change /TN "Albion Data Client" /ENABLE
echo  ==============================================================
echo.
pause
