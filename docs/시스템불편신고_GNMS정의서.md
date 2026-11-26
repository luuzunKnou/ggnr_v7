# 시스템 불편신고 — GNMS 수신 API 정의서

운영 서버(ggnr_v7) 브라우저가 **GNMS로 직접** multipart POST 합니다.  
GNMS는 아래 규격에 맞춰 수신 API를 구현하면 됩니다.

## 엔드포인트

| 항목 | 값 |
|------|-----|
| Method | `POST` |
| URL | `{GNMS_URL}/api/system-feedback` (`GNMS_URL` 예: `http://dggs.jp/gnms`) |
| 예 | `http://dggs.jp/gnms/api/system-feedback` |
| 비고 | version API base(`…/api/source/version`)에 붙이지 않음. 항상 `{origin}/gnms/api/system-feedback` |
| Content-Type | `multipart/form-data` |
| 인증 | `Authorization: Bearer {토큰}` (기존 소스/로그와 동일 Bearer) |

## 폼 필드 (text)

| name | 필수 | 설명 |
|------|------|------|
| `sfKey` | Y | 운영 서버 불편신고 PK (숫자 문자열) |
| `usrId` | Y | 작성자 로그인 ID |
| `usrName` | Y | 작성자 표시명 |
| `systemKey` | N | 신고 시점 시스템 키 |
| `serviceEng` | N | 기능 eng. 비어 있으면 «선택 없음» |
| `serviceKor` | N | 기능 한글명 |
| `contentHtml` | Y | TipTap HTML 본문 |
| `systemName` | Y | 운영 프로젝트 `runtime.env` 의 `SYSTEM_NAME` (예: `water_us`). 화면 미표시 |
| `systemKorName` | Y | 운영 프로젝트 `runtime.env` 의 `SYSTEM_KOR_NAME` (예: `의성군 상하수도 행정 업무지원 시스템`). 화면 미표시 |
| `project` | N | 운영 프로젝트 힌트 (BASE_PATH) |
| `createdAt` | N | 로컬 등록 시각 (ISO) |

## 파일 필드

| name | 다중 | 설명 |
|------|------|------|
| `attachments` | Y | 별도 첨부(이미지·영상·문서 등). 동일 name 반복 |
| `editorImages` | Y | 본문 에디터에 삽입된 이미지 원본. 동일 name 반복 |

- 로컬 `file_data` URL에 의존하지 말 것. **파일 바이너리는 요청 body에 포함**됩니다.
- `contentHtml` 안 이미지 `src`는 운영 서버 경로일 수 있으므로, 표시·보관 시 `editorImages`를 기준으로 재매핑하는 것을 권장합니다.

## 성공 응답

```json
{ "ok": true }
```

HTTP `200`~`299`.

## 실패 응답

```json
{ "error": "메시지" }
```

HTTP `4xx`/`5xx`. 운영 서버는 로컬 이력은 유지하고 `gnms_sent=false`로 표시합니다.

## CORS

브라우저 직결이므로 GNMS는 운영 서버 origin에 대해 CORS를 허용해야 합니다.  
(기존 `/api/logs`, `/api/source/upload` 등과 동일 정책 권장)

## 운영 서버 측 참고

- 설정: `GNMS_URL` (`common.runtime.env`)
- 클라이언트: `loadGnmsBrowserConfig()` → Bearer + base URL
- 로컬 이력 테이블: `system_feedback`
