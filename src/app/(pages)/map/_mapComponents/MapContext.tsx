'use client';

import React, { createContext, useContext, useRef, useState, useCallback, type RefObject, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type Map from 'ol/Map';
import { MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX, type MapSplitSecondaryKind } from './mapSplit/mapSplitTypes';
import type { IdentifyPopupState } from './hooks/useFeatureIdentify';
import type { MapDrawInteractionKind } from './mapDrawInteraction';
import type { ItsCctvItem } from '../_mapContents/road/roadCCTV/itsCctvTypes';
import type { RoadNetworkRow } from '../_mapContents/road/roadNetwork/roadNetworkMock';
import { cloneRoadNetworkRows } from '../_mapContents/road/roadNetwork/roadNetworkMock';
import type { RiverConstructionLedgerRow } from '../_mapContents/river/riverConstructionLedger/riverConstructionLedgerMock';

export type RoadCctvOverlayState = {
  items: ItsCctvItem[];
  selectedKey: string | null;
};

/** CCTV·통행 타일 등 ITS 요청에 쓰는 emd 기준 WGS84 bbox (화상자료와 동일) */
export type RoadCctvExtentWgs84 = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/** CCTV 패널 지도 부가 표시 — 통행 타일과 도로대장 총괄(a0020000) 배타 */
export type RoadCctvUnderlayMode = 'traffic' | 'roadLedgerSummary';

export type ActiveDataLayer = {
  tableName: string;
  name: string;
  schema: string;
} | null;

export type SelectedDetail = {
  layerName: string;
  tableName: string;
  row: Record<string, unknown>;
  fields: { define_field_name?: string; define_field_kor_name?: string; define_field_is_key?: string }[];
} | null;

/** 우클릭 주소정보 패널 상태 */
export type AddressInfoDetailState = {
  coordinate: [number, number];
  viewProjection: string;
  loading: boolean;
  pnu?: string | null;
  jibun: string | null;
  road: string | null;
  buildingName?: string | null;
} | null;

/** 민원 상세 (comp + compd 목록) */
export type ComplaintDetail = {
  compKey: number;
  compDate: string | null;
  compCu: string | null;
  compCt: string | null;
  compCg: string | null;
  compAdr: string | null;
  compName: string | null;
  compTel: string | null;
  compContent: string | null;
  compExtra: Record<string, unknown> | null;
  compdList: {
    compdKey: number;
    compKey: number;
    compdDate: string | null;
    compdCu: string | null;
    compdCt: string | null;
    compdCg: string | null;
    compdState: string | null;
    compdContents: string | null;
    compdExtra: Record<string, unknown> | null;
  }[];
} | null;

export type MapContextValue = {
  mapInstanceRef: RefObject<Map | null>;
  showDebugUi: boolean;
  setShowDebugUi: Dispatch<SetStateAction<boolean>>;
  visibleLayerNames: Set<string>;
  setVisibleLayerNames: Dispatch<SetStateAction<Set<string>>>;
  selectedDetail: SelectedDetail;
  setSelectedDetail: Dispatch<SetStateAction<SelectedDetail>>;
  identifyResultList: IdentifyPopupState | null;
  setIdentifyResultList: Dispatch<SetStateAction<IdentifyPopupState | null>>;
  /** 팝업에서 항목 클릭 시 상세로 열기 위해 전달하는 행 데이터. LayerDataPanel에서 소비 후 null로 초기화 */
  identifySelectedRow: Record<string, unknown> | null;
  setIdentifySelectedRow: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  complaintDetail: ComplaintDetail;
  setComplaintDetail: Dispatch<SetStateAction<ComplaintDetail>>;
  addressInfoDetail: AddressInfoDetailState;
  setAddressInfoDetail: Dispatch<SetStateAction<AddressInfoDetailState>>;
  /** 현재 주소정보 하이라이트 필지 도형(3857). 같은 필지 우클릭 시 닫기 판단용 */
  addressParcelGeometryRef: MutableRefObject<import('ol/geom').Geometry | null>;
  /** 전체 레이어 끄기(지적도·건물도로·기초구간 + defineLayer 레이어) 콜백. OpenLayersMap에서 등록 */
  allLayersOffRef: MutableRefObject<(() => void) | null>;
  /** 도형 내 데이터만 표시할 때 사용. WKT(5181). null이면 공간 필터 없음 */
  spatialFilterWkt: string | null;
  setSpatialFilterWkt: Dispatch<SetStateAction<string | null>>;
  /** 공간 필터 적용 시 레이어 목록에 표시할 테이블 이름 집합. null이면 전체 표시 */
  spatialFilteredLayerNames: Set<string> | null;
  setSpatialFilteredLayerNames: Dispatch<SetStateAction<Set<string> | null>>;
  /** 레이어 목록에서 도형 그리기 요청. OpenLayersMap에서 구독 후 Draw 추가, 완료 시 onComplete 호출 후 null로 초기화 */
  spatialDrawRequest: {
    type: 'rectangle' | 'polygon' | 'circle';
    onComplete: (wkt5181: string) => void;
  } | null;
  setSpatialDrawRequest: Dispatch<SetStateAction<{
    type: 'rectangle' | 'polygon' | 'circle';
    onComplete: (wkt5181: string) => void;
  } | null>>;
  /** 거리/면적 등 측정 도구가 켜져 있는지. OpenLayersMap에서 동기화. 레이어 목록 도형 그리기와 배타 */
  measurementActive: boolean;
  setMeasurementActive: Dispatch<SetStateAction<boolean>>;
  /** 활성 측정 도구 id. 지도분할 우측도 동일 메뉴로 독립 입력 */
  mapMeasureTool: 'distance' | 'area' | 'altitude' | 'slope' | null;
  setMapMeasureTool: Dispatch<
    SetStateAction<'distance' | 'area' | 'altitude' | 'slope' | null>
  >;
  /** 측정 초기화 패널 등 — 지도 Draw·측정 입력 일시 중단 (메뉴 선택 상태는 유지) */
  mapDrawInputSuspended: boolean;
  setMapDrawInputSuspended: Dispatch<SetStateAction<boolean>>;
  /** 뷰 왼쪽 패딩(px). 레이아웃에서 설정. 크로스헤어 위치 재계산용 */
  mapPaddingLeft: number;
  setMapPaddingLeft: Dispatch<SetStateAction<number>>;
  /** 뷰 오른쪽 패딩(px). 우측 메뉴·확장 패널 폭. 거터 pill 가용 범위용 */
  mapPaddingRight: number;
  setMapPaddingRight: Dispatch<SetStateAction<number>>;
  /** MapLayout이 등록 — 지도 인스턴스 준비 후 view.padding 재적용 */
  applyMapViewPaddingRef: MutableRefObject<(() => void) | null>;
  /**
   * view.padding 덮어쓰기. null이면 기본(왼쪽 패널 폭).
   * 상하 분할 시 [0,0,0,0] — 레이아웃 왼쪽 스페이서와 이중 패딩되어 워커가 사라지지 않게 함
   */
  mapViewPaddingOverrideRef: MutableRefObject<[number, number, number, number] | null>;
  /** OpenLayers 맵 인스턴스 준비 여부 */
  mapReady: boolean;
  setMapReady: Dispatch<SetStateAction<boolean>>;
  /**
   * 지도 영역 보조 칸 종류. null이면 분할 OFF.
   * streetView | map | panorama 등 — 공통 분할 셸과 연동
   */
  mapSplitSecondaryKind: MapSplitSecondaryKind;
  setMapSplitSecondaryKind: Dispatch<SetStateAction<MapSplitSecondaryKind>>;
  /** 거리뷰 등: 보조 칸 이동 시 주 칸 지도 중심 동기화 (기본 true) */
  mapSplitMapSync: boolean;
  setMapSplitMapSync: Dispatch<SetStateAction<boolean>>;
  /** 지도분할: 좌·우 배경지도 동기화 (기본 true) */
  mapSplitBasemapSync: boolean;
  setMapSplitBasemapSync: Dispatch<SetStateAction<boolean>>;
  /** 지도분할: 배경 패널이 적용될 쪽 (싱크 OFF일 때) */
  mapSplitBasemapFocus: 'primary' | 'secondary';
  setMapSplitBasemapFocus: Dispatch<SetStateAction<'primary' | 'secondary'>>;
  /** 지도분할 보조(우측) OL 맵 */
  mapSplitSecondaryMapRef: MutableRefObject<Map | null>;
  /** 보조 맵 배경 id (싱크 OFF·우측 포커스 시). 싱크 ON이면 주 맵과 동일하게 맞춤 */
  mapSplitSecondaryBackgroundId: string;
  setMapSplitSecondaryBackgroundId: Dispatch<SetStateAction<string>>;
  /**
   * 우측 분할지도 클릭 식별 결과.
   * OpenLayersMap이 좌측 클릭(popupState)과 동일 파이프라인으로 패널을 연다.
   */
  mapSplitIdentifyPopup: IdentifyPopupState | null;
  setMapSplitIdentifyPopup: Dispatch<SetStateAction<IdentifyPopupState | null>>;
  /** VWorld API 키 (주소 검색·역지오코딩). 서버 getMapConfig로 조회 후 설정 */
  vworldApiKey: string;
  setVworldApiKey: Dispatch<SetStateAction<string>>;
  /** 하천기본계획 패널(URL opened) 열림 — 지도 식별 시 색인도 처리 분기용 */
  riverBasicPlanPanelOpen: boolean;
  setRiverBasicPlanPanelOpen: Dispatch<SetStateAction<boolean>>;
  /** 하천기본계획 목록에서 선택된 하천명 (상세 패널 표시 시) */
  riverBasicPlanSelectedRiver: string;
  setRiverBasicPlanSelectedRiver: Dispatch<SetStateAction<string>>;
  /**
   * 지도 색인도 식별 직후 레이아웃이 하천·탭을 먼저 반영하도록 호출 (렌더마다 MapLayout에서 할당)
   */
  applyRiverBasicPlanMapPickRef: MutableRefObject<
    ((pick: { riverName: string; tab: 'river' | 'smallRiver' }) => void) | null
  >;
  /** 지도에서 색인도(river_d_index) 클릭 시 상세 패널이 소비 후 null로 초기화 */
  riverBasicPlanIndexFromMap: {
    indexOgcFid: number;
    planYear?: string;
    planName?: string;
  } | null;
  setRiverBasicPlanIndexFromMap: Dispatch<
    SetStateAction<{
      indexOgcFid: number;
      planYear?: string;
      planName?: string;
    } | null>
  >;
  /** 종단·횡단·구조물도 지도 식별 시 도면보기 — RiverBasicPlanMapDrawingFromMapHandler가 소비 */
  riverBasicPlanDrawingFromMap: { fileLayer: string; fileKey: string } | null;
  setRiverBasicPlanDrawingFromMap: Dispatch<
    SetStateAction<{ fileLayer: string; fileKey: string } | null>
  >;
  /** 상세목록 도면보기 열 때 지도 식별로 연 전체화면 미리보기 닫기 */
  riverBasicPlanMapDrawingPreviewControllerRef: MutableRefObject<{ close: () => void } | null>;
  /**
   * 목록에서 하천을 다시 클릭할 때 색인 상세(썸네일·상세목록)를 끄고
   * 하천기본계획+색인도 목록이 보이는 기본 상세로 복귀 — RiverBasicPlanDetailPanel이 등록
   */
  riverBasicPlanExitIndexViewToDetailRef: MutableRefObject<(() => void) | null>;
  /** 재난안전지도 패널 레이어 토글 (safemap WMS + GeoServer 연계 Polygon 등) */
  safetyMapLayerVisibility: Record<string, boolean>;
  setSafetyMapLayerVisibility: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** 하천점용 패널(URL opened) 열림 — 지도 식별 시 usage_data_as* → 목록·상세 선택 */
  usageDataAsPanelOpen: boolean;
  setUsageDataAsPanelOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * 지도에서 점용 레이어 식별 직후 목록이 키 선택·줌하도록 호출
   * (UsageDataAsListPanel이 등록). extent3857이 있으면 클릭 도형 기준으로 맞춤
   */
  applyUsageDataAsMapPickRef: MutableRefObject<
    | ((pick: {
        consCode: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >;
  /** 공통 점용대장 패널(URL opened=occupationLedger) 열림 */
  occupationLedgerPanelOpen: boolean;
  setOccupationLedgerPanelOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * 지도에서 점용대장 레이어 식별 직후 목록이 키 선택·줌하도록 호출
   * (OccupationLedgerListPanel이 등록)
   */
  applyOccupationLedgerMapPickRef: MutableRefObject<
    | ((pick: {
        rowKey: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >;
  /** 점사용료 패널(URL opened=useFee) 열림 */
  useFeePanelOpen: boolean;
  setUseFeePanelOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * 지도에서 점사용료 레이어 식별 직후 목록이 키 선택·줌하도록 호출
   * (UseFeeListPanel이 등록)
   */
  applyUseFeeMapPickRef: MutableRefObject<
    | ((pick: {
        id: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >;
  /** 도로대장 패널(URL opened) 열림 — 지도 식별 시 a0020000만 상세로 보내기 */
  roadLedgerPanelOpen: boolean;
  setRoadLedgerPanelOpen: Dispatch<SetStateAction<boolean>>;
  /** 지도 클릭으로 식별된 도로대장(a0020000) 피처 속성 — 상세 패널 표시 */
  roadLedgerIdentifyRow: Record<string, unknown> | null;
  setRoadLedgerIdentifyRow: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  /** 시설 하위 레이어 1건 — 모달 속성 + 지도 강조(geom). pickFromMap: 지도 클릭(줌 생략), 목록은 false */
  roadLedgerFacilityModal: {
    row: Record<string, unknown>;
    defineTableName: string;
    defineTableTitle: string;
    pickFromMap?: boolean;
  } | null;
  setRoadLedgerFacilityModal: Dispatch<
    SetStateAction<{
      row: Record<string, unknown>;
      defineTableName: string;
      defineTableTitle: string;
      pickFromMap?: boolean;
    } | null>
  >;
  /** 도로망도 임시 목록(CRUD 반영) */
  roadNetworkRows: RoadNetworkRow[];
  setRoadNetworkRows: Dispatch<SetStateAction<RoadNetworkRow[]>>;
  /** 도로망도 목록에서 선택한 도로 id — 상세·지도 강조 */
  roadNetworkSelectedId: string | null;
  setRoadNetworkSelectedId: Dispatch<SetStateAction<string | null>>;
  /** URL opened 도로망도 패널 열림 */
  roadNetworkPanelOpen: boolean;
  setRoadNetworkPanelOpen: Dispatch<SetStateAction<boolean>>;
  /** 필터 결과 지도 레이어 표시 */
  roadNetworkOverlayVisible: boolean;
  setRoadNetworkOverlayVisible: Dispatch<SetStateAction<boolean>>;
  /** 목록 필터·검색 결과(지도 오버레이용) */
  roadNetworkOverlayRows: RoadNetworkRow[];
  setRoadNetworkOverlayRows: Dispatch<SetStateAction<RoadNetworkRow[]>>;
  /**
   * 유지보수·민원 현장 위치 점 찍기 — 활성 시 overlay 훅이 지도 클릭을 가로채 호출.
   * effect deps에 Context value 넣지 말 것(ref만 사용).
   */
  roadNetworkPointPickRef: MutableRefObject<((lon: number, lat: number) => void) | null>;
  /** 점 찍기 모드(커서·식별 분기용) */
  roadNetworkPointPickActive: boolean;
  setRoadNetworkPointPickActive: Dispatch<SetStateAction<boolean>>;
  /** 편집 중 임시 현장 점(저장 전 미리보기) */
  roadNetworkDraftSitePoint: { lon: number; lat: number } | null;
  setRoadNetworkDraftSitePoint: Dispatch<
    SetStateAction<{ lon: number; lat: number } | null>
  >;
  /** 유지보수/민원 탭에 따라 지도에 표시할 현장 점 종류. null이면 현장 점 숨김 */
  roadNetworkSitePointKind: "maint" | "comp" | null;
  setRoadNetworkSitePointKind: Dispatch<SetStateAction<"maint" | "comp" | null>>;
  /** 군도·농도 기점·종점 지도 표시(조회·속성 편집 중 초안 포함) */
  roadNetworkEndpointMarkers: {
    start: { lon: number; lat: number } | null;
    end: { lon: number; lat: number } | null;
  } | null;
  setRoadNetworkEndpointMarkers: Dispatch<
    SetStateAction<{
      start: { lon: number; lat: number } | null;
      end: { lon: number; lat: number } | null;
    } | null>
  >;
  /** 목록에서 선택한 현장 점 키 (`m-{id}` / `c-{id}`) — 강조·이동 */
  roadNetworkFocusedSitePointKey: string | null;
  setRoadNetworkFocusedSitePointKey: Dispatch<SetStateAction<string | null>>;
  /** 하천 공사대장 임시 목록(CRUD 반영) */
  riverConstructionLedgerRows: RiverConstructionLedgerRow[];
  setRiverConstructionLedgerRows: Dispatch<SetStateAction<RiverConstructionLedgerRow[]>>;
  /** 공사대장 선택 id — 상세·지도 강조 */
  riverConstructionLedgerSelectedId: string | null;
  setRiverConstructionLedgerSelectedId: Dispatch<SetStateAction<string | null>>;
  /** URL opened 공사대장 패널 열림 */
  riverConstructionLedgerPanelOpen: boolean;
  setRiverConstructionLedgerPanelOpen: Dispatch<SetStateAction<boolean>>;
  /** 목록 필터·검색 결과(지도 오버레이용) */
  riverConstructionLedgerOverlayRows: RiverConstructionLedgerRow[];
  setRiverConstructionLedgerOverlayRows: Dispatch<SetStateAction<RiverConstructionLedgerRow[]>>;
  /** 하천목록에서 선택한 하천명(필터·지도 이동) */
  riverConstructionLedgerSelectedRiver: string | null;
  setRiverConstructionLedgerSelectedRiver: Dispatch<SetStateAction<string | null>>;
  /** 상세 대상 하천 클릭 — 하천 위치 강조(3857 extent) */
  riverConstructionLedgerRiverFocus: {
    riverName: string;
    extent3857: [number, number, number, number];
  } | null;
  setRiverConstructionLedgerRiverFocus: Dispatch<
    SetStateAction<{
      riverName: string;
      extent3857: [number, number, number, number];
    } | null>
  >;
  /** 상세에서 도형 그리기·수정 중인 공사 id — 오버레이·강조에서 제외(중복 표시 방지) */
  riverConstructionLedgerGeomEditingId: string | null;
  setRiverConstructionLedgerGeomEditingId: Dispatch<SetStateAction<string | null>>;
  /** ITS CCTV 패널 — 지도 벡터 레이어·목록 동기화 */
  roadCctvOverlay: RoadCctvOverlayState | null;
  setRoadCctvOverlay: Dispatch<SetStateAction<RoadCctvOverlayState | null>>;
  /** URL 기준 CCTV 패널 열림 — 지도 레이어 식별 비활성화용 */
  roadCctvPanelOpen: boolean;
  setRoadCctvPanelOpen: Dispatch<SetStateAction<boolean>>;
  /** CCTV 패널: 통행 타일 vs 도로대장 총괄 레이어(배타, 기본 통행) */
  roadCctvUnderlayMode: RoadCctvUnderlayMode;
  setRoadCctvUnderlayMode: Dispatch<SetStateAction<RoadCctvUnderlayMode>>;
  /** emd envelope WGS84 — CCTV 목록·통행 타일 요청에 동일 적용 */
  roadCctvExtentWgs84: RoadCctvExtentWgs84 | null;
  setRoadCctvExtentWgs84: Dispatch<SetStateAction<RoadCctvExtentWgs84 | null>>;
  /** OpenLayersMap이 배경지도 id를 매 갱신 */
  mapBackgroundMapIdRef: MutableRefObject<string>;
  /** 레이어 행 등록/수정 — 지도 도형 그리기·수정 모드 */
  layerRowGeomEdit: LayerRowGeomEditState;
  setLayerRowGeomEdit: Dispatch<SetStateAction<LayerRowGeomEditState>>;
  /** 편집 중 도형 WKT(EPSG:5181). 저장 시 layerRowService로 전달 */
  layerRowGeomEditWktRef: MutableRefObject<string | null>;
  /** 사용자가 도형을 실제로 변경했는지 (로드만 한 경우 false) */
  layerRowGeomEditDirtyRef: MutableRefObject<boolean>;
  /**
   * 도형 그리기/수정 완료 시 상세 패널 콜백 (점용장소 중심주소 등).
   * Handler가 호출 — 패널이 등록.
   */
  layerRowGeomDrawnRef: MutableRefObject<
    | ((info: { wkt5181: string; source: "draw" | "modify" }) => void)
    | null
  >;
  /** 도형 영역 필지 자동/수동 반영 → 상세 패널 필지목록 */
  layerRowParcelApplyRef: MutableRefObject<
    | ((
        items: {
          address: string;
          extent3857: [number, number, number, number] | null;
          geometry3857?: Record<string, unknown> | null;
          pnu?: string;
          point4326?: { x: number; y: number };
        }[],
        options?: { replaceAuto?: boolean }
      ) => void)
    | null
  >;
  /** 필지목록 삭제 → 부모 도형에서 해당 필지 영역 제외 */
  layerRowParcelRemoveRef: MutableRefObject<
    | ((
        parcel: {
          address: string;
          pnu?: string;
          geometry3857?: Record<string, unknown> | null;
        }
      ) => void | Promise<void>)
    | null
  >;
  /** 편집 중 필지목록 — 지도 미리보기용 */
  layerRowDraftParcels: Array<{
    address: string;
    extent3857: [number, number, number, number] | null;
    geometry3857?: Record<string, unknown> | null;
    point4326?: { x: number; y: number };
  }>;
  setLayerRowDraftParcels: Dispatch<
    SetStateAction<
      Array<{
        address: string;
        extent3857: [number, number, number, number] | null;
        geometry3857?: Record<string, unknown> | null;
        point4326?: { x: number; y: number };
      }>
    >
  >;
  /** OpenLayersMap 등록 — 측정·검색 도형 그리기 등 Draw 인터랙션 일괄 해제 */
  clearMapDrawInteractionsRef: MutableRefObject<((except?: MapDrawInteractionKind) => void) | null>;
  /**
   * 데이터조회(standardList) 패널에서 지도 클릭 → 항목 선택(listView) 허용 여부.
   * 통합검색(키워드) 탭일 때만 true. 도형·행정경계·데이터선택 등 다른 기능 사용 중에는 false.
   */
  dataQueryMapPickEnabled: boolean;
  setDataQueryMapPickEnabled: Dispatch<SetStateAction<boolean>>;
  /** 좌측 서비스 메뉴 전환 시 증가 — 패널이 레이어를 다시 켜도록 트리거 */
  serviceMenuEpoch: number;
  bumpServiceMenuEpoch: () => void;
};

export type LayerRowGeomEditState = {
  /** GeoServer 레이어명 (define_table_name) */
  layerName: string;
  /** DB 스키마 (기본 layer) */
  schema?: string;
  keyField: string;
  keyValue: string;
  mode: 'draw' | 'modify';
  /** DB 조회 대신 시드 WKT로 도형 표시 (프로토·메모리) */
  seedWkt5181?: string | null;
  /** true면 getTableRowGeomGeoJson3857 호출 생략 */
  protoGeom?: boolean;
  /** true면 기존 도형 없어도 수정 세션 유지(도형추가로 입력) */
  allowEmptyGeom?: boolean;
} | null;

const MapContext = createContext<MapContextValue | null>(null);

export function MapContextProvider({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<Map | null>(null);
  const allLayersOffRef = useRef<(() => void) | null>(null);
  const [showDebugUi, setShowDebugUi] = useState(false);
  const [visibleLayerNames, setVisibleLayerNames] = useState<Set<string>>(() => new Set());
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail>(null);
  const [identifyResultList, setIdentifyResultList] = useState<IdentifyPopupState | null>(null);
  const [identifySelectedRow, setIdentifySelectedRow] = useState<Record<string, unknown> | null>(null);
  const [complaintDetail, setComplaintDetail] = useState<ComplaintDetail>(null);
  const [addressInfoDetail, setAddressInfoDetail] = useState<AddressInfoDetailState>(null);
  const addressParcelGeometryRef = useRef<import('ol/geom').Geometry | null>(null);
  const [spatialFilterWkt, setSpatialFilterWkt] = useState<string | null>(null);
  const [spatialFilteredLayerNames, setSpatialFilteredLayerNames] = useState<Set<string> | null>(null);
  const [spatialDrawRequest, setSpatialDrawRequest] = useState<{
    type: 'rectangle' | 'polygon' | 'circle';
    onComplete: (wkt5181: string) => void;
  } | null>(null);
  const [measurementActive, setMeasurementActive] = useState(false);
  const [mapMeasureTool, setMapMeasureTool] = useState<
    'distance' | 'area' | 'altitude' | 'slope' | null
  >(null);
  const [mapDrawInputSuspended, setMapDrawInputSuspended] = useState(false);
  const [mapPaddingLeft, setMapPaddingLeft] = useState(0);
  const [mapPaddingRight, setMapPaddingRight] = useState(
    MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX
  );
  const applyMapViewPaddingRef = useRef<(() => void) | null>(null);
  const mapViewPaddingOverrideRef = useRef<[number, number, number, number] | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSplitSecondaryKind, setMapSplitSecondaryKind] = useState<MapSplitSecondaryKind>(null);
  const [mapSplitMapSync, setMapSplitMapSync] = useState(true);
  const [mapSplitBasemapSync, setMapSplitBasemapSync] = useState(true);
  const [mapSplitBasemapFocus, setMapSplitBasemapFocus] =
    useState<'primary' | 'secondary'>('primary');
  const mapSplitSecondaryMapRef = useRef<Map | null>(null);
  const [mapSplitSecondaryBackgroundId, setMapSplitSecondaryBackgroundId] =
    useState<string>('aerial-2022');
  const [mapSplitIdentifyPopup, setMapSplitIdentifyPopup] =
    useState<IdentifyPopupState | null>(null);
  const [vworldApiKey, setVworldApiKey] = useState('');
  const [riverBasicPlanPanelOpen, setRiverBasicPlanPanelOpen] = useState(false);
  const [riverBasicPlanSelectedRiver, setRiverBasicPlanSelectedRiver] = useState('');
  const applyRiverBasicPlanMapPickRef = useRef<
    ((pick: { riverName: string; tab: 'river' | 'smallRiver' }) => void) | null
  >(null);
  const [riverBasicPlanIndexFromMap, setRiverBasicPlanIndexFromMap] = useState<{
    indexOgcFid: number;
    planYear?: string;
    planName?: string;
  } | null>(null);
  const [riverBasicPlanDrawingFromMap, setRiverBasicPlanDrawingFromMap] = useState<{
    fileLayer: string;
    fileKey: string;
  } | null>(null);
  const riverBasicPlanMapDrawingPreviewControllerRef = useRef<{ close: () => void } | null>(null);
  const riverBasicPlanExitIndexViewToDetailRef = useRef<(() => void) | null>(null);
  const [safetyMapLayerVisibility, setSafetyMapLayerVisibility] = useState<Record<string, boolean>>({});
  const [usageDataAsPanelOpen, setUsageDataAsPanelOpen] = useState(false);
  const applyUsageDataAsMapPickRef = useRef<
    | ((pick: {
        consCode: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >(null);
  const [occupationLedgerPanelOpen, setOccupationLedgerPanelOpen] = useState(false);
  const applyOccupationLedgerMapPickRef = useRef<
    | ((pick: {
        rowKey: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >(null);
  const [useFeePanelOpen, setUseFeePanelOpen] = useState(false);
  const applyUseFeeMapPickRef = useRef<
    | ((pick: {
        id: string;
        extent3857?: [number, number, number, number] | null;
      }) => void)
    | null
  >(null);
  const [roadLedgerPanelOpen, setRoadLedgerPanelOpen] = useState(false);
  const [roadLedgerIdentifyRow, setRoadLedgerIdentifyRow] = useState<Record<string, unknown> | null>(null);
  const [roadLedgerFacilityModal, setRoadLedgerFacilityModal] = useState<{
    row: Record<string, unknown>;
    defineTableName: string;
    defineTableTitle: string;
    pickFromMap?: boolean;
  } | null>(null);
  const [roadNetworkRows, setRoadNetworkRows] = useState<RoadNetworkRow[]>(() => cloneRoadNetworkRows());
  const [roadNetworkSelectedId, setRoadNetworkSelectedId] = useState<string | null>(null);
  const [roadNetworkPanelOpen, setRoadNetworkPanelOpen] = useState(false);
  const [roadNetworkOverlayVisible, setRoadNetworkOverlayVisible] = useState(false);
  const [roadNetworkOverlayRows, setRoadNetworkOverlayRows] = useState<RoadNetworkRow[]>([]);
  const roadNetworkPointPickRef = useRef<((lon: number, lat: number) => void) | null>(null);
  const [roadNetworkPointPickActive, setRoadNetworkPointPickActive] = useState(false);
  const [roadNetworkDraftSitePoint, setRoadNetworkDraftSitePoint] = useState<{
    lon: number;
    lat: number;
  } | null>(null);
  const [roadNetworkSitePointKind, setRoadNetworkSitePointKind] = useState<
    "maint" | "comp" | null
  >(null);
  const [roadNetworkEndpointMarkers, setRoadNetworkEndpointMarkers] = useState<{
    start: { lon: number; lat: number } | null;
    end: { lon: number; lat: number } | null;
  } | null>(null);
  const [roadNetworkFocusedSitePointKey, setRoadNetworkFocusedSitePointKey] = useState<
    string | null
  >(null);
  const [riverConstructionLedgerRows, setRiverConstructionLedgerRows] = useState<
    RiverConstructionLedgerRow[]
  >([]);
  const [riverConstructionLedgerSelectedId, setRiverConstructionLedgerSelectedId] = useState<
    string | null
  >(null);
  const [riverConstructionLedgerPanelOpen, setRiverConstructionLedgerPanelOpen] = useState(false);
  const [riverConstructionLedgerOverlayRows, setRiverConstructionLedgerOverlayRows] = useState<
    RiverConstructionLedgerRow[]
  >([]);
  const [riverConstructionLedgerSelectedRiver, setRiverConstructionLedgerSelectedRiver] = useState<
    string | null
  >(null);
  const [riverConstructionLedgerRiverFocus, setRiverConstructionLedgerRiverFocus] = useState<{
    riverName: string;
    extent3857: [number, number, number, number];
  } | null>(null);
  const [riverConstructionLedgerGeomEditingId, setRiverConstructionLedgerGeomEditingId] =
    useState<string | null>(null);
  const [roadCctvOverlay, setRoadCctvOverlay] = useState<RoadCctvOverlayState | null>(null);
  const [roadCctvPanelOpen, setRoadCctvPanelOpen] = useState(false);
  const [roadCctvUnderlayMode, setRoadCctvUnderlayMode] = useState<RoadCctvUnderlayMode>('traffic');
  const [roadCctvExtentWgs84, setRoadCctvExtentWgs84] = useState<RoadCctvExtentWgs84 | null>(null);
  const mapBackgroundMapIdRef = useRef<string>('aerial-2022');
  const [layerRowGeomEdit, setLayerRowGeomEdit] = useState<LayerRowGeomEditState>(null);
  const layerRowGeomEditWktRef = useRef<string | null>(null);
  const layerRowGeomEditDirtyRef = useRef(false);
  const layerRowGeomDrawnRef = useRef<
    | ((info: { wkt5181: string; source: "draw" | "modify" }) => void)
    | null
  >(null);
  const layerRowParcelApplyRef = useRef<
    | ((
        items: {
          address: string;
          extent3857: [number, number, number, number] | null;
          geometry3857?: Record<string, unknown> | null;
          pnu?: string;
          point4326?: { x: number; y: number };
        }[],
        options?: { replaceAuto?: boolean }
      ) => void)
    | null
  >(null);
  const layerRowParcelRemoveRef = useRef<
    | ((
        parcel: {
          address: string;
          pnu?: string;
          geometry3857?: Record<string, unknown> | null;
        }
      ) => void | Promise<void>)
    | null
  >(null);
  const [layerRowDraftParcels, setLayerRowDraftParcels] = useState<
    Array<{
      address: string;
      extent3857: [number, number, number, number] | null;
      geometry3857?: Record<string, unknown> | null;
      point4326?: { x: number; y: number };
    }>
  >([]);
  const clearMapDrawInteractionsRef = useRef<((except?: MapDrawInteractionKind) => void) | null>(null);
  const [dataQueryMapPickEnabled, setDataQueryMapPickEnabled] = useState(true);
  const [serviceMenuEpoch, setServiceMenuEpoch] = useState(0);
  const bumpServiceMenuEpoch = useCallback(() => {
    setServiceMenuEpoch((n) => n + 1);
  }, []);

  return (
    <MapContext.Provider
      value={{
        mapInstanceRef,
        showDebugUi,
        setShowDebugUi,
        visibleLayerNames,
        setVisibleLayerNames,
        selectedDetail,
        setSelectedDetail,
        identifyResultList,
        setIdentifyResultList,
        identifySelectedRow,
        setIdentifySelectedRow,
        complaintDetail,
        setComplaintDetail,
        addressInfoDetail,
        setAddressInfoDetail,
        addressParcelGeometryRef,
        allLayersOffRef,
        spatialFilterWkt,
        setSpatialFilterWkt,
        spatialFilteredLayerNames,
        setSpatialFilteredLayerNames,
        spatialDrawRequest,
        setSpatialDrawRequest,
        measurementActive,
        setMeasurementActive,
        mapMeasureTool,
        setMapMeasureTool,
        mapDrawInputSuspended,
        setMapDrawInputSuspended,
        mapPaddingLeft,
        setMapPaddingLeft,
        mapPaddingRight,
        setMapPaddingRight,
        applyMapViewPaddingRef,
        mapViewPaddingOverrideRef,
        mapReady,
        setMapReady,
        mapSplitSecondaryKind,
        setMapSplitSecondaryKind,
        mapSplitMapSync,
        setMapSplitMapSync,
        mapSplitBasemapSync,
        setMapSplitBasemapSync,
        mapSplitBasemapFocus,
        setMapSplitBasemapFocus,
        mapSplitSecondaryMapRef,
        mapSplitSecondaryBackgroundId,
        setMapSplitSecondaryBackgroundId,
        mapSplitIdentifyPopup,
        setMapSplitIdentifyPopup,
        vworldApiKey,
        setVworldApiKey,
        riverBasicPlanPanelOpen,
        setRiverBasicPlanPanelOpen,
        riverBasicPlanSelectedRiver,
        setRiverBasicPlanSelectedRiver,
        applyRiverBasicPlanMapPickRef,
        riverBasicPlanIndexFromMap,
        setRiverBasicPlanIndexFromMap,
        riverBasicPlanDrawingFromMap,
        setRiverBasicPlanDrawingFromMap,
        riverBasicPlanMapDrawingPreviewControllerRef,
        riverBasicPlanExitIndexViewToDetailRef,
        safetyMapLayerVisibility,
        setSafetyMapLayerVisibility,
        usageDataAsPanelOpen,
        setUsageDataAsPanelOpen,
        applyUsageDataAsMapPickRef,
        occupationLedgerPanelOpen,
        setOccupationLedgerPanelOpen,
        applyOccupationLedgerMapPickRef,
        useFeePanelOpen,
        setUseFeePanelOpen,
        applyUseFeeMapPickRef,
        roadLedgerPanelOpen,
        setRoadLedgerPanelOpen,
        roadLedgerIdentifyRow,
        setRoadLedgerIdentifyRow,
        roadLedgerFacilityModal,
        setRoadLedgerFacilityModal,
        roadNetworkRows,
        setRoadNetworkRows,
        roadNetworkSelectedId,
        setRoadNetworkSelectedId,
        roadNetworkPanelOpen,
        setRoadNetworkPanelOpen,
        roadNetworkOverlayVisible,
        setRoadNetworkOverlayVisible,
        roadNetworkOverlayRows,
        setRoadNetworkOverlayRows,
        roadNetworkPointPickRef,
        roadNetworkPointPickActive,
        setRoadNetworkPointPickActive,
        roadNetworkDraftSitePoint,
        setRoadNetworkDraftSitePoint,
        roadNetworkSitePointKind,
        setRoadNetworkSitePointKind,
        roadNetworkEndpointMarkers,
        setRoadNetworkEndpointMarkers,
        roadNetworkFocusedSitePointKey,
        setRoadNetworkFocusedSitePointKey,
        riverConstructionLedgerRows,
        setRiverConstructionLedgerRows,
        riverConstructionLedgerSelectedId,
        setRiverConstructionLedgerSelectedId,
        riverConstructionLedgerPanelOpen,
        setRiverConstructionLedgerPanelOpen,
        riverConstructionLedgerOverlayRows,
        setRiverConstructionLedgerOverlayRows,
        riverConstructionLedgerSelectedRiver,
        setRiverConstructionLedgerSelectedRiver,
        riverConstructionLedgerRiverFocus,
        setRiverConstructionLedgerRiverFocus,
        riverConstructionLedgerGeomEditingId,
        setRiverConstructionLedgerGeomEditingId,
        roadCctvOverlay,
        setRoadCctvOverlay,
        roadCctvPanelOpen,
        setRoadCctvPanelOpen,
        roadCctvUnderlayMode,
        setRoadCctvUnderlayMode,
        roadCctvExtentWgs84,
        setRoadCctvExtentWgs84,
        mapBackgroundMapIdRef,
        layerRowGeomEdit,
        setLayerRowGeomEdit,
        layerRowGeomEditWktRef,
        layerRowGeomEditDirtyRef,
        layerRowGeomDrawnRef,
        layerRowParcelApplyRef,
        layerRowParcelRemoveRef,
        layerRowDraftParcels,
        setLayerRowDraftParcels,
        clearMapDrawInteractionsRef,
        dataQueryMapPickEnabled,
        setDataQueryMapPickEnabled,
        serviceMenuEpoch,
        bumpServiceMenuEpoch,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): MapContextValue | null {
  return useContext(MapContext);
}
