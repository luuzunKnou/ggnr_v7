# GNMS 기능 구현 프롬프트 (최신 소스 배포)

아래 요구사항으로 GNMS 서버 기능을 구현해줘.

## 목표
- 각 대상 서버(예: ggnr_v7)가 `GNMS 최신 소스 ZIP`을 조회/다운로드해서 자체 업데이트할 수 있게 한다.
- 클라이언트(ggnr_v7)는 다음 순서로 호출한다.
  1) 최신 메타 조회
  2) 최신 ZIP 다운로드
  3) (클라이언트 쪽) 압축해제/덮어쓰기/재시작

## API 계약

### 1) 최신 버전 메타 조회
- `GET /api/source/version/latest`
- Auth: `Authorization: Bearer <token>` (옵션)
- 응답(JSON):
```json
{
  "version": "2026.05.16.2100",
  "fileName": "source_install_2026-05-16_20260516210000.zip",
  "downloadUrl": "/api/source/version/download/latest",
  "checksumSha256": "optional_sha256_hex",
  "createdAt": "2026-05-16T12:00:00.000Z",
  "size": 123456789
}
```
- 실패 시:
```json
{ "error": "message" }
```

### 2) 최신 ZIP 다운로드
- `GET /api/source/version/download/latest`
- Auth: 동일 정책
- 응답:
  - `Content-Type: application/zip`
  - `Content-Disposition: attachment; filename="<fileName>"`
  - ZIP 바이너리 스트림

## 저장 구조
- GNMS가 업로드 받은 소스 ZIP 보관 디렉터리 예시:
  - `data/source_versions/<version>/bundle.zip`
  - `data/source_versions/latest.json` (최신 버전 포인터)

`latest.json` 예시:
```json
{
  "version": "2026.05.16.2100",
  "fileName": "source_install_2026-05-16_20260516210000.zip",
  "zipPath": "data/source_versions/2026.05.16.2100/bundle.zip",
  "checksumSha256": "optional",
  "size": 123456789,
  "createdAt": "2026-05-16T12:00:00.000Z"
}
```

## 구현 상세 요구
- `latest.json`이 없거나 ZIP 파일이 없으면 `404` 반환
- `downloadUrl`은 상대경로 또는 절대경로 모두 허용 가능
- 대용량 파일 스트리밍(`createReadStream`)으로 메모리 사용 최소화
- SHA256 검증이 있으면 메타 응답에 포함
- 로깅:
  - 누가/언제/latest 조회했는지
  - 누가/언제/download 했는지
  - User-Agent / IP / 결과코드
- 보안:
  - Bearer 토큰 검증 훅
  - 경로 traversal 차단
  - 내부 파일 경로는 응답에 직접 노출하지 않기

## 테스트 시나리오
- 최신 메타 정상 조회(200)
- 최신 파일 없음(404)
- 다운로드 정상(200, zip stream)
- 인증 실패(401/403)
- 손상 ZIP(500 + 에러 로그)

## 추가(선택)
- `GET /api/source/version/history?limit=20` 최근 버전 목록
- `POST /api/source/version/pin` 특정 버전을 latest로 변경
- `POST /api/source/version/rollback` 이전 버전 롤백 포인터 변경

---

구현 후 아래 산출물도 같이 제출해줘:
- 라우트 코드
- 버전 메타 저장 유틸
- 인증 미들웨어 연동 포인트
- 간단한 운영 문서(환경변수, 디렉터리, API 예시 curl)
