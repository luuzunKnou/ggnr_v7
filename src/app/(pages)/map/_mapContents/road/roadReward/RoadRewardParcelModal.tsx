"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AddressSearchPanel } from "../../../_mapComponents/addressSearch/AddressSearchPanel";
import type { VWorldAddressItem } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import type { RoadRewardParcel, RoadRewardParcelField } from "./roadRewardMock";

const fieldClass =
  "h-7 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const fieldReadonlyClass =
  "min-h-7 w-full min-w-0 rounded border border-slate-100 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnGhost =
  "inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50";

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

/** 필지 속성 시트 — 조회(readOnly) / 편집 */
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
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  if (overlayWidthPx <= 0 || typeof document === "undefined") return null;

  const parcelAddrQuery = `${parcel.eupmyeonDong} ${parcel.jibunOriginal}`.trim();
  const title = isNew ? "필지 추가" : readOnly ? "필지 상세" : "필지 정보";

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/40 p-6"
      style={{ left: overlayLeftPx, top: 0, width: overlayWidthPx, height: "100dvh", maxHeight: "100dvh" }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-hide">
          {readOnly ? (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">읍면동·지번(당초)</span>
              <div className={fieldReadonlyClass}>{parcelAddrQuery || "—"}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">읍면동·지번(당초)</span>
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
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
            {parcelFields.map(({ field, label, numeric, computed }) => {
              if (PARCEL_ADDR_SEARCH_FIELDS.has(field)) return null;

              if (readOnly) {
                return (
                  <div
                    key={field}
                    className={
                      field === "ownerAddress" || field === "note"
                        ? "col-span-2 flex flex-col gap-1 text-xs"
                        : "flex flex-col gap-1 text-xs"
                    }
                  >
                    <span className="font-medium text-slate-600">{label}</span>
                    <div className={fieldReadonlyClass}>
                      {formatDisplayValue(parcel, field, numeric || computed)}
                    </div>
                  </div>
                );
              }

              if (field === "ownerAddress") {
                return (
                  <div key={field} className="col-span-2 flex flex-col gap-1 text-xs">
                    <span className="font-medium text-slate-600">{label}</span>
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
              if (computed) {
                const hint =
                  field === "appliedUnitPrice"
                    ? "감정가 평균"
                    : field === "compensationAmount"
                      ? "단가 × 편입면적"
                      : "";
                return (
                  <label key={field} className="flex flex-col gap-1 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-slate-600">
                      {label}
                      <span className="rounded bg-sky-100 px-1 py-px text-[10px] font-semibold text-sky-700">
                        자동
                      </span>
                    </span>
                    <span className="rounded border border-sky-100 bg-sky-50/80 px-2 py-1 text-xs font-medium tabular-nums text-slate-700">
                      {(Number(parcel[field]) || 0).toLocaleString()}
                    </span>
                    {hint ? <span className="text-[10px] text-sky-700/80">{hint}</span> : null}
                  </label>
                );
              }
              return (
                <label key={field} className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-slate-600">{label}</span>
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

        {!readOnly ? (
          <div className="flex shrink-0 items-center justify-end gap-1 border-t border-slate-100 bg-white px-4 py-2.5">
            <button type="button" className={btnPrimary} onClick={onSave}>
              저장
            </button>
            <button type="button" className={btnGhost} onClick={onClose}>
              취소
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
