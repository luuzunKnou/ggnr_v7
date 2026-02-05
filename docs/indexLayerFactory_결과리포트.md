# index 기반 레이어 팩토리 적용 결과 리포트

## 요약

제공하신 pg_tileserv `index.json` 구조를 기준으로, **serviceList.config 없이** 한 개의 factory 파일에서 모든 레이어를 추가하도록 구현했습니다.

---

## 변경 사항

### 1. 신규 파일: `indexLayerFactory.ts`

- **경로**: `src/app/(pages)/map/_mapComponents/indexLayerFactory.ts`
- **역할**:
  - `http://192.168.120.82:7800/index.json`을 fetch하여 **type이 `"table"`인 항목마다** VectorTileLayer 한 개씩 생성
  - 레이어 ID는 index 키 사용 (예: `layer.bike`, `public_layer.bjd`)
  - 타일 URL: `http://192.168.120.82:7800/{layerId}/{z}/{x}/{y}.pbf`
  - 지오메트리 타입별 스타일: Point(원형), Line(선), Polygon(테두리+채우기)
- **레이어 속성**:
  - `name`: 테이블 이름 (표시명)
  - `serviceLayer`: true
  - `layerId`: schema.name 형식 ID
  - 기본 `visible`: false

### 2. 지도 훅 수정: `useMapInstance.ts`

- **변경**: `createServiceLayers()` → `createIndexLayers()` 로 교체
- 지도 초기화 후 `createIndexLayers()`를 호출해 생성된 레이어를 맵에 모두 push

---

## 동작 방식

1. 지도가 마운트되면 `createIndexLayers()`가 실행됩니다.
2. `http://192.168.120.82:7800/index.json`을 요청해 현재 서버에 등록된 테이블 목록을 가져옵니다.
3. 각 항목이 `type === "table"`이면 해당 `id`(예: `layer.wtl_pipe_lm`, `public_layer.serviceLayerView`)로 MVT VectorTileLayer를 만들고 맵 레이어 목록에 추가합니다.
4. 제공해 주신 index와 동일한 구조라면, **layer 스키마 + public_layer 스키마**의 모든 테이블 레이어가 맵에 추가됩니다.

---

## 참고

- **serviceList.config 미사용**: 레이어 목록·표시명은 전부 index.json의 `id`, `name` 기준입니다.
- **레이어 그룹 바(상수관망도 등)**: `map-layergroup-bar.tsx`는 여전히 `getServiceList`(serviceList.config)로 카테고리를 가져옵니다. index 전용 레이어에는 `ser_cat`이 없어서, 카테고리 버튼으로는 토글되지 않습니다. 필요 시 레이어 목록/토글 UI를 index 기반으로 따로 구성하면 됩니다.
- **기존 serviceLayerFactory.ts**: 삭제하지 않았습니다. 다른 화면에서 `createServiceLayers()`를 쓰는 경우를 대비해 두었습니다.

---

## 결과

- index.json 기준 **모든 table 타입 레이어**를 한 factory 파일(`indexLayerFactory.ts`)에서만 추가하도록 반영했습니다.
- 지도는 `useMapInstance`를 통해 `createIndexLayers()`로 생성된 레이어를 사용합니다.
