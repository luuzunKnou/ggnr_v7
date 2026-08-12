"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  FileText,
  Download,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Trash2,
  User,
  Wrench,
  X,
  Paperclip,
} from "lucide-react";
import Draw from "ol/interaction/Draw";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom";
import Modify from "ol/interaction/Modify";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import { Style, Stroke, Circle as CircleStyle, Fill } from "ol/style";
import LineString from "ol/geom/LineString";
import { getLength } from "ol/sphere";
import { transform } from "ol/proj";
import { fromLonLat } from "ol/proj";
import { isEmpty as isEmptyExtent } from "ol/extent";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import { getAddressFromCoord } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import { layerRowPanelButtonClass } from "../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../../searchBarOffsetContext";
import { buildRoadNetworkReportHtml } from "./roadNetworkReport";
import { RoadNetworkSiteItemModal } from "./RoadNetworkSiteItemModal";
import {
  ROAD_NETWORK_COMPLAINT_STATE_FILTERS,
  ROAD_NETWORK_OPEN_STATUSES,
  ROAD_NETWORK_TYPE_BADGE,
  ROAD_NETWORK_TYPES,
  createAttachmentFromFile,
  createEmptyComplaintItem,
  createEmptyMaintenanceItem,
  createHistoryItem,
  describeAttrHistoryDetail,
  describeComplaintHistoryDetail,
  describeMaintHistoryDetail,
  revokeAttachmentPreview,
  type RoadNetworkAttachment,
  type RoadNetworkComplaintItem,
  type RoadNetworkComplaintStateFilter,
  type RoadNetworkGeom,
  type RoadNetworkMaintenanceItem,
  type RoadNetworkOpenStatus,
  type RoadNetworkPoint,
  type RoadNetworkRow,
  type RoadNetworkType,
} from "./roadNetworkMock";

type BottomTab = "maintenance" | "complaints" | "attachments" | "history";

type Props = {
  row: RoadNetworkRow;
  onClose: () => void;
  /** 유지보수·민원 편집 시트가 목록+상세 전체를 덮을 때 쓸 오버레이 위치·폭 */
  overlayLeftPx?: number;
  overlayWidthPx?: number;
};

function complaintStateStyle(state: string): { bg: string; text: string; border: string } {
  if (state === "완료") {
    return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
  }
  if (state === "처리중") {
    return { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" };
  }
  return { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" };
}

const fieldClass =
  "h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const labelClass = "mb-0.5 block text-[11px] text-slate-500";
const attrLabelClass = "w-14 shrink-0";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";
const btnDanger =
  "inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-white px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

/** 조회·수정 공통 속성 표 (행 단위 2열, fullWidth·홀수는 전체 너비) */
function AttrRow({
  label,
  value,
  showBottomBorder,
}: {
  label: string;
  value: ReactNode;
  showBottomBorder: boolean;
}) {
  return (
    <div className={cn("flex items-start", showBottomBorder && "border-b border-slate-200")}>
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center self-stretch bg-slate-100 px-1.5 py-1",
          attrLabelClass
        )}
      >
        <span className="min-w-0 w-full whitespace-normal break-keep text-[11px] leading-snug text-[#666]">
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1 px-1.5 py-1">
        {typeof value === "string" ? (
          <span className="break-all text-[11px] leading-snug text-[#666]">{value}</span>
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
    return <p className="text-[11px] text-slate-500">표시할 항목이 없습니다.</p>;
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
    <div className="overflow-hidden rounded-[5px] border border-slate-200">
      {pairs.map((pair, rowIdx) => {
        const isLast = rowIdx === pairs.length - 1;
        if (!pair.right) {
          return (
            <div
              key={pair.left.fieldKey}
              className={cn(!isLast && "border-b border-slate-200")}
            >
              <AttrRow label={pair.left.label} value={pair.left.value} showBottomBorder={false} />
            </div>
          );
        }
        return (
          <div
            key={`${pair.left.fieldKey}-${pair.right.fieldKey}`}
            className={cn(
              "grid grid-cols-2 divide-x divide-slate-200",
              !isLast && "border-b border-slate-200"
            )}
          >
            <AttrRow label={pair.left.label} value={pair.left.value} showBottomBorder={false} />
            <AttrRow label={pair.right.label} value={pair.right.value} showBottomBorder={false} />
          </div>
        );
      })}
    </div>
  );
}

/** 첨부 썸네일 — 클릭=미리보기, 호버 시 다운로드·삭제 */
function AttachmentThumb({
  att,
  onPreview,
  onDownload,
  onDelete,
}: {
  att: RoadNetworkAttachment;
  onPreview: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}) {
  const isImage = att.previewKind === "image" && !!att.previewUrl;
  const isPdf = att.previewKind === "pdf";
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPreview}
        className="block aspect-square w-full overflow-hidden rounded border border-slate-200 bg-slate-50"
        title={`${att.name} 미리보기`}
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={att.previewUrl}
            alt={att.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
            <FileText className="h-5 w-5" />
            <span className="text-[10px] font-semibold">{isPdf ? "PDF" : "파일"}</span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity group-hover:opacity-100">
        {onDownload ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-700 shadow-md ring-1 ring-slate-200/80 hover:bg-slate-50 hover:text-primary"
            title="다운로드"
          >
            <Download className="h-4 w-4" />
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-red-600 shadow-md ring-1 ring-slate-200/80 hover:bg-red-50"
            title="삭제"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-[10px] text-slate-500" title={att.name}>
        {att.name}
      </p>
    </div>
  );
}

function AttachmentThumbGrid({
  items,
  onPreview,
  onDownload,
  onDelete,
  emptyLabel = "첨부 없음",
}: {
  items: RoadNetworkAttachment[];
  onPreview: (id?: string) => void;
  onDownload?: (id: string) => void;
  onDelete?: (id: string) => void;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-400">{emptyLabel}</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((a) => (
        <AttachmentThumb
          key={a.id}
          att={a}
          onPreview={() => onPreview(a.id)}
          onDownload={onDownload ? () => onDownload(a.id) : undefined}
          onDelete={onDelete ? () => onDelete(a.id) : undefined}
        />
      ))}
    </div>
  );
}

/** 유지보수·민원 카드용 초소형 썸네일은 식별 불가 → 제거. 건수 텍스트만 유지 */
type AttrDraft = {
  roadName: string;
  roadNo: string;
  roadType: RoadNetworkType;
  openStatus: RoadNetworkOpenStatus | "";
  dept: string;
  manager: string;
  startPoint: string;
  endPoint: string;
  startPointCoord: RoadNetworkPoint | null;
  endPointCoord: RoadNetworkPoint | null;
};

function rowToAttrDraft(row: RoadNetworkRow): AttrDraft {
  return {
    roadName: row.roadName,
    roadNo: row.roadNo,
    roadType: row.roadType,
    openStatus: row.openStatus ?? "",
    dept: row.dept,
    manager: row.manager,
    startPoint: row.startPoint || "",
    endPoint: row.endPoint || "",
    startPointCoord: row.startPointCoord
      ? { lon: row.startPointCoord.lon, lat: row.startPointCoord.lat }
      : null,
    endPointCoord: row.endPointCoord
      ? { lon: row.endPointCoord.lon, lat: row.endPointCoord.lat }
      : null,
  };
}

type PointPickKind = "maint" | "comp" | "start" | "end" | null;

function ensureAttachments(
  list: RoadNetworkAttachment[] | undefined | null
): RoadNetworkAttachment[] {
  return list ?? [];
}

function attachmentSummary(list: RoadNetworkAttachment[] | undefined | null): string {
  const items = ensureAttachments(list);
  if (items.length === 0) return "첨부 없음";
  if (items.length <= 2) return items.map((a) => a.name).join(", ");
  return `${items[0].name} 외 ${items.length - 1}건`;
}

function matchesKeyword(haystack: string, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

function appendHistory(
  prev: RoadNetworkRow,
  action: string,
  detail: string,
  user: string
): RoadNetworkRow["history"] {
  return [createHistoryItem(action, detail, user), ...(prev.history ?? [])];
}

export function RoadNetworkDetailPanel({
  row,
  onClose,
  overlayLeftPx = 0,
  overlayWidthPx = 0,
}: Props) {
  const { data: session } = useSession();
  const historyUser =
    session?.user?.name?.trim() ||
    (session?.user?.id === "su" ? "슈퍼관리자" : "") ||
    session?.user?.id ||
    "미확인";
  const mapContext = useMapContext();
  const isNewRoad = row.id.startsWith("new-") || !row.roadName.trim();
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>("maintenance");
  const [attrEditing, setAttrEditing] = useState(isNewRoad);
  const [attrDraft, setAttrDraft] = useState<AttrDraft>(() => rowToAttrDraft(row));
  /** null=대기, draw=신규 그리기, modify=정점 수정 (세션 중 draft만 유지) */
  const [geomEditMode, setGeomEditMode] = useState<"draw" | "modify" | null>(null);
  const [geomEditSession, setGeomEditSession] = useState(0);
  const [hasDraftGeom, setHasDraftGeom] = useState(false);
  const [geomShowReset, setGeomShowReset] = useState(false);
  const [siteShowReset, setSiteShowReset] = useState(false);
  /** 유지보수·민원 편집 시트 */
  const [siteModal, setSiteModal] = useState<{
    kind: "maint" | "comp";
    itemId: string;
  } | null>(null);
  const [maintDraft, setMaintDraft] = useState<RoadNetworkMaintenanceItem | null>(null);
  const [compDraft, setCompDraft] = useState<RoadNetworkComplaintItem | null>(null);
  const [pointPickKind, setPointPickKind] = useState<PointPickKind>(null);
  const geomSessionSnapshotRef = useRef<{
    geom: RoadNetworkGeom | null;
    lengthM: number;
  } | null>(null);
  const geomModifyFeatureRef = useRef<Feature<LineString> | null>(null);
  const geomMapOpsRef = useRef<{
    startDraw: () => void;
    reset: () => void;
    deleteGeom: () => void;
    getDraft: () => { geom: RoadNetworkGeom | null; lengthM: number };
  } | null>(null);
  const sitePointSnapshotRef = useRef<{
    point: RoadNetworkPoint | null;
    address: string;
  } | null>(null);
  const sitePointOpsRef = useRef<{
    startDraw: () => void;
    reset: () => void;
    deleteGeom: () => void;
  } | null>(null);
  const { inputBottomPx } = useSearchBarOffset();
  const geomHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapInstance = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const geomCenterPixel = useMapVisualCenterPixel(
    mapInstance,
    Boolean(mapInstance) &&
      (geomEditMode != null || siteModal != null || pointPickKind === "start" || pointPickKind === "end"),
    mapPaddingLeft
  );

  const [maintSearch, setMaintSearch] = useState("");
  const [compSearch, setCompSearch] = useState("");
  const [compStateFilter, setCompStateFilter] = useState<RoadNetworkComplaintStateFilter>("전체");

  const [reportOpen, setReportOpen] = useState(false);
  const reportIframeRef = useRef<HTMLIFrameElement>(null);
  const [filePreview, setFilePreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  const [unsupportedPreview, setUnsupportedPreview] = useState<RoadNetworkAttachment | null>(
    null
  );

  const roadAttachInputRef = useRef<HTMLInputElement>(null);
  const maintAttachInputRef = useRef<HTMLInputElement>(null);
  const compAttachInputRef = useRef<HTMLInputElement>(null);

  const badge = ROAD_NETWORK_TYPE_BADGE[row.roadType];
  const roadAttachments = ensureAttachments(row.attachments);
  const historyNewestFirst = useMemo(
    () => [...(row.history ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    [row.history]
  );

  const setPointPickActive = mapContext?.setRoadNetworkPointPickActive;
  const setDraftSitePoint = mapContext?.setRoadNetworkDraftSitePoint;
  const setSitePointKind = mapContext?.setRoadNetworkSitePointKind;
  const setEndpointMarkers = mapContext?.setRoadNetworkEndpointMarkers;
  const setFocusedSiteKey = mapContext?.setRoadNetworkFocusedSitePointKey;
  const focusedSiteKey = mapContext?.roadNetworkFocusedSitePointKey ?? null;
  const pointPickRef = mapContext?.roadNetworkPointPickRef;

  useEffect(() => {
    setAttrDraft(rowToAttrDraft(row));
    setAttrsOpen(true);
    setBottomTab("maintenance");
    setMaintSearch("");
    setCompSearch("");
    setCompStateFilter("전체");
    setSiteModal(null);
    setMaintDraft(null);
    setCompDraft(null);
    setPointPickKind(null);
    setGeomEditMode(null);
    setHasDraftGeom(false);
    setGeomShowReset(false);
    setGeomEditSession(0);
    geomSessionSnapshotRef.current = null;
    geomModifyFeatureRef.current = null;
    setFocusedSiteKey?.(null);

    const editing = !row.roadName.trim();
    setAttrEditing(editing);
    if (editing) {
      // 신규 도로: 속성·도형 편집 함께 시작
      const hadGeom = !!row.geom?.coordinates?.length;
      geomSessionSnapshotRef.current = {
        geom: hadGeom
          ? {
              type: "LineString",
              coordinates: row.geom!.coordinates.map(
                (c) => [c[0]!, c[1]!] as [number, number]
              ),
            }
          : null,
        lengthM: row.lengthM,
      };
      setHasDraftGeom(hadGeom);
      setGeomShowReset(hadGeom);
      setGeomEditSession(1);
      setGeomEditMode(hadGeom ? "modify" : "draw");
    }
  }, [row.id, setFocusedSiteKey]);

  useEffect(() => {
    if (bottomTab === "maintenance") setSitePointKind?.("maint");
    else if (bottomTab === "complaints") setSitePointKind?.("comp");
    else setSitePointKind?.(null);
    if (!siteModal) setFocusedSiteKey?.(null);
  }, [bottomTab, setSitePointKind, setFocusedSiteKey, siteModal]);

  useEffect(() => {
    if (!siteModal) return;
    setFocusedSiteKey?.(
      siteModal.kind === "maint" ? `m-${siteModal.itemId}` : `c-${siteModal.itemId}`
    );
  }, [siteModal, setFocusedSiteKey]);

  useEffect(() => {
    return () => {
      setSitePointKind?.(null);
      setEndpointMarkers?.(null);
      setFocusedSiteKey?.(null);
      setGeomEditMode(null);
    };
  }, [setSitePointKind, setEndpointMarkers, setFocusedSiteKey]);

  useEffect(() => {
    if (row.roadType !== "군도" && row.roadType !== "농도") {
      setEndpointMarkers?.(null);
      return;
    }
    const srcStart = attrEditing ? attrDraft.startPointCoord : row.startPointCoord;
    const srcEnd = attrEditing ? attrDraft.endPointCoord : row.endPointCoord;
    const norm = (p?: RoadNetworkPoint | null) =>
      p && Number.isFinite(p.lon) && Number.isFinite(p.lat)
        ? { lon: p.lon, lat: p.lat }
        : null;
    setEndpointMarkers?.({
      start: norm(srcStart ?? null),
      end: norm(srcEnd ?? null),
    });
  }, [
    row.roadType,
    row.startPointCoord,
    row.endPointCoord,
    attrEditing,
    attrDraft.startPointCoord,
    attrDraft.endPointCoord,
    setEndpointMarkers,
  ]);

  const writeRoadGeom = (
    roadId: string,
    nextGeom: RoadNetworkGeom | null,
    lengthM: number,
    history?: { action: string; detail: string; user: string }
  ) => {
    mapContext?.setRoadNetworkRows?.((rows) =>
      rows.map((r) =>
        r.id === roadId
          ? {
              ...r,
              geom: nextGeom,
              lengthM,
              history: history
                ? appendHistory(r, history.action, history.detail, history.user)
                : r.history,
            }
          : r
      )
    );
  };

  const geomFromFeature = (
    feature: Feature<LineString>,
    viewProj: string
  ): { geom: RoadNetworkGeom; lengthM: number } | null => {
    const g = feature.getGeometry();
    if (!g || g.getType() !== "LineString") return null;
    const coords4326 = g
      .getCoordinates()
      .map((c) => transform(c, viewProj, "EPSG:4326") as [number, number]);
    if (coords4326.length < 2) return null;
    return {
      geom: { type: "LineString", coordinates: coords4326 },
      lengthM: Math.round(
        getLength(new LineString(coords4326), { projection: "EPSG:4326" })
      ),
    };
  };

  /** 도형 편집 세션 — draft만 feature/ref에 유지, 완료 시 commit */
  useEffect(() => {
    if (!geomEditMode || geomEditSession === 0) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) {
      setGeomEditMode(null);
      return;
    }
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) {
      setGeomEditMode(null);
      return;
    }
    mapContext?.clearMapDrawInteractionsRef?.current?.();
    setPointPickKind(null);

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const snapshot = geomSessionSnapshotRef.current;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        stroke: new Stroke({ color: "rgba(239, 68, 68, 0.95)", width: 3 }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "rgba(239, 68, 68, 0.95)" }),
          stroke: new Stroke({ color: "#fff", width: 1.5 }),
        }),
      }),
    });
    map.addLayer(layer);

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined;
    dblClickZoom?.setActive(false);

    let draw: Draw | null = null;
    let modify: Modify | null = null;

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
      }
    };

    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const clearDraftFeatures = () => {
      source.clear();
      geomModifyFeatureRef.current = null;
      setHasDraftGeom(false);
    };

    const loadFeatureFromGeom = (geom: RoadNetworkGeom, fit: boolean) => {
      clearDraftFeatures();
      const coordsMap = geom.coordinates.map((c) => transform(c, "EPSG:4326", viewProj));
      const line = new LineString(coordsMap);
      const feature = new Feature({ geometry: line }) as Feature<LineString>;
      source.addFeature(feature);
      geomModifyFeatureRef.current = feature;
      setHasDraftGeom(true);
      if (fit) {
        const extent = line.getExtent();
        if (!isEmptyExtent(extent)) {
          map.getView().fit(extent, {
            padding: [80, 80, 80, 80],
            maxZoom: 17,
            duration: 280,
          });
        }
      }
      return feature;
    };

    const attachModify = () => {
      detachModify();
      detachDraw();
      modify = new Modify({ source });
      map.addInteraction(modify);
      setGeomEditMode("modify");
    };

    const startDraw = () => {
      detachDraw();
      detachModify();
      clearDraftFeatures();
      draw = new Draw({ source, type: "LineString", stopClick: true });
      draw.on("drawend", (e) => {
        const feature = e.feature as Feature<LineString>;
        const parsed = geomFromFeature(feature, viewProj);
        if (!parsed) {
          window.alert("노선은 두 점 이상이어야 합니다.");
          source.removeFeature(feature);
          return;
        }
        geomModifyFeatureRef.current = feature;
        setHasDraftGeom(true);
        detachDraw();
        attachModify();
      });
      map.addInteraction(draw);
      setGeomEditMode("draw");
    };

    const reset = () => {
      detachDraw();
      detachModify();
      const snap = geomSessionSnapshotRef.current;
      if (snap?.geom?.coordinates?.length) {
        loadFeatureFromGeom(snap.geom, false);
        attachModify();
      } else {
        clearDraftFeatures();
        attachModify();
      }
    };

    const deleteGeom = () => {
      detachDraw();
      clearDraftFeatures();
      attachModify();
    };

    const getDraft = (): { geom: RoadNetworkGeom | null; lengthM: number } => {
      const feature = geomModifyFeatureRef.current;
      if (!feature) return { geom: null, lengthM: 0 };
      const parsed = geomFromFeature(feature, viewProj);
      if (!parsed) return { geom: null, lengthM: 0 };
      return parsed;
    };

    geomMapOpsRef.current = { startDraw, reset, deleteGeom, getDraft };

    const entryMode = snapshot?.geom?.coordinates?.length ? "modify" : "draw";
    if (entryMode === "modify" && snapshot?.geom) {
      loadFeatureFromGeom(snapshot.geom, true);
      attachModify();
    } else {
      startDraw();
    }

    return () => {
      dblClickZoom?.setActive(true);
      geomMapOpsRef.current = null;
      detachDraw();
      detachModify();
      map.removeLayer(layer);
      source.clear();
      geomModifyFeatureRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session keyed by geomEditSession
  }, [geomEditSession]);

  const startRoadGeomEdit = () => {
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return false;
    setPointPickKind(null);
    const hadGeom = !!row.geom?.coordinates?.length;
    geomSessionSnapshotRef.current = {
      geom: hadGeom
        ? {
            type: "LineString",
            coordinates: row.geom!.coordinates.map(
              (c) => [c[0]!, c[1]!] as [number, number]
            ),
          }
        : null,
      lengthM: row.lengthM,
    };
    setHasDraftGeom(hadGeom);
    setGeomShowReset(hadGeom);
    setGeomEditSession((n) => n + 1);
    setGeomEditMode(hadGeom ? "modify" : "draw");
    return true;
  };

  const cancelGeomEdit = () => {
    const snap = geomSessionSnapshotRef.current;
    if (snap) {
      writeRoadGeom(row.id, snap.geom, snap.lengthM);
    }
    setGeomEditMode(null);
    setHasDraftGeom(false);
    setGeomShowReset(false);
    setGeomEditSession(0);
    geomSessionSnapshotRef.current = null;
  };

  const finishGeomEdit = () => {
    const draft = geomMapOpsRef.current?.getDraft() ?? { geom: null, lengthM: 0 };
    const snap = geomSessionSnapshotRef.current;
    const changed =
      !snap ||
      snap.lengthM !== draft.lengthM ||
      JSON.stringify(snap.geom?.coordinates ?? null) !==
        JSON.stringify(draft.geom?.coordinates ?? null);

    let history: { action: string; detail: string; user: string } | undefined;
    if (changed) {
      if (!draft.geom && snap?.geom) {
        history = {
          action: "노선 삭제",
          detail: "노선 도형을 삭제함",
          user: historyUser,
        };
      } else if (draft.geom && !snap?.geom) {
        history = {
          action: "노선 지정",
          detail: "지도에서 노선 도형을 지정함",
          user: historyUser,
        };
      } else if (draft.geom) {
        history = {
          action: "노선 수정",
          detail: "노선 도형 정점을 수정함",
          user: historyUser,
        };
      }
    }

    writeRoadGeom(row.id, draft.geom, draft.lengthM, history);
    setGeomEditMode(null);
    setHasDraftGeom(false);
    setGeomShowReset(false);
    setGeomEditSession(0);
    geomSessionSnapshotRef.current = null;
  };

  const beginAttrEdit = () => {
    closeSiteModal();
    setAttrDraft(rowToAttrDraft(row));
    setAttrEditing(true);
    setAttrsOpen(true);
    setPointPickKind(null);
    startRoadGeomEdit();
  };

  const cancelAttrEdit = () => {
    setAttrDraft(rowToAttrDraft(row));
    setAttrEditing(false);
    setPointPickKind(null);
    if (geomEditMode) cancelGeomEdit();
  };

  useEffect(() => {
    if (!pointPickRef) return;
    if (!pointPickKind) {
      pointPickRef.current = null;
      setPointPickActive?.(false);
      return;
    }
    setPointPickActive?.(true);
    const pickKind = pointPickKind;
    pointPickRef.current = (lon, lat) => {
      const point: RoadNetworkPoint = { lon, lat };
      if (pickKind === "maint") {
        setMaintDraft((d) =>
          d ? { ...d, point, siteAddress: "주소 조회 중…" } : d
        );
      } else if (pickKind === "comp") {
        setCompDraft((d) =>
          d ? { ...d, point, address: "주소 조회 중…" } : d
        );
      } else if (pickKind === "start") {
        setAttrDraft((d) => ({
          ...d,
          startPointCoord: point,
          startPoint: "주소 조회 중…",
        }));
      } else if (pickKind === "end") {
        setAttrDraft((d) => ({
          ...d,
          endPointCoord: point,
          endPoint: "주소 조회 중…",
        }));
      }
      const apiKey = mapContext?.vworldApiKey;
      void getAddressFromCoord(lon, lat, { apiKey }).then((addr) => {
        const siteAddress = (addr?.road || addr?.jibun || "").trim() || "주소 없음";
        if (pickKind === "maint") {
          setMaintDraft((d) =>
            d && d.point?.lon === lon && d.point?.lat === lat
              ? { ...d, siteAddress }
              : d
          );
        } else if (pickKind === "comp") {
          setCompDraft((d) =>
            d && d.point?.lon === lon && d.point?.lat === lat
              ? { ...d, address: siteAddress }
              : d
          );
        } else if (pickKind === "start") {
          setAttrDraft((d) =>
            d.startPointCoord?.lon === lon && d.startPointCoord?.lat === lat
              ? { ...d, startPoint: siteAddress }
              : d
          );
        } else if (pickKind === "end") {
          setAttrDraft((d) =>
            d.endPointCoord?.lon === lon && d.endPointCoord?.lat === lat
              ? { ...d, endPoint: siteAddress }
              : d
          );
        }
      });
    };
    return () => {
      pointPickRef.current = null;
      setPointPickActive?.(false);
    };
  }, [pointPickKind, pointPickRef, setPointPickActive, mapContext?.vworldApiKey]);

  useEffect(() => {
    if (pointPickKind === "start") {
      const p = attrDraft.startPointCoord;
      setDraftSitePoint?.(p && Number.isFinite(p.lon) && Number.isFinite(p.lat) ? p : null);
      return () => setDraftSitePoint?.(null);
    }
    if (pointPickKind === "end") {
      const p = attrDraft.endPointCoord;
      setDraftSitePoint?.(p && Number.isFinite(p.lon) && Number.isFinite(p.lat) ? p : null);
      return () => setDraftSitePoint?.(null);
    }
    const p = maintDraft?.point ?? compDraft?.point ?? null;
    setDraftSitePoint?.(p && Number.isFinite(p.lon) && Number.isFinite(p.lat) ? p : null);
    return () => setDraftSitePoint?.(null);
  }, [
    pointPickKind,
    attrDraft.startPointCoord,
    attrDraft.endPointCoord,
    maintDraft?.point,
    compDraft?.point,
    setDraftSitePoint,
  ]);

  useEffect(() => {
    if (!siteModal) {
      sitePointOpsRef.current = null;
      return;
    }
    sitePointOpsRef.current = {
      startDraw: () => {
        if (siteModal.kind === "maint") {
          setMaintDraft((d) => (d ? { ...d, point: null, siteAddress: "" } : d));
        } else {
          setCompDraft((d) => (d ? { ...d, point: null, address: "" } : d));
        }
        setPointPickKind(siteModal.kind);
      },
      reset: () => {
        const snap = sitePointSnapshotRef.current;
        if (!snap) return;
        if (siteModal.kind === "maint") {
          setMaintDraft((d) =>
            d ? { ...d, point: snap.point, siteAddress: snap.address } : d
          );
        } else {
          setCompDraft((d) =>
            d ? { ...d, point: snap.point, address: snap.address } : d
          );
        }
        setPointPickKind(siteModal.kind);
      },
      deleteGeom: () => {
        if (siteModal.kind === "maint") {
          setMaintDraft((d) => (d ? { ...d, point: null, siteAddress: "" } : d));
        } else {
          setCompDraft((d) => (d ? { ...d, point: null, address: "" } : d));
        }
        setPointPickKind(siteModal.kind);
      },
    };
    return () => {
      sitePointOpsRef.current = null;
    };
  }, [siteModal]);

  const flyToPoint = (point?: RoadNetworkPoint | null) => {
    if (!point) return;
    const map = mapContext?.mapInstanceRef?.current;
    const view = map?.getView();
    if (!view) return;
    const center = fromLonLat([point.lon, point.lat]);
    view.animate({
      center,
      zoom: Math.max(view.getZoom() ?? 14, 15),
      duration: 350,
    });
  };

  const selectSiteItem = (
    kind: "maint" | "comp",
    id: string,
    point?: RoadNetworkPoint | null
  ) => {
    setFocusedSiteKey?.(kind === "maint" ? `m-${id}` : `c-${id}`);
    if (point) flyToPoint(point);
  };

  const beginSitePointEdit = (
    kind: "maint" | "comp",
    point: RoadNetworkPoint | null | undefined,
    address: string
  ) => {
    if (geomEditMode) cancelGeomEdit();
    if (attrEditing) {
      setAttrDraft(rowToAttrDraft(row));
      setAttrEditing(false);
    }
    const hasPoint = !!(point && Number.isFinite(point.lon) && Number.isFinite(point.lat));
    sitePointSnapshotRef.current = {
      point: hasPoint ? { lon: point!.lon, lat: point!.lat } : null,
      address: address || "",
    };
    setSiteShowReset(hasPoint);
    setPointPickKind(kind);
  };

  const downloadAttachment = (att: RoadNetworkAttachment) => {
    if (!att.previewUrl) {
      window.alert("다운로드할 파일이 없습니다. (임시 데이터는 업로드 파일만 가능)");
      return;
    }
    const a = document.createElement("a");
    a.href = att.previewUrl;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const patchRow = (updater: (prev: RoadNetworkRow) => RoadNetworkRow) => {
    mapContext?.setRoadNetworkRows?.((rows) =>
      rows.map((r) => (r.id === row.id ? updater(r) : r))
    );
  };

  const handleSaveAttrs = () => {
    const name = attrDraft.roadName.trim();
    if (!name) {
      window.alert("도로명을 입력하세요.");
      return;
    }
    const nextType = attrDraft.roadType;
    const nextOpen = (attrDraft.openStatus || "개설") as RoadNetworkOpenStatus;
    const nextFields = {
      roadName: name,
      roadNo: attrDraft.roadNo.trim(),
      roadType: nextType,
      openStatus: nextOpen,
      dept: attrDraft.dept.trim(),
      manager: attrDraft.manager.trim(),
      startPoint: attrDraft.startPoint.trim(),
      endPoint: attrDraft.endPoint.trim(),
      startPointCoord: attrDraft.startPointCoord,
      endPointCoord: attrDraft.endPointCoord,
    };
    patchRow((prev) => ({
      ...prev,
      ...nextFields,
      history: appendHistory(
        prev,
        "속성 수정",
        describeAttrHistoryDetail(prev, nextFields),
        historyUser
      ),
    }));
    if (geomEditMode) finishGeomEdit();
    setPointPickKind(null);
    setAttrEditing(false);
  };

  const handleDeleteRoad = () => {
    if (!window.confirm(`「${row.roadName}」을(를) 삭제할까요?`)) return;
    mapContext?.setRoadNetworkRows?.((rows) => rows.filter((r) => r.id !== row.id));
    mapContext?.setRoadNetworkSelectedId?.(null);
  };

  const closeSiteModal = () => {
    setPointPickKind(null);
    sitePointSnapshotRef.current = null;
    setSiteShowReset(false);
    setSiteModal(null);
    setMaintDraft(null);
    setCompDraft(null);
  };

  const openNewMaint = () => {
    const draft = { ...createEmptyMaintenanceItem(), attachments: [] };
    setMaintDraft(draft);
    setCompDraft(null);
    setSiteModal({ kind: "maint", itemId: draft.id });
    setFocusedSiteKey?.(`m-${draft.id}`);
    beginSitePointEdit("maint", null, "");
  };

  const openEditMaint = (item: RoadNetworkMaintenanceItem) => {
    setMaintDraft({
      ...item,
      attachments: ensureAttachments(item.attachments).map((a) => ({ ...a })),
    });
    setCompDraft(null);
    setSiteModal({ kind: "maint", itemId: item.id });
    selectSiteItem("maint", item.id, item.point);
    beginSitePointEdit("maint", item.point, item.siteAddress || "");
  };

  const saveMaint = () => {
    if (!maintDraft) return;
    if (!maintDraft.workType.trim() || !maintDraft.content.trim()) {
      window.alert("작업유형과 내용을 입력하세요.");
      return;
    }
    const isNew = !row.maintenance.some((m) => m.id === maintDraft.id);
    const prevItem = row.maintenance.find((m) => m.id === maintDraft.id) ?? null;
    const next: RoadNetworkMaintenanceItem = {
      ...maintDraft,
      workType: maintDraft.workType.trim(),
      content: maintDraft.content.trim(),
      attachments: ensureAttachments(maintDraft.attachments),
    };
    patchRow((prev) => {
      const list = isNew
        ? [next, ...prev.maintenance]
        : prev.maintenance.map((m) => (m.id === next.id ? next : m));
      return {
        ...prev,
        maintenance: list,
        history: appendHistory(
          prev,
          isNew ? "유지보수 추가" : "유지보수 수정",
          describeMaintHistoryDetail(prevItem, next, isNew),
          historyUser
        ),
      };
    });
    selectSiteItem("maint", next.id, next.point);
    closeSiteModal();
  };

  const deleteMaint = (id: string) => {
    if (!window.confirm("이 유지보수 이력을 삭제할까요?")) return;
    const target = row.maintenance.find((m) => m.id === id);
    patchRow((prev) => ({
      ...prev,
      maintenance: prev.maintenance.filter((m) => m.id !== id),
      history: appendHistory(
        prev,
        "유지보수 삭제",
        target
          ? `«${target.workType} (${target.date})» 삭제 · 현장 ${target.point ? "지정" : "미지정"}`
          : id,
        historyUser
      ),
    }));
    if (siteModal?.kind === "maint" && siteModal.itemId === id) {
      closeSiteModal();
    }
  };

  const openNewComp = () => {
    const draft = { ...createEmptyComplaintItem(), attachments: [] };
    setCompDraft(draft);
    setMaintDraft(null);
    setSiteModal({ kind: "comp", itemId: draft.id });
    setFocusedSiteKey?.(`c-${draft.id}`);
    beginSitePointEdit("comp", null, "");
  };

  const openEditComp = (item: RoadNetworkComplaintItem) => {
    setCompDraft({
      ...item,
      attachments: ensureAttachments(item.attachments).map((a) => ({ ...a })),
    });
    setMaintDraft(null);
    setSiteModal({ kind: "comp", itemId: item.id });
    selectSiteItem("comp", item.id, item.point);
    beginSitePointEdit("comp", item.point, item.address || "");
  };

  const saveComp = () => {
    if (!compDraft) return;
    if (!compDraft.content.trim()) {
      window.alert("민원 내용을 입력하세요.");
      return;
    }
    const isNew = !row.complaints.some((c) => c.id === compDraft.id);
    const prevItem = row.complaints.find((c) => c.id === compDraft.id) ?? null;
    const next: RoadNetworkComplaintItem = {
      ...compDraft,
      name: compDraft.name.trim(),
      address: compDraft.address.trim(),
      content: compDraft.content.trim(),
      attachments: ensureAttachments(compDraft.attachments),
    };
    patchRow((prev) => {
      const list = isNew
        ? [next, ...prev.complaints]
        : prev.complaints.map((c) => (c.id === next.id ? next : c));
      return {
        ...prev,
        complaints: list,
        history: appendHistory(
          prev,
          isNew ? "민원 등록" : "민원 수정",
          describeComplaintHistoryDetail(prevItem, next, isNew),
          historyUser
        ),
      };
    });
    selectSiteItem("comp", next.id, next.point);
    closeSiteModal();
  };

  const deleteComp = (id: string) => {
    if (!window.confirm("이 민원을 삭제할까요?")) return;
    const target = row.complaints.find((c) => c.id === id);
    patchRow((prev) => ({
      ...prev,
      complaints: prev.complaints.filter((c) => c.id !== id),
      history: appendHistory(
        prev,
        "민원 삭제",
        target
          ? `«${target.state} · ${target.content.slice(0, 24)}» 삭제`
          : id,
        historyUser
      ),
    }));
    if (siteModal?.kind === "comp" && siteModal.itemId === id) {
      closeSiteModal();
    }
  };

  const openAttachmentPreview = (
    list: RoadNetworkAttachment[],
    focusId?: string
  ) => {
    const previewable = list.filter(
      (a) =>
        a.previewUrl &&
        (a.previewKind === "image" || a.previewKind === "pdf")
    );
    if (previewable.length === 0) {
      const focus = focusId ? list.find((a) => a.id === focusId) : list[0];
      if (focus) setUnsupportedPreview(focus);
      else window.alert("미리볼 수 있는 첨부파일이 없습니다.");
      return;
    }
    const items: ServiceFilePreviewItem[] = previewable.map((a) => ({
      url: a.previewUrl!,
      fileName: a.name,
      kind: a.previewKind === "pdf" ? "pdf" : "image",
    }));
    let index = 0;
    if (focusId) {
      const focus = list.find((a) => a.id === focusId);
      if (focus?.previewUrl) {
        const i = previewable.findIndex((a) => a.id === focusId);
        if (i >= 0) index = i;
        else if (focus.previewKind === "other" || !focus.previewUrl) {
          setUnsupportedPreview(focus);
          return;
        }
      } else if (focus) {
        setUnsupportedPreview(focus);
        return;
      }
    }
    setFilePreview({ items, index });
  };

  const addRoadAttachmentsFromFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const atts = list.map((f) => createAttachmentFromFile(f));
    patchRow((prev) => ({
      ...prev,
      attachments: [...atts, ...ensureAttachments(prev.attachments)],
      history: appendHistory(
        prev,
        "첨부 추가",
        atts.length === 1 ? atts[0]!.name : `${atts.length}건`,
        historyUser
      ),
    }));
  };

  const deleteRoadAttachment = (id: string) => {
    const target = roadAttachments.find((a) => a.id === id);
    if (!window.confirm(`«${target?.name ?? "첨부파일"}»을(를) 삭제할까요?`)) return;
    revokeAttachmentPreview(target);
    patchRow((prev) => ({
      ...prev,
      attachments: ensureAttachments(prev.attachments).filter((a) => a.id !== id),
      history: appendHistory(prev, "첨부 삭제", target?.name ?? id, historyUser),
    }));
  };

  const addDraftAttachments = (files: FileList | File[], kind: "maint" | "comp") => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const atts = list.map((f) => createAttachmentFromFile(f));
    if (kind === "maint") {
      setMaintDraft((d) =>
        d ? { ...d, attachments: [...atts, ...ensureAttachments(d.attachments)] } : d
      );
    } else {
      setCompDraft((d) =>
        d ? { ...d, attachments: [...atts, ...ensureAttachments(d.attachments)] } : d
      );
    }
  };

  const removeDraftAttachment = (id: string, kind: "maint" | "comp") => {
    if (kind === "maint") {
      setMaintDraft((d) => {
        if (!d) return d;
        const target = ensureAttachments(d.attachments).find((a) => a.id === id);
        revokeAttachmentPreview(target);
        return {
          ...d,
          attachments: ensureAttachments(d.attachments).filter((a) => a.id !== id),
        };
      });
    } else {
      setCompDraft((d) => {
        if (!d) return d;
        const target = ensureAttachments(d.attachments).find((a) => a.id === id);
        revokeAttachmentPreview(target);
        return {
          ...d,
          attachments: ensureAttachments(d.attachments).filter((a) => a.id !== id),
        };
      });
    }
  };

  const reportHtml = useMemo(
    () => (reportOpen ? buildRoadNetworkReportHtml(row) : ""),
    [reportOpen, row]
  );

  const printReport = () => {
    const win = reportIframeRef.current?.contentWindow;
    if (!win) {
      window.alert("보고서 미리보기를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    win.focus();
    win.print();
  };

  const filteredMaintenance = useMemo(() => {
    return row.maintenance.filter((item) =>
      matchesKeyword(
        [item.workType, item.content, item.contractor, item.date].join(" "),
        maintSearch
      )
    );
  }, [row.maintenance, maintSearch]);

  const compSearchFiltered = useMemo(() => {
    return row.complaints.filter((item) =>
      matchesKeyword(
        [item.state, item.name, item.address, item.content, item.date].join(" "),
        compSearch
      )
    );
  }, [row.complaints, compSearch]);

  const filteredComplaints = useMemo(() => {
    if (compStateFilter === "전체") return compSearchFiltered;
    return compSearchFiltered.filter((item) => item.state === compStateFilter);
  }, [compSearchFiltered, compStateFilter]);

  const geomHintText =
    geomEditMode === "draw"
      ? "지도에서 도형을 그려 주세요."
      : hasDraftGeom
        ? "지도에서 도형을 수정해 주세요."
        : "도형추가 버튼으로 노선을 그리세요.";

  const siteDraftPoint =
    siteModal?.kind === "maint"
      ? maintDraft?.point
      : siteModal?.kind === "comp"
        ? compDraft?.point
        : null;
  const siteHasPoint = !!(
    siteDraftPoint &&
    Number.isFinite(siteDraftPoint.lon) &&
    Number.isFinite(siteDraftPoint.lat)
  );
  const siteHintText = siteHasPoint
    ? "지도에서 위치를 수정해 주세요."
    : "지도에서 위치를 찍어 주세요.";

  const geomBannerHost =
    mapContext?.mapInstanceRef?.current?.getTargetElement()?.parentElement ?? null;

  const endpointPickActive = pointPickKind === "start" || pointPickKind === "end";
  const endpointHintText =
    pointPickKind === "start"
      ? attrDraft.startPointCoord
        ? "지도에서 기점 위치를 수정해 주세요."
        : "지도에서 기점 위치를 찍어 주세요."
      : pointPickKind === "end"
        ? attrDraft.endPointCoord
          ? "지도에서 종점 위치를 수정해 주세요."
          : "지도에서 종점 위치를 찍어 주세요."
        : "";

  const mapEditBanner =
    geomBannerHost && geomEditMode
      ? createPortal(
          <div
            className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm"
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
                  "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                )}
                disabled={geomEditMode === "draw"}
                onClick={() => geomMapOpsRef.current?.startDraw()}
              >
                도형추가
              </button>
              {geomShowReset ? (
                <button
                  type="button"
                  className={layerRowPanelButtonClass(
                    "default",
                    "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                  )}
                  onClick={() => geomMapOpsRef.current?.reset()}
                >
                  초기화
                </button>
              ) : null}
              <button
                type="button"
                className={layerRowPanelButtonClass("danger", "pointer-events-auto shrink-0")}
                onClick={() => geomMapOpsRef.current?.deleteGeom()}
              >
                도형삭제
              </button>
            </div>
          </div>,
          geomBannerHost
        )
      : geomBannerHost && siteModal
        ? createPortal(
            <div
              className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm"
              style={
                geomCenterPixel
                  ? { left: geomCenterPixel.x, top: geomHintTopPx }
                  : { left: "50%", top: geomHintTopPx }
              }
            >
              <span className="whitespace-nowrap text-center">{siteHintText}</span>
              <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className={layerRowPanelButtonClass(
                    "default",
                    "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                  )}
                  disabled={!siteHasPoint}
                  onClick={() => sitePointOpsRef.current?.startDraw()}
                >
                  도형추가
                </button>
                {siteShowReset ? (
                  <button
                    type="button"
                    className={layerRowPanelButtonClass(
                      "default",
                      "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                    )}
                    onClick={() => sitePointOpsRef.current?.reset()}
                  >
                    초기화
                  </button>
                ) : null}
                <button
                  type="button"
                  className={layerRowPanelButtonClass("danger", "pointer-events-auto shrink-0")}
                  disabled={!siteHasPoint}
                  onClick={() => sitePointOpsRef.current?.deleteGeom()}
                >
                  도형삭제
                </button>
              </div>
            </div>,
            geomBannerHost
          )
        : geomBannerHost && endpointPickActive
          ? createPortal(
              <div
                className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm"
                style={
                  geomCenterPixel
                    ? { left: geomCenterPixel.x, top: geomHintTopPx }
                    : { left: "50%", top: geomHintTopPx }
                }
              >
                <span className="whitespace-nowrap text-center">{endpointHintText}</span>
                <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className={layerRowPanelButtonClass(
                      "default",
                      "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                    )}
                    onClick={() => setPointPickKind(null)}
                  >
                    지정 종료
                  </button>
                </div>
              </div>,
              geomBannerHost
            )
          : null;

  const bottomTabs = useMemo(
    () =>
      [
        { id: "maintenance" as const, label: `유지보수 (${row.maintenance.length})` },
        { id: "complaints" as const, label: `민원 (${row.complaints.length})` },
        { id: "attachments" as const, label: `첨부 (${roadAttachments.length})` },
        { id: "history" as const, label: `이력 (${(row.history ?? []).length})` },
      ] as const,
    [row.maintenance.length, row.complaints.length, roadAttachments.length, row.history]
  );

  const attrEntries = useMemo(() => {
    const entries: {
      fieldKey: string;
      label: string;
      value: string;
      fullWidth?: boolean;
    }[] = [
      { fieldKey: "roadName", label: "도로명", value: row.roadName || "—" },
      { fieldKey: "roadType", label: "도로종류", value: row.roadType },
      {
        fieldKey: "openStatus",
        label: "개설여부",
        value: row.openStatus ?? "—",
      },
      { fieldKey: "roadNo", label: "노선번호", value: row.roadNo || "—" },
      { fieldKey: "dept", label: "관리기관", value: row.dept || "—" },
      { fieldKey: "manager", label: "담당자", value: row.manager || "—" },
    ];
    if (row.roadType === "군도" || row.roadType === "농도") {
      entries.push(
        {
          fieldKey: "startPoint",
          label: "기점",
          value: row.startPoint || "—",
          fullWidth: true,
        },
        {
          fieldKey: "endPoint",
          label: "종점",
          value: row.endPoint || "—",
          fullWidth: true,
        }
      );
    }
    return entries;
  }, [row]);

  const attrEditEntries = useMemo(() => {
    const entries: { fieldKey: string; label: string; value: ReactNode; fullWidth?: boolean }[] = [
      {
        fieldKey: "roadName",
        label: "도로명",
        value: (
          <input
            className={fieldClass}
            value={attrDraft.roadName}
            onChange={(e) => setAttrDraft((d) => ({ ...d, roadName: e.target.value }))}
          />
        ),
      },
      {
        fieldKey: "roadType",
        label: "도로종류",
        value: (
          <select
            className={fieldClass}
            value={attrDraft.roadType}
            onChange={(e) => {
              const next = e.target.value as RoadNetworkType;
              setAttrDraft((d) => ({
                ...d,
                roadType: next,
                openStatus: d.openStatus || "개설",
              }));
            }}
          >
            {ROAD_NETWORK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ),
      },
      {
        fieldKey: "openStatus",
        label: "개설여부",
        value: (
          <select
            className={fieldClass}
            value={attrDraft.openStatus || "개설"}
            onChange={(e) =>
              setAttrDraft((d) => ({
                ...d,
                openStatus: e.target.value as RoadNetworkOpenStatus | "",
              }))
            }
          >
            {ROAD_NETWORK_OPEN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ),
      },
    ];
    entries.push(
      {
        fieldKey: "roadNo",
        label: "노선번호",
        value: (
          <input
            className={fieldClass}
            value={attrDraft.roadNo}
            onChange={(e) => setAttrDraft((d) => ({ ...d, roadNo: e.target.value }))}
          />
        ),
      },
      {
        fieldKey: "dept",
        label: "관리기관",
        value: (
          <input
            className={fieldClass}
            value={attrDraft.dept}
            onChange={(e) => setAttrDraft((d) => ({ ...d, dept: e.target.value }))}
          />
        ),
      },
      {
        fieldKey: "manager",
        label: "담당자",
        value: (
          <input
            className={fieldClass}
            value={attrDraft.manager}
            onChange={(e) => setAttrDraft((d) => ({ ...d, manager: e.target.value }))}
          />
        ),
      }
    );
    if (attrDraft.roadType === "군도" || attrDraft.roadType === "농도") {
      entries.push(
        {
          fieldKey: "startPoint",
          label: "기점",
          fullWidth: true,
          value: (
            <div className="flex min-w-0 flex-col gap-1">
              <input
                className={fieldClass}
                value={attrDraft.startPoint}
                placeholder="주소 또는 위치 지정"
                onChange={(e) =>
                  setAttrDraft((d) => ({ ...d, startPoint: e.target.value }))
                }
              />
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    btnGhost,
                    pointPickKind === "start" && "border-primary text-primary"
                  )}
                  onClick={() => {
                    if (geomEditMode) cancelGeomEdit();
                    setPointPickKind((k) => (k === "start" ? null : "start"));
                  }}
                >
                  <MapPin className="h-3 w-3" />
                  {pointPickKind === "start" ? "지정 중…" : "위치 지정"}
                </button>
                {attrDraft.startPointCoord ? (
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() =>
                      setAttrDraft((d) => ({
                        ...d,
                        startPointCoord: null,
                      }))
                    }
                  >
                    위치 지우기
                  </button>
                ) : null}
              </div>
            </div>
          ),
        },
        {
          fieldKey: "endPoint",
          label: "종점",
          fullWidth: true,
          value: (
            <div className="flex min-w-0 flex-col gap-1">
              <input
                className={fieldClass}
                value={attrDraft.endPoint}
                placeholder="주소 또는 위치 지정"
                onChange={(e) =>
                  setAttrDraft((d) => ({ ...d, endPoint: e.target.value }))
                }
              />
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    btnGhost,
                    pointPickKind === "end" && "border-primary text-primary"
                  )}
                  onClick={() => {
                    if (geomEditMode) cancelGeomEdit();
                    setPointPickKind((k) => (k === "end" ? null : "end"));
                  }}
                >
                  <MapPin className="h-3 w-3" />
                  {pointPickKind === "end" ? "지정 중…" : "위치 지정"}
                </button>
                {attrDraft.endPointCoord ? (
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() =>
                      setAttrDraft((d) => ({
                        ...d,
                        endPointCoord: null,
                      }))
                    }
                  >
                    위치 지우기
                  </button>
                ) : null}
              </div>
            </div>
          ),
        }
      );
    }
    return entries;
  }, [attrDraft, pointPickKind, geomEditMode]);

  const showAddButton = bottomTab === "maintenance" || bottomTab === "complaints";

  return (
    <div className="relative flex min-h-0 h-full flex-col bg-white">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                badge.bg,
                badge.text,
                badge.border
              )}
            >
              {row.roadType}
            </span>
            <h2
              className={cn(
                "truncate text-sm font-semibold",
                row.roadName.trim() ? "text-slate-800" : "text-slate-400"
              )}
              title={row.roadName.trim() || "이름 없음"}
            >
              {row.roadName.trim() || "(이름 없음)"}
            </h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            노선 {row.roadNo || "—"} · {row.dept || "관리기관 미정"}
            {row.manager ? ` · ${row.manager}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={btnGhost}
            onClick={() => setReportOpen(true)}
            title="보고서"
          >
            <Printer className="h-3 w-3" />
            보고서
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <section className="shrink-0 border-b border-slate-200">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setAttrsOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-slate-700"
          >
            {attrsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            속성정보
          </button>
          {attrsOpen ? (
            <div className="flex shrink-0 items-center gap-1">
              {!attrEditing ? (
                <>
                  <button type="button" className={btnGhost} onClick={beginAttrEdit}>
                    <Pencil className="h-3 w-3" />
                    수정
                  </button>
                  <button type="button" className={btnDanger} onClick={handleDeleteRoad}>
                    <Trash2 className="h-3 w-3" />
                    삭제
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={btnGhost} onClick={cancelAttrEdit}>
                    취소
                  </button>
                  <button type="button" className={btnPrimary} onClick={handleSaveAttrs}>
                    저장
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        {attrsOpen ? (
          <div className="max-h-[42vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            {attrEditing ? (
              <AttrTable entries={attrEditEntries} />
            ) : (
              <AttrTable entries={attrEntries} />
            )}
          </div>
        ) : null}
      </section>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-2 pt-1.5"
          role="tablist"
          aria-label="이력·민원·첨부"
        >
          <div className="flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch overflow-x-auto scrollbar-hide">
            {bottomTabs.map((t) => {
              const active = bottomTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setBottomTab(t.id)}
                  className={cn(
                    "relative flex shrink-0 items-center px-2.5 pb-1.5 text-[11px] font-medium transition-colors",
                    active ? "text-primary" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {t.label}
                  {active ? (
                    <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mb-1 mr-1 flex h-7 shrink-0 items-center justify-end">
            {showAddButton ? (
              <button
                type="button"
                className={cn(btnPrimary, "shrink-0")}
                disabled={
                  (bottomTab === "maintenance" && siteModal?.kind === "maint") ||
                  (bottomTab === "complaints" && siteModal?.kind === "comp")
                }
                onClick={bottomTab === "maintenance" ? openNewMaint : openNewComp}
              >
                <Plus className="h-3 w-3" />
                추가
              </button>
            ) : bottomTab === "attachments" ? (
              <button
                type="button"
                className={cn(btnPrimary, "shrink-0")}
                onClick={() => roadAttachInputRef.current?.click()}
              >
                <Plus className="h-3 w-3" />
                첨부
              </button>
            ) : (
              <span className="invisible inline-flex h-7 items-center px-2 text-[11px]" aria-hidden>
                <Plus className="h-3 w-3" />
                추가
              </span>
            )}
          </div>
        </div>

        {(bottomTab === "maintenance" || bottomTab === "complaints") && (
          <div className="shrink-0 space-y-1.5 border-b border-slate-100 px-3 py-1.5">
            <input
              className={fieldClass}
              placeholder={
                bottomTab === "maintenance"
                  ? "유지보수 검색 (유형·내용·시공)"
                  : "민원 검색 (상태·신청인·내용)"
              }
              value={bottomTab === "maintenance" ? maintSearch : compSearch}
              onChange={(e) =>
                bottomTab === "maintenance"
                  ? setMaintSearch(e.target.value)
                  : setCompSearch(e.target.value)
              }
            />
            {bottomTab === "complaints" ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label="민원 상태 필터">
                {ROAD_NETWORK_COMPLAINT_STATE_FILTERS.map((filter) => {
                  const active = compStateFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setCompStateFilter(filter)}
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      )}
                      aria-pressed={active}
                    >
                      {filter}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
          {bottomTab === "maintenance" ? (
            filteredMaintenance.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-500">
                {row.maintenance.length === 0
                  ? "유지보수 이력이 없습니다."
                  : "검색 결과가 없습니다."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {filteredMaintenance.map((item) => {
                  const atts = ensureAttachments(item.attachments);
                  const focused = focusedSiteKey === `m-${item.id}`;
                  return (
                    <li
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditMaint(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openEditMaint(item);
                        }
                      }}
                      className={cn(
                        "cursor-pointer rounded-[10px] border bg-card px-3 py-2.5 transition-colors",
                        focused
                          ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/20"
                          : "border-border/80 hover:bg-slate-50"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            <Wrench className="h-3 w-3 shrink-0" />
                            {item.workType}
                          </span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="h-3 w-3" />
                            {item.date}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/90">
                          {item.content}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          시공: {item.contractor || "—"}
                        </p>
                        <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2">
                          <p
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 text-[11px]",
                              item.point ? "text-slate-600" : "text-slate-400"
                            )}
                          >
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {item.point
                                ? item.siteAddress || "주소 없음"
                                : "현장 미지정"}
                            </span>
                          </p>
                          <button
                            type="button"
                            className="flex max-w-full items-center gap-1 text-left text-[11px] text-slate-500 hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAttachmentPreview(atts);
                            }}
                            title="첨부 미리보기"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {atts.length}건 · {attachmentSummary(atts)}
                            </span>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : bottomTab === "complaints" ? (
            filteredComplaints.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-500">
                {row.complaints.length === 0 ? "관련 민원이 없습니다." : "검색 결과가 없습니다."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {filteredComplaints.map((comp) => {
                  const stateStyle = complaintStateStyle(comp.state);
                  const atts = ensureAttachments(comp.attachments);
                  const focused = focusedSiteKey === `c-${comp.id}`;
                  return (
                    <li
                      key={comp.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditComp(comp)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openEditComp(comp);
                        }
                      }}
                      className={cn(
                        "cursor-pointer rounded-[10px] border bg-card px-3 py-2.5 transition-colors",
                        focused
                          ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/20"
                          : "border-border/80 hover:bg-slate-50"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              stateStyle.bg,
                              stateStyle.text,
                              stateStyle.border
                            )}
                          >
                            {comp.state}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {comp.name || "—"}
                          </span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="h-3 w-3" />
                            {comp.date}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0 text-orange-500" />
                          <span className="truncate">
                            {comp.point
                              ? comp.address || "주소 없음"
                              : "현장 미지정"}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">
                          {comp.content}
                        </p>
                        <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2">
                          <button
                            type="button"
                            className="flex max-w-full items-center gap-1 text-left text-[11px] text-slate-500 hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAttachmentPreview(atts);
                            }}
                            title="첨부 미리보기"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {atts.length}건 · {attachmentSummary(atts)}
                            </span>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : bottomTab === "attachments" ? (
            roadAttachments.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-500">첨부파일이 없습니다.</p>
            ) : (
              <AttachmentThumbGrid
                items={roadAttachments}
                onPreview={(id) => openAttachmentPreview(roadAttachments, id)}
                onDownload={(id) => {
                  const att = roadAttachments.find((a) => a.id === id);
                  if (att) downloadAttachment(att);
                }}
                onDelete={(id) => deleteRoadAttachment(id)}
              />
            )
          ) : historyNewestFirst.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-slate-500">수정이력이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {historyNewestFirst.map((h) => {
                const lines = h.detail
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const titleLine = lines[0] ?? "";
                const changeLines = lines.length > 1 ? lines.slice(1) : [];
                return (
                  <li key={h.id} className="px-2.5 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        {h.action}
                      </span>
                      <span className="text-[10px] tabular-nums text-slate-500">{h.at}</span>
                      <span className="text-[10px] text-slate-400">{h.user}</span>
                    </div>
                    {changeLines.length > 0 ? (
                      <>
                        {titleLine.startsWith("«") ? (
                          <p className="mt-1 text-[11px] font-medium text-slate-700">
                            {titleLine}
                          </p>
                        ) : null}
                        <ul className="mt-1 space-y-0.5">
                          {(titleLine.startsWith("«") ? changeLines : lines).map(
                            (line, i) => (
                              <li
                                key={`${h.id}-${i}`}
                                className="text-[11px] leading-snug text-slate-800"
                              >
                                <span className="mr-1 text-slate-400">·</span>
                                {line}
                              </li>
                            )
                          )}
                        </ul>
                      </>
                    ) : (
                      <p className="mt-1 text-[11px] leading-snug text-slate-800">
                        {titleLine}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {siteModal ? (
          <RoadNetworkSiteItemModal
            kind={siteModal.kind}
            maintDraft={maintDraft}
            compDraft={compDraft}
            setMaintDraft={setMaintDraft}
            setCompDraft={setCompDraft}
            canDelete={
              siteModal.kind === "maint"
                ? row.maintenance.some((m) => m.id === siteModal.itemId)
                : row.complaints.some((c) => c.id === siteModal.itemId)
            }
            onClose={closeSiteModal}
            onDelete={() => {
              if (siteModal.kind === "maint") deleteMaint(siteModal.itemId);
              else deleteComp(siteModal.itemId);
            }}
            onSave={siteModal.kind === "maint" ? saveMaint : saveComp}
            attach={{
              onPreview: openAttachmentPreview,
              onDownload: downloadAttachment,
              onAddClick: () => {
                if (siteModal.kind === "maint") maintAttachInputRef.current?.click();
                else compAttachInputRef.current?.click();
              },
              onRemove: (id: string) => removeDraftAttachment(id, siteModal.kind),
            }}
            overlayLeftPx={overlayLeftPx}
            overlayWidthPx={overlayWidthPx}
          />
        ) : null}
      </div>

      <input
        ref={roadAttachInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addRoadAttachmentsFromFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <input
        ref={maintAttachInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addDraftAttachments(e.target.files, "maint");
          e.target.value = "";
        }}
      />

      <input
        ref={compAttachInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addDraftAttachments(e.target.files, "comp");
          e.target.value = "";
        }}
      />

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="flex max-h-[min(90vh,900px)] w-[min(56rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:rounded-lg">
          <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-3 text-left">
            <DialogTitle className="text-base font-semibold text-slate-800">
              {row.roadName} 상세보고서
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-slate-100">
            {reportHtml ? (
              <iframe
                ref={reportIframeRef}
                title="도로망도 상세보고서 미리보기"
                className="h-[min(70vh,720px)] w-full border-0 bg-white"
                srcDoc={reportHtml}
              />
            ) : null}
          </div>
          <DialogFooter className="gap-1 border-t border-slate-200 px-4 py-2.5 sm:space-x-0">
            <button type="button" className={btnGhost} onClick={() => setReportOpen(false)}>
              닫기
            </button>
            <button type="button" className={btnPrimary} onClick={printReport}>
              <Printer className="h-3 w-3" />
              인쇄 / PDF 저장
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unsupportedPreview}
        onOpenChange={(open) => {
          if (!open) setUnsupportedPreview(null);
        }}
      >
        <DialogContent className="max-w-sm gap-0 p-0 sm:rounded-lg">
          <DialogHeader className="border-b border-slate-200 px-4 py-3 text-left">
            <DialogTitle className="text-sm font-semibold text-slate-800">
              미리보기 불가
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 px-4 py-3 text-[12px] text-slate-600">
            <p className="font-medium text-slate-800">{unsupportedPreview?.name}</p>
            <p>
              {unsupportedPreview?.sizeLabel} · {unsupportedPreview?.uploadedAt}
            </p>
            <p className="text-[11px] text-slate-500">
              이미지·PDF만 미리볼 수 있습니다. 압축 파일 등은 다운로드 후 확인하세요.
              (임시 데이터는 서버 파일이 없습니다.)
            </p>
          </div>
          <DialogFooter className="border-t border-slate-200 px-4 py-2.5">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setUnsupportedPreview(null)}
            >
              확인
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filePreview ? (
        <ServiceFileImagePreview
          items={filePreview.items}
          initialIndex={filePreview.index}
          onClose={() => setFilePreview(null)}
        />
      ) : null}

      {mapEditBanner}
    </div>
  );
}
