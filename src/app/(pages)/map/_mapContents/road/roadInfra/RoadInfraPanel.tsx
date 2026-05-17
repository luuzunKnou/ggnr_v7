"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  DraftingCompass,
  Landmark,
  Package,
  Palette,
  Pentagon,
  Plus,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Square,
  Waves,
  Warehouse,
  X,
} from "lucide-react";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { transformCoordinate } from "../../../_mapComponents/services/coordinateService";
import type { IdentifyLayerResult } from "../../../_mapComponents/hooks/useFeatureIdentify";
import { getLegendGraphicUrl } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import {
  ROAD_LEDGER_DOC_LAYERS,
  ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  type RoadLedgerDocButtonKey,
} from "../roadLedger/roadLedgerDocLayerMap";

/** 도로대장 RoadLedgerDetailPanel DOC_ACTION_BUTTONS 시설 구분과 동일 아이콘 */
const ROAD_LEDGER_FACILITY_GROUP_ICONS: Partial<Record<RoadLedgerDocButtonKey, LucideIcon>> = {
  주요시설: Building2,
  기하구조: DraftingCompass,
  배수시설: Waves,
  부대시설: Warehouse,
  안전시설: Shield,
  기타시설: Package,
};

type DefineLayerRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
};

/** 레이어 1행 — 데이터조회 AttributeQueryUI LayerItemMeta 와 동일 필드로 매핑 */
type RoadInfraLayerItem = {
  id: string;
  name: string;
  tableName: string;
};

type RoadInfraLayerGroup = {
  id: string;
  name: string;
  layers: RoadInfraLayerItem[];
};

type Props = {
  activeTableName?: string;
  onOpenDataPanel: (tableName: string) => void;
  onClearDataSelection?: () => void;
};

type RoadInfraSearchTab = "keyword" | "shape" | "boundary";

/** 데이터조회 AttributeQueryUI 와 동일 키 — 읍면동·데이터선택 폼 공유 */
const SPATIAL_SEARCH_FORM_STORAGE_KEY = "ggnr_spatial_search_form";

const BOUNDARY_SEARCH_HEADER = "행정경계 검색 결과";

type BoundaryBadgeItem = {
  key: string;
  kind: "emd" | "ri";
  code: string;
  label: string;
};

type PersistedRoadInfraSpatialForm = {
  emdSelected?: string;
  riSelected?: string;
  /** 행정경계 검색 탭 — 추가된 읍면동·리(코드·표시명) */
  boundaryBadges?: { kind: "emd" | "ri"; code: string; label: string }[];
  dataSelectTable?: string;
  dataSelectField?: string;
  dataSelectValue?: string;
};

function normalizeBoundaryBadgesFromPersist(p: PersistedRoadInfraSpatialForm): BoundaryBadgeItem[] {
  const raw = p.boundaryBadges;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((x) => x && typeof x === "object")
      .map((x): BoundaryBadgeItem => {
        const kind: "emd" | "ri" = x.kind === "ri" ? "ri" : "emd";
        const code = String(x.code ?? "").trim();
        const label = String(x.label ?? code).trim() || code;
        return { key: `${kind}:${code}`, kind, code, label };
      })
      .filter((x) => x.code);
  }
  const legacyRi = String(p.riSelected ?? "").trim();
  if (legacyRi) return [{ key: `ri:${legacyRi}`, kind: "ri", code: legacyRi, label: legacyRi }];
  const legacyEmd = String(p.emdSelected ?? "").trim();
  if (legacyEmd) return [{ key: `emd:${legacyEmd}`, kind: "emd", code: legacyEmd, label: legacyEmd }];
  return [];
}

function loadPersistedRoadInfraSpatialForm(): PersistedRoadInfraSpatialForm {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SPATIAL_SEARCH_FORM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedRoadInfraSpatialForm;
    const boundaryBadges = Array.isArray(parsed.boundaryBadges)
      ? parsed.boundaryBadges.filter(
          (b): b is { kind: "emd" | "ri"; code: string; label: string } =>
            !!b &&
            typeof b === "object" &&
            (b.kind === "emd" || b.kind === "ri") &&
            typeof b.code === "string"
        )
      : undefined;
    return {
      emdSelected: typeof parsed.emdSelected === "string" ? parsed.emdSelected : "",
      riSelected: typeof parsed.riSelected === "string" ? parsed.riSelected : "",
      boundaryBadges,
      dataSelectTable: typeof parsed.dataSelectTable === "string" ? parsed.dataSelectTable : "",
      dataSelectField: typeof parsed.dataSelectField === "string" ? parsed.dataSelectField : "",
      dataSelectValue: typeof parsed.dataSelectValue === "string" ? parsed.dataSelectValue : "",
    };
  } catch {
    return {};
  }
}

function savePersistedRoadInfraSpatialForm(state: PersistedRoadInfraSpatialForm) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SPATIAL_SEARCH_FORM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

type RoadInfraSpatialTool = "rectangle" | "polygon" | "circle" | "emdRi" | "dataSelect";

function firstDefineTableFromResults(results: IdentifyLayerResult[]): string | null {
  for (const layer of results) {
    const t = String(layer.tableName ?? "").trim();
    if (t && layer.features.length > 0) return t;
  }
  return null;
}

function totalFeatureHits(results: IdentifyLayerResult[]): number {
  return results.reduce((sum, r) => sum + r.features.length, 0);
}

const ROAD_INFRA_SPATIAL_TOOLS: {
  id: RoadInfraSpatialTool;
  icon: typeof Square;
  label: string;
}[] = [
  { id: "rectangle", icon: Square, label: "사각형" },
  { id: "polygon", icon: Pentagon, label: "다각형" },
  { id: "circle", icon: Circle, label: "원형" },
  { id: "emdRi", icon: Landmark, label: "행정경계" },
  { id: "dataSelect", icon: Database, label: "데이터 선택" },
];

/** 도형검색 탭 — 읍면동·리는 행정경계 검색 탭으로 분리 */
const ROAD_INFRA_SHAPE_TAB_TOOLS = ROAD_INFRA_SPATIAL_TOOLS.filter((t) => t.id !== "emdRi");

export function RoadInfraPanel({
  activeTableName,
  onOpenDataPanel,
  onClearDataSelection,
}: Props) {
  const mapContext = useMapContext();
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const spatialFilterWkt = mapContext?.spatialFilterWkt ?? null;
  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;
  const setIdentifyResultList = mapContext?.setIdentifyResultList;
  const onOpenDataPanelRef = useRef(onOpenDataPanel);
  useLayoutEffect(() => {
    onOpenDataPanelRef.current = onOpenDataPanel;
  }, [onOpenDataPanel]);

  const [existingDocLayerIds, setExistingDocLayerIds] = useState<Set<string> | null>(null);
  const [korByTable, setKorByTable] = useState<Record<string, string>>({});
  const [failedLegendLayers, setFailedLegendLayers] = useState<Set<string>>(new Set());
  const [layerTotals, setLayerTotals] = useState<Record<string, number>>({});
  const [expandedGroups, setExpandedGroups] = useState<string[]>(() => ["주요시설"]);
  const [searchTab, setSearchTab] = useState<RoadInfraSearchTab>(() => {
    const p = loadPersistedRoadInfraSpatialForm();
    if (p.dataSelectTable?.trim()) return "shape";
    if (normalizeBoundaryBadgesFromPersist(p).length > 0) return "boundary";
    return "keyword";
  });
  const [keywordInput, setKeywordInput] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHadNoResults, setSearchHadNoResults] = useState(false);
  const [activeSpatialTool, setActiveSpatialTool] = useState<RoadInfraSpatialTool>(() => {
    const p = loadPersistedRoadInfraSpatialForm();
    if (p.dataSelectTable?.trim()) return "dataSelect";
    if (normalizeBoundaryBadgesFromPersist(p).length > 0) return "emdRi";
    return "rectangle";
  });
  const [boundaryBadges, setBoundaryBadges] = useState<BoundaryBadgeItem[]>(() =>
    normalizeBoundaryBadgesFromPersist(loadPersistedRoadInfraSpatialForm())
  );
  const [emdSelected, setEmdSelected] = useState("");
  const [riSelected, setRiSelected] = useState("");
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [dataSelectTable, setDataSelectTable] = useState("");
  const [dataSelectField, setDataSelectField] = useState("");
  const [dataSelectValue, setDataSelectValue] = useState("");
  const [dataSelectTableOptions, setDataSelectTableOptions] = useState<string[]>([]);
  const [dataSelectFieldOptions, setDataSelectFieldOptions] = useState<string[]>([]);
  const [dataSelectValueOptions, setDataSelectValueOptions] = useState<string[]>([]);
  const [dataSelectFieldLabels, setDataSelectFieldLabels] = useState<Record<string, string>>({});
  const [dataSelectValueLabels, setDataSelectValueLabels] = useState<Record<string, string>>({});

  /** 데이터조회와 동일: 도형 그리기 중이거나 지도에 공간필터 WKT가 있을 때 도형 버튼 강조 */
  const isSpatialSearchActive = !!(spatialFilterWkt || spatialDrawRequest);

  useEffect(() => {
    const persisted = loadPersistedRoadInfraSpatialForm();
    if (persisted.emdSelected) setEmdSelected(persisted.emdSelected);
    if (persisted.riSelected) setRiSelected(persisted.riSelected);
    if (persisted.dataSelectTable) setDataSelectTable(persisted.dataSelectTable);
    if (persisted.dataSelectField) setDataSelectField(persisted.dataSelectField);
    if (persisted.dataSelectValue) setDataSelectValue(persisted.dataSelectValue);
  }, []);

  useEffect(() => {
    savePersistedRoadInfraSpatialForm({
      emdSelected,
      riSelected,
      boundaryBadges: boundaryBadges.map(({ kind, code, label }) => ({ kind, code, label })),
      dataSelectTable,
      dataSelectField,
      dataSelectValue,
    });
  }, [emdSelected, riSelected, boundaryBadges, dataSelectTable, dataSelectField, dataSelectValue]);

  /** 행정경계 검색 탭에서 다른 탭으로 이동하면 검색 결과·뱃지·읍면동·리 선택 초기화 */
  useEffect(() => {
    if (searchTab !== "boundary") return;
    return () => {
      setIdentifyResultList?.(null);
      setSearchHadNoResults(false);
      setSearchLoading(false);
      setBoundaryBadges([]);
      setEmdSelected("");
      setRiSelected("");
    };
  }, [searchTab, setIdentifyResultList]);

  const onLegendError = useCallback((tableName: string) => {
    setFailedLegendLayers((prev) => new Set(prev).add(tableName));
  }, []);

  useEffect(() => {
    let cancelled = false;
    call("", "POST", {
      service: "roadLedgerService",
      action: "getRoadLedgerExistingDefineLayerIds",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const ids = data?.ids;
        setExistingDocLayerIds(
          new Set(
            Array.isArray(ids) ? ids.map((x: string) => String(x).trim().toLowerCase()).filter(Boolean) : []
          )
        );
      })
      .catch(() => {
        if (!cancelled) setExistingDocLayerIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/defineLayer")
      .then((r) => r.json())
      .then((res: { data?: DefineLayerRow[] }) => {
        if (cancelled) return;
        const tables = Array.isArray(res?.data) ? res.data : [];
        const m: Record<string, string> = {};
        for (const t of tables) {
          const name = String(t?.define_table_name ?? "").trim().toLowerCase();
          if (!name) continue;
          const kor = String(t?.define_table_kor_name ?? t?.define_table_name ?? "").trim();
          m[name] = kor || name;
        }
        setKorByTable(m);
      })
      .catch(() => {
        if (!cancelled) setKorByTable({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const layerGroups: RoadInfraLayerGroup[] = useMemo(() => {
    return ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT.map((groupKey) => {
      const raw = ROAD_LEDGER_DOC_LAYERS[groupKey] ?? [];
      const filtered =
        existingDocLayerIds == null
          ? raw
          : raw.filter((id) => existingDocLayerIds.has(String(id).trim().toLowerCase()));
      const layers: RoadInfraLayerItem[] = filtered.map((id) => {
        const lc = String(id).trim().toLowerCase();
        const kor = korByTable[lc]?.trim();
        const name = kor && kor.length > 0 ? kor : "한글명 미등록";
        return { id: lc, name, tableName: lc };
      });
      return { id: groupKey, name: groupKey, layers };
    });
  }, [existingDocLayerIds, korByTable]);

  const allDefineTableNames = useMemo(
    () => [...new Set(layerGroups.flatMap((g) => g.layers.map((l) => l.tableName)))],
    [layerGroups]
  );

  /** 통합·도형·행정경계 검색 — 체크된(지도에 켜진) 레이어만 대상 */
  const visibleDefineTableNames = useMemo(
    () => allDefineTableNames.filter((t) => visibleLayerNames.has(t)),
    [allDefineTableNames, visibleLayerNames]
  );
  const visibleDefineTableNamesRef = useRef(visibleDefineTableNames);
  visibleDefineTableNamesRef.current = visibleDefineTableNames;

  /** 도로대장 레이어 id 목록이 늦게 오면 WKT만 먼저 잡히는 경우가 있어 도형검색을 보류 */
  type PendingGeometrySearch = {
    wkt: string;
    syncSearchTab?: "shape" | "boundary";
    listHeader?: string;
  };
  const pendingGeometrySearchRef = useRef<PendingGeometrySearch | null>(null);

  const applySearchToRightPanel = useCallback(
    (results: IdentifyLayerResult[], listHeaderLabel: string) => {
      const hits = totalFeatureHits(results);
      const firstFromHits = firstDefineTableFromResults(results);
      const visibleTables = visibleDefineTableNamesRef.current;
      const fallbackTable =
        firstFromHits ?? (visibleTables.length > 0 ? visibleTables[0] : null);
      if (hits === 0) {
        if (fallbackTable) {
          setIdentifyResultList?.({
            coordinate: [0, 0],
            results: [],
            listHeaderLabel,
          });
          onOpenDataPanelRef.current(fallbackTable);
          setSearchHadNoResults(false);
        } else {
          setIdentifyResultList?.(null);
          setSearchHadNoResults(true);
        }
        return;
      }
      setSearchHadNoResults(false);
      const firstTable = firstFromHits;
      if (!firstTable) {
        if (fallbackTable) {
          setIdentifyResultList?.({
            coordinate: [0, 0],
            results: [],
            listHeaderLabel,
          });
          onOpenDataPanelRef.current(fallbackTable);
          setSearchHadNoResults(false);
        } else {
          setIdentifyResultList?.(null);
          setSearchHadNoResults(true);
        }
        return;
      }
      setIdentifyResultList?.({
        coordinate: [0, 0],
        results,
        listHeaderLabel,
      });
      onOpenDataPanelRef.current(firstTable);
    },
    [setIdentifyResultList]
  );

  const moveMapToCenter = useCallback((center: { x: number; y: number } | null) => {
    if (!center) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    const center3857 = transformCoordinate([center.x, center.y], "EPSG:5181", "EPSG:3857");
    if (center3857) map.getView().setCenter(center3857);
  }, [mapContext?.mapInstanceRef]);

  const runGeometrySearch = useCallback(
    (wkt5181: string, opts?: { syncSearchTab?: "shape" | "boundary"; listHeader?: string }) => {
      const listHeader = opts?.listHeader ?? "도형검색 결과";
      const tables = visibleDefineTableNamesRef.current;
      if (tables.length === 0) {
        pendingGeometrySearchRef.current = {
          wkt: wkt5181,
          syncSearchTab: opts?.syncSearchTab,
          listHeader: opts?.listHeader,
        };
        setSearchHadNoResults(false);
        setSearchLoading(true);
        return;
      }
      pendingGeometrySearchRef.current = null;
      setSearchLoading(true);
      setSearchHadNoResults(false);
      const nextTab = opts?.syncSearchTab ?? "shape";
      setSearchTab(nextTab);
      void call("", "POST", {
        service: "standardService",
        action: "searchDefineLayersByGeometry",
        params: { wkt: wkt5181, srid: 5181, tables, schema: "layer" },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const results = Array.isArray(data?.results) ? (data.results as IdentifyLayerResult[]) : [];
          applySearchToRightPanel(results, listHeader);
        })
        .catch(() => {
          setIdentifyResultList?.(null);
          setSearchHadNoResults(true);
        })
        .finally(() => setSearchLoading(false));
    },
    [applySearchToRightPanel, setIdentifyResultList]
  );

  const clearEmdRiSpatialOnMap = useCallback(() => {
    pendingGeometrySearchRef.current = null;
    setSpatialFilterWkt?.(null);
    setIdentifyResultList?.(null);
    setSearchHadNoResults(false);
    setSearchLoading(false);
  }, [setIdentifyResultList, setSpatialFilterWkt]);

  useEffect(() => {
    const p = pendingGeometrySearchRef.current;
    if (!p?.wkt || visibleDefineTableNames.length === 0) return;
    pendingGeometrySearchRef.current = null;
    runGeometrySearch(p.wkt, { syncSearchTab: p.syncSearchTab, listHeader: p.listHeader });
  }, [visibleDefineTableNames, runGeometrySearch]);

  const runBoundaryBadgeSearch = useCallback(async () => {
    if (boundaryBadges.length === 0) {
      window.alert("추가된 읍면동·리가 없습니다. 선택 후 + 를 눌러 추가하세요.");
      return;
    }
    if (!setSpatialFilterWkt) return;
    setSearchLoading(true);
    setSearchHadNoResults(false);
    setSearchTab("boundary");
    try {
      const wktParts: string[] = [];
      let lastCenter: { x: number; y: number } | null = null;
      for (const b of boundaryBadges) {
        const res = await call("", "POST", {
          service: "devTestService",
          action: b.kind === "emd" ? "getEmdGeometry" : "getRiGeometry",
          params: b.kind === "emd" ? { emdCode: b.code } : { riCode: b.code },
        });
        const data = res?.data ?? res;
        const w = data?.wkt != null ? String(data.wkt).trim() : "";
        if (w) {
          wktParts.push(w);
          const c = data?.center as { x?: number; y?: number } | null | undefined;
          if (c?.x != null && c?.y != null) lastCenter = { x: Number(c.x), y: Number(c.y) };
        }
      }
      if (wktParts.length === 0) {
        clearEmdRiSpatialOnMap();
        setSearchHadNoResults(true);
        setSearchLoading(false);
        return;
      }
      let unionWkt: string | null = wktParts[0] ?? null;
      let center: { x: number; y: number } | null = lastCenter;
      if (wktParts.length > 1) {
        const ures = await call("", "POST", {
          service: "devTestService",
          action: "unionWkts5181",
          params: { wkts: wktParts },
        });
        const udata = ures?.data ?? ures;
        unionWkt = udata?.wkt != null ? String(udata.wkt).trim() : null;
        const uc = udata?.center as { x?: number; y?: number } | null | undefined;
        if (uc?.x != null && uc?.y != null) center = { x: Number(uc.x), y: Number(uc.y) };
      }
      if (!unionWkt) {
        clearEmdRiSpatialOnMap();
        setSearchHadNoResults(true);
        setSearchLoading(false);
        return;
      }
      setSpatialFilterWkt(unionWkt);
      moveMapToCenter(center);
      runGeometrySearch(unionWkt, { syncSearchTab: "boundary", listHeader: BOUNDARY_SEARCH_HEADER });
    } catch {
      clearEmdRiSpatialOnMap();
      setSearchHadNoResults(true);
      setSearchLoading(false);
    }
  }, [
    boundaryBadges,
    setSpatialFilterWkt,
    clearEmdRiSpatialOnMap,
    moveMapToCenter,
    runGeometrySearch,
  ]);

  const startRoadInfraShapeDraw = useCallback(
    (type: "rectangle" | "polygon" | "circle") => {
      if (!setSpatialDrawRequest) return;
      if (mapContext?.measurementActive) {
        window.alert(
          "거리·면적 측정이 진행 중입니다. 측정을 완료하거나 끈 후 도형검색을 사용해 주세요."
        );
        return;
      }
      if (visibleDefineTableNames.length === 0) return;
      setSearchTab("shape");
      setActiveSpatialTool(type);
      setSpatialDrawRequest({
        type,
        onComplete: (wkt5181: string) => {
          setSpatialFilterWkt?.(wkt5181);
          runGeometrySearch(wkt5181);
        },
      });
    },
    [setSpatialDrawRequest, mapContext?.measurementActive, visibleDefineTableNames, runGeometrySearch, setSpatialFilterWkt]
  );

  const runKeywordSearch = useCallback(() => {
    const kw = keywordInput.trim();
    if (!kw) {
      window.alert("검색어를 입력하세요.");
      return;
    }
    const tables = visibleDefineTableNamesRef.current;
    if (tables.length === 0) return;
    setSearchLoading(true);
    setSearchHadNoResults(false);
    setSearchTab("keyword");
    void call("", "POST", {
      service: "standardService",
      action: "searchDefineLayersByKeyword",
      params: { keyword: kw, tables, schema: "layer" },
    })
      .then((res) => {
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? (data.results as IdentifyLayerResult[]) : [];
        applySearchToRightPanel(results, "통합검색 결과");
      })
      .catch(() => {
        setIdentifyResultList?.(null);
        setSearchHadNoResults(true);
      })
      .finally(() => setSearchLoading(false));
  }, [keywordInput, applySearchToRightPanel, setIdentifyResultList]);

  /** 데이터조회 AttributeQueryUI와 동일 — getTableCount로 레이어별 전체 건수 */
  useEffect(() => {
    const flat = layerGroups.flatMap((g) => g.layers);
    const toFetch = flat.filter((l) => l.tableName && layerTotals[l.tableName] === undefined);
    if (toFetch.length === 0) return;
    toFetch.forEach((l) => {
      const tableName = l.tableName;
      void call("", "POST", {
        service: "standardService",
        action: "getTableCount",
        params: { table: tableName, schema: "layer" },
      })
        .then((res) => {
          const data = res?.data ?? res;
          const total = typeof data?.total === "number" ? data.total : 0;
          setLayerTotals((prev) =>
            prev[tableName] === undefined ? { ...prev, [tableName]: total } : prev
          );
        })
        .catch(() => {});
    });
    // layerTotals는 의존성에 넣지 않음(AttributeQueryUI와 동일) — 완료 후 effect 재실행·중복 요청 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerGroups]);

  /** 읍면동 코드 목록 — 도형 도구 전환 시마다 호출하지 않고 마운트 시 1회 */
  useEffect(() => {
    let cancelled = false;
    void call("", "POST", { service: "devTestService", action: "getEmdRiOptions", params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTab !== "boundary" || !emdSelected) {
      setRiOptions([]);
      setRiSelected("");
      return;
    }
    let cancelled = false;
    void call("", "POST", {
      service: "devTestService",
      action: "getRiOptionsByEmd",
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRiOptions(Array.isArray(data?.ri) ? data.ri : []);
        setRiSelected("");
      })
      .catch(() => {
        if (!cancelled) setRiOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTab, emdSelected]);

  const addBoundaryBadgeFromDraft = useCallback(() => {
    if (riSelected) {
      const label = riOptions.find((o) => o.code === riSelected)?.name ?? riSelected;
      const item: BoundaryBadgeItem = { key: `ri:${riSelected}`, kind: "ri", code: riSelected, label };
      setBoundaryBadges((prev) => {
        if (prev.some((p) => p.key === item.key)) return prev;
        return [...prev, item];
      });
      return;
    }
    if (emdSelected) {
      const label = emdOptions.find((o) => o.code === emdSelected)?.name ?? emdSelected;
      const item: BoundaryBadgeItem = { key: `emd:${emdSelected}`, kind: "emd", code: emdSelected, label };
      setBoundaryBadges((prev) => {
        if (prev.some((p) => p.key === item.key)) return prev;
        return [...prev, item];
      });
      return;
    }
    window.alert("읍면동 또는 리를 선택한 뒤 + 를 눌러 주세요.");
  }, [riSelected, emdSelected, riOptions, emdOptions]);

  const clearBoundaryTab = useCallback(() => {
    setBoundaryBadges([]);
    setEmdSelected("");
    setRiSelected("");
    pendingGeometrySearchRef.current = null;
    setSpatialFilterWkt?.(null);
    setIdentifyResultList?.(null);
    setSearchHadNoResults(false);
    setSearchLoading(false);
  }, [setIdentifyResultList, setSpatialFilterWkt]);

  /** 시설관리 패널을 닫거나 다른 사이드 메뉴로 전환 시 — persisted 뱃지 복원·지도 WKT·검색 결과 잔상 제거 */
  useEffect(() => {
    return () => {
      const p = loadPersistedRoadInfraSpatialForm();
      savePersistedRoadInfraSpatialForm({
        ...p,
        emdSelected: "",
        riSelected: "",
        boundaryBadges: [],
      });
      pendingGeometrySearchRef.current = null;
      setSpatialFilterWkt?.(null);
      setSpatialDrawRequest?.(null);
      setIdentifyResultList?.(null);
      setSearchHadNoResults(false);
      setSearchLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 언마운트 시에만 정리
  }, []);

  useEffect(() => {
    if (activeSpatialTool !== "dataSelect") return;
    let cancelled = false;
    void call("", "POST", { service: "devTestService", action: "getDataSelectTableList", params: {} })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setDataSelectTableOptions(Array.isArray(data?.tables) ? data.tables : []);
      })
      .catch(() => {
        if (!cancelled) setDataSelectTableOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSpatialTool]);

  useEffect(() => {
    if (activeSpatialTool !== "dataSelect" || !dataSelectTable) {
      setDataSelectFieldOptions([]);
      setDataSelectFieldLabels({});
      return;
    }
    let cancelled = false;
    void Promise.all([
      call("", "POST", {
        service: "devTestService",
        action: "getDataSelectFieldList",
        params: { table: dataSelectTable },
      }),
      fetch(`/api/config/defineLayer/fields/${encodeURIComponent(dataSelectTable)}`).then((r) => r.json()),
    ])
      .then(([res, fieldsRes]) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const fields = Array.isArray(data?.fields) ? data.fields : [];
        setDataSelectFieldOptions(fields);
        const fieldDefs = Array.isArray(fieldsRes?.data) ? fieldsRes.data : [];
        const labels: Record<string, string> = {};
        for (const row of fieldDefs as { define_field_name?: string; define_field_kor_name?: string }[]) {
          const name = String(row?.define_field_name ?? "").trim();
          const kor = String(row?.define_field_kor_name ?? "").trim();
          if (name) labels[name] = kor || name;
        }
        setDataSelectFieldLabels(labels);
      })
      .catch(() => {
        if (!cancelled) setDataSelectFieldOptions([]);
        if (!cancelled) setDataSelectFieldLabels({});
      });
    return () => {
      cancelled = true;
    };
  }, [activeSpatialTool, dataSelectTable]);

  useEffect(() => {
    if (activeSpatialTool !== "dataSelect" || !dataSelectTable || !dataSelectField) {
      setDataSelectValueOptions([]);
      setDataSelectValueLabels({});
      return;
    }
    let cancelled = false;
    const tableFieldKey = `${dataSelectTable}__${dataSelectField}`;
    void Promise.all([
      call("", "POST", {
        service: "devTestService",
        action: "getDataSelectValueList",
        params: { table: dataSelectTable, field: dataSelectField },
      }),
      fetch(`/api/config/defineLayer/codes/${encodeURIComponent(tableFieldKey)}`).then((r) => r.json()),
    ])
      .then(([res, codesRes]) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const values = Array.isArray(data?.values) ? data.values : [];
        setDataSelectValueOptions(values);
        const codeList = Array.isArray(codesRes?.data) ? codesRes.data : [];
        const labels: Record<string, string> = {};
        for (const row of codeList as { define_code_name?: string; define_code_kor_name?: string }[]) {
          const name = String(row?.define_code_name ?? "").trim();
          const kor = String(row?.define_code_kor_name ?? "").trim();
          if (name) labels[name] = kor || name;
        }
        setDataSelectValueLabels(labels);
      })
      .catch(() => {
        if (!cancelled) setDataSelectValueOptions([]);
        if (!cancelled) setDataSelectValueLabels({});
      });
    return () => {
      cancelled = true;
    };
  }, [activeSpatialTool, dataSelectTable, dataSelectField]);

  useEffect(() => {
    if (activeSpatialTool !== "dataSelect") return;
    if (!setSpatialFilterWkt) return;
    let cancelled = false;

    const applyWkt = (wkt: string | null, center: { x: number; y: number } | null) => {
      if (cancelled) return;
      if (!wkt) {
        pendingGeometrySearchRef.current = null;
        setSpatialFilterWkt(null);
        setIdentifyResultList?.(null);
        setSearchHadNoResults(false);
        setSearchLoading(false);
        return;
      }
      setSpatialFilterWkt(wkt);
      moveMapToCenter(center);
      runGeometrySearch(wkt);
    };

    if (dataSelectTable && dataSelectField && dataSelectValue) {
      void call("", "POST", {
        service: "devTestService",
        action: "getGeometryByFieldValue",
        params: {
          table: dataSelectTable,
          field: dataSelectField,
          value: dataSelectValue,
          schema: "layer",
        },
      })
        .then((res) => {
          if (cancelled) return;
          const data = res?.data ?? res;
          applyWkt(data?.wkt ?? null, data?.center ?? null);
        })
        .catch(() => applyWkt(null, null));
    } else {
      applyWkt(null, null);
    }
    return () => {
      cancelled = true;
    };
  }, [
    activeSpatialTool,
    dataSelectTable,
    dataSelectField,
    dataSelectValue,
    setSpatialFilterWkt,
    moveMapToCenter,
    runGeometrySearch,
    setIdentifyResultList,
  ]);

  const handleLayerClick = (layer: RoadInfraLayerItem) => {
    const t = layer.tableName;
    if (activeTableName === t) {
      setIdentifyResultList?.(null);
      onClearDataSelection?.();
    } else {
      setIdentifyResultList?.(null);
      setSearchHadNoResults(false);
      onOpenDataPanelRef.current(t);
      if (setVisibleLayerNames && !visibleLayerNames.has(t)) {
        setVisibleLayerNames((prev) => new Set(prev).add(t));
      }
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden opacity-[0.95]">
      <div className="shrink-0 border-b border-slate-200 bg-white px-2.5 py-2">
        <div className="mb-2 flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => setSearchTab("keyword")}
            className={cn(
              "flex-1 rounded py-1.5 text-[11px] font-medium transition-colors",
              searchTab === "keyword"
                ? "bg-white text-primary shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            통합검색
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTab("shape");
              setActiveSpatialTool((prev) => (prev === "emdRi" ? "rectangle" : prev));
            }}
            className={cn(
              "flex-1 rounded py-1.5 text-[11px] font-medium transition-colors",
              searchTab === "shape"
                ? "bg-white text-primary shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            도형검색
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTab("boundary");
              setActiveSpatialTool("emdRi");
            }}
            className={cn(
              "flex-1 rounded px-0.5 py-1.5 text-[10px] font-medium leading-tight transition-colors",
              searchTab === "boundary"
                ? "bg-white text-primary shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            행정경계 검색
          </button>
        </div>
        {searchTab === "keyword" && (
          <div className="flex items-stretch gap-1.5">
            <input
              type="search"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runKeywordSearch();
              }}
              placeholder="시설 속성 검색"
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
            />
            <button
              type="button"
              onClick={runKeywordSearch}
              disabled={searchLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary bg-primary px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              검색
            </button>
          </div>
        )}
        {searchTab === "shape" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-stretch gap-1.5">
              {ROAD_INFRA_SHAPE_TAB_TOOLS.map((tool) => {
                const Icon = tool.icon;
                const isShapeTool =
                  tool.id === "rectangle" || tool.id === "polygon" || tool.id === "circle";
                const isActive = isShapeTool
                  ? isSpatialSearchActive && activeSpatialTool === tool.id
                  : activeSpatialTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    title={
                      isShapeTool ? `지도에 ${tool.label} 그리기` : tool.label
                    }
                    onClick={() => {
                      setSearchTab("shape");
                      if (
                        (tool.id === "rectangle" ||
                          tool.id === "polygon" ||
                          tool.id === "circle") &&
                        setSpatialDrawRequest
                      ) {
                        startRoadInfraShapeDraw(tool.id);
                      } else {
                        setActiveSpatialTool(tool.id);
                      }
                    }}
                    disabled={searchLoading}
                    className={cn(
                      "flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border py-1.5 text-[10px] transition-colors disabled:opacity-50",
                      isActive
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  </button>
                );
              })}
              <button
                type="button"
                title={spatialFilterWkt ? "공간 필터 해제" : "검색 초기화"}
                onClick={() => {
                  setSearchTab("shape");
                  setActiveSpatialTool("rectangle");
                  pendingGeometrySearchRef.current = null;
                  setSpatialDrawRequest?.(null);
                  setSpatialFilterWkt?.(null);
                  setEmdSelected("");
                  setRiSelected("");
                  setBoundaryBadges([]);
                  setDataSelectTable("");
                  setDataSelectField("");
                  setDataSelectValue("");
                  setIdentifyResultList?.(null);
                  setSearchHadNoResults(false);
                  setSearchLoading(false);
                }}
                className={cn(
                  "flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border py-1.5 transition-colors",
                  spatialFilterWkt
                    ? "border-amber-300 bg-white text-amber-600 hover:border-amber-400"
                    : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-primary"
                )}
              >
                <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              </button>
            </div>
            {activeSpatialTool === "dataSelect" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-end gap-1.5">
                  <div className="min-w-0 flex-1">
                    <select
                      value={dataSelectTable}
                      onChange={(e) => {
                        setDataSelectTable(e.target.value);
                        setDataSelectField("");
                        setDataSelectValue("");
                      }}
                      disabled={searchLoading}
                      className="h-8 w-full max-w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                    >
                      <option value="">테이블 선택</option>
                      {dataSelectTableOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <select
                      value={dataSelectField}
                      onChange={(e) => {
                        setDataSelectField(e.target.value);
                        setDataSelectValue("");
                      }}
                      disabled={!dataSelectTable || searchLoading}
                      className="h-8 w-full max-w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">필드 선택</option>
                      {dataSelectFieldOptions.map((name) => (
                        <option key={name} value={name}>
                          {dataSelectFieldLabels[name] ?? name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="min-w-0">
                  <select
                    value={dataSelectValue}
                    onChange={(e) => setDataSelectValue(e.target.value)}
                    disabled={!dataSelectField || searchLoading}
                    className="h-8 w-full max-w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">값 선택</option>
                    {dataSelectValueOptions.map((val) => (
                      <option key={val} value={val}>
                        {dataSelectValueLabels[val] ?? val}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
        {searchTab === "boundary" && (
          <div className="space-y-2">
            <div className="flex items-end gap-1.5">
              <div className="min-w-0 flex-1">
                <select
                  value={emdSelected}
                  onChange={(e) => {
                    setEmdSelected(e.target.value);
                    setRiSelected("");
                  }}
                  disabled={searchLoading}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">읍면동 선택</option>
                  {emdOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <select
                  value={riSelected}
                  onChange={(e) => setRiSelected(e.target.value)}
                  disabled={!emdSelected || searchLoading}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">리 선택</option>
                  {riOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                title="선택 항목을 목록에 추가"
                onClick={addBoundaryBadgeFromDraft}
                disabled={searchLoading}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </div>
            {boundaryBadges.length > 0 && (
              <div className="grid grid-cols-4 gap-x-1 gap-y-1.5">
                {boundaryBadges.map((b) => (
                  <span
                    key={b.key}
                    className="flex min-h-[1.25rem] min-w-0 w-full max-w-full items-center justify-center gap-0.5 rounded-full border border-primary/25 bg-primary/8 py-0.5 pl-1 pr-0.5 text-[10px] leading-none text-slate-800"
                  >
                    <span className="min-w-0 max-w-[3em] flex-1 truncate text-center" title={b.label}>
                      {b.label}
                    </span>
                    <button
                      type="button"
                      title="목록에서 제거"
                      onClick={() => setBoundaryBadges((prev) => prev.filter((x) => x.key !== b.key))}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-primary/15 hover:text-primary"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void runBoundaryBadgeSearch()}
                disabled={searchLoading || boundaryBadges.length === 0}
                className="min-h-8 flex-1 rounded-md border border-primary bg-primary py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                검색
              </button>
              <button
                type="button"
                title="선택·목록·지도 필터 초기화"
                onClick={clearBoundaryTab}
                disabled={searchLoading}
                className="min-h-8 flex-1 rounded-md border border-slate-200 bg-white py-1.5 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:text-primary disabled:opacity-50"
              >
                초기화
              </button>
            </div>
          </div>
        )}
      </div>

      {searchLoading && (
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5 text-[11px] text-slate-500">
          검색 중…
        </div>
      )}
      {searchHadNoResults && !searchLoading && (
        <div className="shrink-0 border-b border-slate-100 bg-white px-3 py-2 text-center text-[11px] text-slate-500">
          검색 결과가 없습니다.
        </div>
      )}

      {/* 데이터조회 AttributeQueryUI — 레이어 그룹 영역과 동일 구조·클래스 */}
      <div className="scrollbar-hide flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {(layerGroups.length === 0 || layerGroups.every((g) => g.layers.length === 0)) && (
          <div className="px-4 py-6 text-center text-sm text-slate-500">등록된 레이어가 없습니다.</div>
        )}
        {layerGroups.map((group) => {
          const filteredLayers = group.layers;
          if (filteredLayers.length === 0) return null;
          const groupCount = filteredLayers.length;
          const groupVisibleCount = filteredLayers.filter((l) => visibleLayerNames.has(l.tableName)).length;
          const GroupIcon =
            ROAD_LEDGER_FACILITY_GROUP_ICONS[group.name as RoadLedgerDocButtonKey] ?? Building2;
          const isGroupOpen = expandedGroups.includes(group.id);

          return (
            <div key={group.id} className="px-2 pb-2.5 pt-1 first:pt-2">
              <div className="overflow-hidden rounded-md border border-slate-300/90 bg-white">
              <div
                className={cn(
                  "flex w-full items-center gap-2 bg-gradient-to-r from-slate-100 to-slate-50 px-2 py-2",
                  isGroupOpen && "border-b border-slate-200"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 text-left transition-colors hover:bg-slate-200/40"
                >
                  {isGroupOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
                  )}
                  <GroupIcon className="h-4 w-4 shrink-0 text-primary/85" aria-hidden />
                  <span className="text-[12px] font-semibold tracking-tight text-slate-900">{group.name}</span>
                  <span className="text-[11px] font-medium text-slate-500">({groupCount}개)</span>
                </button>
                <input
                  type="checkbox"
                  checked={groupCount > 0 && groupVisibleCount === groupCount}
                  ref={(el) => {
                    if (el) el.indeterminate = groupVisibleCount > 0 && groupVisibleCount < groupCount;
                  }}
                  onChange={(e) => {
                    if (!setVisibleLayerNames) return;
                    const checked = e.target.checked;
                    setVisibleLayerNames((prev) => {
                      const next = new Set(prev);
                      filteredLayers.forEach((l) => {
                        if (checked) next.add(l.tableName);
                        else next.delete(l.tableName);
                      });
                      return next;
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-slate-300 text-primary focus:ring-primary/30"
                  title="그룹 전체 켜기/끄기"
                />
              </div>

              {isGroupOpen && (
              <div className="bg-slate-50/90">
                  {filteredLayers.map((layer) => {
                    const isVisible = visibleLayerNames.has(layer.tableName);
                    const totalCount = layerTotals[layer.tableName];

                    return (
                      <div
                        key={layer.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleLayerClick(layer)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleLayerClick(layer);
                          }
                        }}
                        className="flex w-full cursor-pointer items-center gap-1 border-b border-slate-100/90 py-1.5 pl-3.5 pr-2 transition-colors last:border-b-0 hover:bg-white"
                      >
                        {failedLegendLayers.has(layer.tableName) ? (
                          <span
                            className="h-5 w-5 shrink-0 rounded border border-slate-300 bg-slate-200"
                            aria-hidden
                          />
                        ) : (
                          <img
                            src={getLegendGraphicUrl(layer.tableName, layer.tableName)}
                            alt=""
                            className="h-5 w-5 shrink-0 rounded border border-slate-200 object-contain"
                            onError={() => onLegendError(layer.tableName)}
                          />
                        )}
                        <div className="flex min-h-[1.0rem] min-w-0 flex-1 items-center gap-1 text-left">
                          <span className="truncate text-[11px] font-normal text-slate-700">{layer.name}</span>
                          <span className="shrink-0 text-[11px] text-slate-400">
                            ({totalCount != null ? `${totalCount.toLocaleString()}건` : "..."})
                          </span>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-primary"
                            title="필터 추가"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-primary"
                            title="스타일 설정"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Palette className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={(e) => {
                              e.stopPropagation();
                              if (!setVisibleLayerNames) return;
                              setVisibleLayerNames((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(layer.tableName);
                                else next.delete(layer.tableName);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-slate-300 text-primary focus:ring-primary/30"
                            title="레이어 켜기/끄기"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
              )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
