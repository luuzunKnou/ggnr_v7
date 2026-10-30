"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileDown, ImageOff, Loader2, MapPin, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSerWriteAccess } from "@/hooks/useSerWriteAccess";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { AddressSearchPanel } from "../../../_mapComponents/addressSearch/AddressSearchPanel";
import {
  getAddressFromCoord,
  getCoordFromAddress,
  type VWorldAddressItem,
} from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import { layerRowPanelButtonClass } from "../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from "../../../searchBarOffsetContext";
import { captureLocationMapWithPoint } from "../../road/roadFrontageBuilding/roadFrontageBuildingLocationCapture";
import { useRiverIllegalOccupationMapLocation } from "./useRiverIllegalOccupationMapLocation";
import { useRiverIllegalOccupationPointPick } from "./useRiverIllegalOccupationPointPick";
import {
  RIVER_ILLEGAL_OCCUPATION_COLUMNS as COLS,
  RIVER_ILLEGAL_RECURRENCE_OPTIONS,
  RIVER_ILLEGAL_RIVER_TYPES,
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
  type RiverIllegalOccupationFieldKey,
  type RiverIllegalStatusKindKey,
  type RiverIllegalStatusRowKey,
} from "./riverIllegalOccupationConfig";
import {
  createEmptyRiverIllegalOccupationCard,
  deleteRiverIllegalOccupationCard,
  isNewRiverIllegalOccupationId,
  patchRiverIllegalOccupationCard,
  riverIllegalLinesToText,
  riverIllegalStatusTotal,
  riverIllegalTextToLines,
  saveRiverIllegalOccupationCard,
  splitRiverIllegalLines,
  useRiverIllegalOccupationCards,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import {
  formatRiverIllegalCardDate,
  parseRiverIllegalRedMarkup,
  sanitizeRiverIllegalStatusInput,
  splitRiverIllegalKindLabel,
} from "./riverIllegalOccupationFormat";
import {
  downloadRiverIllegalOccupationCardPdf,
  printRiverIllegalOccupationCard,
} from "./riverIllegalOccupationPrint";

/** 접도구역 건축물 관리대장 서식과 같은 테두리·머리칸 */
const BORDER = "border-[1px] border-solid border-foreground/80";
const FORM_TH_BG = "bg-[#F5F5F5] dark:bg-zinc-600";
const FORM_LABEL_W = "6.5rem";
/** 위치 줄 오른쪽(재발)·완료일자 값 칸 — 날짜+완료여부 한 줄이 들어가게 */
const FORM_RECURRENCE_VALUE_W = "38%";
const formTableClass = "w-full table-fixed border-collapse leading-none";
const thClass = `box-border ${BORDER} ${FORM_TH_BG} px-1 py-0.5 text-center align-middle text-[11px] font-semibold leading-tight text-foreground`;
const tdClass = `box-border h-[30px] ${BORDER} bg-background px-1.5 py-1 align-middle text-[11px] leading-snug text-foreground`;
const fieldClass =
  "h-[22px] w-full min-w-0 rounded-sm border border-border bg-background px-1 text-[11px] leading-none text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const textareaClass =
  "block w-full min-w-0 resize-y rounded-sm border border-border bg-background px-1 py-0.5 text-[11px] leading-snug text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const actionBtn = "standard-detail-action-btn inline-flex h-7 items-center gap-1";
const actionBtnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const actionBtnDanger = "standard-detail-action-btn-danger inline-flex h-7 items-center gap-1";
const locationPickBtn =
  "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground";
const locationPickBtnActive = "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300";

/** 원본 카드에서 줄 앞에 «▸»를 붙이는 항목 */
const BULLET_FIELDS = new Set<RiverIllegalOccupationFieldKey>([
  "violation",
  "relatedLaw",
  "actionContent",
  "actionPlan",
  "manager",
]);

/** 화면 줄바꿈 → DB «@» 구분으로 저장하는 항목 */
const MULTILINE_ROWS: RiverIllegalOccupationFieldKey[] = [
  "violation",
  "relatedLaw",
  "actionContent",
  "actionPlan",
  "manager",
];

type PhotoField = "locationMapUrl" | "photo1Url" | "photo2Url" | "completePhotoUrl";

const PHOTO_FIELDS: PhotoField[] = ["locationMapUrl", "photo1Url", "photo2Url", "completePhotoUrl"];

const PHOTO_ROWS: [PhotoField, PhotoField][] = [
  ["locationMapUrl", "photo1Url"],
  ["photo2Url", "completePhotoUrl"],
];

function Th({
  children,
  className,
  rowSpan,
}: {
  children: ReactNode;
  className?: string;
  rowSpan?: number;
}) {
  return (
    <th rowSpan={rowSpan} className={cn(thClass, className)}>
      {children}
    </th>
  );
}

function Td({ children, className, colSpan }: { children: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn(tdClass, className)}>
      {children}
    </td>
  );
}

/** `#빨간#` 구간을 빨간 글씨로 */
function RedMarkupText({ value, className }: { value: string; className?: string }) {
  const parts = parseRiverIllegalRedMarkup(value);
  if (parts.length === 0) return null;
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.red ? (
          <span key={i} className="text-red-600">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

/** 조회 — «@» 줄마다 한 줄 (bullet 항목은 «▸»), #…# 은 빨강 */
function LinesView({ value, bullet }: { value: string; bullet: boolean }) {
  const lines = splitRiverIllegalLines(value);
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5">
      {lines.map((line, i) => (
        <li key={i} className="flex min-w-0 gap-1 break-all">
          {bullet ? <span className="shrink-0 text-muted-foreground">▸</span> : null}
          <RedMarkupText value={line} className="min-w-0" />
        </li>
      ))}
    </ul>
  );
}

/** 수정 — 줄바꿈으로 입력, 저장 값은 «@» 구분 */
function LinesInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [text, setText] = useState(() => riverIllegalLinesToText(value));
  const rows = Math.max(2, text.split("\n").length);
  return (
    <textarea
      className={textareaClass}
      rows={rows}
      value={text}
      placeholder="Enter로 줄 구분 (저장 시 @ 로 연결)"
      onChange={(e) => {
        setText(e.target.value);
        onChange(riverIllegalTextToLines(e.target.value));
      }}
    />
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 사진 한 칸 — 그림을 누르면 전체화면. 수정 중 업로드 칸은 오른쪽 위 «등록»·«삭제»
 * (위치도는 업로드하지 않고 위치 주소·도형으로만 만든다)
 */
function PhotoSlot({
  url,
  editing,
  uploadable,
  capturing,
  emptyHint,
  onAdd,
  onRemove,
  onPreview,
}: {
  url: string;
  editing: boolean;
  uploadable: boolean;
  capturing?: boolean;
  emptyHint?: string;
  onAdd: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = url.trim();
  const showImg = Boolean(src) && !failed && !capturing;
  const canPick = editing && uploadable && !src && !capturing;
  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-background", (showImg || canPick) && "cursor-pointer")}
      title={showImg ? "크게 보기" : undefined}
      onClick={showImg ? onPreview : canPick ? onAdd : undefined}
    >
      {capturing ? (
        <div className="flex h-full items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          지도를 담는 중…
        </div>
      ) : showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-1.5 h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)] object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-muted-foreground">
          <ImageOff className="h-4 w-4 opacity-60" aria-hidden />
          {src ? "사진을 불러올 수 없습니다" : editing ? emptyHint || "눌러서 사진 등록" : "사진 없음"}
        </div>
      )}
      {editing && uploadable && !capturing ? (
        <div className="absolute right-1 top-1 flex gap-1">
          <button
            type="button"
            title={src ? "사진 바꾸기" : "사진 등록"}
            aria-label={src ? "사진 바꾸기" : "사진 등록"}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {src ? (
            <button
              type="button"
              title="사진 삭제"
              aria-label="사진 삭제"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background/90 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 카드가 바뀌면 상위에서 key={cardId}로 다시 그려 초안을 초기화한다 */
type Props = {
  cardId: string;
  onClose: () => void;
  /** 저장 후 선택할 id (신규 등록 시 새 id) */
  onSaved: (id: string) => void;
  onDeleted: () => void;
};

/** 하천·계곡 구역 내 불법 점용시설 관리카드 — 카드 모양 그대로 조회·추가·수정·인쇄 */
export function RiverIllegalOccupationDetailPanel({ cardId, onClose, onSaved, onDeleted }: Props) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const cards = useRiverIllegalOccupationCards();
  const canWrite = useSerWriteAccess();
  const isCreateMode = isNewRiverIllegalOccupationId(cardId);
  const saved = isCreateMode ? null : (cards.find((c) => c.id === cardId) ?? null);

  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [draft, setDraft] = useState<RiverIllegalOccupationCard>(
    () => saved ?? createEmptyRiverIllegalOccupationCard()
  );
  /** 수정 진입마다 여러 줄 입력칸을 새 값으로 다시 그림 */
  const [editSession, setEditSession] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  /** 지도에서 찍어 주소를 채우면 위치 검색칸을 새 주소로 다시 그림 */
  const [locationInputSession, setLocationInputSession] = useState(0);
  const [preview, setPreview] = useState<{ items: ServiceFilePreviewItem[]; index: number } | null>(null);
  const captureSeqRef = useRef(0);
  const autoMapTriedRef = useRef<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoSlotRef = useRef<PhotoField | null>(null);

  const current = isEditing ? draft : (saved ?? draft);
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const pickBannerCenter = useMapVisualCenterPixel(map, picking, mapPaddingLeft);

  useRiverIllegalOccupationMapLocation({ key: cardId, lon: current.lon, lat: current.lat }, !picking);

  /** 좌표 지도에 점을 찍어 위치도 그림(data URL)으로 — 접도구역 건축물 위치도와 같은 방식 */
  const captureMapAt = useCallback(
    async (lon: number, lat: number): Promise<string | null> => {
      if (!map) return null;
      const file = await captureLocationMapWithPoint(map, { lon, lat }, mapContext?.mapBackgroundMapIdRef?.current);
      return file ? readFileAsDataUrl(file) : null;
    },
    [map, mapContext?.mapBackgroundMapIdRef]
  );

  /** 수정 중 위치가 정해지면(주소·점 찍기) 위치도를 새로 담는다. 연속 선택 시 마지막만 반영 */
  const refreshLocationMap = useCallback(
    async (lon: number, lat: number) => {
      const seq = (captureSeqRef.current += 1);
      setCapturing(true);
      try {
        const dataUrl = await captureMapAt(lon, lat);
        if (seq !== captureSeqRef.current) return;
        if (!dataUrl) {
          window.alert("위치도 지도를 담지 못했습니다. 위치를 다시 정해 주세요.");
          return;
        }
        setDraft((prev) => ({ ...prev, locationMapUrl: dataUrl }));
      } catch {
        if (seq === captureSeqRef.current) window.alert("위치도 지도를 담지 못했습니다.");
      } finally {
        if (seq === captureSeqRef.current) setCapturing(false);
      }
    },
    [captureMapAt]
  );

  /** 조회 중 위치도가 없는 카드(예시 등) — 주소로 좌표를 찾아 위치도를 한 번 만들어 둔다 */
  useEffect(() => {
    if (isEditing || !saved || !map || !vworldApiKey) return;
    if (saved.locationMapUrl.trim() || !saved.location.trim()) return;
    if (autoMapTriedRef.current === saved.id) return;
    autoMapTriedRef.current = saved.id;
    const target = saved;
    void (async () => {
      let lon = Number(target.lon);
      let lat = Number(target.lat);
      if (!target.lon.trim() || !target.lat.trim() || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        let hit = await getCoordFromAddress(target.location, { apiKey: vworldApiKey, type: "PARCEL" });
        if (!hit.ok) hit = await getCoordFromAddress(target.location, { apiKey: vworldApiKey, type: "ROAD" });
        if (!hit.ok) return;
        lon = hit.lon;
        lat = hit.lat;
        patchRiverIllegalOccupationCard(target.id, { lon: String(lon), lat: String(lat) });
      }
      const dataUrl = await captureMapAt(lon, lat);
      if (dataUrl) patchRiverIllegalOccupationCard(target.id, { locationMapUrl: dataUrl });
    })();
  }, [isEditing, saved, map, vworldApiKey, captureMapAt]);

  /** 지도에 점을 찍으면 좌표 → 지번 주소 → 위치도 */
  const handlePointPicked = useCallback(
    (lon: number, lat: number) => {
      setPicking(false);
      setDraft((prev) => ({ ...prev, lon: String(lon), lat: String(lat) }));
      void (async () => {
        try {
          const addr = vworldApiKey ? await getAddressFromCoord(lon, lat, { apiKey: vworldApiKey, type: "PARCEL" }) : null;
          const text = String(addr?.jibun ?? "").trim() || String(addr?.road ?? "").trim();
          if (!text) return;
          setDraft((prev) => ({ ...prev, location: text }));
          setLocationInputSession((n) => n + 1);
        } catch {
          /* 주소를 못 찾아도 위치도는 담는다 */
        }
      })();
      void refreshLocationMap(lon, lat);
    },
    [refreshLocationMap, vworldApiKey]
  );

  const handlePickBlocked = useCallback(() => setPicking(false), []);
  useRiverIllegalOccupationPointPick(isEditing && picking, handlePointPicked, handlePickBlocked);

  const previewItems = useMemo(
    () =>
      PHOTO_FIELDS.filter((f) => current[f].trim()).map((f) => ({
        field: f,
        item: { url: current[f], fileName: COLS[f].label, kind: "image" } as ServiceFilePreviewItem,
      })),
    [current]
  );

  if (!isCreateMode && !saved) {
    return (
      <div className="standard-panel-root">
        <div className="standard-panel-header">
          <span className="standard-panel-title">불법점용 관리카드 상세</span>
          <button type="button" onClick={onClose} className="standard-panel-close" title="상세 닫기" aria-label="상세 닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="standard-detail-scroll px-3 py-6">
          <p className="text-center text-xs text-muted-foreground">삭제되었거나 존재하지 않는 카드입니다.</p>
        </div>
      </div>
    );
  }

  const setField = (key: RiverIllegalOccupationFieldKey, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const setStatus = (kind: RiverIllegalStatusKindKey, row: RiverIllegalStatusRowKey, raw: string) => {
    const value = sanitizeRiverIllegalStatusInput(raw);
    setDraft((prev) => ({
      ...prev,
      status: { ...prev.status, [kind]: { ...prev.status[kind], [row]: value } },
    }));
  };

  const beginEdit = () => {
    if (!saved) return;
    setDraft(saved);
    setEditSession((n) => n + 1);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    captureSeqRef.current += 1;
    setCapturing(false);
    setPicking(false);
    if (isCreateMode) {
      onClose();
      return;
    }
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!draft.serialNo.trim()) {
      window.alert("연번을 입력하세요.");
      return;
    }
    const id = saveRiverIllegalOccupationCard(draft);
    setPicking(false);
    setIsEditing(false);
    onSaved(id);
  };

  const handleDelete = () => {
    if (!saved) return;
    if (!window.confirm("이 관리카드를 삭제하시겠습니까?")) return;
    deleteRiverIllegalOccupationCard(saved.id);
    onDeleted();
  };

  /** 위치 주소 선택 → 주소·좌표 반영 후 그 위치 지도를 담아 위치도로 넣는다 */
  const applyLocationFromSearch = (item: VWorldAddressItem) => {
    const address =
      (item.jibunAddress ?? "").trim() || (item.roadAddress ?? "").trim() || (item.address ?? "").trim();
    const lon = Number(item.point?.x);
    const lat = Number(item.point?.y);
    const hasPoint = Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0);
    setDraft((prev) => ({
      ...prev,
      location: address || prev.location,
      lon: hasPoint ? String(lon) : prev.lon,
      lat: hasPoint ? String(lat) : prev.lat,
    }));
    if (hasPoint) void refreshLocationMap(lon, lat);
  };

  const openPreview = (field: PhotoField) => {
    const index = previewItems.findIndex((p) => p.field === field);
    if (index < 0) return;
    setPreview({ items: previewItems.map((p) => p.item), index });
  };

  const openPhotoPicker = (field: PhotoField) => {
    photoSlotRef.current = field;
    photoInputRef.current?.click();
  };

  const handlePickPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    const field = photoSlotRef.current;
    photoSlotRef.current = null;
    if (!file || !field) return;
    if (!file.type.startsWith("image/")) {
      window.alert("그림 파일만 등록할 수 있습니다.");
      return;
    }
    try {
      setField(field, await readFileAsDataUrl(file));
    } catch {
      window.alert("사진을 읽지 못했습니다.");
    }
  };

  const removePhoto = (field: PhotoField) => {
    if (!window.confirm(`${COLS[field].label} 사진을 삭제할까요?`)) return;
    setField(field, "");
  };

  const textCell = (key: RiverIllegalOccupationFieldKey, opts?: { options?: readonly string[]; date?: boolean }) => {
    const value = current[key];
    if (!isEditing) {
      const shown = opts?.date ? formatRiverIllegalCardDate(value) : value;
      return (
        <span className="block truncate text-center" title={shown || undefined}>
          {shown || "-"}
        </span>
      );
    }
    if (opts?.options) {
      return (
        <select className={fieldClass} value={value} onChange={(e) => setField(key, e.target.value)}>
          <option value="">선택</option>
          {value && !opts.options.includes(value) ? <option value={value}>{value}</option> : null}
          {opts.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={opts?.date ? "date" : "text"}
        className={cn(fieldClass, opts?.date && "input-date-compact")}
        value={value}
        onChange={(e) => setField(key, e.target.value)}
      />
    );
  };

  const linesCell = (key: RiverIllegalOccupationFieldKey) => {
    if (!isEditing) return <LinesView value={current[key]} bullet={BULLET_FIELDS.has(key)} />;
    return <LinesInput key={`${editSession}:${key}`} value={draft[key]} onChange={(v) => setField(key, v)} />;
  };

  return (
    <div className="standard-panel-root relative bg-muted">
      <div className="standard-panel-header bg-background">
        <span className="standard-panel-title truncate">
          {isCreateMode ? "불법점용 관리카드 등록" : "불법점용 관리카드 상세"}
        </span>
        <div className="standard-detail-section-header-actions">
          {!isEditing ? (
            <button type="button" className={actionBtn} onClick={() => void printRiverIllegalOccupationCard(current)}>
              <Printer className="h-3 w-3" />
              인쇄
            </button>
          ) : null}
          {!isEditing ? (
            <button
              type="button"
              className={actionBtn}
              disabled={pdfSaving}
              title="인쇄 창에서 대상을 «PDF로 저장»으로 고르면 됩니다"
              onClick={() => {
                setPdfSaving(true);
                void downloadRiverIllegalOccupationCardPdf(current)
                  .catch(() => window.alert("인쇄 창을 열지 못했습니다."))
                  .finally(() => setPdfSaving(false));
              }}
            >
              {pdfSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
              PDF 저장
            </button>
          ) : null}
          {canWrite ? (
            !isEditing ? (
              <>
                <button type="button" className={actionBtn} onClick={beginEdit}>
                  <Pencil className="h-3 w-3" />
                  수정
                </button>
                <button type="button" className={actionBtnDanger} onClick={handleDelete}>
                  <Trash2 className="h-3 w-3" />
                  삭제
                </button>
              </>
            ) : (
              <>
                <button type="button" className={actionBtn} onClick={cancelEdit}>
                  취소
                </button>
                <button type="button" className={actionBtnPrimary} onClick={handleSave} disabled={capturing}>
                  {isCreateMode ? "등록" : "저장"}
                </button>
              </>
            )
          ) : null}
          <button type="button" onClick={onClose} className="standard-panel-close" title="상세 닫기" aria-label="상세 닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <MapSideDetailScroll className="standard-detail-scroll">
        {isEditing ? (
          <div className="border-b border-border bg-muted/60 py-1.5 text-[11px] text-muted-foreground">
            * 글 작성 시 #내용#처럼 양쪽을 #로 감싸면 그 구간만 빨간색으로 표시됩니다. (예: #중요문구#)
          </div>
        ) : null}
        <div className="rounded-sm border border-border bg-background p-3 text-xs shadow-sm">
          <h2 className="mb-2 text-center text-[17px] font-bold leading-tight tracking-tight text-foreground underline decoration-1 underline-offset-4">
            하천·계곡 구역 내 불법 점용시설 관리카드
          </h2>

          <div className="[&_table+table]:-mt-px">
            <table className={formTableClass}>
              <colgroup>
                <col style={{ width: FORM_LABEL_W }} />
                <col />
                <col style={{ width: FORM_LABEL_W }} />
                <col style={{ width: FORM_RECURRENCE_VALUE_W }} />
              </colgroup>
              <tbody>
                <tr>
                  <Th>{COLS.serialNo.label}</Th>
                  <Td>{textCell("serialNo")}</Td>
                  <Th>{COLS.riverType.label}</Th>
                  <Td>{textCell("riverType", { options: RIVER_ILLEGAL_RIVER_TYPES })}</Td>
                </tr>
                <tr>
                  <Th>{COLS.firstCheckYmd.label}</Th>
                  <Td>{textCell("firstCheckYmd", { date: true })}</Td>
                  <Th>{COLS.completeYmd.label}</Th>
                  {/* 날짜 + 완료여부 한 줄 */}
                  <Td className="p-0">
                    <div className="flex h-full min-h-[30px] items-stretch">
                      <div className="flex min-w-0 flex-1 items-center px-1.5 py-1">
                        {textCell("completeYmd", { date: true })}
                      </div>
                      <div
                        className={cn(
                          "flex shrink-0 items-center justify-center border-l border-border px-1.5 text-[11px] font-medium",
                          isEditing ? "gap-1" : "min-w-[2.75rem]"
                        )}
                      >
                        {isEditing ? (
                          <label className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-foreground">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 shrink-0 accent-primary"
                              checked={current.completeYn === "Y"}
                              onChange={(e) => setField("completeYn", e.target.checked ? "Y" : "N")}
                            />
                            완료여부
                          </label>
                        ) : current.completeYn === "Y" ? (
                          COLS.completeYn.label
                        ) : null}
                      </div>
                    </div>
                  </Td>
                </tr>
                <tr>
                  {/* 위치 칸 오른쪽 끝 = «완료(예정)일자» 제목 칸 끝 */}
                  <Th>{COLS.location.label}</Th>
                  <Td colSpan={2} className={cn(isEditing && "relative z-20 overflow-visible")}>
                    {isEditing ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <AddressSearchPanel
                            key={locationInputSession}
                            layout="field"
                            compact
                            vworldApiKey={vworldApiKey}
                            initialQuery={draft.location}
                            placeholder="주소/지번 검색"
                            onSelect={applyLocationFromSearch}
                            onQueryChange={(q) => setField("location", q)}
                            onClear={() => setField("location", "")}
                          />
                        </div>
                        <button
                          type="button"
                          className={cn(locationPickBtn, picking && locationPickBtnActive)}
                          onClick={() => setPicking((v) => !v)}
                          title="지도에서 위치 찍기"
                          aria-label="지도에서 위치 찍기"
                          aria-pressed={picking}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="block whitespace-normal break-keep [overflow-wrap:anywhere]">
                        {current.location || "-"}
                      </span>
                    )}
                  </Td>
                  <Td className="p-0">
                    <div className="flex h-full min-h-[30px] items-stretch">
                      <div
                        className={cn(
                          thClass,
                          "flex w-[4.25rem] shrink-0 items-center justify-center border-0 border-r border-border"
                        )}
                      >
                        {COLS.recurrence.label}
                      </div>
                      <div className="flex min-w-0 flex-1 items-center px-1.5 py-1">
                        {textCell("recurrence", { options: RIVER_ILLEGAL_RECURRENCE_OPTIONS })}
                      </div>
                    </div>
                  </Td>
                </tr>
                <tr>
                  <Th>{COLS.actor.label}</Th>
                  <Td colSpan={3}>{linesCell("actor")}</Td>
                </tr>
              </tbody>
            </table>

            <StatusTable card={current} editing={isEditing} onChange={setStatus} />

            <table className={formTableClass}>
              <colgroup>
                <col style={{ width: FORM_LABEL_W }} />
                <col />
              </colgroup>
              <tbody>
                {MULTILINE_ROWS.map((key) => (
                  <tr key={key}>
                    <Th>{COLS[key].label}</Th>
                    <Td>{linesCell(key)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className={formTableClass}>
              <colgroup>
                <col />
                <col />
              </colgroup>
              <tbody>
                {PHOTO_ROWS.map((fields) => (
                  <PhotoRow
                    key={fields.join("-")}
                    fields={fields}
                    card={current}
                    editing={isEditing}
                    capturing={capturing}
                    onAdd={openPhotoPicker}
                    onRemove={removePhoto}
                    onPreview={openPreview}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handlePickPhoto(e.target.files);
            e.target.value = "";
          }}
        />
      </MapSideDetailScroll>
      {preview ? (
        <ServiceFileImagePreview items={preview.items} initialIndex={preview.index} onClose={() => setPreview(null)} />
      ) : null}
      {picking && isEditing && map?.getTargetElement()?.parentElement
        ? createPortal(
            <div
              className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/80 dark:text-red-300"
              style={{
                left: pickBannerCenter ? pickBannerCenter.x : "50%",
                top: inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
              }}
            >
              <span className="whitespace-nowrap">지도에서 위치를 찍어 주세요.</span>
              <button
                type="button"
                className={layerRowPanelButtonClass("default", "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50")}
                onClick={() => setPicking(false)}
              >
                찍기 취소
              </button>
            </div>,
            map.getTargetElement()!.parentElement!
          )
        : null}
    </div>
  );
}

/** 조치현황 — 접도구역 건축물 «건축물(공작물) 내용»처럼 본 표에 이어 붙인 칸 (구분 × 시설 종류) */
function StatusTable({
  card,
  editing,
  onChange,
}: {
  card: RiverIllegalOccupationCard;
  editing: boolean;
  onChange: (kind: RiverIllegalStatusKindKey, row: RiverIllegalStatusRowKey, value: string) => void;
}) {
  return (
    <table className={formTableClass}>
      <colgroup>
        <col style={{ width: FORM_LABEL_W }} />
        <col style={{ width: "2.75rem" }} />
        <col style={{ width: "2.5rem" }} />
        {RIVER_ILLEGAL_STATUS_KINDS.map((k) => (
          <col key={k.key} />
        ))}
      </colgroup>
      <tbody>
        <tr>
          <Th rowSpan={1 + RIVER_ILLEGAL_STATUS_ROWS.length}>조치현황</Th>
          <Th className="px-0.5 text-[10px]">구분</Th>
          <Th className="px-0.5 text-[10px]">합계</Th>
          {RIVER_ILLEGAL_STATUS_KINDS.map((k) => (
            <Th key={k.key} className="px-0.5 text-[10px]">
              {splitRiverIllegalKindLabel(k.label).map((part, i) => (
                <span key={i} className="block whitespace-nowrap">
                  {part}
                </span>
              ))}
            </Th>
          ))}
        </tr>
        {RIVER_ILLEGAL_STATUS_ROWS.map((row) => {
          const total = riverIllegalStatusTotal(card.status, row.key);
          /** 적발 합계만 검정, 조치·미조치 합계는 빨강 */
          const totalRed = row.key !== "detected";
          return (
            <tr key={row.key}>
              <Th className="px-0.5 text-[10px] font-medium">{row.label}</Th>
              <Td
                className={cn(
                  "px-0.5 text-center font-medium tabular-nums",
                  totalRed && "text-red-600"
                )}
              >
                {total > 0 ? total : ""}
              </Td>
              {RIVER_ILLEGAL_STATUS_KINDS.map((k) => {
                const value = card.status[k.key]?.[row.key] ?? "";
                return (
                  <Td key={k.key} className="px-0.5 text-center tabular-nums">
                    {editing ? (
                      <input
                        inputMode="text"
                        aria-label={`${k.label} ${row.label}`}
                        title="숫자와 # 만 (#1# 이면 빨간 숫자)"
                        className="h-[22px] w-full min-w-0 border-0 bg-transparent p-0 text-center text-[11px] tabular-nums outline-none focus:bg-primary/10"
                        value={value}
                        onChange={(e) => onChange(k.key, row.key, e.target.value)}
                      />
                    ) : (
                      <RedMarkupText value={value} />
                    )}
                  </Td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 사진 두 칸 + 아래 «<위치도>» 같은 이름 칸 */
function PhotoRow({
  fields,
  card,
  editing,
  capturing,
  onAdd,
  onRemove,
  onPreview,
}: {
  fields: [PhotoField, PhotoField];
  card: RiverIllegalOccupationCard;
  editing: boolean;
  capturing: boolean;
  onAdd: (field: PhotoField) => void;
  onRemove: (field: PhotoField) => void;
  onPreview: (field: PhotoField) => void;
}) {
  return (
    <>
      <tr>
        {fields.map((key) => (
          <td key={key} className={cn(tdClass, "h-[11rem] p-0")}>
            <PhotoSlot
              key={card[key]}
              url={card[key]}
              editing={editing}
              uploadable={key !== "locationMapUrl"}
              capturing={key === "locationMapUrl" && capturing}
              emptyHint={key === "locationMapUrl" ? "위치를 주소로 고르거나 지도에 찍으면 들어갑니다" : undefined}
              onAdd={() => onAdd(key)}
              onRemove={() => onRemove(key)}
              onPreview={() => onPreview(key)}
            />
          </td>
        ))}
      </tr>
      <tr>
        {fields.map((key) => (
          <Th key={key} className="h-[26px]">
            &lt;{COLS[key].label}&gt;
          </Th>
        ))}
      </tr>
    </>
  );
}
