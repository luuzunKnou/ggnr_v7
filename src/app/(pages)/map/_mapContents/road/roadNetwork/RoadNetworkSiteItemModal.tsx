"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Plus, Trash2 } from "lucide-react";
import {
  ROAD_NETWORK_COMPLAINT_STATES,
  type RoadNetworkAttachment,
  type RoadNetworkComplaintItem,
  type RoadNetworkMaintenanceItem,
} from "./roadNetworkMock";

const fieldClass =
  "h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const labelClass = "mb-0.5 block text-[11px] text-slate-500";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";
const btnDanger =
  "inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-white px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

function ensureAttachments(list?: RoadNetworkAttachment[] | null): RoadNetworkAttachment[] {
  return Array.isArray(list) ? list : [];
}

type AttachHandlers = {
  onPreview: (list: RoadNetworkAttachment[], focusId?: string) => void;
  onDownload: (att: RoadNetworkAttachment) => void;
  onAddClick: () => void;
  onRemove: (id: string) => void;
};

export type RoadNetworkSiteItemModalProps = {
  kind: "maint" | "comp";
  maintDraft: RoadNetworkMaintenanceItem | null;
  compDraft: RoadNetworkComplaintItem | null;
  setMaintDraft: Dispatch<SetStateAction<RoadNetworkMaintenanceItem | null>>;
  setCompDraft: Dispatch<SetStateAction<RoadNetworkComplaintItem | null>>;
  canDelete: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  attach: AttachHandlers;
  /** 목록 패널 왼쪽 끝 (뷰포트 기준 px) — 목록+상세 전체를 덮는 오버레이 위치 */
  overlayLeftPx: number;
  /** 목록 + 상세 패널 너비 합 (px) */
  overlayWidthPx: number;
};

function AttachmentThumbGrid({
  items,
  attach,
}: {
  items: RoadNetworkAttachment[];
  attach: AttachHandlers;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-slate-400">첨부 없음</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((a) => {
        const isImage = a.previewKind === "image" && !!a.previewUrl;
        const isPdf = a.previewKind === "pdf";
        return (
          <div key={a.id} className="group relative min-w-0">
            <button
              type="button"
              onClick={() => attach.onPreview(items, a.id)}
              className="block aspect-square w-full overflow-hidden rounded border border-slate-200 bg-slate-50"
              title={`${a.name} 미리보기`}
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt={a.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-slate-400">
                  <FileText className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">{isPdf ? "PDF" : "파일"}</span>
                </div>
              )}
            </button>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-0.5 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  attach.onDownload(a);
                }}
                className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded bg-white text-slate-700 shadow ring-1 ring-slate-200/80 hover:text-primary"
                title="다운로드"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  attach.onRemove(a.id);
                }}
                className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded bg-white text-red-600 shadow ring-1 ring-slate-200/80 hover:bg-red-50"
                title="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-slate-500" title={a.name}>
              {a.name}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function AttachBlock({
  items,
  attach,
}: {
  items: RoadNetworkAttachment[];
  attach: AttachHandlers;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={labelClass}>첨부파일</span>
        <button type="button" className={btnGhost} onClick={attach.onAddClick}>
          <Plus className="h-3 w-3" />
          추가
        </button>
      </div>
      <AttachmentThumbGrid items={items} attach={attach} />
    </div>
  );
}

function SiteAddressLine({
  point,
  address,
}: {
  point?: { lon: number; lat: number } | null;
  address?: string;
}) {
  return (
    <div>
      <span className={labelClass}>현장 위치</span>
      <p className="truncate text-[11px] text-slate-600">
        {point ? address || "주소 조회 중…" : "미지정 — 지도에서 지정"}
      </p>
    </div>
  );
}

function MaintEdit({
  draft,
  setDraft,
  attach,
}: {
  draft: RoadNetworkMaintenanceItem;
  setDraft: Dispatch<SetStateAction<RoadNetworkMaintenanceItem | null>>;
  attach: AttachHandlers;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="block">
          <span className={labelClass}>작업일</span>
          <input
            type="date"
            className={fieldClass}
            value={draft.date}
            onChange={(e) => setDraft((d) => (d ? { ...d, date: e.target.value } : d))}
          />
        </label>
        <label className="block">
          <span className={labelClass}>작업유형</span>
          <input
            className={fieldClass}
            value={draft.workType}
            onChange={(e) => setDraft((d) => (d ? { ...d, workType: e.target.value } : d))}
          />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>내용</span>
        <textarea
          className="min-h-[2.75rem] w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          rows={2}
          value={draft.content}
          onChange={(e) => setDraft((d) => (d ? { ...d, content: e.target.value } : d))}
        />
      </label>
      <label className="block">
        <span className={labelClass}>시공</span>
        <input
          className={fieldClass}
          value={draft.contractor}
          onChange={(e) => setDraft((d) => (d ? { ...d, contractor: e.target.value } : d))}
        />
      </label>
      <SiteAddressLine point={draft.point} address={draft.siteAddress} />
      <AttachBlock items={ensureAttachments(draft.attachments)} attach={attach} />
    </div>
  );
}

function CompEdit({
  draft,
  setDraft,
  attach,
}: {
  draft: RoadNetworkComplaintItem;
  setDraft: Dispatch<SetStateAction<RoadNetworkComplaintItem | null>>;
  attach: AttachHandlers;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="block">
          <span className={labelClass}>상태</span>
          <select
            className={fieldClass}
            value={draft.state}
            onChange={(e) => setDraft((d) => (d ? { ...d, state: e.target.value } : d))}
          >
            {ROAD_NETWORK_COMPLAINT_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>접수일</span>
          <input
            type="date"
            className={fieldClass}
            value={draft.date}
            onChange={(e) => setDraft((d) => (d ? { ...d, date: e.target.value } : d))}
          />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>신청인</span>
        <input
          className={fieldClass}
          value={draft.name}
          onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
        />
      </label>
      <label className="block">
        <span className={labelClass}>내용</span>
        <textarea
          className="min-h-[2.75rem] w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          rows={2}
          value={draft.content}
          onChange={(e) => setDraft((d) => (d ? { ...d, content: e.target.value } : d))}
        />
      </label>
      <SiteAddressLine point={draft.point} address={draft.address} />
      <AttachBlock items={ensureAttachments(draft.attachments)} attach={attach} />
    </div>
  );
}

/** 목록·상세 두 패널 전체를 덮는 편집 시트(도로대장 시설속성 모달과 동일 방식). 현장 위치는 지도 배너로 편집 */
export function RoadNetworkSiteItemModal(props: RoadNetworkSiteItemModalProps) {
  const {
    kind,
    maintDraft,
    compDraft,
    setMaintDraft,
    setCompDraft,
    canDelete,
    onClose,
    onDelete,
    onSave,
    attach,
    overlayLeftPx,
    overlayWidthPx,
  } = props;

  const heading = kind === "maint" ? "유지보수" : "민원";
  const ready =
    (kind === "maint" && maintDraft != null) || (kind === "comp" && compDraft != null);
  const titleId = useId();

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, close]);

  if (!ready || overlayWidthPx <= 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10 pointer-events-auto"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: "100dvh",
        maxHeight: "100dvh",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={close}
    >
      <div
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b border-slate-200 px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-slate-800">
            {heading}
          </h3>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
          {kind === "maint" && maintDraft ? (
            <MaintEdit draft={maintDraft} setDraft={setMaintDraft} attach={attach} />
          ) : null}
          {kind === "comp" && compDraft ? (
            <CompEdit draft={compDraft} setDraft={setCompDraft} attach={attach} />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-slate-200 px-3 py-1.5">
          <button type="button" className={btnPrimary} onClick={onSave}>
            저장
          </button>
          {canDelete ? (
            <button type="button" className={btnDanger} onClick={onDelete}>
              삭제
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
