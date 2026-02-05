# 공간정보 통합관리 플랫폼

## 빠른 시작

### 개발 환경

```bash
# 의존성 설치
npm install

# Next.js 개발 서버 (터미널 1)
npm run dev

# pg_tileserv (터미널 2)
npm run tileserv

# pg_featureserv (터미널 3)
npm run featureserv
```

### 환경 변수 설정

`.env.local` 파일에 데이터베이스 정보 설정:
```env
DATABASE_HOST=192.168.120.82
DATABASE_PORT=5433
DATABASE_NAME=postgres
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
```

---

## 배포

### 1. pg_tileserv & pg_featureserv 설치

```bash
npm run install-pg-services
```

자동으로 다운로드하여 `pg_map_modules/services/` 폴더에 설치됩니다.

### 2. 프로덕션 빌드

```bash
npm run build
npm start
```

### 3. Windows 서비스 등록 (선택사항)

**NSSM 사용:**
```powershell
# NSSM 다운로드: https://nssm.cc/download

# pg_tileserv 등록
nssm install PgTileserv "C:\path\to\pg_map_modules\services\pg_tileserv\pg_tileserv.exe"
nssm set PgTileserv AppDirectory "C:\path\to\pg_map_modules\services\pg_tileserv"
nssm set PgTileserv AppParameters "--config ..\pg_tileserv.toml"

# pg_featureserv 등록
nssm install PgFeatureserv "C:\path\to\pg_map_modules\services\pg_featureserv\pg_featureserv.exe"
nssm set PgFeatureserv AppDirectory "C:\path\to\pg_map_modules\services\pg_featureserv"
nssm set PgFeatureserv AppParameters "--config ..\pg_featureserv.toml"
```

---

## 포트

- Next.js: http://192.168.120.82:3000
- pg_tileserv: http://192.168.120.82:7800
- pg_featureserv: http://192.168.120.82:9000

---

## pg_tileserv 설정 및 타일 파라미터

### 설정 파일 (`pg_map_modules/services/pg_tileserv.toml`)

| 항목 | 설명 | 기본값(예시) |
|------|------|----------------|
| **DefaultResolution** | 벡터 타일 좌표 양자화 해상도(한 변당 단위 수). 클수록 정밀, 타일 용량 증가. | 4096 |
| **DefaultBuffer** | 타일 경계 밖으로 확장하는 패딩(단위). 선/심볼이 타일 경계에서 잘리지 않도록 함. | 64~256 |
| **MaxFeaturesPerTile** | 타일당 최대 피처 수(설정 시). -1이면 제한 없음. | 50000 |

- **뷰/함수**: 테이블뿐 아니라 **PostgreSQL 뷰**도 레이어로 노출된다. `public_layer.serviceLayerView`처럼 여러 레이어를 UNION한 뷰를 만들어 한 번의 타일 요청으로 여러 레이어를 받을 수 있다.
- **PostGIS 단순화**: pg_tileserv는 타일 생성 시 PostGIS `ST_AsMVT()` 등을 사용한다. 줌에 따른 기하 단순화는 함수 레이어에서 직접 제어하거나, 타일 해상도(Resolution)로 간접 영향을 준다.

### 타일 URL 쿼리 파라미터 (요청 시 오버라이드)

| 파라미터 | 설명 |
|----------|------|
| **limit** | 타일당 최대 피처 수. 낮은 줌에서 도형이 잘리면 `?limit=100000` 등으로 상향. (앱에서는 `indexLayerFactory`의 `TILE_FEATURE_LIMIT` 사용) |
| **resolution** | 타일 해상도(설정 DefaultResolution 오버라이드). |
| **buffer** | 타일 버퍼(설정 DefaultBuffer 오버라이드). |
| **properties** | 포함할 속성 컬럼(쉼표 구분). 넓은 테이블일 때 지정하면 타일 용량 감소. |
| **filter** | CQL 표현식으로 피처 필터링. |

- 참고: [pg_tileserv Table Layers](https://access.crunchydata.com/documentation/pg_tileserv/latest/usage/table-layers/), [About Tiles](https://access.crunchydata.com/documentation/pg_tileserv/latest/usage/tiles/)

---

## 주요 명령어

```bash
npm run dev          # 개발 서버
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run tileserv     # pg_tileserv 실행
npm run featureserv   # pg_featureserv 실행
```
