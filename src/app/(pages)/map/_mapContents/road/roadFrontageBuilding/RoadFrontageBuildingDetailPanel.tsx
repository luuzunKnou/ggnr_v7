'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { Check, CircleAlert, Download, Loader2, Minus, Paperclip, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { call } from '@/lib/api';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { cn } from '@/lib/utils';
import { AddressSearchPanel } from '../../../_mapComponents/addressSearch/AddressSearchPanel';
import type { VWorldAddressItem } from '../../../_mapComponents/addressSearch/vworldAddressSearch';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../../_mapComponents/standard/ServiceFileImagePreview';
import {
  isImageServiceFileName,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
  withServiceFileThumbQuery,
} from '../../../_mapComponents/standard/useServiceFileData';
import {
  deleteFolderFiles,
  firstFolderImageUrl,
  ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER,
  ROAD_FRONTAGE_BUILDING_FILE_LAYER,
  ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
  ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS,
  roadFrontageBuildingFileUrl,
} from './roadFrontageBuildingFiles';
import {
  ROAD_FRONTAGE_BUILDING_BAD_MARKS,
  ROAD_FRONTAGE_BUILDING_LOCATION_KINDS,
  ROAD_FRONTAGE_BUILDING_NEW_ID,
  ROAD_FRONTAGE_BUILDING_ROAD_TYPES,
  createEmptyRoadFrontageBuildingConfirm,
  createEmptyRoadFrontageBuildingDetail,
  createEmptyRoadFrontageBuildingLedger,
  emptyRoadFrontageBuildingFormAttachShotDates,
  emptyRoadFrontageBuildingFormAttaches,
  formatRoadFrontageBuildingWrittenAt,
  formatRouteNoName,
  detailLocationCellDisplay,
  detailLocationFieldValue,
  flagsFromLocationKind,
  isNewRoadFrontageBuildingId,
  ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
  type RoadFrontageBuildingConfirmItem,
  type RoadFrontageBuildingDetailItem,
  type RoadFrontageBuildingFormAttachId,
  type RoadFrontageBuildingLedger,
  type RoadFrontageBuildingLocationKind,
} from './roadFrontageBuildingMock';
import { printRoadFrontageBuildingForm } from './roadFrontageBuildingPrint';
import { captureLocationMapWithPoint } from './roadFrontageBuildingLocationCapture';
import { useRoadFrontageBuildingMapHighlight } from './useRoadFrontageBuildingMapHighlight';

const FORM_ATTACH_SLOTS: RoadFrontageBuildingFormAttachId[] = [
  'locationMap',
  'layoutPlan',
  'before',
  'after',
];
const FORM_SLOT_LABEL: Record<RoadFrontageBuildingFormAttachId, string> = {
  locationMap: '위치도',
  layoutPlan: '건축물',
  before: '종전',
  after: '변경',
};

const fieldClass =
  'h-[20px] w-full min-w-0 border-0 bg-transparent px-0.5 text-[11px] leading-none text-foreground outline-none focus:bg-muted/50';
/** type=date 는 leading-none·기본 달력 아이콘 때문에 연·월·일이 잘려 별도 보정 */
const dateFieldClass = `${fieldClass} input-date-compact`;
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50';
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';
const btnDanger =
  'inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-background px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40';
const BORDER = 'border-[1px] border-solid border-foreground/80';
const FORM_TH_BG = 'bg-muted';
const PAPER_SIZE_LABEL = '364mm × 257mm [백상지 200g/m²]';
/** 원본 서식 건축물 내용 칸 수 */
const FORM_DETAIL_MIN_ROWS = 5;
/** 원본 서식 확인 결과 칸 수 */
const FORM_CONFIRM_MIN_ROWS = 6;
const FORM_ROW_H = 'h-[26px]';
const FORM_CONFIRM_ROW_H = 'h-[36px]';
const FORM_DRAW_HEAD_H = 'h-7';
const FORM_ATTACH_BOX = '!h-[16rem] !max-h-[16rem] overflow-hidden';
const FORM_SIDE_W = '6.25rem';
const FORM_FIELD_LABEL_W = '6.25rem';
const FORM_FIELD_VALUE_W = '36%';
const FORM_RESIDENT_LABEL_W = '5.5rem';
const FORM_PREPARED_LABEL_W = '6rem';
/** type=date + 달력 아이콘이 일자까지 보이도록 (5.5rem이면 일·아이콘이 겹침) */
const FORM_PREPARED_VALUE_W = '8.25rem';
function callFailMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    const err = (e as { error?: unknown }).error;
    if (typeof err === 'string' && err.trim()) return err;
  }
  return fallback;
}

const formTableClass = 'w-full table-fixed border-collapse leading-none';
const thClass =
  `box-border ${BORDER} ${FORM_TH_BG} px-1 py-0.5 text-center align-middle text-[11px] font-semibold leading-tight text-foreground`;
const tdClass =
  `box-border ${FORM_ROW_H} ${BORDER} bg-background px-1 py-0.5 align-middle text-[11px] leading-tight text-foreground`;

function Th({
  children,
  className,
  colSpan,
  rowSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <th colSpan={colSpan} rowSpan={rowSpan} className={cn(thClass, className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  colSpan,
  rowSpan,
  onClick,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  onClick?: (e: MouseEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} onClick={onClick} className={cn(tdClass, className)}>
      {children}
    </td>
  );
}

function FormBodyColgroup() {
  return (
    <colgroup>
      <col style={{ width: FORM_SIDE_W }} />
      <col style={{ width: '9%' }} />
      {/* 설치 연월일: 날짜 입력이 들어가 다른 칸보다 넓게 */}
      <col style={{ width: '14%' }} />
      <col style={{ width: '9%' }} />
      <col style={{ width: '9%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '10%' }} />
      <col style={{ width: '10%' }} />
      <col />
    </colgroup>
  );
}

function SideTh({
  children,
  rowSpan,
  className,
}: {
  children: ReactNode;
  rowSpan: number;
  className?: string;
}) {
  return (
    <Th
      rowSpan={rowSpan}
      className={cn('break-keep px-0.5 text-[11px] font-semibold leading-tight', className)}
    >
      {children}
    </Th>
  );
}

function CrudBtn({
  kind,
  label,
  onClick,
}: {
  kind: 'plus' | 'minus';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {kind === 'plus' ? <Plus className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
    </button>
  );
}

type Props = {
  ledgerId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (id: string) => void;
  onDeleted?: () => void;
  overlayLeftPx: number;
  overlayWidthPx: number;
};

type ActionKind =
  | 'delete'
  | 'cancel'
  | 'notice'
  | 'success'
  | 'progress'
  | 'photoReplace'
  | 'photoRemove';

type ActionDialogState = {
  kind: ActionKind;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  slot?: RoadFrontageBuildingFormAttachId;
};

function ActionDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action: ActionDialogState;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const Icon =
    action.kind === 'progress'
      ? Loader2
      : action.kind === 'delete' || action.kind === 'photoRemove'
        ? Trash2
        : action.kind === 'notice'
          ? CircleAlert
          : Check;
  const iconWrap =
    action.kind === 'delete' || action.kind === 'photoRemove' || action.danger
      ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
      : action.kind === 'notice'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
        : action.kind === 'success'
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'bg-primary/10 text-primary';
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rfb-action-title"
        aria-describedby="rfb-action-desc"
        className="w-full max-w-[19rem] overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <div className="flex gap-3 px-4 py-3.5">
          <span
            className={cn(
              'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              iconWrap
            )}
          >
            <Icon className={cn('h-4 w-4', action.kind === 'progress' && 'animate-spin')} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p id="rfb-action-title" className="text-sm font-semibold text-foreground">
              {action.title}
            </p>
            <p id="rfb-action-desc" className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {action.message}
            </p>
          </div>
        </div>
        {action.kind === 'progress' ? (
          <div className="flex items-center justify-center gap-1.5 border-t border-border bg-muted px-3 py-2.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {action.confirmLabel}
          </div>
        ) : (
          <div className="flex justify-end gap-1.5 border-t border-border bg-muted px-3 py-2.5">
            {action.cancelLabel ? (
              <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>
                {action.cancelLabel}
              </button>
            ) : null}
            <button
              type="button"
              className={action.danger ? btnDanger : btnPrimary}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {action.confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatArea(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function dash(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return s;
}

function formatFormDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return dash(iso);
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
}

function formatShotDateKo(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return '\u00a0\u00a0 년 \u00a0\u00a0 월 \u00a0\u00a0 일';
  return `${m[1]} 년 ${Number(m[2])} 월 ${Number(m[3])} 일`;
}

function FormAttachPane({
  srcs,
  editing,
  onAdd,
  onRemove,
  picker = true,
  capturing = false,
  emptyHint,
}: {
  srcs: string[];
  editing: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  picker?: boolean;
  capturing?: boolean;
  emptyHint?: string;
}) {
  const main = srcs[0];
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [main]);
  const showImg = Boolean(main) && !imgFailed && !capturing;
  return (
    <div
      className="rfb-form-attach-pane relative h-full w-full overflow-hidden bg-background"
      onClick={editing && picker && !main ? onAdd : undefined}
    >
      {capturing ? (
        <div className="flex h-full items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          지도를 담는 중…
        </div>
      ) : showImg ? (
        <img
          src={main}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
          {editing ? emptyHint || (picker ? '등록' : '') : ''}
        </div>
      )}
      {editing && picker ? (
        <div className="absolute right-0.5 top-0.5 flex gap-0.5">
          <button
            type="button"
            title="등록"
            aria-label="등록"
            className="rounded bg-background/90 p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-3 w-3" />
          </button>
          {main ? (
            <button
              type="button"
              title="삭제"
              aria-label="삭제"
              className="rounded bg-background/90 p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(0);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CellValue({
  editing,
  value,
  nowrap,
  children,
}: {
  editing: boolean;
  value: string;
  nowrap?: boolean;
  children: ReactNode;
}) {
  if (editing) return <>{children}</>;
  return (
    <span
      className={cn(
        'block',
        nowrap ? 'truncate whitespace-nowrap' : 'whitespace-pre-wrap break-words'
      )}
      title={nowrap ? value : undefined}
    >
      {value}
    </span>
  );
}

function NameWithPhone({
  editing,
  name,
  phone,
  onName,
  onPhone,
}: {
  editing: boolean;
  name: string;
  phone: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            className={fieldClass}
            placeholder="성명"
            value={name}
            onChange={(e) => onName(e.target.value)}
          />
        ) : (
          <span className="block truncate">{dash(name)}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-foreground">
        <span>(전화번호:</span>
        {editing ? (
          <input
            className={cn(fieldClass, 'w-[5.5rem]')}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
          />
        ) : (
          <span>{dash(phone)}</span>
        )}
        <span>)</span>
      </div>
    </div>
  );
}

function SignSlot({ name }: { name?: string }) {
  return (
    <div className="relative min-w-0 overflow-hidden">
      <span className="block truncate px-1 pr-[4.2rem] text-center">{dash(name)}</span>
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center whitespace-nowrap text-[9px] leading-none text-muted-foreground">
        (서명 또는 인)
      </span>
    </div>
  );
}

function BadMarksCell({
  marks,
  editing,
  onToggle,
}: {
  marks: string[];
  editing?: boolean;
  onToggle?: (mark: string) => void;
}) {
  return (
    <div className="flex flex-nowrap items-center justify-center gap-x-1.5 text-[13px] leading-none text-foreground">
      {ROAD_FRONTAGE_BUILDING_BAD_MARKS.map((mark) => (
        <button
          key={mark}
          type="button"
          disabled={!editing}
          className={cn('whitespace-nowrap', editing && 'cursor-pointer hover:text-primary')}
          onClick={
            editing
              ? (e) => {
                  e.stopPropagation();
                  onToggle?.(mark);
                }
              : undefined
          }
        >
          {(marks ?? []).includes(mark) ? '■' : '□'}
          {mark}
        </button>
      ))}
    </div>
  );
}

function RowCrud({
  onAdd,
  onRemove,
  align = 'end',
}: {
  onAdd: () => void;
  onRemove?: () => void;
  align?: 'start' | 'end';
}) {
  return (
    <div
      className={cn(
        'absolute top-1/2 z-[1] flex -translate-y-1/2 gap-0.5',
        align === 'start' ? 'left-0.5' : 'right-0.5'
      )}
    >
      <CrudBtn kind="plus" label="행 추가" onClick={onAdd} />
      {onRemove ? <CrudBtn kind="minus" label="행 삭제" onClick={onRemove} /> : null}
    </div>
  );
}

function asLedgerRows(ledger: RoadFrontageBuildingLedger): RoadFrontageBuildingLedger {
  const details = Array.isArray(ledger.details) ? ledger.details : [];
  const confirmHistory = Array.isArray(ledger.confirmHistory) ? ledger.confirmHistory : [];
  return {
    ...ledger,
    details,
    confirmHistory,
    locAdr: String(ledger.locAdr ?? ''),
  };
}

function withEditableRows(ledger: RoadFrontageBuildingLedger): RoadFrontageBuildingLedger {
  const next = asLedgerRows(ledger);
  return {
    ...next,
    details: next.details.length ? next.details : [createEmptyRoadFrontageBuildingDetail()],
    confirmHistory: next.confirmHistory.length
      ? next.confirmHistory
      : [createEmptyRoadFrontageBuildingConfirm()],
  };
}

export function RoadFrontageBuildingDetailPanel({
  ledgerId,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const { data: session } = useSession();
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const isCreateMode = isNewRoadFrontageBuildingId(ledgerId);
  const { upload: uploadChunked } = useServiceFileChunkedUpload();
  const { highlightAt } = useRoadFrontageBuildingMapHighlight();

  const [saved, setSaved] = useState<RoadFrontageBuildingLedger | null>(null);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [draft, setDraft] = useState<RoadFrontageBuildingLedger>(() =>
    isCreateMode
      ? withEditableRows({
          ...createEmptyRoadFrontageBuildingLedger(),
          id: ROAD_FRONTAGE_BUILDING_NEW_ID,
        })
      : createEmptyRoadFrontageBuildingLedger()
  );
  /** 첨부파일 경로 키 — 대장 숫자 id가 아니라 ftr_idn */
  const fileKey = isCreateMode
    ? null
    : String(draft.ftrIdn || saved?.ftrIdn || '').trim() || null;
  const [attachRefreshNonce, setAttachRefreshNonce] = useState(0);
  const [pendingFormFiles, setPendingFormFiles] = useState<
    Partial<Record<RoadFrontageBuildingFormAttachId, File>>
  >({});
  const [pendingExtraFiles, setPendingExtraFiles] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const formAttachInputRef = useRef<HTMLInputElement>(null);
  const formAttachSlotRef = useRef<RoadFrontageBuildingFormAttachId>('layoutPlan');
  const locationCaptureSeqRef = useRef(0);
  const pendingLocationRecaptureRef = useRef<{ lon: number; lat: number } | null>(null);
  const [locationCapturing, setLocationCapturing] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [attachPreview, setAttachPreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);

  const showNotice = useCallback((title: string, message: string) => {
    setActionDialog({
      kind: 'notice',
      title,
      message,
      confirmLabel: '확인',
    });
  }, []);

  const showSuccess = useCallback((title: string, message: string) => {
    setActionDialog({
      kind: 'success',
      title,
      message,
      confirmLabel: '확인',
    });
  }, []);

  const showProgress = useCallback((title: string, message: string, confirmLabel = '처리 중') => {
    setActionDialog({
      kind: 'progress',
      title,
      message,
      confirmLabel,
    });
  }, []);

  const locationFiles = useServiceFileData({
    serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    enabled: Boolean(fileKey),
    layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue: fileKey,
    subfolder: ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS.locationMap,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });
  const layoutFiles = useServiceFileData({
    serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    enabled: Boolean(fileKey),
    layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue: fileKey,
    subfolder: ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS.layoutPlan,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });
  const beforeFiles = useServiceFileData({
    serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    enabled: Boolean(fileKey),
    layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue: fileKey,
    subfolder: ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS.before,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });
  const afterFiles = useServiceFileData({
    serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    enabled: Boolean(fileKey),
    layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue: fileKey,
    subfolder: ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS.after,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });
  const extraFiles = useServiceFileData({
    serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
    enabled: Boolean(fileKey),
    layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
    keyValue: fileKey,
    subfolder: ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER,
    refreshNonce: attachRefreshNonce,
    includeMeta: false,
  });

  const diskFolderFiles = useMemo(
    () => ({
      locationMap: locationFiles.files,
      layoutPlan: layoutFiles.files,
      before: beforeFiles.files,
      after: afterFiles.files,
    }),
    [locationFiles.files, layoutFiles.files, beforeFiles.files, afterFiles.files]
  );
  const diskFolderFilesRef = useRef(diskFolderFiles);
  diskFolderFilesRef.current = diskFolderFiles;

  const pendingFormUrls = useMemo(() => {
    const out: Partial<Record<RoadFrontageBuildingFormAttachId, string>> = {};
    for (const slot of FORM_ATTACH_SLOTS) {
      const file = pendingFormFiles[slot];
      if (file) out[slot] = URL.createObjectURL(file);
    }
    return out;
  }, [pendingFormFiles]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(pendingFormUrls)) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [pendingFormUrls]);

  const pendingExtraUrls = useMemo(
    () => pendingExtraFiles.map((file) => URL.createObjectURL(file)),
    [pendingExtraFiles]
  );

  useEffect(() => {
    return () => {
      pendingExtraUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingExtraUrls]);

  useEffect(() => {
    locationCaptureSeqRef.current += 1;
    setLocationCapturing(false);
    setPendingFormFiles({});
    setPendingExtraFiles([]);
    if (isCreateMode) {
      setSaved(null);
      setDraft(
        withEditableRows({
          ...createEmptyRoadFrontageBuildingLedger(),
          id: ROAD_FRONTAGE_BUILDING_NEW_ID,
        })
      );
      setIsEditing(true);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setIsEditing(false);
    void call('', 'POST', {
      service: 'roadFrontageBuildingService',
      action: 'get',
      params: { ftrIdn: ledgerId },
    })
      .then((res) => {
        if (cancelled) return;
        if (res?.success === false) {
          setSaved(null);
          setLoadError(String(res.error ?? '관리대장을 불러오지 못했습니다.'));
          return;
        }
        const data = res?.data ?? res;
        if (!data || typeof data !== 'object') {
          setSaved(null);
          setLoadError('선택한 관리대장을 찾을 수 없습니다.');
          return;
        }
        const row = asLedgerRows(data as RoadFrontageBuildingLedger);
        setSaved(row);
        setDraft(row);
      })
      .catch(() => {
        if (!cancelled) {
          setSaved(null);
          setLoadError('관리대장을 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateMode, ledgerId]);

  const current = isEditing ? draft : (saved ?? draft);

  const formAttaches = useMemo(() => {
    const next = emptyRoadFrontageBuildingFormAttaches();
    for (const slot of FORM_ATTACH_SLOTS) {
      const pending = pendingFormUrls[slot];
      if (pending) {
        next[slot] = [pending];
        continue;
      }
      next[slot] = firstFolderImageUrl(
        fileKey,
        diskFolderFiles[slot],
        ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS[slot]
      ).map((url) => `${url}&r=${attachRefreshNonce}`);
    }
    return next;
  }, [attachRefreshNonce, diskFolderFiles, fileKey, pendingFormUrls]);

  const photoItems = useMemo((): ServiceFilePreviewItem[] => {
    const disk =
      fileKey == null
        ? []
        : extraFiles.files
            .filter((f) => isImageServiceFileName(f.name))
            .map((f) => ({
              url: roadFrontageBuildingFileUrl(
                fileKey,
                f.name,
                ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER
              ),
              fileName: f.name,
              kind: 'image' as const,
            }));
    const pending = pendingExtraFiles.map((file, i) => ({
      url: pendingExtraUrls[i] ?? '',
      fileName: file.name,
      kind: 'image' as const,
    }));
    return [...disk, ...pending].filter((p) => Boolean(p.url));
  }, [extraFiles.files, fileKey, pendingExtraFiles, pendingExtraUrls]);

  const photos = useMemo(() => photoItems.map((p) => p.url), [photoItems]);

  const openAttachPreview = (index: number) => {
    if (!photoItems.length) return;
    const i = Math.max(0, Math.min(index, photoItems.length - 1));
    setAttachPreview({ items: photoItems, index: i });
  };

  const downloadAttach = (item: ServiceFilePreviewItem) => {
    triggerServiceFileDownload(item.url, item.fileName);
  };

  const beginEdit = () => {
    setDraft(withEditableRows(saved ?? draft));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    locationCaptureSeqRef.current += 1;
    setLocationCapturing(false);
    setPendingFormFiles({});
    setPendingExtraFiles([]);
    if (isCreateMode) {
      onClose();
      return;
    }
    setDraft(asLedgerRows(saved ?? draft));
    setIsEditing(false);
  };

  const uploadPendingFiles = async (key: string) => {
    for (const slot of FORM_ATTACH_SLOTS) {
      const file = pendingFormFiles[slot];
      if (!file) continue;
      const subfolder = ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS[slot];
      const existing = diskFolderFiles[slot];
      const result = await uploadChunked({
        file,
        serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
        layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
        keyValue: key,
        subfolder,
      });
      if (result?.error) throw new Error(result.error);
      const stale = existing.filter((row) => row.name !== file.name);
      if (stale.length) {
        const cleared = await deleteFolderFiles({ keyValue: key, subfolder, files: stale });
        if (!cleared.ok) throw new Error(cleared.error);
      }
    }
    for (const file of pendingExtraFiles) {
      const result = await uploadChunked({
        file,
        serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
        layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
        keyValue: key,
        subfolder: ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER,
      });
      if (result?.error) throw new Error(result.error);
    }
  };

  const handleSave = async () => {
    const writeNam =
      session?.user?.name?.trim() ||
      (session?.user?.id === 'su' ? '슈퍼관리자' : '') ||
      session?.user?.id ||
      draft.writeNam;
    const stamped: RoadFrontageBuildingLedger = {
      ...draft,
      writeDept: String(draft.writeDept ?? '').trim() || ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
      writeNam: String(writeNam ?? '').trim() || String(draft.writeNam ?? '').trim(),
      writeYmd: formatRoadFrontageBuildingWrittenAt(),
      formAttaches: emptyRoadFrontageBuildingFormAttaches(),
      photos: [],
    };
    const body = isCreateMode ? { ...stamped, id: undefined } : stamped;
    const hasPendingPics =
      FORM_ATTACH_SLOTS.some((slot) => Boolean(pendingFormFiles[slot])) ||
      pendingExtraFiles.length > 0;
    setSaving(true);
    showProgress(
      isCreateMode ? '등록하는 중' : '저장하는 중',
      hasPendingPics
        ? '사진을 올리는 중입니다. 잠시만 기다려 주세요.'
        : '관리대장을 저장하는 중입니다.',
      hasPendingPics ? '올리는 중' : '저장 중'
    );
    try {
      const res = await call('', 'POST', {
        service: 'roadFrontageBuildingService',
        action: 'save',
        params: body,
      });
      if (res?.success === false) {
        showNotice('저장 실패', String(res.error ?? '저장에 실패했습니다.'));
        return;
      }
      const row = (res?.data ?? res) as RoadFrontageBuildingLedger | null;
      const savedFtrIdn = String(row?.ftrIdn || row?.id || '').trim();
      if (!row || !savedFtrIdn) {
        showNotice('저장 실패', '저장 후 시설식별번호를 확인하지 못했습니다.');
        return;
      }
      try {
        await uploadPendingFiles(savedFtrIdn);
        setPendingFormFiles({});
        setPendingExtraFiles([]);
      } catch (e: unknown) {
        const extra = callFailMessage(e, '');
        showNotice(
          '저장 안내',
          extra
            ? `본문은 저장됐으나 그림을 올리지 못했습니다. ${extra}`
            : '본문은 저장됐으나 그림을 올리지 못했습니다.'
        );
        setSaved(asLedgerRows(row));
        setDraft(asLedgerRows(row));
        setIsEditing(false);
        setAttachRefreshNonce((n) => n + 1);
        if (isCreateMode) onCreated?.(savedFtrIdn);
        else onSaved?.();
        return;
      }
      setSaved(asLedgerRows(row));
      setDraft(asLedgerRows(row));
      setIsEditing(false);
      setAttachRefreshNonce((n) => n + 1);
      if (isCreateMode) onCreated?.(savedFtrIdn);
      else onSaved?.();
      showSuccess(
        isCreateMode ? '등록' : '저장',
        isCreateMode ? '등록되었습니다.' : '저장되었습니다.'
      );
    } catch (e: unknown) {
      showNotice('저장 실패', callFailMessage(e, '저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!saved || isCreateMode) return;
    setDeleting(true);
    try {
      const res = await call('', 'POST', {
        service: 'roadFrontageBuildingService',
        action: 'remove',
        params: { ftrIdn: saved.ftrIdn || saved.id },
      });
      if (res?.success === false) {
        showNotice('삭제 실패', String(res.error ?? '삭제에 실패했습니다.'));
        return;
      }
      onDeleted?.();
    } catch (e: unknown) {
      showNotice('삭제 실패', callFailMessage(e, '삭제에 실패했습니다.'));
    } finally {
      setDeleting(false);
    }
  };

  const handleDraftField = useCallback((field: string, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const captureAndStoreLocationMap = useCallback(
    async (
      map: Parameters<typeof captureLocationMapWithPoint>[0],
      lonLat: { lon: number; lat: number }
    ) => {
      if (!map) return;
      const seq = (locationCaptureSeqRef.current += 1);
      setLocationCapturing(true);
      try {
        const backgroundId = mapContext?.mapBackgroundMapIdRef?.current;
        const file = await captureLocationMapWithPoint(map, lonLat, backgroundId);
        if (seq !== locationCaptureSeqRef.current) return;
        if (!file) {
          showNotice('위치도', '지도를 담지 못했습니다. 주소를 다시 선택해 주세요.');
          return;
        }
        setPendingFormFiles((prev) => ({ ...prev, locationMap: file }));
        if (!fileKey) return;
        showProgress('위치도', '사진을 올리는 중입니다. 잠시만 기다려 주세요.', '올리는 중');
        const subfolder = ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS.locationMap;
        const existing = diskFolderFilesRef.current.locationMap;
        const result = await uploadChunked({
          file,
          serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
          layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
          keyValue: fileKey,
          subfolder,
        });
        if (seq !== locationCaptureSeqRef.current) return;
        if (result?.error) {
          showNotice('위치도', result.error);
          return;
        }
        const stale = existing.filter((row) => row.name !== file.name);
        if (stale.length) {
          const cleared = await deleteFolderFiles({ keyValue: fileKey, subfolder, files: stale });
          if (!cleared.ok) showNotice('위치도', cleared.error);
        }
        setPendingFormFiles((prev) => {
          const next = { ...prev };
          delete next.locationMap;
          return next;
        });
        setAttachRefreshNonce((n) => n + 1);
        showSuccess('위치도', '위치도를 올렸습니다.');
      } finally {
        if (seq === locationCaptureSeqRef.current) setLocationCapturing(false);
      }
    },
    [fileKey, mapContext, showNotice, showProgress, showSuccess, uploadChunked]
  );

  const applyLocationFromSearch = useCallback(
    (item: VWorldAddressItem) => {
      const raw =
        (item.jibunAddress ?? '').trim() ||
        (item.roadAddress ?? '').trim() ||
        (item.address ?? '').trim();
      const adr = formatAddressStripSidoSigungu(raw) || raw;
      const lon = Number(item.point?.x);
      const lat = Number(item.point?.y);
      const nextLonLat =
        Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0)
          ? { lon, lat }
          : null;
      setDraft((prev) => ({
        ...prev,
        locAdr: adr,
        mockLonLat: nextLonLat ?? prev.mockLonLat,
      }));
      if (!nextLonLat) return;
      const pointKey = String(draft.ftrIdn || saved?.ftrIdn || ledgerId).trim() || ledgerId;
      highlightAt(nextLonLat.lon, nextLonLat.lat, pointKey, { fit: true });
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const hasExisting = Boolean(
        pendingFormFiles.locationMap ||
          (formAttaches.locationMap ?? [])[0] ||
          diskFolderFiles.locationMap.length
      );
      if (hasExisting) {
        pendingLocationRecaptureRef.current = nextLonLat;
        setActionDialog({
          kind: 'photoReplace',
          slot: 'locationMap',
          title: '위치도를 바꿀까요?',
          message: '이미 위치도가 있습니다. 지금 지도 그림으로 덮어씁니다.',
          confirmLabel: '덮어쓰기',
          cancelLabel: '아니오',
        });
        return;
      }
      void captureAndStoreLocationMap(map, nextLonLat);
    },
    [
      captureAndStoreLocationMap,
      diskFolderFiles.locationMap.length,
      draft.ftrIdn,
      formAttaches.locationMap,
      highlightAt,
      ledgerId,
      mapContext,
      pendingFormFiles.locationMap,
      saved?.ftrIdn,
    ]
  );

  const clearLocationSearch = useCallback(() => {
    setDraft((prev) => ({ ...prev, locAdr: '' }));
  }, []);

  const addDetailAt = (index: number) => {
    setDraft((prev) => {
      const details = [...(Array.isArray(prev.details) ? prev.details : [])];
      details.splice(index, 0, createEmptyRoadFrontageBuildingDetail());
      return { ...prev, details };
    });
  };

  const addConfirmAt = (index: number) => {
    setDraft((prev) => {
      const confirmHistory = [...(Array.isArray(prev.confirmHistory) ? prev.confirmHistory : [])];
      confirmHistory.splice(index, 0, createEmptyRoadFrontageBuildingConfirm());
      return { ...prev, confirmHistory };
    });
  };

  const removeDetail = (id: string) => {
    setDraft((prev) => {
      const details = (Array.isArray(prev.details) ? prev.details : []).filter((d) => d.id !== id);
      return {
        ...prev,
        details: details.length ? details : [createEmptyRoadFrontageBuildingDetail()],
      };
    });
  };

  const patchDetail = (id: string, patch: Partial<RoadFrontageBuildingDetailItem>) => {
    setDraft((prev) => ({
      ...prev,
      details: (Array.isArray(prev.details) ? prev.details : []).map((d) =>
        d.id === id ? { ...d, ...patch } : d
      ),
    }));
  };

  const toggleBadMark = (id: string, mark: string) => {
    setDraft((prev) => ({
      ...prev,
      details: (Array.isArray(prev.details) ? prev.details : []).map((d) => {
        if (d.id !== id) return d;
        const marks = Array.isArray(d.badMarks) ? d.badMarks : [];
        return {
          ...d,
          badMarks: marks.includes(mark) ? marks.filter((m) => m !== mark) : [...marks, mark],
        };
      }),
    }));
  };

  const removeConfirm = (id: string) => {
    setDraft((prev) => {
      const confirmHistory = (Array.isArray(prev.confirmHistory) ? prev.confirmHistory : []).filter(
        (c) => c.id !== id
      );
      return {
        ...prev,
        confirmHistory: confirmHistory.length
          ? confirmHistory
          : [createEmptyRoadFrontageBuildingConfirm()],
      };
    });
  };

  const patchConfirm = (id: string, patch: Partial<RoadFrontageBuildingConfirmItem>) => {
    setDraft((prev) => ({
      ...prev,
      confirmHistory: (Array.isArray(prev.confirmHistory) ? prev.confirmHistory : []).map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    }));
  };

  const handlePickPhotos = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => isImageServiceFileName(f.name));
    if (list.length === 0) {
      showNotice('첨부', '이미지 파일만 등록할 수 있습니다.');
      return;
    }
    if (!fileKey) {
      setPendingExtraFiles((prev) => [...prev, ...list]);
      return;
    }
    showProgress('사진', '사진을 올리는 중입니다. 잠시만 기다려 주세요.', '올리는 중');
    let failed = false;
    for (const file of list) {
      const result = await uploadChunked({
        file,
        serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
        layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
        keyValue: fileKey,
        subfolder: ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER,
      });
      if (result?.error) {
        showNotice('첨부', result.error);
        failed = true;
        break;
      }
    }
    setAttachRefreshNonce((n) => n + 1);
    if (!failed) showSuccess('사진', '사진을 올렸습니다.');
  };

  const removePhoto = async (index: number) => {
    const diskCount = fileKey ? extraFiles.files.length : 0;
    if (index >= diskCount) {
      setPendingExtraFiles((prev) => prev.filter((_, i) => i !== index - diskCount));
      return;
    }
    if (!fileKey) return;
    const target = extraFiles.files[index];
    if (!target) return;
    const result = await deleteFolderFiles({
      keyValue: fileKey,
      subfolder: ROAD_FRONTAGE_BUILDING_EXTRA_ATTACH_FOLDER,
      files: [target],
    });
    if (!result.ok) {
      showNotice('첨부', result.error);
      return;
    }
    setAttachRefreshNonce((n) => n + 1);
  };

  const formAttachShotDates =
    current.formAttachShotDates ?? emptyRoadFrontageBuildingFormAttachShotDates();

  const openFormAttachPickerNow = (id: RoadFrontageBuildingFormAttachId) => {
    formAttachSlotRef.current = id;
    formAttachInputRef.current?.click();
  };

  const slotHasImage = (id: RoadFrontageBuildingFormAttachId) =>
    Boolean(pendingFormFiles[id] || (formAttaches[id] ?? [])[0] || diskFolderFiles[id].length);

  const requestFormAttachPicker = (id: RoadFrontageBuildingFormAttachId) => {
    if (slotHasImage(id)) {
      setActionDialog({
        kind: 'photoReplace',
        slot: id,
        title: '사진을 바꿀까요?',
        message: `이미 ${FORM_SLOT_LABEL[id]} 사진이 있습니다. 새 사진으로 덮어씁니다.`,
        confirmLabel: '덮어쓰기',
        cancelLabel: '아니오',
      });
      return;
    }
    openFormAttachPickerNow(id);
  };

  const requestRemoveFormAttach = (id: RoadFrontageBuildingFormAttachId) => {
    if (!slotHasImage(id)) return;
    setActionDialog({
      kind: 'photoRemove',
      slot: id,
      title: '사진을 삭제할까요?',
      message: `${FORM_SLOT_LABEL[id]} 사진을 삭제합니다.`,
      confirmLabel: '삭제',
      cancelLabel: '아니오',
      danger: true,
    });
  };

  const handlePickFormAttach = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    const tab = formAttachSlotRef.current;
    const file = Array.from(files).find((f) => isImageServiceFileName(f.name)) ?? files[0];
    if (!file || !isImageServiceFileName(file.name)) {
      showNotice('첨부', '이미지 파일만 등록할 수 있습니다.');
      return;
    }
    if (!fileKey) {
      setPendingFormFiles((prev) => ({ ...prev, [tab]: file }));
      return;
    }
    showProgress('사진', '사진을 올리는 중입니다. 잠시만 기다려 주세요.', '올리는 중');
    const subfolder = ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS[tab];
    const cleared = await deleteFolderFiles({
      keyValue: fileKey,
      subfolder,
      files: diskFolderFiles[tab],
    });
    if (!cleared.ok) {
      showNotice('첨부', cleared.error);
      return;
    }
    const result = await uploadChunked({
      file,
      serEng: ROAD_FRONTAGE_BUILDING_FILE_SER_ENG,
      layerSegment: ROAD_FRONTAGE_BUILDING_FILE_LAYER,
      keyValue: fileKey,
      subfolder,
    });
    if (result?.error) {
      showNotice('첨부', result.error);
      return;
    }
    setAttachRefreshNonce((n) => n + 1);
    showSuccess('사진', `${FORM_SLOT_LABEL[tab]} 사진을 올렸습니다.`);
  };

  const removeFormAttach = async (tab: RoadFrontageBuildingFormAttachId) => {
    if (!fileKey) {
      setPendingFormFiles((prev) => {
        const next = { ...prev };
        delete next[tab];
        return next;
      });
      return;
    }
    const cleared = await deleteFolderFiles({
      keyValue: fileKey,
      subfolder: ROAD_FRONTAGE_BUILDING_FORM_ATTACH_FOLDERS[tab],
      files: diskFolderFiles[tab],
    });
    if (!cleared.ok) {
      showNotice('첨부', cleared.error);
      return;
    }
    setAttachRefreshNonce((n) => n + 1);
  };

  const patchFormAttachShotDate = (field: 'before' | 'after', value: string) => {
    setDraft((prev) => ({
      ...prev,
      formAttachShotDates: {
        ...emptyRoadFrontageBuildingFormAttachShotDates(),
        ...prev.formAttachShotDates,
        [field]: value,
      },
    }));
  };

  if (loading && !isCreateMode) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-sm font-semibold text-foreground">접도구역 건축물</span>
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
        <p className="flex items-center justify-center gap-1 px-3 py-6 text-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          불러오는 중…
        </p>
      </div>
    );
  }

  if (!saved && !isCreateMode) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-sm font-semibold text-foreground">접도구역 건축물</span>
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
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {loadError || '선택한 관리대장을 찾을 수 없습니다.'}
        </p>
      </div>
    );
  }

  const details = Array.isArray(current.details) ? current.details : [];
  const confirmHistory = Array.isArray(current.confirmHistory) ? current.confirmHistory : [];
  const routeTextRaw = formatRouteNoName(current.routeNo, current.routeNam);
  const routeText = routeTextRaw === '—' ? '' : routeTextRaw;
  const detailPadCount = Math.max(0, FORM_DETAIL_MIN_ROWS - details.length);
  const confirmPadCount = Math.max(0, FORM_CONFIRM_MIN_ROWS - confirmHistory.length);
  const detailRowSpan = 2 + Math.max(details.length, FORM_DETAIL_MIN_ROWS);
  const confirmRowSpan = 1 + Math.max(confirmHistory.length, FORM_CONFIRM_MIN_ROWS);

  const askDelete = () => {
    setActionDialog({
      kind: 'delete',
      title: '삭제할까요?',
      message: '이 관리대장을 삭제합니다. 삭제하면 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      cancelLabel: '아니오',
      danger: true,
    });
  };
  const askCancel = () => {
    setActionDialog({
      kind: 'cancel',
      title: isCreateMode ? '등록을 취소할까요?' : '수정을 취소할까요?',
      message: isCreateMode
        ? '입력한 내용은 저장되지 않고 화면이 닫힙니다.'
        : '저장하지 않은 변경은 반영되지 않습니다.',
      confirmLabel: isCreateMode ? '닫기' : '취소하기',
      cancelLabel: '계속 편집',
    });
  };
  const runAction = () => {
    const kind = actionDialog?.kind;
    const slot = actionDialog?.slot;
    if (!kind || kind === 'notice' || kind === 'success' || kind === 'progress') {
      setActionDialog(null);
      return;
    }
    setActionDialog(null);
    if (kind === 'delete') void handleDelete();
    if (kind === 'cancel') cancelEdit();
    if (kind === 'photoRemove' && slot) void removeFormAttach(slot);
    if (kind === 'photoReplace') {
      if (slot === 'locationMap') {
        const map = mapContext?.mapInstanceRef?.current;
        const lonLat =
          pendingLocationRecaptureRef.current ??
          (Number.isFinite(Number(current.mockLonLat?.lon)) &&
          Number.isFinite(Number(current.mockLonLat?.lat))
            ? { lon: Number(current.mockLonLat.lon), lat: Number(current.mockLonLat.lat) }
            : null);
        pendingLocationRecaptureRef.current = null;
        if (map && lonLat && !(lonLat.lon === 0 && lonLat.lat === 0)) {
          void captureAndStoreLocationMap(map, lonLat);
        }
        return;
      }
      if (slot) openFormAttachPickerNow(slot);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-muted">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {isCreateMode
            ? '관리대장 등록'
            : String(current.locAdr ?? '').trim() || '(위치 미입력)'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {!isEditing ? (
            <>
              <button
                type="button"
                className={btnGhost}
                onClick={() =>
                  void printRoadFrontageBuildingForm({ ...current, formAttaches, photos })
                }
              >
                <Printer className="h-3 w-3" />
                인쇄
              </button>
              <button type="button" className={btnGhost} onClick={beginEdit}>
                <Pencil className="h-3 w-3" />
                수정
              </button>
              <button type="button" className={btnDanger} onClick={askDelete} disabled={deleting}>
                <Trash2 className="h-3 w-3" />
                삭제
              </button>
            </>
          ) : (
            <>
              <button type="button" className={btnGhost} onClick={askCancel}>
                취소
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void handleSave()}
                disabled={saving || locationCapturing}
              >
                {saving ? (isCreateMode ? '등록 중' : '저장 중') : isCreateMode ? '등록' : '저장'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={isEditing ? askCancel : onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-2 py-1.5 text-xs">
        <div className="rfb-form-print-root text-xs">
        <div className="rfb-print-page">
        <div className="mb-0 flex items-start justify-between gap-2 text-[10px] leading-none text-muted-foreground">
          <span>■ 도로법 시행규칙 [별지 제17호서식]</span>
          <span className="shrink-0">(2쪽 중 제1쪽)</span>
        </div>
        <h2 className="mb-1 text-center text-[17px] font-bold leading-tight tracking-tight text-foreground">
          접도구역의 기존 건축물(공작물) 관리대장
        </h2>

        <div className="rfb-print-page-form bg-background [&_table+table]:-mt-px">
          <table className={formTableClass}>
            <colgroup>
              <col style={{ width: '4.25rem' }} />
              <col style={{ width: '3.75rem' }} />
              <col style={{ width: FORM_FIELD_LABEL_W }} />
              <col />
              <col style={{ width: FORM_RESIDENT_LABEL_W }} />
              <col style={{ width: '5.5rem' }} />
              <col style={{ width: FORM_PREPARED_LABEL_W }} />
              <col style={{ width: FORM_PREPARED_VALUE_W }} />
            </colgroup>
            <tbody>
              <tr>
                <Th className="whitespace-nowrap">도로의 종류</Th>
                <Td>
                  <CellValue editing={isEditing} value={dash(current.roadType)}>
                    <select
                      className={fieldClass}
                      value={current.roadType}
                      onChange={(e) => handleDraftField('roadType', e.target.value)}
                    >
                      <option value="">선택</option>
                      {ROAD_FRONTAGE_BUILDING_ROAD_TYPES.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </CellValue>
                </Td>
                <Th className="leading-tight">
                  노선번호
                  <br />
                  (노선명)
                </Th>
                <Td>
                  <CellValue editing={isEditing} nowrap value={routeText}>
                    <input
                      className={fieldClass}
                      value={routeText}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          routeNo: e.target.value,
                          routeNam: '',
                        }))
                      }
                    />
                  </CellValue>
                </Td>
                <Th className="whitespace-nowrap">일련번호</Th>
                <Td className="whitespace-nowrap">
                  <CellValue editing={isEditing} nowrap value={dash(current.serialNo)}>
                    <input
                      className={fieldClass}
                      value={current.serialNo}
                      onChange={(e) => handleDraftField('serialNo', e.target.value)}
                    />
                  </CellValue>
                </Td>
                <Th className="whitespace-nowrap">작성 연월일</Th>
                <Td className="whitespace-nowrap overflow-visible">
                  <CellValue editing={isEditing} nowrap value={formatFormDate(current.preYmd)}>
                    <input
                      type="date"
                      className={cn(dateFieldClass, 'min-w-[7rem]')}
                      value={current.preYmd}
                      onChange={(e) => handleDraftField('preYmd', e.target.value)}
                    />
                  </CellValue>
                </Td>
              </tr>
            </tbody>
          </table>

          <table className={formTableClass}>
            <colgroup>
              <col style={{ width: FORM_SIDE_W }} />
              <col style={{ width: FORM_FIELD_LABEL_W }} />
              <col style={{ width: FORM_FIELD_VALUE_W }} />
              <col style={{ width: FORM_RESIDENT_LABEL_W }} />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <SideTh rowSpan={3} className="whitespace-nowrap">
                  건축물(공작물)
                </SideTh>
                <Th>위치</Th>
                <Td className="relative z-20 overflow-visible">
                  <CellValue editing={isEditing} value={dash(current.locAdr)}>
                    <AddressSearchPanel
                      layout="field"
                      compact
                      vworldApiKey={vworldApiKey}
                      initialQuery={current.locAdr}
                      placeholder="주소/지번 검색"
                      onSelect={applyLocationFromSearch}
                      onQueryChange={(q) => handleDraftField('locAdr', q)}
                      onClear={clearLocationSearch}
                    />
                  </CellValue>
                </Td>
                <Th>현 거주자</Th>
                <Td>
                  <NameWithPhone
                    editing={isEditing}
                    name={current.resiNam}
                    phone={current.resiNum}
                    onName={(v) => handleDraftField('resiNam', v)}
                    onPhone={(v) => handleDraftField('resiNum', v)}
                  />
                </Td>
              </tr>
              <tr>
                <Th className="break-keep leading-tight">건축물(공작물) 소유자</Th>
                <Td>
                  <NameWithPhone
                    editing={isEditing}
                    name={current.buildOnam}
                    phone={current.buildOnum}
                    onName={(v) => handleDraftField('buildOnam', v)}
                    onPhone={(v) => handleDraftField('buildOnum', v)}
                  />
                </Td>
                <Th>주소</Th>
                <Td>
                  <CellValue editing={isEditing} value={dash(current.buildOadr)}>
                    <input
                      className={fieldClass}
                      value={current.buildOadr}
                      onChange={(e) => handleDraftField('buildOadr', e.target.value)}
                    />
                  </CellValue>
                </Td>
              </tr>
              <tr>
                <Th className="whitespace-nowrap">토지 소유자</Th>
                <Td>
                  <NameWithPhone
                    editing={isEditing}
                    name={current.landOnam}
                    phone={current.landOnum}
                    onName={(v) => handleDraftField('landOnam', v)}
                    onPhone={(v) => handleDraftField('landOnum', v)}
                  />
                </Td>
                <Th>주소</Th>
                <Td>
                  <CellValue editing={isEditing} value={dash(current.landOadr)}>
                    <input
                      className={fieldClass}
                      value={current.landOadr}
                      onChange={(e) => handleDraftField('landOadr', e.target.value)}
                    />
                  </CellValue>
                </Td>
              </tr>
            </tbody>
          </table>

          <table className={cn(formTableClass, 'rfb-form-grow-table')}>
            <FormBodyColgroup />
            <tbody>
              <tr>
                <SideTh rowSpan={detailRowSpan}>건축물(공작물) 내용</SideTh>
                <Th rowSpan={2} className="whitespace-nowrap px-0.5">
                  동 구분
                </Th>
                <Th rowSpan={2} className="whitespace-nowrap px-0.5">
                  설치 연월일
                </Th>
                <Th rowSpan={2}>구조</Th>
                <Th rowSpan={2}>용도</Th>
                <Th rowSpan={2} className="break-keep px-0.5 leading-tight">
                  건축물(공작물) 면적(㎡)
                </Th>
                <Th colSpan={2}>위치</Th>
                <Th rowSpan={2} className="break-keep px-0.5 leading-tight">
                  불량 건축물 표시
                </Th>
              </tr>
              <tr>
                <Th className="px-0.5 text-[10px]">도로예정지</Th>
                <Th className="px-0.5 text-[10px]">접도구역</Th>
              </tr>
              {details.map((d, index) => (
                <tr key={d.id}>
                  <Td className={cn(`${FORM_ROW_H} relative text-center tabular-nums`, isEditing && 'pl-5')}>
                    {isEditing ? (
                      <input
                        className={cn(fieldClass, 'text-center')}
                        value={d.dongNo}
                        onChange={(e) => patchDetail(d.id, { dongNo: e.target.value })}
                      />
                    ) : (
                      d.dongNo
                    )}
                    {isEditing ? (
                      <RowCrud
                        align="start"
                        onAdd={() => addDetailAt(index + 1)}
                        onRemove={() => removeDetail(d.id)}
                      />
                    ) : null}
                  </Td>
                  <Td className="text-center tabular-nums">
                    {isEditing ? (
                      <input
                        type="date"
                        className={cn(dateFieldClass, 'text-center')}
                        value={d.instYmd}
                        onChange={(e) => patchDetail(d.id, { instYmd: e.target.value })}
                      />
                    ) : (
                      formatFormDate(d.instYmd)
                    )}
                  </Td>
                  <Td className="text-center">
                    {isEditing ? (
                      <input
                        className={cn(fieldClass, 'text-center')}
                        value={d.structure}
                        onChange={(e) => patchDetail(d.id, { structure: e.target.value })}
                      />
                    ) : (
                      d.structure
                    )}
                  </Td>
                  <Td className="text-center">
                    {isEditing ? (
                      <input
                        className={cn(fieldClass, 'text-center')}
                        value={d.usageType}
                        onChange={(e) => patchDetail(d.id, { usageType: e.target.value })}
                      />
                    ) : (
                      d.usageType
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {isEditing ? (
                      <input
                        className={cn(fieldClass, 'text-right')}
                        value={d.areaSqm}
                        onChange={(e) => patchDetail(d.id, { areaSqm: e.target.value })}
                      />
                    ) : (
                      formatArea(d.areaSqm)
                    )}
                  </Td>
                  {ROAD_FRONTAGE_BUILDING_LOCATION_KINDS.map((kind) => (
                    <Td
                      key={kind}
                      className="text-center text-[13px]"
                      onClick={
                        isEditing
                          ? () =>
                              patchDetail(d.id, {
                                ...flagsFromLocationKind(kind as RoadFrontageBuildingLocationKind),
                              })
                          : undefined
                      }
                    >
                      {detailLocationCellDisplay(detailLocationFieldValue(d, kind))}
                    </Td>
                  ))}
                  <Td className="px-1">
                    <BadMarksCell
                      marks={d.badMarks ?? []}
                      editing={isEditing}
                      onToggle={(mark) => toggleBadMark(d.id, mark)}
                    />
                  </Td>
                </tr>
              ))}
              {Array.from({ length: detailPadCount }, (_, i) => (
                <tr key={`detail-pad-${i}`}>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} text-center`}>{'\u00a0'}</Td>
                  <Td className={`${FORM_ROW_H} px-1`}>
                    <BadMarksCell marks={[]} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className={cn(formTableClass, 'rfb-form-grow-table')}>
            <FormBodyColgroup />
            <tbody>
              <tr>
                <SideTh rowSpan={confirmRowSpan} className="whitespace-nowrap">
                  확인 결과
                </SideTh>
                <Th colSpan={2} className={FORM_CONFIRM_ROW_H}>확인 연월일</Th>
                <Th colSpan={3} className={FORM_CONFIRM_ROW_H}>확인자</Th>
                <Th colSpan={3} className={FORM_CONFIRM_ROW_H}>결재자</Th>
              </tr>
              {confirmHistory.map((c, index) => (
                <tr key={c.id}>
                  <Td colSpan={2} className={`${FORM_CONFIRM_ROW_H} text-center tabular-nums`}>
                    {isEditing ? (
                      <input
                        type="date"
                        className={cn(dateFieldClass, 'text-center')}
                        value={c.checkYmd}
                        onChange={(e) => patchConfirm(c.id, { checkYmd: e.target.value })}
                      />
                    ) : (
                      formatFormDate(c.checkYmd)
                    )}
                  </Td>
                  <Td colSpan={3} className={FORM_CONFIRM_ROW_H}>
                    {isEditing ? (
                      <input
                        className={fieldClass}
                        placeholder="성명"
                        value={c.checkNam}
                        onChange={(e) => patchConfirm(c.id, { checkNam: e.target.value })}
                      />
                    ) : (
                      <SignSlot name={c.checkNam} />
                    )}
                  </Td>
                  <Td colSpan={3} className={cn(FORM_CONFIRM_ROW_H, 'relative', isEditing && 'pr-7')}>
                    {isEditing ? (
                      <input
                        className={fieldClass}
                        placeholder="성명"
                        value={c.appNam}
                        onChange={(e) => patchConfirm(c.id, { appNam: e.target.value })}
                      />
                    ) : (
                      <SignSlot name={c.appNam} />
                    )}
                    {isEditing ? (
                      <RowCrud
                        onAdd={() => addConfirmAt(index + 1)}
                        onRemove={() => removeConfirm(c.id)}
                      />
                    ) : null}
                  </Td>
                </tr>
              ))}
              {Array.from({ length: confirmPadCount }, (_, i) => (
                <tr key={`confirm-pad-${i}`}>
                  <Td colSpan={2} className={`${FORM_CONFIRM_ROW_H} text-center`}>
                    {'\u00a0'}
                  </Td>
                  <Td colSpan={3} className={FORM_CONFIRM_ROW_H}>
                    <SignSlot />
                  </Td>
                  <Td colSpan={3} className={cn(FORM_CONFIRM_ROW_H, 'relative', isEditing && 'pr-7')}>
                    <SignSlot />
                    {isEditing && i === confirmPadCount - 1 ? (
                      <RowCrud onAdd={() => addConfirmAt(confirmHistory.length)} />
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 flex items-end justify-between gap-3 px-0.5 text-[10px] leading-tight text-muted-foreground">
            <span>
              {[
                String(current.writeDept ?? '').trim() || ROAD_FRONTAGE_BUILDING_DEFAULT_WRITER_DEPT,
                String(current.writeNam ?? '').trim(),
                String(current.writeYmd ?? '').trim(),
              ]
                .filter(Boolean)
                .join(' / ')}
            </span>
            <span className="shrink-0">{PAPER_SIZE_LABEL}</span>
          </div>
        </div>
        </div>

        <section className="rfb-print-page rfb-print-page-drawings mt-3 pb-1">
          <div className="mb-0.5 flex items-center justify-end text-[10px] leading-none text-muted-foreground">
            <span>(2쪽 중 제2쪽)</span>
          </div>
          <table className={formTableClass}>
            <colgroup>
              <col style={{ width: '50%' }} />
              <col style={{ width: '50%' }} />
            </colgroup>
            <tbody>
              <tr>
                <Th className={FORM_DRAW_HEAD_H}>위치도</Th>
                <Th className={cn(FORM_DRAW_HEAD_H, 'whitespace-nowrap')}>
                  건축물(공작물) 배치도(축척: 1/400)
                </Th>
              </tr>
              <tr className="rfb-draw-pane-row">
                <Td className={`${FORM_ATTACH_BOX} p-0 align-top`}>
                  <FormAttachPane
                    srcs={formAttaches.locationMap ?? []}
                    editing={isEditing}
                    picker={false}
                    capturing={locationCapturing}
                    emptyHint="위치에서 주소를 고르면 지도가 담깁니다"
                    onAdd={() => {}}
                    onRemove={() => {}}
                  />
                </Td>
                <Td className={`${FORM_ATTACH_BOX} p-0 align-top`}>
                  <FormAttachPane
                    srcs={formAttaches.layoutPlan ?? []}
                    editing={isEditing}
                    onAdd={() => requestFormAttachPicker('layoutPlan')}
                    onRemove={() => requestRemoveFormAttach('layoutPlan')}
                  />
                </Td>
              </tr>
              <tr>
                <Th colSpan={2} className={FORM_DRAW_HEAD_H}>
                  사진
                </Th>
              </tr>
              <tr>
                <Th
                  className={cn(
                    FORM_DRAW_HEAD_H,
                    'overflow-hidden whitespace-nowrap px-0.5 text-[10px]'
                  )}
                >
                  {isEditing ? (
                    <span className="inline-flex items-center justify-center gap-0.5">
                      <span>종전(촬영 연월일:</span>
                      <input
                        type="date"
                        value={formAttachShotDates.before}
                        onChange={(e) => patchFormAttachShotDate('before', e.target.value)}
                        className={cn(dateFieldClass, 'w-[7.25rem]')}
                      />
                      <span>)</span>
                    </span>
                  ) : (
                    `종전(촬영 연월일: ${formatShotDateKo(formAttachShotDates.before)})`
                  )}
                </Th>
                <Th
                  className={cn(
                    FORM_DRAW_HEAD_H,
                    'overflow-hidden whitespace-nowrap px-0.5 text-[10px]'
                  )}
                >
                  {isEditing ? (
                    <span className="inline-flex items-center justify-center gap-0.5">
                      <span>변경(촬영 연월일:</span>
                      <input
                        type="date"
                        value={formAttachShotDates.after}
                        onChange={(e) => patchFormAttachShotDate('after', e.target.value)}
                        className={cn(dateFieldClass, 'w-[7.25rem]')}
                      />
                      <span>)</span>
                    </span>
                  ) : (
                    `변경(촬영 연월일: ${formatShotDateKo(formAttachShotDates.after)})`
                  )}
                </Th>
              </tr>
              <tr className="rfb-draw-pane-row">
                <Td className={`${FORM_ATTACH_BOX} p-0 align-top`}>
                  <FormAttachPane
                    srcs={formAttaches.before ?? []}
                    editing={isEditing}
                    onAdd={() => requestFormAttachPicker('before')}
                    onRemove={() => requestRemoveFormAttach('before')}
                  />
                </Td>
                <Td className={`${FORM_ATTACH_BOX} p-0 align-top`}>
                  <FormAttachPane
                    srcs={formAttaches.after ?? []}
                    editing={isEditing}
                    onAdd={() => requestFormAttachPicker('after')}
                    onRemove={() => requestRemoveFormAttach('after')}
                  />
                </Td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1 flex justify-end px-0.5 text-[10px] leading-tight text-muted-foreground">
            <span>{PAPER_SIZE_LABEL}</span>
          </div>
        </section>
        </div>

        <input
          ref={formAttachInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handlePickFormAttach(e.target.files);
            e.target.value = '';
          }}
        />

        <section className="mt-3 pb-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              첨부파일
              {photos.length > 0 ? ` (${photos.length.toLocaleString()})` : ''}
            </span>
            {isEditing ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => photoInputRef.current?.click()}
              >
                <Plus className="h-3 w-3" />
                등록
              </button>
            ) : null}
          </div>
          {photoItems.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-background py-4 text-center text-[11px] text-muted-foreground">
              {isEditing ? '등록을 눌러 사진을 넣으세요.' : '등록된 첨부파일이 없습니다.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {photoItems.map((item, index) => (
                <div
                  key={`${item.fileName}-${index}`}
                  className="group relative h-[5.5rem] overflow-hidden rounded border border-border bg-background"
                >
                  <button
                    type="button"
                    title={`${item.fileName} 미리보기`}
                    aria-label={`${item.fileName} 미리보기`}
                    onClick={() => openAttachPreview(index)}
                    className="block h-full w-full"
                  >
                    <img
                      src={
                        item.url.startsWith('blob:')
                          ? item.url
                          : withServiceFileThumbQuery(item.url, 160)
                      }
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </button>
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-0.5 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      title="다운로드"
                      aria-label="다운로드"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadAttach(item);
                      }}
                      className="pointer-events-auto rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm ring-1 ring-border/80 hover:bg-muted hover:text-foreground"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    {isEditing ? (
                      <button
                        type="button"
                        title="삭제"
                        aria-label="삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removePhoto(index);
                        }}
                        className="pointer-events-auto rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm ring-1 ring-border/80 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handlePickPhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </section>
      </MapSideDetailScroll>
      {attachPreview ? (
        <ServiceFileImagePreview
          items={attachPreview.items}
          initialIndex={attachPreview.index}
          onClose={() => setAttachPreview(null)}
        />
      ) : null}
      {actionDialog ? (
        <ActionDialog
          action={actionDialog}
          busy={saving || deleting}
          onClose={() => {
            pendingLocationRecaptureRef.current = null;
            setActionDialog(null);
          }}
          onConfirm={runAction}
        />
      ) : null}
    </div>
  );
}
