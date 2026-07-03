'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import type { BoundaryEmdSelection, DrawTool, ParcelModalStep } from './parcelAnalysisTypes';
import { cloneBoundarySelection } from './parcelAnalysisTypes';
import { useParcelAnalysisArea } from './useParcelAnalysisArea';
import { useParcelAnalysisMapZoom } from './useParcelAnalysisMapZoom';
import { ALL_PARCEL_ITEM_IDS } from './parcelAnalysisItems';
import { useMapContext } from '../../_mapComponents/MapContext';
import { canStartMapDrawInteraction } from '../../_mapComponents/mapDrawInteraction';

export const PARCEL_ANALYSIS_OPENED_KEY = 'parcelAnalysis';

const DEFAULT_SELECTED = new Set(ALL_PARCEL_ITEM_IDS);

/** 읍면동·리 경계 WKT(5181) 조회 — 실패 시 null */
async function fetchBoundaryWkt5181(
  action: 'getEmdGeometry' | 'getRiGeometry',
  params: Record<string, string>
): Promise<string | null> {
  try {
    const res = await call('', 'POST', { service: 'devTestService', action, params });
    const data = res?.data ?? res;
    return data?.wkt ? String(data.wkt) : null;
  } catch {
    return null;
  }
}

/** 여러 경계 WKT를 하나로 합침(5181) — 실패 시 null */
async function fetchUnionWkt5181(wkts: string[]): Promise<string | null> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'unionWkts5181',
      params: { wkts },
    });
    const data = res?.data ?? res;
    return data?.wkt ? String(data.wkt) : null;
  } catch {
    return null;
  }
}

type ParcelAnalysisContextValue = {
  isOpen: boolean;
  area: ReturnType<typeof useParcelAnalysisArea>['area'];
  sidePanelOpen: boolean;
  /** 영역 확정 후 패널을 유지 (초기화해도 레이아웃 유지) */
  panelEngaged: boolean;
  modalOpen: boolean;
  modalStep: ParcelModalStep;
  boundaryDraft: BoundaryEmdSelection[];
  boundarySessionDraft: BoundaryEmdSelection[];
  setBoundarySessionDraft: (selection: BoundaryEmdSelection[]) => void;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  analyzing: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  setModalStep: (step: ParcelModalStep) => void;
  exitParcelAnalysis: () => void;
  closeAreaModal: () => void;
  openChangeAreaModal: () => void;
  startDraw: (tool: DrawTool) => void;
  cancelDraw: () => void;
  redrawShape: () => void;
  confirmDraw: () => void;
  drawTool: DrawTool | null;
  drawPhase: 'drawing' | 'editing';
  setDrawPhase: (phase: 'drawing' | 'editing') => void;
  drawWktRef: MutableRefObject<string | null>;
  handleApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  applyingArea: boolean;
  resetArea: () => void;
  handleAnalyze: () => void;
};

const ParcelAnalysisContext = createContext<ParcelAnalysisContextValue | null>(null);

export function ParcelAnalysisProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();

  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) ?? [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const isOpen = openedWindows.includes(PARCEL_ANALYSIS_OPENED_KEY);

  const {
    area,
    boundaryDraft,
    applyDrawArea,
    applyBoundaryArea,
    clearArea,
    setBoundaryDraft,
  } = useParcelAnalysisArea();
  const { fitProjectEmdExtent, resetZoomFlag } = useParcelAnalysisMapZoom();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ParcelModalStep>('choose');
  const [boundarySessionDraft, setBoundarySessionDraftState] = useState<BoundaryEmdSelection[]>([]);
  const setBoundarySessionDraft = useCallback((selection: BoundaryEmdSelection[]) => {
    setBoundarySessionDraftState(cloneBoundarySelection(selection));
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED));
  const [analyzing, setAnalyzing] = useState(false);
  const [panelEngaged, setPanelEngaged] = useState(false);
  const [applyingArea, setApplyingArea] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [drawPhase, setDrawPhase] = useState<'drawing' | 'editing'>('drawing');
  const drawWktRef = useRef<string | null>(null);

  const sidePanelOpen = panelEngaged;

  const exitParcelAnalysis = useCallback(() => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.delete('opened');
    router.push(`/map?${current.toString()}`);
  }, [router, searchParams]);

  const closeAreaModal = useCallback(() => {
    setModalOpen(false);
    setModalStep('choose');
  }, []);

  // 도구 선택 → 모달을 닫고 그리기 세션 시작(그리기 단계). 실제 Draw/Modify는 useParcelAnalysisDraw가 처리.
  const startDraw = useCallback(
    (tool: DrawTool) => {
      if (!mapContext) return;
      if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return;
      setModalOpen(false);
      drawWktRef.current = null;
      setDrawPhase('drawing');
      setDrawTool(tool);
    },
    [mapContext]
  );

  // 편집 단계에서 다시 그리기 → 그린 도형을 지우고 그리기 단계로
  const redrawShape = useCallback(() => {
    drawWktRef.current = null;
    setDrawPhase('drawing');
  }, []);

  // 그리기/편집 취소 → 세션 종료 후 도형선택 화면으로 복귀(도구 미선택 상태)
  const cancelDraw = useCallback(() => {
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    setModalStep('draw');
    setModalOpen(true);
  }, []);

  // 편집한 도형을 확정 → 5181 WKT로 영역 확정, 패널 오픈
  const confirmDraw = useCallback(() => {
    const wkt = drawWktRef.current;
    if (!wkt) {
      window.alert('그린 도형이 없습니다. 지도에 도형을 그려 주세요.');
      return;
    }
    applyDrawArea(wkt);
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    setPanelEngaged(true);
    setModalOpen(false);
    setModalStep('choose');
  }, [applyDrawArea]);

  const handleApplyBoundary = useCallback(
    async (selection: BoundaryEmdSelection[]) => {
      const cloned = cloneBoundarySelection(selection);
      setApplyingArea(true);
      try {
        const wkts: string[] = [];
        for (const sel of cloned) {
          if (sel.allRi) {
            const wkt = await fetchBoundaryWkt5181('getEmdGeometry', { emdCode: sel.emdCode });
            if (wkt) wkts.push(wkt);
          } else {
            for (const riCode of sel.riCodes) {
              const wkt = await fetchBoundaryWkt5181('getRiGeometry', { riCode });
              if (wkt) wkts.push(wkt);
            }
          }
        }
        if (wkts.length === 0) {
          window.alert('선택한 행정경계의 경계 정보를 가져오지 못했습니다.');
          return;
        }
        let unionWkt = wkts[0];
        if (wkts.length > 1) {
          const merged = await fetchUnionWkt5181(wkts);
          if (merged) unionWkt = merged;
        }
        applyBoundaryArea(cloned, unionWkt);
        setBoundarySessionDraft(cloned);
        setPanelEngaged(true);
        setModalOpen(false);
        setModalStep('choose');
      } finally {
        setApplyingArea(false);
      }
    },
    [applyBoundaryArea, setBoundarySessionDraft]
  );

  const openChangeAreaModal = useCallback(() => {
    if (area == null) {
      setBoundarySessionDraft([]);
      setModalStep('choose');
      setModalOpen(true);
      return;
    }

    if (area.method === 'boundary' && boundaryDraft.length > 0) {
      setBoundarySessionDraft(cloneBoundarySelection(boundaryDraft));
      setModalStep('boundary');
    } else if (area.method === 'draw') {
      setModalStep('draw');
    } else {
      setModalStep('choose');
    }
    setModalOpen(true);
  }, [area, boundaryDraft, setBoundarySessionDraft]);

  // 재설정: 확정 영역을 비우고 곧바로 영역 지정 모달을 다시 연다.
  const resetArea = useCallback(() => {
    clearArea();
    setBoundaryDraft([]);
    setBoundarySessionDraft([]);
    setDrawerOpen(false);
    setDrawTool(null);
    drawWktRef.current = null;
    setModalStep('choose');
    setModalOpen(true);
  }, [clearArea, setBoundaryDraft, setBoundarySessionDraft]);

  const handleAnalyze = useCallback(() => {
    setAnalyzing(true);
    window.setTimeout(() => {
      setAnalyzing(false);
      setDrawerOpen(true);
    }, 400);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setModalOpen(true);
    setModalStep('choose');
    setBoundarySessionDraft([]);
    setPanelEngaged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 시 1회
  }, [isOpen]);

  // 진입 시 1회만 사업 시군구를 기준 배율로 확대(zoomedRef 가드 — 진입/종료 시에만 리셋).
  // 취소·다시 그리기·변경/재지정으로 모달을 다시 열어도 현재 지도(확대 상태)를 유지한다.
  useEffect(() => {
    if (!isOpen || !modalOpen) return;
    if (area != null) return;
    void fitProjectEmdExtent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 모달 열림·영역 상태 변화 시
  }, [isOpen, modalOpen, area]);

  // 영역 지정 모달이 다시 열리면(그리기 세션 밖) 진행 중이던 그리기 세션 종료
  useEffect(() => {
    if (!isOpen) return;
    if (modalOpen && drawTool) {
      setDrawTool(null);
      drawWktRef.current = null;
    }
  }, [isOpen, modalOpen, drawTool]);

  useEffect(() => {
    if (isOpen) return;
    clearArea();
    setModalOpen(false);
    setModalStep('choose');
    setBoundarySessionDraft([]);
    setPanelEngaged(false);
    setDrawerOpen(false);
    setSelectedIds(new Set(DEFAULT_SELECTED));
    setAnalyzing(false);
    setApplyingArea(false);
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    resetZoomFlag();
  }, [isOpen, clearArea, resetZoomFlag]);

  const value = useMemo<ParcelAnalysisContextValue>(
    () => ({
      isOpen,
      area,
      sidePanelOpen,
      panelEngaged,
      modalOpen,
      modalStep,
      boundaryDraft,
      boundarySessionDraft,
      setBoundarySessionDraft,
      selectedIds,
      setSelectedIds,
      analyzing,
      drawerOpen,
      setDrawerOpen,
      setModalStep,
      exitParcelAnalysis,
      closeAreaModal,
      openChangeAreaModal,
      startDraw,
      cancelDraw,
      redrawShape,
      confirmDraw,
      drawTool,
      drawPhase,
      setDrawPhase,
      drawWktRef,
      handleApplyBoundary,
      applyingArea,
      resetArea,
      handleAnalyze,
    }),
    [
      isOpen,
      area,
      sidePanelOpen,
      panelEngaged,
      modalOpen,
      modalStep,
      boundaryDraft,
      boundarySessionDraft,
      selectedIds,
      analyzing,
      drawerOpen,
      exitParcelAnalysis,
      closeAreaModal,
      openChangeAreaModal,
      startDraw,
      cancelDraw,
      redrawShape,
      confirmDraw,
      drawTool,
      drawPhase,
      handleApplyBoundary,
      applyingArea,
      resetArea,
      handleAnalyze,
    ]
  );

  return <ParcelAnalysisContext.Provider value={value}>{children}</ParcelAnalysisContext.Provider>;
}

export function useParcelAnalysis() {
  const ctx = useContext(ParcelAnalysisContext);
  if (!ctx) {
    throw new Error('useParcelAnalysis must be used within ParcelAnalysisProvider');
  }
  return ctx;
}
