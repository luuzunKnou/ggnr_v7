@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: ggnr_start.bat 생성기 + (선택) 기동 검사 · nssm 등록 · 로그 창
:: - 실행 위치 root = 이 bat이 있는 폴더
:: - node PATH = where node 결과의 디렉터리
:: - root에 node_modules 없으면 고지 후 npm install (Y/N)
:: - 프로젝트명·환경 = 실행 시 입력
:: - 생성 후 Y/N: 기동 검사 → nssm_install_ggnr.bat → open_ggnr_logs.bat
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"
set "NSSM_BAT=%ROOT%\nssm_install_ggnr.bat"
set "LOGS_BAT=%ROOT%\open_ggnr_logs.bat"
set "SMOKE_PS1=%ROOT%\smoke_ggnr_start.ps1"
set "SMOKE_PORT=3000"
set "SMOKE_TIMEOUT_SEC=180"

echo.
echo [00_make_ggnr_starter] root = %ROOT%
echo [00_make_ggnr_starter] 출력 = %OUT%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] where node 실패. PATH 에 node 가 없습니다.
  exit /b 1
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node') do (
  set "NODE_EXE=%%I"
  goto :node_found
)

:node_found
if not defined NODE_EXE (
  echo [오류] node.exe 경로를 읽지 못했습니다.
  exit /b 1
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
      exit /b 1
    )
    if not exist "%ROOT%\node_modules\" (
      echo [오류] npm install 후에도 node_modules 가 없습니다.
      exit /b 1
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
  exit /b 1
)

set /p "ENV_NAME=환경 (GGNR_ENV): "
if not defined ENV_NAME (
  echo [오류] 환경이 비어 있습니다.
  exit /b 1
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
  echo set GGNR_PROJECT=%PROJECT_NAME%
  echo set GGNR_ENV=%ENV_NAME%
  echo.
  echo :: [앱 기동] nssm AppStdout 연결용 — call 유지
  echo call npm run start -- %PROJECT_NAME% %ENV_NAME%
  )

  if not exist "%OUT%" (
    echo [오류] ggnr_start.bat 생성 실패
    exit /b 1
  )
  echo [완료] 생성됨: %OUT%
) else (
  if not exist "%OUT%" (
    echo [오류] ggnr_start.bat 이 없습니다.
    exit /b 1
  )
)

echo.
set /p "DO_NEXT=기동 검사 후 nssm 등록·로그 열기를 진행할까요? (Y/N): "
if /i not "!DO_NEXT!"=="Y" (
  echo [종료] 생성만 완료했습니다.
  echo   수동: nssm_install_ggnr.bat ^(관리자^) → open_ggnr_logs.bat
  echo.
  exit /b 0
)

:: --- 관리자 확인 (nssm 등록용) ---
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] nssm 등록에는 관리자 권한이 필요합니다. 관리자 CMD에서 다시 실행하세요.
  exit /b 1
)

if not exist "%SMOKE_PS1%" (
  echo [오류] 없음: %SMOKE_PS1%
  exit /b 1
)
if not exist "%NSSM_BAT%" (
  echo [오류] 없음: %NSSM_BAT%
  exit /b 1
)
if not exist "%LOGS_BAT%" (
  echo [오류] 없음: %LOGS_BAT%
  exit /b 1
)

echo.
echo [1/3] ggnr_start.bat 기동 검사 ^(포트 %SMOKE_PORT%, 최대 %SMOKE_TIMEOUT_SEC%초^)...
echo       주의: 같은 포트에서 이미 npm run dev/start 가 돌면 실패할 수 있습니다.
echo       진행 로그는 아래 [smoke] 줄로 표시됩니다 ^(약 5초마다^).

powershell -NoProfile -ExecutionPolicy Bypass -File "%SMOKE_PS1%" -StartBat "%OUT%" -Root "%ROOT%" -Port %SMOKE_PORT% -TimeoutSec %SMOKE_TIMEOUT_SEC%
if errorlevel 1 (
  echo [중단] 기동 검사 실패 — nssm 등록을 하지 않습니다.
  exit /b 1
)

echo.
echo [2/3] nssm 서비스 등록...
call "%NSSM_BAT%"
if errorlevel 1 (
  echo [중단] nssm 등록/시작 실패
  exit /b 1
)

echo.
echo [3/3] 로그 창 열기...
call "%LOGS_BAT%"

echo.
echo [완료] 생성 → 기동 검사 → nssm 등록 → 로그 창까지 끝났습니다.
echo.
exit /b 0
