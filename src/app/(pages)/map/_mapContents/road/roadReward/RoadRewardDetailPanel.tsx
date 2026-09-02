"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import GeoJSONFormat from "ol/format/GeoJSON";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { isEmpty as isEmptyExtent } from "ol/extent";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import { layerRowPanelButtonClass } from "../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles";
import type { LayerRowParcelItem } from "../../../_mapComponents/layerRowEdit";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../../searchBarOffsetContext";
import {
  fitMapToLayerRowParcel,
  fitMapToLayerRowParcels,
} from "../../../_mapComponents/layerRowEdit/layerRowParcelUtils";
import { useLayerRowParcelHighlight } from "../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import type { VWorldAddressItem } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import { call } from "@/lib/api";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import {
  ROAD_REWARD_CASE_FIELDS,
  createEmptyRoadRewardCase,
  getRoadRewardParcelFields,
  computeRoadRewardDerived,
  sumRoadRewardCompensation,
  withRoadRewardCompensationTotal,
  parseParcelJibunAddress,
  mergeJijukIntoRoadRewardParcels,
  type RoadRewardCase,
  type RoadRewardParcel,
} from "./roadRewardMock";
import {
  fetchJijukParcelsByGeometry3857,
  geometry3857ToWkt5181,
  olGeomToGeometry3857,
  unionGeometry3857,
} from "./roadRewardGeom";
import {
  ROAD_REWARD_NEW_ID,
  isNewRoadRewardCaseId,
  mapRoadRewardDtoToCase,
} from "./roadRewardApi";
import { RoadRewardParcelModal } from "./RoadRewardParcelModal";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";

type Props = {
  caseId: string;
  cases: RoadRewardCase[];
  onCasesChange: Dispatch<SetStateAction<RoadRewardCase[]>>;
  onClose: () => void;
  onDeleted: () => void;
  /** 신규 저장 후 임시 id → DB ogc_fid 로 교체 */
  onCaseIdChange?: (id: string) => void;
  /** 지도 필지 클릭 시 강조할 필지 id */
  focusParcelId?: string | null;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

const inputClass = "standard-detail-input h-7 w-full min-w-0 text-foreground";
const actionBtn =
  "standard-detail-action-btn inline-flex h-7 items-center gap-1";
const actionBtnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const actionBtnDanger =
  "standard-detail-action-btn-danger inline-flex h-7 items-center gap-1";

type ParcelModalState = { mode: "new" | "edit" | "view"; draft: RoadRewardParcel };

function ParcelListColGroup({ editing }: { editing: boolean }) {
  return (
    <colgroup>
      <col />
      <col className="w-[54px]" />
      <col className="w-[5.75rem]" />
      <col className="w-[90px]" />
      {editing ? <col className="w-[3rem]" /> : null}
    </colgroup>
  );
}

const PARCEL_LIST_TABLE_CLASS = "w-full table-fixed border-collapse text-[11px]";

/** 필지 목록 행 스크롤 — top은 sticky thead 아래 목록 최상단에 맞춤 */
function scrollParcelListRow(row: HTMLTableRowElement, mode: "nearest" | "top") {
  if (mode === "nearest") {
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  let node: HTMLElement | null = row.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      const thead = node.querySelector("thead");
      const theadH = thead?.getBoundingClientRect().height ?? 0;
      const containerTop = node.getBoundingClientRect().top;
      const targetTop = row.getBoundingClientRect().top;
      const nextTop = Math.max(0, targetTop - containerTop + node.scrollTop - theadH);
      node.scrollTo({ top: nextTop, behavior: "smooth" });
      return;
    }
    node = node.parentElement;
  }
  row.scrollIntoView({ block: "start", behavior: "smooth" });
}

const PARCEL_LIST_TH_BASE =
  "min-w-0 border-b border-border bg-muted font-semibold text-foreground";

const PARCEL_LIST_COL = {
  addr: {
    th: `${PARCEL_LIST_TH_BASE} pl-1.5 pr-1 text-left`,
    td: "min-w-0 py-0 pl-1.5 pr-1 text-left text-foreground",
  },
  jimok: {
    th: `${PARCEL_LIST_TH_BASE} px-1 text-center`,
    td: "min-w-0 px-1 py-0 text-center text-foreground",
  },
  area: {
    th: `${PARCEL_LIST_TH_BASE} px-1 text-center whitespace-nowrap`,
    td: "min-w-0 px-1 py-0 text-center tabular-nums text-foreground",
  },
  amount: {
    th: `${PARCEL_LIST_TH_BASE} pl-1 pr-1.5 text-right whitespace-nowrap`,
    td: "min-w-0 py-0 pl-1 pr-1.5 text-right tabular-nums text-foreground",
  },
} as const;

function ParcelListCell({
  align,
  title,
  children,
  className,
}: {
  align: "left" | "center" | "right";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const wrapClass =
    align === "center"
      ? "flex min-w-0 justify-center"
      : align === "right"
        ? "flex min-w-0 justify-end"
        : "min-w-0";
  return (
    <td className={cn(className, "align-middle")} title={title}>
      <div className={wrapClass}>
        <span className="block min-w-0 max-w-full truncate">{children}</span>
      </div>
    </td>
  );
}

function ParcelListHeaderRow({ editing }: { editing: boolean }) {
  return (
    <tr className="h-7">
      <th scope="col" className={PARCEL_LIST_COL.addr.th}>
        주소
      </th>
      <th scope="col" className={PARCEL_LIST_COL.jimok.th}>
        지목
      </th>
      <th scope="col" className={PARCEL_LIST_COL.area.th}>
        편입면적(㎡)
      </th>
      <th scope="col" className={PARCEL_LIST_COL.amount.th}>
        합계(원)
      </th>
      {editing ? (
        <th
          scope="col"
          className="border-b border-border bg-muted px-0 text-center font-semibold text-foreground"
        >
          <span className="sr-only">수정·삭제</span>
        </th>
      ) : null}
    </tr>
  );
}

function toParcelItem(p: RoadRewardParcel): LayerRowParcelItem {
  const addr = `${p.eupmyeonDong} ${p.jibunIncluded || p.jibunOriginal}`.trim();
  const hasMapGeom = Boolean(p.geometry3857) || Boolean(p.extent3857);
  return {
    address: addr || "필지",
    extent3857: p.extent3857 ?? null,
    geometry3857: p.geometry3857 ?? null,
    point4326:
      hasMapGeom && p.mockLonLat
        ? { x: p.mockLonLat.lon, y: p.mockLonLat.lat }
        : undefined,
  };
}

function formatCell(value: unknown, numeric?: boolean): string {
  if (numeric) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
  }
  const s = String(value ?? "").trim();
  return s || "—";
}

function AttrRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start">
      <div className="standard-detail-attr-label flex min-w-0 w-[64px] shrink-0 items-center self-stretch">
        <span className="min-w-0 w-full whitespace-normal break-keep text-left leading-snug">
          {label}
        </span>
      </div>
      <div className="standard-detail-attr-value min-w-0 flex-1 text-foreground">
        {typeof value === "string" ? (
          <span className="break-all leading-snug">{value}</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function AttrTable({
  entries,
}: {
  entries: { fieldKey: string; label: string; value: ReactNode; fullWidth?: boolean }[];
}) {
  if (entries.length === 0) {
    return <p className="standard-detail-attr-empty">표시할 항목이 없습니다.</p>;
  }

  const pairs: { left: (typeof entries)[number]; right?: (typeof entries)[number] }[] = [];
  for (let i = 0; i < entries.length; ) {
    const left = entries[i]!;
    if (left.fullWidth) {
      pairs.push({ left });
      i += 1;
      continue;
    }
    const right = entries[i + 1];
    if (right && !right.fullWidth) {
      pairs.push({ left, right });
      i += 2;
    } else {
      pairs.push({ left });
      i += 1;
    }
  }

  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      {pairs.map((pair, rowIdx) => {
        const isLast = rowIdx === pairs.length - 1;
        if (!pair.right) {
          return (
            <div key={pair.left.fieldKey} className={cn(!isLast && "border-b border-border")}>
              <AttrRow label={pair.left.label} value={pair.left.value} />
            </div>
          );
        }
        return (
          <div
            key={`${pair.left.fieldKey}-${pair.right.fieldKey}`}
            className={cn(
              "grid grid-cols-2 divide-x divide-border",
              !isLast && "border-b border-border"
            )}
          >
            <AttrRow label={pair.left.label} value={pair.left.value} />
            <AttrRow label={pair.right.label} value={pair.right.value} />
          </div>
        );
      })}
    </div>
  );
}

export function RoadRewardDetailPanel({
  caseId,
  cases,
  onCasesChange,
  onClose,
  onDeleted,
  onCaseIdChange,
  focusParcelId,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const isCreateMode = isNewRoadRewardCaseId(caseId);
  /** 신규는 목록에 행을 두지 않음 — 패널 안에서만 빈 초안 사용 */
  const caseItem = useMemo((): RoadRewardCase | null => {
    const found = cases.find((c) => c.id === caseId) ?? null;
    if (found) return found;
    if (isCreateMode) return { ...createEmptyRoadRewardCase(), id: caseId || ROAD_REWARD_NEW_ID };
    return null;
  }, [cases, caseId, isCreateMode]);

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    if (isCreateMode) return;
    const id = String(caseId ?? "").trim();
    if (!id) return;
    recordDataViewLog({
      tableName: "road_reward",
      keyField: "ogc_fid",
      keyValue: id,
      serviceName: "보상편입용지",
    });
  }, [caseId, isCreateMode]);

  const [isEditing, setIsEditing] = useState(() => isNewRoadRewardCaseId(caseId));
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [caseDraft, setCaseDraft] = useState<Record<string, string>>({});
  const caseDraftRef = useRef(caseDraft);
  caseDraftRef.current = caseDraft;
  const [draftGeom, setDraftGeom] = useState<{
    geometry3857: Record<string, unknown> | null;
    extent3857: [number, number, number, number] | null;
  }>({ geometry3857: null, extent3857: null });
  const draftGeomRef = useRef(draftGeom);
  draftGeomRef.current = draftGeom;
  const [draftParcels, setDraftParcels] = useState<RoadRewardParcel[]>([]);
  const draftParcelsRef = useRef(draftParcels);
  draftParcelsRef.current = draftParcels;

  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const parcelRowEls = useRef(new Map<string, HTMLTableRowElement>());
  /** 지도 필지 선택 시 목록을 최상단(sticky thead 아래)으로 스크롤 */
  const scrollParcelRowToTopRef = useRef(false);
  const [parcelModal, setParcelModal] = useState<ParcelModalState | null>(null);
  const parcelModalRef = useRef(parcelModal);
  parcelModalRef.current = parcelModal;

  /** 건 편입 범위 도형 편집 — draw | modify */
  const [caseGeomEditMode, setCaseGeomEditMode] = useState<"draw" | "modify" | null>(null);
  const [caseGeomModifyResetToken, setCaseGeomModifyResetToken] = useState(0);
  const [caseGeomDrawNonce, setCaseGeomDrawNonce] = useState(0);
  const [canRestoreGeom, setCanRestoreGeom] = useState(false);
  const caseGeomSnapshotRef = useRef<{
    geometry3857: Record<string, unknown>;
    extent3857: [number, number, number, number] | null;
  } | null>(null);
  /** 정점 수정 세션의 VectorSource — 「완료」 시에만 필지 조회하도록 드래그 중 조회를 막음 */
  const caseGeomEditSourceRef = useRef<VectorSource | null>(null);
  const [loadingParcels, setLoadingParcels] = useState(false);
  const [saving, setSaving] = useState(false);

  const { inputBottomPx } = useSearchBarOffset();
  const geomHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapInstance = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const geomCenterPixel = useMapVisualCenterPixel(
    mapInstance,
    Boolean(mapInstance) && caseGeomEditMode != null,
    mapPaddingLeft
  );

  const displayParcels = isEditing ? draftParcels : caseItem?.parcels ?? [];
  const displayGeom = isEditing
    ? draftGeom
    : {
        geometry3857: caseItem?.geometry3857 ?? null,
        extent3857: caseItem?.extent3857 ?? null,
      };

  /** 필지목록에서 선택한 필지 — 지도 강조 */
  const selectedParcelHighlight = useMemo((): LayerRowParcelItem | null => {
    if (!selectedParcelId) return null;
    const hit = displayParcels.find((p) => p.id === selectedParcelId);
    return hit ? toParcelItem(hit) : null;
  }, [displayParcels, selectedParcelId]);
  useLayerRowParcelHighlight(selectedParcelHighlight, "blue");

  /** 직접 그린 편입 범위 표시. 필지 선택은 위 강조 레이어로 표시. 편집 중엔 편집 레이어가 대신 그림 */
  useEffect(() => {
    if (caseGeomEditMode != null) return;
    const map = mapContext?.mapInstanceRef?.current;
    const geom = displayGeom.geometry3857;
    if (!map || !geom) return;

    const format = new GeoJSONFormat();
    let features: Feature[] = [];
    try {
      features = format.readFeatures(geom, {
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
      });
    } catch {
      return;
    }
    if (features.length === 0) return;

    const source = new VectorSource({ features });
    const layer = new VectorLayer({
      source,
      zIndex: 910,
      style: new Style({
        fill: new Fill({ color: "rgba(239, 68, 68, 0.12)" }),
        stroke: new Stroke({ color: "rgba(239, 68, 68, 0.95)", width: 2.5 }),
      }),
    });
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      source.clear();
    };
  }, [displayGeom.geometry3857, caseGeomEditMode, mapContext?.mapInstanceRef]);

  const parcelFields = useMemo(
    () =>
      getRoadRewardParcelFields({
        appraisal1Name: isEditing ? (caseDraft.appraisal1Name ?? "") : caseItem?.appraisal1Name ?? "",
        appraisal2Name: isEditing ? (caseDraft.appraisal2Name ?? "") : caseItem?.appraisal2Name ?? "",
      }),
    [isEditing, caseDraft.appraisal1Name, caseDraft.appraisal2Name, caseItem?.appraisal1Name, caseItem?.appraisal2Name]
  );

  useEffect(() => {
    setSelectedParcelId(null);
    setParcelModal(null);
    setCaseGeomEditMode(null);
    caseGeomSnapshotRef.current = null;
    setCanRestoreGeom(false);
    setLoadingParcels(false);
    setSaving(false);

    if (isNewRoadRewardCaseId(caseId)) {
      const empty = createEmptyRoadRewardCase();
      const next: Record<string, string> = {};
      for (const { field } of ROAD_REWARD_CASE_FIELDS) next[field] = String(empty[field] ?? "");
      setCaseDraft(next);
      setDraftGeom({ geometry3857: null, extent3857: null });
      setDraftParcels([]);
      draftParcelsRef.current = [];
      setAttrsOpen(true);
      setIsEditing(true);
      caseGeomSnapshotRef.current = null;
      setCaseGeomEditMode("draw");
      return;
    }

    setIsEditing(false);
    setDraftParcels([]);
    setDraftGeom({ geometry3857: null, extent3857: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caseId 전환 시에만
  }, [caseId]);

  /** 목록에서 건 선택 시 편입 범위(또는 필지목록) 위치로 지도 이동 */
  useEffect(() => {
    if (!caseItem || isCreateMode) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.();
    if (caseItem.extent3857) {
      scheduleFitMapToExtent3857(map, caseItem.extent3857, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        pointZoom: 16,
        applyMapViewPadding: applyPad,
      });
      return;
    }
    if (caseItem.parcels.length > 0) {
      fitMapToLayerRowParcels(map, caseItem.parcels.map(toParcelItem), {
        applyMapViewPadding: applyPad,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caseId 전환 시에만
  }, [caseId]);

  /** 지도 필지 클릭 — 부모 건 상세 오픈 후 해당 필지 선택·이동(조회 상세는 닫음) */
  useEffect(() => {
    if (!focusParcelId || isCreateMode) return;
    setParcelModal((m) => (m?.mode === "view" ? null : m));
    const parcel = displayParcels.find((p) => p.id === focusParcelId);
    if (!parcel) return;
    scrollParcelRowToTopRef.current = true;
    setSelectedParcelId(focusParcelId);
    const map = mapContext?.mapInstanceRef?.current;
    if (map) {
      fitMapToLayerRowParcel(map, toParcelItem(parcel), {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    }
  }, [focusParcelId, caseId, displayParcels, isCreateMode, mapContext]);

  useEffect(() => {
    if (!selectedParcelId) return;
    const row = parcelRowEls.current.get(selectedParcelId);
    if (!row) return;
    const scrollMode = scrollParcelRowToTopRef.current ? "top" : "nearest";
    scrollParcelRowToTopRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      scrollParcelListRow(row, scrollMode);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedParcelId]);

  const finishCaseGeomEdit = () => {
    setCaseGeomEditMode(null);
    caseGeomSnapshotRef.current = null;
    setCanRestoreGeom(false);
  };

  /**
   * 도형 반영 + 교차 필지 조회.
   * 그리기 완료(알림)는 필지가 있을 때만 도형을 남긴다.
   * commitGeom이면 도형을 먼저 반영한다(삭제·초기화·정점 수정).
   */
  const applyGeometryAndLoadParcels = async (
    geometry3857: Record<string, unknown> | null,
    extent3857: [number, number, number, number] | null,
    opts?: { silent?: boolean; commitGeom?: boolean }
  ): Promise<boolean> => {
    if (!geometry3857) {
      setDraftGeom({ geometry3857: null, extent3857: null });
      draftParcelsRef.current = [];
      setDraftParcels([]);
      return true;
    }
    if (opts?.commitGeom) {
      setDraftGeom({ geometry3857, extent3857 });
    }
    setLoadingParcels(true);
    try {
      const { parcels, error } = await fetchJijukParcelsByGeometry3857(geometry3857);
      if (error) {
        if (!opts?.silent) window.alert(error);
        return false;
      }
      const merged = mergeJijukIntoRoadRewardParcels(parcels, draftParcelsRef.current);
      if (!opts?.silent && merged.length === 0) {
        window.alert("겹치는 필지가 없습니다. 지적 위에서 범위를 그려 주세요.");
        return false;
      }
      setDraftGeom({ geometry3857, extent3857 });
      draftParcelsRef.current = merged;
      setDraftParcels(merged);
      return true;
    } finally {
      setLoadingParcels(false);
    }
  };

  const remountModifyLayer = () => {
    setCaseGeomEditMode("modify");
    setCaseGeomModifyResetToken((t) => t + 1);
  };

  const enterDrawMode = () => {
    if (caseGeomEditMode === "draw") {
      setCaseGeomDrawNonce((n) => n + 1);
      return;
    }
    setCaseGeomEditMode("draw");
  };

  /** 하천점용 «도형추가» — 그리기 모드로 전환 */
  const handleAddCaseGeom = () => {
    if (caseGeomEditMode === "draw") return;
    setCaseGeomEditMode("draw");
  };

  /** 초기화 — 수정 진입 시점 범위로 되돌림. 원본이 없으면 비우고 그리기 모드 */
  const handleResetCaseGeom = () => {
    const snap = caseGeomSnapshotRef.current;
    if (!snap?.geometry3857) {
      handleDeleteCaseGeom();
      return;
    }
    setDraftGeom({ geometry3857: snap.geometry3857, extent3857: snap.extent3857 });
    remountModifyLayer();
    void applyGeometryAndLoadParcels(snap.geometry3857, snap.extent3857, {
      silent: true,
      commitGeom: true,
    });
  };

  /** 도형삭제 — 범위·필지목록을 비우고 바로 그리기 모드 */
  const handleDeleteCaseGeom = () => {
    setDraftGeom({ geometry3857: null, extent3857: null });
    draftParcelsRef.current = [];
    setDraftParcels([]);
    enterDrawMode();
  };

  /** 편입 범위 그리기 — 끝나면 필지 조회 후 정점 수정 모드로 (하천점용과 동일) */
  useEffect(() => {
    if (caseGeomEditMode !== "draw" || !isEditing) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) {
      finishCaseGeomEdit();
      return;
    }
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) {
      finishCaseGeomEdit();
      return;
    }
    mapContext?.clearMapDrawInteractionsRef?.current?.();

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        fill: new Fill({ color: "rgba(239, 68, 68, 0.15)" }),
        stroke: new Stroke({ color: "#dc2626", width: 2.5 }),
      }),
    });
    const draw = new Draw({ source, type: "Polygon", stopClick: true });
    map.addLayer(layer);
    map.addInteraction(draw);

    const discardDrawnFeature = (feature: Feature) => {
      window.setTimeout(() => {
        if (source.hasFeature(feature)) source.removeFeature(feature);
      }, 0);
    };
    const onEnd = (evt: { feature: Feature }) => {
      const geom = evt.feature.getGeometry();
      const coords = geom?.getType() === "Polygon" ? (geom as Polygon).getCoordinates()[0] : null;
      if (!geom || !coords || coords.length < 4) {
        window.alert("다각형은 세 점 이상이어야 합니다.");
        discardDrawnFeature(evt.feature);
        return;
      }
      const converted = olGeomToGeometry3857(geom);
      if (!converted) {
        window.alert("도형을 저장하지 못했습니다.");
        discardDrawnFeature(evt.feature);
        return;
      }
      const hadExisting = Boolean(draftGeomRef.current.geometry3857);
      const existing = draftGeomRef.current.geometry3857;
      const next =
        existing != null
          ? unionGeometry3857(existing, converted.geometry3857) ?? converted
          : converted;
      void applyGeometryAndLoadParcels(next.geometry3857, next.extent3857).then((ok) => {
        if (ok) {
          setCaseGeomEditMode("modify");
          return;
        }
        discardDrawnFeature(evt.feature);
        if (hadExisting) setCaseGeomEditMode("modify");
      });
    };
    draw.on("drawend", onEnd as never);

    return () => {
      draw.un("drawend", onEnd as never);
      map.removeInteraction(draw);
      map.removeLayer(layer);
      source.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseGeomEditMode, isEditing, caseGeomDrawNonce]);

  /** 편입 범위 정점 수정 — 드래그 놓을 때(modifyend)만 필지 조회 (하천점용과 동일) */
  useEffect(() => {
    if (caseGeomEditMode !== "modify" || !isEditing) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    if (!draftGeom.geometry3857) {
      caseGeomEditSourceRef.current = null;
      return;
    }
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return;
    mapContext?.clearMapDrawInteractionsRef?.current?.();

    const format = new GeoJSONFormat();
    let features: Feature[] = [];
    try {
      features = format.readFeatures(draftGeom.geometry3857, {
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
      });
    } catch {
      features = [];
    }
    if (features.length === 0) return;

    const source = new VectorSource({ features });
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        fill: new Fill({ color: "rgba(239, 68, 68, 0.15)" }),
        stroke: new Stroke({ color: "#dc2626", width: 2.5 }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#dc2626" }),
          stroke: new Stroke({ color: "#fff", width: 1.5 }),
        }),
      }),
    });
    const modify = new Modify({ source });
    caseGeomEditSourceRef.current = source;
    map.addLayer(layer);
    map.addInteraction(modify);

    const extent = source.getExtent();
    if (!isEmptyExtent(extent)) {
      map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 280 });
    }

    const onModifyEnd = () => {
      const geom = source.getFeatures()[0]?.getGeometry();
      if (!geom) return;
      const converted = olGeomToGeometry3857(geom);
      if (!converted) return;
      void applyGeometryAndLoadParcels(converted.geometry3857, converted.extent3857, {
        silent: true,
        commitGeom: true,
      });
    };
    modify.on("modifyend", onModifyEnd);

    return () => {
      modify.un("modifyend", onModifyEnd);
      map.removeInteraction(modify);
      map.removeLayer(layer);
      source.clear();
      if (caseGeomEditSourceRef.current === source) caseGeomEditSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseGeomEditMode, caseGeomModifyResetToken, isEditing]);

  const hasCaseGeom = Boolean(draftGeom.geometry3857);
  const geomBannerHost =
    mapContext?.mapInstanceRef?.current?.getTargetElement()?.parentElement ?? null;

  /** 하천점용 LayerRowGeomEditHandler 배너와 동일 문구·버튼 */
  const geomHintText = loadingParcels
    ? "필지목록 조회 중…"
    : caseGeomEditMode === "draw"
      ? "지도에서 도형을 그려 주세요."
      : hasCaseGeom
        ? "도형을 수정하면 필지목록이 자동으로 갱신됩니다."
        : "도형추가 버튼으로 부모 도형을 그리세요.";

  const mapEditBanner =
    geomBannerHost && isEditing && caseGeomEditMode != null
      ? createPortal(
          <div
            className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/80 dark:text-red-300"
            style={
              geomCenterPixel
                ? { left: geomCenterPixel.x, top: geomHintTopPx }
                : { left: "50%", top: geomHintTopPx }
            }
          >
            <span className="whitespace-nowrap text-center">{geomHintText}</span>
            <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className={layerRowPanelButtonClass(
                  "default",
                  "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                )}
                disabled={caseGeomEditMode === "draw"}
                onClick={handleAddCaseGeom}
              >
                도형추가
              </button>
              {(canRestoreGeom || hasCaseGeom) && (
                <button
                  type="button"
                  className={layerRowPanelButtonClass(
                    "default",
                    "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                  )}
                  onClick={handleResetCaseGeom}
                >
                  초기화
                </button>
              )}
              <button
                type="button"
                className={layerRowPanelButtonClass("danger", "pointer-events-auto shrink-0")}
                onClick={handleDeleteCaseGeom}
              >
                도형삭제
              </button>
            </div>
          </div>,
          geomBannerHost
        )
      : null;

  if (!caseItem) {
    return (
      <div className="flex min-h-0 h-full flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-sm font-semibold text-foreground">보상편입용지 상세</span>
        </div>
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          삭제되었거나 존재하지 않는 건입니다.
        </div>
      </div>
    );
  }

  const beginEdit = () => {
    const next: Record<string, string> = {};
    for (const { field } of ROAD_REWARD_CASE_FIELDS) next[field] = String(caseItem[field] ?? "");
    setCaseDraft(next);
    const geometry3857 = caseItem.geometry3857 ?? null;
    const extent3857 = caseItem.extent3857 ?? null;
    setDraftGeom({ geometry3857, extent3857 });
    setDraftParcels(caseItem.parcels);
    draftParcelsRef.current = caseItem.parcels;
    setAttrsOpen(true);
    setIsEditing(true);
    if (geometry3857) {
      caseGeomSnapshotRef.current = { geometry3857, extent3857 };
      setCanRestoreGeom(true);
      setCaseGeomEditMode("modify");
    } else {
      caseGeomSnapshotRef.current = null;
      setCanRestoreGeom(false);
      setCaseGeomEditMode("draw");
    }
  };

  const discardCreateDraft = () => {
    finishCaseGeomEdit();
    setIsEditing(false);
    setDraftParcels([]);
    setDraftGeom({ geometry3857: null, extent3857: null });
    // 목록에 넣은 적 없음 — 선택만 해제
    onDeleted();
  };

  const cancelEdit = () => {
    if (isCreateMode) {
      discardCreateDraft();
      return;
    }
    finishCaseGeomEdit();
    setIsEditing(false);
    setDraftParcels([]);
    setDraftGeom({ geometry3857: null, extent3857: null });
  };

  const handleSave = async () => {
    const draft = caseDraftRef.current;
    const geom = draftGeomRef.current;
    const parcels = draftParcelsRef.current;
    if (!(draft.name ?? "").trim()) {
      window.alert("건명을 입력하세요.");
      return;
    }
    // 검증 통과 후에만 도형 편집 종료 — 실패 시 그리기/수정 모드 유지
    finishCaseGeomEdit();
    const geomWkt5181 = geom.geometry3857 ? geometry3857ToWkt5181(geom.geometry3857) : null;
    const isNew = isNewRoadRewardCaseId(caseId);
    setSaving(true);
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "saveRow",
        params: {
          ogcFid: isNew ? undefined : Number(caseId),
          isNew,
          values: {
            name: draft.name ?? "",
            org: draft.org ?? "",
            policy: draft.policy ?? "",
            unit: draft.unit ?? "",
            detail: draft.detail ?? "",
            budgetItem: draft.budgetItem ?? "",
            statItem: draft.statItem ?? "",
            appraisal1Name: draft.appraisal1Name ?? "",
            appraisal2Name: draft.appraisal2Name ?? "",
          },
          geomWkt5181,
          geomClear: !geomWkt5181,
          parcels: parcels.map((p) => ({
            ogcFid: isNewRoadRewardCaseId(p.id) ? undefined : Number(p.id),
            pnu: p.pnu,
            eupmyeonDong: p.eupmyeonDong,
            jibunOriginal: p.jibunOriginal,
            jibunIncluded: p.jibunIncluded,
            areaOriginal: p.areaOriginal,
            areaIncluded: p.areaIncluded,
            jimok: p.jimok,
            appraisal1Value: p.appraisal1Value,
            appraisal2Value: p.appraisal2Value,
            appliedUnitPrice: p.appliedUnitPrice,
            compensationAmount: p.compensationAmount,
            farmingCompensationAmount: p.farmingCompensationAmount,
            obstacleCompensationAmount: p.obstacleCompensationAmount,
            ownerAddress: p.ownerAddress,
            ownerName: p.ownerName,
            actualOwner: p.actualOwner,
            actualCultivator: p.actualCultivator,
            note: p.note,
            geomWkt5181: p.geometry3857 ? geometry3857ToWkt5181(p.geometry3857) : null,
          })),
        },
      });
      const data = res?.data ?? res;
      if (!data?.success) {
        window.alert(String(data?.error ?? "저장에 실패했습니다."));
        return;
      }
      const savedFid = Number(data.ogcFid);
      if (!Number.isFinite(savedFid)) {
        window.alert("저장 후 식별자를 확인하지 못했습니다.");
        return;
      }
      let mapped: RoadRewardCase | null = null;
      try {
        const detailRes = await call("", "POST", {
          service: "roadRewardService",
          action: "getDetailByOgcFid",
          params: { ogcFid: savedFid, fillPnuGeom: true },
        });
        const detailData = detailRes?.data ?? detailRes;
        if (detailData?.row) mapped = mapRoadRewardDtoToCase(detailData.row);
      } catch {
        /* 상세 재조회 실패 시 초안으로 목록 반영 */
      }
      if (!mapped) {
        mapped = {
          id: String(savedFid),
          name: (draft.name ?? "").trim(),
          org: draft.org ?? "",
          policy: draft.policy ?? "",
          unit: draft.unit ?? "",
          detail: draft.detail ?? "",
          budgetItem: draft.budgetItem ?? "",
          statItem: draft.statItem ?? "",
          appraisal1Name: draft.appraisal1Name ?? "",
          appraisal2Name: draft.appraisal2Name ?? "",
          geometry3857: geom.geometry3857,
          extent3857: geom.extent3857,
          parcels,
          parcelCount: parcels.length,
        };
      }
      onCasesChange((prev) => {
        const without = prev.filter((c) => c.id !== caseId && c.id !== mapped!.id);
        return [mapped!, ...without];
      });
      if (mapped.id !== caseId) onCaseIdChange?.(mapped.id);
      setIsEditing(false);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("이 건을 삭제하시겠습니까?")) return;
    if (isNewRoadRewardCaseId(caseId)) {
      onCasesChange((prev) => prev.filter((c) => c.id !== caseId));
      onDeleted();
      return;
    }
    try {
      const res = await call("", "POST", {
        service: "roadRewardService",
        action: "deleteRow",
        params: { ogcFid: Number(caseId) },
      });
      const data = res?.data ?? res;
      if (!data?.success) {
        window.alert(String(data?.error ?? "삭제에 실패했습니다."));
        return;
      }
      onCasesChange((prev) => prev.filter((c) => c.id !== caseId));
      onDeleted();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    }
  };

  const handleDraftChange = (field: string, value: string) => {
    setCaseDraft((prev) => ({ ...prev, [field]: value }));
  };

  const focusParcelOnMap = (parcel: RoadRewardParcel) => {
    setSelectedParcelId(parcel.id);
    const map = mapContext?.mapInstanceRef?.current;
    if (map) {
      fitMapToLayerRowParcel(map, toParcelItem(parcel), {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
    }
  };

  /** 조회: 행 클릭 시 읽기 전용 상세. 수정 모드: 행 클릭 시 지도만 이동 */
  const handleParcelRowClick = (parcel: RoadRewardParcel) => {
    focusParcelOnMap(parcel);
    if (!isEditing) {
      setParcelModal({ mode: "view", draft: { ...parcel } });
    }
  };

  const handleOpenEditParcel = (parcel: RoadRewardParcel) => {
    if (!isEditing) return;
    focusParcelOnMap(parcel);
    setParcelModal({ mode: "edit", draft: { ...parcel } });
  };

  const handleDeleteParcelFromList = (parcelId: string) => {
    if (!isEditing) {
      window.alert("상단 «수정»을 누른 뒤 필지를 삭제해 주세요. 저장 시에만 DB에 반영됩니다.");
      return;
    }
    if (!window.confirm("이 필지를 삭제하시겠습니까? (저장 시 반영)")) return;
    if (parcelModalRef.current?.draft.id === parcelId) setParcelModal(null);
    const next = draftParcelsRef.current.filter((p) => p.id !== parcelId);
    draftParcelsRef.current = next;
    setDraftParcels(next);
    if (selectedParcelId === parcelId) setSelectedParcelId(null);
  };

  const handleApplyParcelAddress = (item: VWorldAddressItem) => {
    const jibunAddr =
      (item.jibunAddress ?? "").trim() ||
      (item.address ?? "").trim() ||
      (item.roadAddress ?? "").trim();
    const { eupmyeonDong, jibun } = parseParcelJibunAddress(jibunAddr);
    setParcelModal((m) => {
      if (!m) return m;
      const next: RoadRewardParcel = {
        ...m.draft,
        eupmyeonDong: eupmyeonDong || m.draft.eupmyeonDong,
        jibunOriginal: jibun || m.draft.jibunOriginal,
      };
      if (!String(next.jibunIncluded ?? "").trim() && jibun) next.jibunIncluded = jibun;
      const lon = Number(item.point?.x);
      const lat = Number(item.point?.y);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        next.mockLonLat = { lon, lat };
      }
      return { ...m, draft: next };
    });
  };

  const handleParcelModalFieldChange = (
    field: keyof RoadRewardParcel,
    rawValue: string,
    numeric?: boolean
  ) => {
    setParcelModal((m) => {
      if (!m) return m;
      const next: RoadRewardParcel = numeric
        ? { ...m.draft, [field]: Number(rawValue) || 0 }
        : { ...m.draft, [field]: rawValue };
      if (field === "appraisal1Value" || field === "appraisal2Value" || field === "areaIncluded") {
        const { appliedUnitPrice, compensationAmount } = computeRoadRewardDerived(
          next.appraisal1Value,
          next.appraisal2Value,
          next.areaIncluded
        );
        next.appliedUnitPrice = appliedUnitPrice;
        next.compensationAmount = compensationAmount;
      }
      return { ...m, draft: withRoadRewardCompensationTotal(next) };
    });
  };

  const handleCloseParcelModal = () => setParcelModal(null);

  const handleSaveParcelModal = () => {
    const modal = parcelModalRef.current;
    if (!modal || modal.mode === "view") return;
    if (!isEditing) return;
    // 초안만 반영 — 건 «저장/등록» 시에만 insert/update
    const list =
      modal.mode === "new"
        ? [...draftParcelsRef.current, modal.draft]
        : draftParcelsRef.current.map((p) => (p.id === modal.draft.id ? modal.draft : p));
    draftParcelsRef.current = list;
    setDraftParcels(list);
    setParcelModal(null);
  };

  const caseViewEntries = ROAD_REWARD_CASE_FIELDS.map(({ field, label, fullWidth }) => ({
    fieldKey: field,
    label,
    fullWidth,
    value: String(caseItem[field] ?? "") || "—",
  }));

  const caseEditEntries = ROAD_REWARD_CASE_FIELDS.map(({ field, label, fullWidth }) => ({
    fieldKey: field,
    label,
    fullWidth,
    value: (
      <input
        className={inputClass}
        value={caseDraft[field] ?? ""}
        onChange={(e) => handleDraftChange(field, e.target.value)}
      />
    ),
  }));

  const headerName = isEditing
    ? (caseDraft.name ?? "").trim() || (isCreateMode ? "(새 건)" : "(건명 없음)")
    : caseItem.name.trim() || "(건명 없음)";

  return (
    <div className="standard-panel-root relative">
      <div className="standard-panel-header">
        <h2
          className={cn(
            "standard-panel-title truncate",
            (isEditing ? (caseDraft.name ?? "").trim() : caseItem.name.trim())
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          title={headerName}
        >
          {headerName}
        </h2>
        <button
          type="button"
          onClick={isCreateMode ? discardCreateDraft : onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="standard-detail-section">
        <div className="standard-detail-section-header">
          <button
            type="button"
            onClick={() => setAttrsOpen((v) => !v)}
            className="standard-detail-section-toggle"
            title="속성정보"
          >
            {attrsOpen ? (
              <ChevronDown className="standard-detail-section-chevron" />
            ) : (
              <ChevronRight className="standard-detail-section-chevron" />
            )}
            <span className="standard-detail-section-toggle-label">속성정보</span>
          </button>
          {attrsOpen ? (
            <div className="standard-detail-section-header-actions">
              {!isEditing ? (
                <>
                  <button type="button" className={actionBtn} onClick={beginEdit}>
                    <Pencil className="h-3 w-3" />
                    수정
                  </button>
                  {!isCreateMode ? (
                    <button
                      type="button"
                      className={actionBtnDanger}
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-3 w-3" />
                      삭제
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={actionBtn}
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className={actionBtnPrimary}
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? "저장 중…" : isCreateMode ? "등록" : "저장"}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        {attrsOpen ? (
          <div className="standard-detail-section-body max-h-[42vh] overflow-y-auto scrollbar-thin">
            <AttrTable entries={isEditing ? caseEditEntries : caseViewEntries} />
          </div>
        ) : null}
      </section>

      <section className="standard-detail-section flex min-h-0 min-w-0 flex-1 flex-col !border-b-0">
        <div className="standard-detail-section-header">
          <span className="standard-detail-section-toggle-label">필지목록 ({displayParcels.length.toLocaleString()})</span>
          {loadingParcels ? (
            <span className="text-[10px] font-normal text-muted-foreground">조회 중…</span>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
          {displayParcels.length === 0 ? (
            <p className="standard-detail-empty-dashed-compact">
              {isEditing
                ? "도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다."
                : "등록된 필지가 없습니다."}
            </p>
          ) : (
            <MapSideDetailScroll className="min-h-0 flex-1 overflow-y-auto rounded border border-border">
              <table className={PARCEL_LIST_TABLE_CLASS}>
                <ParcelListColGroup editing={isEditing} />
                <thead className="standard-table-thead">
                  <ParcelListHeaderRow editing={isEditing} />
                </thead>
                <tbody>
                    {displayParcels.map((p) => {
                      const isSelected = p.id === selectedParcelId;
                      const addr = `${p.eupmyeonDong} ${p.jibunIncluded || p.jibunOriginal}`.trim();
                      const areaLabel = `${formatCell(p.areaIncluded, true)}㎡`;
                      const amountLabel = `${formatCell(sumRoadRewardCompensation(p), true)}원`;
                      return (
                        <tr
                          key={p.id}
                          ref={(el) => {
                            if (el) parcelRowEls.current.set(p.id, el);
                            else parcelRowEls.current.delete(p.id);
                          }}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleParcelRowClick(p)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleParcelRowClick(p);
                            }
                          }}
                          title={
                            isEditing
                              ? "클릭하면 지도에서 위치를 확인합니다"
                              : "클릭하면 필지 상세를 봅니다"
                          }
                          className={cn(
                            "standard-list-row h-7 last:border-b-0",
                            isSelected && "standard-list-row-selected"
                          )}
                        >
                          <ParcelListCell
                            align="left"
                            className={PARCEL_LIST_COL.addr.td}
                            title={addr || undefined}
                          >
                            {addr || "—"}
                          </ParcelListCell>
                          <ParcelListCell
                            align="center"
                            className={PARCEL_LIST_COL.jimok.td}
                            title={p.jimok || undefined}
                          >
                            {formatCell(p.jimok)}
                          </ParcelListCell>
                          <ParcelListCell
                            align="center"
                            className={PARCEL_LIST_COL.area.td}
                            title={areaLabel}
                          >
                            {areaLabel}
                          </ParcelListCell>
                          <ParcelListCell
                            align="right"
                            className={PARCEL_LIST_COL.amount.td}
                            title={amountLabel}
                          >
                            {amountLabel}
                          </ParcelListCell>
                          {isEditing ? (
                            <td className="px-0 py-0">
                              <div
                                className="flex w-full shrink-0 items-center justify-center gap-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditParcel(p)}
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  aria-label="필지 수정"
                                  title="수정"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteParcelFromList(p.id)}
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                  aria-label="필지 삭제"
                                  title="삭제"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </MapSideDetailScroll>
          )}
        </div>
      </section>

      {parcelModal ? (
        <RoadRewardParcelModal
          parcel={parcelModal.draft}
          isNew={parcelModal.mode === "new"}
          readOnly={parcelModal.mode === "view"}
          parcelFields={parcelFields}
          vworldApiKey={vworldApiKey}
          onFieldChange={handleParcelModalFieldChange}
          onApplyParcelAddress={handleApplyParcelAddress}
          onSave={handleSaveParcelModal}
          onClose={handleCloseParcelModal}
          onDelete={
            parcelModal.mode === "edit"
              ? () => handleDeleteParcelFromList(parcelModal.draft.id)
              : undefined
          }
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
        />
      ) : null}

      {mapEditBanner}
    </div>
  );
}
