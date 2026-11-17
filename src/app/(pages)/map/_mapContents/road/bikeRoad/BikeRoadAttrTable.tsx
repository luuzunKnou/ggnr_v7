"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const attrLabelClass = "w-[5.5rem] shrink-0";

export type BikeRoadAttrEntry = {
  fieldKey: string;
  label: string;
  value: ReactNode;
  /** true면 행 전체. 미지정이면 옆 칸과 2열 배치 */
  fullWidth?: boolean;
  /** 값 여러 줄(진행방향 등). 기본 1줄 truncate */
  multiline?: boolean;
};

function AttrRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: ReactNode;
  multiline?: boolean;
}) {
  const isControl = typeof value !== "string";
  return (
    <div className="flex min-w-0 items-stretch">
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center self-stretch bg-muted px-1.5 py-0.5",
          attrLabelClass
        )}
      >
        <span className="min-w-0 w-full whitespace-nowrap text-[11px] leading-snug text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "flex min-h-[22px] min-w-0 flex-1 items-center overflow-hidden px-1.5 py-0.5",
          isControl && "[&_input]:min-w-0 [&_select]:min-w-0 [&_select]:max-w-full"
        )}
      >
        {typeof value === "string" ? (
          <span
            className={cn(
              "block w-full min-w-0 text-[11px] leading-snug text-muted-foreground",
              multiline
                ? "whitespace-normal break-words line-clamp-2"
                : "truncate whitespace-nowrap"
            )}
            title={value === "—" ? undefined : value}
          >
            {value || "—"}
          </span>
        ) : (
          <div className="w-full min-w-0 max-w-full overflow-hidden">{value}</div>
        )}
      </div>
    </div>
  );
}

/** 도로망도·도로대장과 동일: 기본 2열, fullWidth만 행 전체 */
export function BikeRoadAttrTable({ entries }: { entries: BikeRoadAttrEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-[11px] text-muted-foreground">표시할 항목이 없습니다.</p>;
  }

  const normalized = entries.map((e) => ({
    ...e,
    value: typeof e.value === "string" ? e.value.trim() || "—" : e.value,
  }));

  const pairs: { left: (typeof normalized)[number]; right?: (typeof normalized)[number] }[] =
    [];
  for (let i = 0; i < normalized.length; ) {
    const left = normalized[i]!;
    if (left.fullWidth) {
      pairs.push({ left });
      i += 1;
      continue;
    }
    const right = normalized[i + 1];
    if (right && !right.fullWidth) {
      pairs.push({ left, right });
      i += 2;
    } else {
      pairs.push({ left });
      i += 1;
    }
  }

  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      {pairs.map((pair, rowIdx) => {
        const isLast = rowIdx === pairs.length - 1;
        if (!pair.right) {
          return (
            <div
              key={pair.left.fieldKey}
              className={cn(!isLast && "border-b border-border")}
            >
              <AttrRow
                label={pair.left.label}
                value={pair.left.value}
                multiline={pair.left.multiline}
              />
            </div>
          );
        }
        return (
          <div
            key={`${pair.left.fieldKey}-${pair.right.fieldKey}`}
            className={cn(
              "grid grid-cols-2 divide-x divide-border",
              !isLast && "border-b border-border"
            )}
          >
            <AttrRow
              label={pair.left.label}
              value={pair.left.value}
              multiline={pair.left.multiline}
            />
            <AttrRow
              label={pair.right.label}
              value={pair.right.value}
              multiline={pair.right.multiline}
            />
          </div>
        );
      })}
    </div>
  );
}
