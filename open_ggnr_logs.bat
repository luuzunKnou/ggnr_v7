@echo off
setlocal EnableExtensions

:: =============================================================================
:: GGNR / GeoServer 로그 실시간 보기 (CMD 창 2개)
:: 서비스 등록시 로그창이 없기 때문에 확인 위해 사용
:: - GGNR stdout = nssm_install_ggnr.bat 과 동일 C:\logs\GGNR_V7_stdout.log
:: - GeoServer   = root\geoserver_modules\data_dir\logs\geoserver.log
:: - root = 이 bat이 있는 폴더
:: - Get-Content 끊기면(파일 재생성 등) 자동 재접속
:: =============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "LOG_DIR=C:\logs"
set "LOG_OUT=%LOG_DIR%\GGNR_V7_stdout.log"
set "GEO_LOG=%ROOT%\geoserver_modules\data_dir\logs\geoserver.log"

echo.
echo [open_ggnr_logs] root    = %ROOT%
echo [open_ggnr_logs] GGNR    = %LOG_OUT%
echo [open_ggnr_logs] GeoSrv  = %GEO_LOG%
echo.
echo 파일이 없거나 연결이 끊기면 재접속합니다. 창을 닫으면 종료됩니다.
echo.

start "GGNR 로그" cmd /k powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p='%LOG_OUT%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch {}; Write-Host '[open_ggnr_logs] 재접속...'; Start-Sleep -Seconds 1 }"

start "GeoServer 로그" cmd /k powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p='%GEO_LOG%'; while ($true) { while (-not (Test-Path -LiteralPath $p)) { Start-Sleep -Seconds 2 }; try { Get-Content -LiteralPath $p -Encoding UTF8 -Wait -Tail 10 } catch {}; Write-Host '[open_ggnr_logs] 재접속...'; Start-Sleep -Seconds 1 }"

exit /b 0
