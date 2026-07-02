'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BoundaryEmdSelection, ParcelModalStep } from './parcelAnalysisTypes';
import { cloneBoundarySelection } from './parcelAnalysisTypes';
import { useParcelAnalysisArea } from './useParcelAnalysisArea';
import { useParcelAnalysisMapZoom } from './useParcelAnalysisMapZoom';
import { ALL_PARCEL_ITEM_IDS } from './parcelAnalysisItems';

export const PARCEL_ANALYSIS_OPENED_KEY = 'parcelAnalysis';

const DEFAULT_SELECTED = new Set(ALL_PARCEL_ITEM_IDS);

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
  handleApplyDraw: () => void;
  handleApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  clearConfirmedArea: () => void;
  handleAnalyze: () => void;
};

const ParcelAnalysisContext = createContext<ParcelAnalysisContextValue | null>(null);

export function ParcelAnalysisProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) ?? [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const isOpen = openedWindows.includes(PARCEL_ANALYSIS_OPENED_KEY);

  const {
    area,
    boundaryDraft,
    applyMockDraw,
    applyMockBoundary,
    clearArea,
    setBoundaryDraft,
  } = useParcelAnalysisArea();
  const { resetZoomFlag } = useParcelAnalysisMapZoom();

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

  const handleApplyDraw = useCallback(() => {
    applyMockDraw();
    setPanelEngaged(true);
    setModalOpen(false);
    setModalStep('choose');
  }, [applyMockDraw]);

  const handleApplyBoundary = useCallback(
    (selection: BoundaryEmdSelection[]) => {
      const cloned = cloneBoundarySelection(selection);
      setBoundaryDraft(cloned);
      setBoundarySessionDraft(cloned);
      applyMockBoundary(selection);
      setPanelEngaged(true);
      setModalOpen(false);
      setModalStep('choose');
    },
    [applyMockBoundary, setBoundaryDraft, setBoundarySessionDraft]
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

  const clearConfirmedArea = useCallback(() => {
    clearArea();
    setBoundaryDraft([]);
    setBoundarySessionDraft([]);
    setDrawerOpen(false);
    setModalOpen(false);
    setModalStep('choose');
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
    // TODO(S1): 시군구가 뷰포트 80% 차도록 fit — 2차에서 재구현
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 시 1회
  }, [isOpen]);

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
      handleApplyDraw,
      handleApplyBoundary,
      clearConfirmedArea,
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
      handleApplyDraw,
      handleApplyBoundary,
      clearConfirmedArea,
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
