@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: ggnr_start.bat 생성기 + (선택) nssm 등록 · 로그 창
:: - 실행 위치 root = 이 bat이 있는 폴더
:: - node PATH = where node 결과의 디렉터리
:: - package-lock.json 기준 npm ci 로 의존성 동기화 (Y/N, GGNR_START_NO_PAUSE=1 이면 자동)
:: - 이어서 npm run build (GGNR_PROJECT/ENV → BASE_PATH 반영). 실패 시 pause 후 중단
:: - ggnr_start.bat: BUILD_ID 있으면 빌드 생략 → start (없으면 보완 빌드)
:: - 프로젝트명·타입·npm·덮어쓰기·nssm Y/N = 실행 전 한 번에 입력
:: - nssm = root\nssm\win64\nssm.exe (프로젝트 내)
:: - python/env_parts 는 필수가 아님. 있을 때만 python/env 로 복원 후 env_parts 삭제
::   (이미 python\env\python.exe 가 있거나 env_parts 가 없으면 복원 생략·정상 진행)
:: - 입력 후: 이전 GGNR 서비스·앱 포트 정리 → 생성 → (선택) nssm → 로그 창
:: - 이전 실행이 남아 Ctrl+C 로 끊지 않도록, 작업 시작 전 자동 중지 (Terminate batch job 방지)
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"
set "NSSM_BAT=%ROOT%\nssm_install_ggnr.bat"
set "NSSM_EXE=%ROOT%\nssm\win64\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=%ROOT%\nssm\win32\nssm.exe"
set "LOGS_BAT=%ROOT%\open_ggnr_logs.bat"
set "SERVICE_NAME=GGNR_V7"
set "APP_PORT=3000"
:: 더블클릭 창이 오류 직후 닫히지 않도록 (nssm·자동화는 GGNR_START_NO_PAUSE=1)
set "PAUSE_ON_FAIL=1"
if /i "%GGNR_START_NO_PAUSE%"=="1" set "PAUSE_ON_FAIL=0"
set "NPM_SYNC_DONE=0"

echo.
echo [00_make_ggnr_starter] root = %ROOT%
echo [00_make_ggnr_starter] 출력 = %OUT%
echo.

:: --- 사용자 입력 (실행 전 한 번에 수집, 이후 Y/N 없음) ---
echo [입력] 아래를 모두 입력한 뒤 작업을 시작합니다. (Y/N 은 Y 또는 N)
echo.
set /p "PROJECT_NAME=프로젝트명 (GGNR_PROJECT): "
if not defined PROJECT_NAME (
  echo [오류] 프로젝트명이 비어 있습니다.
  goto :fail_exit
)
echo(!PROJECT_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [오류] 프로젝트명에 공백이 있습니다. 공백 없이 입력하세요.
  goto :fail_exit
)

set /p "ENV_NAME=타입 (GGNR_ENV, dev ^| demo ^| prod): "
if not defined ENV_NAME (
  echo [오류] 타입이 비어 있습니다.
  goto :fail_exit
)
echo(!ENV_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [오류] 타입명에 공백이 있습니다. 공백 없이 입력하세요.
  goto :fail_exit
)

set "OVERWRITE=Y"
set "DO_REREG=N"
if /i "%GGNR_START_NO_PAUSE%"=="1" (
  echo [진행] GGNR_START_NO_PAUSE=1 — npm·덮어쓰기·nssm 자동 Y
  set "DO_NPM_SYNC=Y"
  set "DO_NSSM=Y"
  set "DO_REREG=Y"
) else (
  echo.
  echo [고지] 배포 안정을 위해 package-lock.json 기준 npm ci 를 권장합니다.
  echo         기존 node_modules 가 있어도 복사본·lock 불일치면 Y 로 lock 과 맞추세요.
  echo         폐쇄망일 경우 N 을 입력하세요 ^(npm install 불가^).
  echo.
  set /p "DO_NPM_SYNC=npm ci ^(또는 install^) 로 의존성 동기화할까요? (Y/N): "
  if exist "%OUT%" (
    set /p "OVERWRITE=이미 ggnr_start.bat 이 있습니다. 덮어쓸까요? (Y/N): "
  )
  set /p "DO_NSSM=nssm 서비스를 등록할까요? (Y/N): "
  if /i "!DO_NSSM!"=="Y" (
    set /p "DO_REREG=기존 GGNR_V7 서비스가 있으면 삭제 후 재등록할까요? (Y/N): "
  )
)

echo.
echo [확인]
echo   PROJECT     = %PROJECT_NAME%
echo   TYPE        = %ENV_NAME%
echo   npm 동기화  = !DO_NPM_SYNC!
echo   덮어쓰기    = !OVERWRITE!
echo   nssm 등록   = !DO_NSSM!
echo   재등록      = !DO_REREG!
echo.

:: 이전 ggnr_start / nssm / node 가 살아 있으면 npm ci·재등록이 잠기거나
:: 사용자가 Ctrl+C 로 끊다 «Terminate batch job (Y/N)?» 를 보게 됨 → 먼저 정리
call :stop_previous_ggnr
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] where node 실패. PATH 에 node 가 없습니다.
  goto :fail_exit
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node') do (
  set "NODE_EXE=%%I"
  goto :node_found
)

:node_found
if not defined NODE_EXE (
  echo [오류] node.exe 경로를 읽지 못했습니다.
  goto :fail_exit
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
if "%NODE_DIR:~-1%"=="\" set "NODE_DIR=%NODE_DIR:~0,-1%"

echo [00_make_ggnr_starter] node.exe = %NODE_EXE%
for /f "delims=" %%V in ('node -v 2^>nul') do echo [00_make_ggnr_starter] Node = %%V
echo [00_make_ggnr_starter] PATH 추가 = %NODE_DIR%
echo.

:: --- python/env : env_parts 있으면 복원(필수 아님·없으면 생략 exit 0) ---
echo [진행] python/env 복원 확인 ^(env_parts 없으면 생략^)...
:: PowerShell 한글 로그: 스크립트 UTF-8 BOM + 콘솔 UTF-8 (restore-python-env.ps1 상단)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\restore-python-env.ps1" -Root "%ROOT%"
if errorlevel 1 goto :fail_exit
echo.

:: --- 의존성 동기화: node_modules 유무와 관계없이 lock 기준 재설치 권장 ---
if /i "!DO_NPM_SYNC!"=="Y" (
  call :run_npm_sync
  if errorlevel 1 goto :fail_exit
  set "NPM_SYNC_DONE=1"
  echo.
) else (
  echo [건너뜀] 의존성 동기화를 하지 않습니다.
  echo         nssm 기동 시 node_modules\next 가 없으면 실패할 수 있습니다. 필요 시 root 에서 npm ci 를 실행하세요.
  echo.
)

:: --- production 빌드: starter 에서 끝낸다 (nssm/ggnr_start 가 빌드부터 도는 것 방지) ---
:: GGNR_PROJECT/ENV 로 next.config 가 BASE_PATH 를 읽음 (예: demo → /build_yy)
set "GGNR_PROJECT=%PROJECT_NAME%"
set "GGNR_ENV=%ENV_NAME%"
set "PATH=%PATH%;%NODE_DIR%"
call :run_npm_build
if errorlevel 1 goto :fail_exit
echo.

echo.
echo [확인]
echo   cd          = %ROOT%
echo   NODE_DIR    = %NODE_DIR%
echo   PROJECT     = %PROJECT_NAME%
echo   TYPE        = %ENV_NAME%
echo.

set "SKIP_WRITE=0"
if exist "%OUT%" (
  if /i not "!OVERWRITE!"=="Y" (
    echo [유지] 기존 ggnr_start.bat 을 그대로 둡니다.
    set "SKIP_WRITE=1"
  )
)

if "!SKIP_WRITE!"=="0" (
  :: %% → 생성된 bat 에 % 한 개로 남김
  > "%OUT%" (
  echo @echo off
  echo.
  echo :: ggnr_v7 서비스 등록시 실행용 bat
  echo.
  echo :: [인코딩 설정] UTF-8 BOM 인코딩 설정
  echo chcp 65001 ^> nul
  echo.
  echo :: [로그 폴더] 없으면 C:\logs , C:\logs\backup 생성. 로그 파일은 생성하지 않음
  echo set "LOG_DIR=C:\logs"
  echo set "LOG_BACKUP=%%LOG_DIR%%\backup"
  echo set "LOG_OUT=%%LOG_DIR%%\GGNR_V7_stdout.log"
  echo if not exist "%%LOG_DIR%%" mkdir "%%LOG_DIR%%"
  echo if not exist "%%LOG_BACKUP%%" mkdir "%%LOG_BACKUP%%"
  echo.
  echo :: [실행 위치] Next.js 실행 위치로 이동
  echo cd /d %ROOT%
  echo.
  echo :: [환경 변수]
  echo :: CMD 환경 변수에 node.exe 경로 추가
  echo set PATH=%%PATH%%;%NODE_DIR%
  echo.
  echo :: [프로젝트 설정]
  echo set "GGNR_PROJECT=%PROJECT_NAME%"
  echo set "GGNR_ENV=%ENV_NAME%"
  echo.
  echo :: [의존성] next 없으면 빌드 중단 — 00_make_ggnr_starter 에서 npm ci 권장
  echo if not exist "node_modules\.bin\next.cmd" ^(
  echo   if not exist "node_modules\next\package.json" ^(
  echo     echo [오류] node_modules 가 없거나 next 가 설치되지 않았습니다.
  echo     echo         root 에서 npm ci 또는 npm install 실행 후 다시 실행하세요.
  echo     goto build_fail
  echo   ^)
  echo ^)
  echo.
  echo :: [빌드] .next\BUILD_ID 없으면 next build 선행
  echo :: GGNR_PROJECT/ENV 가 있으면 next.config 가 [demo] BASE_PATH 를 읽음
  echo :: ^(start 시 basePath 불일치는 run.ts 가 재빌드^)
  echo :: ^(^) else 블록 안 %%ERRORLEVEL%% 은 파싱 시 비어 오판되므로 if errorlevel / goto 사용
  echo if exist ".next\BUILD_ID" ^(
  echo   echo [진행] .next\BUILD_ID 확인됨 — 빌드 생략 ^(start 가 basePath 검사^)
  echo   goto after_build
  echo ^)
  echo if exist ".next\" ^(
  echo   echo [경고] .next 폴더는 있으나 BUILD_ID 없음 — 불완전 빌드로 보고 npm run build 실행...
  echo ^) else ^(
  echo   echo [진행] .next\BUILD_ID 없음 — npm run build 실행...
  echo ^)
  echo call npm run build
  echo if errorlevel 1 goto build_fail
  echo if not exist ".next\BUILD_ID" goto build_no_id
  echo echo [완료] npm run build 완료 ^(.next\BUILD_ID 확인^).
  echo goto after_build
  echo.
  echo :build_fail
  echo echo [오류] npm run build 실패.
  echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo   echo 아무 키나 누르면 창이 닫힙니다.
  echo   pause ^>nul
  echo ^)
  echo exit /b 1
  echo.
  echo :build_no_id
  echo echo [오류] npm run build 후 .next\BUILD_ID 가 없습니다. production 기동을 중단합니다.
  echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo   echo 아무 키나 누르면 창이 닫힙니다.
  echo   pause ^>nul
  echo ^)
  echo exit /b 1
  echo.
  echo :after_build
  echo.
  echo :: [앱 기동] nssm AppStdout 연결용
  echo :: stop 시 Ctrl+C → Terminate batch job Y/N 방지: nssm AppStopMethodSkip=1 + 아래 ^|^| call;
  echo :: 실패 시 더블클릭 창이 바로 닫히지 않도록 pause ^(nssm 자동화는 GGNR_START_NO_PAUSE=1^)
  echo call npm run start -- "%%GGNR_PROJECT%%" "%%GGNR_ENV%%" ^|^| call;
  echo if errorlevel 1 goto start_fail
  echo exit /b 0
  echo.
  echo :start_fail
  echo echo.
  echo echo [오류] 기동 실패. 위 로그를 확인하세요.
  echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo   echo 아무 키나 누르면 창이 닫힙니다.
  echo   pause ^>nul
  echo ^)
  echo exit /b 1
  )

  if not exist "%OUT%" (
    echo [오류] ggnr_start.bat 생성 실패
    goto :fail_exit
  )
  echo [완료] 생성됨: %OUT%
) else (
  if not exist "%OUT%" (
    echo [오류] ggnr_start.bat 이 없습니다.
    goto :fail_exit
  )
  echo [주의] 기존 ggnr_start.bat 을 유지합니다.
  echo         방금 입력한 프로젝트명/환경은 기존 파일에 반영되지 않습니다.
  echo         바꾸려면 덮어쓰기 Y 로 다시 실행하세요.
  echo.
)

if /i not "!DO_NSSM!"=="Y" (
  echo [종료] 생성만 완료했습니다.
  echo   수동: nssm_install_ggnr.bat ^(관리자 CMD^) → open_ggnr_logs.bat
  echo.
  if "!PAUSE_ON_FAIL!"=="1" (
    echo 아무 키나 누르면 창이 닫힙니다.
    pause >nul
  )
  exit /b 0
)

:: --- 관리자 확인 (nssm 등록용) ---
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 실행이 아닙니다.
  echo         nssm 등록은 관리자 CMD에서 실행해야 합니다.
  echo         CMD를 마우스 오른쪽 버튼 → «관리자 권한으로 실행» 후 다시 실행하세요.
  goto :fail_exit
)
echo [확인] 관리자 권한으로 실행 중입니다.

if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] node_modules 가 없거나 next 가 설치되지 않았습니다.
  echo         의존성 동기화를 Y 로 다시 실행하거나, root 에서 npm ci 를 실행한 뒤 nssm 등록을 진행하세요.
  goto :fail_exit
)

if not exist "%NSSM_BAT%" (
  echo [오류] 없음: %NSSM_BAT%
  goto :fail_exit
)
if not exist "%NSSM_EXE%" (
  echo [오류] nssm.exe 없음: %NSSM_EXE%
  echo         설치 ZIP에 nssm\win64\nssm.exe 가 포함되어 있는지 확인하세요.
  goto :fail_exit
)
if not exist "%LOGS_BAT%" (
  echo [오류] 없음: %LOGS_BAT%
  goto :fail_exit
)

echo.
echo [1/2] nssm 서비스 등록...
echo         ^(실패 시 nssm_install 창이 pause 로 유지됩니다. 메시지 확인 후 Enter.^)
set "GGNR_NSSM_REREG=!DO_REREG!"
set "GGNR_NSSM_PROJECT=%PROJECT_NAME%"
set "GGNR_NSSM_ENV=%ENV_NAME%"
set "GGNR_NSSM_FROM_STARTER=1"
call "%NSSM_BAT%"
set "NSSM_EC=!ERRORLEVEL!"
set "GGNR_NSSM_FROM_STARTER="
if "!NSSM_EC!"=="2" (
  echo [안내] 기존 GGNR_V7 서비스를 유지했습니다 ^(재등록 안 함^).
  echo         필요 시 서비스 관리자에서 GGNR_V7 을 시작하세요.
  echo.
  echo [2/2] 로그 창 열기...
  call "%LOGS_BAT%"
  echo.
  echo [완료] 생성 → ^(기존 서비스 유지^) → 로그 창까지 끝났습니다.
  echo.
  if "!PAUSE_ON_FAIL!"=="1" (
    echo 아무 키나 누르면 창이 닫힙니다.
    pause >nul
  )
  exit /b 0
)
if not "!NSSM_EC!"=="0" (
  echo [중단] nssm 등록/시작 실패 ^(exit=!NSSM_EC!^)
  set "FAIL_EC=!NSSM_EC!"
  goto :fail_exit
)

echo.
echo [2/2] 로그 창 열기...
call "%LOGS_BAT%"

echo.
echo [완료] 생성 → nssm 등록 → 로그 창까지 끝났습니다.
echo.
if "!PAUSE_ON_FAIL!"=="1" (
  echo 아무 키나 누르면 창이 닫힙니다.
  pause >nul
)
exit /b 0

:fail_exit
if not defined FAIL_EC set "FAIL_EC=1"
echo.
echo [종료] 오류로 중단되었습니다 ^(exit=!FAIL_EC!^). 위 메시지를 확인하세요.
if "!PAUSE_ON_FAIL!"=="1" (
  echo 아무 키나 누르면 창이 닫힙니다.
  pause >nul
)
exit /b !FAIL_EC!

:: package-lock.json 기준 npm ci ^(없으면 npm install^). exit /b 로 FAIL_EC 반환.
:run_npm_sync
pushd "%ROOT%"
if exist "package-lock.json" (
  echo [진행] npm ci ^(package-lock.json 기준, node_modules 재생성^)...
  call npm ci
) else (
  echo [경고] package-lock.json 없음 — npm install 로 대체합니다.
  call npm install
)
set "NPM_EC=!errorlevel!"
popd
if not "!NPM_EC!"=="0" (
  echo [오류] 의존성 동기화 실패 ^(exit=!NPM_EC!^)
  set "FAIL_EC=!NPM_EC!"
  exit /b !NPM_EC!
)
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] node_modules 에 next 가 없습니다. package.json·package-lock.json 을 확인하세요.
  set "FAIL_EC=1"
  exit /b 1
)
echo [완료] 의존성 동기화 완료.
exit /b 0

:: production 빌드. GGNR_PROJECT/ENV 는 호출 전에 설정.
:run_npm_build
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] next 미설치 — 빌드 불가. npm 동기화를 Y 로 다시 실행하세요.
  set "FAIL_EC=1"
  exit /b 1
)
echo [진행] npm run build ...
echo         GGNR_PROJECT=%GGNR_PROJECT%  GGNR_ENV=%GGNR_ENV%
echo         ^(next.config 가 프로젝트 env 의 BASE_PATH 를 반영합니다^)
echo         실패하면 이 창에 오류가 남습니다. 닫지 마세요.
pushd "%ROOT%"
call npm run build
set "BUILD_EC=!errorlevel!"
popd
if not "!BUILD_EC!"=="0" (
  echo.
  echo ===== 빌드 실패 =====
  echo [오류] npm run build 실패 ^(exit=!BUILD_EC!^)
  echo         위 TypeScript/Next 로그를 확인하세요.
  set "FAIL_EC=!BUILD_EC!"
  exit /b !BUILD_EC!
)
if not exist "%ROOT%\.next\BUILD_ID" (
  echo.
  echo ===== 빌드 실패 =====
  echo [오류] npm run build 후 .next\BUILD_ID 가 없습니다.
  set "FAIL_EC=1"
  exit /b 1
)
echo [완료] npm run build 완료. BUILD_ID=
type "%ROOT%\.next\BUILD_ID"
echo.
exit /b 0

:: ---------------------------------------------------------------------------
:: 이전 GGNR 실행 정리: 서비스 중지^(제거 아님^) + 앱 포트 Listen 종료
:: Ctrl+C 로 이전 창을 끊지 않아도 재실행 가능.
:: ---------------------------------------------------------------------------
:stop_previous_ggnr
echo [정리] 이전 GGNR 실행이 있으면 중지합니다 ^(서비스 제거 없음^)...
if exist "%NSSM_EXE%" (
  "%NSSM_EXE%" status %SERVICE_NAME% >nul 2>&1
  if not errorlevel 1 (
    :: 이미 Y/N 대기 중이면 Ctrl+C 재전송하지 않도록 Skip 설정 후 stop
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodSkip 1 >nul 2>&1
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodConsole 500 >nul 2>&1
    echo [정리] nssm stop %SERVICE_NAME% ...
    "%NSSM_EXE%" stop %SERVICE_NAME% confirm >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo [정리] 서비스 중지 요청 완료.
  ) else (
    echo [정리] 서비스 %SERVICE_NAME% 미등록 — 서비스 중지 생략.
  )
) else (
  echo [정리] nssm.exe 없음 — 서비스 중지 생략. 포트만 확인합니다.
)
call :kill_listen_port %APP_PORT%
:: Terminate batch job Y/N 로 멈춘 cmd^(ggnr_start^) 잔여 정리
call :kill_ggnr_start_cmds
echo [정리] 이전 실행 정리 끝. 이어서 진행합니다.
goto :eof

:: ggnr_start.bat 을 돌리는 cmd 잔여 강제 종료 (Y/N 대기 포함)
:kill_ggnr_start_cmds
echo [정리] ggnr_start.bat 잔여 cmd 검색...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[정리] ggnr_start 잔여 cmd 없음.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[정리] taskkill /F /PID {0} /T' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:: %1 = Listen 포트. 해당 포트 PID 종료 ^(00_remove_ggnr.bat 과 동일 패턴^).
:kill_listen_port
set "KP=%~1"
echo [정리] 포트 %KP% Listen 확인...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [정리] 포트 %KP% Listen 없음.
  goto :eof
)
set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [정리] taskkill /F /PID %%P /T
    taskkill /F /PID %%P /T >nul 2>&1
    if not errorlevel 1 (
      set /a KILLED+=1
      echo [정리] PID %%P 종료
    ) else (
      echo [경고] PID %%P 종료 실패 ^(이미 종료되었거나 권한 부족^)
    )
  )
)
if "!KILLED!"=="0" (
  echo [안내] 포트 %KP% 종료한 PID 없음. 관리자 권한으로 다시 실행해 보세요.
) else (
  echo [정리] 포트 %KP% 관련 !KILLED!건 종료.
)
timeout /t 1 /nobreak >nul
goto :eof
