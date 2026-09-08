@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: Register GGNR_V7 Windows service via nssm (run as Administrator)
:: Encoding: ASCII only (no Hangul). Safe on Korean CMD (CP949) and UTF-8 editors.
:: - root = folder of this bat (same as ggnr_start.bat)
:: - app  = root\ggnr_start.bat
:: - logs = C:\logs\GGNR_V7_stdout.log / GGNR_V7_stderr.log
:: - existing service: Y/N remove and re-register (N => exit 2)
:: - GGNR_NSSM_REREG=Y|N skips re-register prompt (00_make_ggnr_starter)
:: - ObjectName: GGNR_NSSM_OBJECT_NAME/PASS, else project.env [env]
::   NSSM_OBJECT_NAME / NSSM_OBJECT_PASS (demo G: share)
:: - on failure: pause + C:\logs\nssm_install_last.log
:: - on success: pause unless GGNR_NSSM_FROM_STARTER=1
:: =============================================================================

set "SERVICE_NAME=GGNR_V7"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "APP_BAT=%ROOT%\ggnr_start.bat"
set "LOG_DIR=C:\logs"
set "LOG_BACKUP=%LOG_DIR%\backup"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "LOG_ERR=%LOG_DIR%\GGNR_V7_stderr.log"
set "INSTALL_LOG=%LOG_DIR%\nssm_install_last.log"
set "APP_PORT=3000"
set "EXIT_EC=0"
set "KEEP_OPEN=1"
if /i "%GGNR_NSSM_FROM_STARTER%"=="1" set "KEEP_OPEN=0"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul
(
  echo ==== nssm_install %DATE% %TIME% ====
  echo ROOT=%ROOT%
) > "%INSTALL_LOG%"

echo.
echo ============================================================
echo  00_nssm_install_ggnr - GGNR_V7 service register
echo ============================================================
echo [nssm-install] root     = %ROOT%
echo [nssm-install] app      = %APP_BAT%
echo [nssm-install] log dir  = %LOG_DIR%
echo [nssm-install] log file = %INSTALL_LOG%
echo [nssm-install] backup   = %LOG_BACKUP%
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Not running as administrator.
  echo         Run this script from an elevated CMD.
  echo         Right-click CMD - Run as administrator, then retry.
  set "EXIT_EC=1"
  goto :fail_end
)
echo [OK] Running as administrator.

if not exist "%APP_BAT%" (
  echo [ERROR] ggnr_start.bat not found: %APP_BAT%
  set "EXIT_EC=1"
  goto :fail_end
)

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
  goto :fail_end
)
echo [nssm-install] nssm     = %NSSM%

call :EnsureLogFolders
if errorlevel 1 (
  set "EXIT_EC=1"
  goto :fail_end
)

"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if not errorlevel 1 (
  echo [nssm-install] Service %SERVICE_NAME% already registered.
  if defined GGNR_NSSM_REREG (
    set "DO_REREG=%GGNR_NSSM_REREG%"
    echo [nssm-install] re-register = !DO_REREG! ^(from parent script^)
  ) else (
    set /p "DO_REREG=Remove and re-register? (Y/N): "
  )
  if /i not "!DO_REREG!"=="Y" (
    echo.
    echo ===== CANCELLED ^(not a failure^) =====
    echo [SKIP] Keeping existing service. No re-register. ^(exit=2^)
    echo.
    call :log_line "cancel exit=2 no re-register"
    if "!KEEP_OPEN!"=="1" call :pause_keep
    exit /b 2
  )
  echo [nssm-install] Clearing old service before remove...
  call :force_clear_before_stop
  echo [nssm-install] nssm stop %SERVICE_NAME% ...
  call :nssm_stop_with_timeout
  echo [nssm-install] nssm remove %SERVICE_NAME% ...
  "%NSSM%" remove %SERVICE_NAME% confirm
  if errorlevel 1 (
    echo [ERROR] nssm remove failed. Remove GGNR_V7 manually in services.msc, then retry.
    set "EXIT_EC=1"
    goto :fail_end
  )
  echo [nssm-install] Old service removed.
)

echo [nssm-install] Installing service...
"%NSSM%" install %SERVICE_NAME% "%APP_BAT%"
if errorlevel 1 (
  echo [ERROR] nssm install failed
  set "EXIT_EC=1"
  goto :fail_end
)

"%NSSM%" set %SERVICE_NAME% AppDirectory "%ROOT%"
if errorlevel 1 (
  echo [ERROR] AppDirectory set failed
  set "EXIT_EC=1"
  goto :fail_end
)
"%NSSM%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM%" set %SERVICE_NAME% AppRestartDelay 3000
"%NSSM%" set %SERVICE_NAME% AppStopMethodSkip 1
"%NSSM%" set %SERVICE_NAME% AppStopMethodConsole 500
"%NSSM%" set %SERVICE_NAME% AppStopMethodWindow 500
"%NSSM%" set %SERVICE_NAME% AppStopMethodThreads 500

set "NSSM_PROJECT=%GGNR_NSSM_PROJECT%"
set "NSSM_ENV=%GGNR_NSSM_ENV%"
if not defined NSSM_PROJECT (
  for /f "tokens=2 delims==" %%A in ('findstr /I /C:"GGNR_PROJECT=" "%APP_BAT%" 2^>nul') do (
    set "NSSM_PROJECT=%%~A"
    goto :got_proj_from_bat
  )
)
:got_proj_from_bat
if not defined NSSM_ENV (
  for /f "tokens=2 delims==" %%A in ('findstr /I /C:"GGNR_ENV=" "%APP_BAT%" 2^>nul') do (
    set "NSSM_ENV=%%~A"
    goto :got_env_from_bat
  )
)
:got_env_from_bat
if defined NSSM_PROJECT set "NSSM_PROJECT=!NSSM_PROJECT:"=!"
if defined NSSM_ENV set "NSSM_ENV=!NSSM_ENV:"=!"
if defined NSSM_PROJECT if defined NSSM_ENV (
  echo [nssm-install] AppEnvironmentExtra GGNR_PROJECT=!NSSM_PROJECT! GGNR_ENV=!NSSM_ENV!
  "%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra GGNR_START_NO_PAUSE=1 GGNR_PROJECT=!NSSM_PROJECT! GGNR_ENV=!NSSM_ENV!
) else (
  echo [WARN] Could not read GGNR_PROJECT/GGNR_ENV from ggnr_start.bat. GGNR_START_NO_PAUSE only.
  "%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra GGNR_START_NO_PAUSE=1
)
"%NSSM%" set %SERVICE_NAME% AppStdout "%LOG_OUT%"
"%NSSM%" set %SERVICE_NAME% AppStderr "%LOG_ERR%"
"%NSSM%" set %SERVICE_NAME% AppStdoutCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppStderrCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppRotateFiles 1
"%NSSM%" set %SERVICE_NAME% AppRotateBytes 10485760
"%NSSM%" set %SERVICE_NAME% AppRotateOnline 1

:: ObjectName: env override, else src/config/projects/<project>.env [env] NSSM_OBJECT_*
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS goto :object_name_ready
call :load_nssm_object_from_project_env
:object_name_ready

:: demo: run service as G: share account (not LocalSystem) so UNC/file_data works
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS (
  echo [nssm-install] ObjectName=!GGNR_NSSM_OBJECT_NAME! ^(demo G: share account^)
  "%NSSM%" set %SERVICE_NAME% ObjectName "!GGNR_NSSM_OBJECT_NAME!" "!GGNR_NSSM_OBJECT_PASS!"
  if errorlevel 1 (
    echo [ERROR] nssm ObjectName set failed. Check account/password ^(Log on as a service right^).
    set "EXIT_EC=1"
    goto :fail_end
  )
) else (
  echo [nssm-install] ObjectName kept default ^(LocalSystem^) - no GGNR_NSSM_OBJECT_* / project.env NSSM_OBJECT_*.
)

echo [nssm-install] Starting service...
"%NSSM%" start %SERVICE_NAME%
if errorlevel 1 (
  echo [ERROR] Service start failed.
  echo         Check ggnr_start.bat project/env and node PATH.
  echo         If demo ObjectName was set: grant "Log on as a service" to that account.
  echo         status: "%NSSM%" status %SERVICE_NAME%
  echo         stdout: %LOG_OUT%
  echo         stderr: %LOG_ERR%
  "%NSSM%" status %SERVICE_NAME%
  echo.
  echo ----- last stderr ^(if any^) -----
  if exist "%LOG_ERR%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_ERR%' -Tail 40 -ErrorAction SilentlyContinue"
  ) else (
    echo ^(no stderr file yet^)
  )
  echo ----- last stdout ^(if any^) -----
  if exist "%LOG_OUT%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_OUT%' -Tail 40 -ErrorAction SilentlyContinue"
  ) else (
    echo ^(no stdout file yet^)
  )
  echo --------------------------------
  echo.
  echo [HINT] If ggnr_start.bat has a broken redirect like "2>" without "^&1", CMD exits instantly.
  echo        Re-run 00_make_ggnr_starter.bat with overwrite=Y to regenerate ggnr_start.bat.
  set "EXIT_EC=1"
  goto :fail_end
)

echo.
echo ===== SUCCESS =====
echo [OK] Service %SERVICE_NAME% registered and started.
"%NSSM%" status %SERVICE_NAME%
echo   stdout: %LOG_OUT%
echo   stderr: %LOG_ERR%
echo   backup: %LOG_BACKUP%
echo   install log: %INSTALL_LOG%
echo.
echo [live logs]
echo   00_open_ggnr_logs.bat or
echo   powershell -Command "Get-Content '%LOG_OUT%' -Encoding UTF8 -Wait -Tail 10"
echo.
call :log_line "OK service registered and started"
if "!KEEP_OPEN!"=="1" (
  call :pause_keep
) else (
  echo [INFO] starter mode - skip success pause. log: %INSTALL_LOG%
)
exit /b 0

:fail_end
echo.
echo ===== FAILED =====
echo [ERROR] nssm_install failed ^(exit=!EXIT_EC!^). See messages above.
echo         install log: %INSTALL_LOG%
echo         Press Enter to close this window.
echo.
call :log_line "FAIL exit=!EXIT_EC!"
call :pause_keep
exit /b !EXIT_EC!

:pause_keep
echo -----------------------------------------------------------
echo  Press any key to close this window.
echo  ^(install log: %INSTALL_LOG%^)
echo -----------------------------------------------------------
pause >nul
goto :eof

:log_line
echo %~1>> "%INSTALL_LOG%"
goto :eof

:force_clear_before_stop
"%NSSM%" set %SERVICE_NAME% AppStopMethodSkip 1 >nul 2>&1
"%NSSM%" set %SERVICE_NAME% AppStopMethodConsole 500 >nul 2>&1
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
timeout /t 1 /nobreak >nul
goto :eof

:nssm_stop_with_timeout
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$nssm='%NSSM%'; $svc='%SERVICE_NAME%';" ^
  "$p = Start-Process -FilePath $nssm -ArgumentList @('stop',$svc,'confirm') -PassThru -NoNewWindow -Wait:$false;" ^
  "if (-not $p.WaitForExit(15000)) { Write-Host '[nssm-install] stop timeout 15s - killing'; try { $p.Kill() } catch {}; exit 0 };" ^
  "Write-Host ('[nssm-install] nssm stop exit=' + $p.ExitCode)"
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
goto :eof

:kill_ggnr_start_cmds
echo [nssm-install] search leftover ggnr_start.bat cmd...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[nssm-install] no leftover ggnr_start cmd.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[nssm-install] taskkill /F /PID {0} /T' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:kill_listen_port
set "KP=%~1"
echo [nssm-install] check Listen on port %KP% ...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [nssm-install] port %KP% not listening.
  goto :eof
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [nssm-install] taskkill /F /PID %%P /T
    taskkill /F /PID %%P /T >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul
goto :eof

:EnsureLogFolders
if not exist "%LOG_DIR%" (
  mkdir "%LOG_DIR%"
  if errorlevel 1 (
    echo [ERROR] cannot create log dir: %LOG_DIR%
    exit /b 1
  )
  echo [nssm-install] created: %LOG_DIR%
)
if not exist "%LOG_BACKUP%" (
  mkdir "%LOG_BACKUP%"
  if errorlevel 1 (
    echo [ERROR] cannot create backup dir: %LOG_BACKUP%
    exit /b 1
  )
  echo [nssm-install] created: %LOG_BACKUP%
)
if not exist "%LOG_DIR%\linkage" (
  mkdir "%LOG_DIR%\linkage"
  echo [nssm-install] created: %LOG_DIR%\linkage
)
exit /b 0

:: ---------------------------------------------------------------------------
:: Read NSSM_OBJECT_NAME / NSSM_OBJECT_PASS from projects\<project>.env [<env>]
:: Fills GGNR_NSSM_OBJECT_NAME / GGNR_NSSM_OBJECT_PASS when missing.
:: ---------------------------------------------------------------------------
:load_nssm_object_from_project_env
if not defined NSSM_PROJECT goto :eof
if not defined NSSM_ENV goto :eof
set "PROJ_ENV_FILE=%ROOT%\src\config\projects\!NSSM_PROJECT!.env"
set "PS_READ_NSSM=%ROOT%\scripts\read-nssm-object-from-env.ps1"
if not exist "!PROJ_ENV_FILE!" (
  echo [nssm-install] no project.env for ObjectName: !PROJ_ENV_FILE!
  goto :eof
)
if not exist "!PS_READ_NSSM!" (
  echo [WARN] missing script: !PS_READ_NSSM!
  goto :eof
)
echo [nssm-install] reading NSSM_OBJECT_* from !NSSM_PROJECT!.env [!NSSM_ENV!]
set "PS_OBJ_OUT="
for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -File "!PS_READ_NSSM!" -EnvFile "!PROJ_ENV_FILE!" -Section "!NSSM_ENV!"`) do (
  set "PS_OBJ_OUT=1"
  set "LINE=%%L"
  if /i "!LINE:~0,5!"=="NAME=" if not defined GGNR_NSSM_OBJECT_NAME set "GGNR_NSSM_OBJECT_NAME=!LINE:~5!"
  if /i "!LINE:~0,5!"=="PASS=" if not defined GGNR_NSSM_OBJECT_PASS set "GGNR_NSSM_OBJECT_PASS=!LINE:~5!"
)
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS (
  echo [nssm-install] loaded ObjectName from project.env: !GGNR_NSSM_OBJECT_NAME!
) else if defined PS_OBJ_OUT (
  echo [WARN] project.env NSSM_OBJECT_* incomplete ^(need both NAME and PASS^)
) else (
  echo [nssm-install] no NSSM_OBJECT_* in project.env [!NSSM_ENV!]
)
goto :eof
