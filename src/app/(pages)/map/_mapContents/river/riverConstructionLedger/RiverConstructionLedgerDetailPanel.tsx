"use client";

import {
  Fragment,
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
  Image as ImageIcon,
  Paperclip,
  Plus,
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
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import { appFetch } from "@/lib/basePath";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import { streamDownloadFile } from "@/lib/streamFileDownload";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import {
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
  withServiceFileThumbQuery,
} from "../../../_mapComponents/standard/useServiceFileData";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction";
import {
  LayerRowEditToolbar,
  LayerRowPanelButton,
  useLayerParcelNavigation,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import { DrawToolbarActions } from "../../../_mapComponents/analysisArea";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../../searchBarOffsetContext";
import {
  CONS_ATTACH_ROOT_FOLDER,
  CONS_DATA_AS_FILE_LAYER,
  isNewRiverConstructionLedgerRow,
  ledgerRowToConsDataAsValues,
  mapConsDataAsApiToLedgerRow,
  mapServiceFileToAttachment,
  normalizeRiverNames,
  withRiverNameFallback,
  type ConsDataAsApiRow,
  type RiverConstructionLedgerAttachment,
  type RiverConstructionLedgerRow,
} from "./riverConstructionLedgerMock";
import { RiverNameSelect } from "./RiverNameSelect";
import { refreshConsDataAsMapView } from "./riverConstructionLedgerMapSync";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { OccupationLedgerPlaceInput } from "../../occupationLedger/OccupationLedgerPlaceInput";

const PARCEL_IDX_KEY = "riverConstructionLedgerParcelIdx";

type Props = {
  row: RiverConstructionLedgerRow;
  onClose: () => void;
};

const fieldClass =
  "box-border h-[22px] w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] leading-none outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const btnSecondary =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground/90 hover:bg-muted/50 disabled:opacity-50";

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

/** 사업비 입력 — 숫자·천단위 콤마만 남김 */
function sanitizeBudgetInput(raw: string): string {
  return String(raw ?? "").replace(/[^\d,]/g, "");
}

/** 사업비 숫자 파싱 — 빈 값은 0, 콤마·공백 제거 */
function parseBudgetNumber(raw: string): number | null {
  const s = String(raw ?? "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 사업비_후 = 전 + 증가 − 감소 */
function computeBudgetAfter(
  before: string,
  increase: string,
  decrease: string
): string {
  if (!before.trim() && !increase.trim() && !decrease.trim()) return "";
  const b = parseBudgetNumber(before);
  const i = parseBudgetNumber(increase);
  const d = parseBudgetNumber(decrease);
  if (b == null || i == null || d == null) return "";
  const n = b + i - d;
  if (Number.isInteger(n)) return String(n);
  // 부동소수 노이즈 완화
  return String(Math.round(n * 1000) / 1000);
}

function toDraft(row: RiverConstructionLedgerRow): AttrDraft {
  const budgetBefore = sanitizeBudgetInput(row.budgetBefore);
  const budgetIncrease = sanitizeBudgetInput(row.budgetIncrease);
  const budgetDecrease = sanitizeBudgetInput(row.budgetDecrease);
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
    budgetBefore,
    budgetIncrease,
    budgetDecrease,
    budgetAfter: computeBudgetAfter(budgetBefore, budgetIncrease, budgetDecrease) || sanitizeBudgetInput(row.budgetAfter),
    changeReason: row.changeReason,
    remark: row.remark,
  };
}

/**
 * 필지(개별 구간) 도형(GeoJSON, EPSG:3857) → 저장용 WKT(5181).
 * 지도에서 직접 그린 좌표라 3857 → 5181 변환만 하면 된다(4326 경유 불필요).
 */
function parcelGeomToWkt5181(
  geometry3857: Record<string, unknown> | null | undefined
): string | null {
  if (!geometry3857) return null;
  try {
    const olGeom = new GeoJSONFormat().readGeometry(geometry3857, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    });
    if (!olGeom) return null;
    olGeom.transform("EPSG:3857", "EPSG:5181");
    const wkt = new WKT().writeGeometry(olGeom);
    return wkt?.trim() ? wkt : null;
  } catch (e) {
    console.error("[riverConstructionLedger] parcelGeomToWkt5181 failed", e);
    return null;
  }
}

type AttrEntry = {
  fieldKey: string;
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
};

/** 반칸에서 말줄임이 날 길이 — 목록 전체 최장값 기준(행마다 레이아웃이 바뀌지 않게) */
const ATTR_FULL_WIDTH_MIN_LEN = 12;

/** 레이아웃 판정에 쓰는 속성 키 (표시 순서와 무관, fullWidth 맵용) */
const ATTR_LAYOUT_TEXT_KEYS = [
  "name",
  "location",
  "riverNames",
  "quantity",
  "contractDate",
  "startDate",
  "endDate",
  "actualEndDate",
  "companyName",
  "representative",
  "phone",
  "supervisor",
  "supervisorName",
  "budgetBefore",
  "budgetIncrease",
  "budgetDecrease",
  "budgetAfter",
  "companyAddress",
  "changeReason",
  "remark",
] as const;

type AttrLayoutTextKey = (typeof ATTR_LAYOUT_TEXT_KEYS)[number];

/** 항상 한 줄 — textarea·장문·주소(업체명 바로 아래 단독 행) */
const ATTR_ALWAYS_FULL_WIDTH = new Set<AttrLayoutTextKey>([
  "changeReason",
  "remark",
  "companyAddress",
]);

/** 항상 반줄 — 짧은 식별·연락 정보 (목록 최장값이어도 반칸 유지) */
const ATTR_ALWAYS_HALF_WIDTH = new Set<AttrLayoutTextKey>([
  "companyName",
  "representative",
  "phone",
  "supervisor",
  "supervisorName",
]);

function attrTextCharLen(raw: unknown): number {
  const t = String(raw ?? "").trim();
  if (!t || t === "—") return 0;
  return [...t].length;
}

function attrFieldTextFromRow(
  row: RiverConstructionLedgerRow,
  key: AttrLayoutTextKey
): string {
  if (key === "riverNames") {
    return (row.riverNames ?? []).map((n) => String(n).trim()).filter(Boolean).join(", ");
  }
  return String(row[key] ?? "");
}

/**
 * 목록 데이터에서 필드별 최장 문자열 길이를 보고 fullWidth 고정 맵을 만든다.
 * → 상세를 바꿔도 속성 칸 위치(한 줄/반 줄)가 흔들리지 않음.
 */
function buildAttrFullWidthMap(
  rows: RiverConstructionLedgerRow[]
): Record<string, boolean> {
  const maxLen: Record<string, number> = {};
  for (const key of ATTR_LAYOUT_TEXT_KEYS) maxLen[key] = 0;

  for (const row of rows) {
    for (const key of ATTR_LAYOUT_TEXT_KEYS) {
      const n = attrTextCharLen(attrFieldTextFromRow(row, key));
      if (n > (maxLen[key] ?? 0)) maxLen[key] = n;
    }
  }

  const out: Record<string, boolean> = {};
  for (const key of ATTR_LAYOUT_TEXT_KEYS) {
    if (ATTR_ALWAYS_HALF_WIDTH.has(key)) {
      out[key] = false;
      continue;
    }
    out[key] =
      ATTR_ALWAYS_FULL_WIDTH.has(key) || (maxLen[key] ?? 0) >= ATTR_FULL_WIDTH_MIN_LEN;
  }
  return out;
}

function applyAttrFullWidthMap(
  entries: AttrEntry[],
  fullWidthByKey: Record<string, boolean>
): AttrEntry[] {
  return entries.map((e) => {
    if (e.fullWidth) return e;
    if (fullWidthByKey[e.fieldKey]) return { ...e, fullWidth: true };
    return e;
  });
}

function AttrValue({ value }: { value: ReactNode }) {
  if (typeof value === "string") {
    return (
      <span
        className="block truncate text-[11px] leading-snug text-foreground/90"
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
        // 조회·수정 공통 행 높이 — 조회 기준(h-7), 수정 입력은 이 안에 맞춤
        "flex h-7 items-center bg-muted px-2",
        borderBottom && "border-b border-border",
        borderRight && "border-r border-border",
        roundedCorner === "tl" && "rounded-tl-[5px]",
        roundedCorner === "bl" && "rounded-bl-[5px]"
      )}
    >
      <span className="whitespace-nowrap text-[11px] font-medium leading-snug text-muted-foreground">
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
        "flex h-7 min-w-0 items-center px-2",
        borderBottom && "border-b border-border",
        borderRight && "border-r border-border"
      )}
      style={gridColumn ? { gridColumn } : undefined}
    >
      <div className="min-w-0 w-full">
        <AttrValue value={value} />
      </div>
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
      className="grid overflow-visible rounded-[5px] border border-border"
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

const ATTACH_GRID_GAP_PX = 8;
/** 파일명 한 줄 + margin */
const ATTACH_GRID_LABEL_PX = 14;
/** 위·아래 여분 행 — 스크롤 시 빈칸 깜빡임 완화 */
const ATTACH_GRID_OVERSCAN_ROWS = 2;

/** 첨부 썸네일 — 이미지는 서버 저화질 JPEG, PDF/기타는 아이콘. 원본 미리보기는 클릭 시 */
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
  const isImage = att.previewKind === "image";
  const isPdf = att.previewKind === "pdf";
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc =
    isImage && att.previewUrl && !thumbFailed
      ? withServiceFileThumbQuery(att.previewUrl, 160)
      : null;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPreview}
        className="block aspect-square w-full overflow-hidden rounded border border-border bg-muted/50"
        title={`${att.name} 미리보기`}
      >
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키 포함 동일출처 썸네일
          <img
            src={thumbSrc}
            alt=""
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            {isImage ? (
              <ImageIcon className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
            <span className="text-[10px] font-semibold">
              {isImage ? "이미지" : isPdf ? "PDF" : "파일"}
            </span>
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
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground/90 shadow-md ring-1 ring-border/80 hover:bg-muted/50 hover:text-primary"
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
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-destructive shadow-md ring-1 ring-border/80 hover:bg-destructive/10"
          title="삭제"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={att.name}>
        {att.name}
      </p>
    </div>
  );
}

type AttachGridWindow = {
  cols: number;
  rowH: number;
  totalH: number;
  offsetY: number;
  start: number;
  end: number;
};

/** 수백 건이어도 보이는 칸(+여분)만 마운트 — 썸네일 요청·DOM을 스크롤에 맞춤 */
function AttachmentThumbGrid({
  items,
  scrollRootRef,
  onPreview,
  onDownload,
  onDelete,
  emptyLabel,
}: {
  items: RiverConstructionLedgerAttachment[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onPreview: (att: RiverConstructionLedgerAttachment) => void;
  onDownload: (att: RiverConstructionLedgerAttachment) => void;
  onDelete: (att: RiverConstructionLedgerAttachment) => void;
  emptyLabel: string;
}) {
  const [win, setWin] = useState<AttachGridWindow>({
    cols: 3,
    rowH: 96,
    totalH: 0,
    offsetY: 0,
    start: 0,
    end: 0,
  });

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || items.length === 0) {
      setWin((prev) => ({ ...prev, totalH: 0, start: 0, end: 0, offsetY: 0 }));
      return;
    }

    const measure = () => {
      const el = scrollRootRef.current;
      if (!el) return;
      const w = el.clientWidth;
      if (w <= 0) return;
      const cols = window.matchMedia("(min-width: 640px)").matches ? 4 : 3;
      const cellW = (w - ATTACH_GRID_GAP_PX * (cols - 1)) / cols;
      const rowH = cellW + ATTACH_GRID_LABEL_PX;
      const stride = rowH + ATTACH_GRID_GAP_PX;
      const rows = Math.ceil(items.length / cols);
      const totalH = rows > 0 ? rows * rowH + Math.max(0, rows - 1) * ATTACH_GRID_GAP_PX : 0;
      const firstRow = Math.max(
        0,
        Math.floor(el.scrollTop / stride) - ATTACH_GRID_OVERSCAN_ROWS
      );
      const lastRow = Math.min(
        rows - 1,
        Math.ceil((el.scrollTop + el.clientHeight) / stride) + ATTACH_GRID_OVERSCAN_ROWS
      );
      setWin({
        cols,
        rowH,
        totalH,
        offsetY: firstRow * stride,
        start: firstRow * cols,
        end: Math.min(items.length, (lastRow + 1) * cols),
      });
    };

    measure();
    root.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const mq = window.matchMedia("(min-width: 640px)");
    mq.addEventListener("change", measure);
    return () => {
      root.removeEventListener("scroll", measure);
      ro.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [items.length, scrollRootRef]);

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-[6rem] items-center justify-center">
        <p className="text-center text-[11px] text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const visible = items.slice(win.start, win.end);

  return (
    <div className="relative w-full" style={{ height: win.totalH }}>
      <div
        className="absolute left-0 right-0 grid gap-2"
        style={{
          top: win.offsetY,
          gridTemplateColumns: `repeat(${win.cols}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((att) => (
          <AttachmentThumb
            key={att.id}
            att={att}
            onPreview={() => onPreview(att)}
            onDownload={() => onDownload(att)}
            onDelete={() => onDelete(att)}
          />
        ))}
      </div>
    </div>
  );
}

const RIVER_TABLE_PREVIEW_MAX = 2;

export function RiverConstructionLedgerDetailPanel({ row, onClose }: Props) {
  const mapContext = useMapContext();
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachScrollRef = useRef<HTMLDivElement>(null);
  const isNewRow = isNewRiverConstructionLedgerRow(row);

  // 데이터 이력관리에 조회 저장을 위해 추가
  useEffect(() => {
    if (isNewRow) return;
    const consCode = String(row.id ?? "").trim();
    if (!consCode) return;
    recordDataViewLog({
      tableName: "cons_data_as",
      keyField: "cons_code",
      keyValue: consCode,
      serviceName: "공사대장",
    });
  }, [row.id, isNewRow]);

  const [editing, setEditing] = useState(isNewRow || !row.name.trim());
  const [draft, setDraft] = useState<AttrDraft>(() => toDraft(row));
  /** 대상 하천 — 단일 값 입력 (기존에 여러 개가 저장돼 있으면 첫 번째만 표시) */
  const [riverNamesText, setRiverNamesText] = useState(
    () => normalizeRiverNames(row.riverNames)[0] ?? ""
  );
  /** 신규 필지 도형 그리기 대상 인덱스 — null이면 기존 도형 전체 자유 수정 */
  const [parcelDrawIdx, setParcelDrawIdx] = useState<number | null>(null);
  const parcelsSnapshotRef = useRef<LayerRowParcelItem[]>([]);
  const parcelEditLayerRef = useRef<{
    layer: VectorLayer<VectorSource>;
    source: VectorSource;
  } | null>(null);
  const [attachmentFolders, setAttachmentFolders] = useState<string[]>([]);
  const [attachmentTab, setAttachmentTab] = useState<string>(CONS_ATTACH_ROOT_FOLDER);
  const [attachRefreshNonce, setAttachRefreshNonce] = useState(0);
  const [foldersRefreshNonce, setFoldersRefreshNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  /** 편집 중 필지목록 — 도로점용처럼 로컬 state로 즉시 반영 (context round-trip 대기하지 않음) */
  const [draftParcels, setDraftParcels] = useState<LayerRowParcelItem[]>(() => row.parcels ?? []);
  const draftParcelsRef = useRef(draftParcels);
  draftParcelsRef.current = draftParcels;
  const { selectParcel, movingParcelIdx } = useLayerParcelNavigation();
  const [detailLoading, setDetailLoading] = useState(false);
  const detailLoadGenRef = useRef(0);
  const parcelDrawIdxRef = useRef(parcelDrawIdx);
  parcelDrawIdxRef.current = parcelDrawIdx;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  /** 목록 클릭은 extent만 — 상세·필지 도형은 패널에서 보강 */
  useEffect(() => {
    if (isNewRiverConstructionLedgerRow(row)) return;
    const consCode = row.id;
    const gen = ++detailLoadGenRef.current;
    setDetailLoading(true);
    let cancelled = false;
    void call("", "POST", {
      service: "consDataAsService",
      action: "getDetailByConsCode",
      params: { consCode, includeParcelGeometry: true },
    })
      .then((res) => {
        if (cancelled || detailLoadGenRef.current !== gen) return;
        const data = res?.data ?? res;
        if (data?.error || !data?.row) return;
        const mapped = mapConsDataAsApiToLedgerRow(data.row as ConsDataAsApiRow);
        mapContext?.setRiverConstructionLedgerRows?.((prev) =>
          prev.map((r) =>
            r.id === consCode
              ? {
                  ...mapped,
                  geom: mapped.geom ?? r.geom,
                  attachments: r.attachments,
                }
              : r
          )
        );
        // 사용자가 이미 편집 중이면 폼 덮어쓰지 않음
        if (!editingRef.current) {
          setDraft(toDraft(mapped));
          setRiverNamesText(normalizeRiverNames(mapped.riverNames)[0] ?? "");
        }
        if (parcelDrawIdxRef.current == null) {
          const filled = withRiverNameFallback(mapped.parcels ?? []);
          parcelsSnapshotRef.current = [...filled];
          setDraftParcels(filled);
        }
      })
      .catch(() => {
        /* 목록 행으로 계속 표시 */
      })
      .finally(() => {
        if (!cancelled && detailLoadGenRef.current === gen) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id 전환 시만
  }, [row.id]);

  const fileSerEng = SER_FILE_ENG.riverConstructionLedger;
  const fileKey = isNewRow ? "" : row.id;
  const { upload: uploadChunked } = useServiceFileChunkedUpload();
  /** 상세 보강이 끝난 뒤 첨부 목록 조회 — 클릭 직후 원본 이미지 다운로드와 경합 방지 */
  const attachmentsReady = Boolean(fileKey) && !detailLoading;
  const { files: folderFiles, loading: filesLoading } = useServiceFileData({
    serEng: fileSerEng,
    enabled: attachmentsReady && Boolean(attachmentTab),
    layerSegment: CONS_DATA_AS_FILE_LAYER,
    keyValue: fileKey || null,
    subfolder: attachmentTab,
    refreshNonce: attachRefreshNonce,
    /** 그리드는 파일명만 필요 — 천 건 stat 생략 */
    includeMeta: false,
  });

  const attachments = useMemo(() => {
    return folderFiles.map((f) => {
      const base = mapServiceFileToAttachment(f, attachmentTab);
      const url = serviceFileDataDownloadUrl(fileSerEng, CONS_DATA_AS_FILE_LAYER, fileKey, f.name, {
        subfolder: attachmentTab,
      });
      return {
        ...base,
        previewUrl: base.previewKind === "image" || base.previewKind === "pdf" ? url : undefined,
      };
    });
  }, [attachmentTab, fileKey, fileSerEng, folderFiles]);

  useEffect(() => {
    if (!attachmentsReady || !fileKey) {
      if (!fileKey) setAttachmentFolders([]);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({
      serEng: fileSerEng,
      layer: CONS_DATA_AS_FILE_LAYER,
      key: fileKey,
      folders: "1",
    });
    void appFetch(`/api/service-files?${qs.toString()}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return { folders: [] as string[] };
        return r.json() as Promise<{ folders?: string[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const folders = Array.isArray(data.folders) ? data.folders : [];
        setAttachmentFolders(folders);
        setAttachmentTab((prev) => {
          if (folders.includes(prev)) return prev;
          return folders[0] ?? CONS_ATTACH_ROOT_FOLDER;
        });
      })
      .catch(() => {
        if (!cancelled) setAttachmentFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentsReady, fileKey, fileSerEng, foldersRefreshNonce]);

  const setRiverFocus = mapContext?.setRiverConstructionLedgerRiverFocus;
  const setGeomEditingId = mapContext?.setRiverConstructionLedgerGeomEditingId;

  const { inputBottomPx } = useSearchBarOffset();
  const geomHintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapInstance = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const geomBannerActive = Boolean(mapInstance) && editing && !isNewRow;
  const geomCenterPixel = useMapVisualCenterPixel(
    mapInstance,
    geomBannerActive,
    mapPaddingLeft
  );

  useEffect(() => {
    setDraft(toDraft(row));
    setRiverNamesText(normalizeRiverNames(row.riverNames)[0] ?? "");
    parcelsSnapshotRef.current = [...(row.parcels ?? [])];
    setDraftParcels(withRiverNameFallback(row.parcels ?? []));
    setParcelDrawIdx(null);
    setGeomEditingId?.(null);

    const isNew = isNewRiverConstructionLedgerRow(row) || !row.name.trim();
    setEditing(isNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id 전환 시에만
  }, [row.id, setGeomEditingId]);

  useEffect(() => {
    return () => {
      setParcelDrawIdx(null);
      setGeomEditingId?.(null);
    };
  }, [setGeomEditingId]);

  /** 속성·필지 수정 중엔 공사구간 전체 도형(오버레이)을 숨기고, 대신 필지별 도형 참고 레이어를 보여준다 */
  useEffect(() => {
    setGeomEditingId?.(editing && !isNewRow ? row.id : null);
  }, [editing, isNewRow, row.id, setGeomEditingId]);

  /** 편집 중엔 입력창의 값을, 아닐 땐 저장된 값을 기준으로 표시 (단일 값) */
  const riverNames = editing
    ? riverNamesText.trim()
      ? [riverNamesText.trim()]
      : []
    : normalizeRiverNames(row.riverNames);

  const patchRow = (updater: (prev: RiverConstructionLedgerRow) => RiverConstructionLedgerRow) => {
    mapContext?.setRiverConstructionLedgerRows?.((rows) =>
      rows.map((r) => (r.id === row.id ? updater(r) : r))
    );
  };

  const parcels = row.parcels ?? [];

  /** 필지 목록에 빈 행을 넣고, 바로 지도에서 도형을 그리기 시작 */
  const handleAddParcelRow = () => {
    const next: LayerRowParcelItem = {
      address: "",
      riverName: "",
      remark: "",
      extent3857: null,
    };
    const list = [...draftParcelsRef.current, next];
    draftParcelsRef.current = list;
    setDraftParcels(list);
    patchRow((r) => ({ ...r, parcels: list }));
    setParcelDrawIdx(list.length - 1);
  };

  /** 필지 목록 특정 행의 하천명·비고 값 갱신 */
  const handleUpdateParcelField = (
    index: number,
    field: "riverName" | "remark",
    value: string
  ) => {
    const list = draftParcelsRef.current.map((p, i) => {
      if (i !== index) return p;
      const riverName = field === "riverName" ? value : (p.riverName ?? "");
      const remark = field === "remark" ? value : (p.remark ?? "");
      const displayText = [riverName, remark]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" · ");
      return {
        ...p,
        riverName,
        remark,
        address: displayText || "",
        displayText: displayText || undefined,
      };
    });
    draftParcelsRef.current = list;
    setDraftParcels(list);
    patchRow((r) => ({ ...r, parcels: list }));
  };

  const handleRemoveParcel = (index: number) => {
    const next = draftParcelsRef.current.filter((_, i) => i !== index);
    draftParcelsRef.current = next;
    setDraftParcels(next);
    patchRow((r) => ({ ...r, parcels: next }));
    setParcelDrawIdx((prev) => {
      if (prev == null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  /** 필지 행에 지도에서 그린 도형 반영(비우려면 둘 다 null) */
  const handleSetParcelGeom = (
    index: number,
    geometry3857: Record<string, unknown> | null,
    extent3857: [number, number, number, number] | null
  ) => {
    const list = draftParcelsRef.current.map((p, i) =>
      i === index ? { ...p, geometry3857, extent3857 } : p
    );
    draftParcelsRef.current = list;
    setDraftParcels(list);
    patchRow((r) => ({ ...r, parcels: list }));
  };

  const finishParcelDraw = () => {
    setParcelDrawIdx(null);
  };

  const cancelParcelDraw = () => {
    const idx = parcelDrawIdx;
    if (idx == null) return;
    const item = draftParcelsRef.current[idx];
    if (!item?.geometry3857) {
      handleRemoveParcel(idx);
      return;
    }
    finishParcelDraw();
  };

  const parcelEditStyle = new Style({
    fill: new Fill({ color: "rgba(22, 163, 74, 0.25)" }),
    stroke: new Stroke({ color: "#15803d", width: 2.5 }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: "#15803d" }),
      stroke: new Stroke({ color: "#fff", width: 1.5 }),
    }),
  });

  /** 수정 모드 — 모든 필지 도형을 동시에 정점 수정 */
  useEffect(() => {
    if (!editing || parcelDrawIdx != null) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return;

    mapContext?.clearMapDrawInteractionsRef?.current?.();
    setRiverFocus?.(null);

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const format = new GeoJSONFormat();
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: parcelEditStyle,
    });

    for (const [i, parcel] of draftParcelsRef.current.entries()) {
      if (!parcel.geometry3857) continue;
      try {
        const feats = format.readFeatures(parcel.geometry3857, {
          dataProjection: viewProj,
          featureProjection: viewProj,
        });
        for (const f of feats) f.set(PARCEL_IDX_KEY, i);
        source.addFeatures(feats);
      } catch {
        // ignore invalid geometry
      }
    }

    const syncFromSource = () => {
      const byIdx = new Map<number, { geometry3857: Record<string, unknown>; extent3857: [number, number, number, number] | null }>();
      for (const feature of source.getFeatures()) {
        const idx = feature.get(PARCEL_IDX_KEY);
        if (typeof idx !== "number" || idx < 0) continue;
        const geom = feature.getGeometry();
        if (!geom) continue;
        const geometry3857 = format.writeGeometryObject(geom, {
          dataProjection: viewProj,
          featureProjection: viewProj,
        }) as unknown as Record<string, unknown>;
        const ext = geom.getExtent();
        byIdx.set(idx, {
          geometry3857,
          extent3857: ext.every((v) => Number.isFinite(v))
            ? (ext as [number, number, number, number])
            : null,
        });
      }
      if (byIdx.size === 0) return;
      const list = draftParcelsRef.current.map((p, i) => {
        const next = byIdx.get(i);
        return next ? { ...p, ...next } : p;
      });
      draftParcelsRef.current = list;
      setDraftParcels(list);
      patchRow((r) => ({ ...r, parcels: list }));
    };

    const modify = new Modify({ source });
    modify.on("modifyend", syncFromSource);
    map.addLayer(layer);
    map.addInteraction(modify);
    parcelEditLayerRef.current = { layer, source };

    return () => {
      modify.un("modifyend", syncFromSource);
      map.removeInteraction(modify);
      map.removeLayer(layer);
      source.clear();
      parcelEditLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 편집·필지 개수 변경 시에만 레이어 재구성
  }, [editing, parcelDrawIdx, draftParcels.length, mapContext?.mapInstanceRef]);

  /** 신규 필지 도형 그리기 */
  useEffect(() => {
    if (!editing || parcelDrawIdx == null) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) {
      finishParcelDraw();
      return;
    }
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) {
      finishParcelDraw();
      return;
    }
    mapContext?.clearMapDrawInteractionsRef?.current?.();
    setRiverFocus?.(null);

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const format = new GeoJSONFormat();
    const drawIdx = parcelDrawIdx;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: parcelEditStyle,
    });
    const draw = new Draw({ source, type: "Polygon", stopClick: true });
    map.addLayer(layer);
    map.addInteraction(draw);

    const onEnd = (evt: { feature: Feature }) => {
      const geom = evt.feature.getGeometry();
      const coords = geom?.getType() === "Polygon" ? (geom as Polygon).getCoordinates()[0] : null;
      if (!geom || !coords || coords.length < 4) {
        window.alert("다각형은 세 점 이상이어야 합니다.");
        return;
      }
      const geojson = format.writeGeometryObject(geom, {
        dataProjection: viewProj,
        featureProjection: viewProj,
      }) as unknown as Record<string, unknown>;
      const extent = geom.getExtent();
      handleSetParcelGeom(
        drawIdx,
        geojson,
        extent.every((v) => Number.isFinite(v))
          ? (extent as [number, number, number, number])
          : null
      );
      finishParcelDraw();
    };
    draw.on("drawend", onEnd as never);

    return () => {
      draw.un("drawend", onEnd as never);
      map.removeInteraction(draw);
      map.removeLayer(layer);
      source.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw session keyed by index
  }, [editing, parcelDrawIdx]);

  const beginEdit = () => {
    setDraft(toDraft(row));
    setRiverNamesText(normalizeRiverNames(row.riverNames)[0] ?? "");
    const filled = withRiverNameFallback(row.parcels ?? []);
    parcelsSnapshotRef.current = [...filled];
    draftParcelsRef.current = filled;
    setDraftParcels(filled);
    setParcelDrawIdx(null);
    setEditing(true);
  };

  const parcelsToSavePayload = (list: LayerRowParcelItem[]) =>
    list
      .map((p) => ({
        riverName: (p.riverName ?? "").trim(),
        remark: (p.remark ?? "").trim(),
        geomWkt5181: parcelGeomToWkt5181(p.geometry3857),
      }))
      .filter((p) => p.riverName || p.remark || p.geomWkt5181);

  const applyMappedRow = (mapped: RiverConstructionLedgerRow) => {
    mapContext?.setRiverConstructionLedgerRows?.((rows) => {
      const withoutDraft = rows.filter((r) => r.id !== row.id);
      const others = withoutDraft.filter((r) => r.id !== mapped.id);
      return [mapped, ...others];
    });
    mapContext?.setRiverConstructionLedgerSelectedId?.(mapped.id);
    mapContext?.setRiverConstructionLedgerOverlayRows?.((prev) =>
      prev.map((r) => (r.id === row.id || r.id === mapped.id ? { ...mapped } : r))
    );
  };

  const handleParcelClick = (item: LayerRowParcelItem, idx: number) => {
    void selectParcel(item, idx);
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      window.alert("공사명을 입력하세요.");
      return;
    }
    const values = ledgerRowToConsDataAsValues({
      ...draft,
      riverNames,
    });
    setSaving(true);
    try {
      const res = await call("", "POST", {
        service: "consDataAsService",
        action: "saveRow",
        params: {
          consCode: isNewRow ? undefined : row.id,
          isNew: isNewRow,
          values,
          parcels: isNewRow ? undefined : parcelsToSavePayload(draftParcelsRef.current),
        },
      });
      const data = res?.data ?? res;
      if (!data?.success) {
        window.alert(String(data?.error ?? "저장에 실패했습니다."));
        return;
      }
      const consCode = String(data.consCode ?? row.id).trim();
      const detailRes = await call("", "POST", {
        service: "consDataAsService",
        action: "getDetailByConsCode",
        params: { consCode },
      });
      const detailData = detailRes?.data ?? detailRes;
      const mapped = detailData?.row
        ? mapConsDataAsApiToLedgerRow(detailData.row as ConsDataAsApiRow)
        : {
            ...row,
            id: consCode,
            ...draft,
            name: draft.name.trim(),
            riverNames,
            parcels: draftParcelsRef.current,
          };

      applyMappedRow(mapped);
      const savedParcels = withRiverNameFallback(mapped.parcels ?? []);
      draftParcelsRef.current = savedParcels;
      setDraftParcels(savedParcels);
      parcelsSnapshotRef.current = [...savedParcels];
      finishParcelDraw();
      setEditing(false);
      setFoldersRefreshNonce((n) => n + 1);
      if (consCode) {
        await refreshConsDataAsMapView({
          map: mapContext?.mapInstanceRef?.current,
          consCode,
          setVisibleLayerNames: mapContext?.setVisibleLayerNames,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current ?? null,
        });
      }
      if (data.error) window.alert(String(data.error));
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(toDraft(row));
    setRiverNamesText(normalizeRiverNames(row.riverNames)[0] ?? "");
    if (isNewRow) {
      mapContext?.setRiverConstructionLedgerRows?.((rows) =>
        rows.filter((r) => !isNewRiverConstructionLedgerRow(r))
      );
      mapContext?.setRiverConstructionLedgerSelectedId?.(null);
      finishParcelDraw();
      return;
    }
    const snapParcels = [...parcelsSnapshotRef.current];
    draftParcelsRef.current = snapParcels;
    setDraftParcels(snapParcels);
    patchRow((prev) => ({ ...prev, parcels: snapParcels }));
    finishParcelDraw();
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`「${row.name || "신규 공사"}」을(를) 삭제할까요?`)) return;
    const clearDeletedFromMap = () => {
      finishParcelDraw();
      mapContext?.setRiverConstructionLedgerRows?.((rows) => rows.filter((r) => r.id !== row.id));
      mapContext?.setRiverConstructionLedgerOverlayRows?.((rows) =>
        rows.filter((r) => r.id !== row.id)
      );
      mapContext?.setRiverConstructionLedgerSelectedId?.(null);
      setRiverFocus?.(null);
    };
    if (isNewRow) {
      clearDeletedFromMap();
      return;
    }
    setDeleting(true);
    try {
      const res = await call("", "POST", {
        service: "consDataAsService",
        action: "deleteRow",
        params: { consCode: row.id },
      });
      const data = res?.data ?? res;
      if (!data?.success) {
        window.alert(String(data?.error ?? "삭제에 실패했습니다."));
        return;
      }
      clearDeletedFromMap();
      const map = mapContext?.mapInstanceRef?.current;
      refreshServiceWmsLayer(map);
      requestAnimationFrame(() => refreshServiceWmsLayer(map));
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!fileKey) {
      window.alert("저장한 뒤 첨부파일을 등록할 수 있습니다.");
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    const folder = attachmentTab || CONS_ATTACH_ROOT_FOLDER;
    for (const file of Array.from(files)) {
      const result = await uploadChunked({
        file,
        serEng: fileSerEng,
        layerSegment: CONS_DATA_AS_FILE_LAYER,
        keyValue: fileKey,
        subfolder: folder,
      });
      if (result?.error) {
        window.alert(result.error);
        break;
      }
    }
    if (attachInputRef.current) attachInputRef.current.value = "";
    setAttachRefreshNonce((n) => n + 1);
    setFoldersRefreshNonce((n) => n + 1);
  };

  const handleDeleteAttachment = async (att: RiverConstructionLedgerAttachment) => {
    if (!window.confirm(`«${att.name}»을(를) 삭제할까요?`)) return;
    if (!fileKey) return;
    const result = await requestServiceFileDataDelete({
      serEng: fileSerEng,
      layerSegment: CONS_DATA_AS_FILE_LAYER,
      keyValue: fileKey,
      fileName: att.name,
      subfolder: att.category,
    });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setAttachRefreshNonce((n) => n + 1);
    setFoldersRefreshNonce((n) => n + 1);
  };

  const downloadAttachment = (att: RiverConstructionLedgerAttachment) => {
    if (!fileKey) return;
    const url = serviceFileDataDownloadUrl(
      fileSerEng,
      CONS_DATA_AS_FILE_LAYER,
      fileKey,
      att.name,
      { subfolder: att.category }
    );
    triggerServiceFileDownload(url, att.name);
  };

  const handleDownloadAllAttachments = async () => {
    if (!fileKey) return;
    if (attachments.length === 0 && attachmentFolders.length === 0) {
      window.alert("다운로드할 첨부파일이 없습니다.");
      return;
    }
    const label =
      String(row.name ?? "").trim() ||
      String(row.location ?? "").trim() ||
      "공사대장";
    const url = serviceFileDataZipDownloadUrl(
      fileSerEng,
      CONS_DATA_AS_FILE_LAYER,
      fileKey,
      { layerDisplayName: label }
    );
    try {
      await streamDownloadFile(url, `${label} 첨부파일.zip`);
    } catch (e: unknown) {
      window.alert(
        e instanceof Error ? e.message : "다운로드할 첨부파일이 없습니다."
      );
    }
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

  const riverPreview = riverNames.slice(0, RIVER_TABLE_PREVIEW_MAX);
  const riverMoreCount = Math.max(0, riverNames.length - RIVER_TABLE_PREVIEW_MAX);

  const riverNamesCell = editing ? (
    <RiverNameSelect
      className={fieldClass}
      value={riverNamesText}
      onChange={setRiverNamesText}
      placeholder="하천명 검색/선택"
    />
  ) : riverNames.length === 0 ? (
    <span className="text-[11px] leading-snug text-muted-foreground">—</span>
  ) : (
    <p className="truncate text-[11px] leading-snug text-muted-foreground" title={riverNames.join(", ")}>
      {riverPreview.join(", ")}
      {riverMoreCount > 0 ? <span className="text-muted-foreground"> 외 {riverMoreCount}</span> : null}
    </p>
  );

  const withRiverEntry = (entries: AttrEntry[]): AttrEntry[] => {
    const riverEntry: AttrEntry = {
      fieldKey: "riverNames",
      label: "대상 하천",
      value: riverNamesCell,
    };
    // 공사명·공사위치 다음에 배치 (한 줄/반 줄은 fullWidth 맵이 결정)
    return [entries[0]!, entries[1]!, riverEntry, ...entries.slice(2)];
  };

  /** 목록 전체 최장값 기준 — 행 전환해도 속성 칸 배치 고정 */
  const attrFullWidthByKey = useMemo(() => {
    const list = mapContext?.riverConstructionLedgerRows ?? [];
    const hasCurrent = list.some((r) => r.id === row.id);
    return buildAttrFullWidthMap(hasCurrent ? list : [row, ...list]);
  }, [mapContext?.riverConstructionLedgerRows, row]);

  const viewEntries = useMemo(
    () =>
      applyAttrFullWidthMap(
        withRiverEntry([
          { fieldKey: "name", label: "공사명", value: row.name || "—" },
          { fieldKey: "location", label: "공사위치", value: row.location || "—" },
          { fieldKey: "quantity", label: "공사량", value: row.quantity || "—" },
          { fieldKey: "contractDate", label: "계약일", value: row.contractDate || "—" },
          { fieldKey: "startDate", label: "착수일자", value: row.startDate || "—" },
          { fieldKey: "endDate", label: "준공일자", value: row.endDate || "—" },
          { fieldKey: "actualEndDate", label: "실준공일자", value: row.actualEndDate || "—" },
          { fieldKey: "companyName", label: "업체명", value: row.companyName || "—" },
          { fieldKey: "representative", label: "대표자명", value: row.representative || "—" },
          { fieldKey: "companyAddress", label: "업체주소", value: row.companyAddress || "—" },
          { fieldKey: "supervisor", label: "감독관", value: row.supervisor || "—" },
          { fieldKey: "supervisorName", label: "감독관명", value: row.supervisorName || "—" },
          { fieldKey: "phone", label: "전화번호", value: row.phone || "—" },
          { fieldKey: "budgetBefore", label: "사업비_전", value: row.budgetBefore || "—" },
          { fieldKey: "budgetIncrease", label: "사업비_증가", value: row.budgetIncrease || "—" },
          { fieldKey: "budgetDecrease", label: "사업비_감소", value: row.budgetDecrease || "—" },
          { fieldKey: "budgetAfter", label: "사업비_후", value: row.budgetAfter || "—" },
          { fieldKey: "changeReason", label: "변경사유", value: row.changeReason || "—" },
          { fieldKey: "remark", label: "비고", value: row.remark || "—" },
        ]),
        attrFullWidthByKey
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- riverNamesCell follows riverNames
    [row, riverNames, attrFullWidthByKey]
  );

  const setField = <K extends keyof AttrDraft>(key: K, value: AttrDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const setBudgetField = (
    key: "budgetBefore" | "budgetIncrease" | "budgetDecrease",
    value: string
  ) => {
    const nextValue = sanitizeBudgetInput(value);
    setDraft((prev) => {
      const next = { ...prev, [key]: nextValue };
      next.budgetAfter = computeBudgetAfter(
        next.budgetBefore,
        next.budgetIncrease,
        next.budgetDecrease
      );
      return next;
    });
  };

  const textInput = (key: keyof AttrDraft) => (
    <input
      className={fieldClass}
      value={draft[key]}
      onChange={(e) => setField(key, e.target.value)}
    />
  );

  const budgetInput = (key: "budgetBefore" | "budgetIncrease" | "budgetDecrease") => (
    <input
      className={fieldClass}
      value={draft[key]}
      inputMode="numeric"
      pattern="[0-9,]*"
      onChange={(e) => setBudgetField(key, e.target.value)}
    />
  );

  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const addressInput = (
    <div className="relative z-20">
      <OccupationLedgerPlaceInput
        value={draft.companyAddress}
        onChange={(v) => setField("companyAddress", v)}
        vworldApiKey={vworldApiKey}
        placeholder="지번/도로명 검색"
      />
    </div>
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
      applyAttrFullWidthMap(
        withRiverEntry([
          { fieldKey: "name", label: "공사명", value: textInput("name") },
          { fieldKey: "location", label: "공사위치", value: textInput("location") },
          { fieldKey: "quantity", label: "공사량", value: textInput("quantity") },
          { fieldKey: "contractDate", label: "계약일", value: dateInput("contractDate") },
          { fieldKey: "startDate", label: "착수일자", value: dateInput("startDate") },
          { fieldKey: "endDate", label: "준공일자", value: dateInput("endDate") },
          { fieldKey: "actualEndDate", label: "실준공일자", value: dateInput("actualEndDate") },
          { fieldKey: "companyName", label: "업체명", value: textInput("companyName") },
          { fieldKey: "representative", label: "대표자명", value: textInput("representative") },
          { fieldKey: "companyAddress", label: "업체주소", value: addressInput },
          { fieldKey: "supervisor", label: "감독관", value: textInput("supervisor") },
          { fieldKey: "supervisorName", label: "감독관명", value: textInput("supervisorName") },
          { fieldKey: "phone", label: "전화번호", value: textInput("phone") },
          { fieldKey: "budgetBefore", label: "사업비_전", value: budgetInput("budgetBefore") },
          { fieldKey: "budgetIncrease", label: "사업비_증가", value: budgetInput("budgetIncrease") },
          { fieldKey: "budgetDecrease", label: "사업비_감소", value: budgetInput("budgetDecrease") },
          {
            fieldKey: "budgetAfter",
            label: "사업비_후",
            value: (
              <input
                className={cn(fieldClass, "bg-slate-50 dark:bg-muted")}
                value={draft.budgetAfter}
                readOnly
                tabIndex={-1}
                inputMode="numeric"
              />
            ),
          },
          { fieldKey: "changeReason", label: "변경사유", value: textInput("changeReason") },
          { fieldKey: "remark", label: "비고", value: textInput("remark") },
        ]),
        attrFullWidthByKey
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft + river cell
    [draft, riverNames, riverNamesText, attrFullWidthByKey, vworldApiKey]
  );

  const geomBannerHost =
    mapContext?.mapInstanceRef?.current?.getTargetElement()?.parentElement ?? null;

  const mapEditBanner =
    geomBannerHost && geomBannerActive
      ? createPortal(
          <div
            className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
            style={
              geomCenterPixel
                ? { left: geomCenterPixel.x, top: geomHintTopPx }
                : { left: "50%", top: geomHintTopPx }
            }
          >
            {parcelDrawIdx != null ? (
              <DrawToolbarActions
                drawPhase="drawing"
                confirmDraw={finishParcelDraw}
                redrawShape={finishParcelDraw}
                cancelDraw={cancelParcelDraw}
                applyDisabled={false}
              />
            ) : (
              <div className="pointer-events-auto flex max-w-[min(100vw-16px,560px)] flex-wrap items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-foreground shadow-lg backdrop-blur">
                <span className="text-[12px] leading-snug sm:text-sm">
                  {draftParcels.some((p) => p.geometry3857)
                    ? "꼭짓점을 드래그해 모양을 수정하세요."
                    : "「추가」를 눌러 필지 도형을 그리세요."}
                </span>
              </div>
            )}
          </div>,
          geomBannerHost
        )
      : null;

  const titleText = isNewRow ? "공사대장 등록" : row.name.trim() || "공사대장 상세";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold leading-none text-foreground"
          title={titleText}
        >
          {titleText}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 본문 전체가 하나로 스크롤 — 상세 속성 · 필지 · 첨부파일 순서로 자연스럽게 이어짐 */}
      <MapSideDetailScroll className="flex min-h-0 flex-1 flex-col overflow-auto px-3 py-2 text-xs">
        <div className="sticky top-0 z-10 mb-1 flex shrink-0 items-center justify-between gap-2 bg-background py-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            상세 속성
            {detailLoading ? (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">
                불러오는 중…
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LayerRowEditToolbar
              isEditing={editing}
              isCreateMode={isNewRow}
              saving={saving}
              deleting={deleting}
              onEdit={beginEdit}
              onSave={() => void handleSave()}
              onCancel={handleCancel}
              onDelete={() => void handleDelete()}
            />
          </div>
        </div>
        <AttrTable entries={editing ? editEntries : viewEntries} />

        {!isNewRow ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              필지목록
              {(editing ? draftParcels : parcels).length > 0 ? (
                <span className="ml-1 font-normal normal-case text-muted-foreground">
                  ({(editing ? draftParcels : parcels).length})
                </span>
              ) : null}
            </div>
            {editing ? (
              <LayerRowPanelButton className="h-6 px-2 text-[10px]" onClick={handleAddParcelRow}>
                <Plus className="h-3 w-3 shrink-0" aria-hidden />
                추가
              </LayerRowPanelButton>
            ) : null}
          </div>

          {(editing ? draftParcels : parcels).length === 0 ? (
            <div className="rounded border border-dashed border-border bg-muted/50 px-2 py-2 text-muted-foreground">
              {editing
                ? "「추가」를 누르면 지도에서 바로 도형을 그릴 수 있습니다. 하천명·비고도 입력하세요."
                : "등록된 필지가 없습니다."}
            </div>
          ) : editing ? (
            <ul className="max-h-48 list-none space-y-1.5 overflow-y-auto overscroll-contain rounded border border-border bg-background p-1.5 scrollbar-hide">
              {draftParcels.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-1 rounded border border-border bg-muted/40 p-1"
                >
                  <button
                    type="button"
                    className="w-4 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground hover:text-primary disabled:cursor-default disabled:opacity-70"
                    onClick={() => handleParcelClick(item, i)}
                    title="클릭 시 위치 이동"
                  >
                    {i + 1}
                  </button>
                  <RiverNameSelect
                    className={cn(fieldClass, "flex-1")}
                    placeholder="하천명 검색/선택"
                    value={item.riverName ?? ""}
                    onChange={(v) => handleUpdateParcelField(i, "riverName", v)}
                  />
                  <input
                    className={cn(fieldClass, "flex-1")}
                    placeholder="비고"
                    value={item.remark ?? ""}
                    onChange={(e) => handleUpdateParcelField(i, "remark", e.target.value)}
                  />
                  {movingParcelIdx === i && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">이동중</span>
                  )}
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleRemoveParcel(i)}
                    aria-label="필지 삭제"
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="max-h-48 list-none space-y-0 overflow-y-auto overscroll-contain rounded border border-border bg-background scrollbar-hide">
              {parcels.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 border-b border-border px-2 py-1.5 text-foreground last:border-b-0"
                >
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-start gap-1 text-left hover:text-primary disabled:cursor-default disabled:opacity-70"
                    onClick={() => handleParcelClick(item, i)}
                    title="클릭 시 위치 이동"
                  >
                    <span className="mr-1 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1 break-words">
                      {item.displayText?.trim() ||
                        [item.riverName, item.remark].filter(Boolean).join(" · ") ||
                        item.address ||
                        "—"}
                    </span>
                    {movingParcelIdx === i && (
                      <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">이동 중…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        ) : null}

        {!isNewRow ? (
        <div className="mt-4 flex min-h-[12rem] flex-1 flex-col">
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              첨부파일
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={btnSecondary}
                disabled={!fileKey}
                title={
                  fileKey
                    ? "폴더 포함 첨부파일 전체 ZIP 다운로드"
                    : "저장 후 다운로드할 수 있습니다"
                }
                onClick={() => void handleDownloadAllAttachments()}
              >
                <Download className="h-3 w-3" />
                전체
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!fileKey}
                title={fileKey ? "첨부 업로드" : "저장 후 첨부할 수 있습니다"}
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
                onChange={(e) => void handleUploadFiles(e.target.files)}
              />
            </div>
          </div>

          {fileKey ? (
            <>
              <div className="mb-2 flex shrink-0 flex-wrap gap-0.5 rounded border border-border bg-muted/50 p-0.5">
                {(attachmentFolders.length > 0 ? attachmentFolders : [CONS_ATTACH_ROOT_FOLDER]).map(
                  (folder) => (
                    <button
                      key={folder}
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 rounded px-1 py-1 text-[10px] font-medium transition-colors",
                        attachmentTab === folder
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => {
                        setAttachmentTab(folder);
                        attachScrollRef.current?.scrollTo({ top: 0 });
                      }}
                    >
                      {folder}
                      {attachmentTab === folder ? ` (${attachments.length})` : ""}
                    </button>
                  )
                )}
              </div>

              <div
                ref={attachScrollRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide"
              >
                {!attachmentsReady || filesLoading ? (
                  <p className="py-3 text-center text-[11px] text-muted-foreground">첨부 목록 불러오는 중…</p>
                ) : (
                  <AttachmentThumbGrid
                    key={attachmentTab}
                    items={attachments}
                    scrollRootRef={attachScrollRef}
                    onPreview={openPreview}
                    onDownload={downloadAttachment}
                    onDelete={(att) => void handleDeleteAttachment(att)}
                    emptyLabel={`등록된 ${attachmentTab} 첨부파일이 없습니다.`}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-dashed border-border bg-muted/50 px-2 text-center text-[11px] text-muted-foreground">
              저장한 뒤 폴더별 첨부파일을 등록할 수 있습니다.
            </div>
          )}
        </div>
        ) : null}
      </MapSideDetailScroll>

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
