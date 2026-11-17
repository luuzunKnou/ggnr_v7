"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileDown, ImageOff, Loader2, MapPin, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import { useSerWriteAccess } from "@/hooks/useSerWriteAccess";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { AddressSearchPanel } from "../../../_mapComponents/addressSearch/AddressSearchPanel";
import {
  getAddressFromCoord,
  type VWorldAddressItem,
} from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import {
  isImageServiceFileName,
  requestServiceFileDataDelete,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from "../../../_mapComponents/standard/useServiceFileData";
import { layerRowPanelButtonClass } from "../../../_mapComponents/layerRowEdit/layerRowPanelButtonStyles";
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel";
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from "../../../searchBarOffsetContext";
import { useRiverIllegalOccupationMapLocation } from "./useRiverIllegalOccupationMapLocation";
import { useRiverIllegalOccupationPointPick } from "./useRiverIllegalOccupationPointPick";
import { refreshRiverIllegalOccupationMap } from "./riverIllegalOccupationMapSync";
import {
  RIVER_ILLEGAL_OCCUPATION_COLUMNS as COLS,
  RIVER_ILLEGAL_RECURRENCE_OPTIONS,
  RIVER_ILLEGAL_RIVER_TYPES,
  RIVER_ILLEGAL_STATUS_KINDS,
  RIVER_ILLEGAL_STATUS_ROWS,
  type RiverIllegalOccupationFieldKey,
  type RiverIllegalPhotoField,
  type RiverIllegalStatusKindKey,
  type RiverIllegalStatusRowKey,
} from "./riverIllegalOccupationConfig";
import {
  RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
  RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
  RIVER_ILLEGAL_PHOTO_SLOTS,
  resolveRiverIllegalPhoto,
  riverIllegalFileKey,
  riverIllegalFileKeyLegacy,
  riverIllegalNamedPhotoFile,
} from "./riverIllegalOccupationFiles";
import { captureLocationMapWithPoint } from "../../road/roadFrontageBuilding/roadFrontageBuildingLocationCapture";
import {
  createEmptyRiverIllegalOccupationCard,
  deleteRiverIllegalOccupationCard,
  isNewRiverIllegalOccupationId,
  riverIllegalLinesToText,
  riverIllegalStatusTotalMarked,
  riverIllegalTextToLines,
  saveRiverIllegalOccupationCard,
  splitRiverIllegalLines,
  useRiverIllegalOccupationCards,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import {
  formatRiverIllegalCardDate,
  parseRiverIllegalRedMarkup,
  sanitizeRiverIllegalStatusDigits,
  splitRiverIllegalKindLabel,
} from "./riverIllegalOccupationFormat";
import {
  downloadRiverIllegalOccupationCardPdf,
  printRiverIllegalOccupationCard,
} from "./riverIllegalOccupationPrint";
import {
  riverIllegalColumnLabel,
  useRiverIllegalOccupationFieldLabels,
} from "./useRiverIllegalOccupationFieldLabels";

/** 사진·위치도 변경 후 단건 PDF 캐시 백그라운드 갱신 */
function scheduleCardPdfCacheRefresh(id: string | null | undefined) {
  const key = String(id ?? "").trim();
  if (!key || isNewRiverIllegalOccupationId(key)) return;
  void call("", "POST", {
    service: "riverIllegalOccupationService",
    action: "refreshPdfCache",
    params: { id: key },
  }).catch(() => undefined);
}

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

/** 사진 불러오기 실패 시 다시 시도 간격(ms) — 다 쓰면 «불러올 수 없습니다» */
const PHOTO_RETRY_DELAYS_MS = [1500, 4000, 10000];

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

type PhotoField = RiverIllegalPhotoField;

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

/** 조회 — «@» 줄마다 한 줄 (bullet 항목은 «▸»), #…# 은 빨강(▸도 같이) */
function LinesView({ value, bullet }: { value: string; bullet: boolean }) {
  const lines = splitRiverIllegalLines(value);
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5">
      {lines.map((line, i) => {
        const hasRed = parseRiverIllegalRedMarkup(line).some((p) => p.red);
        return (
          <li key={i} className="flex min-w-0 gap-1 break-all">
            {bullet ? (
              <span className={cn("shrink-0", hasRed ? "text-red-600" : "text-muted-foreground")}>▸</span>
            ) : null}
            <RedMarkupText value={line} className="min-w-0" />
          </li>
        );
      })}
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
      onChange={(e) => {
        setText(e.target.value);
        onChange(riverIllegalTextToLines(e.target.value));
      }}
    />
  );
}

/**
 * 사진 한 칸 — file_data 첨부. 수정 중 «등록»·«바꾸기»·«삭제»
 */
function PhotoSlot({
  url,
  editing,
  uploading,
  emptyHint,
  onAdd,
  onRemove,
  onPreview,
}: {
  url: string;
  editing: boolean;
  uploading?: boolean;
  emptyHint?: string;
  onAdd: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const baseSrc = url.trim();
  /** 서버가 PDF 준비 등으로 바쁠 때 실패할 수 있어 잠시 뒤 다시 불러옴 */
  const [loadState, setLoadState] = useState({ src: baseSrc, attempt: 0, failed: false, waiting: false });
  if (loadState.src !== baseSrc) setLoadState({ src: baseSrc, attempt: 0, failed: false, waiting: false });
  const same = loadState.src === baseSrc;
  const failed = same && loadState.failed;
  const waiting = same && loadState.waiting;
  const attempt = same ? loadState.attempt : 0;
  const src =
    baseSrc && attempt > 0 ? `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}retry=${attempt}` : baseSrc;
  const handleImgError = () => {
    if (attempt >= PHOTO_RETRY_DELAYS_MS.length) {
      setLoadState({ src: baseSrc, attempt, failed: true, waiting: false });
      return;
    }
    setLoadState({ src: baseSrc, attempt, failed: false, waiting: true });
    window.setTimeout(() => {
      setLoadState((prev) =>
        prev.src === baseSrc ? { ...prev, attempt: prev.attempt + 1, waiting: false } : prev
      );
    }, PHOTO_RETRY_DELAYS_MS[attempt]!);
  };
  const showImg = Boolean(src) && !failed && !waiting && !uploading;
  const canPick = editing && !src && !uploading;
  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-background", (showImg || canPick) && "cursor-pointer")}
      title={showImg ? "크게 보기" : undefined}
      onClick={showImg ? onPreview : canPick ? onAdd : undefined}
    >
      {uploading || waiting ? (
        <div className="flex h-full items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {uploading ? "올리는 중…" : "사진 불러오는 중…"}
        </div>
      ) : showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-1.5 h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)] object-cover" onError={handleImgError} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-muted-foreground">
          <ImageOff className="h-4 w-4 opacity-60" aria-hidden />
          {src ? "사진을 불러올 수 없습니다" : editing ? emptyHint || "눌러서 사진 등록" : "사진 없음"}
        </div>
      )}
      {editing && !uploading ? (
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
  const fieldLabels = useRiverIllegalOccupationFieldLabels();
  const canWrite = useSerWriteAccess();
  const isCreateMode = isNewRiverIllegalOccupationId(cardId);
  const saved = isCreateMode ? null : (cards.find((c) => c.id === cardId) ?? null);
  const L = (key: RiverIllegalOccupationFieldKey) => riverIllegalColumnLabel(fieldLabels, key);

  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [draft, setDraft] = useState<RiverIllegalOccupationCard>(
    () => saved ?? createEmptyRiverIllegalOccupationCard()
  );
  /** 수정 진입마다 여러 줄 입력칸을 새 값으로 다시 그림 */
  const [editSession, setEditSession] = useState(0);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploadingField, setUploadingField] = useState<PhotoField | null>(null);
  const [attachRefreshNonce, setAttachRefreshNonce] = useState(0);
  /** 지도에서 찍어 주소를 채우면 위치 검색칸을 새 주소로 다시 그림 */
  const [locationInputSession, setLocationInputSession] = useState(0);
  const [preview, setPreview] = useState<{ items: ServiceFilePreviewItem[]; index: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoSlotRef = useRef<PhotoField | null>(null);
  const locationCaptureSeqRef = useRef(0);
  const mgmtKeyRef = useRef("");
  const isCreateModeRef = useRef(isCreateMode);
  /** 추가 화면에서 올린 위치도 — 취소·닫기 시 삭제, 등록 성공 시 유지 */
  const createSessionLocationMapRef = useRef<{ key: string; fileName: string } | null>(null);
  const photoResolvedRef = useRef<Record<PhotoField, ReturnType<typeof resolveRiverIllegalPhoto>> | null>(
    null
  );
  const { upload: uploadChunked } = useServiceFileChunkedUpload();

  isCreateModeRef.current = isCreateMode;

  const current = isEditing ? draft : (saved ?? draft);
  const mgmtKey = riverIllegalFileKey(current.mgmtNo);
  const mgmtKeyLegacy = riverIllegalFileKeyLegacy(current.mgmtNo);
  const useLegacyFolder = Boolean(mgmtKey && mgmtKeyLegacy && mgmtKey !== mgmtKeyLegacy);
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const pickBannerCenter = useMapVisualCenterPixel(map, picking, mapPaddingLeft);

  useRiverIllegalOccupationMapLocation({ key: cardId, lon: current.lon, lat: current.lat }, !picking);

  mgmtKeyRef.current = mgmtKey;

  /** 신규 — 관리번호 자동채번 (필수·읽기전용) */
  useEffect(() => {
    if (!isCreateMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await call("", "POST", {
          service: "riverIllegalOccupationService",
          action: "nextMgmtNo",
          params: {},
        });
        const data = res?.data ?? res;
        const mgmtNo = String(data?.mgmtNo ?? "").trim();
        if (!mgmtNo || cancelled) return;
        setDraft((prev) => (prev.mgmtNo.trim() ? prev : { ...prev, mgmtNo }));
      } catch {
        /* 저장 시 서버에서 다시 채번 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreateMode]);

  /** 신규 폴더(HCBJ_…) + 구형(HCBJ…) 둘 다 조회 — 폴더 rename 전후 호환 */
  const attachPrimary = useServiceFileData({
    serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
    enabled: Boolean(mgmtKey),
    layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
    keyValue: mgmtKey || null,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });
  const attachLegacy = useServiceFileData({
    serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
    enabled: useLegacyFolder,
    layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
    keyValue: useLegacyFolder ? mgmtKeyLegacy : null,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });

  const photoResolved = useMemo(() => {
    const out = {} as Record<PhotoField, ReturnType<typeof resolveRiverIllegalPhoto>>;
    for (const f of PHOTO_FIELDS) {
      out[f] = resolveRiverIllegalPhoto(
        mgmtKey,
        attachPrimary.files,
        useLegacyFolder ? mgmtKeyLegacy : null,
        attachLegacy.files,
        f
      );
    }
    return out;
  }, [attachPrimary.files, attachLegacy.files, mgmtKey, mgmtKeyLegacy, useLegacyFolder]);

  const photoUrls = useMemo(() => {
    const out = {} as Record<PhotoField, string>;
    for (const f of PHOTO_FIELDS) {
      const base = photoResolved[f]?.url ?? "";
      if (!base) {
        out[f] = "";
        continue;
      }
      // 같은 파일명으로 위치도 교체 시 브라우저 캐시 방지
      const mod = photoResolved[f]?.file.modified;
      const v = mod != null && String(mod) ? String(mod) : String(attachRefreshNonce);
      out[f] = `${base}${base.includes("?") ? "&" : "?"}v=${encodeURIComponent(v)}`;
    }
    return out;
  }, [photoResolved, attachRefreshNonce]);

  photoResolvedRef.current = photoResolved;

  const displayCard = useMemo(
    () => ({
      ...current,
      locationMapUrl: photoUrls.locationMapUrl,
      photo1Url: photoUrls.photo1Url,
      photo2Url: photoUrls.photo2Url,
      completePhotoUrl: photoUrls.completePhotoUrl,
    }),
    [current, photoUrls]
  );

  /** 위치 좌표 → 지도 화면을 위치도 첨부 파일로 저장(이미 있으면 교체) */
  const captureAndUploadLocationMap = useCallback(
    async (lon: number, lat: number) => {
      const mapInst = mapContext?.mapInstanceRef?.current ?? null;
      if (!mapInst) return;
      // 신규 채번 직후 키 반영 대기
      let key = mgmtKeyRef.current;
      if (!key) {
        for (let i = 0; i < 20 && !key; i++) {
          await new Promise((r) => window.setTimeout(r, 100));
          key = mgmtKeyRef.current;
        }
      }
      if (!key) {
        window.alert("관리번호가 아직 없습니다. 잠시 후 위치를 다시 지정해 주세요.");
        return;
      }
      const seq = (locationCaptureSeqRef.current += 1);
      setUploadingField("locationMapUrl");
      try {
        const backgroundId = mapContext?.mapBackgroundMapIdRef?.current;
        const raw = await captureLocationMapWithPoint(mapInst, { lon, lat }, backgroundId);
        if (seq !== locationCaptureSeqRef.current) return;
        if (!raw) {
          window.alert("위치도를 담지 못했습니다. 위치를 다시 지정해 주세요.");
          return;
        }
        const named = riverIllegalNamedPhotoFile(raw, key, "locationMapUrl");
        // 이전 위치도 제거(목록 반영 전·세션 추적분 포함)
        const existing = photoResolvedRef.current?.locationMapUrl;
        const sessionPrev = createSessionLocationMapRef.current;
        const toDelete: { key: string; fileName: string }[] = [];
        if (existing) toDelete.push({ key: existing.key, fileName: existing.file.name });
        if (
          sessionPrev &&
          !toDelete.some((d) => d.key === sessionPrev.key && d.fileName === sessionPrev.fileName)
        ) {
          toDelete.push(sessionPrev);
        }
        for (const d of toDelete) {
          await requestServiceFileDataDelete({
            serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
            layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
            keyValue: d.key,
            fileName: d.fileName,
          });
        }
        if (seq !== locationCaptureSeqRef.current) return;
        const result = await uploadChunked({
          file: named,
          serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
          layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
          keyValue: key,
        });
        if (seq !== locationCaptureSeqRef.current) return;
        if (result?.error) {
          window.alert(result.error);
          return;
        }
        if (isCreateModeRef.current) {
          createSessionLocationMapRef.current = { key, fileName: named.name };
        } else {
          scheduleCardPdfCacheRefresh(cardId);
        }
        setAttachRefreshNonce((n) => n + 1);
      } catch (e: unknown) {
        if (seq === locationCaptureSeqRef.current) {
          window.alert(e instanceof Error ? e.message : "위치도 저장에 실패했습니다.");
        }
      } finally {
        if (seq === locationCaptureSeqRef.current) setUploadingField(null);
      }
    },
    [mapContext, uploadChunked, cardId]
  );

  const discardCreateSessionLocationMap = useCallback(async () => {
    const hit = createSessionLocationMapRef.current;
    createSessionLocationMapRef.current = null;
    if (!hit) return;
    locationCaptureSeqRef.current += 1;
    await requestServiceFileDataDelete({
      serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
      layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
      keyValue: hit.key,
      fileName: hit.fileName,
    }).catch(() => undefined);
  }, []);

  const closeCreateOrDetail = useCallback(() => {
    if (isCreateMode) {
      void discardCreateSessionLocationMap().finally(() => onClose());
      return;
    }
    onClose();
  }, [isCreateMode, discardCreateSessionLocationMap, onClose]);

  /** 지도에 점을 찍으면 좌표 → 지번 주소 + 위치도 캡처 */
  const handlePointPicked = useCallback(
    (lon: number, lat: number) => {
      setPicking(false);
      setDraft((prev) => ({ ...prev, lon: String(lon), lat: String(lat) }));
      void (async () => {
        try {
          const addr = vworldApiKey
            ? await getAddressFromCoord(lon, lat, { apiKey: vworldApiKey, type: "PARCEL" })
            : null;
          const text = String(addr?.jibun ?? "").trim() || String(addr?.road ?? "").trim();
          if (text) {
            setDraft((prev) => ({ ...prev, location: text }));
            setLocationInputSession((n) => n + 1);
          }
        } catch {
          /* 주소 실패해도 좌표·위치도는 유지 */
        }
        await captureAndUploadLocationMap(lon, lat);
      })();
    },
    [vworldApiKey, captureAndUploadLocationMap]
  );

  const handlePickBlocked = useCallback(() => setPicking(false), []);
  useRiverIllegalOccupationPointPick(isEditing && picking, handlePointPicked, handlePickBlocked);

  const previewItems = useMemo(
    () =>
      PHOTO_FIELDS.filter((f) => photoUrls[f].trim()).map((f) => ({
        field: f,
        item: {
          url: photoUrls[f],
          fileName: RIVER_ILLEGAL_PHOTO_SLOTS[f].label,
          kind: "image",
        } as ServiceFilePreviewItem,
      })),
    [photoUrls]
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
    // 화면에는 숫자만. 조치·미조치는 저장값 `#N#`(빨간 표시용)
    const digits = sanitizeRiverIllegalStatusDigits(raw);
    const value =
      row === "acted" || row === "notActed" ? (digits ? `#${digits}#` : "") : digits;
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
    setUploadingField(null);
    setPicking(false);
    if (isCreateMode) {
      void discardCreateSessionLocationMap().finally(() => onClose());
      return;
    }
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!draft.mgmtNo.trim()) {
      window.alert("관리번호가 없습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (!draft.serialNo.trim()) {
      window.alert("연번을 입력하세요.");
      return;
    }
    void (async () => {
      try {
        const id = await saveRiverIllegalOccupationCard(draft);
        // 등록 성공 — 위치도 유지
        createSessionLocationMapRef.current = null;
        setPicking(false);
        setIsEditing(false);
        refreshRiverIllegalOccupationMap(mapContext?.mapInstanceRef?.current);
        onSaved(id);
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : "저장에 실패했습니다.");
      }
    })();
  };

  const handleDelete = () => {
    if (!saved) return;
    if (!window.confirm("이 관리카드를 삭제하시겠습니까?")) return;
    void (async () => {
      try {
        await deleteRiverIllegalOccupationCard(saved.id);
        refreshRiverIllegalOccupationMap(mapContext?.mapInstanceRef?.current);
        onDeleted();
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      }
    })();
  };

  /** 위치 주소 선택 → 주소·좌표 + 위치도 캡처 */
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
    if (hasPoint) void captureAndUploadLocationMap(lon, lat);
  };

  const openPreview = (field: PhotoField) => {
    const index = previewItems.findIndex((p) => p.field === field);
    if (index < 0) return;
    setPreview({ items: previewItems.map((p) => p.item), index });
  };

  const openPhotoPicker = (field: PhotoField) => {
    if (!mgmtKey) {
      window.alert("관리번호가 아직 없습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    photoSlotRef.current = field;
    photoInputRef.current?.click();
  };

  const handlePickPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    const field = photoSlotRef.current;
    photoSlotRef.current = null;
    if (!file || !field) return;
    if (!isImageServiceFileName(file.name) && !file.type.startsWith("image/")) {
      window.alert("그림 파일만 등록할 수 있습니다.");
      return;
    }
    if (!mgmtKey) {
      window.alert("관리번호가 없습니다.");
      return;
    }
    const named = riverIllegalNamedPhotoFile(file, mgmtKey, field);
    setUploadingField(field);
    try {
      const existing = photoResolved[field];
      if (existing) {
        await requestServiceFileDataDelete({
          serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
          layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
          keyValue: existing.key,
          fileName: existing.file.name,
        });
      }
      const result = await uploadChunked({
        file: named,
        serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
        layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
        keyValue: mgmtKey,
      });
      if (result?.error) {
        window.alert(result.error);
        return;
      }
      setAttachRefreshNonce((n) => n + 1);
      if (!isCreateMode) scheduleCardPdfCacheRefresh(cardId);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "사진 업로드에 실패했습니다.");
    } finally {
      setUploadingField(null);
    }
  };

  const removePhoto = (field: PhotoField) => {
    if (!mgmtKey) return;
    const hit = photoResolved[field];
    if (!hit) return;
    if (!window.confirm(`${RIVER_ILLEGAL_PHOTO_SLOTS[field].label} 사진을 삭제할까요?`)) return;
    void (async () => {
      const res = await requestServiceFileDataDelete({
        serEng: RIVER_ILLEGAL_OCCUPATION_FILE_SER_ENG,
        layerSegment: RIVER_ILLEGAL_OCCUPATION_FILE_LAYER,
        keyValue: hit.key,
        fileName: hit.file.name,
      });
      if (!res.ok) {
        window.alert(res.error);
        return;
      }
      setAttachRefreshNonce((n) => n + 1);
      if (!isCreateMode) scheduleCardPdfCacheRefresh(cardId);
    })();
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
            <button type="button" className={actionBtn} onClick={() => void printRiverIllegalOccupationCard(displayCard)}>
              <Printer className="h-3 w-3" />
              인쇄
            </button>
          ) : null}
          {!isEditing ? (
            <button
              type="button"
              className={actionBtn}
              disabled={pdfSaving}
              title="인쇄와 같은 서식으로 PDF 파일이 바로 저장됩니다"
              onClick={() => {
                if (pdfSaving) return;
                setPdfSaving(true);
                void downloadRiverIllegalOccupationCardPdf(displayCard)
                  .catch((e: unknown) =>
                    window.alert(e instanceof Error ? e.message : "PDF 저장에 실패했습니다.")
                  )
                  .finally(() => setPdfSaving(false));
              }}
            >
              {pdfSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
              {pdfSaving ? "PDF 준비 중…" : "PDF 저장"}
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
                <button
                  type="button"
                  className={actionBtnPrimary}
                  onClick={handleSave}
                  disabled={Boolean(uploadingField) || !draft.mgmtNo.trim()}
                >
                  {isCreateMode ? "등록" : "저장"}
                </button>
              </>
            )
          ) : null}
          <button
            type="button"
            onClick={closeCreateOrDetail}
            className="standard-panel-close"
            title="상세 닫기"
            aria-label="상세 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <MapSideDetailScroll className="standard-detail-scroll">
        {isEditing ? (
          <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
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
                  <Th>{L("mgmtNo")}</Th>
                  <Td>
                    {isEditing ? (
                      <input
                        type="text"
                        readOnly
                        required
                        className={cn(fieldClass, "bg-muted/50 text-muted-foreground")}
                        value={current.mgmtNo}
                        title="자동 생성 · 읽기 전용"
                        aria-label={`${L("mgmtNo")} (자동 생성)`}
                      />
                    ) : (
                      <span className="block truncate text-center" title={current.mgmtNo || undefined}>
                        {current.mgmtNo || "-"}
                      </span>
                    )}
                  </Td>
                  <Th>{L("riverType")}</Th>
                  <Td>{textCell("riverType", { options: RIVER_ILLEGAL_RIVER_TYPES })}</Td>
                </tr>
                <tr>
                  <Th>{L("serialNo")}</Th>
                  <Td colSpan={3}>{textCell("serialNo")}</Td>
                </tr>
                <tr>
                  <Th>{L("firstCheckYmd")}</Th>
                  <Td>{textCell("firstCheckYmd", { date: true })}</Td>
                  <Th>{L("completeYmd")}</Th>
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
                          L("completeYn")
                        ) : null}
                      </div>
                    </div>
                  </Td>
                </tr>
                <tr>
                  {/* 위치 칸 오른쪽 끝 = «완료(예정)일자» 제목 칸 끝 */}
                  <Th>{L("location")}</Th>
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
                        {L("recurrence")}
                      </div>
                      <div className="flex min-w-0 flex-1 items-center px-1.5 py-1">
                        {textCell("recurrence", { options: RIVER_ILLEGAL_RECURRENCE_OPTIONS })}
                      </div>
                    </div>
                  </Td>
                </tr>
                <tr>
                  <Th>{L("actor")}</Th>
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
                    <Th>{L(key)}</Th>
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
                    urls={photoUrls}
                    editing={isEditing}
                    uploadingField={uploadingField}
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

/** 조치현황 — 구분 × 시설 종류 + 합계(항목 합산). 제목은 config 고정 */
function StatusTable({
  card,
  editing,
  onChange,
}: {
  card: RiverIllegalOccupationCard;
  editing: boolean;
  onChange: (kind: RiverIllegalStatusKindKey, row: RiverIllegalStatusRowKey, value: string) => void;
}) {
  const totHeader = "합계";

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
          <Th className="px-0.5 text-[10px]">{totHeader}</Th>
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
          const rLabel = row.label;
          const totalValue = riverIllegalStatusTotalMarked(card.status, row.key);
          return (
            <tr key={row.key}>
              <Th className="px-0.5 text-[10px] font-medium">{rLabel}</Th>
              <Td className="px-0.5 text-center font-medium tabular-nums">
                {totalValue ? <RedMarkupText value={totalValue} /> : null}
              </Td>
              {RIVER_ILLEGAL_STATUS_KINDS.map((k) => {
                const value = card.status[k.key]?.[row.key] ?? "";
                // 입력·표시 모두 # 없이 숫자만 (#는 DB·빨간 표시용)
                const inputDigits = value.replace(/[^0-9]/g, "");
                return (
                  <Td key={k.key} className="px-0.5 text-center tabular-nums">
                    {editing ? (
                      <input
                        inputMode="numeric"
                        aria-label={`${k.label} ${rLabel}`}
                        title="숫자만"
                        className="h-[22px] w-full min-w-0 border-0 bg-transparent p-0 text-center text-[11px] tabular-nums outline-none focus:bg-primary/10"
                        value={inputDigits}
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
  urls,
  editing,
  uploadingField,
  onAdd,
  onRemove,
  onPreview,
}: {
  fields: [PhotoField, PhotoField];
  urls: Record<PhotoField, string>;
  editing: boolean;
  uploadingField: PhotoField | null;
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
              key={urls[key] || key}
              url={urls[key]}
              editing={editing}
              uploading={uploadingField === key}
              emptyHint={`눌러서 ${RIVER_ILLEGAL_PHOTO_SLOTS[key].label} 등록`}
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
            &lt;{RIVER_ILLEGAL_PHOTO_SLOTS[key].label}&gt;
          </Th>
        ))}
      </tr>
    </>
  );
}
