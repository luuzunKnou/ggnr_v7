@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

:: =============================================================================
:: Register GGNR_V7 Windows service via nssm (run as Administrator)
:: Messages are Korean. First line after setlocal is chcp 65001 (UTF-8 console).
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
set "APP_PORT=80"
set "EXIT_EC=0"
set "KEEP_OPEN=1"
if /i "%GGNR_NSSM_FROM_STARTER%"=="1" set "KEEP_OPEN=0"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul
(
  echo ==== 서비스 등록 %DATE% %TIME% ====
  echo 설치 경로=%ROOT%
) > "%INSTALL_LOG%"

echo.
echo ============================================================
echo  서비스 등록 - GGNR_V7
echo ============================================================
echo [서비스등록] 설치 경로 = %ROOT%
echo [서비스등록] 실행 파일 = %APP_BAT%
echo [서비스등록] 로그 폴더 = %LOG_DIR%
echo [서비스등록] 설치 로그 = %INSTALL_LOG%
echo [서비스등록] 백업 폴더 = %LOG_BACKUP%
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 권한이 아닙니다.
  echo        관리자 권한으로 명령 프롬프트를 연 뒤 다시 실행하세요.
  echo        명령 프롬프트를 오른쪽 단추로 누른 뒤 관리자 권한으로 실행하세요.
  set "EXIT_EC=1"
  goto :fail_end
)
echo [확인] 관리자 권한으로 실행 중입니다.

if not exist "%APP_BAT%" (
  echo [오류] 시작 파일이 없습니다: %APP_BAT%
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
  echo [오류] nssm 실행 파일이 없습니다.
  echo         예상 위치: %ROOT%\nssm\win64\nssm.exe
  set "EXIT_EC=1"
  goto :fail_end
)
echo [서비스등록] nssm = %NSSM%

call :EnsureLogFolders
if errorlevel 1 (
  set "EXIT_EC=1"
  goto :fail_end
)

"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if not errorlevel 1 (
  echo [서비스등록] 서비스 %SERVICE_NAME% 이(가) 이미 등록되어 있습니다.
  if defined GGNR_NSSM_REREG (
    set "DO_REREG=%GGNR_NSSM_REREG%"
    echo [서비스등록] 다시 등록 = !DO_REREG! ^(상위 스크립트에서 전달^)
  ) else (
    set /p "DO_REREG=기존 서비스를 지우고 다시 등록할까요? (Y/N): "
  )
  if /i not "!DO_REREG!"=="Y" (
    echo.
    echo ===== 취소됨 ^(실패가 아닙니다^) =====
    echo [건너뜀] 기존 서비스를 유지합니다. 다시 등록하지 않습니다. ^(종료=2^)
    echo.
    call :log_line "취소 종료=2 다시 등록하지 않음"
    if "!KEEP_OPEN!"=="1" call :pause_keep
    exit /b 2
  )
  echo [서비스등록] 제거 전에 기존 서비스를 정리합니다...
  call :force_clear_before_stop
  echo [서비스등록] 서비스 중지 %SERVICE_NAME% ...
  call :nssm_stop_with_timeout
  echo [서비스등록] 서비스 제거 %SERVICE_NAME% ...
  "%NSSM%" remove %SERVICE_NAME% confirm
  if errorlevel 1 (
    echo [오류] 서비스 제거에 실패했습니다. 서비스 관리에서 GGNR_V7을 직접 지운 뒤 다시 실행하세요.
    set "EXIT_EC=1"
    goto :fail_end
  )
  echo [서비스등록] 기존 서비스를 제거했습니다.
)

echo [서비스등록] 서비스를 등록합니다...
"%NSSM%" install %SERVICE_NAME% "%APP_BAT%"
if errorlevel 1 (
  echo [오류] 서비스 등록에 실패했습니다
  set "EXIT_EC=1"
  goto :fail_end
)

"%NSSM%" set %SERVICE_NAME% AppDirectory "%ROOT%"
if errorlevel 1 (
  echo [오류] 작업 폴더 설정에 실패했습니다
  set "EXIT_EC=1"
  goto :fail_end
)
:: Restart is applied after ObjectName. A restart before the account is set starts as LocalSystem on demo.
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
  echo [서비스등록] 환경 값 프로젝트=!NSSM_PROJECT! 구분=!NSSM_ENV!
  "%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra GGNR_START_NO_PAUSE=1 GGNR_PROJECT=!NSSM_PROJECT! GGNR_ENV=!NSSM_ENV!
) else (
  echo [경고] 시작 파일에서 프로젝트와 구분을 읽지 못했습니다. 일시정지 생략만 적용합니다.
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
:: Disable DelayedExpansion here so passwords with "!" (e.g. admin00!!) are not stripped.
:: When an account is set: register (above) -> grant logon -> start. Do not start before the account.
set "START_AFTER_RIGHT=0"
setlocal DisableDelayedExpansion
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS goto :object_name_ready
call :load_nssm_object_from_project_env
:object_name_ready

:: demo: run service as G: share account (not LocalSystem) so UNC/file_data works
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS (
  echo [권한] 서비스 등록이 끝났습니다. 실행 계정을 설정합니다. 계정=%GGNR_NSSM_OBJECT_NAME%
  "%NSSM%" set %SERVICE_NAME% ObjectName "%GGNR_NSSM_OBJECT_NAME%" "%GGNR_NSSM_OBJECT_PASS%"
  if errorlevel 1 (
    echo [오류] 서비스 실행 계정 설정에 실패했습니다. 계정, 비밀번호, 서비스로 로그온 권한을 확인하세요.
    endlocal
    set "EXIT_EC=1"
    goto :fail_end
  )
  echo [권한] 서비스 실행 계정으로 권한을 부여했습니다. 계정=%GGNR_NSSM_OBJECT_NAME%
  echo [권한] 권한 설정이 끝났습니다. 이제 서비스를 시작합니다.
  endlocal & set "START_AFTER_RIGHT=1" & goto :after_object_name
) else (
  echo [권한] 실행 계정이 없어 로컬 시스템 계정으로 유지합니다. 권한 부여를 생략합니다.
  endlocal
)
:after_object_name

"%NSSM%" set %SERVICE_NAME% AppExit Default Restart

if /i "!START_AFTER_RIGHT!"=="1" (
  echo [서비스등록] 권한 반영을 기다린 뒤 서비스를 시작합니다...
  timeout /t 3 /nobreak >nul
) else (
  echo [서비스등록] 서비스를 시작합니다...
)
"%NSSM%" start %SERVICE_NAME%
if errorlevel 1 if /i "!START_AFTER_RIGHT!"=="1" (
  echo [권한] 바로 시작되지 않았습니다. 권한 반영 후 다시 시작합니다...
  timeout /t 5 /nobreak >nul
  "%NSSM%" start %SERVICE_NAME%
)
if errorlevel 1 (
  echo [오류] 서비스 시작에 실패했습니다.
  echo        시작 파일의 프로젝트, 구분과 node 경로를 확인하세요.
  echo        시연 계정을 넣은 경우 그 계정에 서비스로 로그온 권한을 부여하세요.
  echo        상태: "%NSSM%" status %SERVICE_NAME%
  echo        표준 출력: %LOG_OUT%
  echo        오류 출력: %LOG_ERR%
  "%NSSM%" status %SERVICE_NAME%
  echo.
  echo ----- 최근 오류 출력 ^(있는 경우^) -----
  if exist "%LOG_ERR%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_ERR%' -Tail 40 -ErrorAction SilentlyContinue"
  ) else (
    echo ^(오류 출력 파일이 아직 없습니다^)
  )
  echo ----- 최근 표준 출력 ^(있는 경우^) -----
  if exist "%LOG_OUT%" (
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_OUT%' -Tail 40 -ErrorAction SilentlyContinue"
  ) else (
    echo ^(표준 출력 파일이 아직 없습니다^)
  )
  echo --------------------------------
  echo.
  echo [안내] 시작 파일의 출력 연결이 깨져 있으면 명령이 바로 끝납니다.
  echo        시작 파일 만들기를 덮어쓰기로 다시 실행하세요.
  set "EXIT_EC=1"
  goto :fail_end
)

echo.
echo ===== 성공 =====
echo [확인] 서비스 %SERVICE_NAME% 등록 후 시작했습니다.
"%NSSM%" status %SERVICE_NAME%
echo   표준 출력: %LOG_OUT%
echo   오류 출력: %LOG_ERR%
echo   백업: %LOG_BACKUP%
echo   설치 로그: %INSTALL_LOG%
echo.
echo [실시간 로그]
echo   00_open_ggnr_logs.bat 또는
echo   powershell -Command "Get-Content '%LOG_OUT%' -Encoding UTF8 -Wait -Tail 10"
echo.
call :log_line "확인 서비스 등록 후 시작함"
if "!KEEP_OPEN!"=="1" (
  call :pause_keep
) else (
  echo [안내] 시작 생성 호출이라 성공 후 정지는 건너뜁니다. 로그: %INSTALL_LOG%
)
exit /b 0

:fail_end
echo.
echo ===== 실패 =====
echo [오류] 서비스 등록에 실패했습니다 ^(종료=!EXIT_EC!^). 위 메시지를 확인하세요.
echo        설치 로그: %INSTALL_LOG%
echo        엔터를 누르면 이 창이 닫힙니다.
echo.
call :log_line "실패 종료=!EXIT_EC!"
call :pause_keep
exit /b !EXIT_EC!

:pause_keep
echo -----------------------------------------------------------
echo  아무 키나 누르면 이 창이 닫힙니다.
echo  ^(설치 로그: %INSTALL_LOG%^)
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
  "if (-not $p.WaitForExit(15000)) { Write-Host '[서비스등록] 중지 대기 15초 초과. 강제 종료합니다'; try { $p.Kill() } catch {}; exit 0 };" ^
  "Write-Host ('[서비스등록] 서비스 중지 종료코드=' + $p.ExitCode)"
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
goto :eof

:kill_ggnr_start_cmds
echo [서비스등록] 남아 있는 시작 명령 창을 찾습니다...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[서비스등록] 남아 있는 시작 명령 창이 없습니다.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[서비스등록] 남은 시작 프로세스를 강제 종료합니다. PID {0}' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:kill_listen_port
set "KP=%~1"
echo [서비스등록] 포트 %KP% 사용 여부를 확인합니다...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [서비스등록] 포트 %KP% 은(는) 사용 중이 아닙니다.
  goto :eof
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [서비스등록] 포트 사용 프로세스를 강제 종료합니다. PID %%P
    taskkill /F /PID %%P /T >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul
goto :eof

:EnsureLogFolders
if not exist "%LOG_DIR%" (
  mkdir "%LOG_DIR%"
  if errorlevel 1 (
    echo [오류] 로그 폴더를 만들 수 없습니다: %LOG_DIR%
    exit /b 1
  )
  echo [서비스등록] 로그 폴더를 만들었습니다: %LOG_DIR%
)
if not exist "%LOG_BACKUP%" (
  mkdir "%LOG_BACKUP%"
  if errorlevel 1 (
    echo [오류] 백업 폴더를 만들 수 없습니다: %LOG_BACKUP%
    exit /b 1
  )
  echo [서비스등록] 백업 폴더를 만들었습니다: %LOG_BACKUP%
)
if not exist "%LOG_DIR%\linkage" (
  mkdir "%LOG_DIR%\linkage"
  echo [서비스등록] 연계 로그 폴더를 만들었습니다: %LOG_DIR%\linkage
)
exit /b 0

:: ---------------------------------------------------------------------------
:: Read NSSM_OBJECT_NAME / NSSM_OBJECT_PASS from projects\<project>.env [<env>]
:: Fills GGNR_NSSM_OBJECT_NAME / GGNR_NSSM_OBJECT_PASS when missing.
:: Caller must use DisableDelayedExpansion so "!" in PASS is preserved.
:: ---------------------------------------------------------------------------
:load_nssm_object_from_project_env
if not defined NSSM_PROJECT goto :eof
if not defined NSSM_ENV goto :eof
set "PROJ_ENV_FILE=%ROOT%\src\config\projects\%NSSM_PROJECT%.env"
set "PS_READ_NSSM=%ROOT%\scripts\read-nssm-object-from-env.ps1"
if not exist "%PROJ_ENV_FILE%" (
  echo [권한] 실행 계정을 읽을 프로젝트 설정 파일이 없습니다: %PROJ_ENV_FILE%
  goto :eof
)
if not exist "%PS_READ_NSSM%" (
  echo [경고] 계정 읽기 스크립트가 없습니다: %PS_READ_NSSM%
  goto :eof
)
echo [권한] %NSSM_PROJECT%.env [%NSSM_ENV%] 에서 서비스 실행 계정을 읽습니다
set "PS_OBJ_OUT="
for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_READ_NSSM%" -EnvFile "%PROJ_ENV_FILE%" -Section "%NSSM_ENV%"`) do (
  set "PS_OBJ_OUT=1"
  set "LINE=%%L"
  call :_load_nssm_object_line
)
if defined GGNR_NSSM_OBJECT_NAME if defined GGNR_NSSM_OBJECT_PASS (
  echo [권한] 설정에서 서비스 실행 계정을 읽었습니다: %GGNR_NSSM_OBJECT_NAME%
) else if defined PS_OBJ_OUT (
  echo [경고] 설정에 계정과 비밀번호가 둘 다 있어야 합니다
) else (
  echo [권한] 이 구분 설정에는 서비스 실행 계정이 없습니다 [%NSSM_ENV%]
)
goto :eof

:_load_nssm_object_line
:: LINE set by caller; use % expansion only (no !VAR!) so "!" in password survives.
set "HEAD=%LINE:~0,5%"
if /i "%HEAD%"=="NAME=" if not defined GGNR_NSSM_OBJECT_NAME set "GGNR_NSSM_OBJECT_NAME=%LINE:~5%"
if /i "%HEAD%"=="PASS=" if not defined GGNR_NSSM_OBJECT_PASS set "GGNR_NSSM_OBJECT_PASS=%LINE:~5%"
goto :eof
