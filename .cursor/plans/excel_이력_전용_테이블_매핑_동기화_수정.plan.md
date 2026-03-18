---
name: ""
overview: ""
todos: []
isProject: false
---

# Excel 이력 전용 테이블·매핑·동기화 플랜 (수정)

## 수정 사항 요약

1. **Sync 로그**: 기존 `sync_log` 확장 대신 **Excel 전용 테이블 `excel_sync_log`** 신규 생성. SHP는 기존 `sync_log` 유지, Excel은 `excel_sync_log`만 사용.
2. **업로드 파일명**: Excel(및 필요 시 동일 정책 적용 대상) 업로드 완료 시 **파일명 앞에 타임스탬프(`YYYYMMDDHHmmss`) 접두어**를 붙여 저장 → 동일 파일명 재업로드 시 덮어쓰기 방지. 예: `사업목록.xlsx` → `20260315220255_사업목록.xlsx`.

---

## 1. 파일-레이어 매핑 및 "동일 파일" 정의

- **매핑**: "어떤 파일(경로) → 어떤 테이블(레이어)"를 `excel_upload_history`에서 관리.
- **동일 파일**: 서버 기준 **원본 파일 경로**로 식별. 타임스탬프 접두어가 붙은 경로가 저장되므로 업로드 시점별로 서로 다른 경로가 됨.
- **저장 위치**: `excel_upload_history`의 `eh_source_path`, `eh_table_name` 등.

---

## 2. DB 스키마

### 2.1 `excel_upload_history` (신규)


| 컬럼                  | 타입               | 설명                                                                             |
| ------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `eh_key`            | serial PK        | 이력 키                                                                           |
| `eh_source_path`    | varchar          | 원본 파일 서버 경로 (타임스탬프 접두어 포함, 예: service_data/excel_data/20260315220255_xxx.xlsx) |
| `eh_table_name`     | varchar NOT NULL | 생성된 테이블 영문명                                                                    |
| `eh_table_kor_name` | varchar          | 한글명                                                                            |
| `eh_group`          | varchar          | 그룹                                                                             |
| `eh_row_count`      | integer          | 삽입 행 수                                                                         |
| `eh_result`         | varchar          | '성공' / '실패'                                                                    |
| `eh_contents`       | varchar          | 요약 메시지                                                                         |
| `eh_create_date`    | timestamp        | 작업 일시                                                                          |
| `eh_create_user`    | integer          | 작업자 (nullable)                                                                 |


### 2.2 `excel_sync_log` (신규, Excel 전용)

SHP용 `sync_log`와 역할이 동일하되, Excel 이력(`excel_upload_history`)과만 연결. 기존 `sync_log`는 수정하지 않음.


| 컬럼                   | 타입                                       | 설명                                     |
| -------------------- | ---------------------------------------- | -------------------------------------- |
| `esl_key`            | serial PK                                | 로그 키                                   |
| `esl_eh_key`         | integer FK → excel_upload_history.eh_key | 어느 Excel 이력에 대한 동기화인지                  |
| `esl_table_name`     | varchar NOT NULL                         | 테이블명                                   |
| `esl_key_field`      | varchar NOT NULL                         | 키 필드명                                  |
| `esl_key_value`      | varchar NOT NULL                         | 키 값                                    |
| `esl_operation`      | varchar                                  | NULL=미결, append/conflict/kept/remove 등 |
| `esl_old_data`       | jsonb                                    | DB 기존 데이터                              |
| `esl_new_data`       | jsonb                                    | Excel/신규 데이터                           |
| `esl_applied_at`     | timestamp                                | 반영 일시                                  |
| `esl_rolled_back`    | boolean                                  | 롤백 여부                                  |
| `esl_rolled_back_at` | timestamp                                | 롤백 일시                                  |
| `esl_created_at`     | timestamp                                | 생성 일시                                  |


- **스키마 파일**: `database/schema/excel_sync_log.ts` 추가, `schema/index.ts`에 export.
- **서비스**: `compareExcelWithTable`는 기존 `sync_log` 대신 **`excel_sync_log`**에 INSERT. Excel 적용/롤백 로직도 `excel_sync_log` 기준으로 신규 구현 (또는 excelUploadService 내 전용 함수).

---

## 3. 업로드 시 파일명에 타임스탬프 접두어

- **적용 위치**: [uploadService.ts](src/service/uploadService.ts)의 `completeChunkedUpload`.
- **대상**: `meta.uploadType === 'excel'` 일 때만 저장 파일명을 `{YYYYMMDDHHmmss}_{meta.fileName}` 형태로 변경.
  - 예: `meta.fileName === '사업목록.xlsx'` → 저장 시 `20260315220255_사업목록.xlsx`.
  - 타임스탬프는 `completeChunkedUpload` 실행 시점의 로컬 시간으로 생성 (예: `new Date()`, 포맷 `yyyyMMddHHmmss`).
- **결과**: `savedPath`가 `service_data/excel_data/20260315220255_사업목록.xlsx` 형태로 반환되며, 마법사/이력에서 사용하는 `pathOrResult`도 이 경로가 됨. 동일 원본 파일을 다시 올려도 서로 다른 경로로 저장되어 덮어쓰기되지 않음.

---

## 4. 동일 테이블 재업로드 시 동작 (덮어쓰기)

- **정책**: 동일 **테이블명**으로 다시 올리면 기존 테이블 데이터는 TRUNCATE 후 INSERT로 덮어쓰기. 이력은 매번 새 행 추가.
- **파일 경로**: 타임스탬프가 붙어 있어 “같은 파일을 다시 올린 것”은 경로가 다르므로, “동일 파일 덮어쓰기”가 아니라 “동일 테이블에 새 파일(새 경로)로 덮어쓰기”로 처리하면 됨. `excel_upload_history`에는 매번 다른 `eh_source_path`가 쌓임.

---

## 5. 서비스·API

### 5.1 `excelHistoryService` (신규)

- `createExcelHistory`, `getExcelHistoryList` (기존 플랜과 동일).
- Excel 이력 CRUD만 담당.

### 5.2 `excelUploadService` 수정

- **createTableFromExcel**: `pathOrResult` 추가, 테이블 존재 시 TRUNCATE 후 INSERT (기존과 동일).
- **compareExcelWithTable**: 기존 `sync_log` 사용 부분 제거 후 **`excel_sync_log`**에만 기록하도록 변경.  
  - 미결 삭제: `DELETE FROM excel_sync_log WHERE esl_table_name = ? AND esl_operation IS NULL`.  
  - INSERT: `esl_eh_key`, `esl_table_name`, `esl_key_field`, `esl_key_value`, `esl_old_data`, `esl_new_data` 등.
- **추후**: Excel용 apply/rollback 함수는 `excel_sync_log` + `esl_eh_key` 기준으로 구현.

### 5.3 `uploadService` 수정

- **completeChunkedUpload**: `meta.uploadType === 'excel'`일 때 저장 파일명을 `{timestamp}_{meta.fileName}`으로 생성 후 `targetPath`/`savedPath`에 반영. 타임스탬프 포맷: `YYYYMMDDHHmmss` (14자리).

---

## 6. 클라이언트 변경

- **ExlWizardModal**: `pathOrResult` 전달, 성공 시 `excelHistoryService.createExcelHistory` 호출 (기존 플랜과 동일). 업로드 후 받는 `pathOrResult`가 이미 타임스탬프 접두어 포함 경로임.
- **ExlHistoryTab**: `getExcelHistoryList` 기반 단일 테이블 UI (기존 플랜과 동일).

---

## 7. 구현 순서 제안

1. **스키마**: `excel_upload_history`, `excel_sync_log` 스키마 파일 추가 및 index export.
2. **업로드 파일명**: `uploadService.completeChunkedUpload`에서 Excel일 때 타임스탬프 접두어 적용.
3. **excelHistoryService**: 생성 및 createExcelHistory, getExcelHistoryList 구현.
4. **excelUploadService**: createTableFromExcel에 pathOrResult + TRUNCATE 로직, compareExcelWithTable를 excel_sync_log 사용으로 변경.
5. **ExlWizardModal**: pathOrResult 전달, 성공 시 createExcelHistory 호출.
6. **ExlHistoryTab**: getExcelHistoryList 단일 테이블 UI로 전환.
7. **(추후)** Excel 전용 apply/rollback을 excel_sync_log 기준으로 구현.

---

## 8. 요약


| 항목          | 내용                                                             |
| ----------- | -------------------------------------------------------------- |
| Sync 로그     | Excel 전용 **excel_sync_log** 테이블 신규 생성. 기존 sync_log는 SHP 전용 유지. |
| 업로드 파일명     | Excel 업로드 완료 시 파일명 앞에 **YYYYMMDDHHmmss** 접두어 붙여 저장 → 덮어쓰기 방지.  |
| 파일-레이어 매핑   | excel_upload_history.eh_source_path + eh_table_name으로 보존.      |
| 동일 테이블 재업로드 | TRUNCATE 후 INSERT, 이력은 매번 추가.                                  |


