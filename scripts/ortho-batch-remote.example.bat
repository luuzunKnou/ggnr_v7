@echo off
setlocal
cd /d D:\20260608 ggnr_v7
if errorlevel 1 (
  echo [ERROR] cannot cd to project
  pause
  exit /b 1
)
echo Running Andong ortho batch year=2025...
echo Source is set in scripts/ortho-batch-andong.ts (LOCAL 2025)
echo Optional dry-run: npx tsx scripts/ortho-batch-andong.ts --year=2025 --dry-run
echo.
call npx --yes tsx scripts/ortho-batch-andong.ts --year=2025 --continue-on-error
echo.
echo EXITCODE=%ERRORLEVEL%
echo.
pause
endlocal
