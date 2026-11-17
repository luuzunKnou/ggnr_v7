"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeBikeRoadPathType,
  type BikeRoadSegment,
} from "./bikeRoadMock";

const headCellClass =
  "bg-muted px-1.5 py-1 text-[11px] font-normal leading-snug text-muted-foreground";
const bodyCellClass = "px-1.5 py-1 text-[11px] leading-snug";
const actionBtn = "standard-detail-action-btn inline-flex h-7 items-center gap-1";
const rowIconBtn =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors";

type Props = {
  segments: BikeRoadSegment[];
  activeId: string | null;
  onSelect: (seg: BikeRoadSegment) => void;
  isEditing?: boolean;
  onAdd?: () => void;
  onRemove?: (segmentId: string) => void;
};

function pathTypeLabel(pathType: string): string {
  return normalizeBikeRoadPathType(pathType) || pathType.trim() || "—";
}

/** 도로망도 구간 목록 셸 + 도로보상 «추가»·행 휴지통 */
export function BikeRoadSegmentListSection({
  segments,
  activeId,
  onSelect,
  isEditing = false,
  onAdd,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(true);

  return (
    <section className="shrink-0 border-b border-border">
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground/90"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="shrink-0">구간</span>
          <span className="min-w-0 truncate font-normal tabular-nums text-muted-foreground">
            ({segments.length})
          </span>
        </button>
        {isEditing && onAdd ? (
          <button
            type="button"
            className={cn(actionBtn, "shrink-0")}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="px-3 pb-2.5">
          {segments.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              {isEditing ? "«추가»로 구간을 넣으세요." : "구간이 없습니다."}
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto overflow-x-hidden overscroll-contain rounded-[5px] border border-border scrollbar-thin">
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[28%]" />
                  <col className="w-[28%]" />
                  <col className="w-[20%]" />
                  {isEditing ? <col className="w-[8%]" /> : null}
                </colgroup>
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b border-border">
                    <th scope="col" className={cn(headCellClass, "text-center")}>
                      번호
                    </th>
                    <th scope="col" className={headCellClass}>
                      노선명
                    </th>
                    <th scope="col" className={headCellClass}>
                      종류
                    </th>
                    <th scope="col" className={cn(headCellClass, "text-right")}>
                      연장
                    </th>
                    {isEditing ? (
                      <th scope="col" className={cn(headCellClass, "p-0")}>
                        <span className="sr-only">삭제</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s) => {
                    const active = activeId === s.id;
                    const typeLabel = pathTypeLabel(s.pathType);
                    return (
                      <tr
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        onClick={() => onSelect(s)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(s);
                          }
                        }}
                        className={cn(
                          "border-b border-border align-middle transition-colors last:border-b-0",
                          active
                            ? "bg-primary/[0.06] font-medium text-primary"
                            : "cursor-pointer text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        <td className={cn(bodyCellClass, "text-center tabular-nums")}>
                          {s.serialNo}
                        </td>
                        <td className={cn(bodyCellClass, "truncate")} title={s.routeName}>
                          {s.routeName || "—"}
                        </td>
                        <td className={cn(bodyCellClass, "truncate")} title={typeLabel}>
                          {typeLabel}
                        </td>
                        <td className={cn(bodyCellClass, "text-right tabular-nums")}>
                          {Number.isFinite(s.lengthKm) ? s.lengthKm.toFixed(2) : "—"}
                        </td>
                        {isEditing ? (
                          <td
                            className={cn(bodyCellClass, "p-0 text-center")}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onRemove ? (
                              <button
                                type="button"
                                onClick={() => onRemove(s.id)}
                                className={cn(
                                  rowIconBtn,
                                  "mx-auto hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                )}
                                aria-label="구간 삭제"
                                title="삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
