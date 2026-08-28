@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: ggnr_start.bat generator + optional nssm register / log window
:: Encoding: ASCII only (no Hangul). Safe on Korean CMD (CP949) and UTF-8 editors.
:: - root = folder of this bat
:: - node PATH = directory of "where node"
:: - npm ci from package-lock (Y/N; auto if GGNR_START_NO_PAUSE=1)
:: - then npm run build (GGNR_PROJECT/ENV -> BASE_PATH). fail => pause
:: - stop previous GGNR / free port 3000 AFTER successful build (before nssm)
:: - ggnr_start.bat + ggnr_build_project.bat generated from project/type prompts
:: - project / type / npm / overwrite / nssm asked once up front
:: - nssm = root\nssm\win64\nssm.exe
:: - python/env_parts optional restore
:: - if DO_NSSM=Y and not admin => require admin before build
:: - 00_open_ggnr_logs: skip if GGNR_LOG/GEOSERVER_LOG already open
:: - window keep: set /p. skip only if GGNR_STARTER_NO_PAUSE=1
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"
set "BUILD_OUT=%ROOT%\ggnr_build_project.bat"
set "NSSM_BAT=%ROOT%\00_nssm_install_ggnr.bat"
set "NSSM_EXE=%ROOT%\nssm\win64\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=%ROOT%\nssm\win32\nssm.exe"
set "LOGS_BAT=%ROOT%\00_open_ggnr_logs.bat"
set "SERVICE_NAME=GGNR_V7"
set "APP_PORT=3000"
:: GGNR_START_NO_PAUSE is for ggnr_start/nssm only - not this starter window
set "PAUSE_ON_FAIL=1"
if /i "%GGNR_STARTER_NO_PAUSE%"=="1" set "PAUSE_ON_FAIL=0"
set "NPM_SYNC_DONE=0"

echo.
echo [00_make_ggnr_starter] root = %ROOT%
echo [00_make_ggnr_starter] out  = %OUT%
if /i "%GGNR_START_NO_PAUSE%"=="1" echo [INFO] GGNR_START_NO_PAUSE=1 - auto Y for prompts ^(window kept; use GGNR_STARTER_NO_PAUSE=1 to skip pause^)
echo.

:: --- prompts (once) ---
echo [INPUT] Enter all values below. Y/N must be Y or N.
echo.
set /p "PROJECT_NAME=Project name (GGNR_PROJECT): "
if not defined PROJECT_NAME (
  echo [ERROR] Project name is empty.
  goto :fail_exit
)
echo(!PROJECT_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [ERROR] Project name must not contain spaces.
  goto :fail_exit
)

set /p "ENV_NAME=Type (GGNR_ENV, dev ^| demo ^| prod): "
if not defined ENV_NAME (
  echo [ERROR] Type is empty.
  goto :fail_exit
)
echo(!ENV_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [ERROR] Type must not contain spaces.
  goto :fail_exit
)

set "OVERWRITE=Y"
set "DO_REREG=N"
if /i "%GGNR_START_NO_PAUSE%"=="1" (
  echo [RUN] GGNR_START_NO_PAUSE=1 - auto Y for npm / overwrite / nssm
  set "DO_NPM_SYNC=Y"
  set "DO_NSSM=Y"
  set "DO_REREG=Y"
) else (
  echo.
  echo [NOTE] Prefer npm ci from package-lock.json for stable deploy.
  echo        Even if node_modules exists, choose Y when lock may mismatch.
  echo        Offline / air-gap: choose N ^(npm install may be unavailable^).
  echo.
  set /p "DO_NPM_SYNC=Run npm ci (or install) to sync deps? (Y/N): "
  if exist "%OUT%" (
    set /p "OVERWRITE=ggnr_start.bat exists. Overwrite? (Y/N): "
  )
  set /p "DO_NSSM=Register nssm service? (Y/N): "
  if /i "!DO_NSSM!"=="Y" (
    set /p "DO_REREG=If GGNR_V7 exists, delete and re-register? (Y/N): "
  )
)

:: normalize Y/N
set "DO_NPM_SYNC=!DO_NPM_SYNC: =!"
if /i not "!DO_NPM_SYNC!"=="Y" if /i not "!DO_NPM_SYNC!"=="N" (
  echo [WARN] npm sync input not Y/N - using N ^(input=[!DO_NPM_SYNC!]^)
  set "DO_NPM_SYNC=N"
)
set "OVERWRITE=!OVERWRITE: =!"
if /i not "!OVERWRITE!"=="Y" if /i not "!OVERWRITE!"=="N" (
  echo [WARN] overwrite input not Y/N - using Y ^(input=[!OVERWRITE!]^)
  set "OVERWRITE=Y"
)
set "DO_NSSM=!DO_NSSM: =!"
if /i not "!DO_NSSM!"=="Y" if /i not "!DO_NSSM!"=="N" (
  echo [WARN] nssm input not Y/N - using N ^(input=[!DO_NSSM!]^)
  set "DO_NSSM=N"
)
if /i "!DO_NSSM!"=="Y" (
  set "DO_REREG=!DO_REREG: =!"
  if /i not "!DO_REREG!"=="Y" if /i not "!DO_REREG!"=="N" (
    echo [WARN] re-register input not Y/N - using N ^(input=[!DO_REREG!]^)
    set "DO_REREG=N"
  )
) else (
  set "DO_REREG=N"
)

echo.
echo [CONFIRM]
echo   PROJECT     = %PROJECT_NAME%
echo   TYPE        = %ENV_NAME%
echo   npm sync    = !DO_NPM_SYNC!
echo   overwrite   = !OVERWRITE!
echo   nssm        = !DO_NSSM!
echo   re-register = !DO_REREG!
echo.

:: admin before build if nssm=Y (keep service on :3000 during npm sync/build)
if /i "!DO_NSSM!"=="Y" (
  call :require_admin
  if errorlevel 1 goto :fail_exit
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] where node failed. node not on PATH.
  goto :fail_exit
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node') do (
  set "NODE_EXE=%%I"
  goto :node_found
)

:node_found
if not defined NODE_EXE (
  echo [ERROR] could not read node.exe path.
  goto :fail_exit
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
if "%NODE_DIR:~-1%"=="\" set "NODE_DIR=%NODE_DIR:~0,-1%"

echo [00_make_ggnr_starter] node.exe = %NODE_EXE%
for /f "delims=" %%V in ('node -v 2^>nul') do echo [00_make_ggnr_starter] Node = %%V
echo [00_make_ggnr_starter] PATH add = %NODE_DIR%
echo.

echo [RUN] python/env restore check ^(skip if no env_parts^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\restore-python-env.ps1" -Root "%ROOT%"
if errorlevel 1 goto :fail_exit
echo.

if /i "!DO_NPM_SYNC!"=="Y" (
  call :run_npm_sync
  if errorlevel 1 goto :fail_exit
  set "NPM_SYNC_DONE=1"
  echo.
) else (
  echo [SKIP] dependency sync skipped.
  echo        nssm start may fail without node_modules\next. Run npm ci in root if needed.
  echo.
)

set "GGNR_PROJECT=%PROJECT_NAME%"
set "GGNR_ENV=%ENV_NAME%"
set "PATH=%PATH%;%NODE_DIR%"
call :run_npm_build
if errorlevel 1 goto :fail_exit
echo.
echo [OK] build done - next: ggnr_start / nssm
echo.
echo [CONFIRM]
echo   cd          = %ROOT%
echo   NODE_DIR    = %NODE_DIR%
echo   PROJECT     = %PROJECT_NAME%
echo   TYPE        = %ENV_NAME%
echo.

set "SKIP_WRITE=0"
if exist "%OUT%" (
  if /i not "!OVERWRITE!"=="Y" (
    echo [KEEP] existing ggnr_start.bat
    set "SKIP_WRITE=1"
  )
)

echo [RUN] post-build: ggnr_start.bat / ggnr_build_project.bat / nssm / logs
if "!SKIP_WRITE!"=="0" (
  echo [RUN] writing ggnr_start.bat ...
  call :write_ggnr_start
  if errorlevel 1 goto :fail_exit
  echo [RUN] writing ggnr_build_project.bat ...
  call :write_ggnr_build_project
  if errorlevel 1 goto :fail_exit
  if not exist "%OUT%" (
    echo [ERROR] failed to create ggnr_start.bat
    goto :fail_exit
  )
  if not exist "%BUILD_OUT%" (
    echo [ERROR] failed to create ggnr_build_project.bat
    goto :fail_exit
  )
  echo [OK] created: %OUT%
  echo [OK] created: %BUILD_OUT%
) else (
  if not exist "%OUT%" (
    echo [ERROR] ggnr_start.bat missing.
    goto :fail_exit
  )
  echo [WARN] keeping existing ggnr_start.bat / ggnr_build_project.bat
  echo        new project/type were NOT written into them.
  echo        re-run with overwrite=Y to update.
  echo.
)

echo [OK] ggnr_start.bat step done.

if /i not "!DO_NSSM!"=="Y" (
  echo [SKIP] nssm/logs ^(DO_NSSM=!DO_NSSM!^)
  echo [DONE] generate only.
  echo   manual: 00_nssm_install_ggnr.bat ^(admin CMD^) -> 00_open_ggnr_logs.bat
  echo.
  if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
  exit /b 0
)

call :require_admin
if errorlevel 1 goto :fail_exit

if not exist "%ROOT%\node_modules\next\package.json" (
  echo [ERROR] node_modules missing or next not installed.
  echo         re-run with npm sync=Y, or npm ci in root, then nssm.
  goto :fail_exit
)

if not exist "%NSSM_BAT%" (
  echo [ERROR] missing: %NSSM_BAT%
  goto :fail_exit
)
if not exist "%NSSM_EXE%" (
  echo [ERROR] nssm.exe missing: %NSSM_EXE%
  echo         check nssm\win64\nssm.exe in install ZIP.
  goto :fail_exit
)
if not exist "%LOGS_BAT%" (
  echo [ERROR] missing: %LOGS_BAT%
  goto :fail_exit
)

:: stop after successful build so :3000 stays up during npm run build
echo.
call :stop_previous_ggnr
echo.

echo.
echo [RUN] nssm register ^(1/2^)...
echo        ^(on failure, nssm_install window stays open - check message then Enter^)
set "GGNR_NSSM_REREG=!DO_REREG!"
set "GGNR_NSSM_PROJECT=%PROJECT_NAME%"
set "GGNR_NSSM_ENV=%ENV_NAME%"
set "GGNR_NSSM_FROM_STARTER=1"
call "%NSSM_BAT%"
set "NSSM_EC=!ERRORLEVEL!"
set "GGNR_NSSM_FROM_STARTER="
if "!NSSM_EC!"=="2" (
  echo [INFO] kept existing GGNR_V7 ^(no re-register^).
  echo        start GGNR_V7 from services if needed.
  echo.
  echo [RUN] log window ^(2/2^)...
  start "" /min cmd /c "%LOGS_BAT%"
  echo.
  echo [DONE] generate -> ^(keep service^) -> logs
  echo.
  if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
  exit /b 0
)
if not "!NSSM_EC!"=="0" (
  echo [STOP] nssm register/start failed ^(exit=!NSSM_EC!^)
  set "FAIL_EC=!NSSM_EC!"
  goto :fail_exit
)

echo.
echo [RUN] log window ^(2/2^)...
start "" /min cmd /c "%LOGS_BAT%"

echo.
echo [DONE] generate -> nssm -> logs
echo.
if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
exit /b 0

:fail_exit
if not defined FAIL_EC set "FAIL_EC=1"
echo.
echo [EXIT] stopped with error ^(exit=!FAIL_EC!^). See messages above.
echo        nssm log: C:\logs\nssm_install_last.log
echo        manual: 00_nssm_install_ggnr.bat ^(admin CMD^) -> 00_open_ggnr_logs.bat
if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
exit /b !FAIL_EC!

:: ---------------------------------------------------------------------------
:pause_keep
echo -----------------------------------------------------------
echo  Press Enter to close this window.
echo -----------------------------------------------------------
set /p "=Enter... "
goto :eof

:: ---------------------------------------------------------------------------
:require_admin
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] not running as administrator.
  echo         nssm register requires admin CMD.
  echo         Right-click CMD -> Run as administrator, then retry.
  set "FAIL_EC=1"
  exit /b 1
)
echo [OK] running as administrator.
exit /b 0

:: ---------------------------------------------------------------------------
:: write ggnr_start.bat - redirect block must stay ASCII
:: ---------------------------------------------------------------------------
:write_ggnr_start
> "%OUT%" (
echo @echo off
echo.
echo :: ggnr_v7 service start bat
echo.
echo :: encoding
echo chcp 65001 ^> nul
echo.
echo :: log folders only
echo set "LOG_DIR=C:\logs"
echo set "LOG_BACKUP=%%LOG_DIR%%\backup"
echo set "LOG_OUT=%%LOG_DIR%%\GGNR_V7_stdout.log"
echo if not exist "%%LOG_DIR%%" mkdir "%%LOG_DIR%%"
echo if not exist "%%LOG_BACKUP%%" mkdir "%%LOG_BACKUP%%"
echo.
echo :: cwd
echo cd /d %ROOT%
echo.
echo :: G: = \\192.168.127.11\service_data — nssm has no interactive drive mapping ^(silent^)
echo net use G: \\192.168.127.11\service_data /persistent:yes ^>nul 2^>&1
echo.
echo :: PATH node
echo set PATH=%%PATH%%;%NODE_DIR%
echo.
echo :: project
echo set "GGNR_PROJECT=%PROJECT_NAME%"
echo set "GGNR_ENV=%ENV_NAME%"
echo.
echo :: require next
echo if not exist "node_modules\.bin\next.cmd" ^(
echo   if not exist "node_modules\next\package.json" ^(
echo     echo [ERROR] node_modules/next missing. Run npm ci then retry.
echo     goto build_fail
echo   ^)
echo ^)
echo.
echo :: build if no BUILD_ID or BASE_PATH mismatch
echo call npx tsx scripts/check-base-path-build.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo if errorlevel 1 ^(
echo   if exist ".next\" ^(
echo     echo [WARN] BUILD_ID/basePath mismatch - rebuild with project env
echo   ^) else ^(
echo     echo [OK] no .next - build with project env
echo   ^)
echo   call npx tsx scripts/build-with-project-env.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo   if errorlevel 1 goto build_fail
echo   if not exist ".next\BUILD_ID" goto build_no_id
echo   echo [OK] npm run build done.
echo ^) else ^(
echo   echo [OK] BUILD_ID + BASE_PATH match - skip build
echo ^)
echo goto after_build
echo.
echo :build_fail
echo echo [ERROR] build-with-project-env failed.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo Press Enter to close...
echo   set /p "=Enter... "
echo ^)
echo exit /b 1
echo.
echo :build_no_id
echo echo [ERROR] BUILD_ID missing after build.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo Press Enter to close...
echo   set /p "=Enter... "
echo ^)
echo exit /b 1
echo.
echo :after_build
echo.
echo :: start app ^(nssm AppStdout^)
echo :: AppStopMethodSkip=1 + ^|^| call; avoids Terminate batch job Y/N
echo call npm run start -- "%%GGNR_PROJECT%%" "%%GGNR_ENV%%" ^|^| call;
echo if errorlevel 1 goto start_fail
echo exit /b 0
echo.
echo :start_fail
echo echo.
echo echo [ERROR] start failed. Check logs above.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo Press Enter to close...
echo   set /p "=Enter... "
echo ^)
echo exit /b 1
)
if not exist "%OUT%" exit /b 1
exit /b 0

:: ---------------------------------------------------------------------------
:: write ggnr_build_project.bat - manual BASE_PATH build (no prompts)
:: ---------------------------------------------------------------------------
:write_ggnr_build_project
> "%BUILD_OUT%" (
echo @echo off
echo setlocal EnableExtensions
echo set "BUILD_EC=1"
echo.
echo :: ggnr_v7 manual build - generated by 00_make_ggnr_starter.bat
echo.
echo chcp 65001 ^> nul
echo cd /d %ROOT%
echo set PATH=%%PATH%%;%NODE_DIR%
echo.
echo set "GGNR_PROJECT=%PROJECT_NAME%"
echo set "GGNR_ENV=%ENV_NAME%"
echo.
echo if not exist "node_modules\next\package.json" ^(
echo   echo [ERROR] next not installed. Run npm ci or npm install first.
echo   goto :end_pause
echo ^)
echo.
echo echo.
echo echo [npm run build] project: %%GGNR_PROJECT%%
echo echo [npm run build] type: %%GGNR_ENV%%
echo echo npx tsx scripts/build-with-project-env.ts %%GGNR_PROJECT%% %%GGNR_ENV%%
echo echo.
echo.
echo call npx tsx scripts/build-with-project-env.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo set "BUILD_EC=%%errorlevel%%"
echo.
echo if not "%%BUILD_EC%%"=="0" ^(
echo   echo [ERROR] build failed ^(exit=%%BUILD_EC%%^)
echo ^) else if exist ".next\BUILD_ID" ^(
echo   echo [OK] build done. BUILD_ID=
echo   type ".next\BUILD_ID"
echo ^) else ^(
echo   echo [ERROR] .next\BUILD_ID missing after build.
echo   set "BUILD_EC=1"
echo ^)
echo.
echo :end_pause
echo echo.
echo pause
echo exit /b %%BUILD_EC%%
)
if not exist "%BUILD_OUT%" exit /b 1
exit /b 0

:: npm ci if lock exists, else npm install
:run_npm_sync
pushd "%ROOT%"
if exist "package-lock.json" (
  echo [RUN] npm ci ^(package-lock.json, recreate node_modules^)...
  call npm ci
) else (
  echo [WARN] no package-lock.json - using npm install
  call npm install
)
set "NPM_EC=!errorlevel!"
popd
if not "!NPM_EC!"=="0" (
  echo [ERROR] dependency sync failed ^(exit=!NPM_EC!^)
  set "FAIL_EC=!NPM_EC!"
  exit /b !NPM_EC!
)
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [ERROR] next missing under node_modules. Check package.json / package-lock.json.
  set "FAIL_EC=1"
  exit /b 1
)
echo [OK] dependency sync done.
exit /b 0

:run_npm_build
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [ERROR] next not installed - cannot build. Re-run with npm sync=Y.
  set "FAIL_EC=1"
  exit /b 1
)
echo [RUN] build with project env ^(BASE_PATH like CRA PUBLIC_URL^) ...
echo        GGNR_PROJECT=%GGNR_PROJECT%  GGNR_ENV=%GGNR_ENV%
echo        keep this window open on failure.
pushd "%ROOT%"
call npx tsx scripts/build-with-project-env.ts "%GGNR_PROJECT%" "%GGNR_ENV%"
set "BUILD_EC=!errorlevel!"
popd
if not "!BUILD_EC!"=="0" (
  echo.
  echo ===== BUILD FAILED =====
  echo [ERROR] build-with-project-env failed ^(exit=!BUILD_EC!^)
  echo         check TypeScript/Next logs above. For gate, demo BASE_PATH must be baked in.
  set "FAIL_EC=!BUILD_EC!"
  exit /b !BUILD_EC!
)
if not exist "%ROOT%\.next\BUILD_ID" (
  echo.
  echo ===== BUILD FAILED =====
  echo [ERROR] .next\BUILD_ID missing after build.
  set "FAIL_EC=1"
  exit /b 1
)
echo [OK] npm run build done. BUILD_ID=
type "%ROOT%\.next\BUILD_ID"
echo.
exit /b 0

:: stop previous GGNR (service stop only, no remove) + free app port
:: Called after successful build, immediately before 00_nssm_install
:stop_previous_ggnr
echo [CLEAN] stop previous GGNR if running ^(service not removed^)...
if exist "%NSSM_EXE%" (
  "%NSSM_EXE%" status %SERVICE_NAME% >nul 2>&1
  if not errorlevel 1 (
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodSkip 1 >nul 2>&1
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodConsole 500 >nul 2>&1
    echo [CLEAN] nssm stop %SERVICE_NAME% ...
    "%NSSM_EXE%" stop %SERVICE_NAME% confirm >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo [CLEAN] service stop requested.
  ) else (
    echo [CLEAN] service %SERVICE_NAME% not installed - skip service stop.
  )
) else (
  echo [CLEAN] nssm.exe missing - skip service stop. check port only.
)
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
echo [CLEAN] previous run cleanup done.
goto :eof

:kill_ggnr_start_cmds
echo [CLEAN] search leftover ggnr_start.bat cmd...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[CLEAN] no leftover ggnr_start cmd.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[CLEAN] taskkill /F /PID {0} /T' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:kill_listen_port
set "KP=%~1"
echo [CLEAN] check Listen on port %KP% ...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [CLEAN] port %KP% not listening.
  goto :eof
)
set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [CLEAN] taskkill /F /PID %%P /T
    taskkill /F /PID %%P /T >nul 2>&1
    if not errorlevel 1 (
      set /a KILLED+=1
      echo [CLEAN] killed PID %%P
    ) else (
      echo [WARN] failed to kill PID %%P ^(gone or no permission^)
    )
  )
)
if "!KILLED!"=="0" (
  echo [INFO] no PID killed on port %KP%. try admin CMD.
) else (
  echo [CLEAN] killed !KILLED! process^(es^) for port %KP%.
)
timeout /t 1 /nobreak >nul
goto :eof
