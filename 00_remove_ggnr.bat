@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: Remove GGNR_V7 service + free GeoServer port + app port 3000 (Administrator)
:: Encoding: ASCII only (no Hangul). Safe on Korean CMD (CP949) and UTF-8 editors.
:: - nssm: root\nssm\win64\nssm.exe (same as 00_nssm_install_ggnr.bat)
:: - steps: 1) nssm stop/remove GGNR_V7  2) GeoServer graceful stop + geo port
::          3) kill Listen on app port only
:: - GeoServer port: GEOSERVER_URL / start.ini / default 8080 (never hardcoded 80)
:: =============================================================================

set "SERVICE_NAME=GGNR_V7"
set "APP_PORT=3000"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EXIT_EC=0"

call "%ROOT%\00_geoserver_port_helpers.bat" resolve
set "GEO_PORT=!GEO_PORT!"

echo.
echo [remove-ggnr] root    = %ROOT%
echo [remove-ggnr] service = %SERVICE_NAME%
echo [remove-ggnr] geo port= !GEO_PORT! ^(resolved^)
echo [remove-ggnr] app port= %APP_PORT%
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Not running as administrator.
  echo         Run this script from an elevated CMD.
  echo         Right-click CMD - Run as administrator, then retry.
  set "EXIT_EC=1"
  goto :end_pause
)
echo [OK] Running as administrator.

set "NSSM=%ROOT%\nssm\win64\nssm.exe"
if not exist "%NSSM%" set "NSSM=%ROOT%\nssm\win32\nssm.exe"
if not exist "%NSSM%" (
  where nssm >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%I in ('where nssm') do (
      set "NSSM=%%I"
      goto :nssm_found
    )
  )
)

:nssm_found
if not exist "%NSSM%" (
  echo [ERROR] nssm.exe not found.
  echo   expected: %ROOT%\nssm\win64\nssm.exe
  set "EXIT_EC=1"
  goto :end_pause
)
echo [remove-ggnr] nssm    = %NSSM%
echo.

echo [1/3] nssm remove %SERVICE_NAME% ...
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if errorlevel 1 (
  echo [INFO] Service %SERVICE_NAME% is not registered. ^(skip^)
) else (
  echo [remove-ggnr] stop %SERVICE_NAME% ...
  "%NSSM%" stop %SERVICE_NAME% confirm >nul 2>&1
  echo [remove-ggnr] remove %SERVICE_NAME% ...
  "%NSSM%" remove %SERVICE_NAME% confirm
  if errorlevel 1 (
    echo [ERROR] nssm remove failed
    echo         try: "%NSSM%" stop %SERVICE_NAME% confirm
    echo              "%NSSM%" remove %SERVICE_NAME% confirm
    set "EXIT_EC=1"
    goto :end_pause
  )
  echo [OK] Service %SERVICE_NAME% removed.
)
echo.

echo [2/3] stop GeoServer ^(graceful, then port !GEO_PORT! if still listening^) ...
call "%ROOT%\00_geoserver_port_helpers.bat" stop
timeout /t 2 /nobreak >nul
call :kill_listen_port !GEO_PORT!
echo.

echo [3/3] free Listen on app port %APP_PORT% ...
call :kill_listen_port %APP_PORT%

echo.
if "!EXIT_EC!"=="0" (
  echo [OK] remove_ggnr finished.
  echo   1^) nssm remove %SERVICE_NAME%
  echo   2^) GeoServer port !GEO_PORT! cleared
  echo   3^) app port %APP_PORT% cleared
) else (
  echo [ERROR] stopped with errors ^(exit=!EXIT_EC!^). See messages above.
)

:end_pause
echo.
echo -----------------------------------------------------------
echo  Press any key to close this window.
echo -----------------------------------------------------------
pause
exit /b !EXIT_EC!

:kill_listen_port
set "KP=%~1"
echo ----- port %KP% -----
echo       netstat ^(only LISTENING on :%KP%^):
netstat -ano | findstr /R /C:":%KP% .*LISTENING"
if errorlevel 1 (
  echo [INFO] port %KP% not listening.
  goto :eof
)

set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [remove-ggnr] taskkill /f /pid %%P /T
    taskkill /F /PID %%P /T >nul 2>&1
    if not errorlevel 1 (
      set /a KILLED+=1
      echo [OK] PID %%P killed
    ) else (
      echo [WARN] PID %%P kill failed ^(already gone or access denied^)
    )
  )
)

if "!KILLED!"=="0" (
  echo [INFO] no PID killed ^(parse miss or empty^):
  echo         netstat -ano ^| findstr :%KP%
  echo         taskkill /f /pid [PID]
) else (
  echo [OK] port %KP%: tried to kill !KILLED! process^(es^).
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [OK] port %KP% is free.
) else (
  echo [WARN] port %KP% still listening. Check manually:
  netstat -ano | findstr /R /C:":%KP% .*LISTENING"
)
goto :eof
