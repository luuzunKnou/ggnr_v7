"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Download,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import "../../../_mapComponents/config/projections";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import GeoJSONFormat from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { transform } from "ol/proj";
import { isEmpty as isEmptyExtent } from "ol/extent";
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import { layerRowPanelButtonClass } from "../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles";
import {
  LayerParcelTextSection,
  useLayerParcelNavigation,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../../searchBarOffsetContext";
import {
  createAttachmentFromFile,
  getMockRiverFocus,
  normalizeRiverNames,
  resolveKnownRiverName,
  revokeAttachmentPreview,
  RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES,
  RIVER_CONSTRUCTION_RIVER_PRESETS,
  type RiverConstructionLedgerAttachment,
  type RiverConstructionLedgerAttachmentCategory,
  type RiverConstructionLedgerGeom,
  type RiverConstructionLedgerRow,
} from "./riverConstructionLedgerMock";

type Props = {
  row: RiverConstructionLedgerRow;
  onClose: () => void;
};

const fieldClass =
  "h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const textareaClass =
  "min-h-[2.75rem] w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";
const btnDanger =
  "inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-white px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

type AttrDraft = {
  name: string;
  location: string;
  quantity: string;
  contractDate: string;
  startDate: string;
  endDate: string;
  actualEndDate: string;
  companyName: string;
  representative: string;
  phone: string;
  companyAddress: string;
  supervisor: string;
  supervisorName: string;
  budgetBefore: string;
  budgetIncrease: string;
  budgetDecrease: string;
  budgetAfter: string;
  changeReason: string;
  remark: string;
};

function toDraft(row: RiverConstructionLedgerRow): AttrDraft {
  return {
    name: row.name,
    location: row.location,
    quantity: row.quantity,
    contractDate: row.contractDate,
    startDate: row.startDate,
    endDate: row.endDate,
    actualEndDate: row.actualEndDate,
    companyName: row.companyName,
    representative: row.representative,
    phone: row.phone,
    companyAddress: row.companyAddress,
    supervisor: row.supervisor,
    supervisorName: row.supervisorName,
    budgetBefore: row.budgetBefore,
    budgetIncrease: row.budgetIncrease,
    budgetDecrease: row.budgetDecrease,
    budgetAfter: row.budgetAfter,
    changeReason: row.changeReason,
    remark: row.remark,
  };
}

function cloneGeom(geom: RiverConstructionLedgerGeom): RiverConstructionLedgerGeom {
  return {
    type: "MultiPolygon",
    coordinates: geom.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map((c) => [c[0]!, c[1]!] as [number, number]))
    ),
  };
}

/** 도형(폴리곤 여러 개) 유무 확인 */
function hasGeomPolygons(geom: RiverConstructionLedgerGeom | null | undefined): boolean {
  return Boolean(geom?.coordinates?.length);
}

/** 폴리곤 feature 여러 개 → MultiPolygon 좌표 (구멍/홀은 미지원, 외곽선만) */
function geomFromPolygonFeatures(
  features: Feature[],
  viewProj: string
): RiverConstructionLedgerGeom | null {
  const polygons: [number, number][][][] = [];
  for (const feature of features) {
    const g = feature.getGeometry();
    if (!g || g.getType() !== "Polygon") continue;
    const rings = (g as Polygon).getCoordinates();
    const outer = rings[0];
    if (!outer || outer.length < 4) continue;
    const coords4326 = outer.map(
      (c) => transform(c, viewProj, "EPSG:4326") as [number, number]
    );
    polygons.push([coords4326]);
  }
  if (polygons.length === 0) return null;
  return { type: "MultiPolygon", coordinates: polygons };
}

/**
 * 공사구간 도형(4326) → 필지조회용 WKT(5181).
 * 도로점용(LayerRowGeomEditHandler)과 동일하게 3857을 거쳐 5181로 변환한다.
 * (4326→5181 직접 featureProjection은 환경에 따라 실패할 수 있음)
 */
function geomToWkt5181(geom: RiverConstructionLedgerGeom | null): string | null {
  if (!hasGeomPolygons(geom)) return null;
  try {
    const olGeom = new GeoJSONFormat().readGeometry(
      { type: geom!.type, coordinates: geom!.coordinates },
      { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
    );
    if (!olGeom) return null;
    olGeom.transform("EPSG:3857", "EPSG:5181");
    const wkt = new WKT().writeGeometry(olGeom);
    return wkt?.trim() ? wkt : null;
  } catch (e) {
    console.error("[riverConstructionLedger] geomToWkt5181 failed", e);
    return null;
  }
}

/** 도형에서 자동 조회된 필지목록 병합 — 수동 추가(showMapGeom===true)는 유지, 자동조회분만 최신화 */
function mergeAutoParcels(
  prev: LayerRowParcelItem[],
  autoRaw: LayerRowParcelItem[]
): LayerRowParcelItem[] {
  const manual = prev.filter((p) => p.showMapGeom === true);
  const seen = new Set(manual.map((p) => p.address.toLowerCase()));
  const merged = [...manual];
  for (const item of autoRaw) {
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, showMapGeom: false });
  }
  return merged;
}

type AttrEntry = {
  fieldKey: string;
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
};

/** 반칸에서 말줄임이 날 길이면 한 줄 전체 폭으로 표시 */
const ATTR_FULL_WIDTH_MIN_LEN = 12;

function withFullWidthIfLong(
  entries: AttrEntry[],
  textByKey?: Record<string, string>
): AttrEntry[] {
  return entries.map((e) => {
    if (e.fullWidth) return e;
    const raw =
      textByKey?.[e.fieldKey] ??
      (typeof e.value === "string" ? e.value : "");
    const t = String(raw ?? "").trim();
    if (t && t !== "—" && [...t].length >= ATTR_FULL_WIDTH_MIN_LEN) {
      return { ...e, fullWidth: true };
    }
    return e;
  });
}

function AttrValue({ value }: { value: ReactNode }) {
  if (typeof value === "string") {
    return (
      <span
        className="block truncate text-[11px] leading-snug text-slate-700"
        title={value && value !== "—" ? value : undefined}
      >
        {value || "—"}
      </span>
    );
  }
  return value;
}

function AttrLabelCell({
  label,
  borderBottom,
  borderRight,
  roundedCorner,
}: {
  label: string;
  borderBottom: boolean;
  borderRight: boolean;
  roundedCorner?: "tl" | "bl";
}) {
  return (
    <div
      className={cn(
        "flex items-center bg-slate-100 px-2 py-1.5",
        borderBottom && "border-b border-slate-200",
        borderRight && "border-r border-slate-200",
        roundedCorner === "tl" && "rounded-tl-[5px]",
        roundedCorner === "bl" && "rounded-bl-[5px]"
      )}
    >
      <span className="whitespace-nowrap text-[11px] font-medium leading-snug text-slate-600">
        {label}
      </span>
    </div>
  );
}

function AttrValueCell({
  value,
  borderBottom,
  borderRight,
  gridColumn,
}: {
  value: ReactNode;
  borderBottom: boolean;
  borderRight: boolean;
  gridColumn?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-2 py-1.5",
        borderBottom && "border-b border-slate-200",
        borderRight && "border-r border-slate-200"
      )}
      style={gridColumn ? { gridColumn } : undefined}
    >
      <AttrValue value={value} />
    </div>
  );
}

/**
 * 진짜 <table>처럼 라벨 칸 폭이 내용(최대 라벨 길이)에 맞춰지고,
 * 값 칸이 남는 폭을 전부 쓰도록 하나의 CSS grid로 전체 행을 묶어 렌더링한다.
 * (행마다 별도 grid를 쓰면 칸 폭이 행끼리 안 맞아 라벨이 잘리거나 값 칸이 좁아짐)
 */
function AttrTable({ entries }: { entries: AttrEntry[] }) {
  const rows: { left: AttrEntry; right?: AttrEntry }[] = [];
  let i = 0;
  while (i < entries.length) {
    const left = entries[i]!;
    if (left.fullWidth) {
      rows.push({ left });
      i += 1;
      continue;
    }
    const next = entries[i + 1];
    if (next && !next.fullWidth) {
      rows.push({ left, right: next });
      i += 2;
    } else {
      rows.push({ left });
      i += 1;
    }
  }

  return (
    <div
      className="grid overflow-visible rounded-[5px] border border-slate-200"
      style={{ gridTemplateColumns: "max-content minmax(0,1fr) max-content minmax(0,1fr)" }}
    >
      {rows.map((pair, rowIdx) => {
        const isLast = rowIdx === rows.length - 1;
        const borderBottom = !isLast;
        const roundedCorner = rowIdx === 0 ? "tl" : isLast ? "bl" : undefined;
        if (!pair.right) {
          return (
            <Fragment key={pair.left.fieldKey}>
              <AttrLabelCell
                label={pair.left.label}
                borderBottom={borderBottom}
                borderRight
                roundedCorner={roundedCorner}
              />
              <AttrValueCell
                value={pair.left.value}
                borderBottom={borderBottom}
                borderRight={false}
                gridColumn="2 / -1"
              />
            </Fragment>
          );
        }
        return (
          <Fragment key={`${pair.left.fieldKey}-${pair.right.fieldKey}`}>
            <AttrLabelCell
              label={pair.left.label}
              borderBottom={borderBottom}
              borderRight
              roundedCorner={roundedCorner}
            />
            <AttrValueCell value={pair.left.value} borderBottom={borderBottom} borderRight />
            <AttrLabelCell label={pair.right.label} borderBottom={borderBottom} borderRight />
            <AttrValueCell value={pair.right.value} borderBottom={borderBottom} borderRight={false} />
          </Fragment>
        );
      })}
    </div>
  );
}

/** 첨부 썸네일 — 클릭=미리보기, 호버 시 다운로드·삭제 (용량·업로드시각은 표시 안 함) */
function AttachmentThumb({
  att,
  onPreview,
  onDownload,
  onDelete,
}: {
  att: RiverConstructionLedgerAttachment;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
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
          <img src={att.previewUrl} alt={att.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
            <FileText className="h-5 w-5" />
            <span className="text-[10px] font-semibold">{isPdf ? "PDF" : "파일"}</span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity group-hover:opacity-100">
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
  emptyLabel,
}: {
  items: RiverConstructionLedgerAttachment[];
  onPreview: (att: RiverConstructionLedgerAttachment) => void;
  onDownload: (att: RiverConstructionLedgerAttachment) => void;
  onDelete: (att: RiverConstructionLedgerAttachment) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-center text-[11px] text-slate-500">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((att) => (
        <AttachmentThumb
          key={att.id}
          att={att}
          onPreview={() => onPreview(att)}
          onDownload={() => onDownload(att)}
          onDelete={() => onDelete(att)}
        />
      ))}
    </div>
  );
}

const RIVER_TABLE_PREVIEW_MAX = 2;

function RiverManagePopover({
  open,
  onClose,
  containerRef,
  selectedRivers,
  availableRivers,
  focusedRiver,
  onAdd,
  onRemove,
  onFocus,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  selectedRivers: readonly string[];
  availableRivers: readonly string[];
  focusedRiver: string | null;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onFocus: (name: string) => void;
}) {
  const [tab, setTab] = useState<"selected" | "add">("selected");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setFilter("");
    // 열 때만 초기 탭 설정 — 추가 중 length 변해도 탭 유지 (연속 추가)
    setTab(selectedRivers.length > 0 ? "selected" : "add");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 전환 시에만
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (containerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, containerRef]);

  const filteredAvailable = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return availableRivers;
    return availableRivers.filter((n) => n.toLowerCase().includes(q));
  }, [availableRivers, filter]);

  const filteredSelected = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return selectedRivers;
    return selectedRivers.filter((n) => n.toLowerCase().includes(q));
  }, [selectedRivers, filter]);

  if (!open) return null;

  return (
    <div
      className="absolute right-0 top-[calc(100%+0.25rem)] z-30 flex w-[min(100%,13rem)] flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
      role="dialog"
      aria-label="대상 하천 관리"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-slate-700">대상 하천 관리</span>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onClick={onClose}
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex rounded border border-slate-200 bg-slate-50 p-0.5">
        <button
          type="button"
          className={cn(
            "flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors",
            tab === "selected"
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
          onClick={() => setTab("selected")}
        >
          등록 ({selectedRivers.length})
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors",
            tab === "add"
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
          onClick={() => setTab("add")}
        >
          추가 ({availableRivers.length})
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
        <input
          className={cn(fieldClass, "h-6 pl-6 text-[10px]")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={tab === "selected" ? "등록 하천 검색" : "추가할 하천 검색"}
          autoFocus
        />
      </div>

      <div className="max-h-72 min-h-0 overflow-y-auto rounded border border-slate-200 bg-white scrollbar-hide">
        {tab === "selected" ? (
          filteredSelected.length === 0 ? (
            <p className="px-2 py-4 text-center text-[10px] text-slate-400">
              {selectedRivers.length === 0
                ? "등록된 하천이 없습니다. «추가»에서 선택하세요."
                : "검색 결과가 없습니다."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredSelected.map((name) => {
                const focused = focusedRiver === name;
                return (
                  <li key={name} className="flex items-center gap-0.5 pr-0.5">
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[11px] hover:bg-sky-50",
                        focused ? "font-medium text-sky-800" : "text-slate-800"
                      )}
                      onClick={() => onFocus(name)}
                      title="지도에서 위치 보기"
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="삭제"
                      aria-label={`${name} 삭제`}
                      onClick={() => onRemove(name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : filteredAvailable.length === 0 ? (
          <p className="px-2 py-4 text-center text-[10px] text-slate-400">
            {availableRivers.length === 0
              ? "추가할 수 있는 하천이 없습니다."
              : "검색 결과가 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredAvailable.map((name) => {
              const focused = focusedRiver === name;
              return (
                <li key={name} className="flex items-center gap-0.5 pr-0.5">
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[11px] hover:bg-sky-50",
                      focused ? "font-medium text-sky-800" : "text-slate-800"
                    )}
                    onClick={() => onFocus(name)}
                    title="지도에서 위치 보기"
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-sky-700 hover:bg-sky-50"
                    title="목록에 추가"
                    aria-label={`${name} 추가`}
                    onClick={() => onAdd(name)}
                  >
                    추가
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RiverConstructionLedgerDetailPanel({ row, onClose }: Props) {
  const mapContext = useMapContext();
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(!row.name.trim());
  const [draft, setDraft] = useState<AttrDraft>(() => toDraft(row));
  const [geomEditMode, setGeomEditMode] = useState<"draw" | "modify" | null>(null);
  // 도형삭제·초기화처럼 모드 값은 그대로("modify")인데 도형만 바뀌는 경우 수정 세션을 강제로 다시 시작시키는 토큰
  const [geomModifyResetToken, setGeomModifyResetToken] = useState(0);
  const geomModifySnapshotRef = useRef<RiverConstructionLedgerGeom | null>(null);
  const parcelsSnapshotRef = useRef<LayerRowParcelItem[]>([]);
  const riverManageWrapRef = useRef<HTMLDivElement>(null);
  const [riverAddOpen, setRiverAddOpen] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<RiverConstructionLedgerAttachmentCategory>(
    RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES[0]!.value
  );
  const [preview, setPreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  /** 편집 중 필지목록 — 도로점용처럼 로컬 state로 즉시 반영 (context round-trip 대기하지 않음) */
  const [draftParcels, setDraftParcels] = useState<LayerRowParcelItem[]>(() => row.parcels ?? []);
  const draftParcelsRef = useRef(draftParcels);
  draftParcelsRef.current = draftParcels;
  const [loadingParcels, setLoadingParcels] = useState(false);

  const riverFocus = mapContext?.riverConstructionLedgerRiverFocus ?? null;
  const setRiverFocus = mapContext?.setRiverConstructionLedgerRiverFocus;
  const setGeomEditingId = mapContext?.setRiverConstructionLedgerGeomEditingId;

  const { inputBottomPx } = useSearchBarOffset();
  const geomHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapInstance = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const geomCenterPixel = useMapVisualCenterPixel(
    mapInstance,
    Boolean(mapInstance) && geomEditMode != null,
    mapPaddingLeft
  );

  useEffect(() => {
    setDraft(toDraft(row));
    setRiverAddOpen(false);
    setAttachmentTab(RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES[0]!.value);
    geomModifySnapshotRef.current = null;
    parcelsSnapshotRef.current = [...(row.parcels ?? [])];
    setDraftParcels(row.parcels ?? []);
    setGeomEditMode(null);
    setGeomEditingId?.(null);

    const isNew = !row.name.trim();
    setEditing(isNew);
    if (isNew) {
      // 신규 공사: 속성·도형 편집을 함께 시작 (도로망도와 동일 패턴)
      if (hasGeomPolygons(row.geom)) {
        geomModifySnapshotRef.current = cloneGeom(row.geom!);
        setGeomEditMode("modify");
      } else {
        setGeomEditMode("draw");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id 전환 시에만
  }, [row.id, setGeomEditingId]);

  useEffect(() => {
    return () => {
      setGeomEditMode(null);
      geomModifySnapshotRef.current = null;
      setGeomEditingId?.(null);
    };
  }, [setGeomEditingId]);

  useEffect(() => {
    setGeomEditingId?.(geomEditMode ? row.id : null);
  }, [geomEditMode, row.id, setGeomEditingId]);

  const attachments = row.attachments ?? [];
  const riverNames = normalizeRiverNames(row.riverNames);

  /** 아직 등록되지 않은 마스터 하천만 */
  const availableRivers = useMemo(() => {
    const registered = new Set(riverNames.map((n) => n.toLowerCase()));
    return RIVER_CONSTRUCTION_RIVER_PRESETS.filter((n) => !registered.has(n.toLowerCase()));
  }, [riverNames]);

  const patchRow = (updater: (prev: RiverConstructionLedgerRow) => RiverConstructionLedgerRow) => {
    mapContext?.setRiverConstructionLedgerRows?.((rows) =>
      rows.map((r) => (r.id === row.id ? updater(r) : r))
    );
  };

  const writeGeom = (geom: RiverConstructionLedgerGeom | null) => {
    patchRow((prev) => ({ ...prev, geom }));
    // 목록 동기화 전에도 오버레이가 바로 따라가도록 동일 행 반영
    mapContext?.setRiverConstructionLedgerOverlayRows?.((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, geom } : r))
    );
  };

  const parcels = row.parcels ?? [];
  const { navigateToParcel, movingParcelIdx } = useLayerParcelNavigation();

  /**
   * 도형(공사구간)과 겹치는 필지 자동 조회 — 도로점용과 동일 패턴.
   * draw/modify effect 클로저에서 stale 되지 않도록 ref로 최신 함수를 유지한다.
   */
  const fetchParcelsForGeom = useCallback(
    async (geom: RiverConstructionLedgerGeom | null, opts?: { silent?: boolean }) => {
      const writeParcels = (next: LayerRowParcelItem[]) => {
        draftParcelsRef.current = next;
        setDraftParcels(next);
        mapContext?.setRiverConstructionLedgerRows?.((rows) =>
          rows.map((r) => (r.id === row.id ? { ...r, parcels: next } : r))
        );
      };

      const wkt = geomToWkt5181(geom);
      if (!wkt) {
        writeParcels(draftParcelsRef.current.filter((p) => p.showMapGeom === true));
        if (geom && !opts?.silent) {
          window.alert("도형 좌표 변환에 실패해 필지목록을 조회하지 못했습니다.");
        }
        return;
      }
      setLoadingParcels(true);
      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "listJijukParcelsByGeomWkt5181",
          params: { wkt5181: wkt },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          if (!opts?.silent) window.alert(String(data.error));
          return;
        }
        const raw = Array.isArray(data?.parcels) ? data.parcels : [];
        const items = raw
          .map((x: Record<string, unknown>) => {
            const address = String(x?.address ?? "").trim();
            const pnu = String(x?.pnu ?? "").trim();
            if (!address && !pnu) return null;
            const extRaw = x?.extent3857 as unknown;
            const extent3857 =
              Array.isArray(extRaw) &&
              extRaw.length === 4 &&
              extRaw.every((v) => Number.isFinite(Number(v)))
                ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                : null;
            const geometry3857 =
              x?.geometry3857 != null && typeof x.geometry3857 === "object"
                ? (x.geometry3857 as Record<string, unknown>)
                : null;
            return {
              address: address || pnu,
              pnu: pnu || undefined,
              extent3857,
              geometry3857,
            };
          })
          .filter((x: LayerRowParcelItem | null): x is LayerRowParcelItem => x != null);

        writeParcels(mergeAutoParcels(draftParcelsRef.current, items));
      } catch (e) {
        console.error("[riverConstructionLedger] fetchParcelsForGeom failed", e);
        if (!opts?.silent) window.alert("필지목록을 불러오지 못했습니다.");
      } finally {
        setLoadingParcels(false);
      }
    },
    [mapContext?.setRiverConstructionLedgerRows, row.id]
  );

  const fetchParcelsRef = useRef(fetchParcelsForGeom);
  fetchParcelsRef.current = fetchParcelsForGeom;

  const handleAddParcel = (item: LayerRowParcelItem) => {
    const key = item.address.toLowerCase();
    if (draftParcelsRef.current.some((p) => p.address.toLowerCase() === key)) return;
    const next = [...draftParcelsRef.current, { ...item, showMapGeom: true as const }];
    draftParcelsRef.current = next;
    setDraftParcels(next);
    patchRow((r) => ({ ...r, parcels: next }));
  };

  const handleRemoveParcel = (index: number) => {
    const next = draftParcelsRef.current.filter((_, i) => i !== index);
    draftParcelsRef.current = next;
    setDraftParcels(next);
    patchRow((r) => ({ ...r, parcels: next }));
  };

  /** 지도에서 공사구간 폴리곤 추가 그리기 — 기존 도형은 유지한 채 하나 더 추가 */
  useEffect(() => {
    if (geomEditMode !== "draw") return;
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
    setRiverFocus?.(null);

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";

    // 기존 도형(있다면) — 새 도형을 그리는 동안에도 화면에서 사라지지 않도록 참고용으로 계속 표시
    const existingSource = new VectorSource();
    if (row.geom?.coordinates?.length) {
      const existingFeatures = row.geom.coordinates.map((polygon) => {
        const ringsMap = polygon.map((ring) => ring.map((c) => transform(c, "EPSG:4326", viewProj)));
        return new Feature({ geometry: new Polygon(ringsMap) });
      });
      existingSource.addFeatures(existingFeatures);
    }
    const existingLayer = new VectorLayer({
      source: existingSource,
      zIndex: 9998,
      style: new Style({
        fill: new Fill({ color: "rgba(234, 88, 12, 0.18)" }),
        stroke: new Stroke({ color: "#c2410c", width: 2 }),
      }),
    });
    map.addLayer(existingLayer);

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        fill: new Fill({ color: "rgba(14, 165, 233, 0.25)" }),
        stroke: new Stroke({ color: "#0284c7", width: 2.5 }),
      }),
    });
    const draw = new Draw({ source, type: "Polygon", stopClick: true });
    map.addLayer(layer);
    map.addInteraction(draw);

    const onEnd = (evt: { feature: Feature }) => {
      const drawn = geomFromPolygonFeatures([evt.feature], viewProj);
      if (!drawn) {
        window.alert("다각형은 세 점 이상이어야 합니다.");
        setGeomEditMode(hasGeomPolygons(row.geom) ? "modify" : null);
        return;
      }
      const merged: RiverConstructionLedgerGeom = {
        type: "MultiPolygon",
        coordinates: [...(row.geom?.coordinates ?? []), ...drawn.coordinates],
      };
      writeGeom(merged);
      void fetchParcelsRef.current(merged);
      // 그린 도형을 바로 정점 수정할 수 있도록 수정 모드로 전환 (다시 «도형추가»로 더 그릴 수 있음)
      setGeomEditMode("modify");
    };
    draw.on("drawend", onEnd as never);

    return () => {
      draw.un("drawend", onEnd as never);
      map.removeInteraction(draw);
      map.removeLayer(layer);
      map.removeLayer(existingLayer);
      source.clear();
      existingSource.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw session keyed by mode
  }, [geomEditMode]);

  /** 기존 공사구간 폴리곤 전체(여러 개) 정점 수정 — 한 화면에서 같이 편집 */
  useEffect(() => {
    if (geomEditMode !== "modify") return;
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
    setRiverFocus?.(null);

    // 도형삭제 후에도 편집 세션(안내창)은 유지 — 도형 없이 빈 상태로 시작, «도형추가»로 다시 그릴 수 있음
    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const features = (row.geom?.coordinates ?? []).map((polygon) => {
      const ringsMap = polygon.map((ring) =>
        ring.map((c) => transform(c, "EPSG:4326", viewProj))
      );
      return new Feature({ geometry: new Polygon(ringsMap) });
    });

    const source = new VectorSource({ features });
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: new Style({
        fill: new Fill({ color: "rgba(234, 88, 12, 0.22)" }),
        stroke: new Stroke({ color: "#c2410c", width: 2.5 }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#ea580c" }),
          stroke: new Stroke({ color: "#fff", width: 1.5 }),
        }),
      }),
    });
    const modify = new Modify({ source });
    map.addLayer(layer);
    map.addInteraction(modify);

    const extent = source.getExtent();
    if (!isEmptyExtent(extent)) {
      map.getView().fit(extent, {
        padding: [80, 80, 80, 80],
        maxZoom: 17,
        duration: 280,
      });
    }

    const onModifyEnd = () => {
      const parsed = geomFromPolygonFeatures(source.getFeatures(), viewProj);
      writeGeom(parsed);
      void fetchParcelsRef.current(parsed, { silent: true });
    };
    modify.on("modifyend", onModifyEnd);

    return () => {
      modify.un("modifyend", onModifyEnd);
      map.removeInteraction(modify);
      map.removeLayer(layer);
      source.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modify session keyed by mode·리셋 토큰
  }, [geomEditMode, geomModifyResetToken]);

  /** «수정» 진입 시 속성 편집과 함께 도형(다각형) 편집도 자동 시작 — 도로망도와 동일 패턴 */
  const beginGeomSession = () => {
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return;
    parcelsSnapshotRef.current = [...draftParcels];
    if (hasGeomPolygons(row.geom)) {
      geomModifySnapshotRef.current = cloneGeom(row.geom!);
      setGeomEditMode("modify");
      void fetchParcelsRef.current(row.geom, { silent: true });
    } else {
      geomModifySnapshotRef.current = null;
      setGeomEditMode("draw");
    }
  };

  const beginEdit = () => {
    setDraft(toDraft(row));
    setEditing(true);
    beginGeomSession();
  };

  /** 도형을 하나 더 추가로 그리기 시작 — 기존 도형은 그대로 유지 */
  const restartGeomDraw = () => {
    setGeomEditMode("draw");
  };

  /** 편집 중 도형만 삭제 — 안내창·편집 세션은 유지, «도형추가»로 바로 다시 그릴 수 있음 */
  const clearGeomDraft = () => {
    writeGeom(null);
    void fetchParcelsRef.current(null, { silent: true });
    setGeomModifyResetToken((t) => t + 1);
    setGeomEditMode("modify");
  };

  /** 편집 시작 시점 도형 스냅샷으로 되돌리기 (편집은 계속 유지) */
  const resetGeomToSnapshot = () => {
    const snap = geomModifySnapshotRef.current;
    if (!snap) return;
    writeGeom(cloneGeom(snap));
    void fetchParcelsRef.current(snap, { silent: true });
    setGeomModifyResetToken((t) => t + 1);
    setGeomEditMode("modify");
  };

  const handleSave = () => {
    if (!draft.name.trim()) {
      window.alert("공사명을 입력하세요.");
      return;
    }
    patchRow((prev) => ({
      ...prev,
      name: draft.name.trim(),
      location: draft.location.trim(),
      quantity: draft.quantity.trim(),
      contractDate: draft.contractDate.trim(),
      startDate: draft.startDate.trim(),
      endDate: draft.endDate.trim(),
      actualEndDate: draft.actualEndDate.trim(),
      companyName: draft.companyName.trim(),
      representative: draft.representative.trim(),
      phone: draft.phone.trim(),
      companyAddress: draft.companyAddress.trim(),
      supervisor: draft.supervisor.trim(),
      supervisorName: draft.supervisorName.trim(),
      budgetBefore: draft.budgetBefore.trim(),
      budgetIncrease: draft.budgetIncrease.trim(),
      budgetDecrease: draft.budgetDecrease.trim(),
      budgetAfter: draft.budgetAfter.trim(),
      changeReason: draft.changeReason.trim(),
      remark: draft.remark.trim(),
      parcels: draftParcelsRef.current,
    }));
    // 도형은 그리기·수정 중 실시간으로 이미 반영돼 있어 편집 세션만 종료
    setGeomEditMode(null);
    geomModifySnapshotRef.current = null;
    setRiverAddOpen(false);
    setEditing(false);
  };

  const handleAddRiver = (raw: string) => {
    const known = resolveKnownRiverName(raw);
    if (!known) {
      window.alert("등록된 하천 목록에서만 추가할 수 있습니다.");
      return;
    }
    if (riverNames.some((n) => n.toLowerCase() === known.toLowerCase())) {
      window.alert("이미 등록된 하천입니다.");
      return;
    }
    patchRow((prev) => ({
      ...prev,
      riverNames: normalizeRiverNames([...(prev.riverNames ?? []), known]),
    }));
  };

  const handleRemoveRiver = (name: string) => {
    patchRow((prev) => ({
      ...prev,
      riverNames: normalizeRiverNames(prev.riverNames).filter((n) => n !== name),
    }));
  };

  /** 대상 하천 클릭 → 임시 좌표로 지도 이동·강조 */
  const handleFocusRiver = (riverName: string) => {
    const focus = getMockRiverFocus(riverName);
    if (!focus) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) {
      window.alert("지도가 준비되지 않았습니다.");
      return;
    }
    setRiverFocus?.({ riverName: focus.riverName, extent3857: focus.extent3857 });
    scheduleFitMapToExtent3857(map, focus.extent3857, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      pointThreshold: 1,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

  const handleCancel = () => {
    setDraft(toDraft(row));
    if (geomModifySnapshotRef.current) {
      writeGeom(cloneGeom(geomModifySnapshotRef.current));
    } else if (!row.name.trim()) {
      writeGeom(null);
    }
    const snapParcels = [...parcelsSnapshotRef.current];
    setDraftParcels(snapParcels);
    patchRow((prev) => ({ ...prev, parcels: snapParcels }));
    setGeomEditMode(null);
    geomModifySnapshotRef.current = null;
    setRiverAddOpen(false);
    if (!row.name.trim()) {
      mapContext?.setRiverConstructionLedgerRows?.((rows) => rows.filter((r) => r.id !== row.id));
      mapContext?.setRiverConstructionLedgerSelectedId?.(null);
      return;
    }
    setEditing(false);
  };

  const handleDelete = () => {
    if (!window.confirm(`「${row.name || "신규 공사"}」을(를) 삭제할까요?`)) return;
    for (const att of attachments) revokeAttachmentPreview(att);
    mapContext?.setRiverConstructionLedgerRows?.((rows) => rows.filter((r) => r.id !== row.id));
    mapContext?.setRiverConstructionLedgerSelectedId?.(null);
  };

  const handleUploadFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = Array.from(files).map((f) => createAttachmentFromFile(f, attachmentTab));
    patchRow((prev) => ({
      ...prev,
      attachments: [...next, ...(prev.attachments ?? [])],
    }));
    if (attachInputRef.current) attachInputRef.current.value = "";
  };

  const handleDeleteAttachment = (id: string) => {
    const target = attachments.find((a) => a.id === id);
    if (!window.confirm(`«${target?.name ?? "첨부파일"}»을(를) 삭제할까요?`)) return;
    revokeAttachmentPreview(target);
    patchRow((prev) => ({
      ...prev,
      attachments: (prev.attachments ?? []).filter((a) => a.id !== id),
    }));
  };

  const downloadAttachment = (att: RiverConstructionLedgerAttachment) => {
    if (!att.previewUrl) {
      window.alert("다운로드할 파일이 없습니다. (업로드한 파일만 가능)");
      return;
    }
    const a = document.createElement("a");
    a.href = att.previewUrl;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openPreview = (att: RiverConstructionLedgerAttachment) => {
    const scoped = attachments.filter((a) => a.category === att.category);
    const items: ServiceFilePreviewItem[] = scoped
      .filter((a) => a.previewUrl && (a.previewKind === "image" || a.previewKind === "pdf"))
      .map((a) => ({
        url: a.previewUrl!,
        fileName: a.name,
        kind: a.previewKind === "pdf" ? ("pdf" as const) : ("image" as const),
      }));
    const idx = items.findIndex((i) => i.fileName === att.name);
    if (idx < 0) {
      if (att.previewUrl) downloadAttachment(att);
      else window.alert("미리볼 수 있는 첨부파일이 없습니다.");
      return;
    }
    setPreview({ items, index: idx });
  };

  const closeRiverManage = useCallback(() => setRiverAddOpen(false), []);

  const riverPreview = riverNames.slice(0, RIVER_TABLE_PREVIEW_MAX);
  const riverMoreCount = Math.max(0, riverNames.length - RIVER_TABLE_PREVIEW_MAX);

  const riverNamesCell = (
    <div ref={riverManageWrapRef} className="relative flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {riverNames.length === 0 ? (
          <span className="text-[11px] leading-snug text-[#666]">—</span>
        ) : (
          <p className="truncate text-[11px] leading-snug text-[#666]" title={riverNames.join(", ")}>
            {riverPreview.join(", ")}
            {riverMoreCount > 0 ? (
              <span className="text-slate-400"> 외 {riverMoreCount}</span>
            ) : null}
          </p>
        )}
      </div>
      {editing ? (
        <>
          <button
            type="button"
            className={cn(btnGhost, "h-6 shrink-0 px-1.5 text-[10px]")}
            onClick={(e) => {
              e.stopPropagation();
              setRiverAddOpen((v) => !v);
            }}
            title="대상 하천 추가·삭제"
            aria-expanded={riverAddOpen}
          >
            <Plus className="h-3 w-3" />
            관리
          </button>
          <RiverManagePopover
            open={riverAddOpen}
            onClose={closeRiverManage}
            containerRef={riverManageWrapRef}
            selectedRivers={riverNames}
            availableRivers={availableRivers}
            focusedRiver={riverFocus?.riverName ?? null}
            onAdd={handleAddRiver}
            onRemove={(name) => {
              if (riverFocus?.riverName === name) setRiverFocus?.(null);
              handleRemoveRiver(name);
            }}
            onFocus={handleFocusRiver}
          />
        </>
      ) : null}
    </div>
  );

  const withRiverEntry = (entries: AttrEntry[]): AttrEntry[] => {
    const riverEntry: AttrEntry = {
      fieldKey: "riverNames",
      label: `대상 하천${riverNames.length > 0 ? ` (${riverNames.length})` : ""}`,
      fullWidth: true,
      value: riverNamesCell,
    };
    // 공사명·공사위치 다음에 한 줄로 배치
    return [entries[0]!, entries[1]!, riverEntry, ...entries.slice(2)];
  };

  const viewEntries = useMemo(
    () =>
      withRiverEntry(
        withFullWidthIfLong([
          { fieldKey: "name", label: "공사명", value: row.name || "—" },
          { fieldKey: "location", label: "공사위치", value: row.location || "—" },
          { fieldKey: "quantity", label: "공사량", value: row.quantity || "—" },
          { fieldKey: "contractDate", label: "계약일", value: row.contractDate || "—" },
          { fieldKey: "startDate", label: "착수일자", value: row.startDate || "—" },
          { fieldKey: "endDate", label: "준공일자", value: row.endDate || "—" },
          { fieldKey: "actualEndDate", label: "실준공일자", value: row.actualEndDate || "—" },
          { fieldKey: "companyName", label: "업체명", value: row.companyName || "—" },
          { fieldKey: "representative", label: "대표자명", value: row.representative || "—" },
          { fieldKey: "phone", label: "전화번호", value: row.phone || "—" },
          { fieldKey: "supervisor", label: "감독관", value: row.supervisor || "—" },
          { fieldKey: "supervisorName", label: "감독관명", value: row.supervisorName || "—" },
          { fieldKey: "budgetBefore", label: "사업비_전", value: row.budgetBefore || "—" },
          { fieldKey: "budgetIncrease", label: "사업비_증가", value: row.budgetIncrease || "—" },
          { fieldKey: "budgetDecrease", label: "사업비_감소", value: row.budgetDecrease || "—" },
          { fieldKey: "budgetAfter", label: "사업비_후", value: row.budgetAfter || "—" },
          { fieldKey: "companyAddress", label: "업체주소", value: row.companyAddress || "—" },
          { fieldKey: "changeReason", label: "변경사유", value: row.changeReason || "—" },
          { fieldKey: "remark", label: "비고", value: row.remark || "—" },
        ])
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- riverNamesCell follows riverNames/focus
    [row, riverNames, riverFocus, availableRivers.length]
  );

  const setField = <K extends keyof AttrDraft>(key: K, value: AttrDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const textInput = (key: keyof AttrDraft) => (
    <input
      className={fieldClass}
      value={draft[key]}
      onChange={(e) => setField(key, e.target.value)}
    />
  );

  const dateInput = (key: keyof AttrDraft) => (
    <input
      type="date"
      className={fieldClass}
      value={draft[key]}
      onChange={(e) => setField(key, e.target.value)}
    />
  );

  const editEntries = useMemo(
    () =>
      withRiverEntry(
        withFullWidthIfLong(
          [
            { fieldKey: "name", label: "공사명", value: textInput("name") },
            { fieldKey: "location", label: "공사위치", value: textInput("location") },
            { fieldKey: "quantity", label: "공사량", value: textInput("quantity") },
            { fieldKey: "contractDate", label: "계약일", value: dateInput("contractDate") },
            { fieldKey: "startDate", label: "착수일자", value: dateInput("startDate") },
            { fieldKey: "endDate", label: "준공일자", value: dateInput("endDate") },
            { fieldKey: "actualEndDate", label: "실준공일자", value: dateInput("actualEndDate") },
            { fieldKey: "companyName", label: "업체명", value: textInput("companyName") },
            { fieldKey: "representative", label: "대표자명", value: textInput("representative") },
            { fieldKey: "phone", label: "전화번호", value: textInput("phone") },
            { fieldKey: "supervisor", label: "감독관", value: textInput("supervisor") },
            { fieldKey: "supervisorName", label: "감독관명", value: textInput("supervisorName") },
            { fieldKey: "budgetBefore", label: "사업비_전", value: textInput("budgetBefore") },
            { fieldKey: "budgetIncrease", label: "사업비_증가", value: textInput("budgetIncrease") },
            { fieldKey: "budgetDecrease", label: "사업비_감소", value: textInput("budgetDecrease") },
            { fieldKey: "budgetAfter", label: "사업비_후", value: textInput("budgetAfter") },
            { fieldKey: "companyAddress", label: "업체주소", value: textInput("companyAddress") },
            {
              fieldKey: "changeReason",
              label: "변경사유",
              value: (
                <textarea
                  className={textareaClass}
                  value={draft.changeReason}
                  onChange={(e) => setField("changeReason", e.target.value)}
                />
              ),
            },
            {
              fieldKey: "remark",
              label: "비고",
              value: (
                <textarea
                  className={textareaClass}
                  value={draft.remark}
                  onChange={(e) => setField("remark", e.target.value)}
                />
              ),
            },
          ],
          draft
        )
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft + river cell
    [draft, riverNames, riverFocus, availableRivers.length]
  );

  const geomHintText = loadingParcels
    ? "필지목록 조회 중…"
    : geomEditMode === "draw"
      ? "지도에서 도형을 그려 주세요."
      : row.geom
        ? "도형을 수정하면 필지목록이 자동으로 갱신됩니다."
        : "도형추가 버튼으로 공사구간을 그리세요.";

  const geomBannerHost =
    mapContext?.mapInstanceRef?.current?.getTargetElement()?.parentElement ?? null;

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
                onClick={restartGeomDraw}
              >
                도형추가
              </button>
              {geomModifySnapshotRef.current ? (
                <button
                  type="button"
                  className={layerRowPanelButtonClass(
                    "default",
                    "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
                  )}
                  onClick={resetGeomToSnapshot}
                >
                  초기화
                </button>
              ) : null}
              <button
                type="button"
                className={layerRowPanelButtonClass("danger", "pointer-events-auto shrink-0")}
                onClick={clearGeomDraft}
              >
                도형삭제
              </button>
            </div>
          </div>,
          geomBannerHost
        )
      : null;

  const titleText = row.name.trim() || "공사대장 상세";

  return (
    <div className="flex min-h-0 h-full flex-col bg-white">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3">
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold leading-none text-slate-800"
          title={titleText}
        >
          {titleText}
        </span>
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

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs scrollbar-hide">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            상세 속성
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <button type="button" className={btnPrimary} onClick={handleSave}>
                  저장
                </button>
                <button type="button" className={btnGhost} onClick={handleCancel}>
                  취소
                </button>
              </>
            ) : (
              <>
                <button type="button" className={btnGhost} onClick={beginEdit}>
                  <Pencil className="h-3 w-3 shrink-0" />
                  수정
                </button>
                <button type="button" className={btnDanger} onClick={handleDelete}>
                  <Trash2 className="h-3 w-3 shrink-0" />
                  삭제
                </button>
              </>
            )}
          </div>
        </div>
        <AttrTable entries={editing ? editEntries : viewEntries} />

        <LayerParcelTextSection
          isEditing={editing}
          draftParcels={draftParcels}
          onAddParcel={handleAddParcel}
          onRemoveParcel={handleRemoveParcel}
          parcels={parcels}
          movingParcelIdx={movingParcelIdx}
          onParcelClick={(item, idx) => void navigateToParcel(item, idx)}
        />

        <div className="mt-4 mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Paperclip className="h-3.5 w-3.5" />
            첨부파일
          </div>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => attachInputRef.current?.click()}
          >
            <Plus className="h-3 w-3" />
            첨부
          </button>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
        </div>

        <div className="mb-2 flex rounded border border-slate-200 bg-slate-50 p-0.5">
          {RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES.map((c) => {
            const count = attachments.filter((a) => a.category === c.value).length;
            return (
              <button
                key={c.value}
                type="button"
                className={cn(
                  "flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors",
                  attachmentTab === c.value
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
                onClick={() => setAttachmentTab(c.value)}
              >
                {c.label} ({count})
              </button>
            );
          })}
        </div>

        <AttachmentThumbGrid
          items={attachments.filter((a) => a.category === attachmentTab)}
          onPreview={openPreview}
          onDownload={downloadAttachment}
          onDelete={(att) => handleDeleteAttachment(att.id)}
          emptyLabel={`등록된 ${
            RIVER_CONSTRUCTION_ATTACHMENT_CATEGORIES.find((c) => c.value === attachmentTab)
              ?.label ?? ""
          } 첨부파일이 없습니다.`}
        />
      </div>

      {preview ? (
        <ServiceFileImagePreview
          items={preview.items}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {mapEditBanner}
    </div>
  );
}
