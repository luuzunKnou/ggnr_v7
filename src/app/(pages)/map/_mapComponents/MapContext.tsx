'use client';

import React, { createContext, useContext, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type Map from 'ol/Map';

export type SelectedDetail = {
  layerName: string;
  tableName: string;
  row: Record<string, unknown>;
  fields: { define_field_name?: string; define_field_kor_name?: string }[];
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
  complaintDetail: ComplaintDetail;
  setComplaintDetail: Dispatch<SetStateAction<ComplaintDetail>>;
} | null;

const MapContext = createContext<MapContextValue>(null);

export function MapContextProvider({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<Map | null>(null);
  const [showDebugUi, setShowDebugUi] = useState(false);
  const [visibleLayerNames, setVisibleLayerNames] = useState<Set<string>>(() => new Set());
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail>(null);
  const [complaintDetail, setComplaintDetail] = useState<ComplaintDetail>(null);
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
        complaintDetail,
        setComplaintDetail,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext(): MapContextValue {
  return useContext(MapContext);
}
