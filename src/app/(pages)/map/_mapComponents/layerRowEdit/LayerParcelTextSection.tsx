"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMapContext } from "../MapContext";
import { LayerParcelAddModal } from "./LayerParcelAddModal";
import { LayerRowPanelButton } from "./LayerRowPanelButton";
import type { LayerRowParcelItem } from "./types";

type Props = {
  isEditing: boolean;
  draftParcels: LayerRowParcelItem[];
  onAddParcel: (item: LayerRowParcelItem) => void;
  onRemoveParcel: (index: number) => void;
  parcels: LayerRowParcelItem[];
  movingParcelIdx: number | null;
  onParcelClick: (item: LayerRowParcelItem, idx: number) => void;
  /** 편집 중 빈 목록 안내 (미지정 시 기본 문구) */
  emptyEditingHint?: string;
  /** 목록 ul max-height 클래스 (기본 max-h-48) */
  listMaxHeightClassName?: string;
  /** 제목 줄 상단 여백 제거 등 */
  dense?: boolean;
};

export function LayerParcelTextSection({
  isEditing,
  draftParcels,
  onAddParcel,
  onRemoveParcel,
  parcels,
  movingParcelIdx,
  onParcelClick,
  emptyEditingHint,
  listMaxHeightClassName = "max-h-48",
  dense = false,
}: Props) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  const [addModalOpen, setAddModalOpen] = useState(false);

  const listItems = isEditing ? draftParcels : parcels;

  return (
    <>
      <div
        className={cn(
          "mb-1 flex items-center justify-between gap-2",
          dense ? "mt-1" : "mt-4"
        )}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          필지목록
          {listItems.length > 0 ? (
            <span className="ml-1 font-normal normal-case text-slate-400">({listItems.length})</span>
          ) : null}
        </div>
        {isEditing && (
          <LayerRowPanelButton className="h-6 px-2 text-[10px]" onClick={() => setAddModalOpen(true)}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            추가
          </LayerRowPanelButton>
        )}
      </div>

      {listItems.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 bg-slate-50/80 px-2 py-2 text-slate-500">
          {isEditing
            ? emptyEditingHint ??
              "도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다. 「추가」로 직접 등록할 수도 있습니다."
            : "등록된 필지가 없습니다."}
        </div>
      ) : (
        <ul
          className={cn(
            "list-none space-y-0 overflow-y-auto overscroll-contain rounded border border-slate-200 bg-white scrollbar-hide",
            listMaxHeightClassName
          )}
        >
          {listItems.map((item, i) => (
            <li
              key={`${i}-${item.address.slice(0, 24)}`}
              className="flex items-start gap-1 border-b border-slate-100 px-2 py-1.5 text-slate-800 last:border-b-0"
            >
              {isEditing ? (
                <>
                  <button
                    type="button"
                    className={cn(
                      "flex min-w-0 flex-1 items-start gap-1 text-left text-xs text-slate-800 hover:text-primary",
                      "disabled:cursor-default disabled:opacity-70"
                    )}
                    onClick={() => onParcelClick(item, i)}
                    title="클릭 시 위치 이동"
                  >
                    <span className="mr-1 shrink-0 tabular-nums text-slate-400">{i + 1}.</span>
                    <span className="min-w-0 flex-1 break-words">
                      {item.displayText?.trim() || item.address}
                    </span>
                    {movingParcelIdx === i && (
                      <span className="ml-1 shrink-0 text-[11px] text-slate-500">이동 중…</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onRemoveParcel(i)}
                    aria-label="필지 삭제"
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={cn(
                    "w-full text-left text-slate-800 hover:text-primary",
                    "disabled:cursor-default disabled:opacity-70"
                  )}
                  onClick={() => onParcelClick(item, i)}
                  title="클릭 시 위치 이동"
                >
                  <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                  {item.displayText?.trim() || item.address}
                  {movingParcelIdx === i && <span className="ml-2 text-[11px] text-slate-500">이동 중…</span>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <LayerParcelAddModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        vworldApiKey={vworldApiKey}
        onAdd={onAddParcel}
      />
    </>
  );
}
