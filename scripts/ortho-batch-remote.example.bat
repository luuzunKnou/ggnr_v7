@echo off
setlocal
REM 다른 PC용 정사영상 배치 예시 — 경로만 수정해서 사용
REM 오류가 나도 창은 직접 닫을 때까지 유지됩니다.

cd /d D:\20260608 ggnr_v7
if errorlevel 1 (
  echo [오류] 프로젝트 폴더로 이동 실패
  goto :hold
)

REM 원본: tiles_tif 폴더 또는 그룹 폴더
REM 작업: warp/타일 임시
REM 데이터: tiles_jpg·메타가 쌓일 루트 (보통 공유 G 또는 로컬 복사본)

call npm run ortho:batch -- build_uj dev ^
  --group=satellite_2025_5187 ^
  --source-dir=F:\2025년4월촬영항공사진(성원지아이에스)울진10cm\1. 도엽별 정사영상 및 통합영상\1) GRS80_TM129_600000\10cm ^
  --work-dir=F:\v7uljin2025 ^
  --data-dir=G:\ggnr_data_dir\build_uj

echo.
echo EXITCODE=%ERRORLEVEL%

:hold
echo.
echo --------------------------------------------------
echo 창을 닫으려면 우측 상단 X 를 누르거나 exit 를 입력하세요.
echo --------------------------------------------------
cmd /k
endlocal
