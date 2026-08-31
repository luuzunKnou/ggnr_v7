@echo off
:: =============================================================================
:: GeoServer port resolve + graceful stop (called from other 00_*.bat)
:: Usage:
::   call "%ROOT%\00_geoserver_port_helpers.bat" resolve
::   call "%ROOT%\00_geoserver_port_helpers.bat" stop
:: Sets GEO_PORT on resolve (default 8080, not 80).
:: =============================================================================

if /i "%~1"=="resolve" goto :resolve_geoserver_port
if /i "%~1"=="stop" goto :stop_geoserver_graceful
exit /b 1

:resolve_geoserver_port
set "GEO_PORT=8080"
if not defined ROOT set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if defined GEOSERVER_URL (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $u = [Uri]$env:GEOSERVER_URL; if ($u.Port -gt 0) { $u.Port } else { 8080 } } catch { 8080 }"`) do set "GEO_PORT=%%P"
  goto :resolve_geoserver_port_done
)

set "GS_INI=%ROOT%\geoserver_modules\geoserver\start.ini"
if exist "%GS_INI%" (
  for /f "usebackq tokens=2 delims==" %%P in (`findstr /B /I /C:"jetty.http.port=" "%GS_INI%" 2^>nul`) do set "GEO_PORT=%%P"
)

:resolve_geoserver_port_done
if not defined GEO_PORT set "GEO_PORT=8080"
echo %GEO_PORT%| findstr /R "^[0-9][0-9]*$" >nul 2>&1
if errorlevel 1 set "GEO_PORT=8080"
exit /b 0

:stop_geoserver_graceful
if not defined ROOT set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "GS_STOP=%ROOT%\geoserver_modules\scripts\stop-geoserver.bat"
if not exist "%GS_STOP%" (
  echo [INFO] stop-geoserver.bat not found - skip graceful GeoServer stop.
  exit /b 0
)
echo [geoserver] graceful stop via stop-geoserver.bat ...
call "%GS_STOP%"
exit /b 0
