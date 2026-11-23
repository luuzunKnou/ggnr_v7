"use client";

import { Check, ListChecks, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BikeRoadDrawSideMode } from "./useBikeRoadSegmentDraw";

type Props = {
  mode: BikeRoadDrawSideMode | null;
  pointCount: number;
  draftCount: number;
  busy?: boolean;
  notice?: string | null;
  onPickSide: (mode: BikeRoadDrawSideMode) => void;
  onConfirmLine: () => void;
  onCommitAll: () => void;
  onUndo: () => void;
  onCancel: () => void;
  className?: string;
};

const btn =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";
const btnSide =
  "inline-flex h-7 items-center rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50";
const btnSideActive =
  "inline-flex h-7 items-center rounded border border-primary bg-primary/10 px-2.5 text-[11px] font-semibold text-primary";

function sideLabel(mode: BikeRoadDrawSideMode | null): string {
  if (mode === "both") return "양측";
  if (mode === "C") return "편측";
  return "측 선택";
}

/** 지도 위 구간 그리기 안내 */
export function BikeRoadSegmentDrawBanner({
  mode,
  pointCount,
  draftCount,
  busy,
  notice,
  onPickSide,
  onConfirmLine,
  onCommitAll,
  onUndo,
  onCancel,
  className,
}: Props) {
  const pickingSide = mode == null || pointCount === 0;

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[min(42rem,calc(100vw-2rem))] flex-col gap-1.5 rounded-md border border-border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm",
        className
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">
          구간 추가 · {sideLabel(mode)}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          점 {pointCount}
          {draftCount > 0 ? ` · 초안 ${draftCount}줄` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            className={btn}
            disabled={busy || pointCount === 0}
            onClick={onUndo}
            title="마지막 점 지우기"
          >
            <Undo2 className="h-3.5 w-3.5" />
            되돌리기
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || pointCount < 2 || mode == null}
            onClick={onConfirmLine}
            title="현재 줄을 초안에 넣기"
          >
            <Check className="h-3.5 w-3.5" />
            이 줄 확정
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || draftCount === 0}
            onClick={onCommitAll}
            title="초안을 표에 한꺼번에 반영"
          >
            <ListChecks className="h-3.5 w-3.5" />
            일괄 반영
          </button>
          <button type="button" className={btn} disabled={busy} onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
            취소
          </button>
        </div>
      </div>
      {pickingSide ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">측</span>
          {(
            [
              ["C", "편측"],
              ["both", "양측"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={mode === id ? btnSideActive : btnSide}
              disabled={busy}
              onClick={() => onPickSide(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {notice ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{notice}</p>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          도로를 따라 점을 찍으세요. «편측»은 한 줄, «양측»은 좌·우 이중선으로
          한 번에 그립니다.
        </p>
      )}
    </div>
  );
}

type SidePickProps = {
  open: boolean;
  onPick: (mode: BikeRoadDrawSideMode) => void;
  onClose: () => void;
};

/** 목록 «추가»용 — 세션 시작 시 측 선택 */
export function BikeRoadSegmentSidePick({ open, onPick, onClose }: SidePickProps) {
  if (!open) return null;
  return (
    <div className="absolute right-2 top-8 z-20 w-56 rounded-md border border-border bg-background p-2 shadow-lg">
      <p className="mb-2 text-[11px] font-semibold text-foreground">구간 추가</p>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="rounded border border-border px-2 py-1.5 text-left text-[11px] hover:bg-muted/50"
          onClick={() => onPick("C")}
        >
          편측 — 한 줄
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-1.5 text-left text-[11px] hover:bg-muted/50"
          onClick={() => onPick("both")}
        >
          양측 — 한 번 긋기로 좌·우 두 줄
        </button>
        <button
          type="button"
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
