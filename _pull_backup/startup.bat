@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "EXIT_CODE=0"
set "LOG="
set "APP_PORT=80"
set "PORT=80"

echo.
echo  GGNR Server  PORT=%APP_PORT%
echo.

set "NODE_EXE=%~dp0runtime\node\node.exe"
set "NPM_CMD=%~dp0runtime\node\npm.cmd"
set "NPM_CLI=%~dp0runtime\node\node_modules\npm\bin\npm-cli.js"

if not exist "%NODE_EXE%" (
  echo [ERROR] node.exe not found
  set "EXIT_CODE=1"
  goto :END
)

set "PATH=%~dp0runtime\node;%PATH%"

echo [1/5] check node/npm
"%NODE_EXE%" -v
call :RunNpm -v
if errorlevel 1 (
  echo [ERROR] npm failed
  set "EXIT_CODE=1"
  goto :END
)

call :OpenFirewallPorts >nul 2>&1
set "PORT=%APP_PORT%"

set /p "PROJECT=Project build_yy: "
if not defined PROJECT (
  echo [ERROR] project empty
  set "EXIT_CODE=1"
  goto :END
)

set /p "TYPE_SEL=Mode 1=dev 2=demo 3=prod: "
set "TYPE="
if "!TYPE_SEL!"=="1" set "TYPE=dev"
if "!TYPE_SEL!"=="2" set "TYPE=demo"
if "!TYPE_SEL!"=="3" set "TYPE=prod"
if not defined TYPE (
  echo [ERROR] invalid mode
  set "EXIT_CODE=1"
  goto :END
)

if not exist "%~dp0src\config\projects\!PROJECT!.env" (
  echo [ERROR] env missing: !PROJECT!
  set "EXIT_CODE=1"
  goto :END
)

if not exist "%~dp0logs" mkdir "%~dp0logs" 2>nul
set "LOG=%~dp0logs\startup_!PROJECT!_!TYPE!_%RANDOM%.log"

echo [2/5] !PROJECT! / !TYPE!
echo       log: !LOG!

if /I "!TYPE!"=="dev" (
  set "PORT=%APP_PORT%"
  echo [3/5] dev start...
  call :RunNpm run dev -- !PROJECT! !TYPE!
  set "EXIT_CODE=!ERRORLEVEL!"
  if !EXIT_CODE! NEQ 0 echo [ERROR] dev failed code=!EXIT_CODE!
  goto :END
)

call :CheckNeedBuild
if not errorlevel 1 (
  echo [3/5] build skip - .next up to date
  goto :AFTER_BUILD
)

echo [3/5] build...
call :RunNpm run build >> "!LOG!" 2>&1
set "BUILD_RC=!ERRORLEVEL!"
if not "!BUILD_RC!"=="0" (
  echo [ERROR] build failed code=!BUILD_RC!
  set "EXIT_CODE=!BUILD_RC!"
  goto :SHOW_LOG_TAIL
)

:AFTER_BUILD
if not exist "%~dp0.next\BUILD_ID" (
  echo [ERROR] .next missing - run build first
  set "EXIT_CODE=1"
  goto :SHOW_LOG_TAIL
)

echo [4/5] build ok
set "PORT=%APP_PORT%"
echo [5/5] server start - port %APP_PORT% may need Administrator
call :RunNpm run start -- !PROJECT! !TYPE!
set "EXIT_CODE=!ERRORLEVEL!"
if not "!EXIT_CODE!"=="0" (
  echo [ERROR] server exited code=!EXIT_CODE!
  goto :END
)
goto :END

:CheckNeedBuild
rem exit /b 0 = skip build, exit /b 1 = need build
if not exist "%~dp0.next\BUILD_ID" exit /b 1
for %%F in ("%~dp0package.json") do set "PKG_TS=%%~tF"
for %%F in ("%~dp0.next\BUILD_ID") do set "BLD_TS=%%~tF"
if defined PKG_TS if defined BLD_TS if "!PKG_TS!" gtr "!BLD_TS!" exit /b 1
powershell -NoProfile -Command "$b=(Get-Item -LiteralPath '%~dp0.next/BUILD_ID').LastWriteTime; $n=Get-ChildItem -LiteralPath '%~dp0src' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if($n -and $n.LastWriteTime -gt $b){ exit 1 }; exit 0"
if errorlevel 1 exit /b 1
exit /b 0

:OpenFirewallPorts
net session >nul 2>&1
if errorlevel 1 exit /b 0
for %%P in (%APP_PORT% 8090 5432 80 443 20 21) do call :AddFirewallRule %%P
exit /b 0

:AddFirewallRule
set "FW_PORT=%~1"
set "RULE_NAME=GGNR TCP !FW_PORT!"
netsh advfirewall firewall show rule name="!RULE_NAME!" >nul 2>&1
if not errorlevel 1 exit /b 0
netsh advfirewall firewall add rule name="!RULE_NAME!" dir=in action=allow protocol=TCP localport=!FW_PORT! >nul 2>&1
exit /b 0

:RunNpm
if exist "%NPM_CMD%" (
  call "%NPM_CMD%" %*
  exit /b !ERRORLEVEL!
)
if exist "%NPM_CLI%" (
  call "%NODE_EXE%" "%NPM_CLI%" %*
  exit /b !ERRORLEVEL!
)
exit /b 1

:SHOW_LOG_TAIL
echo.
echo ----- log tail -----
if exist "!LOG!" type "!LOG!"
echo ----- end -----
goto :END

:END
if !EXIT_CODE! NEQ 0 (
  if defined LOG echo full log: !LOG!
  pause
)
exit /b !EXIT_CODE!
