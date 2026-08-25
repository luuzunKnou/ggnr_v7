"use client";

import { useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AddressSearchPanel } from "../../../_mapComponents/addressSearch/AddressSearchPanel";
import type { VWorldAddressItem } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import type { RoadRewardParcel, RoadRewardParcelField } from "./roadRewardMock";

const fieldClass =
  "h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
/** 조회용 — 수정 input과 동일한 테두리·높이로 값이 잘 보이게 */
const fieldViewClass =
  "flex min-h-7 w-full min-w-0 items-center rounded border border-border bg-background px-1.5 text-[11px] text-foreground";
const fieldViewMultilineClass =
  "min-h-[2.75rem] w-full whitespace-pre-wrap break-all rounded border border-border bg-background px-2 py-1 text-xs text-foreground";
const labelClass = "mb-0.5 block text-[11px] text-muted-foreground";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";
const btnDanger =
  "inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-background px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40";

/** 주소 검색으로 채우는 필드 — 모달에서 개별 입력란 대신 검색 UI로 처리 */
const PARCEL_ADDR_SEARCH_FIELDS = new Set<string>(["eupmyeonDong", "jibunOriginal"]);

type Props = {
  parcel: RoadRewardParcel;
  isNew: boolean;
  /** true면 조회만 — 입력·저장 없음 */
  readOnly?: boolean;
  parcelFields: RoadRewardParcelField[];
  vworldApiKey: string;
  onFieldChange: (field: keyof RoadRewardParcel, value: string, numeric?: boolean) => void;
  onApplyParcelAddress: (item: VWorldAddressItem) => void;
  onSave: () => void;
  onClose: () => void;
  /** 수정 모드에서 필지 삭제 (신규·조회에는 없음) */
  onDelete?: () => void;
  /** 목록+상세 패널 전체 폭만 덮는 오버레이 위치 — 지도는 계속 보이고 조작 가능 */
  overlayLeftPx: number;
  overlayWidthPx: number;
};

function formatDisplayValue(parcel: RoadRewardParcel, field: keyof RoadRewardParcel, numeric?: boolean) {
  if (numeric) {
    const n = Number(parcel[field]);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
  }
  const s = String(parcel[field] ?? "").trim();
  return s || "—";
}

/** 필지 속성 시트 — 도로망도 유지보수·민원 모달과 동일 폼 방향 */
export function RoadRewardParcelModal({
  parcel,
  isNew,
  readOnly = false,
  parcelFields,
  vworldApiKey,
  onFieldChange,
  onApplyParcelAddress,
  onSave,
  onClose,
  onDelete,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  const parcelAddrQuery = `${parcel.eupmyeonDong} ${parcel.jibunOriginal}`.trim();
  const title = isNew ? "필지 추가" : readOnly ? "필지 상세" : "필지 정보";
  const canDelete = !readOnly && !isNew && typeof onDelete === "function";

  useEffect(() => {
    if (overlayWidthPx <= 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayWidthPx, close]);

  if (overlayWidthPx <= 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
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
        className="relative flex max-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          <div className="space-y-1.5">
            {/* 읍면동·지번(당초) — 유지보수 «현장 위치»처럼 상단 블록 */}
            <div>
              <span className={labelClass}>읍면동·지번(당초)</span>
              {readOnly ? (
                <div className={fieldViewClass}>{parcelAddrQuery || "—"}</div>
              ) : (
                <AddressSearchPanel
                  vworldApiKey={vworldApiKey}
                  layout="field"
                  placeholder="주소 검색 (지번/도로명) — 읍면동·지번(당초) 자동 입력"
                  initialQuery={parcelAddrQuery}
                  onClear={() => {
                    onFieldChange("eupmyeonDong", "");
                    onFieldChange("jibunOriginal", "");
                  }}
                  onSelect={onApplyParcelAddress}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {parcelFields.map(({ field, label, numeric, computed }) => {
                if (PARCEL_ADDR_SEARCH_FIELDS.has(field)) return null;

                /* —— 조회: 수정 input과 같은 bordered 박스 —— */
                if (readOnly) {
                  const full = field === "ownerAddress" || field === "note";
                  return (
                    <div key={field} className={full ? "col-span-2" : undefined}>
                      <span className={labelClass}>{label}</span>
                      <div
                        className={
                          field === "note" ? fieldViewMultilineClass : fieldViewClass
                        }
                      >
                        {formatDisplayValue(parcel, field, numeric || computed)}
                      </div>
                    </div>
                  );
                }

                /* —— 작성 —— */
                if (field === "ownerAddress") {
                  return (
                    <div key={field} className="col-span-2">
                      <span className={labelClass}>{label}</span>
                      <AddressSearchPanel
                        vworldApiKey={vworldApiKey}
                        layout="field"
                        placeholder="주소 검색 (도로명/지번)"
                        initialQuery={String(parcel.ownerAddress ?? "")}
                        onClear={() => onFieldChange("ownerAddress", "")}
                        onSelect={(item: VWorldAddressItem) => {
                          const address =
                            (item.roadAddress ?? "").trim() ||
                            (item.jibunAddress ?? "").trim() ||
                            (item.address ?? "").trim();
                          if (address) onFieldChange("ownerAddress", address);
                        }}
                      />
                    </div>
                  );
                }

                if (field === "note") {
                  return (
                    <label key={field} className="col-span-2 block">
                      <span className={labelClass}>{label}</span>
                      <textarea
                        className="min-h-[2.75rem] w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                        rows={2}
                        value={String(parcel.note ?? "")}
                        onChange={(e) => onFieldChange("note", e.target.value)}
                      />
                    </label>
                  );
                }

                if (computed) {
                  return (
                    <div key={field}>
                      <span className={labelClass}>{label}</span>
                      <div className={`${fieldViewClass} tabular-nums`}>
                        {(Number(parcel[field]) || 0).toLocaleString()}
                      </div>
                    </div>
                  );
                }

                return (
                  <label key={field} className="block">
                    <span className={labelClass}>{label}</span>
                    <input
                      type={numeric ? "number" : "text"}
                      value={String(parcel[field] ?? "")}
                      onChange={(e) => onFieldChange(field, e.target.value, numeric)}
                      className={fieldClass}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border px-3 py-1.5">
          {!readOnly ? (
            <button type="button" className={btnPrimary} onClick={onSave}>
              저장
            </button>
          ) : null}
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
