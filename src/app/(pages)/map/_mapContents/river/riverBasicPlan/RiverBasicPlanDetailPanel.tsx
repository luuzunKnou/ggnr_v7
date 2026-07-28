"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "@/lib/api";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDetailScalarValue } from "@/lib/formatDetailScalar";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  riverBasicPlanAsDefineTable,
  riverBasicPlanGdParentDefineTable,
  riverBasicPlanHdDefineTable,
  riverBasicPlanIndexDefineTable,
  riverBasicPlanJdDefineTable,
} from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { getRowKey } from "../../../_mapComponents/standard/defineLayerRowUtils";
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  serviceFileDataDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileData,
} from "../../../_mapComponents/standard/useServiceFileData";
import { ServiceFilePdfThumb } from "../../../_mapComponents/standard/ServiceFilePdfThumb";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";

type IndexBundle = {
  index: {
    row: Record<string, unknown>;
    extent3857: [number, number, number, number] | null;
    ogcFid: number;
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

/** 색인도 썸네일 프레임 비율 (가로 3 : 세로 2) */
const INDEX_THUMB_FRAME = "relative w-full aspect-[3/2] overflow-hidden bg-slate-200";

type RiverType = "river" | "smallRiver";

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
};

type Props = {
  tab: RiverType;
  riverName: string;
  /** 상세 패널만 닫기 (목록 패널은 유지) */
  onClose?: () => void;
};

export function RiverBasicPlanDetailPanel({ tab, riverName, onClose }: Props) {
  const mapContext = useMapContext();
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const indexLayer = riverBasicPlanIndexDefineTable(tab);
  const planAsLayer = riverBasicPlanAsDefineTable(tab);
  const structureParent = riverBasicPlanGdParentDefineTable(tab);
  const layerByLabel = useMemo(() => layerByLabelForTab(tab), [tab]);

  /** 하천 선택 시 색인도·기본계획 레이어는 항상 켜짐 (탭 전환 시 상대 레이어 교체) */
  useEffect(() => {
    if (!riverName.trim() || !setVisibleLayerNames) return;
    const otherTab: RiverType = tab === "smallRiver" ? "river" : "smallRiver";
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      next.delete(riverBasicPlanIndexDefineTable(otherTab));
      next.delete(riverBasicPlanAsDefineTable(otherTab));
      next.add(indexLayer);
      next.add(planAsLayer);
      return next;
    });
  }, [riverName, setVisibleLayerNames, tab, indexLayer, planAsLayer]);

  const [plans, setPlans] = useState<PlanItem[]>([]);
  const plansRef = useRef<PlanItem[]>([]);
  plansRef.current = plans;
  /** 연도 목록 비동기 로드 전·후 map pick의 planYear/planName 적용 */
  const pendingPlanFromMapRef = useRef<{ planYear: string; planName: string } | null>(null);
  const [selected, setSelected] = useState<PlanItem | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexViewMode, setIndexViewMode] = useState(false);
  const [mapRequestedIndexOgcFid, setMapRequestedIndexOgcFid] = useState<number | null>(null);
  const [indexBundle, setIndexBundle] = useState<IndexBundle | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexList, setIndexList] = useState<IndexListItem[]>([]);
  const [indexListLoading, setIndexListLoading] = useState(false);
  const [indexListError, setIndexListError] = useState<string | null>(null);
  const indexFitDoneRef = useRef<string | null>(null);
  const setRiverBasicPlanIndexFromMap = mapContext?.setRiverBasicPlanIndexFromMap;
  /** define_field_is_key — 데이터 조회 첨부와 동일 (file_data/river_d_index/{키}/) */
  const [indexTableKeyFieldName, setIndexTableKeyFieldName] = useState<string | null>(null);
  /** define_table_parents_layer === river_plan_gd_ps 인 자식 define_table_name */
  const [structureChildLayerNames, setStructureChildLayerNames] = useState<string[]>([]);
  const [indexAttachmentPreview, setIndexAttachmentPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [relatedDrawingPreview, setRelatedDrawingPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const [relatedDrawingLoadingKey, setRelatedDrawingLoadingKey] = useState<string | null>(null);
  /** 구조물도 켜기 클릭 시 자식 목록이 아직 없으면, 목록 도착 후 자식만 켜기 */
  const pendingEnableStructureChildrenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/config/defineLayer/fields/${encodeURIComponent(indexLayer)}`)
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

  /** 자식 목록이 늦게 도착했을 때, 켜기 대기 중이면 분할 자식만 추가·부모 제거 */
  useEffect(() => {
    if (structureChildLayerNames.length === 0 || !setVisibleLayerNames) return;
    if (!pendingEnableStructureChildrenRef.current) return;
    setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      next.delete(structureParent);
      for (const c of structureChildLayerNames) next.add(c);
      pendingEnableStructureChildrenRef.current = false;
      return next;
    });
  }, [structureChildLayerNames, setVisibleLayerNames, structureParent]);

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
        const nextPlans: PlanItem[] = Array.isArray(data?.plans) ? data.plans : [];
        if (!alive) return;
        setPlans(nextPlans);
        let sel = nextPlans[0] ?? null;
        const pending = pendingPlanFromMapRef.current;
        if (pending && (pending.planYear || pending.planName)) {
          const hit =
            nextPlans.find(
              (p) => p.planYear === pending.planYear && p.planName === pending.planName,
            ) ||
            (pending.planYear
              ? nextPlans.find((p) => p.planYear === pending.planYear)
              : undefined);
          if (hit) sel = hit;
          pendingPlanFromMapRef.current = null;
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
    indexFitDoneRef.current = null;
    pendingPlanFromMapRef.current = null;
  }, [tab, riverName]);

  useEffect(() => {
    const req = mapContext?.riverBasicPlanIndexFromMap;
    if (!req || !Number.isFinite(req.indexOgcFid)) return;
    const planYear = String(req.planYear ?? "").trim();
    const planName = String(req.planName ?? "").trim();
    pendingPlanFromMapRef.current = { planYear, planName };

    const list = plansRef.current;
    if (list.length > 0 && (planYear || planName)) {
      const hit =
        list.find((p) => p.planYear === planYear && p.planName === planName) ||
        (planYear ? list.find((p) => p.planYear === planYear) : undefined);
      if (hit) {
        setSelected(hit);
        pendingPlanFromMapRef.current = null;
      }
    }

    setIndexViewMode(true);
    setMapRequestedIndexOgcFid(Math.floor(req.indexOgcFid));
    setRiverBasicPlanIndexFromMap?.(null);
  }, [mapContext?.riverBasicPlanIndexFromMap, setRiverBasicPlanIndexFromMap]);

  const exitIndexAttributeView = useCallback(() => {
    setIndexViewMode(false);
    setMapRequestedIndexOgcFid(null);
    setIndexBundle(null);
    setIndexError(null);
    indexFitDoneRef.current = null;
    setIndexAttachmentPreview(null);
    setRelatedDrawingPreview(null);
    setRelatedDrawingLoadingKey(null);
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
        indexFitDoneRef.current = null;
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

  useEffect(() => {
    if (!indexViewMode || !indexBundle?.index?.extent3857) return;
    const k = `${selected?.planYear}-${selected?.planName}-${indexBundle.index.ogcFid}-${mapRequestedIndexOgcFid ?? ""}`;
    if (indexFitDoneRef.current === k) return;
    indexFitDoneRef.current = k;
    fitMapToExtent3857(indexBundle.index.extent3857);
  }, [
    indexViewMode,
    indexBundle,
    selected?.planYear,
    selected?.planName,
    mapRequestedIndexOgcFid,
    fitMapToExtent3857,
  ]);

  const indexRowKeyForFiles = useMemo(() => {
    const row = indexBundle?.index?.row;
    if (!row || !indexTableKeyFieldName) return null;
    return getRowKey(row, indexTableKeyFieldName);
  }, [indexBundle?.index?.row, indexTableKeyFieldName]);

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

  /** 데이터 조회 첨부 탭과 동일: 이미지·PDF만 전체화면 갤러리에 포함 */
  const indexAttachmentGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (indexRowKeyForFiles == null) return [];
    return indexFileQuery.files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(
          SER_FILE_ENG.riverBasicPlan,
          indexLayer,
          indexRowKeyForFiles,
          f.name
        ),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ("pdf" as const) : ("image" as const),
      }));
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
      const res = await fetch(`/api/service-files?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof j.error === "string" ? j.error : "목록을 불러오지 못했습니다.");
      }
      const data = (await res.json()) as { files?: { name: string }[] };
      const files = Array.isArray(data.files) ? data.files : [];
      const items: ServiceFilePreviewItem[] = files
        .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
        .map((f) => ({
          url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, layer, key, f.name),
          fileName: f.name,
          kind: isPdfServiceFileName(f.name) ? ("pdf" as const) : ("image" as const),
        }));
      if (items.length === 0) {
        window.alert("도면으로 볼 수 있는 첨부파일(이미지·PDF)이 없습니다.");
        return;
      }
      setRelatedDrawingPreview({ items, initialIndex: 0 });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "첨부를 불러오지 못했습니다.");
    } finally {
      setRelatedDrawingLoadingKey(null);
    }
  }, [mapContext?.riverBasicPlanMapDrawingPreviewControllerRef]);

  const detailEntries = useMemo(() => {
    const row = detail ?? {};
    return Object.entries(row).filter(([k]) => k !== "geom");
  }, [detail]);

  const actionButtons: { label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { label: "보고서", icon: FileText },
    { label: "색인도", icon: Map },
    { label: "구조물도", icon: Construction },
    { label: "종단면도", icon: FlipHorizontal },
    { label: "횡단면도", icon: FlipVertical },
  ];

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
        if (next.has(structureParent)) next.delete(structureParent);
        else next.add(structureParent);
        pendingEnableStructureChildrenRef.current = false;
        return next;
      }
      const anyChildOn = structureChildLayerNames.some((n) => next.has(n));
      if (anyChildOn) {
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
    [setVisibleLayerNames, structureChildLayerNames, structureParent, layerByLabel],
  );

  return (
    <>
    <div className="flex flex-col min-h-0 h-full bg-white border-l border-slate-200">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 bg-white">
        <div className="min-w-0 flex-1">
          {indexViewMode ? (
            <button
              type="button"
              onClick={exitIndexAttributeView}
              className="w-full text-left text-sm font-semibold text-slate-800 hover:underline"
              title="색인도 목록으로"
            >
              {riverName || "기본계획 상세"}
            </button>
          ) : (
            <p className="text-sm font-semibold text-slate-800">{riverName || "기본계획 상세"}</p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">연도별 기본계획 및 속성정보</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-slate-200 px-3 py-2 bg-slate-50/70">
        {loadingPlan ? (
          <p className="text-xs text-slate-500">연도 목록 불러오는 중...</p>
        ) : plans.length === 0 ? (
          <p className="text-xs text-slate-500">연도별 기본계획이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium w-[90px]">연도</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">기본계획</th>
                  <th className="px-2.5 py-1.5 text-left font-medium w-[110px]">연장</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, idx) => {
                  const active =
                    selected?.planYear === p.planYear &&
                    selected?.planName === p.planName &&
                    selected?.planLen === p.planLen;
                  return (
                    <tr
                      key={`${p.planYear}|${p.planName}|${p.planLen}|${idx}`}
                      onClick={() => {
                        exitIndexAttributeView();
                        setSelected(p);
                      }}
                      className={
                        active
                          ? "bg-blue-50 text-blue-700 cursor-pointer"
                          : "hover:bg-slate-50 text-slate-700 cursor-pointer"
                      }
                    >
                      <td className="px-2.5 py-1.5 border-t border-slate-200">{p.planYear || "-"}</td>
                      <td className="px-2.5 py-1.5 border-t border-slate-200">{p.planName || "-"}</td>
                      <td className="px-2.5 py-1.5 border-t border-slate-200">
                        {p.planLen ? `${p.planLen} km` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="shrink-0 border-b border-slate-200 px-3 py-2 bg-white">
        <div className="flex gap-1.5">
          {actionButtons.map(({ label, icon: Icon }) => {
            const layerName = layerByLabel[label];
            const isStructureGroup = label === "구조물도";
            const layerOn = isStructureGroup
              ? structureWmsLayerNames.length > 0
                ? structureWmsLayerNames.some((n) => visibleLayerNames.has(n))
                : Boolean(layerName && visibleLayerNames.has(layerName))
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
                  if (label === "보고서") {
                    return;
                  }
                  if (isStructureGroup) toggleStructureLayerGroup();
                  else if (layerName) toggleServiceLayer(layerName);
                }}
                disabled={label !== "보고서" && !layerName}
                className={cn(
                  "h-7 text-[11px] rounded border flex-1 min-w-0 whitespace-nowrap inline-flex items-center justify-center gap-1",
                  layerName
                    ? layerOn
                      ? "border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-100"
                      : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 opacity-80",
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
              <p className="text-sm text-red-600 px-4 py-4">{indexError}</p>
            ) : indexLoading ? (
              <p className="text-sm text-slate-500 px-4 py-4">색인도 정보 불러오는 중...</p>
            ) : !indexBundle?.index ? (
              <p className="text-sm text-slate-500 px-4 py-4">
                선택한 기본계획과 교차하는 색인도가 없습니다.
              </p>
            ) : (
              <div className="p-3 space-y-4">
                <p className="text-[11px] font-medium text-slate-600 mb-2">색인도</p>
                <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
                  <div
                    className={INDEX_THUMB_FRAME}
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
                        <FileImage className="h-16 w-16 text-slate-400 opacity-50" aria-hidden />
                      </div>
                    ) : indexFileQuery.loading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                        <Loader2 className="h-10 w-10 animate-spin text-slate-400" aria-hidden />
                      </div>
                    ) : indexFileQuery.error ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-rose-50">
                        <FileImage className="h-16 w-16 text-rose-300" aria-hidden />
                      </div>
                    ) : indexFileQuery.files.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <FileImage className="h-16 w-16 text-slate-400 opacity-50" aria-hidden />
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
                          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                        />
                      </button>
                    ) : indexFilePreview.kind === "pdf" ? (
                      <button
                        type="button"
                        className="absolute inset-0 block cursor-zoom-in border-0 bg-slate-900 p-0"
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
                        className="absolute inset-0 flex items-center justify-center bg-slate-100 transition-colors hover:bg-slate-200"
                        title={indexFilePreview.file.name}
                      >
                        <FileText className="h-16 w-16 text-slate-400" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-600 mb-2">상세목록</p>
                  {indexBundle.related.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2">연결된 구조물·종단·횡단 항목이 없습니다.</p>
                  ) : (
                    <ul className="rounded border border-slate-200 divide-y divide-slate-200 bg-white">
                      {indexBundle.related.map((r) => {
                        const rowKey = `${r.fileLayer}\0${r.fileKey}`;
                        const drawingBusy = relatedDrawingLoadingKey === rowKey;
                        return (
                          <li key={`${r.kind}-${r.table}-${r.ogcFid}`}>
                            <div className="flex items-stretch min-h-[30px]">
                              <button
                                type="button"
                                className="flex-1 min-w-0 text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2"
                                onClick={() => {
                                  closeRiverBasicPlanDrawingOverlays();
                                  ensureRelatedItemLayerVisible(r);
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
                                  className="inline-flex h-5 w-12 shrink-0 items-center justify-center truncate rounded bg-slate-100 px-0.5 text-center text-[10px] font-medium leading-none text-slate-600"
                                  title={r.badge}
                                >
                                  {r.badge}
                                </span>
                                <span className="text-slate-800 min-w-0 truncate">{r.label}</span>
                              </button>
                              <button
                                type="button"
                                className="shrink-0 w-8 flex items-center justify-center border-slate-100 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
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
              <p className="text-[11px] font-medium text-slate-600 mb-2">하천기본계획</p>
              {error ? (
                <p className="text-sm text-red-600 py-1">{error}</p>
              ) : loadingDetail ? (
                <p className="text-sm text-slate-500 py-1">속성정보 불러오는 중...</p>
              ) : !detail || detailEntries.length === 0 ? (
                <p className="text-sm text-slate-500 py-1">속성정보가 없습니다.</p>
              ) : (
                <div className="overflow-hidden rounded border border-slate-200">
                  {detailEntries.map(([k, v], idx) => (
                    <div
                      key={k}
                      className={`flex ${idx !== detailEntries.length - 1 ? "border-b border-slate-200" : ""}`}
                    >
                      <div className="w-[130px] shrink-0 bg-slate-100 px-2.5 py-1.5 text-[11px] text-[#666]">{k}</div>
                      <div className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] text-[#666] break-all">
                        {formatDetailScalarValue(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[11px] font-medium text-slate-600 mb-2">색인도</p>
              {indexListError ? (
                <p className="text-sm text-red-600 py-1">{indexListError}</p>
              ) : indexListLoading ? (
                <p className="text-sm text-slate-500 py-1">색인도 목록 불러오는 중...</p>
              ) : indexList.length === 0 ? (
                <p className="text-sm text-slate-500 py-1">표시할 색인도 목록이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {indexList.map((it) => (
                    <button
                      key={`index-list-${it.ogcFid}`}
                      type="button"
                      className="flex min-h-[40px] w-full items-center justify-start gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-1.5 text-left text-[11px] font-medium leading-tight text-slate-800 hover:bg-slate-50"
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
                        className="h-3.5 w-3.5 shrink-0 text-slate-500"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        {indexListDisplayLabel(riverName, it.label) || it.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
      />
    )}
    {relatedDrawingPreview != null && (
      <ServiceFileImagePreview
        items={relatedDrawingPreview.items}
        initialIndex={relatedDrawingPreview.initialIndex}
        onClose={() => setRelatedDrawingPreview(null)}
      />
    )}
    </>
  );
}

