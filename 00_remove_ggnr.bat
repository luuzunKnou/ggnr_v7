@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: =============================================================================
:: GGNR_V7 서비스 제거 + 80·3000 포트 점유 종료 (관리자 권한으로 실행)
:: - nssm 위치: root\nssm\win64\nssm.exe (nssm_install_ggnr.bat 과 동일)
:: - 순서: 1) nssm stop/remove GGNR_V7  2) 80·3000 포트 Listen 프로세스 종료
:: - 종료 시 항상 pause ? 로그 확인 후 수동으로 창 닫기
:: =============================================================================

set "SERVICE_NAME=GGNR_V7"
set "GEO_PORT=80"
set "APP_PORT=3000"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EXIT_EC=0"

echo.
echo [remove-ggnr] root    = %ROOT%
echo [remove-ggnr] service = %SERVICE_NAME%
echo [remove-ggnr] geo port= %GEO_PORT%
echo [remove-ggnr] app port= %APP_PORT%
echo.

:: 관리자 여부
net session >nul 2>&1
if errorlevel 1 (
  echo [오류] 관리자 실행이 아닙니다.
  echo         이 스크립트는 관리자 CMD에서 실행해야 합니다.
  echo         CMD를 마우스 오른쪽 버튼 → ≪관리자 권한으로 실행≫ 후 다시 실행하세요.
  set "EXIT_EC=1"
  goto :end_pause
)
echo [확인] 관리자 권한으로 실행 중입니다.

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
  goto :end_pause
)
echo [remove-ggnr] nssm    = %NSSM%
echo.

:: ---------------------------------------------------------------------------
:: 1) nssm remove GGNR_V7
:: ---------------------------------------------------------------------------
echo [1/2] nssm 서비스 %SERVICE_NAME% 중지·제거...
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if errorlevel 1 (
  echo [안내] 서비스 %SERVICE_NAME% 가 등록되어 있지 않습니다. ^(제거 생략^)
) else (
  echo [remove-ggnr] stop %SERVICE_NAME% ...
  "%NSSM%" stop %SERVICE_NAME% confirm >nul 2>&1
  echo [remove-ggnr] remove %SERVICE_NAME% ...
  "%NSSM%" remove %SERVICE_NAME% confirm
  if errorlevel 1 (
    echo [오류] nssm remove 실패
    echo         수동: "%NSSM%" stop %SERVICE_NAME% confirm
    echo               "%NSSM%" remove %SERVICE_NAME% confirm
    set "EXIT_EC=1"
    goto :end_pause
  )
  echo [완료] 서비스 %SERVICE_NAME% 제거됨.
)
echo.

:: ---------------------------------------------------------------------------
:: 2) 80·3000 포트 Listen 프로세스 종료
::    (findstr :80 단독은 8000·8080 등도 잡히므로 LISTENING + :포트 경계를 맞춤)
:: ---------------------------------------------------------------------------
echo [2/2] 포트 %GEO_PORT%, %APP_PORT% Listen 프로세스 검색·종료...
call :kill_listen_port %GEO_PORT%
echo.
call :kill_listen_port %APP_PORT%

echo.
if "!EXIT_EC!"=="0" (
  echo [완료] remove_ggnr 작업이 끝났습니다.
  echo   1^) nssm remove %SERVICE_NAME%
  echo   2^) 포트 %GEO_PORT%, %APP_PORT% 정리
) else (
  echo [종료] 오류로 중단되었습니다 ^(exit=!EXIT_EC!^). 위 메시지를 확인하세요.
)

:end_pause
echo.
echo -----------------------------------------------------------
echo  로그를 확인한 뒤, 아무 키나 누르면 창이 닫힙니다.
echo -----------------------------------------------------------
pause
exit /b !EXIT_EC!

:: ---------------------------------------------------------------------------
:: %1 = Listen 포트. 해당 포트 PID 종료 후 재확인.
:: ---------------------------------------------------------------------------
:kill_listen_port
set "KP=%~1"
echo ----- 포트 %KP% -----
echo       netstat 참고 ^(현재 LISTENING^):
netstat -ano | findstr /R /C:":%KP% .*LISTENING"
if errorlevel 1 (
  echo [안내] 포트 %KP% Listen 없음.
  goto :eof
)

set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%KP% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [remove-ggnr] taskkill /f /pid %%P
    taskkill /F /PID %%P >nul 2>&1
    if not errorlevel 1 (
      set /a KILLED+=1
      echo [완료] PID %%P 종료
    ) else (
      echo [경고] PID %%P 종료 실패 ^(이미 종료되었거나 권한 부족^)
    )
  )
)

if "!KILLED!"=="0" (
  echo [안내] 종료한 PID 없음 ^(파싱 실패 시 수동^):
  echo         netstat -ano ^| findstr :%KP%
  echo         taskkill /f /pid [PID]
) else (
  echo [완료] 포트 %KP% 관련 프로세스 !KILLED!건 종료 시도함.
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":%KP% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [확인] 포트 %KP% Listen 없음.
) else (
  echo [경고] 포트 %KP% 가 아직 Listen 중입니다. 수동 확인하세요.
  netstat -ano | findstr /R /C:":%KP% .*LISTENING"
)
goto :eof
