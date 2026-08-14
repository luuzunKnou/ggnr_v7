@echo off
setlocal

REM 1. Paths (script dir relative)
cd /d "%~dp0"
cd ..
set "MODULE_ROOT=%CD%"
set "GEOSERVER_DIR=%MODULE_ROOT%\geoserver"
set "BIN_DIR=%GEOSERVER_DIR%\bin"
set "JAVA_DIR=%MODULE_ROOT%\java"
set "DATA_DIR=%MODULE_ROOT%\data_dir"

REM 2. JAVA_HOME: first jdk in java folder
set "JAVA_HOME="
for /d %%i in ("%JAVA_DIR%\*") do (
  if exist "%%i\bin\java.exe" (
    set "JAVA_HOME=%%~fi"
    goto :java_found
  )
)
echo Java not found. Install to geoserver_modules\java
exit /b 1

:java_found
REM 3. App log is data_dir\logs (rolling). Do not append stdout to ggnr_log.
set "APP_LOG=%DATA_DIR%\logs\geoserver.log"

REM 4. Check startup.bat
if not exist "%BIN_DIR%\startup.bat" (
  echo GeoServer startup.bat not found: %BIN_DIR%\startup.bat
  exit /b 1
)

echo Starting GeoServer [cmd]...
echo GEOSERVER_DIR: %GEOSERVER_DIR%
echo GEOSERVER_DATA_DIR: %DATA_DIR%
echo JAVA_HOME: %JAVA_HOME%
echo APP_LOG: %APP_LOG%
echo Note: stdout is not appended to ggnr_log (use data_dir\logs)

REM 5. Run startup.bat — no unlimited ggnr_log append
cd /d "%BIN_DIR%"
set "GEOSERVER_HOME=%GEOSERVER_DIR%"
set "GEOSERVER_DATA_DIR=%DATA_DIR%"
call startup.bat
