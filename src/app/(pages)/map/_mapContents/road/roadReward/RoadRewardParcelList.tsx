"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MapSideDetailScroll } from "../../../_mapComponents/MapSideDetailScroll";
import { sumRoadRewardCompensation, type RoadRewardParcel } from "./roadRewardMock";

/** 속성정보 수정·삭제 버튼과 같은 높이 */
const actionBtn = "standard-detail-action-btn inline-flex h-7 items-center gap-1";
const rowIconBtn =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors";

/** 주소 칸이 남는 폭을 쓰도록 나머지는 내용 폭에 맞춤 (합계 억 단위·관리 버튼 2개 기준) */
const PARCEL_ROW_COLS = "grid-cols-[minmax(0,1fr)_3rem_4.75rem_5.5rem]";
const PARCEL_ROW_COLS_EDIT = "grid-cols-[minmax(0,1fr)_3rem_4.75rem_5.5rem_3.5rem]";

type Props = {
  isEditing: boolean;
  items: RoadRewardParcel[];
  selectedId: string | null;
  loading?: boolean;
  onAdd?: () => void;
  onClick: (parcel: RoadRewardParcel) => void;
  onEdit?: (parcel: RoadRewardParcel) => void;
  onRemove?: (parcelId: string) => void;
  registerItemEl: (parcelId: string, el: HTMLElement | null) => void;
};

export function roadRewardParcelAddress(p: RoadRewardParcel): string {
  return `${p.eupmyeonDong} ${p.jibunIncluded || p.jibunOriginal}`.trim();
}

function formatNumber(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

/** 필지목록 — 접도구역 표주목록과 같은 탭 머리·한 행 표 (주소·지목·편입면적·합계) */
export function RoadRewardParcelList({
  isEditing,
  items,
  selectedId,
  loading = false,
  onAdd,
  onClick,
  onEdit,
  onRemove,
  registerItemEl,
}: Props) {
  const cols = isEditing ? PARCEL_ROW_COLS_EDIT : PARCEL_ROW_COLS;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2"
        role="tablist"
        aria-label="필지목록"
      >
        <div className="flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch pt-1.5">
          <button
            type="button"
            role="tab"
            aria-selected
            className="relative flex shrink-0 items-center px-2.5 pb-1.5 text-[11px] font-medium text-primary"
          >
            필지목록 ({items.length.toLocaleString()})
            <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-primary" />
          </button>
          {loading ? (
            <span className="flex items-center pb-1.5 text-[10px] text-muted-foreground">조회 중…</span>
          ) : null}
        </div>
        {isEditing && onAdd ? (
          <button type="button" className={cn(actionBtn, "mr-1")} onClick={onAdd}>
            <Plus className="h-3 w-3" />
            추가
          </button>
        ) : null}
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2.5 text-xs">
        {items.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            {loading
              ? "필지목록 조회 중…"
              : isEditing
                ? "도형을 그리거나 수정하면 필지목록이 자동으로 채워집니다."
                : "등록된 필지가 없습니다."}
          </p>
        ) : (
          <div className="w-full overflow-hidden rounded border border-border text-[11px]">
            <div className={cn("grid h-8 items-center border-b border-border bg-muted", cols)}>
              <div className="min-w-0 px-2 text-left font-semibold text-foreground">주소</div>
              <div className="px-1 text-center font-semibold text-foreground">지목</div>
              <div className="px-1 text-right font-semibold whitespace-nowrap text-foreground">편입면적(㎡)</div>
              <div className="px-2 text-right font-semibold whitespace-nowrap text-foreground">합계(원)</div>
              {isEditing ? <div className="px-1 text-center font-semibold text-foreground">관리</div> : null}
            </div>
            {items.map((p) => {
              const selected = p.id === selectedId;
              const addr = roadRewardParcelAddress(p);
              const jimok = p.jimok?.trim() || "—";
              const area = formatNumber(p.areaIncluded);
              const total = formatNumber(sumRoadRewardCompensation(p));
              return (
                <div
                  key={p.id}
                  ref={(el) => registerItemEl(p.id, el)}
                  role="button"
                  tabIndex={0}
                  onClick={() => onClick(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onClick(p);
                    }
                  }}
                  title={isEditing ? "클릭하면 지도에서 위치를 확인합니다" : "클릭하면 필지 상세를 봅니다"}
                  className={cn(
                    "grid min-h-8 cursor-pointer items-center border-b border-border last:border-b-0 hover:bg-muted/50",
                    cols,
                    selected && "bg-primary/5"
                  )}
                >
                  <div
                    className="min-w-0 whitespace-normal break-keep px-2 py-1 text-left leading-snug text-foreground [overflow-wrap:anywhere]"
                    title={addr || undefined}
                  >
                    {addr || "—"}
                  </div>
                  <div className="truncate px-1 text-center text-foreground" title={jimok}>
                    {jimok}
                  </div>
                  <div className="truncate px-1 text-right tabular-nums text-foreground" title={`${area}㎡`}>
                    {area}
                  </div>
                  <div className="truncate px-2 text-right tabular-nums text-foreground" title={`${total}원`}>
                    {total}
                  </div>
                  {isEditing ? (
                    <div
                      className="flex w-full shrink-0 items-center justify-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onEdit ? (
                        <button
                          type="button"
                          onClick={() => onEdit(p)}
                          className={cn(rowIconBtn, "hover:bg-primary/10 hover:text-primary")}
                          aria-label="필지 수정"
                          title="수정"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {onRemove ? (
                        <button
                          type="button"
                          onClick={() => onRemove(p.id)}
                          className={cn(
                            rowIconBtn,
                            "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          )}
                          aria-label="필지 삭제"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );
}
