# 결과보고서

2026-09-21 | dev.strcat | road_gyeongsan 프로젝트 추가

## 목적

경산 도로 전용 프로젝트 설정·DB를 만들고, 울진건설과 같이 도로행정 메뉴만 쓰도록 한다.

## 요약

`road_gyeongsan` env·runtime을 추가하고, 192.168.127.32:5433에 DB·유저·스키마를 생성했다. 활성 시스템은 도로행정만 켠다.

## 파일수정

추가 | src/config/projects/road_gyeongsan.env
 프로젝트 DB·데이터경로 — 개발 호스트 32번·5433, DB명·유저 `road_gyeongsan`

추가 | src/config/projects/road_gyeongsan.runtime.env
 `ENABLED_SYSTEMS` — 도로행정만 활성
 `SYSTEM_KOR_NAME` · `SGG_CODE` — 경산시 표시·코드

## 테이블 수정

해당 없음 (DB·스키마만 생성, 테이블 push는 기동 시)

## 테스트

1. `npm run dev -- road_gyeongsan dev`로 기동되어야 한다.
2. 인덱스·지도에서 도로행정 시스템만 보여야 한다.
3. 도로망·도로대장 등 도로 부서업무 메뉴가 열려야 한다.
4. 하천·건설 시스템은 노출되지 않아야 한다.

## 프롬프트

—
—
