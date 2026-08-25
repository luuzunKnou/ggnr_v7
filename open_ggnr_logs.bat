@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: =============================================================================
:: Tail GGNR / GeoServer logs in two CMD windows (ASCII-only for Korean CMD)
:: - GGNR stdout = C:\logs\GGNR_V7_stdout.log (same as nssm_install)
:: - GeoServer   = root\geoserver_modules\data_dir\logs\geoserver.log
:: - root = folder of this bat
:: - Reconnects if file is missing / recreated
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "LOG_DIR=C:\logs"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "GEO_LOG=%ROOT%\geoserver_modules\data_dir\logs\geoserver.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo [open_ggnr_logs] root   = %ROOT%
echo [open_ggnr_logs] GGNR   = %LOG_OUT%
echo [open_ggnr_logs] GeoSrv = %GEO_LOG%
echo.
echo Opening two log windows. Close a window to stop that tail.
echo.

:: Embed path in PS (DisableDelayedExpansion). Titles ASCII only so start quoting stays valid.
start "GGNR_LOG" cmd /k powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p='%LOG_OUT%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch { }; Write-Host '[open_ggnr_logs] reconnect...'; Start-Sleep -Seconds 1 }"

start "GEOSERVER_LOG" cmd /k powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p='%GEO_LOG%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch { }; Write-Host '[open_ggnr_logs] reconnect...'; Start-Sleep -Seconds 1 }"

exit /b 0
