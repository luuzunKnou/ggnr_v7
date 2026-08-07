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
import { useMapContext } from '../../_mapComponents/MapContext';
import { canStartMapDrawInteraction } from '../../_mapComponents/mapDrawInteraction';
import {
  cloneBoundarySelection,
  computeAreaSqmFromWkt5181,
  formatAreaSqm,
  formatBoundaryAreaSummary,
  useParcelAnalysisBoundaryCatalog,
  useParcelAnalysisMapZoom,
  type BoundaryEmdSelection,
} from '../../_mapComponents/analysisArea';
import {
  buildLargeAreaConfirmMessage,
  isLargeParcelAnalysisArea,
} from '../parcelAnalysis/parcelAnalysis.types';
import { DEFAULT_HISTORY_DATE } from './changeHistory.timeline';
import {
  CHANGE_HISTORY_OPENED_KEY,
  type ChangeHistoryArea,
  type ChangeHistoryDrawTool,
  type ChangeHistoryLayerGroup,
  type ChangeHistoryModalStep,
} from './changeHistory.types';

export type ChangeHistoryDrawToolbarAnchor = {
  topCenter: [number, number];
};

type ChangeHistoryContextValue = {
  isOpen: boolean;
  sidePanelOpen: boolean;
  panelEngaged: boolean;
  area: ChangeHistoryArea | null;
  modalOpen: boolean;
  modalStep: ChangeHistoryModalStep;
  setModalStep: (step: ChangeHistoryModalStep) => void;
  boundarySessionDraft: BoundaryEmdSelection[];
  setBoundarySessionDraft: (selection: BoundaryEmdSelection[]) => void;
  boundaryEmdOptions: ReturnType<typeof useParcelAnalysisBoundaryCatalog>['emdOptions'];
  boundaryEmdLoading: boolean;
  boundaryEmdError: string | null;
  reloadBoundaryEmd: () => void;
  applyingArea: boolean;
  drawTool: ChangeHistoryDrawTool | null;
  drawPhase: 'drawing' | 'editing';
  setDrawPhase: (phase: 'drawing' | 'editing') => void;
  drawWktRef: MutableRefObject<string | null>;
  drawToolbarAnchor: ChangeHistoryDrawToolbarAnchor | null;
  setDrawToolbarAnchor: (anchor: ChangeHistoryDrawToolbarAnchor | null) => void;
  clearDrawToolbarAnchor: () => void;
  /** 데이터조회와 동일 레이어 그룹 (기본도 그룹 제외) */
  layerGroups: ChangeHistoryLayerGroup[];
  layersLoaded: boolean;
  layerIds: Set<string>;
  setLayerIds: (ids: Set<string>) => void;
  resultOpen: boolean;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  openChangeAreaModal: () => void;
  closeAreaModal: () => void;
  startDraw: (tool: ChangeHistoryDrawTool) => void;
  cancelDraw: () => void;
  redrawShape: () => void;
  confirmDraw: () => void;
  handleApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  resetArea: () => void;
  openResult: () => void;
  closeResult: () => void;
  closeMode: () => void;
};

const ChangeHistoryContext = createContext<ChangeHistoryContextValue | null>(null);

function useOpenedIncludes(key: string): boolean {
  const searchParams = useSearchParams();
  const raw = searchParams.get('opened')?.split(',').filter(Boolean) ?? [];
  const opened = raw.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  return opened.includes(key);
}

function defaultSelectedDate() {
  return DEFAULT_HISTORY_DATE;
}

/** 배경 정사는 기본 포함 — 목록에서 「기본도」 그룹은 숨김 */
const HIDDEN_LAYER_GROUPS = new Set(['기본도']);

type DefineTableMeta = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

/** 데이터조회(AttributeQueryUI)와 동일 소스로 레이어 그룹 구성 */
function useChangeHistoryLayerCatalog(isOpen: boolean) {
  const [groups, setGroups] = useState<ChangeHistoryLayerGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const dbPromise = call('', 'POST', {
      service: 'devTestService',
      action: 'getLayerTableList',
      params: {},
    });
    const metaPromise = fetch('/api/config/defineLayer').then((r) => r.json());

    Promise.all([dbPromise, metaPromise])
      .then(([dbRes, metaRes]) => {
        if (cancelled) return;
        const dbData = dbRes?.data ?? dbRes;
        const tables: { schema?: string; table: string }[] = Array.isArray(dbData?.tables)
          ? dbData.tables
          : [];
        const dbSet = new Set(
          tables
            .filter((t) => (t.schema || 'layer').toLowerCase() === 'layer')
            .map((t) => t.table.toLowerCase())
        );

        const metaArr: DefineTableMeta[] = Array.isArray(metaRes?.data) ? metaRes.data : [];
        const metaMap = new Map<string, DefineTableMeta>();
        for (const m of metaArr) {
          const name = String(m.define_table_name ?? '').trim().toLowerCase();
          if (name && (m.define_table_schema || 'layer').toLowerCase() === 'layer') {
            metaMap.set(name, m);
          }
        }

        type Item = ChangeHistoryLayerGroup['items'][number];
        const groupMap = new Map<string, Item[]>();
        const groupOrder: string[] = [];

        const parentTablesWithSplitDefs = new Set<string>();
        for (const m of metaArr) {
          if ((m.define_table_schema || 'layer').toLowerCase() !== 'layer') continue;
          const p = String(m.define_table_parents_layer ?? '').trim().toLowerCase();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (p && divQ) parentTablesWithSplitDefs.add(p);
        }

        const pushItem = (groupName: string, item: Item) => {
          if (HIDDEN_LAYER_GROUPS.has(groupName)) return;
          if (!groupMap.has(groupName)) {
            groupMap.set(groupName, []);
            groupOrder.push(groupName);
          }
          groupMap.get(groupName)!.push(item);
        };

        for (const tblName of dbSet) {
          if (parentTablesWithSplitDefs.has(tblName)) continue;
          const meta = metaMap.get(tblName);
          const groupName = meta?.define_table_group?.trim() || '기타';
          const korName = meta?.define_table_kor_name?.trim() || tblName;
          pushItem(groupName, {
            id: tblName,
            name: korName,
            tableName: tblName,
          });
        }

        for (const m of metaArr) {
          const schemaM = (m.define_table_schema || 'layer').toLowerCase();
          if (schemaM !== 'layer') continue;
          const eng = String(m.define_table_name ?? '').trim();
          if (!eng) continue;
          const engLower = eng.toLowerCase();
          const parent = String(m.define_table_parents_layer ?? '').trim();
          const divQ = String(m.define_table_div_query ?? '').trim();
          if (!parent || !divQ) continue;
          const parentLower = parent.toLowerCase();
          if (!dbSet.has(parentLower)) continue;
          if (dbSet.has(engLower)) continue;
          const groupName = String(m.define_table_group ?? '').trim() || '기타';
          const korName = String(m.define_table_kor_name ?? '').trim() || eng;
          pushItem(groupName, {
            id: engLower,
            name: korName,
            tableName: engLower,
          });
        }

        const next: ChangeHistoryLayerGroup[] = groupOrder
          .filter((gName) => !HIDDEN_LAYER_GROUPS.has(gName))
          .map((gName) => ({
            id: gName,
            title: gName,
            items: (groupMap.get(gName) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
          }))
          .filter((g) => g.items.length > 0);

        setGroups(next);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setGroups([]);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return {
    groups: isOpen ? groups : [],
    loaded: isOpen ? loaded : false,
  };
}

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

async function fetchDrawTargetLabel(wkt: string): Promise<string> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdNamesByWkt',
      params: { wkt },
    });
    const data = res?.data ?? res;
    const names = Array.isArray(data?.names)
      ? data.names.map((n: unknown) => String(n)).filter(Boolean)
      : [];
    if (names.length === 0) return '직접 그린 영역';
    if (names.length === 1) return `${names[0]} (일부)`;
    return `${names[0]} 외 ${names.length - 1}곳 (일부)`;
  } catch {
    return '직접 그린 영역';
  }
}

export function ChangeHistoryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const isOpen = useOpenedIncludes(CHANGE_HISTORY_OPENED_KEY);

  const [area, setArea] = useState<ChangeHistoryArea | null>(null);
  const [panelEngaged, setPanelEngaged] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ChangeHistoryModalStep>('choose');
  const [boundarySessionDraft, setBoundarySessionDraftState] = useState<BoundaryEmdSelection[]>([]);
  const [applyingArea, setApplyingArea] = useState(false);
  const [drawTool, setDrawTool] = useState<ChangeHistoryDrawTool | null>(null);
  const [drawPhase, setDrawPhase] = useState<'drawing' | 'editing'>('drawing');
  const drawWktRef = useRef<string | null>(null);
  const [drawToolbarAnchor, setDrawToolbarAnchorState] = useState<ChangeHistoryDrawToolbarAnchor | null>(
    null
  );
  const [resultOpen, setResultOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate());
  const [layerIds, setLayerIds] = useState<Set<string>>(() => new Set());

  const clearDrawToolbarAnchor = useCallback(() => {
    setDrawToolbarAnchorState(null);
  }, []);

  const setDrawToolbarAnchor = useCallback((anchor: ChangeHistoryDrawToolbarAnchor | null) => {
    setDrawToolbarAnchorState(anchor);
  }, []);

  const clearDrawSession = useCallback(() => {
    setDrawTool(null);
    setDrawPhase('drawing');
    drawWktRef.current = null;
    setDrawToolbarAnchorState(null);
  }, []);

  const { groups: layerGroups, loaded: layersLoaded } = useChangeHistoryLayerCatalog(isOpen);

  const {
    emdOptions: boundaryEmdOptions,
    emdLoading: boundaryEmdLoading,
    emdError: boundaryEmdError,
    reloadEmdOptions: reloadBoundaryEmd,
  } = useParcelAnalysisBoundaryCatalog(isOpen);

  const { fitProjectEmdExtent, resetZoomFlag } = useParcelAnalysisMapZoom();

  const setBoundarySessionDraft = useCallback((selection: BoundaryEmdSelection[]) => {
    setBoundarySessionDraftState(cloneBoundarySelection(selection));
  }, []);

  /** 메뉴 열림/닫힘 시 세션 (render 중 조정) */
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setArea(null);
      setPanelEngaged(false);
      setModalOpen(true);
      setModalStep('choose');
      setBoundarySessionDraftState([]);
      clearDrawSession();
      setResultOpen(false);
      setLayerIds(new Set());
      setSelectedDate(defaultSelectedDate());
      setApplyingArea(false);
    } else {
      setArea(null);
      setPanelEngaged(false);
      setModalOpen(false);
      setModalStep('choose');
      setBoundarySessionDraftState([]);
      clearDrawSession();
      setResultOpen(false);
      setLayerIds(new Set());
      setSelectedDate(defaultSelectedDate());
      setApplyingArea(false);
    }
  }

  /** 목록 갱신 시 존재하지 않는 선택 제거 — 선택은 표시 시 필터로 처리 */
  const validLayerIds = useMemo(
    () => new Set(layerGroups.flatMap((g) => g.items.map((i) => i.id))),
    [layerGroups]
  );
  const selectedLayerIds = useMemo(() => {
    const next = new Set<string>();
    for (const id of layerIds) {
      if (validLayerIds.has(id)) next.add(id);
    }
    return next;
  }, [layerIds, validLayerIds]);

  const setSelectedLayerIds = useCallback((ids: Set<string>) => {
    setLayerIds(ids);
  }, []);

  const sidePanelOpen = isOpen;

  /** 진입 시 영역 지정 모달 — URL에 이미 opened 있어도 필지분석과 동일하게 염 */
  useEffect(() => {
    if (!isOpen) return;
    setModalOpen(true);
    setModalStep('choose');
    setBoundarySessionDraftState([]);
    setPanelEngaged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 시 1회
  }, [isOpen]);

  /** 사이드바에서 메뉴만 끌 때 그리기 요청 잔존 방지 */
  useEffect(() => {
    if (isOpen) return;
    setSpatialDrawRequest?.(null);
    resetZoomFlag();
  }, [isOpen, setSpatialDrawRequest, resetZoomFlag]);

  /** 진입 시 1회 — 사업 시군구 범위로 지도 확대 (필지분석과 동일) */
  useEffect(() => {
    if (!isOpen || !modalOpen) return;
    if (area != null) return;
    if (boundaryEmdLoading) return;
    void fitProjectEmdExtent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 모달 재오픈 시 줌 유지
  }, [isOpen, modalOpen, area, boundaryEmdLoading]);

  const closeMode = useCallback(() => {
    setSpatialDrawRequest?.(null);
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const raw = current.get('opened')?.split(',').filter(Boolean) ?? [];
    const next = raw.filter((w) => w !== CHANGE_HISTORY_OPENED_KEY);
    if (next.length) current.set('opened', next.join(','));
    else current.delete('opened');
    router.push(`/map?${current.toString()}`);
  }, [router, searchParams, setSpatialDrawRequest]);

  const applyDrawArea = useCallback(async (wkt5181: string) => {
    const areaSqm = computeAreaSqmFromWkt5181(wkt5181);
    const targetLabel = await fetchDrawTargetLabel(wkt5181);
    setArea({
      method: 'draw',
      summaryLabel: `직접 그린 영역 · ${formatAreaSqm(areaSqm)}`,
      targetLabel,
      wkt: wkt5181,
      itemCount: 1,
      areaSqm,
    });
    setPanelEngaged(true);
    setModalOpen(false);
    setModalStep('choose');
    clearDrawSession();
    setResultOpen(false);
  }, [clearDrawSession]);

  const startDraw = useCallback(
    (tool: ChangeHistoryDrawTool) => {
      if (!mapContext) return;
      if (
        !canStartMapDrawInteraction(
          {
            measurementActive: mapContext.measurementActive,
            spatialDrawRequest: mapContext.spatialDrawRequest,
            layerRowGeomEdit: mapContext.layerRowGeomEdit,
          },
          'spatialSearch'
        )
      ) {
        return;
      }
      setSpatialDrawRequest?.(null);
      setModalOpen(false);
      drawWktRef.current = null;
      clearDrawToolbarAnchor();
      setDrawPhase('drawing');
      setDrawTool(tool);
    },
    [mapContext, setSpatialDrawRequest, clearDrawToolbarAnchor]
  );

  const redrawShape = useCallback(() => {
    drawWktRef.current = null;
    clearDrawToolbarAnchor();
    setDrawPhase('drawing');
  }, [clearDrawToolbarAnchor]);

  const cancelDraw = useCallback(() => {
    clearDrawSession();
    setModalStep('draw');
    setModalOpen(true);
  }, [clearDrawSession]);

  const confirmDraw = useCallback(() => {
    const wkt = drawWktRef.current;
    if (!wkt) {
      window.alert('그린 도형이 없습니다. 지도에 도형을 그려 주세요.');
      return;
    }
    void applyDrawArea(wkt);
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
        const areaSqm = computeAreaSqmFromWkt5181(unionWkt);
        const { itemCount, summaryLabel, summaryDetail, targetLabel } = formatBoundaryAreaSummary(
          cloned,
          areaSqm
        );
        setArea({
          method: 'boundary',
          summaryLabel,
          summaryDetail,
          targetLabel,
          wkt: unionWkt,
          itemCount,
          areaSqm,
        });
        setBoundarySessionDraft(cloned);
        setPanelEngaged(true);
        setModalOpen(false);
        setModalStep('choose');
        setResultOpen(false);
      } finally {
        setApplyingArea(false);
      }
    },
    [setBoundarySessionDraft]
  );

  const openChangeAreaModal = useCallback(() => {
    setSpatialDrawRequest?.(null);
    clearDrawSession();
    setModalStep('choose');
    setModalOpen(true);
  }, [setSpatialDrawRequest, clearDrawSession]);

  const closeAreaModal = useCallback(() => {
    setPanelEngaged(true);
    setModalOpen(false);
    setModalStep('choose');
  }, []);

  /** 재설정: 영역 비우고 분석 영역 지정 모달을 바로 연다 */
  const resetArea = useCallback(() => {
    setSpatialDrawRequest?.(null);
    clearDrawSession();
    setArea(null);
    setResultOpen(false);
    setBoundarySessionDraft([]);
    setPanelEngaged(true);
    setModalStep('choose');
    setModalOpen(true);
  }, [setSpatialDrawRequest, clearDrawSession, setBoundarySessionDraft]);

  const openResult = useCallback(() => {
    if (area && isLargeParcelAnalysisArea(area)) {
      const proceed = window.confirm(
        buildLargeAreaConfirmMessage(area, { feature: 'changeHistory' })
      );
      if (!proceed) return;
    }
    setResultOpen(true);
  }, [area]);

  const value = useMemo<ChangeHistoryContextValue>(
    () => ({
      isOpen,
      sidePanelOpen,
      panelEngaged,
      area,
      modalOpen,
      modalStep,
      setModalStep,
      boundarySessionDraft,
      setBoundarySessionDraft,
      boundaryEmdOptions,
      boundaryEmdLoading,
      boundaryEmdError,
      reloadBoundaryEmd: () => void reloadBoundaryEmd(),
      applyingArea,
      drawTool,
      drawPhase,
      setDrawPhase,
      drawWktRef,
      drawToolbarAnchor,
      setDrawToolbarAnchor,
      clearDrawToolbarAnchor,
      layerGroups,
      layersLoaded,
      layerIds: selectedLayerIds,
      setLayerIds: setSelectedLayerIds,
      resultOpen,
      selectedDate,
      setSelectedDate,
      openChangeAreaModal,
      closeAreaModal,
      startDraw,
      cancelDraw,
      redrawShape,
      confirmDraw,
      handleApplyBoundary,
      resetArea,
      openResult,
      closeResult: () => setResultOpen(false),
      closeMode,
    }),
    [
      isOpen,
      sidePanelOpen,
      panelEngaged,
      area,
      modalOpen,
      modalStep,
      boundarySessionDraft,
      setBoundarySessionDraft,
      boundaryEmdOptions,
      boundaryEmdLoading,
      boundaryEmdError,
      reloadBoundaryEmd,
      applyingArea,
      drawTool,
      drawPhase,
      drawToolbarAnchor,
      setDrawToolbarAnchor,
      clearDrawToolbarAnchor,
      layerGroups,
      layersLoaded,
      selectedLayerIds,
      setSelectedLayerIds,
      resultOpen,
      selectedDate,
      openChangeAreaModal,
      closeAreaModal,
      startDraw,
      cancelDraw,
      redrawShape,
      confirmDraw,
      handleApplyBoundary,
      resetArea,
      openResult,
      closeMode,
    ]
  );

  return <ChangeHistoryContext.Provider value={value}>{children}</ChangeHistoryContext.Provider>;
}

export function useChangeHistory() {
  const ctx = useContext(ChangeHistoryContext);
  if (!ctx) throw new Error('useChangeHistory must be used within ChangeHistoryProvider');
  return ctx;
}
