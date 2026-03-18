# 엑셀 → SHP 변환 설계 (도로점용 허가대장 등)

## 목표
도로점용 허가대장처럼 **허가번호, 허가일자, 도로종류, 노선명, 점용장소, 주소, 점용면적, 점용기간** 등이 있는 엑셀을 업로드해 **Point SHP**로 만들고, 기존 SHP 업로드와 동일하게 테이블/레이어/스타일/Define까지 한 번에 처리한다.

## 흐름 요약

```
[엑셀 업로드] → [엑셀 파싱] → [좌표 확보] → [GeoJSON 생성] → [SHP 생성] → [기존 SHP 후처리]
```

- **좌표 확보**: (A) 엑셀에 `경도`/`위도` 컬럼 사용 **또는** (B) `주소` 컬럼으로 지오코딩(API)
- **SHP 생성**: GDAL `ogr2ogr`로 GeoJSON → ESRI Shapefile (이미 프로젝트에서 ogr2ogr 사용 중)
- **기존 SHP 후처리**: `shpUploadService.createTableFromShp` 등 그대로 재사용

---

## 1. 업로드·저장

- **방식**: 기존 청크 업로드와 동일하게 `uploadType: 'excel'` 추가.
- **저장 위치**: `service_data/excel_to_shp/` (또는 `upload_data/excel`)에 `.xlsx` 저장.
- `uploadService`: `uploadType`에 `'excel'` 추가, 완료 시 `excel_to_shp` 폴더로 저장.

---

## 2. 엑셀 파싱

- **라이브러리**: 이미 사용 중인 `xlsx`.
- **시트**: 첫 시트 또는 사용자 지정 시트명.
- **헤더**: 첫 행을 컬럼명으로 사용. 한글 컬럼명 그대로 사용 후, SHP 속성/DB 컬럼명은 영문 매핑 또는 safe name 처리.
- **도로점용 대장 컬럼 예시**  
  `허가번호`, `허가일자`, `도로종류`, `노선명`, `점용장소`, `점용목적`, `주소`, `전화번호`, `피허가자명`, `점용면적(㎡)`, `점용기간(부터)`, `점용기간(까지)`  
  → 모두 SHP/DB 속성으로 보존.

---

## 3. 좌표 확보 (두 가지 옵션)

### 옵션 A: 엑셀에 경도/위도 컬럼 있음 (권장 1단계)

- 엑셀에 `경도`(또는 `lon`, `x`), `위도`(또는 `lat`, `y`) 컬럼이 있으면 그대로 사용.
- 컬럼명 유연 매칭: `경도`/`위도`/`lon`/`lat`/`x`/`y` 등.
- 좌표계: 사용자 선택 또는 기본값 `EPSG:4326` (WGS84). 다른 좌표계면 `EPSG:5187` 등 지정 가능하게.

### 옵션 B: 주소 → 지오코딩 (2단계 확장)

- `주소`(또는 `점용장소`) 컬럼으로 외부 API 호출.
- 후보: VWorld, Kakao, Naver 등 (API 키 필요, 일일 한도 고려).
- 실패 행: 좌표 null로 두고 속성만 저장하거나, 사용자에게 실패 목록 제공.

**권장**: 먼저 **옵션 A**만 구현해 “엑셀에 경도/위도만 넣으면 SHP 생성”까지 완성한 뒤, 필요 시 옵션 B(지오코딩) 추가.

---

## 4. GeoJSON → SHP 생성

- **도형**: Point (한 행 = 한 점).
- **속성**: 엑셀의 모든 컬럼을 속성으로 포함. 한글 컬럼명은 DB/SHP 호환을 위해 짧은 영문으로 매핑하거나, `shpUploadService` 쪽에서 쓰는 safe name 규칙 적용.
- **처리 순서**:
  1. 엑셀 행마다 `{ type: 'Point', coordinates: [경도, 위도] }` + 속성으로 GeoJSON Feature 생성.
  2. 임시 파일 `*.geojson`을 `GGNR_DATA_DIR/service_data/excel_to_shp/` 또는 임시 폴더에 저장.
  3. `ogr2ogr`로 GeoJSON → SHP  
     - 예: `ogr2ogr -f "ESRI Shapefile" -t_srs EPSG:4326 output.shp input.geojson`
  4. 생성된 SHP를 `service_data/shp_data/` 아래 원하는 폴더로 이동 (또는 그대로 두고 경로만 `shp_data` 기준으로 통일).
  5. 이후 **기존 SHP 플로우**와 동일: `createTableFromShp` → 레이어/스타일/Define.

---

## 5. 서비스/API 구조

- **신규 서비스**: `excelToShpService.ts`
  - `convertExcelToShp(params: { excelRelativePath: string; outputBasename?: string; longitudeColumn?: string; latitudeColumn?: string; addressColumn?: string })`
  - 내부: xlsx 읽기 → 행 파싱 → 좌표 결정(경도/위도 컬럼 또는 추후 지오코딩) → GeoJSON 작성 → ogr2ogr 실행 → SHP 경로 반환.
- **uploadService**
  - `uploadType: 'excel'` 추가, 완료 시 `service_data/excel_to_shp/{fileName}` 저장.
- **API**: 기존 `call('', 'POST', { service, action, params })` 사용.  
  - 예: `service: 'excelToShpService', action: 'convertExcelToShp', params: { ... }`

---

## 6. UI (SHP 업로드와 통합)

- **위치**: 개발자 메뉴의 **SHP 업로드** 탭에 “엑셀에서 SHP 만들기” 블록 추가하거나, 같은 패널에 탭/섹션 하나 더 두기.
- **단계**:
  1. 엑셀 파일 선택 후 업로드 (기존 청크 업로드 재사용, `uploadType: 'excel'`).
  2. 업로드 완료 후 “SHP로 변환” 버튼.
  3. (선택) 컬럼 매핑: 경도/위도 컬럼 이름 지정, 또는 “주소로 지오코딩” 선택.
  4. 변환 실행 → 진행률/성공/실패 메시지.
  5. 변환된 SHP가 `shp_data`에 생겼다면, 기존처럼 “테이블/레이어/스타일/Define” 후처리 목록에 자동으로 나타나게 하거나, “후처리 실행” 버튼으로 기존 SHP와 동일 플로우 실행.

---

## 7. 기술 포인트

| 항목 | 내용 |
|------|------|
| 엑셀 읽기 | `xlsx` (이미 package.json에 있음) |
| 좌표계 | 기본 WGS84 (EPSG:4326). .prj 생성 시 동일하게 지정 |
| SHP 생성 | `shpUploadService`에서 쓰는 `resolveOgr2ogrRun()` 재사용, `ogr2ogr -f "ESRI Shapefile"` |
| 인코딩 | 엑셀/GeoJSON/SHP 모두 UTF-8. 한글 컬럼명·속성 처리 시 주의 |
| 실패 행 | 경도/위도 없거나 지오코딩 실패 시 해당 행은 건너뛰거나 경고 후 나머지만 SHP에 포함 |

---

## 8. 구현 순서 제안

1. **uploadService**: `uploadType: 'excel'`, 저장 경로 `service_data/excel_to_shp` 추가.
2. **excelToShpService**:  
   - xlsx 읽기 → 첫 시트 행 배열로 변환.  
   - 경도/위도 컬럼명 옵션으로 좌표 추출.  
   - GeoJSON 생성 → 임시 파일 쓰기 → ogr2ogr로 SHP 생성 → `shp_data`로 복사/이동.  
   - 반환: `{ success, shpRelativePath?, error? }`
3. **ShpUploadTab(또는 새 컴포넌트)**: 엑셀 업로드 + “SHP로 변환” + 변환 결과 SHP에 대해 기존 후처리 플로우 호출.
4. (선택) 지오코딩: `주소` 컬럼으로 API 호출해 경도/위도 채우는 단계 추가.

이 순서대로 하면 “엑셀 업로드 → SHP 생성 → 기존처럼 지도 레이어까지” 한 흐름으로 처리할 수 있다.
