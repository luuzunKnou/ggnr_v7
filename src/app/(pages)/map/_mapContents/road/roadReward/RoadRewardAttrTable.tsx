"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RoadRewardAttrEntry = {
  fieldKey: string;
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
  required?: boolean;
};

function AttrLabelCell({
  label,
  required,
  borderBottom,
  roundedCorner,
}: {
  label: string;
  required?: boolean;
  borderBottom: boolean;
  roundedCorner?: "tl" | "bl";
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center border-r border-border bg-muted px-2",
        borderBottom && "border-b border-border",
        roundedCorner === "tl" && "rounded-tl-[5px]",
        roundedCorner === "bl" && "rounded-bl-[5px]"
      )}
    >
      <span className="whitespace-nowrap text-[11px] font-medium leading-snug text-muted-foreground">
        {label}
        {required ? <span className="standard-detail-attr-required" aria-hidden>*</span> : null}
      </span>
    </div>
  );
}

function AttrValueCell({
  value,
  borderBottom,
  borderRight,
  gridColumn,
}: {
  value: ReactNode;
  borderBottom: boolean;
  borderRight: boolean;
  gridColumn?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center px-2",
        borderBottom && "border-b border-border",
        borderRight && "border-r border-border"
      )}
      style={gridColumn ? { gridColumn } : undefined}
    >
      <div className="min-w-0 w-full">
        {typeof value === "string" ? (
          <span
            className="block truncate text-[11px] leading-snug text-foreground/90"
            title={value && value !== "—" ? value : undefined}
          >
            {value || "—"}
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

/**
 * 공사대장 속성정보와 같은 표 — 한 grid(라벨·값·라벨·값)로 묶어 라벨 칸 폭을 행끼리 맞춘다.
 * fullWidth 항목만 값 칸이 오른쪽 끝까지 이어진다.
 */
export function RoadRewardAttrTable({ entries }: { entries: RoadRewardAttrEntry[] }) {
  if (entries.length === 0) {
    return <p className="standard-detail-attr-empty">표시할 항목이 없습니다.</p>;
  }

  const rows: { left: RoadRewardAttrEntry; right?: RoadRewardAttrEntry }[] = [];
  for (let i = 0; i < entries.length; ) {
    const left = entries[i]!;
    const right = entries[i + 1];
    if (left.fullWidth || !right || right.fullWidth) {
      rows.push({ left });
      i += 1;
    } else {
      rows.push({ left, right });
      i += 2;
    }
  }

  return (
    <div
      className="grid overflow-visible rounded-[5px] border border-border"
      style={{ gridTemplateColumns: "max-content minmax(0,1fr) max-content minmax(0,1fr)" }}
    >
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        const borderBottom = !isLast;
        const roundedCorner = idx === 0 ? "tl" : isLast ? "bl" : undefined;
        if (!row.right) {
          return (
            <Fragment key={row.left.fieldKey}>
              <AttrLabelCell
                label={row.left.label}
                required={row.left.required}
                borderBottom={borderBottom}
                roundedCorner={roundedCorner}
              />
              <AttrValueCell
                value={row.left.value}
                borderBottom={borderBottom}
                borderRight={false}
                gridColumn="2 / -1"
              />
            </Fragment>
          );
        }
        return (
          <Fragment key={`${row.left.fieldKey}-${row.right.fieldKey}`}>
            <AttrLabelCell
              label={row.left.label}
              required={row.left.required}
              borderBottom={borderBottom}
              roundedCorner={roundedCorner}
            />
            <AttrValueCell value={row.left.value} borderBottom={borderBottom} borderRight />
            <AttrLabelCell label={row.right.label} required={row.right.required} borderBottom={borderBottom} />
            <AttrValueCell value={row.right.value} borderBottom={borderBottom} borderRight={false} />
          </Fragment>
        );
      })}
    </div>
  );
}
