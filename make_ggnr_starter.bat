@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: ggnr_start.bat 생성기
:: - 실행 위치(root) = 이 bat이 있는 폴더
:: - node PATH = where node 결과의 디렉터리
:: - 프로젝트명·환경 = 실행 시 입력
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\ggnr_start.bat"

echo.
echo [make_ggnr_starter] root = %ROOT%
echo [make_ggnr_starter] 출력 = %OUT%
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

echo [make_ggnr_starter] node.exe = %NODE_EXE%
echo [make_ggnr_starter] PATH 추가 = %NODE_DIR%
echo.

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

if exist "%OUT%" (
  set /p "OVERWRITE=이미 ggnr_start.bat 이 있습니다. 덮어쓸까요? (Y/N): "
  if /i not "!OVERWRITE!"=="Y" (
    echo [취소] 생성하지 않았습니다.
    exit /b 0
  )
)

:: nssm_install_ggnr.bat 과 동일 로그 경로
set "LOG_OUT=C:\logs\GGNR_V7_stdout.log"
set "GEO_LOG=%ROOT%\geoserver_modules\data_dir\logs\geoserver.log"

:: %% → 생성된 bat 에 % 한 개로 남김
:: call npm 은 블로킹이라 그 다음 줄은 종료 후에야 실행됨.
:: 그래서 npm 기동 직후·병렬로 "파일 생기면 창 열기" 대기 프로세스를 먼저 start 한 뒤 call 한다.
> "%OUT%" (
echo @echo off
echo.
echo :: ggnr_v7 서비스 등록시 실행용 bat
echo.
echo :: [인코딩 설정] UTF-8 BOM 인코딩 설정
echo chcp 65001 ^> nul
echo.
echo :: [로그 폴더] 없으면 C:\logs , C:\logs\backup 생성 (로그 파일은 생성하지 않음)
echo set "LOG_DIR=C:\logs"
echo set "LOG_BACKUP=%%LOG_DIR%%\backup"
echo set "LOG_OUT=%%LOG_DIR%%\GGNR_V7_stdout.log"
echo set "GEO_LOG=%ROOT%\geoserver_modules\data_dir\logs\geoserver.log"
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
echo :: [실시간 로그] npm 기동 후 파일이 있을 때만 Get-Content (없으면 2초마다 재검사)
echo start "GGNR 로그" cmd /k powershell -NoProfile -Command "while (-not (Test-Path -LiteralPath 'C:\logs\GGNR_V7_stdout.log')) { Start-Sleep -Seconds 2 }; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -LiteralPath 'C:\logs\GGNR_V7_stdout.log' -Encoding UTF8 -Wait -Tail 10"
echo start "GeoServer 로그" cmd /k powershell -NoProfile -Command "while (-not (Test-Path -LiteralPath '%GEO_LOG%')) { Start-Sleep -Seconds 2 }; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -LiteralPath '%GEO_LOG%' -Encoding UTF8 -Wait -Tail 10"
echo.
echo :: [앱 기동] nssm AppStdout 연결용 — call 유지
echo call npm run start -- %PROJECT_NAME% %ENV_NAME%
)

if not exist "%OUT%" (
  echo [오류] ggnr_start.bat 생성 실패
  exit /b 1
)

echo [완료] 생성됨: %OUT%
echo   로그 CMD는 파일이 생긴 뒤에만 내용을 보여 줍니다(없으면 대기).
echo   call npm 은 블로킹이라, 창은 npm 과 병렬로 띄운 뒤 파일 검사합니다.
echo   이어서 nssm_install_ggnr.bat 을 관리자 권한으로 실행하면 서비스에 등록됩니다.
echo.
exit /b 0
