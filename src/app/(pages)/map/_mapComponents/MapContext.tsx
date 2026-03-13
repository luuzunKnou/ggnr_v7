'use client';

import React, { createContext, useContext, useRef, useState, type RefObject, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type Map from 'ol/Map';
import type { IdentifyPopupState } from './hooks/useFeatureIdentify';

export type ActiveDataLayer = {
  tableName: string;
  name: string;
  schema: string;
} | null;

export type SelectedDetail = {
  layerName: string;
  tableName: string;
  row: Record<string, unknown>;
  fields: { define_field_name?: string; define_field_kor_name?: string }[];
} | null;

/** 우클릭 주소정보 패널 상태 */
export type AddressInfoDetailState = {
  coordinate: [number, number];
  viewProjection: string;
  loading: boolean;
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
  /** 뷰 왼쪽 패딩(px). 레이아웃에서 설정. 크로스헤어 위치 재계산용 */
  mapPaddingLeft: number;
  setMapPaddingLeft: Dispatch<SetStateAction<number>>;
} | null;

const MapContext = createContext<MapContextValue>(null);

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
  const [mapPaddingLeft, setMapPaddingLeft] = useState(0);

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
        mapPaddingLeft,
        setMapPaddingLeft,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): MapContextValue {
  return useContext(MapContext);
}
