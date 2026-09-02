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
  Image as ImageIcon,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import "../../../_mapComponents/config/projections";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import type { Geometry } from "ol/geom";
import { createEmpty, extend as extendExtent } from "ol/extent";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import MultiPolygon from "ol/geom/MultiPolygon";
import GeoJSONFormat from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { cn } from "@/lib/utils";
import {
  occupationFillRgba,
  occupationStrokeRgba,
} from "@/lib/occupationLayerStyle";
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
  LayerParcelAddModal,
  useLayerParcelNavigation,
  type LayerRowParcelItem,
} from "../../../_mapComponents/layerRowEdit";
import { resolveParcelGeoms } from "../../../_mapComponents/layerRowEdit/resolveParcelGeoms";
import { useLayerRowParcelHighlight } from "../../../_mapComponents/layerRowEdit/useLayerRowParcelHighlight";
import {
  DrawToolbarActions,
  useDrawToolbarPosition,
  type DrawToolbarMapAnchor,
} from "../../../_mapComponents/analysisArea";
import { UsageDataAsAddressList } from "../usageDataAs/UsageDataAsAddressList";
import { CONS_DATA_AS_SOLO_WMS_LAYER_ID } from "./consDataAsLayerId";
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
  type RiverConstructionLedgerGeom,
  type RiverConstructionLedgerRow,
} from "./riverConstructionLedgerMock";
import { RiverNameSelect } from "./RiverNameSelect";
import { refreshConsDataAsMapView, ensureConsDataAsWmsLayersVisible } from "./riverConstructionLedgerMapSync";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { OccupationLedgerPlaceInput } from "../../occupationLedger/OccupationLedgerPlaceInput";

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
 * 필지(개별) 도형(GeoJSON, EPSG:3857) → 저장용 WKT(5181).
 * 목록 클릭 시 지도 강조 표시용으로 solo 테이블에 저장한다.
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

/** geometry3857(면 GeoJSON) → OpenLayers Feature — readFeatures는 Feature/Collection만 안정적 */
function featuresFromGeometry3857(
  format: GeoJSONFormat,
  geometry3857: Record<string, unknown>,
  viewProj: string
): Feature[] {
  try {
    const geomType = String(geometry3857.type ?? "");
    if (geomType === "FeatureCollection" || geomType === "Feature") {
      return format.readFeatures(geometry3857, {
        dataProjection: viewProj,
        featureProjection: viewProj,
      });
    }
    const geom = format.readGeometry(geometry3857, {
      dataProjection: viewProj,
      featureProjection: viewProj,
    });
    return geom ? [new Feature(geom)] : [];
  } catch {
    return [];
  }
}

function writeCombinedWkt5181FromSource(source: VectorSource): string | null {
  const format = new WKT();
  const polygonCoords: number[][][][] = [];
  for (const feature of source.getFeatures()) {
    const geom = feature.getGeometry()?.clone();
    if (!geom) continue;
    geom.transform("EPSG:3857", "EPSG:5181");
    const type = geom.getType();
    if (type === "Polygon") {
      polygonCoords.push((geom as Polygon).getCoordinates());
    } else if (type === "MultiPolygon") {
      for (const coords of (geom as MultiPolygon).getCoordinates()) {
        polygonCoords.push(coords);
      }
    }
  }
  if (polygonCoords.length === 0) return null;
  if (polygonCoords.length === 1) {
    return format.writeGeometry(new Polygon(polygonCoords[0]));
  }
  return format.writeGeometry(new MultiPolygon(polygonCoords));
}

function parseJijukParcelItems(raw: Record<string, unknown>[]): LayerRowParcelItem[] {
  const items: LayerRowParcelItem[] = [];
  for (const x of raw) {
    const address = String(x?.address ?? "").trim();
    const pnu = String(x?.pnu ?? "").trim();
    const geometry3857 =
      x?.geometry3857 != null && typeof x.geometry3857 === "object"
        ? (x.geometry3857 as Record<string, unknown>)
        : undefined;
    const extRaw = x?.extent3857 as unknown;
    const extent3857 =
      Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
        ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
        : null;
    if (!address && !pnu) continue;
    items.push({
      address: address || pnu,
      pnu: pnu || undefined,
      extent3857,
      ...(geometry3857 ? { geometry3857 } : {}),
    });
  }
  return items;
}

function mergeAutoParcelsIntoList(
  prev: LayerRowParcelItem[],
  autoItems: LayerRowParcelItem[],
  replaceAuto: boolean
): LayerRowParcelItem[] {
  const auto = autoItems.map((item) => ({
    ...item,
    manualAdd: false as const,
    keepOnReplace: false as const,
  }));
  if (!replaceAuto) {
    const seen = new Set(prev.map((p) => p.address.toLowerCase()));
    const merged = [...prev];
    for (const item of auto) {
      const key = item.address.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }
  const manual = prev.filter((p) => p.manualAdd === true);
  const seen = new Set(manual.map((p) => p.address.toLowerCase()));
  const merged = [...manual];
  for (const item of auto) {
    const key = item.address.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function loadBoundaryGeomIntoSource(
  source: VectorSource,
  mainGeom: RiverConstructionLedgerGeom | null,
  format: GeoJSONFormat,
  viewProj: string
) {
  source.clear();
  if (mainGeom?.type === "MultiPolygon" && Array.isArray(mainGeom.coordinates)) {
    const features = format.readFeatures(
      {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: mainGeom, properties: {} }],
      },
      { dataProjection: "EPSG:4326", featureProjection: viewProj }
    );
    source.addFeatures(features);
  }
}

function replaceSourceFeaturesFromWkt5181(
  source: VectorSource,
  wkt5181: string,
  viewProj: string
) {
  source.clear();
  const wktFormat = new WKT();
  const geom = wktFormat.readGeometry(wkt5181, {
    dataProjection: "EPSG:5181",
    featureProjection: viewProj,
  });
  if (!geom) return;
  source.addFeature(new Feature(geom));
}

function buildBoundaryToolbarAnchor(source: VectorSource): DrawToolbarMapAnchor | null {
  const features = source.getFeatures();
  if (features.length === 0) return null;
  const extent = createEmpty();
  let has = false;
  for (const feature of features) {
    const geom = feature.getGeometry();
    if (!geom) continue;
    extendExtent(extent, geom.getExtent());
    has = true;
  }
  if (!has) return null;
  return { topCenter: [(extent[0] + extent[2]) / 2, extent[3]] };
}

function buildBoundaryToolbarAnchorFromGeom(geom: Geometry): DrawToolbarMapAnchor {
  const ext = geom.getExtent();
  return { topCenter: [(ext[0] + ext[2]) / 2, ext[3]] };
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
  const boundaryGeomRef = useRef(row.geom);
  boundaryGeomRef.current = row.geom;
  const parcelsSnapshotRef = useRef<LayerRowParcelItem[]>([]);
  const parcelEditLayerRef = useRef<{
    layer: VectorLayer<VectorSource>;
    source: VectorSource;
    modify: Modify | null;
  } | null>(null);
  const syncParcelEditSourceRef = useRef<(() => void) | null>(null);
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
  const {
    selectParcel,
    selectedParcelIdx,
    clearSelection: clearParcelSelection,
  } = useLayerParcelNavigation(CONS_DATA_AS_SOLO_WMS_LAYER_ID);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawPhase, setDrawPhase] = useState<"drawing" | "editing" | "managed">("drawing");
  const [hasBoundaryGeom, setHasBoundaryGeom] = useState(false);
  const [toolbarAnchor, setToolbarAnchor] = useState<DrawToolbarMapAnchor | null>(null);
  const [parcelAddModalOpen, setParcelAddModalOpen] = useState(false);
  const [highlightParcel, setHighlightParcel] = useState<LayerRowParcelItem | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mapOpsRef = useRef<{
    confirmApply: () => void;
    redrawShape: () => void;
    cancelDraw: () => void;
    addGeom: () => void;
    modifyGeom: () => void;
    deleteGeom: () => void;
  } | null>(null);
  const pendingApplyRef = useRef(false);
  const baselineWktRef = useRef<string | null>(null);
  const isDrawActiveRef = useRef(false);
  const drawPhaseRef = useRef(drawPhase);
  drawPhaseRef.current = drawPhase;
  const detailLoadGenRef = useRef(0);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const applyJijukParcelsRef = useRef<((opts?: { silent?: boolean }) => Promise<void>) | null>(null);

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
        if (!editingRef.current) {
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
  const geomBannerActive = Boolean(mapInstance) && editing;
  const geomCenterPixel = useMapVisualCenterPixel(
    mapInstance,
    geomBannerActive,
    mapPaddingLeft
  );
  const shapeToolbarActive = geomBannerActive && drawPhase === "editing" && toolbarAnchor != null;
  const toolbarPlacement = useDrawToolbarPosition(
    mapContext?.mapInstanceRef ?? { current: null },
    toolbarAnchor,
    toolbarRef,
    shapeToolbarActive
  );

  useEffect(() => {
    if (!editing) {
      setDrawPhase("drawing");
      setHasBoundaryGeom(false);
      setToolbarAnchor(null);
      clearParcelSelection();
    } else {
      setHighlightParcel(null);
    }
  }, [editing, clearParcelSelection]);

  useEffect(() => {
    setHighlightParcel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id 전환 시만
  }, [row.id]);

  useLayerRowParcelHighlight(highlightParcel, "blue");

  useEffect(() => {
    setDraft(toDraft(row));
    setRiverNamesText(normalizeRiverNames(row.riverNames)[0] ?? "");
    parcelsSnapshotRef.current = [...(row.parcels ?? [])];
    setDraftParcels(withRiverNameFallback(row.parcels ?? []));
    setGeomEditingId?.(null);

    const isNew = isNewRiverConstructionLedgerRow(row) || !row.name.trim();
    setEditing(isNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row.id 전환 시에만
  }, [row.id, setGeomEditingId]);

  useEffect(() => {
    return () => {
      setGeomEditingId?.(null);
    };
  }, [setGeomEditingId]);

  /** 속성·필지 수정 중엔 공사구간 전체 도형(오버레이)을 숨기고, 대신 필지별 도형 참고 레이어를 보여준다 */
  useEffect(() => {
    setGeomEditingId?.(editing ? row.id : null);
  }, [editing, row.id, setGeomEditingId]);

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

  const flushParcelEditSourceToDraft = useCallback(async () => {
    const source = parcelEditLayerRef.current?.source;
    if (source && writeCombinedWkt5181FromSource(source)) {
      await applyJijukParcelsRef.current?.({ silent: true });
    }
  }, []);

  const parcels = row.parcels ?? [];

  const applyJijukParcelsToDraft = useCallback(
    async (opts?: { silent?: boolean; replaceAuto?: boolean }) => {
      const source = parcelEditLayerRef.current?.source;
      const wkt5181 = source ? writeCombinedWkt5181FromSource(source) : null;
      const replaceAuto = opts?.replaceAuto !== false;
      if (!wkt5181) {
        const merged = mergeAutoParcelsIntoList(draftParcelsRef.current, [], replaceAuto);
        draftParcelsRef.current = merged;
        setDraftParcels(merged);
        patchRow((r) => ({ ...r, parcels: merged }));
        return;
      }
      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "listJijukParcelsByGeomWkt5181",
          params: { wkt5181, clipToSearchGeom: true },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          if (!opts?.silent) window.alert(String(data.error));
          return;
        }
        const raw = Array.isArray(data?.parcels) ? data.parcels : [];
        const items = parseJijukParcelItems(raw as Record<string, unknown>[]);
        const merged = mergeAutoParcelsIntoList(draftParcelsRef.current, items, replaceAuto);
        draftParcelsRef.current = merged;
        setDraftParcels(merged);
        patchRow((r) => ({ ...r, parcels: merged }));
      } catch {
        if (!opts?.silent) window.alert("필지목록을 불러오지 못했습니다.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patchRow from map context
    []
  );

  useEffect(() => {
    applyJijukParcelsRef.current = applyJijukParcelsToDraft;
  }, [applyJijukParcelsToDraft]);

  const addDraftParcel = useCallback(
    (item: LayerRowParcelItem) => {
      const key = item.address.toLowerCase();
      const nextItem: LayerRowParcelItem = {
        ...item,
        manualAdd: true,
        keepOnReplace: true,
      };
      const list = draftParcelsRef.current;
      if (list.some((p) => p.address.toLowerCase() === key)) return;
      const merged = [...list, nextItem];
      draftParcelsRef.current = merged;
      setDraftParcels(merged);
      patchRow((r) => ({ ...r, parcels: merged }));
      void resolveParcelGeoms([nextItem]).then((resolvedList) => {
        const resolved = resolvedList[0];
        if (!resolved?.geometry3857 && !resolved?.pnu) return;
        const updated = draftParcelsRef.current.map((p) =>
          p.address.toLowerCase() === key
            ? {
                ...nextItem,
                pnu: resolved.pnu ?? nextItem.pnu,
                extent3857: resolved.extent3857 ?? nextItem.extent3857,
                geometry3857: resolved.geometry3857 ?? nextItem.geometry3857,
                manualAdd: true as const,
                keepOnReplace: true as const,
              }
            : p
        );
        draftParcelsRef.current = updated;
        setDraftParcels(updated);
        patchRow((r) => ({ ...r, parcels: updated }));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patchRow from map context
    []
  );

  const removeDraftParcel = useCallback((index: number) => {
    const next = draftParcelsRef.current.filter((_, i) => i !== index);
    draftParcelsRef.current = next;
    setDraftParcels(next);
    patchRow((r) => ({ ...r, parcels: next }));
  }, []);

  const boundaryEditStyle = new Style({
    stroke: new Stroke({ color: occupationStrokeRgba("parentActive"), width: 2.5 }),
    fill: new Fill({ color: occupationFillRgba("parentActive") }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: occupationFillRgba("parentActive", 0.95) }),
      stroke: new Stroke({ color: "#fff", width: 1.5 }),
    }),
  });

  /** 수정 모드 — 하천점용과 동일 Draw·적용·관리 단계 */
  useEffect(() => {
    if (!editing) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) return;

    setRiverFocus?.(null);

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
    const format = new GeoJSONFormat();
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 9999,
      style: boundaryEditStyle,
    });

    loadBoundaryGeomIntoSource(
      source,
      boundaryGeomRef.current ?? null,
      format,
      viewProj
    );

    let draw: Draw | null = null;
    let modify: Modify | null = null;

    const syncHasBoundary = () => {
      setHasBoundaryGeom(source.getFeatures().length > 0);
    };

    const syncToolbarAnchor = () => {
      setToolbarAnchor(buildBoundaryToolbarAnchor(source));
    };

    const clearToolbarAnchor = () => {
      setToolbarAnchor(null);
    };

    const rememberBaseline = () => {
      baselineWktRef.current = writeCombinedWkt5181FromSource(source);
      parcelsSnapshotRef.current = [...draftParcelsRef.current];
    };

    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
        isDrawActiveRef.current = false;
      }
    };

    const goManaged = () => {
      detachDraw();
      detachModify();
      pendingApplyRef.current = false;
      syncToolbarAnchor();
      syncHasBoundary();
      setDrawPhase("managed");
    };

    const attachModify = () => {
      detachModify();
      modify = new Modify({ source });
      let anchorRaf = 0;
      const scheduleAnchor = () => {
        if (anchorRaf) return;
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0;
          syncToolbarAnchor();
        });
      };
      modify.on("modifyend", () => {
        syncHasBoundary();
        scheduleAnchor();
        setDrawPhase("editing");
      });
      map.addInteraction(modify);
      syncToolbarAnchor();
      setDrawPhase("editing");
    };

    const startDraw = (opts?: { clearParents?: boolean }) => {
      const clearParents = opts?.clearParents !== false;
      detachDraw();
      detachModify();
      if (clearParents) {
        source.clear();
        setHasBoundaryGeom(false);
        clearToolbarAnchor();
      }
      pendingApplyRef.current = true;
      setDrawPhase("drawing");
      draw = new Draw({ source, type: "Polygon", stopClick: true });
      draw.on("drawend", (e) => {
        const geom = e.feature.getGeometry();
        requestAnimationFrame(() => {
          syncHasBoundary();
          pendingApplyRef.current = true;
          if (geom) {
            setToolbarAnchor(
              buildBoundaryToolbarAnchor(source) ?? buildBoundaryToolbarAnchorFromGeom(geom)
            );
          } else {
            syncToolbarAnchor();
          }
          detachDraw();
          attachModify();
        });
      });
      map.addInteraction(draw);
      isDrawActiveRef.current = true;
    };

    const restoreBaselineOrManaged = () => {
      const baseline = baselineWktRef.current;
      detachDraw();
      detachModify();
      if (baseline) {
        replaceSourceFeaturesFromWkt5181(source, baseline, viewProj);
        syncHasBoundary();
        draftParcelsRef.current = [...parcelsSnapshotRef.current];
        setDraftParcels([...parcelsSnapshotRef.current]);
        patchRow((r) => ({ ...r, parcels: [...parcelsSnapshotRef.current] }));
      } else {
        source.clear();
        setHasBoundaryGeom(false);
      }
      pendingApplyRef.current = false;
      goManaged();
    };

    mapOpsRef.current = {
      confirmApply: () => {
        const wkt = writeCombinedWkt5181FromSource(source);
        if (!wkt) {
          window.alert("그린 도형이 없습니다. 지도에 도형을 그려 주세요.");
          return;
        }
        pendingApplyRef.current = false;
        rememberBaseline();
        void applyJijukParcelsRef.current?.({ silent: true });
        goManaged();
      },
      redrawShape: () => {
        const manual = draftParcelsRef.current.filter((p) => p.manualAdd === true);
        draftParcelsRef.current = manual;
        setDraftParcels(manual);
        patchRow((r) => ({ ...r, parcels: manual }));
        startDraw({ clearParents: true });
      },
      cancelDraw: () => {
        restoreBaselineOrManaged();
      },
      addGeom: () => {
        startDraw({ clearParents: false });
      },
      modifyGeom: () => {
        if (source.getFeatures().length === 0) {
          startDraw({ clearParents: false });
          return;
        }
        rememberBaseline();
        pendingApplyRef.current = true;
        attachModify();
      },
      deleteGeom: () => {
        detachDraw();
        source.clear();
        setHasBoundaryGeom(false);
        baselineWktRef.current = null;
        void applyJijukParcelsRef.current?.({ silent: true });
        clearToolbarAnchor();
        goManaged();
      },
    };

    map.addLayer(layer);
    parcelEditLayerRef.current = { layer, source, modify };
    syncParcelEditSourceRef.current = () => {
      void applyJijukParcelsRef.current?.({ silent: true });
    };

    const initialWkt = writeCombinedWkt5181FromSource(source);
    baselineWktRef.current = initialWkt;
    syncHasBoundary();

    if (initialWkt) {
      goManaged();
    } else {
      startDraw({ clearParents: true });
    }

    return () => {
      mapOpsRef.current = null;
      syncParcelEditSourceRef.current = null;
      detachDraw();
      detachModify();
      map.removeLayer(layer);
      source.clear();
      parcelEditLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 편집 진입·종료 시에만 레이어 구성
  }, [editing, mapContext?.mapInstanceRef]);

  const beginEdit = () => {
    setDraft(toDraft(row));
    setRiverNamesText(normalizeRiverNames(row.riverNames)[0] ?? "");
    const filled = withRiverNameFallback(row.parcels ?? []);
    parcelsSnapshotRef.current = [...filled];
    draftParcelsRef.current = filled;
    setDraftParcels(filled);
    setEditing(true);
  };

  const parcelsToSavePayload = (list: LayerRowParcelItem[]) =>
    list
      .map((p) => ({
        address: (p.address ?? "").trim(),
        geomWkt5181: parcelGeomToWkt5181(p.geometry3857),
      }))
      .filter((p) => p.address || p.geomWkt5181);

  const getBoundaryGeomWkt5181ForSave = (): {
    geomWkt5181: string | null;
    geomClear: boolean;
  } => {
    const source = parcelEditLayerRef.current?.source;
    if (!source) return { geomWkt5181: null, geomClear: false };
    const wkt = writeCombinedWkt5181FromSource(source);
    return { geomWkt5181: wkt, geomClear: !wkt };
  };

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

  const handleParcelClick = useCallback(
    (item: LayerRowParcelItem, idx: number) => {
      if (selectedParcelIdx === idx) {
        clearParcelSelection();
        setHighlightParcel(null);
        return;
      }
      ensureConsDataAsWmsLayersVisible(mapContext?.setVisibleLayerNames);
      void selectParcel(item, idx, {
        onHighlight: setHighlightParcel,
        enableWmsLayer: false,
        useItemGeometry: true,
      });
    },
    [
      clearParcelSelection,
      mapContext?.setVisibleLayerNames,
      selectParcel,
      selectedParcelIdx,
    ]
  );

  const handleSave = async () => {
    if (!draft.name.trim()) {
      window.alert("공사명을 입력하세요.");
      return;
    }
    await flushParcelEditSourceToDraft();
    const { geomWkt5181, geomClear } = getBoundaryGeomWkt5181ForSave();
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
          geomWkt5181,
          geomClear,
          parcels: parcelsToSavePayload(draftParcelsRef.current),
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
      draftParcelsRef.current = [];
      setDraftParcels([]);
      parcelsSnapshotRef.current = [];
      boundaryGeomRef.current = null;
      mapContext?.setRiverConstructionLedgerRows?.((rows) =>
        rows.filter((r) => !isNewRiverConstructionLedgerRow(r))
      );
      mapContext?.setRiverConstructionLedgerSelectedId?.(null);
      setGeomEditingId?.(null);
      return;
    }
    const snapParcels = [...parcelsSnapshotRef.current];
    draftParcelsRef.current = snapParcels;
    setDraftParcels(snapParcels);
    patchRow((prev) => ({ ...prev, parcels: snapParcels }));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`「${row.name || "신규 공사"}」을(를) 삭제할까요?`)) return;
    const clearDeletedFromMap = () => {
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

  const drawToolbar = (
    <DrawToolbarActions
      drawPhase={drawPhase}
      confirmDraw={() => mapOpsRef.current?.confirmApply()}
      redrawShape={() => mapOpsRef.current?.redrawShape()}
      cancelDraw={() => mapOpsRef.current?.cancelDraw()}
      applyDisabled={drawPhase === "editing" && !hasBoundaryGeom}
      addGeom={() => mapOpsRef.current?.addGeom()}
      modifyGeom={() => mapOpsRef.current?.modifyGeom()}
      deleteGeom={() => mapOpsRef.current?.deleteGeom()}
      showDeleteGeom={hasBoundaryGeom}
      showModifyGeom={hasBoundaryGeom}
    />
  );

  const mapEditBanner =
    geomBannerActive && (drawPhase === "editing" || geomBannerHost)
      ? createPortal(
          drawPhase === "drawing" || drawPhase === "managed" ? (
            <div
              className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
              style={
                geomCenterPixel
                  ? { left: geomCenterPixel.x, top: geomHintTopPx }
                  : { left: "50%", top: geomHintTopPx }
              }
            >
              {drawToolbar}
            </div>
          ) : (
            <div
              ref={toolbarRef}
              className="pointer-events-none fixed z-[1200] flex flex-col items-start gap-1.5"
              style={
                toolbarPlacement
                  ? { left: toolbarPlacement.left, top: toolbarPlacement.top }
                  : geomCenterPixel
                    ? { left: geomCenterPixel.x, top: geomHintTopPx, transform: "translateX(-50%)" }
                    : { left: "50%", top: geomHintTopPx, transform: "translateX(-50%)" }
              }
            >
              {drawToolbar}
            </div>
          ),
          drawPhase === "editing" ? document.body : geomBannerHost!
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

      {/* 속성·필지는 고정, 첨부만 남은 높이에서 스크롤 */}
      <MapSideDetailScroll className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2 text-xs">
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
        <div className="shrink-0">
          <AttrTable entries={editing ? editEntries : viewEntries} />
        </div>

        {(editing || !isNewRow) ? (
          <div className="shrink-0">
            <UsageDataAsAddressList
              title="필지목록"
              className="mt-2"
              maxVisibleCards={5}
              isEditing={editing}
              items={editing ? draftParcels : parcels}
              selectedIdx={selectedParcelIdx}
              onAdd={editing ? () => setParcelAddModalOpen(true) : undefined}
              onRemove={editing ? removeDraftParcel : undefined}
              onClick={handleParcelClick}
              emptyHintEdit="도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다. 「추가」로 직접 등록할 수도 있습니다."
              emptyHintView="등록된 필지가 없습니다."
            />
            <LayerParcelAddModal
              open={parcelAddModalOpen}
              onOpenChange={setParcelAddModalOpen}
              vworldApiKey={vworldApiKey}
              title="필지 추가"
              onAdd={addDraftParcel}
            />
          </div>
        ) : null}

        {!isNewRow ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
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
