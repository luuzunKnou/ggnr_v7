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

:: %% → 생성된 bat 에 % 한 개로 남김
> "%OUT%" (
echo @echo off
echo.
echo :: ggnr_v7 서비스 등록시 실행용 bat
echo.
echo :: [인코딩 설정] UTF-8 BOM 인코딩 설정
echo chcp 65001 ^> nul
echo.
echo :: [로그 폴더] 없으면 C:\logs , C:\logs\backup 생성
echo set "LOG_DIR=C:\logs"
echo set "LOG_BACKUP=%%LOG_DIR%%\backup"
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
echo call npm run start -- %PROJECT_NAME% %ENV_NAME%
echo.
echo :: [로그 설정]
echo :: nssm set GGNR_V7 AppStdout "C:\logs\GGNR_V7_stdout.log"
echo :: nssm set GGNR_V7 AppStderr "C:\logs\GGNR_V7_stderr.log"
echo.
echo :: 실시간 로그 출력
echo :: powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content 'C:\logs\GGNR_V7_stdout.log' -Encoding UTF8 -Wait -Tail 10"
)

if not exist "%OUT%" (
  echo [오류] ggnr_start.bat 생성 실패
  exit /b 1
)

echo [완료] 생성됨: %OUT%
echo   이어서 nssm-install-ggnr.bat 을 관리자 권한으로 실행하면 서비스에 등록됩니다.
echo.
exit /b 0
