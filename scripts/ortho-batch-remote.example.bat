@echo off
setlocal
cd /d D:\workspace\ggnr_v7
if errorlevel 1 (
  echo [ERROR] cannot cd to project
  pause
  exit /b 1
)
echo Running Andong time-series ortho batch (2011-2022 years)...
echo Optional: npx tsx scripts/ortho-batch-andong.ts --dry-run
echo Optional: npx tsx scripts/ortho-batch-andong.ts --year=2017
echo.
call npx --yes tsx scripts/ortho-batch-andong.ts --continue-on-error
echo.
echo EXITCODE=%ERRORLEVEL%
echo.
pause
endlocal
