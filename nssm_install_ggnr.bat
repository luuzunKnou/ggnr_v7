@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: nssm에 GGNR_V7 서비스 자동 등록 (관리자 권한으로 실행)
:: - 프로젝트 경로 = 이 bat이 있는 root (ggnr_start.bat 과 동일 폴더)
:: - 앱 = root\ggnr_start.bat
:: - 로그 = C:\logs\GGNR_V7_stdout.log / GGNR_V7_stderr.log
:: - 기존 서비스가 있으면 Y/N 후 삭제·재등록 (N이면 등록 중단 exit 2)
:: - GGNR_NSSM_REREG=Y^|N 이면 재질문 없이 그 값 사용 (00_make_ggnr_starter 연동)
:: - 실패 시 항상 pause (창 유지). 성공 시 GGNR_START_NO_PAUSE=1 이면 pause 생략
:: - stop 전 포트·ggnr_start 강제 종료 + AppStopMethodSkip (Terminate Y/N 멈춤 방지)
:: =============================================================================

set "SERVICE_NAME=GGNR_V7"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "APP_BAT=%ROOT%\ggnr_start.bat"
set "LOG_DIR=C:\logs"
set "LOG_BACKUP=%LOG_DIR%\backup"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "LOG_ERR=%LOG_DIR%\GGNR_V7_stderr.log"
set "APP_PORT=3000"
set "EXIT_EC=0"

echo.
echo ============================================================
echo  nssm_install_ggnr — GGNR_V7 서비스 등록
echo ============================================================
echo [nssm-install] root     = %ROOT%
echo [nssm-install] app      = %APP_BAT%
echo [nssm-install] log dir  = %LOG_DIR%
echo [nssm-install] backup   = %LOG_BACKUP%
echo.

:: 관리자 여부
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 실행이 아닙니다.
  echo         이 스크립트는 관리자 CMD에서 실행해야 합니다.
  echo         CMD를 마우스 오른쪽 버튼 → «관리자 권한으로 실행» 후 다시 실행하세요.
  set "EXIT_EC=1"
  goto :fail_end
)
echo [확인] 관리자 권한으로 실행 중입니다.

if not exist "%APP_BAT%" (
  echo [오류] ggnr_start.bat 이 root에 없습니다: %APP_BAT%
  set "EXIT_EC=1"
  goto :fail_end
)

:: nssm 찾기 (프로젝트 내부: root\nssm\win64\nssm.exe)
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
  echo [오류] nssm.exe 를 찾지 못했습니다.
  echo   기대 경로: %ROOT%\nssm\win64\nssm.exe
  set "EXIT_EC=1"
  goto :fail_end
)
echo [nssm-install] nssm     = %NSSM%

:: log / log\backup 폴더만 생성
call :EnsureLogFolders
if errorlevel 1 (
  set "EXIT_EC=1"
  goto :fail_end
)

:: 기존 서비스면 Y/N 후 중지·제거(재등록). 상위 스크립트가 GGNR_NSSM_REREG 를 주면 재질문 없음
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if not errorlevel 1 (
  echo [nssm-install] 서비스 %SERVICE_NAME% 가 이미 등록되어 있습니다.
  if defined GGNR_NSSM_REREG (
    set "DO_REREG=%GGNR_NSSM_REREG%"
    echo [nssm-install] 재등록 여부 = !DO_REREG! ^(상위 스크립트에서 지정^)
  ) else (
    set /p "DO_REREG=삭제 후 재등록할까요? (Y/N): "
  )
  if /i not "!DO_REREG!"=="Y" (
    echo.
    echo ===== 중단 ^(실패 아님^) =====
    echo [중단] 기존 서비스를 유지합니다. 재등록하지 않았습니다. ^(exit=2^)
    echo.
    if /i not "%GGNR_START_NO_PAUSE%"=="1" call :pause_keep
    exit /b 2
  )
  echo [nssm-install] 기존 서비스 강제 정리 후 중지/제거...
  call :force_clear_before_stop
  echo [nssm-install] nssm stop %SERVICE_NAME% ...
  call :nssm_stop_with_timeout
  echo [nssm-install] nssm remove %SERVICE_NAME% ...
  "%NSSM%" remove %SERVICE_NAME% confirm
  if errorlevel 1 (
    echo [오류] nssm remove 실패. 서비스 관리자에서 GGNR_V7 을 수동 제거한 뒤 다시 실행하세요.
    set "EXIT_EC=1"
    goto :fail_end
  )
  echo [nssm-install] 기존 서비스 제거 완료.
)

echo [nssm-install] 서비스 등록...
"%NSSM%" install %SERVICE_NAME% "%APP_BAT%"
if errorlevel 1 (
  echo [오류] nssm install 실패
  set "EXIT_EC=1"
  goto :fail_end
)

"%NSSM%" set %SERVICE_NAME% AppDirectory "%ROOT%"
if errorlevel 1 (
  echo [오류] AppDirectory 설정 실패
  set "EXIT_EC=1"
  goto :fail_end
)
"%NSSM%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM%" set %SERVICE_NAME% AppRestartDelay 3000
:: bat+npm 구조에서 stop 시 Ctrl+C → 「Terminate batch job (Y/N)?」로그 멈춤 방지
"%NSSM%" set %SERVICE_NAME% AppStopMethodSkip 1
"%NSSM%" set %SERVICE_NAME% AppStopMethodConsole 500
"%NSSM%" set %SERVICE_NAME% AppStopMethodWindow 500
"%NSSM%" set %SERVICE_NAME% AppStopMethodThreads 500

:: ggnr_start.bat 실패 시 pause 방지 + 프로젝트/타입 (run.ts 가 argv보다 env 우선)
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
  echo [경고] ggnr_start.bat 에서 GGNR_PROJECT/GGNR_ENV 를 못 읽었습니다. GGNR_START_NO_PAUSE 만 설정합니다.
  "%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra GGNR_START_NO_PAUSE=1
)
"%NSSM%" set %SERVICE_NAME% AppStdout "%LOG_OUT%"
"%NSSM%" set %SERVICE_NAME% AppStderr "%LOG_ERR%"
"%NSSM%" set %SERVICE_NAME% AppStdoutCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppStderrCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppRotateFiles 1
"%NSSM%" set %SERVICE_NAME% AppRotateBytes 10485760
"%NSSM%" set %SERVICE_NAME% AppRotateOnline 1

echo [nssm-install] 서비스 시작...
"%NSSM%" start %SERVICE_NAME%
if errorlevel 1 (
  echo [오류] 서비스 시작 실패.
  echo         ggnr_start.bat 의 프로젝트명/환경·node PATH 를 확인하세요.
  echo         상태 확인: "%NSSM%" status %SERVICE_NAME%
  echo         stdout: %LOG_OUT%
  echo         stderr: %LOG_ERR%
  "%NSSM%" status %SERVICE_NAME%
  set "EXIT_EC=1"
  goto :fail_end
)

echo.
echo ===== 성공 =====
echo [완료] 서비스 %SERVICE_NAME% 등록·시작됨.
"%NSSM%" status %SERVICE_NAME%
echo   stdout: %LOG_OUT%
echo   stderr: %LOG_ERR%
echo   backup 폴더: %LOG_BACKUP%
echo.
echo [실시간 로그]
echo   open_ggnr_logs.bat 또는
echo   powershell -Command "Get-Content '%LOG_OUT%' -Encoding UTF8 -Wait -Tail 10"
echo.
if /i "%GGNR_START_NO_PAUSE%"=="1" (
  echo [안내] GGNR_START_NO_PAUSE=1 — 성공 pause 생략 ^(상위 starter 가 이어서 진행^)
) else (
  call :pause_keep
)
exit /b 0

:fail_end
echo.
echo ===== 실패 =====
echo [종료] nssm_install 실패 ^(exit=!EXIT_EC!^). 위 메시지를 확인하세요.
echo         창을 닫지 마세요 — 로그 확인 후 아무 키나 누르면 종료됩니다.
echo.
call :pause_keep
exit /b !EXIT_EC!

:pause_keep
echo -----------------------------------------------------------
echo  확인 후 아무 키나 누르면 이 창이 닫힙니다.
echo -----------------------------------------------------------
pause >nul
goto :eof

:: ---------------------------------------------------------------------------
:: stop 전에 Ctrl+C/Y/N 대기 프로세스·포트 정리
:: ---------------------------------------------------------------------------
:force_clear_before_stop
"%NSSM%" set %SERVICE_NAME% AppStopMethodSkip 1 >nul 2>&1
"%NSSM%" set %SERVICE_NAME% AppStopMethodConsole 500 >nul 2>&1
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
timeout /t 1 /nobreak >nul
goto :eof

:: nssm stop 이 Y/N 등으로 오래 걸리면 15초 후 강제 포트·cmd 정리
:nssm_stop_with_timeout
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$nssm='%NSSM%'; $svc='%SERVICE_NAME%';" ^
  "$p = Start-Process -FilePath $nssm -ArgumentList @('stop',$svc,'confirm') -PassThru -NoNewWindow -Wait:$false;" ^
  "if (-not $p.WaitForExit(15000)) { Write-Host '[nssm-install] stop 15초 초과 — 프로세스 강제 종료'; try { $p.Kill() } catch {}; exit 0 };" ^
  "Write-Host ('[nssm-install] nssm stop exit=' + $p.ExitCode)"
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
goto :eof

:kill_ggnr_start_cmds
echo [nssm-install] ggnr_start.bat 잔여 cmd 검색...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[nssm-install] ggnr_start 잔여 없음.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[nssm-install] taskkill /F /PID {0} /T' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:kill_listen_port
set "KP=%~1"
echo [nssm-install] 포트 %KP% Listen 확인...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [nssm-install] 포트 %KP% Listen 없음.
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

:: ---------------------------------------------------------------------------
:EnsureLogFolders
if not exist "%LOG_DIR%" (
  mkdir "%LOG_DIR%"
  if errorlevel 1 (
    echo [오류] 로그 폴더 생성 실패: %LOG_DIR%
    exit /b 1
  )
  echo [nssm-install] 생성: %LOG_DIR%
)
if not exist "%LOG_BACKUP%" (
  mkdir "%LOG_BACKUP%"
  if errorlevel 1 (
    echo [오류] 백업 폴더 생성 실패: %LOG_BACKUP%
    exit /b 1
  )
  echo [nssm-install] 생성: %LOG_BACKUP%
)
if not exist "%LOG_DIR%\linkage" (
  mkdir "%LOG_DIR%\linkage"
  echo [nssm-install] 생성: %LOG_DIR%\linkage
)
exit /b 0
