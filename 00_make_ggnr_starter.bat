@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: ggnr_start.bat 생성기 + (선택) 기동 검사 · nssm 등록 · 로그 창
:: - 실행 위치 root = 이 bat이 있는 폴더
:: - node PATH = where node 결과의 디렉터리
:: - root에 node_modules 없으면 고지 후 npm install (Y/N)
:: - ggnr_start.bat: .next\BUILD_ID 없으면 npm run build 후 start (폴더만 있는 불완전 빌드 포함)
:: - 프로젝트명·환경 = 실행 시 입력
:: - 생성 후 Y/N: 기동 검사 → nssm_install_ggnr.bat → open_ggnr_logs.bat
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"
set "NSSM_BAT=%ROOT%\nssm_install_ggnr.bat"
set "LOGS_BAT=%ROOT%\open_ggnr_logs.bat"
set "SMOKE_PS1=%ROOT%\smoke_ggnr_start.ps1"
set "SMOKE_CLEANUP_PS1=%ROOT%\smoke_ggnr_cleanup.ps1"
set "SMOKE_PORT=3000"
set "SMOKE_GEO_PORT=8080"
:: Next listen 전 GeoServer ensure^(최대 ~120초^) + Next 기동 여유 → 기본 180초
set "SMOKE_TIMEOUT_SEC=180"
:: 더블클릭 창이 오류 직후 닫히지 않도록 ^(nssm·자동화는 GGNR_START_NO_PAUSE=1^)
set "PAUSE_ON_FAIL=1"
if /i "%GGNR_START_NO_PAUSE%"=="1" set "PAUSE_ON_FAIL=0"

echo.
echo [00_make_ggnr_starter] root = %ROOT%
echo [00_make_ggnr_starter] 출력 = %OUT%
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
echo [00_make_ggnr_starter] PATH 추가 = %NODE_DIR%
echo.

if not exist "%ROOT%\node_modules\" (
  echo [고지] root 에 node_modules 폴더가 없습니다.
  echo         패키지가 없으면 기동·기동 검사가 실패할 수 있습니다.
  echo         경로: %ROOT%\node_modules
  echo.
  set /p "DO_NPM=npm install 을 실행할까요? (Y/N): "
  if /i "!DO_NPM!"=="Y" (
    echo.
    echo [진행] cd /d "%ROOT%" ^& npm install
    pushd "%ROOT%"
    call npm install
    set "NPM_EC=!errorlevel!"
    popd
    if not "!NPM_EC!"=="0" (
      echo [오류] npm install 실패 ^(exit=!NPM_EC!^)
      set "FAIL_EC=!NPM_EC!"
      goto :fail_exit
    )
    if not exist "%ROOT%\node_modules\" (
      echo [오류] npm install 후에도 node_modules 가 없습니다.
      goto :fail_exit
    )
    echo [완료] npm install 완료.
    echo.
  ) else (
    echo [건너뜀] npm install 을 하지 않습니다. 필요 시 root 에서 직접 실행하세요.
    echo.
  )
)

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

set /p "ENV_NAME=환경 (GGNR_ENV): "
if not defined ENV_NAME (
  echo [오류] 환경이 비어 있습니다.
  goto :fail_exit
)
echo(!ENV_NAME!| findstr /C:" " >nul 2>&1
if not errorlevel 1 (
  echo [오류] 환경명에 공백이 있습니다. 공백 없이 입력하세요.
  goto :fail_exit
)

echo.
echo [확인]
echo   cd          = %ROOT%
echo   NODE_DIR    = %NODE_DIR%
echo   PROJECT     = %PROJECT_NAME%
echo   ENV         = %ENV_NAME%
echo.

set "SKIP_WRITE=0"
if exist "%OUT%" (
  set /p "OVERWRITE=이미 ggnr_start.bat 이 있습니다. 덮어쓸까요? (Y/N): "
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
  echo :: [빌드] .next\BUILD_ID 없으면 next build 선행 ^(폴더만 있고 BUILD_ID 없는 경우 포함^)
  echo if exist ".next\BUILD_ID" ^(
  echo   echo [진행] .next\BUILD_ID 확인됨 — 빌드 생략
  echo ^) else ^(
  echo   if exist ".next\" ^(
  echo     echo [경고] .next 폴더는 있으나 BUILD_ID 없음 — 불완전 빌드로 보고 npm run build 실행...
  echo   ^) else ^(
  echo     echo [진행] .next\BUILD_ID 없음 — npm run build 실행...
  echo   ^)
  echo   call npm run build
  echo   set "GGNR_BUILD_EC=%%ERRORLEVEL%%"
  echo   if not "%%GGNR_BUILD_EC%%"=="0" ^(
  echo     echo [오류] npm run build 실패 ^(exit=%%GGNR_BUILD_EC%%^)
  echo     if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo       echo 아무 키나 누르면 창이 닫힙니다.
  echo       pause ^>nul
  echo     ^)
  echo     exit /b %%GGNR_BUILD_EC%%
  echo   ^)
  echo   if not exist ".next\BUILD_ID" ^(
  echo     echo [오류] npm run build 후 .next\BUILD_ID 가 없습니다. production 기동을 중단합니다.
  echo     if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo       echo 아무 키나 누르면 창이 닫힙니다.
  echo       pause ^>nul
  echo     ^)
  echo     exit /b 1
  echo   ^)
  echo   echo [완료] npm run build 완료 ^(.next\BUILD_ID 확인^).
  echo ^)
  echo.
  echo :: [앱 기동] nssm AppStdout 연결용 — call 유지
  echo :: 실패 시 더블클릭 창이 바로 닫히지 않도록 pause ^(nssm·스모크는 GGNR_START_NO_PAUSE=1^)
  echo call npm run start -- "%PROJECT_NAME%" "%ENV_NAME%"
  echo set "GGNR_START_EC=%%ERRORLEVEL%%"
  echo if "%%GGNR_START_EC%%"=="0" exit /b 0
  echo echo.
  echo echo [오류] 기동 실패 ^(exit=%%GGNR_START_EC%%^). 위 로그를 확인하세요.
  echo if /i not "%%GGNR_START_NO_PAUSE%%"=="1" ^(
  echo   echo 아무 키나 누르면 창이 닫힙니다.
  echo   pause ^>nul
  echo ^)
  echo exit /b %%GGNR_START_EC%%
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

echo.
set /p "DO_NEXT=기동 검사 후 nssm 등록·로그 열기를 진행할까요? (Y/N): "
if /i not "!DO_NEXT!"=="Y" (
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
  echo         기동 검사·nssm 등록은 관리자 CMD에서 실행해야 합니다.
  echo         CMD를 마우스 오른쪽 버튼 → «관리자 권한으로 실행» 후 다시 실행하세요.
  goto :fail_exit
)
echo [확인] 관리자 권한으로 실행 중입니다.

if not exist "%SMOKE_PS1%" (
  echo [오류] 없음: %SMOKE_PS1%
  goto :fail_exit
)
if not exist "%SMOKE_CLEANUP_PS1%" (
  echo [오류] 없음: %SMOKE_CLEANUP_PS1%
  echo         잔여 프로세스 정리 스크립트가 필요합니다. 설치 패키지를 확인하세요.
  goto :fail_exit
)
if not exist "%NSSM_BAT%" (
  echo [오류] 없음: %NSSM_BAT%
  goto :fail_exit
)
if not exist "%LOGS_BAT%" (
  echo [오류] 없음: %LOGS_BAT%
  goto :fail_exit
)

echo.
echo [1/3] ggnr_start.bat 기동 검사 ^(포트 %SMOKE_PORT%, 최대 %SMOKE_TIMEOUT_SEC%초^)...
echo       주의: 같은 포트에서 이미 npm run dev/start 가 돌면 실패할 수 있습니다.
echo       Next 포트는 GeoServer 설정^(최대 ~120초^) 이후에 열립니다. 그동안 포트=False 가 정상일 수 있습니다.
echo       진행 로그는 아래 [smoke] 줄로 표시됩니다 ^(약 5초마다^).
echo       취소^([Ctrl]+[C]^) 시 백그라운드 Next·GeoServer 도 정리합니다.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SMOKE_PS1%" -StartBat "%OUT%" -Root "%ROOT%" -Port %SMOKE_PORT% -TimeoutSec %SMOKE_TIMEOUT_SEC% -GeoPort %SMOKE_GEO_PORT%
set "SMOKE_EC=!ERRORLEVEL!"

:: CMD 강제 종료 대비·잔여 포트 재정리 (스모크가 이미 정리했어도 안전)
echo [1/3] 잔여 프로세스 추가 정리 ^(포트 %SMOKE_PORT%/%SMOKE_GEO_PORT%^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SMOKE_CLEANUP_PS1%" -Root "%ROOT%" -Port %SMOKE_PORT% -GeoPort %SMOKE_GEO_PORT%

if not "!SMOKE_EC!"=="0" (
  if "!SMOKE_EC!"=="130" (
    echo [중단] 사용자가 기동 검사를 취소했습니다 — nssm 등록을 하지 않습니다.
  ) else (
    if "!SMOKE_EC!"=="2" (
      echo [중단] 포트 %SMOKE_PORT% 가 이미 사용 중입니다 — nssm 등록을 하지 않습니다.
    ) else (
      echo [중단] 기동 검사 실패 ^(exit=!SMOKE_EC!^) — nssm 등록을 하지 않습니다.
      echo         스모크 로그: %TEMP%\ggnr_start_smoke.out.log / ggnr_start_smoke.err.log
    )
  )
  echo         폴더가 안 지워지면: powershell -NoProfile -File "%SMOKE_CLEANUP_PS1%" -Root "%ROOT%"
  set "FAIL_EC=!SMOKE_EC!"
  goto :fail_exit
)

echo.
echo [2/3] nssm 서비스 등록...
call "%NSSM_BAT%"
set "NSSM_EC=!ERRORLEVEL!"
if "!NSSM_EC!"=="2" (
  echo [안내] 기존 GGNR_V7 서비스를 유지했습니다 ^(재등록 안 함^).
  echo         기동 검사로 잠깐 멈춘 뒤 서비스가 꺼져 있을 수 있습니다.
  echo         필요 시 서비스 관리자에서 GGNR_V7 을 시작하세요.
  echo.
  echo [3/3] 로그 창 열기...
  call "%LOGS_BAT%"
  echo.
  echo [완료] 생성 → 기동 검사 → ^(기존 서비스 유지^) → 로그 창까지 끝났습니다.
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
echo [3/3] 로그 창 열기...
call "%LOGS_BAT%"

echo.
echo [완료] 생성 → 기동 검사 → nssm 등록 → 로그 창까지 끝났습니다.
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
