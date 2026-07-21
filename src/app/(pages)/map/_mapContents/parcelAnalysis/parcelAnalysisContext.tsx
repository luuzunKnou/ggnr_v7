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
import { toParcelAnalyzeUserError } from '@/lib/parcelAnalyzeUserError';
import type { BoundaryEmdSelection, DrawProjectScope, DrawTool, EmdRiOption, ParcelModalStep } from './parcelAnalysis.types';
import { cloneBoundarySelection } from './parcelAnalysis.types';
import {
  useParcelAnalysisArea,
  useParcelAnalysisMapZoom,
  type DrawToolbarMapAnchor,
} from './ParcelAnalysis.area';
import { STATIC_PARCEL_ITEM_IDS, type ParcelAnalysisGroupDef, useParcelAnalysisGroups } from './ParcelAnalysis.items';
import {
  buildParcelAnalysisResult,
  runParcelAnalysisProgressiveLoad,
  type AnalyzeExtendedResponse,
  type ParcelAnalysisResult,
} from './parcelAnalysis.result';
import { useParcelAnalysisBoundaryCatalog } from './ParcelAnalysis.boundary';
import {
  buildLargeAreaConfirmMessage,
  delayForMinElapsed,
  isLargeParcelAnalysisArea,
  PARCEL_ANALYZE_MIN_SPINNER_MS,
} from './parcelAnalysis.types';
import { useMapContext } from '../../_mapComponents/MapContext';
import { canStartMapDrawInteraction } from '../../_mapComponents/mapDrawInteraction';

export const PARCEL_ANALYSIS_OPENED_KEY = 'parcelAnalysis';

const DEFAULT_SELECTED = new Set(STATIC_PARCEL_ITEM_IDS);

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

type DrawEmdLookup = { names: string[]; projectScope: DrawProjectScope };

/** 편집 단계(적용 전) 도형의 구역 이탈·대상 미리보기 */
type DrawPreview = { wkt: string; projectScope: DrawProjectScope; label: string };

/** 그린 도형과 겹치는 읍/면/동·사업 구역 위치 조회 */
async function fetchDrawEmdLookup(wkt: string): Promise<DrawEmdLookup> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdNamesByWkt',
      params: { wkt },
    });
    const data = res?.data ?? res;
    const names = Array.isArray(data?.names) ? data.names.map((n: unknown) => String(n)).filter(Boolean) : [];
    const rawScope = String(data?.projectScope ?? 'inside');
    const projectScope: DrawProjectScope =
      rawScope === 'fully_outside' || rawScope === 'partially_outside' ? rawScope : 'inside';
    return { names, projectScope };
  } catch {
    return { names: [], projectScope: 'inside' };
  }
}

/** 겹치는 읍/면/동·구역 위치 → «대상» 라벨 */
function formatDrawTargetLabel(names: string[], projectScope: DrawProjectScope): string {
  if (projectScope === 'fully_outside') return '분석 영역 밖';
  if (names.length === 0) return '직접 그린 영역';
  if (names.length === 1) return `${names[0]} (일부)`;
  return `${names[0]} 외 ${names.length - 1}곳 (일부)`;
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
  cancelAnalyze: () => void;
  enriching: boolean;
  result: ParcelAnalysisResult | null;
  analyzeError: string | null;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  closeResultDrawer: (options?: { force?: boolean }) => void;
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
  /** 편집 단계에서 도형 구역 이탈 여부 미리 조회 (drawend·modifyend) */
  previewDrawArea: (wkt: string) => void;
  drawPreview: DrawPreview | null;
  drawPreviewLoading: boolean;
  /** 편집 단계 플로팅 바 앵커 (도형 bbox 상단 중앙, EPSG:3857) */
  drawToolbarAnchor: DrawToolbarMapAnchor | null;
  setDrawToolbarAnchor: (anchor: DrawToolbarMapAnchor | null) => void;
  clearDrawToolbarAnchor: () => void;
  handleApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  applyingArea: boolean;
  resetArea: () => void;
  handleAnalyze: () => void;
  analysisGroups: ParcelAnalysisGroupDef[];
  facilityCatalogLoaded: boolean;
  facilityLayerMap: Record<
    string,
    Array<{ layerKey: string; layerKorName: string; geomType: string; schema: string }>
  >;
  facilityWmsLayerMap: Record<string, string[]>;
  mapCaptureConfig: { geoserverUrl: string; workspace: string };
  boundaryEmdOptions: EmdRiOption[];
  boundaryEmdLoading: boolean;
  boundaryEmdError: string | null;
  reloadBoundaryEmd: () => void;
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
    setDrawAreaLookup,
    applyBoundaryArea,
    clearArea,
    setBoundaryDraft,
  } = useParcelAnalysisArea();
  const { fitProjectEmdExtent, resetZoomFlag } = useParcelAnalysisMapZoom();
  const { groups: analysisGroups, allItemIds, facilityLayerMap, facilityWmsLayerMap, catalogLoaded } =
    useParcelAnalysisGroups(isOpen);

  const [mapCaptureConfig, setMapCaptureConfig] = useState({
    geoserverUrl: 'http://localhost:8080/geoserver',
    workspace: 'ggnr',
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ParcelModalStep>('choose');
  const [boundarySessionDraft, setBoundarySessionDraftState] = useState<BoundaryEmdSelection[]>([]);
  const setBoundarySessionDraft = useCallback((selection: BoundaryEmdSelection[]) => {
    setBoundarySessionDraftState(cloneBoundarySelection(selection));
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED));
  const [analyzing, setAnalyzing] = useState(false);
  const {
    emdOptions: boundaryEmdOptions,
    emdLoading: boundaryEmdLoading,
    emdError: boundaryEmdError,
    reloadEmdOptions: reloadBoundaryEmd,
    syncEmdFromCache: syncBoundaryEmdFromCache,
  } = useParcelAnalysisBoundaryCatalog(isOpen);
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<ParcelAnalysisResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [panelEngaged, setPanelEngaged] = useState(false);
  const [applyingArea, setApplyingArea] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [drawPhase, setDrawPhase] = useState<'drawing' | 'editing'>('drawing');
  const drawWktRef = useRef<string | null>(null);
  const [drawPreview, setDrawPreview] = useState<DrawPreview | null>(null);
  const [drawPreviewLoading, setDrawPreviewLoading] = useState(false);
  const [drawToolbarAnchor, setDrawToolbarAnchorState] = useState<DrawToolbarMapAnchor | null>(null);
  const drawPreviewSeqRef = useRef(0);
  const analyzeRunIdRef = useRef(0);
  const analyzingRunIdRef = useRef<number | null>(null);
  /** 웨일·OS 캡쳐(Alt+1~3 등) 직후 브라우저가 보내는 닫힘 이벤트 차단 */
  const suppressResultCloseUntilRef = useRef(0);

  const sidePanelOpen = isOpen;

  const armResultCloseSuppress = useCallback((ms = 5000) => {
    suppressResultCloseUntilRef.current = Date.now() + ms;
  }, []);

  const finishAnalyzingRun = useCallback((runId: number) => {
    if (analyzingRunIdRef.current === runId) {
      analyzingRunIdRef.current = null;
      setAnalyzing(false);
    }
  }, []);

  const closeResultDrawer = useCallback((options?: { force?: boolean }) => {
    if (!options?.force && Date.now() < suppressResultCloseUntilRef.current) return;
    analyzeRunIdRef.current += 1;
    setEnriching(false);
    setDrawerOpen(false);
  }, []);

  // 결과 모달 열림 중 캡쳐 단축키·창 blur 시 자동 닫힘 억제 (단축키가 페이지에 안 와도 blur로 arm)
  useEffect(() => {
    if (!drawerOpen) return;

    const arm = () => armResultCloseSuppress();

    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.key === 'Alt' ||
        event.key === 'PrintScreen' ||
        (event.ctrlKey && event.shiftKey) ||
        event.key === 'Control' ||
        event.key === 'Shift'
      ) {
        arm();
      }
    };

    const onVisibility = () => {
      if (document.hidden) arm();
    };

    window.addEventListener('keydown', onKeyDownCapture, true);
    window.addEventListener('blur', arm);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true);
      window.removeEventListener('blur', arm);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [drawerOpen, armResultCloseSuppress]);

  const exitParcelAnalysis = useCallback(() => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const raw = current.get('opened')?.split(',').filter(Boolean) ?? [];
    const next = raw.filter((w) => w !== PARCEL_ANALYSIS_OPENED_KEY);
    if (next.length > 0) current.set('opened', next.join(','));
    else current.delete('opened');
    setModalOpen(false);
    router.push(`/map?${current.toString()}`);
  }, [router, searchParams]);

  const closeAreaModal = useCallback(() => {
    setModalOpen(false);
    setModalStep('choose');
  }, []);

  // 편집 단계 도형의 구역 이탈·대상 미리 조회 (최신 요청만 반영)
  const clearDrawPreview = useCallback(() => {
    drawPreviewSeqRef.current += 1;
    setDrawPreview(null);
    setDrawPreviewLoading(false);
  }, []);

  const clearDrawToolbarAnchor = useCallback(() => {
    setDrawToolbarAnchorState(null);
  }, []);

  const setDrawToolbarAnchor = useCallback((anchor: DrawToolbarMapAnchor | null) => {
    setDrawToolbarAnchorState(anchor);
  }, []);

  const previewDrawArea = useCallback((wkt: string) => {
    const seq = ++drawPreviewSeqRef.current;
    setDrawPreviewLoading(true);
    void (async () => {
      const { names, projectScope } = await fetchDrawEmdLookup(wkt);
      if (drawPreviewSeqRef.current !== seq) return; // 더 최신 편집이 있으면 무시
      setDrawPreview({ wkt, projectScope, label: formatDrawTargetLabel(names, projectScope) });
      setDrawPreviewLoading(false);
    })();
  }, []);

  // 도구 선택 → 모달을 닫고 그리기 세션 시작(그리기 단계). 실제 Draw/Modify는 useParcelAnalysisDraw가 처리.
  const startDraw = useCallback(
    (tool: DrawTool) => {
      if (!mapContext) return;
      if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return;
      setModalOpen(false);
      drawWktRef.current = null;
      clearDrawPreview();
      clearDrawToolbarAnchor();
      setDrawPhase('drawing');
      setDrawTool(tool);
    },
    [mapContext, clearDrawPreview, clearDrawToolbarAnchor]
  );

  // 편집 단계에서 다시 그리기 → 그린 도형을 지우고 그리기 단계로
  const redrawShape = useCallback(() => {
    drawWktRef.current = null;
    clearDrawPreview();
    clearDrawToolbarAnchor();
    setDrawPhase('drawing');
  }, [clearDrawPreview, clearDrawToolbarAnchor]);

  // 그리기/편집 취소 → 세션 종료 후 도형선택 화면으로 복귀(도구 미선택 상태)
  const cancelDraw = useCallback(() => {
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    clearDrawPreview();
    clearDrawToolbarAnchor();
    setModalStep('draw');
    setModalOpen(true);
  }, [clearDrawPreview, clearDrawToolbarAnchor]);

  // 편집한 도형을 확정 → 5181 WKT로 영역 확정, 패널 오픈
  const confirmDraw = useCallback(() => {
    const wkt = drawWktRef.current;
    if (!wkt) {
      window.alert('그린 도형이 없습니다. 지도에 도형을 그려 주세요.');
      return;
    }
    applyDrawArea(wkt);
    // 편집 단계에서 이미 조회한 미리보기가 있으면 재사용, 없으면 비동기 조회
    if (drawPreview && drawPreview.wkt === wkt) {
      setDrawAreaLookup(wkt, drawPreview.label, drawPreview.projectScope);
    } else {
      void (async () => {
        const { names, projectScope } = await fetchDrawEmdLookup(wkt);
        setDrawAreaLookup(wkt, formatDrawTargetLabel(names, projectScope), projectScope);
      })();
    }
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    clearDrawPreview();
    clearDrawToolbarAnchor();
    setPanelEngaged(true);
    setModalOpen(false);
    setModalStep('choose');
  }, [applyDrawArea, setDrawAreaLookup, drawPreview, clearDrawPreview, clearDrawToolbarAnchor]);

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
    setDrawerOpen(false);
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

  const cancelAnalyze = useCallback(() => {
    analyzeRunIdRef.current += 1;
    analyzingRunIdRef.current = null;
    setAnalyzing(false);
    setEnriching(false);
  }, []);

  // 재설정: 확정 영역을 비우고 곧바로 영역 지정 모달을 다시 연다.
  const resetArea = useCallback(() => {
    cancelAnalyze();
    clearArea();
    setBoundaryDraft([]);
    setBoundarySessionDraft([]);
    setDrawerOpen(false);
    setDrawTool(null);
    drawWktRef.current = null;
    setModalStep('choose');
    setModalOpen(true);
    syncBoundaryEmdFromCache();
  }, [clearArea, setBoundaryDraft, setBoundarySessionDraft, cancelAnalyze, syncBoundaryEmdFromCache]);

  const handleAnalyze = useCallback(async () => {
    if (drawTool != null) {
      window.alert('도형을 적용한 뒤 분석하세요.');
      return;
    }
    if (!area?.wkt) {
      window.alert('분석 영역을 먼저 지정하세요.');
      return;
    }
    if (isLargeParcelAnalysisArea(area)) {
      const proceed = window.confirm(buildLargeAreaConfirmMessage(area));
      if (!proceed) return;
    }

    const runId = ++analyzeRunIdRef.current;
    const analyzeStartedAt = Date.now();

    setDrawerOpen(false);
    analyzingRunIdRef.current = runId;
    setAnalyzing(true);
    setEnriching(false);
    setAnalyzeError(null);
    const itemCount = selectedIds.size;
    let baseData: AnalyzeExtendedResponse | undefined;
    let openDrawer = false;

    try {
      const res = await call('', 'POST', {
        service: 'mapAnalyseService',
        action: 'analyzeParcels',
        params: { wkt5181: area.wkt },
      });
      if (runId !== analyzeRunIdRef.current) return;

      baseData = (res?.data ?? res) as AnalyzeExtendedResponse | undefined;
      if (!baseData || baseData.ok === false) {
        setAnalyzeError(toParcelAnalyzeUserError(baseData?.error || '분석 결과를 가져오지 못했습니다.'));
        setResult(buildParcelAnalysisResult(null, itemCount));
      } else {
        baseData = { ...baseData, wkt5181: area.wkt };
        setResult(buildParcelAnalysisResult(baseData, itemCount));
      }
      openDrawer = true;
    } catch {
      if (runId !== analyzeRunIdRef.current) return;

      setAnalyzeError('분석 요청 중 오류가 발생했습니다.');
      setResult(buildParcelAnalysisResult(null, itemCount));
      openDrawer = true;
    } finally {
      await delayForMinElapsed(analyzeStartedAt, PARCEL_ANALYZE_MIN_SPINNER_MS);
      finishAnalyzingRun(runId);
      if (runId === analyzeRunIdRef.current && openDrawer) {
        setDrawerOpen(true);
      }
    }

    if (runId !== analyzeRunIdRef.current || !baseData?.ok) return;

    const totalCount = Number(baseData.parcelCount ?? 0) || 0;
    const totalAreaSqm = Number(baseData.totalAreaSqm ?? 0) || 0;
    const needsLandRowPages =
      selectedIds.has('parcel:land') ||
      selectedIds.has('parcel:owner') ||
      selectedIds.has('parcel:jimok') ||
      selectedIds.has('building:ledger') ||
      selectedIds.has('parcel:landUse');
    let current: AnalyzeExtendedResponse = {
      ...baseData,
      wkt5181: area.wkt,
      landRows: [],
      landRowsProgress:
        needsLandRowPages && totalCount > 0
          ? { loaded: 0, total: totalCount, loading: true }
          : undefined,
    };
    setResult(buildParcelAnalysisResult(current, itemCount));

    const applyPatch = (patch: Partial<AnalyzeExtendedResponse>) => {
      if (runId !== analyzeRunIdRef.current) return;
      current = { ...current, ...patch };
      setResult(buildParcelAnalysisResult(current, itemCount));
    };

    await runParcelAnalysisProgressiveLoad({
        runId,
        isCancelled: () => runId !== analyzeRunIdRef.current,
        wkt5181: area.wkt,
        totalCount,
        totalAreaSqm,
        selectedIds,
        facilityLayerMap,
        onPatch: applyPatch,
        onEnriching: (active) => {
          if (runId === analyzeRunIdRef.current) setEnriching(active);
        },
      });
  }, [area, selectedIds, facilityLayerMap, drawTool]);

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getParcelAnalysisMapConfig',
          params: {},
        });
        const data = (res?.data ?? res) as { geoserverUrl?: string; workspace?: string } | undefined;
        if (data?.geoserverUrl && data?.workspace) {
          setMapCaptureConfig({
            geoserverUrl: data.geoserverUrl,
            workspace: data.workspace,
          });
        }
      } catch {
        /* 기본값 유지 */
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !catalogLoaded) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of allItemIds) next.add(id);
      return next;
    });
  }, [isOpen, catalogLoaded, allItemIds]);

  useEffect(() => {
    if (!isOpen) return;
    setModalOpen(true);
    setModalStep('choose');
    setBoundarySessionDraft([]);
    setPanelEngaged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 시 1회
  }, [isOpen]);

  // 행정경계 단계 진입 시 캐시에서 즉시 복원
  useEffect(() => {
    if (!isOpen || modalStep !== 'boundary') return;
    syncBoundaryEmdFromCache();
  }, [isOpen, modalStep, syncBoundaryEmdFromCache]);

  // 진입 시 1회만 사업 시군구를 기준 배율로 확대
  // 취소·다시 그리기·변경/재지정으로 모달을 다시 열어도 현재 지도(확대 상태)를 유지한다.
  useEffect(() => {
    if (!isOpen || !modalOpen) return;
    if (area != null) return;
    if (boundaryEmdLoading) return;
    void fitProjectEmdExtent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 모달 열림·영역·목록 로딩 상태 변화 시
  }, [isOpen, modalOpen, area, boundaryEmdLoading]);

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
    cancelAnalyze();
    clearArea();
    setModalOpen(false);
    setModalStep('choose');
    setBoundarySessionDraft([]);
    setPanelEngaged(false);
    setDrawerOpen(false);
    setSelectedIds(new Set(DEFAULT_SELECTED));
    setAnalyzing(false);
    setEnriching(false);
    setResult(null);
    setAnalyzeError(null);
    setApplyingArea(false);
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    resetZoomFlag();
  }, [isOpen, clearArea, resetZoomFlag, cancelAnalyze]);

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
      cancelAnalyze,
      enriching,
      result,
      analyzeError,
      drawerOpen,
      setDrawerOpen,
      closeResultDrawer,
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
      previewDrawArea,
      drawPreview,
      drawPreviewLoading,
      drawToolbarAnchor,
      setDrawToolbarAnchor,
      clearDrawToolbarAnchor,
      handleApplyBoundary,
      applyingArea,
      resetArea,
      handleAnalyze,
      analysisGroups,
      facilityCatalogLoaded: catalogLoaded,
      facilityLayerMap,
      facilityWmsLayerMap,
      mapCaptureConfig,
      boundaryEmdOptions,
      boundaryEmdLoading,
      boundaryEmdError,
      reloadBoundaryEmd,
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
      cancelAnalyze,
      enriching,
      result,
      analyzeError,
      drawerOpen,
      closeResultDrawer,
      exitParcelAnalysis,
      closeAreaModal,
      openChangeAreaModal,
      startDraw,
      cancelDraw,
      redrawShape,
      confirmDraw,
      drawTool,
      drawPhase,
      previewDrawArea,
      drawPreview,
      drawPreviewLoading,
      drawToolbarAnchor,
      setDrawToolbarAnchor,
      clearDrawToolbarAnchor,
      handleApplyBoundary,
      applyingArea,
      resetArea,
      handleAnalyze,
      analysisGroups,
      catalogLoaded,
      facilityLayerMap,
      facilityWmsLayerMap,
      mapCaptureConfig,
      boundaryEmdOptions,
      boundaryEmdLoading,
      boundaryEmdError,
      reloadBoundaryEmd,
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
