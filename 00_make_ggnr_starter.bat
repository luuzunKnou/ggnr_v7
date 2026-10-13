@echo off
:: Double-click runs this file with a window that closes when the file ends.
:: Re-open in a window that stays. Skip when already inside that window, or when
:: GGNR_STARTER_NO_PAUSE=1 (unattended).
if /i "%~1"=="__keep" goto :ggnr_starter_main
if /i "%GGNR_STARTER_NO_PAUSE%"=="1" goto :ggnr_starter_main
cmd /k ""%~f0" __keep"
exit /b

:ggnr_starter_main
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

:: =============================================================================
:: ggnr_start.bat generator + optional nssm register / log window
:: Messages and prompts are Korean. First line after setlocal is chcp 65001.
:: - root = folder of this bat
:: - node PATH = directory of "where node"
:: - npm ci from package-lock (Y/N; auto if GGNR_START_NO_PAUSE=1)
:: - then npm run build (GGNR_PROJECT/ENV -> BASE_PATH). fail => pause
:: - stop previous GGNR / free app port (PORT) AFTER successful build (before nssm)
:: - ggnr_start.bat + 00_ggnr_build_project.bat generated from project/type/port prompts
:: - project / type / port / npm / overwrite / nssm asked once up front
:: - nssm = root\nssm\win64\nssm.exe
:: - python/env_parts optional restore
:: - if DO_NSSM=Y and not admin => require admin before build
:: - 00_open_ggnr_logs: skip if GGNR_LOG/GEOSERVER_LOG already open
:: - nssm ObjectName: from project.env NSSM_OBJECT_NAME/PASS when demo
:: - window stays via cmd /k. pause still waits. skip only if GGNR_STARTER_NO_PAUSE=1
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"
set "BUILD_OUT=%ROOT%\00_ggnr_build_project.bat"
set "NSSM_BAT=%ROOT%\00_nssm_install_ggnr.bat"
set "NSSM_EXE=%ROOT%\nssm\win64\nssm.exe"
if not exist "%NSSM_EXE%" set "NSSM_EXE=%ROOT%\nssm\win32\nssm.exe"
set "LOGS_BAT=%ROOT%\00_open_ggnr_logs.bat"
set "SERVICE_NAME=GGNR_V7"
:: app listen port written into ggnr_start.bat as PORT= (default 80; prompted below)
set "APP_PORT=80"
:: GGNR_START_NO_PAUSE is for ggnr_start/nssm only - not this starter window
set "PAUSE_ON_FAIL=1"
if /i "%GGNR_STARTER_NO_PAUSE%"=="1" set "PAUSE_ON_FAIL=0"
set "NPM_SYNC_DONE=0"

echo.
echo [시작] 설치 경로 = %ROOT%
echo [시작] 만들 파일 = %OUT%
if /i "%GGNR_START_NO_PAUSE%"=="1" echo [안내] 자동 진행입니다. 창은 유지됩니다. 정지를 건너뛰려면 GGNR_STARTER_NO_PAUSE=1 을 쓰세요.
echo.

:: --- prompts (once) ---
echo [입력] 아래 값을 입력하세요. 예/아니오는 Y 또는 N 입니다.
echo.
set /p "PROJECT_NAME=프로젝트 이름: "
if not defined PROJECT_NAME (
  echo [오류] 프로젝트 이름이 비어 있습니다.
  goto :fail_exit
)
echo(!PROJECT_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [오류] 프로젝트 이름에 공백이 있으면 안 됩니다.
  goto :fail_exit
)

set /p "ENV_NAME=구분 (dev, demo, prod): "
if not defined ENV_NAME (
  echo [오류] 구분이 비어 있습니다.
  goto :fail_exit
)
echo(!ENV_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [오류] 구분에 공백이 있으면 안 됩니다.
  goto :fail_exit
)

set "APP_PORT_IN="
set /p "APP_PORT_IN=앱 접속 포트 (기본 %APP_PORT%): "
if defined APP_PORT_IN set "APP_PORT_IN=!APP_PORT_IN: =!"
if defined APP_PORT_IN if not "!APP_PORT_IN!"=="" (
  echo(!APP_PORT_IN!| findstr /R "^[1-9][0-9]*$" >nul 2>&1
  if errorlevel 1 (
    echo [오류] 포트는 1부터 65535까지 숫자여야 합니다. 입력=[!APP_PORT_IN!]
    goto :fail_exit
  )
  if !APP_PORT_IN! GTR 65535 (
    echo [오류] 포트는 65535 이하여야 합니다. 입력=[!APP_PORT_IN!]
    goto :fail_exit
  )
  set "APP_PORT=!APP_PORT_IN!"
)
echo [안내] 지정 포트 = !APP_PORT!

set "OVERWRITE=Y"
set "DO_REREG=N"
if /i "%GGNR_START_NO_PAUSE%"=="1" (
  echo [실행] 자동 진행입니다. 의존성 맞춤, 덮어쓰기, 서비스 등록을 모두 예로 진행합니다.
  set "DO_NPM_SYNC=Y"
  set "DO_NSSM=Y"
  set "DO_REREG=Y"
) else (
  echo.
  echo [안내] 안정적인 배포는 package-lock.json 기준으로 의존성을 맞추는 쪽을 권합니다.
  echo        모듈 폴더가 있어도 package-lock.json과 다를 수 있으면 Y 를 고르세요.
  echo        망 분리 환경이라 설치가 안 되면 N 을 고르세요.
  echo.
  set /p "DO_NPM_SYNC=의존성을 맞출까요? (Y/N): "
  if exist "%OUT%" (
    set /p "OVERWRITE=시작 파일이 있습니다. 덮어쓸까요? (Y/N): "
  )
  set /p "DO_NSSM=윈도우 서비스를 등록할까요? (Y/N): "
  if /i "!DO_NSSM!"=="Y" (
    set /p "DO_REREG=기존 서비스가 있으면 지우고 다시 등록할까요? (Y/N): "
  )
)

:: normalize Y/N
set "DO_NPM_SYNC=!DO_NPM_SYNC: =!"
if /i not "!DO_NPM_SYNC!"=="Y" if /i not "!DO_NPM_SYNC!"=="N" (
  echo [경고] 의존성 맞춤 답이 Y/N 이 아니어서 N 으로 진행합니다. 입력=[!DO_NPM_SYNC!]
  set "DO_NPM_SYNC=N"
)
set "OVERWRITE=!OVERWRITE: =!"
if /i not "!OVERWRITE!"=="Y" if /i not "!OVERWRITE!"=="N" (
  echo [경고] 덮어쓰기 답이 Y/N 이 아니어서 Y 로 진행합니다. 입력=[!OVERWRITE!]
  set "OVERWRITE=Y"
)
set "DO_NSSM=!DO_NSSM: =!"
if /i not "!DO_NSSM!"=="Y" if /i not "!DO_NSSM!"=="N" (
  echo [경고] 서비스 등록 답이 Y/N 이 아니어서 N 으로 진행합니다. 입력=[!DO_NSSM!]
  set "DO_NSSM=N"
)
if /i "!DO_NSSM!"=="Y" (
  set "DO_REREG=!DO_REREG: =!"
  if /i not "!DO_REREG!"=="Y" if /i not "!DO_REREG!"=="N" (
    echo [경고] 다시 등록 답이 Y/N 이 아니어서 N 으로 진행합니다. 입력=[!DO_REREG!]
    set "DO_REREG=N"
  )
) else (
  set "DO_REREG=N"
)

echo.
echo [확인]
echo   프로젝트 = %PROJECT_NAME%
echo   구분     = %ENV_NAME%
echo   의존성   = !DO_NPM_SYNC!
echo   덮어쓰기 = !OVERWRITE!
echo   서비스   = !DO_NSSM!
echo   다시등록 = !DO_REREG!
echo.

:: admin before build if nssm=Y (keep service up during npm sync/build)
if /i "!DO_NSSM!"=="Y" (
  call :require_admin
  if errorlevel 1 goto :fail_exit
)

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] node 를 찾지 못했습니다. PATH 에 node 가 없습니다.
  goto :fail_exit
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node') do (
  set "NODE_EXE=%%I"
  goto :node_found
)

:node_found
if not defined NODE_EXE (
  echo [오류] node 실행 파일 경로를 읽지 못했습니다.
  goto :fail_exit
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
if "%NODE_DIR:~-1%"=="\" set "NODE_DIR=%NODE_DIR:~0,-1%"

echo [시작] node 실행 파일 = %NODE_EXE%
for /f "delims=" %%V in ('node -v 2^>nul') do echo [시작] Node 버전 = %%V
echo [시작] PATH 추가 = %NODE_DIR%
echo.

echo [실행] 파이썬 환경 복원을 확인합니다. 분할 파일이 없으면 건너뜁니다...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\restore-python-env.ps1" -Root "%ROOT%"
if errorlevel 1 goto :fail_exit
echo.

if /i "!DO_NPM_SYNC!"=="Y" (
  call :run_npm_sync
  if errorlevel 1 goto :fail_exit
  set "NPM_SYNC_DONE=1"
  echo.
) else (
  echo [건너뜀] 의존성 맞춤을 건너뜁니다.
  echo        next 가 없으면 서비스 시작이 실패할 수 있습니다. 필요하면 루트에서 의존성을 맞춘 뒤 다시 실행하세요.
  echo.
)

set "GGNR_PROJECT=%PROJECT_NAME%"
set "GGNR_ENV=%ENV_NAME%"
set "PATH=%PATH%;%NODE_DIR%"
call :run_npm_build
if errorlevel 1 goto :fail_exit
echo.
echo [확인] 빌드가 끝났습니다. 다음: 시작 파일 / 서비스 등록
echo.
echo [확인]
echo   작업 폴더 = %ROOT%
echo   node 경로 = %NODE_DIR%
echo   프로젝트 = %PROJECT_NAME%
echo   구분     = %ENV_NAME%
echo.

set "SKIP_WRITE=0"
if exist "%OUT%" (
  if /i not "!OVERWRITE!"=="Y" (
    echo [유지] 기존 시작 파일을 그대로 둡니다.
    set "SKIP_WRITE=1"
  )
)

echo [실행] 빌드 이후: 시작 파일 / 수동 빌드 파일 / 서비스 등록 / 로그
if "!SKIP_WRITE!"=="0" (
  echo [실행] 시작 파일을 씁니다...
  call :write_ggnr_start
  if errorlevel 1 goto :fail_exit
  echo [실행] 수동 빌드 파일을 씁니다...
  call :write_ggnr_build_project
  if errorlevel 1 goto :fail_exit
  if not exist "%OUT%" (
    echo [오류] 시작 파일을 만들지 못했습니다.
    goto :fail_exit
  )
  if not exist "%BUILD_OUT%" (
    echo [오류] 수동 빌드 파일을 만들지 못했습니다.
    goto :fail_exit
  )
  echo [확인] 만들었습니다: %OUT%
  echo [확인] 만들었습니다: %BUILD_OUT%
) else (
  if not exist "%OUT%" (
    echo [오류] 시작 파일이 없습니다.
    goto :fail_exit
  )
  echo [경고] 기존 시작 파일과 수동 빌드 파일을 유지합니다.
  echo        이번 프로젝트와 구분은 파일에 반영되지 않았습니다.
  echo        반영하려면 덮어쓰기를 Y 로 다시 실행하세요.
  echo.
)

echo [확인] 시작 파일 단계가 끝났습니다.

if /i not "!DO_NSSM!"=="Y" (
  echo [건너뜀] 서비스 등록과 로그 창을 건너뜁니다. ^(서비스=!DO_NSSM!^)
  echo [완료] 파일 생성만 했습니다.
  echo   수동: 관리자 명령에서 00_nssm_install_ggnr.bat 실행 후 00_open_ggnr_logs.bat
  echo.
  if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
  exit /b 0
)

call :require_admin
if errorlevel 1 goto :fail_exit

if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] 모듈이 없거나 next 가 설치되지 않았습니다.
  echo        의존성 맞춤을 Y 로 다시 실행하거나, 루트에서 의존성을 맞춘 뒤 서비스를 등록하세요.
  goto :fail_exit
)

if not exist "%NSSM_BAT%" (
  echo [오류] 파일이 없습니다: %NSSM_BAT%
  goto :fail_exit
)
if not exist "%NSSM_EXE%" (
  echo [오류] nssm 실행 파일이 없습니다: %NSSM_EXE%
  echo        설치 압축 안의 nssm\win64\nssm.exe 를 확인하세요.
  goto :fail_exit
)
if not exist "%LOGS_BAT%" (
  echo [오류] 파일이 없습니다: %LOGS_BAT%
  goto :fail_exit
)

:: stop after successful build so app port stays up during npm run build
echo.
call :stop_previous_ggnr
echo.

echo.
echo [실행] 서비스 등록 ^(1/2^)...
echo        ^(실패하면 서비스 등록 창이 열린 채로 남습니다. 메시지를 본 뒤 엔터를 누르세요.^)
set "GGNR_NSSM_REREG=!DO_REREG!"
set "GGNR_NSSM_PROJECT=%PROJECT_NAME%"
set "GGNR_NSSM_ENV=%ENV_NAME%"
set "GGNR_NSSM_FROM_STARTER=1"
call "%NSSM_BAT%"
set "NSSM_EC=!ERRORLEVEL!"
set "GGNR_NSSM_FROM_STARTER="
if "!NSSM_EC!"=="2" (
  echo [안내] 기존 GGNR_V7 서비스를 유지했습니다. 다시 등록하지 않습니다.
  echo        필요하면 서비스 관리에서 GGNR_V7 을 시작하세요.
  echo.
  echo [실행] 로그 창 ^(2/2^)...
  call :open_log_windows
  echo.
  echo [완료] 파일 생성 후 기존 서비스를 유지하고 로그를 엽니다.
  echo.
  if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
  exit /b 0
)
if not "!NSSM_EC!"=="0" (
  echo [중지] 서비스 등록 또는 시작에 실패했습니다 ^(종료=!NSSM_EC!^)
  set "FAIL_EC=!NSSM_EC!"
  goto :fail_exit
)

echo.
echo [실행] 로그 창 ^(2/2^)...
call :open_log_windows

echo.
echo [완료] 파일 생성, 서비스 등록, 로그 열기까지 끝났습니다.
echo.
if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
exit /b 0

:fail_exit
if not defined FAIL_EC set "FAIL_EC=1"
echo.
echo [종료] 오류로 멈췄습니다 ^(종료=!FAIL_EC!^). 위 메시지를 확인하세요.
echo      서비스 등록 로그: C:\logs\nssm_install_last.log
echo      수동: 관리자 명령에서 00_nssm_install_ggnr.bat 실행 후 00_open_ggnr_logs.bat
if "!PAUSE_ON_FAIL!"=="1" call :pause_keep
exit /b !FAIL_EC!

:: ---------------------------------------------------------------------------
:open_log_windows
if not exist "%LOGS_BAT%" (
  echo [오류] 로그 창 파일이 없습니다: %LOGS_BAT%
  goto :eof
)
echo [실행] 로그 창을 엽니다: %LOGS_BAT%
call "%LOGS_BAT%"
echo [확인] 로그 창 열기를 마쳤습니다.
goto :eof

:: ---------------------------------------------------------------------------
:pause_keep
echo -----------------------------------------------------------
echo  아무 키나 누르면 이 창이 닫힙니다.
echo -----------------------------------------------------------
pause >nul
goto :eof

:: ---------------------------------------------------------------------------
:require_admin
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 권한이 아닙니다.
  echo        서비스 등록은 관리자 명령 프롬프트가 필요합니다.
  echo        명령 프롬프트를 오른쪽 단추로 누른 뒤 관리자 권한으로 실행하세요.
  set "FAIL_EC=1"
  exit /b 1
)
echo [확인] 관리자 권한으로 실행 중입니다.
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
echo :: PATH node
echo set PATH=%%PATH%%;%NODE_DIR%
echo.
echo :: project
echo set "GGNR_PROJECT=%PROJECT_NAME%"
echo set "GGNR_ENV=%ENV_NAME%"
echo.
echo :: Next listen port ^(scripts/run.ts uses process.env.PORT^)
echo set "PORT=%APP_PORT%"
echo.
echo :: require next
echo if not exist "node_modules\.bin\next.cmd" ^(
echo   if not exist "node_modules\next\package.json" ^(
echo     echo [오류] next 가 없습니다. 의존성을 맞춘 뒤 다시 실행하세요.
echo     goto build_fail
echo   ^)
echo ^)
echo.
echo :: build if no BUILD_ID or BASE_PATH mismatch
echo call npx tsx scripts/check-base-path-build.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo if errorlevel 1 ^(
echo   if exist ".next\" ^(
echo     echo [경고] 빌드 결과와 기본 경로가 달라 프로젝트 환경으로 다시 빌드합니다.
echo   ^) else ^(
echo     echo [확인] 빌드 결과가 없어 프로젝트 환경으로 빌드합니다.
echo   ^)
echo   call npx tsx scripts/build-with-project-env.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo   if errorlevel 1 goto build_fail
echo   if not exist ".next\BUILD_ID" goto build_no_id
echo   echo [확인] 빌드가 끝났습니다.
echo ^) else ^(
echo   echo [확인] 빌드 결과와 기본 경로가 같습니다. 빌드를 건너뜁니다.
echo ^)
echo goto after_build
echo.
echo :build_fail
echo echo [오류] 프로젝트 환경 빌드에 실패했습니다.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo 엔터를 누르면 닫힙니다...
echo   set /p "=엔터... "
echo ^)
echo exit /b 1
echo.
echo :build_no_id
echo echo [오류] 빌드 후에도 빌드 식별자가 없습니다.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo 엔터를 누르면 닫힙니다...
echo   set /p "=엔터... "
echo ^)
echo exit /b 1
echo.
echo :after_build
echo.
echo :: start app ^(nssm AppStdout^)
echo :: keep the start failure code so the window shows the error instead of closing
echo call npm run start -- "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo if errorlevel 1 goto start_fail
echo exit /b 0
echo.
echo :start_fail
echo echo.
echo echo [오류] 시작에 실패했습니다. 위 로그를 확인하세요.
echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
echo   echo 엔터를 누르면 닫힙니다...
echo   set /p "=엔터... "
echo ^)
echo exit /b 1
)
if not exist "%OUT%" exit /b 1
exit /b 0

:: ---------------------------------------------------------------------------
:: write 00_ggnr_build_project.bat - manual BASE_PATH build (no prompts)
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
echo   echo [오류] next 가 설치되지 않았습니다. 의존성을 먼저 맞추세요.
echo   goto :end_pause
echo ^)
echo.
echo echo.
echo echo [빌드] 프로젝트: %%GGNR_PROJECT%%
echo echo [빌드] 구분: %%GGNR_ENV%%
echo echo npx tsx scripts/build-with-project-env.ts %%GGNR_PROJECT%% %%GGNR_ENV%%
echo echo.
echo.
echo call npx tsx scripts/build-with-project-env.ts "%%GGNR_PROJECT%%" "%%GGNR_ENV%%"
echo set "BUILD_EC=%%errorlevel%%"
echo.
echo if not "%%BUILD_EC%%"=="0" ^(
echo   echo [오류] 빌드에 실패했습니다 ^(종료=%%BUILD_EC%%^)
echo ^) else if exist ".next\BUILD_ID" ^(
echo   echo [확인] 빌드가 끝났습니다. 빌드 식별자=
echo   type ".next\BUILD_ID"
echo ^) else ^(
echo   echo [오류] 빌드 후에도 빌드 식별자가 없습니다.
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
  echo [실행] package-lock.json 기준으로 의존성을 맞춥니다. 모듈 폴더를 다시 만듭니다...
  call npm ci
) else (
  echo [경고] package-lock.json이 없어 npm install 로 설치합니다.
  call npm install
)
set "NPM_EC=!errorlevel!"
popd
if not "!NPM_EC!"=="0" (
  echo [오류] 의존성 맞춤에 실패했습니다 ^(종료=!NPM_EC!^)
  set "FAIL_EC=!NPM_EC!"
  exit /b !NPM_EC!
)
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] 모듈 안에 next 가 없습니다. package.json 과 package-lock.json을 확인하세요.
  set "FAIL_EC=1"
  exit /b 1
)
echo [확인] 의존성 맞춤이 끝났습니다.
exit /b 0

:run_npm_build
if not exist "%ROOT%\node_modules\next\package.json" (
  echo [오류] next 가 설치되지 않아 빌드할 수 없습니다. 의존성 맞춤을 Y 로 다시 실행하세요.
  set "FAIL_EC=1"
  exit /b 1
)
echo [실행] 프로젝트 환경으로 빌드합니다. 기본 경로를 빌드에 넣습니다...
echo        프로젝트=%GGNR_PROJECT%  구분=%GGNR_ENV%
echo        실패하면 이 창을 닫지 마세요.
pushd "%ROOT%"
call npx tsx scripts/build-with-project-env.ts "%GGNR_PROJECT%" "%GGNR_ENV%"
set "BUILD_EC=!errorlevel!"
popd
if not "!BUILD_EC!"=="0" (
  echo.
  echo ===== 빌드 실패 =====
  echo [오류] 프로젝트 환경 빌드에 실패했습니다 ^(종료=!BUILD_EC!^)
  echo        위 빌드 로그를 확인하세요. 게이트 배포는 시연 기본 경로가 빌드에 들어가야 합니다.
  set "FAIL_EC=!BUILD_EC!"
  exit /b !BUILD_EC!
)
if not exist "%ROOT%\.next\BUILD_ID" (
  echo.
  echo ===== 빌드 실패 =====
  echo [오류] 빌드 후에도 빌드 식별자가 없습니다.
  set "FAIL_EC=1"
  exit /b 1
)
echo [확인] 빌드가 끝났습니다. 빌드 식별자=
type "%ROOT%\.next\BUILD_ID"
echo.
exit /b 0

:: stop previous GGNR (service stop only, no remove) + GeoServer + free app port
:: Called after successful build, immediately before 00_nssm_install
:stop_previous_ggnr
echo [정리] 실행 중인 서비스를 중지합니다. 서비스는 지우지 않습니다...
if exist "%NSSM_EXE%" (
  "%NSSM_EXE%" status %SERVICE_NAME% >nul 2>&1
  if not errorlevel 1 (
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodSkip 1 >nul 2>&1
    "%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodConsole 500 >nul 2>&1
    echo [정리] 서비스 중지 %SERVICE_NAME% ...
    "%NSSM_EXE%" stop %SERVICE_NAME% confirm >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo [정리] 서비스 중지를 요청했습니다.
  ) else (
    echo [정리] 서비스 %SERVICE_NAME% 이^(가^) 없어 중지를 건너뜁니다.
  )
) else (
  echo [정리] nssm 실행 파일이 없어 서비스 중지는 건너뜁니다. 포트만 확인합니다.
)
call "%ROOT%\00_geoserver_port_helpers.bat" stop
timeout /t 2 /nobreak >nul
call "%ROOT%\00_geoserver_port_helpers.bat" resolve
echo [정리] 지오서버 포트 = !GEO_PORT!
call :kill_listen_port !GEO_PORT!
call :kill_listen_port %APP_PORT%
call :kill_ggnr_start_cmds
echo [정리] 이전 실행 정리가 끝났습니다.
goto :eof

:kill_ggnr_start_cmds
echo [정리] 남아 있는 시작 명령 창을 찾습니다...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ggnr_start.bat*' };" ^
  "if (-not $procs) { Write-Host '[정리] 남아 있는 시작 명령 창이 없습니다.'; exit 0 };" ^
  "foreach ($p in @($procs)) { Write-Host ('[정리] 남은 시작 프로세스를 강제 종료합니다. PID {0}' -f $p.ProcessId); Start-Process -FilePath taskkill.exe -ArgumentList @('/F','/PID',([string]$p.ProcessId),'/T') -Wait -NoNewWindow | Out-Null }"
goto :eof

:kill_listen_port
set "KP=%~1"
echo [정리] 포트 %KP% 사용 여부를 확인합니다...
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [정리] 포트 %KP% 은^(는^) 사용 중이 아닙니다.
  goto :eof
)
set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [정리] 포트 사용 프로세스를 강제 종료합니다. PID %%P
    taskkill /F /PID %%P /T >nul 2>&1
    if not errorlevel 1 (
      set /a KILLED+=1
      echo [정리] 프로세스를 종료했습니다. PID %%P
    ) else (
      echo [경고] 프로세스를 종료하지 못했습니다. PID %%P ^(이미 없거나 권한이 없습니다^)
    )
  )
)
if "!KILLED!"=="0" (
  echo [안내] 포트 %KP% 에서 종료한 프로세스가 없습니다. 관리자 명령으로 다시 시도하세요.
) else (
  echo [정리] 포트 %KP% 에서 !KILLED!개 프로세스를 종료했습니다.
)
timeout /t 1 /nobreak >nul
goto :eof