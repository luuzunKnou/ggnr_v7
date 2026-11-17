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
REM Korean Windows default is MS949 - styles/REST bodies with Korean break unless UTF-8
set "JAVA_OPTS=-Dfile.encoding=UTF-8 %JAVA_OPTS%"

REM Ensure EPSG:5181 (Central Belt FN=500000) user projection exists before start
set "EPSG_PROPS=%DATA_DIR%\user_projections\epsg.properties"
if not exist "%DATA_DIR%\user_projections" mkdir "%DATA_DIR%\user_projections"
findstr /R /C:"^[ ]*5181[ ]*=" "%EPSG_PROPS%" >nul 2>&1
if errorlevel 1 (
  echo Ensuring user_projections EPSG:5181...
  (
    echo # Custom EPSG overrides. Restart GeoServer after edit.
    echo # 5181 = Korea 2000 / Central Belt ^(FN 500000^) — project convention.
    echo 5181=PROJCS["Korea 2000 / Central Belt",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137.0,298.257222101],TOWGS84[0,0,0,0,0,0,0]],PRIMEM["Greenwich",0.0],UNIT["degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38.0],PARAMETER["central_meridian",127.0],PARAMETER["scale_factor",1.0],PARAMETER["false_easting",200000.0],PARAMETER["false_northing",500000.0],UNIT["metre",1.0],AUTHORITY["EPSG","5181"]]
  ) >> "%EPSG_PROPS%"
)

REM symbol style URLs: sync www/symbol to start.ini port (GEOSERVER_URL)
set "PROJECT_ROOT=%MODULE_ROOT%\.."
if exist "%PROJECT_ROOT%\scripts\sync-geoserver-symbol-style-urls.ts" (
  pushd "%PROJECT_ROOT%"
  call npx tsx scripts/sync-geoserver-symbol-style-urls.ts
  if errorlevel 1 echo [WARN] symbol style URL sync failed - continuing GeoServer start.
  popd
)

call startup.bat
