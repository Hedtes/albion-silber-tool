@echo off
title Albion Silber Tool - Privat-Modus
rem ==================================================================
rem  Startet den Albion Data Client NUR fuer dein Albion Silber Tool.
rem  -i noop  = es wird NICHTS an die oeffentliche Datenbank gesendet.
rem  Kein -p  = auch an keinen anderen Server.
rem  Die Preise gehen nur an deinen Browser auf diesem PC (Port 8099).
rem  Dieses Skript laedt NICHTS aus dem Internet herunter.
rem ==================================================================

rem --- Admin-Rechte pruefen (noetig zum Mitlesen der Marktdaten) ----
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Bitte mit Admin-Rechten starten:
  echo      Rechtsklick auf diese Datei - "Als Administrator ausfuehren"
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0"

rem --- Albion Data Client suchen (Standard-Installationsordner) -------
set "EXE=%ProgramFiles%\Albion Data Client\albiondata-client.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Albion Data Client\albiondata-client.exe"
if not exist "%EXE%" (
  echo.
  echo  [!] Albion Data Client wurde nicht gefunden.
  echo      Bitte zuerst installieren: https://github.com/ao-data/albiondata-client/releases
  echo.
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
echo   - Im Tool oben rechts muss stehen: "Live".
echo   - Im Spiel: Markt / Black Market oeffnen und durchklicken.
echo.
echo   Oeffentlichen Autostart wieder einschalten (falls gewuenscht):
echo   schtasks /Change /TN "Albion Data Client" /ENABLE
echo  ==============================================================
echo.
pause
