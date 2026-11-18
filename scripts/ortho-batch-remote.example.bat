@echo off
setlocal
cd /d D:\workspace\ggnr_v7
if errorlevel 1 (
  echo [ERROR] cannot cd to project
  pause
  exit /b 1
)
echo Running Andong ortho batch...
call npx --yes tsx scripts/ortho-batch-andong.ts
echo.
echo EXITCODE=%ERRORLEVEL%
echo.
pause
endlocal
