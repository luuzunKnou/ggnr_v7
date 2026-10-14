"use client";

import { Waves } from "lucide-react";
import { cn } from "@/lib/utils";

export type RiverPlanAreaMode = "fill" | "line" | "off";

const NEXT_MODE: Record<RiverPlanAreaMode, RiverPlanAreaMode> = {
  fill: "line",
  line: "off",
  off: "fill",
};

const MODE_LABEL: Record<RiverPlanAreaMode, string> = {
  fill: "켜기",
  line: "선만",
  off: "끄기",
};

/** 상세 버튼 줄 «하천구역» — 누를 때마다 켜기 → 선만 → 끄기 순환 */
export function RiverPlanAreaModeButton({
  mode,
  onChange,
}: {
  mode: RiverPlanAreaMode;
  onChange: (mode: RiverPlanAreaMode) => void;
}) {
  const next = NEXT_MODE[mode];
  return (
    <button
      type="button"
      title={`하천구역: ${MODE_LABEL[mode]} (누르면 ${MODE_LABEL[next]})`}
      onClick={() => onChange(next)}
      className={cn(
        "h-7 w-full text-[11px] rounded border min-w-0 overflow-hidden px-0.5 whitespace-nowrap inline-flex items-center justify-center gap-0.5",
        mode === "fill"
          ? "border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15"
          : mode === "line"
            ? "border-2 border-dashed border-primary/70 bg-background text-foreground hover:bg-primary/5"
            : "border-border bg-muted/50 text-foreground/90 hover:bg-muted",
      )}
    >
      <Waves className="h-3.5 w-3.5 shrink-0" />
      하천구역
    </button>
  );
}
