"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { call } from "@/lib/api";
import { appFetch } from "@/lib/basePath";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import {
  FileText,
  Map,
  Construction,
  FlipHorizontal,
  FlipVertical,
  X,
  FileImage,
  Loader2,
  Images,
  MapPin,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Waves,
} from "lucide-react";
import { RiverPlanAreaModeButton, type RiverPlanAreaMode } from "./RiverPlanAreaModeButton";
import { cn } from "@/lib/utils";
import { formatDetailScalarValue } from "@/lib/formatDetailScalar";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  riverBasicPlanAsDefineTable,
  riverBasicPlanGdParentDefineTable,
  riverBasicPlanGdWmsDefineTables,
  riverBasicPlanHdDefineTable,
  riverBasicPlanIndexDefineTable,
  riverBasicPlanJbDefineTable,
  riverBasicPlanJdDefineTable,
  buildRiverBasicPlanMapCqlByLayer,
} from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { getRowKey, getRowValueByField } from "../../../_mapComponents/standard/defineLayerRowUtils";
import { useRiverBasicPlanExistingMapLayers } from "./useRiverBasicPlanExistingMapLayers";
import { useRiverBasicPlanIndexHighlight } from "./useRiverBasicPlanIndexHighlight";
import { useRiverBasicPlanJbLabels } from "./useRiverBasicPlanJbLabels";
import { useRiverBasicPlanReportFolders } from "./useRiverBasicPlanReportFolders";
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  serviceFileDataDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileData,
} from "../../../_mapComponents/standard/useServiceFileData";
import { ServiceFilePdfThumb } from "../../../_mapComponents/standard/ServiceFilePdfThumb";
import {
  extent3857IsLandscape,
  type IndexSheetGuide,
  type IndexSheetMode,
} from "../../../_mapComponents/standard/inferPdfPageUprightRotation";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { buildServiceFilePreviewGalleryItems } from "../../../_mapComponents/standard/serviceFilePreviewItems";
import {
  ServiceFilePdfPreview,
  type ServiceFilePdfPreviewItem,
} from "../../../_mapComponents/standard/ServiceFilePdfPreview";
import { getRiverBasicPlanDetailFields } from "./riverBasicPlanDetailFields";
import {
  buildRiverBasicPlanReportPlanFolderKey,
  buildRiverBasicPlanReportPlanFolderKeyFromParts,
  buildRiverBasicPlanReportRiverSubfolderKey,
  extractRiverBasicPlanRivpFolderSuffix,
  riverBasicPlanReportRelativeDir,
} from "./riverBasicPlanReportFolder";

/** 연도 필드는 천단위 콤마 없이 표시 (예: 2,024 → 2024) */
function formatRiverBasicPlanAttrValue(key: string, raw: unknown): string {
  if (/year|연도/i.test(key)) {
    if (raw === null || raw === undefined) return "-";
    const s = String(raw).trim().replace(/,/g, "");
    return s === "" ? "-" : s;
  }
  return formatDetailScalarValue(raw);
}

function parseXyPairs(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const pts: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  return pts.length >= 2 ? pts : null;
}

type IndexBundle = {
  index: {
    row: Record<string, unknown>;
    extent3857: [number, number, number, number] | null;
    ogcFid: number;
    ring3857: [number, number][] | null;
    guide3857: [number, number][] | null;
  } | null;
  related: {
    kind: string;
    table: string;
    ogcFid: number;
    label: string;
    badge: string;
    fileLayer: string;
    fileKey: string;
    extent3857: [number, number, number, number] | null;
  }[];
};

type IndexListItem = {
  ogcFid: number;
  label: string;
  order: number;
  badge: string;
  extent3857: [number, number, number, number] | null;
};

/** 가로 도면은 칸 너비에 맞춤(3:2). 세로 도면은 그 너비만큼 높이로 맞춤 */
const INDEX_THUMB_FRAME_LANDSCAPE = "relative w-full aspect-[3/2] overflow-hidden bg-muted";
const INDEX_THUMB_FRAME_PORTRAIT = "relative w-full aspect-square overflow-hidden bg-white";

type RiverType = "river" | "smallRiver";

/** 기본계획도(하천구역 면) «선만» GeoServer 스타일 — 흰 외곽선만 */
const PLAN_AS_LINE_STYLE = "river_plan_as_line";

function layerByLabelForTab(tab: RiverType): Record<string, string | undefined> {
  return {
    색인도: riverBasicPlanIndexDefineTable(tab),
    종단면도: riverBasicPlanJdDefineTable(tab),
    횡단면도: riverBasicPlanHdDefineTable(tab),
    /** 단일 레이어 토글이 아니라 구조물도 그룹(분할 자식만 WMS, 소하천은 부모만) */
    구조물도: riverBasicPlanGdParentDefineTable(tab),
  };
}

function indexListDisplayLabel(river: string, indexNo: string) {
  const n = String(river ?? "").trim();
  const num = String(indexNo ?? "").trim();
  if (!n) return num ? `색인도 ${num}` : "";
  return num ? `${n} 색인도 ${num}` : "";
}

type PlanItem = {
  planYear: string;
  planName: string;
  planLen: string;
  rivpName: string;
  rivpSuffix: string;
};

export type RiverBasicPlanPreferredPlan = {
  planYear: string;
  planName: string;
  /** rivp_name 의 `_1차`/`_2차` 접미사만 (없으면 "") */
  rivpSuffix: string;
  planLen?: string;
  /** 보고서별 하천 목록에서 고를 때 — 하천 보고서 폴더({하천구분}_{하천코드}_…)를 바로 찾는 데 씀 */
  riverType?: string;
  riverCode?: string;
};

/** 연장 숫자 문자열 정규화 (20860.0000000000 → 20860) */
function planLenMatchKey(raw: string | undefined | null): string {
  const t = String(raw ?? "").trim().replace(/,/g, "");
  if (!t) return "";
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : t;
}

/** 지도·목록 pick → 연도 목록에서 기본계획 1건 (연장·rivp 접미사 우선) */
function findPlanItemFromMapPick(
  list: PlanItem[],
  planYear: string,
  planName: string,
  planLen: string,
  rivpSuffix?: string,
): PlanItem | undefined {
  if (list.length === 0 || !(planYear || planName || planLen || rivpSuffix)) return undefined;
  const lenKey = planLenMatchKey(planLen);
  const suffix = String(rivpSuffix ?? "").trim();
  if (suffix && lenKey) {
    const withBoth = list.find(
      (p) =>
        p.planYear === planYear &&
        p.planName === planName &&
        p.rivpSuffix === suffix &&
        planLenMatchKey(p.planLen) === lenKey,
    );
    if (withBoth) return withBoth;
  }
  if (rivpSuffix !== undefined) {
    const withSuffix = list.find(
      (p) => p.planYear === planYear && p.planName === planName && p.rivpSuffix === suffix,
    );
    if (withSuffix) return withSuffix;
  }
  if (lenKey) {
    const withLen = list.find(
      (p) =>
        p.planYear === planYear &&
        p.planName === planName &&
        planLenMatchKey(p.planLen) === lenKey,
    );
    if (withLen) return withLen;
  }
  return (
    list.find((p) => p.planYear === planYear && p.planName === planName) ||
    (planYear ? list.find((p) => p.planYear === planYear) : undefined)
  );
}

type Props = {
  tab: RiverType;
  riverName: string;
  /** 보고서별 목록에서 고른 계획 — 상세 연도 목록 초기 선택 */
  preferredPlan?: RiverBasicPlanPreferredPlan | null;
  /** 상세에서 연도표 계획 변경 시 목록 동기화 */
  onSelectedPlanChange?: (plan: RiverBasicPlanPreferredPlan) => void;
  /** 상세 패널만 닫기 (목록 패널은 유지) */
  onClose?: () => void;
  /** 보고서별 보기 — 보고서를 목록에서 이미 골랐으므로 연도·기본계획 표를 숨김 */
  hidePlanTable?: boolean;
  /**
   * 보고서별 보기 — 보고서 전체는 목록 카드에서 열므로, 상세 «보고서»는 이 하천 전용 폴더에 PDF 가 있을 때만 보임.
   * (하천별로 나뉘지 않은 보고서는 숨김)
   */
  reportButtonRiverFolderOnly?: boolean;
};

export function RiverBasicPlanDetailPanel({
  tab,
  riverName,
  preferredPlan = null,
  onSelectedPlanChange,
  onClose,
  hidePlanTable = false,
  reportButtonRiverFolderOnly = false,
}: Props) {
  const { data: session } = useSession();
  const showReportFolderHint = session?.user?.id === "su";
  const mapContext = useMapContext();
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setServiceWmsCqlByLayer = mapContext?.setServiceWmsCqlByLayer;
  const serviceWmsStyleByLayer = mapContext?.serviceWmsStyleByLayer ?? null;
  const setServiceWmsStyleByLayer = mapContext?.setServiceWmsStyleByLayer;
  const selectedPlanRef = mapContext?.riverBasicPlanSelectedPlanRef;
  const indexLayer = riverBasicPlanIndexDefineTable(tab);
  const planAsLayer = riverBasicPlanAsDefineTable(tab);
  const jdLayer = riverBasicPlanJdDefineTable(tab);
  const hdLayer = riverBasicPlanHdDefineTable(tab);
  const structureParent = riverBasicPlanGdParentDefineTable(tab);
  const jbLayer = riverBasicPlanJbDefineTable(tab);
  const layerByLabel = useMemo(() => layerByLabelForTab(tab), [tab]);
  const existingMapLayers = useRiverBasicPlanExistingMapLayers(tab);
  const existingMapLayerSet = useMemo(
    () => new Set((existingMapLayers ?? []).map((n) => n.toLowerCase())),
    [existingMapLayers]
  );
  /** 구조물도 켜기 대기 — 자식 목록 도착 후 분할 레이어 ON */
  const pendingEnableStructureChildrenRef = useRef(false);
  /** define_table_parents_layer === 구조물 부모 인 자식 define_table_name (하천 선택 effect보다 먼저) */
  const [structureChildLayerNames, setStructureChildLayerNames] = useState<string[]>([]);

  /** 하천 선택 시 확장패널 칩 레이어 ON(보고서 제외). 구조물은 정적 WMS 목록으로 즉시 ON */
  useEffect(() => {
    if (!riverName.trim() || !setVisibleLayerNames || existingMapLayers == null) return;
    const otherTab: RiverType = tab === "smallRiver" ? "river" : "smallRiver";
    const allow = (name: string) => existingMapLayerSet.has(name.toLowerCase());
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      next.delete(riverBasicPlanIndexDefineTable(otherTab));
      next.delete(riverBasicPlanAsDefineTable(otherTab));
      next.delete(riverBasicPlanJdDefineTable(otherTab));
      next.delete(riverBasicPlanHdDefineTable(otherTab));
      for (const id of riverBasicPlanGdWmsDefineTables(otherTab)) next.delete(id);
      next.delete(riverBasicPlanGdParentDefineTable(otherTab));
      next.delete(riverBasicPlanJbDefineTable(otherTab));
      if (allow(indexLayer)) next.add(indexLayer);
      else next.delete(indexLayer);
      if (allow(planAsLayer)) next.add(planAsLayer);
      else next.delete(planAsLayer);
      if (allow(jdLayer)) next.add(jdLayer);
      else next.delete(jdLayer);
      if (allow(hdLayer)) next.add(hdLayer);
      else next.delete(hdLayer);
      next.delete(structureParent);
      /** 구조물: 정적 WMS 목록 ON. 하나도 없으면 부모라도 켜 칩이 꺼진 채로 보이지 않게 */
      let structureOn = false;
      for (const id of riverBasicPlanGdWmsDefineTables(tab)) {
        if (allow(id)) {
          next.add(id);
          structureOn = true;
        } else {
          next.delete(id);
        }
      }
      if (!structureOn && allow(structureParent)) {
        next.add(structureParent);
        structureOn = true;
      }
      if (allow(jbLayer)) next.add(jbLayer);
      else next.delete(jbLayer);
      return next;
    });
    /** defineLayer 자식이 나중에 오면 그 목록으로도 ON 보강 */
    pendingEnableStructureChildrenRef.current = tab === "river";
  }, [
    riverName,
    setVisibleLayerNames,
    tab,
    indexLayer,
    planAsLayer,
    jdLayer,
    hdLayer,
    structureParent,
    jbLayer,
    existingMapLayers,
    existingMapLayerSet,
  ]);

  /** 하천구역 «선만» 스타일은 탭 전환·상세 닫힘 시 해제 (다른 화면은 기본 스타일) */
  useEffect(() => {
    if (!setServiceWmsStyleByLayer) return;
    return () => {
      setServiceWmsStyleByLayer((prev) => {
        const keys = [riverBasicPlanAsDefineTable("river"), riverBasicPlanAsDefineTable("smallRiver")];
        if (!prev || !keys.some((k) => k in prev)) return prev;
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return Object.keys(next).length ? next : null;
      });
    };
  }, [tab, setServiceWmsStyleByLayer]);

  const areaMode: RiverPlanAreaMode = !visibleLayerNames.has(planAsLayer)
    ? "off"
    : serviceWmsStyleByLayer?.[planAsLayer] === PLAN_AS_LINE_STYLE
      ? "line"
      : "fill";

  const applyAreaMode = useCallback(
    (mode: RiverPlanAreaMode) => {
      setVisibleLayerNames?.((prev) => {
        if (mode === "off" ? !prev.has(planAsLayer) : prev.has(planAsLayer)) return prev;
        const next = new Set(prev);
        if (mode === "off") next.delete(planAsLayer);
        else next.add(planAsLayer);
        return next;
      });
      setServiceWmsStyleByLayer?.((prev) => {
        const next = { ...(prev ?? {}) };
        if (mode === "line") next[planAsLayer] = PLAN_AS_LINE_STYLE;
        else delete next[planAsLayer];
        return Object.keys(next).length ? next : null;
      });
    },
    [planAsLayer, setVisibleLayerNames, setServiceWmsStyleByLayer]
  );

  const [plans, setPlans] = useState<PlanItem[]>([]);
  const plansRef = useRef<PlanItem[]>([]);
  plansRef.current = plans;
  /** 연도 목록 비동기 로드 전·후 map pick의 planYear/planName/planLen 적용 */
  const pendingPlanFromMapRef = useRef<{
    planYear: string;
    planName: string;
    planLen: string;
  } | null>(null);
  /** 지도에서 누른 색인도 — 색인도 정보가 오면 목록에서 누를 때처럼 그 색인도로 확대 */
  const fitIndexFromMapRef = useRef<number | null>(null);
  /** 연도 목록 로드 시 초기 선택만 — deps에 넣지 않아 객체 참조 변경으로 재조회되지 않게 함 */
  const preferredPlanRef = useRef(preferredPlan);
  preferredPlanRef.current = preferredPlan;
  const [selected, setSelected] = useState<PlanItem | null>(null);
  /**
   * 같은 하천이 여러 보고서에 속할 때 목록에서 다른 보고서를 고르면 하천은 그대로라 연도 목록을 다시 안 불러옴
   * → 이미 불러온 연도 목록에서 고른 보고서로 바로 맞춤
   */
  const preferredPlanKey = preferredPlan
    ? `${preferredPlan.planYear}\0${preferredPlan.planName}\0${preferredPlan.rivpSuffix}\0${preferredPlan.planLen ?? ""}`
    : "";
  const [appliedPreferredKey, setAppliedPreferredKey] = useState(preferredPlanKey);
  if (appliedPreferredKey !== preferredPlanKey) {
    setAppliedPreferredKey(preferredPlanKey);
    if (preferredPlan && plans.length > 0) {
      const hit = findPlanItemFromMapPick(
        plans,
        preferredPlan.planYear,
        preferredPlan.planName,
        preferredPlan.planLen ?? "",
        preferredPlan.rivpSuffix,
      );
      const same =
        hit &&
        selected &&
        hit.planYear === selected.planYear &&
        hit.planName === selected.planName &&
        hit.planLen === selected.planLen &&
        hit.rivpName === selected.rivpName;
      if (hit && !same) setSelected(hit);
    }
  }
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexViewMode, setIndexViewMode] = useState(false);
  const [indexSectionOpen, setIndexSectionOpen] = useState(true);
  const [mapRequestedIndexOgcFid, setMapRequestedIndexOgcFid] = useState<number | null>(null);
  const [indexBundle, setIndexBundle] = useState<IndexBundle | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexList, setIndexList] = useState<IndexListItem[]>([]);
  const [indexListLoading, setIndexListLoading] = useState(false);
  const [indexListError, setIndexListError] = useState<string | null>(null);
  const setRiverBasicPlanIndexFromMap = mapContext?.setRiverBasicPlanIndexFromMap;

  /** 선택 기본계획 → 지도 CQL(기본계획도는 연도·명·연장까지). 식별과 WMS를 상세와 맞춤 */
  useEffect(() => {
    if (!setServiceWmsCqlByLayer || !riverName.trim()) return;
    setServiceWmsCqlByLayer(
      buildRiverBasicPlanMapCqlByLayer(tab, riverName, selected)
    );
  }, [tab, riverName, selected, setServiceWmsCqlByLayer]);

  /** 색인도 식별 시 현재 선택 연도 우선 매칭용 */
  useEffect(() => {
    if (!selectedPlanRef) return;
    selectedPlanRef.current = selected
      ? {
          planYear: selected.planYear,
          planName: selected.planName,
          planLen: selected.planLen,
        }
      : null;
    return () => {
      selectedPlanRef.current = null;
    };
  }, [selected, selectedPlanRef]);

  /** 색인도 상세 진입 시 해당 기본계획도(AS) 레이어가 꺼져 있으면 다시 켬 */
  useEffect(() => {
    if (!indexViewMode || !setVisibleLayerNames || existingMapLayers == null) return;
    if (!existingMapLayerSet.has(planAsLayer.toLowerCase())) return;
    setVisibleLayerNames((prev) => {
      if (prev.has(planAsLayer)) return prev;
      const next = new Set(prev);
      next.add(planAsLayer);
      return next;
    });
  }, [
    indexViewMode,
    planAsLayer,
    setVisibleLayerNames,
    existingMapLayers,
    existingMapLayerSet,
  ]);

  /** 색인도 상세 선택 시 데이터조회와 동일 펄스 폴리곤 강조 */
  const indexHighlightOgcFid =
    indexViewMode && mapRequestedIndexOgcFid != null && Number.isFinite(mapRequestedIndexOgcFid)
      ? Math.floor(mapRequestedIndexOgcFid)
      : null;
  useRiverBasicPlanIndexHighlight(
    indexLayer,
    indexHighlightOgcFid,
    Boolean(mapContext?.mapReady) && indexHighlightOgcFid != null
  );

  /** 색인도 상세목록(종단·횡단·구조물) 선택 강조 */
  const [relatedHighlight, setRelatedHighlight] = useState<{
    table: string;
    ogcFid: number;
  } | null>(null);

  const relatedItems = indexBundle?.related ?? [];
  const jbLayerOn = visibleLayerNames.has(jbLayer);

  /** 제방 레이어 ON + 색인도 상세 — 선택 시 해당만, 미선택 시 교차 제방 전체 펄스 */
  const jbPulseOgcFids = useMemo(() => {
    if (!jbLayerOn || !indexViewMode) return [];
    const jbItems = relatedItems.filter((r) => r.kind === "제방");
    if (relatedHighlight) {
      const hit = jbItems.find(
        (r) =>
          r.ogcFid === relatedHighlight.ogcFid && r.table === relatedHighlight.table
      );
      const fid = Number(hit?.ogcFid);
      return Number.isFinite(fid) && fid > 0 ? [Math.floor(fid)] : [];
    }
    return jbItems.map((r) => r.ogcFid).filter((n) => Number.isFinite(n) && n > 0);
  }, [jbLayerOn, indexViewMode, relatedHighlight, relatedItems]);

  const relatedHighlightIsJb =
    relatedHighlight != null &&
    relatedItems.some(
      (r) =>
        r.kind === "제방" &&
        r.ogcFid === relatedHighlight.ogcFid &&
        r.table === relatedHighlight.table
    );

  useRiverBasicPlanIndexHighlight(
    relatedHighlight?.table ?? "",
    relatedHighlight?.ogcFid ?? null,
    Boolean(mapContext?.mapReady) &&
      relatedHighlight != null &&
      !(jbLayerOn && relatedHighlightIsJb),
    "riverBasicPlanRelatedHighlight"
  );

  useRiverBasicPlanJbLabels({
    tab,
    riverName,
    active: Boolean(mapContext?.mapReady) && jbLayerOn && Boolean(riverName.trim()),
    pulseOgcFids: jbPulseOgcFids,
  });

  /** 기본계획(AS) 상세보기 필드 — 하드코딩 */
  const planDetailFields = useMemo(() => getRiverBasicPlanDetailFields(tab), [tab]);
  /** define_field_is_key — 데이터 조회 첨부와 동일 (file_data/river_d_index/{키}/) */
  const [indexTableKeyFieldName, setIndexTableKeyFieldName] = useState<string | null>(null);
  const [indexAttachmentPreview, setIndexAttachmentPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [relatedDrawingPreview, setRelatedDrawingPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [relatedDrawingLoadingKey, setRelatedDrawingLoadingKey] = useState<string | null>(null);
  const [reportPdfPreview, setReportPdfPreview] = useState<{
    items: ServiceFilePdfPreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [reportPdfLoading, setReportPdfLoading] = useState(false);
  const reportPdfBusyRef = useRef(false);

  /**
   * 보고서: file_data/{AS}/{plan_year}_{plan_name}_{rivp_name}/
   * 지방(+소하천 분리 시): …/{river_type}_{river_code}_{river_name}/
   */
  const reportPlanFolderKey = useMemo(
    () => buildRiverBasicPlanReportPlanFolderKey(detail),
    [detail]
  );
  const reportRiverSubCandidate = useMemo(
    () => buildRiverBasicPlanReportRiverSubfolderKey(detail),
    [detail]
  );
  /** 소하천: 하천 하위 폴더가 있을 때만 사용. 지방: 후보 그대로 */
  const [reportRiverSubfolder, setReportRiverSubfolder] = useState<string | null>(null);
  const [reportSubfolderResolving, setReportSubfolderResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const planKey = reportPlanFolderKey;
    const riverSub = reportRiverSubCandidate;
    if (!planKey) {
      setReportRiverSubfolder(null);
      setReportSubfolderResolving(false);
      return;
    }
    if (tab === "river") {
      setReportRiverSubfolder(riverSub);
      setReportSubfolderResolving(false);
      return;
    }
    if (!riverSub) {
      setReportRiverSubfolder(null);
      setReportSubfolderResolving(false);
      return;
    }
    setReportSubfolderResolving(true);
    const qs = new URLSearchParams({
      serEng: SER_FILE_ENG.riverBasicPlan,
      layer: planAsLayer,
      key: planKey,
      folders: "1",
    });
    appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return [] as string[];
        const data = (await r.json()) as { folders?: string[] };
        return Array.isArray(data.folders) ? data.folders : [];
      })
      .then((folders) => {
        if (cancelled) return;
        setReportRiverSubfolder(folders.includes(riverSub) ? riverSub : null);
      })
      .catch(() => {
        if (!cancelled) setReportRiverSubfolder(null);
      })
      .finally(() => {
        if (!cancelled) setReportSubfolderResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, reportPlanFolderKey, reportRiverSubCandidate, planAsLayer]);

  const reportFolderRel = useMemo(
    () =>
      reportPlanFolderKey != null
        ? riverBasicPlanReportRelativeDir(
            planAsLayer,
            reportPlanFolderKey,
            reportRiverSubfolder
          )
        : null,
    [planAsLayer, reportPlanFolderKey, reportRiverSubfolder]
  );

  /**
   * 보고서별 — 목록이 이미 받아 둔 보고서 폴더 구성으로 이 하천 보고서를 바로 찾음(상세·폴더 조회를 기다리지 않음).
   * null 이면 아직 판단할 수 없어 아래 폴더 조회로 확인한다.
   */
  const reportFolders = useRiverBasicPlanReportFolders(tab, reportButtonRiverFolderOnly);
  const fastRiverReportItems = useMemo((): ServiceFilePdfPreviewItem[] | null => {
    if (!reportButtonRiverFolderOnly || !reportFolders || !preferredPlan) return null;
    const planKey = buildRiverBasicPlanReportPlanFolderKeyFromParts(preferredPlan);
    if (!planKey) return null;
    const riverPdfs = reportFolders[planKey]?.riverPdfs ?? {};
    const riverType = preferredPlan.riverType || String(detail?.river_type ?? "").trim();
    const riverCode = preferredPlan.riverCode || String(detail?.river_code ?? "").trim();
    if (!riverType || !riverCode) return null;
    const sub = Object.keys(riverPdfs).find((n) => n.startsWith(`${riverType}_${riverCode}_`));
    if (!sub) return [];
    return (riverPdfs[sub] ?? []).map((name) => ({
      url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, planAsLayer, planKey, name, { subfolder: sub }),
      fileName: name,
    }));
  }, [reportButtonRiverFolderOnly, reportFolders, preferredPlan, detail, planAsLayer]);

  const reportFileQuery = useServiceFileData({
    serEng: SER_FILE_ENG.riverBasicPlan,
    enabled:
      fastRiverReportItems == null &&
      (!reportButtonRiverFolderOnly || reportRiverSubfolder != null) &&
      selected != null &&
      reportPlanFolderKey != null &&
      !loadingDetail &&
      !reportSubfolderResolving,
    layerSegment: planAsLayer,
    keyValue: reportPlanFolderKey,
    subfolder: reportRiverSubfolder,
    includeMeta: false,
  });

  const reportPdfItems = useMemo((): ServiceFilePdfPreviewItem[] => {
    if (fastRiverReportItems != null) return fastRiverReportItems;
    if (reportPlanFolderKey == null) return [];
    return reportFileQuery.files
      .filter((f) => isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(
          SER_FILE_ENG.riverBasicPlan,
          planAsLayer,
          reportPlanFolderKey,
          f.name,
          { subfolder: reportRiverSubfolder }
        ),
        fileName: f.name,
      }));
  }, [
    fastRiverReportItems,
    reportFileQuery.files,
    planAsLayer,
    reportPlanFolderKey,
    reportRiverSubfolder,
  ]);

  const hasReportPdf = reportPdfItems.length > 0;
  /** 보고서 파일 확인 중 — 미리 받아 둔 폴더 구성으로 판단했으면 기다리지 않음 */
  const reportChecking =
    fastRiverReportItems == null && (reportFileQuery.loading || reportSubfolderResolving);
  /** 보고서별 — 하천 전용 폴더 PDF 가 확인된 뒤에만 버튼 표시(확인 중·없음이면 숨김) */
  const showReportButton = !reportButtonRiverFolderOnly
    ? true
    : fastRiverReportItems != null
      ? hasReportPdf
      : reportRiverSubfolder != null && !reportChecking && hasReportPdf;
  const reportButtonDisabled =
    fastRiverReportItems != null
      ? !hasReportPdf || reportPdfLoading
      : !selected ||
        loadingDetail ||
        reportPlanFolderKey == null ||
        reportSubfolderResolving ||
        reportFileQuery.loading ||
        !hasReportPdf ||
        reportPdfLoading;

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    const name = String(riverName ?? "").trim();
    if (!name) return;
    const planYear = String(selected?.planYear ?? "").trim();
    const planName = String(selected?.planName ?? "").trim();
    const keyValue = planYear || planName ? `${name}|${planYear}|${planName}` : name;
    recordDataViewLog({
      tableName: planAsLayer,
      keyField: "river_name",
      keyValue,
      serviceName: "하천기본계획",
    });
  }, [riverName, selected?.planYear, selected?.planName, planAsLayer]);

  useEffect(() => {
    let cancelled = false;
    appFetch(`/api/config/defineLayer/fields/${encodeURIComponent(indexLayer)}`)
      .then((r) => r.json())
      .then((body: { data?: unknown[] }) => {
        const rawFields = Array.isArray(body?.data) ? body.data : [];
        const keyField = rawFields.find(
          (f) =>
            String((f as Record<string, unknown>).define_field_is_key ?? "").toLowerCase() === "true"
        );
        const name = keyField
          ? String((keyField as Record<string, unknown>).define_field_name ?? "").trim() || null
          : null;
        if (!cancelled) setIndexTableKeyFieldName(name);
      })
      .catch(() => {
        if (!cancelled) setIndexTableKeyFieldName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [indexLayer]);

  /** WMS에 올릴 구조물도 레이어: 분할 자식만(부모 제외, 소하천은 자식 없음) */
  const structureWmsLayerNames = useMemo(
    () => [...structureChildLayerNames],
    [structureChildLayerNames]
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/defineLayer")
      .then((r) => r.json())
      .then((body: { data?: unknown[] }) => {
        const tables = Array.isArray(body?.data) ? body.data : [];
        const children: string[] = [];
        for (const row of tables) {
          const r = row as Record<string, unknown>;
          if (String(r.define_table_parents_layer ?? "").trim() !== structureParent) continue;
          const n = String(r.define_table_name ?? "").trim();
          if (n) children.push(n);
        }
        if (!cancelled) setStructureChildLayerNames(children);
      })
      .catch(() => {
        if (!cancelled) setStructureChildLayerNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [structureParent]);

  /** 자식 목록이 생기면 WMS에서 부모만 켜져 있던 레거시 상태 정리 */
  useEffect(() => {
    if (!setVisibleLayerNames || structureChildLayerNames.length === 0) return;
    setVisibleLayerNames((prev) => {
      if (!prev.has(structureParent)) return prev;
      const next = new Set(prev);
      next.delete(structureParent);
      return next;
    });
  }, [structureChildLayerNames, setVisibleLayerNames, structureParent]);

  /**
   * 구조물 분할 자식 ON — 하천 선택 후 자식 목록이 오면 반드시 켠다.
   * 부모만 켜져 있던 과도 상태도 자식으로 교체해 칩·WMS를 맞춤.
   */
  useEffect(() => {
    if (!riverName.trim() || structureChildLayerNames.length === 0 || !setVisibleLayerNames) return;
    setVisibleLayerNames((prev) => {
      let changed = false;
      const next = new Set(prev);
      if (next.has(structureParent)) {
        next.delete(structureParent);
        changed = true;
      }
      for (const c of structureChildLayerNames) {
        const hit = [...next].some((n) => n.toLowerCase() === c.toLowerCase());
        if (!hit) {
          next.add(c);
          changed = true;
        }
      }
      pendingEnableStructureChildrenRef.current = false;
      return changed ? next : prev;
    });
  }, [riverName, structureChildLayerNames, setVisibleLayerNames, structureParent]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!riverName) {
        setPlans([]);
        setSelected(null);
        setDetail(null);
        return;
      }
      setLoadingPlan(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanYearList",
          params: { tab, riverName },
        });
        const data = res?.data ?? res;
        const nextPlans: PlanItem[] = (Array.isArray(data?.plans) ? data.plans : []).map(
          (raw: {
            planYear?: string;
            planName?: string;
            planLen?: string;
            rivpName?: string;
            rivpSuffix?: string;
          }) => {
            const rivpName = String(raw.rivpName ?? "").trim();
            const rivpSuffix =
              raw.rivpSuffix !== undefined
                ? String(raw.rivpSuffix ?? "").trim()
                : extractRiverBasicPlanRivpFolderSuffix(rivpName);
            return {
              planYear: String(raw.planYear ?? "").trim(),
              planName: String(raw.planName ?? "").trim(),
              planLen: String(raw.planLen ?? "").trim(),
              rivpName,
              rivpSuffix,
            };
          },
        );
        if (!alive) return;
        setPlans(nextPlans);
        let sel = nextPlans[0] ?? null;
        const pending = pendingPlanFromMapRef.current;
        if (pending && (pending.planYear || pending.planName || pending.planLen)) {
          const hit = findPlanItemFromMapPick(
            nextPlans,
            pending.planYear,
            pending.planName,
            pending.planLen,
          );
          if (hit) sel = hit;
          pendingPlanFromMapRef.current = null;
        } else {
          const pref = preferredPlanRef.current;
          if (pref && (pref.planYear || pref.planName || pref.rivpSuffix)) {
            const hit = findPlanItemFromMapPick(
              nextPlans,
              pref.planYear,
              pref.planName,
              pref.planLen ?? "",
              pref.rivpSuffix,
            );
            if (hit) sel = hit;
          }
        }
        setSelected(sel);
      } catch (e: unknown) {
        if (!alive) return;
        setPlans([]);
        setSelected(null);
        setDetail(null);
        setError(e instanceof Error ? e.message : "연도별 기본계획을 불러오지 못했습니다.");
      } finally {
        if (alive) setLoadingPlan(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [tab, riverName]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!riverName || !selected) {
        setDetail(null);
        return;
      }
      setLoadingDetail(true);
      setError(null);
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanDetail",
          params: {
            tab,
            riverName,
            planYear: selected.planYear,
            planName: selected.planName,
            planLen: selected.planLen,
            rivpName: selected.rivpName,
            rivpSuffix: selected.rivpSuffix,
          },
        });
        if (!alive) return;
        const data = res?.data ?? res;
        setDetail(data?.row ?? null);
      } catch (e: unknown) {
        if (!alive) return;
        setDetail(null);
        setError(e instanceof Error ? e.message : "기본계획 속성정보를 불러오지 못했습니다.");
      } finally {
        if (alive) setLoadingDetail(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [tab, riverName, selected]);

  useEffect(() => {
    setIndexViewMode(false);
    setMapRequestedIndexOgcFid(null);
    setIndexBundle(null);
    setIndexError(null);
    setIndexList([]);
    setIndexListError(null);
    setIndexAttachmentPreview(null);
    setRelatedDrawingPreview(null);
    setRelatedDrawingLoadingKey(null);
    setRelatedHighlight(null);
    setReportPdfPreview(null);
    setReportPdfLoading(false);
    pendingPlanFromMapRef.current = null;
  }, [tab, riverName]);

  useEffect(() => {
    const req = mapContext?.riverBasicPlanIndexFromMap;
    if (!req || !Number.isFinite(req.indexOgcFid)) return;
    const planYear = String(req.planYear ?? "").trim();
    const planName = String(req.planName ?? "").trim();
    const planLen = String(req.planLen ?? "").trim();
    pendingPlanFromMapRef.current = { planYear, planName, planLen };

    const list = plansRef.current;
    if (list.length > 0 && (planYear || planName || planLen)) {
      const hit = findPlanItemFromMapPick(list, planYear, planName, planLen);
      if (hit) {
        setSelected(hit);
        pendingPlanFromMapRef.current = null;
      }
    }

    const fid = Math.floor(req.indexOgcFid);
    if (fid > 0) {
      fitIndexFromMapRef.current = fid;
      setIndexViewMode(true);
      setMapRequestedIndexOgcFid(fid);
    } else {
      setIndexViewMode(false);
      setMapRequestedIndexOgcFid(null);
      setIndexBundle(null);
      setIndexError(null);
    }
    setRiverBasicPlanIndexFromMap?.(null);
  }, [mapContext?.riverBasicPlanIndexFromMap, setRiverBasicPlanIndexFromMap]);

  const exitIndexAttributeView = useCallback(() => {
    setIndexViewMode(false);
    setMapRequestedIndexOgcFid(null);
    setIndexBundle(null);
    setIndexError(null);
    setIndexAttachmentPreview(null);
    setRelatedDrawingPreview(null);
    setRelatedDrawingLoadingKey(null);
    setRelatedHighlight(null);
  }, []);

  const exitRef = mapContext?.riverBasicPlanExitIndexViewToDetailRef;
  useEffect(() => {
    if (!exitRef) return;
    exitRef.current = exitIndexAttributeView;
    return () => {
      exitRef.current = null;
    };
  }, [exitRef, exitIndexAttributeView]);

  useEffect(() => {
    if (!indexViewMode || !riverName || !selected || mapRequestedIndexOgcFid == null) return;
    setRelatedHighlight(null);
    let alive = true;
    const run = async () => {
      setIndexLoading(true);
      setIndexError(null);
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanIndexView",
          params: {
            tab,
            riverName,
            planYear: selected.planYear,
            planName: selected.planName,
            planLen: selected.planLen,
            indexOgcFid: mapRequestedIndexOgcFid,
          },
        });
        if (!alive) return;
        const data = res?.data ?? res;
        const idx = data?.index;
        const rel = Array.isArray(data?.related) ? data.related : [];
        const idxOgc = idx && typeof idx === "object" ? Number((idx as { ogcFid?: unknown }).ogcFid) : NaN;
        const indexParsed =
          idx && typeof idx === "object" && Number.isFinite(idxOgc)
            ? {
                row:
                  typeof (idx as { row?: unknown }).row === "object" &&
                  (idx as { row?: Record<string, unknown> }).row !== null
                    ? ((idx as { row: Record<string, unknown> }).row as Record<string, unknown>)
                    : {},
                extent3857: Array.isArray((idx as { extent3857?: unknown }).extent3857)
                  ? ((idx as { extent3857: number[] }).extent3857 as [number, number, number, number])
                  : null,
                ogcFid: idxOgc,
                ring3857: parseXyPairs((idx as { ring3857?: unknown }).ring3857),
                guide3857: parseXyPairs((idx as { guide3857?: unknown }).guide3857),
              }
            : null;
        const relatedParsed = rel.map((r: Record<string, unknown>) => {
          const kind = String(r.kind ?? "");
          const fileLayer = String(r.fileLayer ?? r.table ?? "").trim();
          const fileKey = String(r.fileKey ?? "").trim() || String(r.ogcFid ?? "");
          return {
            kind,
            table: String(r.table ?? ""),
            ogcFid: Number(r.ogcFid),
            label: String(r.label ?? ""),
            badge: String(r.badge ?? "").trim() || kind,
            fileLayer: fileLayer || String(r.table ?? ""),
            fileKey,
            extent3857: Array.isArray(r.extent3857)
              ? (r.extent3857 as [number, number, number, number])
              : null,
          };
        });
        setIndexBundle({
          index: indexParsed,
          related: relatedParsed.filter((r: IndexBundle["related"][number]) =>
            Number.isFinite(r.ogcFid)
          ),
        });
      } catch (e: unknown) {
        if (!alive) return;
        setIndexBundle(null);
        setIndexError(e instanceof Error ? e.message : "색인도 정보를 불러오지 못했습니다.");
      } finally {
        if (alive) setIndexLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [indexViewMode, mapRequestedIndexOgcFid, tab, riverName, selected]);

  useEffect(() => {
    if (!riverName || !selected) {
      setIndexList([]);
      setIndexListError(null);
      return;
    }
    let alive = true;
    const run = async () => {
      setIndexListLoading(true);
      setIndexListError(null);
      try {
        const res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanIndexList",
          params: {
            tab,
            riverName,
            planYear: selected.planYear,
            planName: selected.planName,
            planLen: selected.planLen,
          },
        });
        if (!alive) return;
        const data = res?.data ?? res;
        const rows = Array.isArray(data?.indexes) ? data.indexes : [];
        const parsed: IndexListItem[] = rows.flatMap((r: Record<string, unknown>) => {
          const fid = Number(r.ogcFid);
          if (!Number.isFinite(fid)) return [];
          const order = Number(r.order);
          return [{
            ogcFid: fid,
            label: String(r.label ?? "").trim() || String(fid),
            order: Number.isFinite(order) ? order : fid,
            badge: String(r.badge ?? "").trim() || "색인도",
            extent3857: Array.isArray(r.extent3857)
              ? (r.extent3857 as [number, number, number, number])
              : null,
          }];
        });
        parsed.sort((a, b) => a.order - b.order || a.ogcFid - b.ogcFid);
        setIndexList(parsed);
      } catch (e: unknown) {
        if (!alive) return;
        setIndexList([]);
        setIndexListError(e instanceof Error ? e.message : "색인도 목록을 불러오지 못했습니다.");
      } finally {
        if (alive) setIndexListLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [tab, riverName, selected?.planYear, selected?.planName, selected]);

  const mapInstanceRef = mapContext?.mapInstanceRef;
  const setRiverBasicPlanDrawingFromMap = mapContext?.setRiverBasicPlanDrawingFromMap;

  /** 색인도 그리드 클릭 시와 같이 — 패널·지도 전체화면 도면 미리보기를 끔(지도 식별로 연 미리보기 상태도 초기화) */
  const closeRiverBasicPlanDrawingOverlays = useCallback(() => {
    setRiverBasicPlanDrawingFromMap?.(null);
    mapContext?.riverBasicPlanMapDrawingPreviewControllerRef?.current?.close?.();
    setRelatedDrawingPreview(null);
    setIndexAttachmentPreview(null);
  }, [
    mapContext?.riverBasicPlanMapDrawingPreviewControllerRef,
    setRiverBasicPlanDrawingFromMap,
  ]);

  const fitMapToExtent3857 = useCallback(
    (ext: [number, number, number, number] | null | undefined) => {
      const map = mapInstanceRef?.current;
      if (!map || !ext || ext.length !== 4) return;
      scheduleFitMapToExtent3857(map, ext, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        fitPadding: [12, 12, 12, 12],
        pointThreshold: 1,
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    },
    [mapContext?.applyMapViewPaddingRef, mapInstanceRef]
  );

  useEffect(() => {
    const fid = fitIndexFromMapRef.current;
    const idx = indexBundle?.index;
    if (fid == null || !idx || idx.ogcFid !== fid) return;
    fitIndexFromMapRef.current = null;
    fitMapToExtent3857(idx.extent3857);
  }, [indexBundle, fitMapToExtent3857]);

  /**
   * WMS LAYERS 반영(setState) 이후에 fit 하도록 색인도 그리드와 동일한 체감을 맞춤.
   * 구조물 분할 자식은 defineLayer 도착 전 pending만 켜질 수 있어 한 번 더 지연 fit.
   */
  const scheduleFitToRelatedExtent3857 = useCallback(
    (
      ext: [number, number, number, number],
      opts: { structureDelayed: boolean }
    ) => {
      const run = () => fitMapToExtent3857(ext);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          run();
          if (opts.structureDelayed) {
            window.setTimeout(run, 240);
          }
        });
      });
    },
    [fitMapToExtent3857]
  );

  const indexRowKeyForFiles = useMemo(() => {
    const row = indexBundle?.index?.row;
    if (!row || !indexTableKeyFieldName) return null;
    return getRowKey(row, indexTableKeyFieldName);
  }, [indexBundle?.index?.row, indexTableKeyFieldName]);

  const indexSheetMode: IndexSheetMode | undefined = indexBundle?.index
    ? extent3857IsLandscape(indexBundle.index.extent3857)
      ? "landscape"
      : "portrait"
    : undefined;

  /** 서버에서 판정·저장한 색인도 방향 — { 색인도 첨부 키: 방향 } */
  const [indexRotationsState, setIndexRotationsState] = useState<{
    tab: RiverType;
    map: Record<string, number>;
  } | null>(null);
  const indexRotations = indexRotationsState?.tab === tab ? indexRotationsState.map : null;
  useEffect(() => {
    if (!indexViewMode) return;
    let cancelled = false;
    void call("", "POST", {
      service: "riverIndexOrientationService",
      action: "getRiverIndexOrientationRotations",
      params: { tab },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setIndexRotationsState({ tab, map: (data?.rotations as Record<string, number>) ?? {} });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, indexViewMode]);
  const indexFixedRotation =
    indexRowKeyForFiles != null ? (indexRotations?.[String(indexRowKeyForFiles)] ?? null) : null;

  const indexSheetGuide: IndexSheetGuide | undefined = useMemo(() => {
    if (indexFixedRotation != null) return { fixedRotation: indexFixedRotation };
    const guide = indexBundle?.index?.guide3857;
    if (guide == null || guide.length < 2) return undefined;
    return {
      ring3857: indexBundle?.index?.ring3857,
      guide3857: guide,
    };
  }, [indexBundle?.index?.guide3857, indexBundle?.index?.ring3857, indexFixedRotation]);

  const indexFileQuery = useServiceFileData({
    serEng: SER_FILE_ENG.riverBasicPlan,
    enabled: Boolean(
      indexViewMode && indexBundle?.index && indexTableKeyFieldName && indexRowKeyForFiles != null
    ),
    layerSegment: indexLayer,
    keyValue: indexRowKeyForFiles,
  });

  const indexFilePreview = useMemo(() => {
    const files = indexFileQuery.files;
    if (files.length === 0) return null;
    const img = files.find((f) => isImageServiceFileName(f.name));
    if (img) return { kind: "image" as const, file: img };
    const pdf = files.find((f) => isPdfServiceFileName(f.name));
    if (pdf) return { kind: "pdf" as const, file: pdf };
    return { kind: "other" as const, file: files[0] };
  }, [indexFileQuery.files]);

  /** 데이터 조회 첨부 탭과 동일: 이미지·PDF·엑셀 전체화면 갤러리 */
  const indexAttachmentGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (indexRowKeyForFiles == null) return [];
    return buildServiceFilePreviewGalleryItems(indexFileQuery.files, (fileName) =>
      serviceFileDataDownloadUrl(
        SER_FILE_ENG.riverBasicPlan,
        indexLayer,
        indexRowKeyForFiles,
        fileName
      )
    );
  }, [indexFileQuery.files, indexRowKeyForFiles, indexLayer]);

  const openIndexFullScreenPreview = useCallback(
    (fileName: string) => {
      const items = indexAttachmentGalleryItems;
      if (items.length === 0) return;
      const idx = items.findIndex((i) => i.fileName === fileName);
      setRelatedDrawingPreview(null);
      setIndexAttachmentPreview({
        items,
        initialIndex: idx >= 0 ? idx : 0,
      });
    },
    [indexAttachmentGalleryItems]
  );

  const openRelatedDrawingPreview = useCallback(async (r: IndexBundle["related"][number]) => {
    mapContext?.riverBasicPlanMapDrawingPreviewControllerRef?.current?.close?.();
    const layer = r.fileLayer?.trim();
    const key = r.fileKey?.trim();
    if (!layer || !key) {
      window.alert("첨부 경로를 확인할 수 없습니다.");
      return;
    }
    const loadKey = `${layer}\0${key}`;
    setIndexAttachmentPreview(null);
    setRelatedDrawingLoadingKey(loadKey);
    try {
      const qs = new URLSearchParams({
        serEng: SER_FILE_ENG.riverBasicPlan,
        layer,
        key,
      });
      const res = await appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof j.error === "string" ? j.error : "목록을 불러오지 못했습니다.");
      }
      const data = (await res.json()) as { files?: { name: string }[] };
      const files = Array.isArray(data.files) ? data.files : [];
      const items: ServiceFilePreviewItem[] = buildServiceFilePreviewGalleryItems(
        files,
        (fileName) => serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, layer, key, fileName)
      );
      if (items.length === 0) {
        window.alert("도면으로 볼 수 있는 첨부파일(이미지·PDF·엑셀)이 없습니다.");
        return;
      }
      setRelatedDrawingPreview({ items, initialIndex: 0 });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "첨부를 불러오지 못했습니다.");
    } finally {
      setRelatedDrawingLoadingKey(null);
    }
  }, [mapContext?.riverBasicPlanMapDrawingPreviewControllerRef]);

  const openReportPdfViewer = useCallback(async () => {
    if (reportPdfBusyRef.current || reportButtonDisabled) return;
    if (reportPdfItems.length === 0) return;
    if (fastRiverReportItems == null && (!selected || reportPlanFolderKey == null)) return;
    reportPdfBusyRef.current = true;
    setReportPdfLoading(true);
    try {
      setIndexAttachmentPreview(null);
      setRelatedDrawingPreview(null);
      setReportPdfPreview({ items: reportPdfItems, initialIndex: 0 });
    } finally {
      reportPdfBusyRef.current = false;
      setReportPdfLoading(false);
    }
  }, [selected, reportPlanFolderKey, reportPdfItems, reportButtonDisabled, fastRiverReportItems]);

  const detailEntries = useMemo(() => {
    const row = detail ?? {};
    return planDetailFields.map((f) => ({
      key: f.name,
      label: f.label,
      value: getRowValueByField(row, f.name),
    }));
  }, [detail, planDetailFields]);

  const actionButtons: { label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { label: "보고서", icon: FileText },
    { label: "하천구역", icon: Waves },
    { label: "색인도", icon: Map },
    { label: "구조물도", icon: Construction },
    { label: "종단면도", icon: FlipHorizontal },
    { label: "횡단면도", icon: FlipVertical },
    { label: "사업계획", icon: ClipboardList },
  ];

  /** 사업계획 — 포함 레이어(현재 제방)만 토글. 구조물도와 동일 패턴, 다른 레이어는 건드리지 않음 */
  const toggleBizPlanLayerGroup = useCallback(() => {
    if (!setVisibleLayerNames) return;
    if (!existingMapLayerSet.has(jbLayer.toLowerCase())) return;
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      if (next.has(jbLayer)) next.delete(jbLayer);
      else next.add(jbLayer);
      return next;
    });
  }, [setVisibleLayerNames, existingMapLayerSet, jbLayer]);

  const indexSectionHeader = (
    <div className="flex items-center justify-between gap-2 mb-2">
      <p className="text-[11px] font-medium text-muted-foreground">색인도</p>
      <button
        type="button"
        onClick={exitIndexAttributeView}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        title="색인도 목록으로"
        aria-label="색인도 목록으로"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  const toggleServiceLayer = (defineTableName: string) => {
    if (!setVisibleLayerNames) return;
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      if (next.has(defineTableName)) next.delete(defineTableName);
      else next.add(defineTableName);
      return next;
    });
  };

  const toggleStructureLayerGroup = useCallback(() => {
    if (!setVisibleLayerNames) return;
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      if (structureChildLayerNames.length === 0) {
        const on = !next.has(structureParent);
        if (on) next.add(structureParent);
        else next.delete(structureParent);
        pendingEnableStructureChildrenRef.current = false;
        return next;
      }
      const anyOn = structureChildLayerNames.some((n) => next.has(n));
      if (anyOn) {
        pendingEnableStructureChildrenRef.current = false;
        for (const n of structureChildLayerNames) next.delete(n);
        next.delete(structureParent);
        return next;
      }
      next.delete(structureParent);
      pendingEnableStructureChildrenRef.current = false;
      for (const n of structureChildLayerNames) next.add(n);
      return next;
    });
  }, [setVisibleLayerNames, structureChildLayerNames, structureParent]);

  /** 서버가 준 물리 테이블명·kind로 WMS define_table_name(종단/횡단/구조물 분할) 켜기 — 색인도 상세목록과 동일 목적 */
  const ensureRelatedItemLayerVisible = useCallback(
    (r: IndexBundle["related"][number]) => {
      if (!setVisibleLayerNames) return;
      const fl = (r.fileLayer || r.table || "").trim().toLowerCase();
      const jd = layerByLabel["종단면도"];
      const hd = layerByLabel["횡단면도"];
      const isJd = r.kind === "종단면도" || (jd && fl.startsWith(String(jd).toLowerCase()));
      const isHd = r.kind === "횡단면도" || (hd && fl.startsWith(String(hd).toLowerCase()));
      if (isJd && jd) {
        setVisibleLayerNames((prev) => {
          const next = new Set(prev);
          next.add(jd);
          return next;
        });
        return;
      }
      if (isHd && hd) {
        setVisibleLayerNames((prev) => {
          const next = new Set(prev);
          next.add(hd);
          return next;
        });
        return;
      }
      if (r.kind === "제방" || fl === jbLayer.toLowerCase()) {
        setVisibleLayerNames((prev) => {
          const next = new Set(prev);
          next.add(jbLayer);
          return next;
        });
        return;
      }
      if (
        r.kind === "구조물" ||
        fl.startsWith("river_plan_gd_ps") ||
        fl.startsWith("river_plan_s_gd_ps")
      ) {
        setVisibleLayerNames((prev) => {
          const next = new Set(prev);
          next.delete(structureParent);
          if (structureChildLayerNames.length === 0) {
            next.add(structureParent);
            pendingEnableStructureChildrenRef.current = false;
            return next;
          }
          pendingEnableStructureChildrenRef.current = false;
          for (const n of structureChildLayerNames) next.add(n);
          return next;
        });
      }
    },
    [setVisibleLayerNames, structureChildLayerNames, structureParent, layerByLabel, jbLayer],
  );

  return (
    <>
    <div className="flex flex-col min-h-0 h-full bg-background border-l border-border">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 bg-background">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {riverName || "기본계획 상세"}
          </p>
          {hidePlanTable && selected ? (
            <p
              className="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={`${selected.planYear} ${selected.rivpSuffix ? `${selected.planName}_${selected.rivpSuffix}` : selected.planName}`}
            >
              {selected.planYear} {selected.rivpSuffix ? `${selected.planName}_${selected.rivpSuffix}` : selected.planName}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-0.5">연도별 기본계획 및 속성정보</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {hidePlanTable ? null : (
      <div className="shrink-0 border-b border-border px-3 py-2 bg-muted/50">
        {loadingPlan ? (
          <p className="text-xs text-muted-foreground">연도 목록 불러오는 중...</p>
        ) : plans.length === 0 ? (
          <p className="text-xs text-muted-foreground">연도별 기본계획이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded border border-border bg-background">
            {/* 헤더 1행 + 본문 최대 3행. 초과 시 표 안 스크롤 */}
            <div className="max-h-[calc(1.75rem*4)] overflow-y-auto">
              <table className="w-full text-xs table-fixed">
                <thead className="sticky top-0 z-[1] bg-muted text-muted-foreground">
                  <tr>
                    <th className="h-7 px-2 py-1.5 text-left font-medium w-[64px]">연도</th>
                    <th className="h-7 px-2 py-1.5 text-left font-medium">기본계획</th>
                    <th className="h-7 px-2 py-1.5 text-left font-medium w-[72px]">연장</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p, idx) => {
                    const active =
                      selected?.planYear === p.planYear &&
                      selected?.planName === p.planName &&
                      selected?.planLen === p.planLen &&
                      selected?.rivpName === p.rivpName;
                    const planLabel = p.rivpSuffix
                      ? `${p.planName || "-"}_${p.rivpSuffix}`
                      : p.planName || "-";
                    return (
                      <tr
                        key={`${p.planYear}|${p.planName}|${p.planLen}|${p.rivpName}|${idx}`}
                        onClick={() => {
                          exitIndexAttributeView();
                          setSelected(p);
                          onSelectedPlanChange?.({
                            planYear: p.planYear,
                            planName: p.planName,
                            rivpSuffix: p.rivpSuffix,
                            planLen: p.planLen,
                          });
                        }}
                        className={
                          active
                            ? "bg-primary/10 text-primary cursor-pointer"
                            : "hover:bg-muted/50 text-foreground/90 cursor-pointer"
                        }
                      >
                        <td className="px-2 py-1.5 border-t border-border h-7">{p.planYear || "-"}</td>
                        <td className="px-2 py-1.5 border-t border-border h-7 truncate" title={planLabel}>
                          {planLabel}
                        </td>
                        <td className="px-2 py-1.5 border-t border-border h-7 whitespace-nowrap">
                          {p.planLen ? `${formatDetailScalarValue(p.planLen)} km` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      )}

      <div className="shrink-0 border-b border-border px-3 py-2 bg-background">
        <div className="grid grid-cols-12 gap-1 [&>*:nth-child(-n+4)]:col-span-3 [&>*:nth-child(n+5)]:col-span-4">
          {actionButtons.map(({ label, icon: Icon }) => {
            if (label === "보고서") {
              const disabled = !showReportButton || reportButtonDisabled;
              return (
                <button
                  key={label}
                  type="button"
                  title={
                    reportChecking
                      ? "보고서 확인 중"
                      : !disabled
                        ? reportButtonRiverFolderOnly
                          ? `${riverName} 보고서 PDF 보기`
                          : "선택 기본계획 보고서 PDF 보기"
                        : reportButtonRiverFolderOnly
                          ? "이 하천만의 보고서 없음 — 목록 카드의 보고서로 전체 보기"
                          : "보고서 PDF 없음"
                  }
                  disabled={disabled}
                  onClick={() => void openReportPdfViewer()}
                  className={cn(
                    "h-7 w-full text-[11px] rounded border min-w-0 overflow-hidden px-0.5 whitespace-nowrap inline-flex items-center justify-center gap-0.5 transition-colors",
                    disabled
                      ? "border-border bg-muted/50 text-muted-foreground opacity-50 cursor-not-allowed"
                      : "border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15",
                    reportPdfPreview != null && "ring-1 ring-inset ring-primary/40"
                  )}
                >
                  {reportChecking || reportPdfLoading ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  {label}
                </button>
              );
            }
            if (label === "하천구역") {
              return <RiverPlanAreaModeButton key={label} mode={areaMode} onChange={applyAreaMode} />;
            }
            if (label === "사업계획") {
              return (
                <button
                  key={label}
                  type="button"
                  title="사업계획 — 제방 레이어 켜기/끄기(다른 레이어는 유지)"
                  onClick={toggleBizPlanLayerGroup}
                  disabled={!existingMapLayerSet.has(jbLayer.toLowerCase())}
                  className={cn(
                    "h-7 w-full text-[11px] rounded border min-w-0 overflow-hidden px-0.5 whitespace-nowrap inline-flex items-center justify-center gap-0.5",
                    !existingMapLayerSet.has(jbLayer.toLowerCase())
                      ? "border-border bg-muted/50 text-muted-foreground opacity-50 cursor-not-allowed"
                      : jbLayerOn
                        ? "border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15"
                        : "border-border bg-muted/50 text-foreground/90 hover:bg-muted"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {label}
                </button>
              );
            }
            const layerName = layerByLabel[label];
            const isStructureGroup = label === "구조물도";
            const structureVisible =
              structureWmsLayerNames.some((n) => visibleLayerNames.has(n)) ||
              riverBasicPlanGdWmsDefineTables(tab).some((n) => visibleLayerNames.has(n)) ||
              Boolean(layerName && visibleLayerNames.has(layerName));
            const layerOn = isStructureGroup
              ? structureVisible
              : layerName
                ? visibleLayerNames.has(layerName)
                : false;
            return (
              <button
                key={label}
                type="button"
                title={
                  layerName
                    ? isStructureGroup
                      ? "구조물도 분할 레이어만 한꺼번에 켜기/끄기(부모 WMS 제외)"
                      : "데이터 조회 레이어와 동일하게 켜기/끄기"
                    : undefined
                }
                onClick={() => {
                  if (isStructureGroup) toggleStructureLayerGroup();
                  else if (layerName) toggleServiceLayer(layerName);
                }}
                disabled={!layerName}
                className={cn(
                  "h-7 w-full text-[11px] rounded border min-w-0 overflow-hidden px-0.5 whitespace-nowrap inline-flex items-center justify-center gap-0.5",
                  layerName
                    ? layerOn
                      ? "border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15"
                      : "border-border bg-muted/50 text-foreground/90 hover:bg-muted"
                    : "border-border bg-muted/50 text-foreground/90 hover:bg-muted opacity-80",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {indexViewMode ? (
          <>
            {indexError ? (
              <div className="p-3">
                {indexSectionHeader}
                <p className="text-sm text-destructive py-1">{indexError}</p>
              </div>
            ) : indexLoading ? (
              <div className="p-3">
                {indexSectionHeader}
                <p className="text-sm text-muted-foreground py-1">색인도 정보 불러오는 중...</p>
              </div>
            ) : !indexBundle?.index ? (
              <div className="p-3">
                {indexSectionHeader}
                <p className="text-sm text-muted-foreground py-1">
                  선택한 기본계획과 교차하는 색인도가 없습니다.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-4">
                {indexSectionHeader}
                <div
                  className={`rounded-lg border border-border overflow-hidden ${
                    indexSheetMode === "portrait" ? "bg-white" : "bg-muted"
                  }`}
                >
                  <div
                    className={
                      indexSheetMode === "portrait" ? INDEX_THUMB_FRAME_PORTRAIT : INDEX_THUMB_FRAME_LANDSCAPE
                    }
                    title={
                      indexTableKeyFieldName == null
                        ? "색인도 키 필드 미설정"
                        : indexRowKeyForFiles == null
                          ? "키 값 없음"
                          : indexFileQuery.error
                            ? indexFileQuery.error
                            : undefined
                    }
                  >
                    {indexTableKeyFieldName == null || indexRowKeyForFiles == null ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <FileImage className="h-16 w-16 text-muted-foreground opacity-50" aria-hidden />
                      </div>
                    ) : indexFileQuery.loading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted">
                        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
                      </div>
                    ) : indexFileQuery.error ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-rose-50">
                        <FileImage className="h-16 w-16 text-rose-300" aria-hidden />
                      </div>
                    ) : indexFileQuery.files.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <FileImage className="h-16 w-16 text-muted-foreground opacity-50" aria-hidden />
                      </div>
                    ) : indexFilePreview == null ? null : indexFilePreview.kind === "image" ? (
                      <button
                        type="button"
                        className="absolute inset-0 block cursor-zoom-in border-0 p-0"
                        onClick={() => openIndexFullScreenPreview(indexFilePreview.file.name)}
                        aria-label="첨부 전체화면 보기"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={serviceFileDataDownloadUrl(
                            SER_FILE_ENG.riverBasicPlan,
                            indexLayer,
                            indexRowKeyForFiles,
                            indexFilePreview.file.name
                          )}
                          alt=""
                          className={
                            indexSheetMode === "portrait"
                              ? "pointer-events-none absolute inset-0 h-full w-full object-contain"
                              : "pointer-events-none absolute inset-0 h-full w-full object-cover"
                          }
                        />
                      </button>
                    ) : indexFilePreview.kind === "pdf" ? (
                      <button
                        type="button"
                        className={`absolute inset-0 block cursor-zoom-in border-0 p-0 ${
                          indexSheetMode === "portrait" ? "bg-white" : "bg-muted"
                        }`}
                        onClick={() => openIndexFullScreenPreview(indexFilePreview.file.name)}
                        aria-label="PDF 전체화면 보기"
                      >
                        <ServiceFilePdfThumb
                          serEng={SER_FILE_ENG.riverBasicPlan}
                          layerSegment={indexLayer}
                          keyValue={indexRowKeyForFiles}
                          fileName={indexFilePreview.file.name}
                          thumbMaxPx={960}
                          unboxed
                          indexSheetMode={indexSheetMode}
                          indexSheetGuide={indexSheetGuide}
                          objectFit={indexSheetMode === "portrait" ? "contain" : "cover"}
                          className="pointer-events-none absolute inset-0 h-full w-full"
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          triggerServiceFileDownload(
                            serviceFileDataDownloadUrl(
                              SER_FILE_ENG.riverBasicPlan,
                              indexLayer,
                              indexRowKeyForFiles,
                              indexFilePreview.file.name
                            ),
                            indexFilePreview.file.name
                          )
                        }
                        className="absolute inset-0 flex items-center justify-center bg-muted transition-colors hover:bg-muted"
                        title={indexFilePreview.file.name}
                      >
                        <FileText className="h-16 w-16 text-muted-foreground" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-2">상세목록</p>
                  {relatedItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      연결된 구조물·제방·종단·횡단 항목이 없습니다.
                    </p>
                  ) : (
                    <ul className="rounded border border-border divide-y divide-border bg-background">
                      {relatedItems.map((r) => {
                        const rowKey = `${r.fileLayer}\0${r.fileKey}`;
                        const drawingBusy = relatedDrawingLoadingKey === rowKey;
                        const relatedSelected =
                          relatedHighlight != null &&
                          relatedHighlight.ogcFid === r.ogcFid &&
                          relatedHighlight.table === r.table;
                        return (
                          <li key={`${r.kind}-${r.table}-${r.ogcFid}`}>
                            <div className="flex items-stretch min-h-[30px]">
                              <button
                                type="button"
                                className={cn(
                                  "flex-1 min-w-0 text-left px-3 py-2 text-xs flex items-center gap-2",
                                  relatedSelected
                                    ? "bg-primary/10 text-primary"
                                    : "hover:bg-muted/50"
                                )}
                                title={r.label}
                                onClick={() => {
                                  closeRiverBasicPlanDrawingOverlays();
                                  const table = String(r.table ?? "").trim();
                                  const fid = Number(r.ogcFid);
                                  const sameSelected =
                                    relatedHighlight != null &&
                                    Number.isFinite(fid) &&
                                    fid > 0 &&
                                    relatedHighlight.ogcFid === Math.floor(fid) &&
                                    relatedHighlight.table === table;
                                  /** 같은 행 재클릭 시 선택·펄스 해제 */
                                  if (sameSelected) {
                                    setRelatedHighlight(null);
                                    return;
                                  }
                                  ensureRelatedItemLayerVisible(r);
                                  if (table && Number.isFinite(fid) && fid > 0) {
                                    setRelatedHighlight({ table, ogcFid: Math.floor(fid) });
                                  } else {
                                    setRelatedHighlight(null);
                                  }
                                  const ext = r.extent3857;
                                  const ok =
                                    Array.isArray(ext) &&
                                    ext.length === 4 &&
                                    ext.map((v) => Number(v)).every((n) => Number.isFinite(n));
                                  /** 색인도 그리드와 동일: 유효한 extent 있을 때만 해당 도형으로 이동(색인 폴리곤 폴백 제거) */
                                  if (!ok) return;
                                  scheduleFitToRelatedExtent3857(ext, {
                                    structureDelayed:
                                      (r.kind === "구조물" ||
                                        (r.fileLayer || r.table || "")
                                          .toLowerCase()
                                          .startsWith("river_plan_gd_ps") ||
                                        String(r.fileLayer ?? "")
                                          .toLowerCase()
                                          .startsWith("river_plan_s_gd_ps")) &&
                                      structureChildLayerNames.length === 0,
                                  });
                                }}
                              >
                                <span
                                  className="inline-flex h-5 w-14 shrink-0 items-center justify-center truncate rounded bg-muted px-0.5 text-center text-[10px] font-medium leading-none text-muted-foreground"
                                  title={r.badge}
                                >
                                  {r.badge}
                                </span>
                                <span className="text-foreground min-w-0 truncate">{r.label}</span>
                              </button>
                              <button
                                type="button"
                                className="shrink-0 w-8 flex items-center justify-center border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                                title="도면보기"
                                aria-label="도면보기"
                                disabled={drawingBusy || !r.fileLayer?.trim() || !r.fileKey?.trim()}
                                onClick={() => void openRelatedDrawingPreview(r)}
                              >
                                {drawingBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <Images className="h-4 w-4" aria-hidden />
                                )}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-3 space-y-4">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">하천기본계획</p>
              {error ? (
                <p className="text-sm text-destructive py-1">{error}</p>
              ) : loadingDetail ? (
                <p className="text-sm text-muted-foreground py-1">속성정보 불러오는 중...</p>
              ) : !detail || detailEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-1">속성정보가 없습니다.</p>
              ) : (
                <div className="overflow-hidden rounded border border-border grid grid-cols-[max-content_minmax(0,1fr)]">
                  {detailEntries.map((entry, idx) => (
                    <div key={entry.key} className="contents">
                      <div
                        className={`bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap ${
                          idx !== detailEntries.length - 1 ? "border-b border-border" : ""
                        }`}
                      >
                        {entry.label}
                      </div>
                      <div
                        className={`min-w-0 px-2.5 py-1.5 text-[11px] text-muted-foreground break-all ${
                          idx !== detailEntries.length - 1 ? "border-b border-border" : ""
                        }`}
                      >
                        {formatRiverBasicPlanAttrValue(
                          `${entry.key} ${entry.label}`,
                          entry.value
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setIndexSectionOpen((v) => !v)}
                  title={indexSectionOpen ? "색인도 접기" : "색인도 펼치기"}
                >
                  {indexSectionOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span>색인도</span>
                </button>
                {!indexListLoading && !indexListError && indexList.length > 0 ? (
                  <span className="text-[11px] text-muted-foreground">총 {indexList.length}건</span>
                ) : null}
              </div>
              {indexSectionOpen ? (
                indexListError ? (
                  <p className="text-sm text-destructive py-1">{indexListError}</p>
                ) : indexListLoading ? (
                  <p className="text-sm text-muted-foreground py-1">색인도 목록 불러오는 중...</p>
                ) : indexList.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-1">표시할 색인도 목록이 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {indexList.map((it) => (
                      <button
                        key={`index-list-${it.ogcFid}`}
                        type="button"
                        className="flex min-h-[40px] w-full items-center justify-start gap-1.5 rounded border border-border bg-background px-1.5 py-1.5 text-left text-[11px] font-medium leading-tight text-foreground hover:bg-muted/50"
                        title={it.badge}
                        onClick={() => {
                          setIndexViewMode(true);
                          setMapRequestedIndexOgcFid(it.ogcFid);
                          setIndexBundle(null);
                          setIndexError(null);
                          if (it.extent3857) fitMapToExtent3857(it.extent3857);
                        }}
                      >
                        <MapPin
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          {indexListDisplayLabel(riverName, it.label) || it.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              ) : null}
            </div>

          </div>
        )}
      </div>
    </div>
    {indexAttachmentPreview != null && (
      <ServiceFileImagePreview
        items={indexAttachmentPreview.items}
        initialIndex={indexAttachmentPreview.initialIndex}
        onClose={() => setIndexAttachmentPreview(null)}
        indexSheetMode={indexSheetMode}
        indexSheetGuide={indexSheetGuide}
      />
    )}
    {relatedDrawingPreview != null && (
      <ServiceFileImagePreview
        items={relatedDrawingPreview.items}
        initialIndex={relatedDrawingPreview.initialIndex}
        onClose={() => setRelatedDrawingPreview(null)}
      />
    )}
    {reportPdfPreview != null && (
      <ServiceFilePdfPreview
        items={reportPdfPreview.items}
        initialIndex={reportPdfPreview.initialIndex}
        onClose={() => setReportPdfPreview(null)}
        titleHint={showReportFolderHint ? reportFolderRel : null}
      />
    )}
    </>
  );
}

