"use client";

import { Check, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BikeRoadDrawSideMode } from "./useBikeRoadSegmentDraw";

type Props = {
  mode: BikeRoadDrawSideMode;
  pointCount: number;
  busy?: boolean;
  notice?: string | null;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
  className?: string;
};

const btn =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50";
const btnPrimary =
  "inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-50";

/** 지도 위 구간 그리기 안내 */
export function BikeRoadSegmentDrawBanner({
  mode,
  pointCount,
  busy,
  notice,
  onFinish,
  onUndo,
  onCancel,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] flex-col gap-1.5 rounded-md border border-border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm",
        className
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">
          구간 추가 · {mode === "both" ? "양측" : "편측"}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          점 {pointCount}
        </span>
        <div className="ml-auto flex items-center gap-1">
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
            className={btnPrimary}
            disabled={busy || pointCount < 2}
            onClick={onFinish}
          >
            <Check className="h-3.5 w-3.5" />
            완료
          </button>
          <button type="button" className={btn} disabled={busy} onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
            취소
          </button>
        </div>
      </div>
      {notice ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{notice}</p>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          도로구간 위에서 기점·경유·종점을 순서대로 찍으세요.
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

/** 양측/편측 선택 팝오버 */
export function BikeRoadSegmentSidePick({ open, onPick, onClose }: SidePickProps) {
  if (!open) return null;
  return (
    <div className="absolute right-2 top-8 z-20 w-52 rounded-md border border-border bg-background p-2 shadow-lg">
      <p className="mb-2 text-[11px] font-semibold text-foreground">구간 추가</p>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="rounded border border-border px-2 py-1.5 text-left text-[11px] hover:bg-muted/50"
          onClick={() => onPick("both")}
        >
          양측 — 평행 두 줄 · 표 두 행
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-1.5 text-left text-[11px] hover:bg-muted/50"
          onClick={() => onPick("one")}
        >
          편측 — 한 줄 · 표 한 행
        </button>
        <button
          type="button"
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          취소
        </button>
      </div>
    </div>
  );
}
