@echo off
setlocal

REM 1. Paths (script dir relative)
cd /d "%~dp0"
cd ..
set "MODULE_ROOT=%CD%"
set "GEOSERVER_DIR=%MODULE_ROOT%\geoserver"
set "BIN_DIR=%GEOSERVER_DIR%\bin"
set "JAVA_DIR=%MODULE_ROOT%\java"

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
REM 3. Check start.jar (GeoServer install)
if not exist "%GEOSERVER_DIR%\start.jar" (
  echo GeoServer start.jar not found: %GEOSERVER_DIR%\start.jar
  exit /b 1
)

echo Stopping GeoServer...
echo GEOSERVER_DIR: %GEOSERVER_DIR%
echo JAVA_HOME: %JAVA_HOME%

REM 4. Run java --stop (avoid shutdown.bat which has pause)
cd /d "%GEOSERVER_DIR%"
"%JAVA_HOME%\bin\java" -DSTOP.PORT=8079 -DSTOP.KEY=geoserver -jar start.jar --stop
