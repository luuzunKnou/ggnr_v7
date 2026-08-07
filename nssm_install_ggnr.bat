@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: nssm에 GGNR_V7 서비스 자동 등록 (관리자 권한으로 실행)
:: - 프로젝트 경로 = 이 bat이 있는 root (ggnr_start.bat 과 동일 폴더)
:: - 앱 = root\ggnr_start.bat
:: - 로그 = C:\logs\GGNR_V7_stdout.log / GGNR_V7_stderr.log
:: - C:\logs · C:\logs\backup 폴더만 생성 (자동 분류/이동 없음)
:: - 기존 서비스가 있으면 Y/N 후 삭제·재등록 (N이면 등록 중단)
:: =============================================================================

set "SERVICE_NAME=GGNR_V7"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "APP_BAT=%ROOT%\ggnr_start.bat"
set "LOG_DIR=C:\logs"
set "LOG_BACKUP=%LOG_DIR%\backup"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "LOG_ERR=%LOG_DIR%\GGNR_V7_stderr.log"

echo.
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
  exit /b 1
)
echo [확인] 관리자 권한으로 실행 중입니다.

if not exist "%APP_BAT%" (
  echo [오류] ggnr_start.bat 이 root에 없습니다: %APP_BAT%
  exit /b 1
)

:: nssm 찾기 (기본: C:\nssm\win64\nssm.exe)
set "NSSM="
if exist "C:\nssm\win64\nssm.exe" set "NSSM=C:\nssm\win64\nssm.exe"
if not defined NSSM if exist "C:\nssm\nssm.exe" set "NSSM=C:\nssm\nssm.exe"
if not defined NSSM (
  where nssm >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%I in ('where nssm') do (
      set "NSSM=%%I"
      goto :nssm_found
    )
  )
)

:nssm_found
if not defined NSSM (
  echo [오류] nssm.exe 를 찾지 못했습니다.
  echo   기대 경로: C:\nssm\win64\nssm.exe
  exit /b 1
)
echo [nssm-install] nssm     = %NSSM%

:: log / log\backup 폴더만 생성
call :EnsureLogFolders

:: 기존 서비스면 Y/N 후 중지·제거(재등록)
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if not errorlevel 1 (
  echo [nssm-install] 서비스 %SERVICE_NAME% 가 이미 등록되어 있습니다.
  set /p "DO_REREG=삭제 후 재등록할까요? (Y/N): "
  if /i not "!DO_REREG!"=="Y" (
    echo [중단] 기존 서비스를 유지합니다. 재등록하지 않았습니다.
    exit /b 2
  )
  echo [nssm-install] 기존 서비스 중지/제거...
  "%NSSM%" stop %SERVICE_NAME% confirm >nul 2>&1
  "%NSSM%" remove %SERVICE_NAME% confirm >nul 2>&1
)

echo [nssm-install] 서비스 등록...
"%NSSM%" install %SERVICE_NAME% "%APP_BAT%"
if errorlevel 1 (
  echo [오류] nssm install 실패
  exit /b 1
)

"%NSSM%" set %SERVICE_NAME% AppDirectory "%ROOT%"
"%NSSM%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM%" set %SERVICE_NAME% AppRestartDelay 3000
:: ggnr_start.bat 실패 시 pause 방지 (서비스가 키 입력 대기하지 않도록)
"%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra GGNR_START_NO_PAUSE=1
"%NSSM%" set %SERVICE_NAME% AppStdout "%LOG_OUT%"
"%NSSM%" set %SERVICE_NAME% AppStderr "%LOG_ERR%"
:: 로그 회전(약 10MB, 5개 백업)
"%NSSM%" set %SERVICE_NAME% AppStdoutCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppStderrCreationDisposition 4
"%NSSM%" set %SERVICE_NAME% AppRotateFiles 1
"%NSSM%" set %SERVICE_NAME% AppRotateBytes 10485760
"%NSSM%" set %SERVICE_NAME% AppRotateOnline 1

echo [nssm-install] 서비스 시작...
"%NSSM%" start %SERVICE_NAME%
if errorlevel 1 (
  echo [경고] 시작 실패. ggnr_start.bat 의 프로젝트명/환경·node PATH 를 확인하세요.
  echo         상태: "%NSSM%" status %SERVICE_NAME%
  exit /b 1
)

echo.
echo [완료] 서비스 %SERVICE_NAME% 등록·시작됨.
echo   stdout: %LOG_OUT%
echo   stderr: %LOG_ERR%
echo   backup 폴더: %LOG_BACKUP%
echo.
echo [실시간 로그 예]
echo   powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content '%LOG_OUT%' -Encoding UTF8 -Wait -Tail 10"
echo.
exit /b 0

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
exit /b 0
