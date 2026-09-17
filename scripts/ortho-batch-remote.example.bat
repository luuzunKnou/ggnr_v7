@echo off
REM 다른 PC용 정사영상 배치 예시 — 경로만 수정해서 사용
cd /d D:\workspace\ggnr_v7

REM 원본: tiles_tif 폴더 또는 그룹 폴더
REM 작업: warp/타일 임시
REM 데이터: tiles_jpg·메타가 쌓일 루트 (보통 공유 G 또는 로컬 복사본)

npm run ortho:batch -- build_uj dev ^
  --group=satellite_2025_5187 ^
  --source-dir=F:\ggnr_data_dir\build_uj\tiles_tif ^
  --work-dir=F:\temp\ortho_work ^
  --data-dir=G:\ggnr_data_dir\build_uj

pause
