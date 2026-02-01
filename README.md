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
DATABASE_HOST=localhost
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

- Next.js: http://localhost:3000
- pg_tileserv: http://localhost:7800
- pg_featureserv: http://localhost:9000

---

## 주요 명령어

```bash
npm run dev          # 개발 서버
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run tileserv     # pg_tileserv 실행
npm run featureserv   # pg_featureserv 실행
```
