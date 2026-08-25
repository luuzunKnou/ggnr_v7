import { cn } from "@/lib/utils";

/** 도로점용 분석 등 패널 헤더 액션 버튼 공통 스타일 */
export const layerRowPanelButtonClass = (
  variant: "default" | "danger" = "default",
  extra?: string
) =>
  cn(
    "rounded border px-2 py-1 text-[11px] font-medium transition-colors",
    "disabled:opacity-60 disabled:cursor-not-allowed",
    variant === "default" && "border-border text-foreground hover:bg-muted/50",
    variant === "danger" && "border-red-200 text-red-600 hover:bg-red-50",
    extra
  );
