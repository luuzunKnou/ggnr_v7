@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: =============================================================================
:: Tail GGNR / GeoServer logs in two CMD windows (ASCII-only for Korean CMD)
:: - GGNR stdout = C:\logs\GGNR_V7_stdout.log (same as 00_nssm_install)
:: - GeoServer   = root\geoserver_modules\data_dir\logs\geoserver.log
:: - root = folder of this bat
:: - Reconnects if file is missing / recreated
:: - Skip start if window title GGNR_LOG / GEOSERVER_LOG already open
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "LOG_DIR=C:\logs"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "GEO_LOG=%ROOT%\geoserver_modules\data_dir\logs\geoserver.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Detect existing log windows by MainWindowTitle (exact title from start "...")
set "HAVE_GGNR=0"
set "HAVE_GEO=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=@((Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle }).MainWindowTitle); if ($t -contains 'GGNR_LOG') { 'GGNR' }; if ($t -contains 'GEOSERVER_LOG') { 'GEO' }"`) do (
  if /i "%%A"=="GGNR" set "HAVE_GGNR=1"
  if /i "%%A"=="GEO" set "HAVE_GEO=1"
)

if "%HAVE_GGNR%"=="1" if "%HAVE_GEO%"=="1" exit /b 0

:: Embed path in PS (DisableDelayedExpansion). Titles ASCII only so start quoting stays valid.
if "%HAVE_GGNR%"=="0" (
  start "GGNR_LOG" cmd /k powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p='%LOG_OUT%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch { }; Write-Host '[00_open_ggnr_logs] reconnect...'; Start-Sleep -Seconds 1 }"
)

if "%HAVE_GEO%"=="0" (
  start "GEOSERVER_LOG" cmd /k powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p='%GEO_LOG%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch { }; Write-Host '[00_open_ggnr_logs] reconnect...'; Start-Sleep -Seconds 1 }"
)

exit /b 0
