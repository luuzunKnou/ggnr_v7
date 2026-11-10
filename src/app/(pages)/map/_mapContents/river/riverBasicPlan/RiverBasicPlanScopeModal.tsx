"use client";

import { FolderTree, List, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/app/shadcnComponents/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";

export type RiverBasicPlanListAxis = "byPlan" | "byRiver";

const SCOPES: {
  axis: RiverBasicPlanListAxis;
  label: string;
  hint: string;
  Icon: typeof FolderTree;
  tone: { card: string; icon: string };
}[] = [
  {
    axis: "byPlan",
    label: "보고서별",
    hint: "보고서를 기준으로 소속 하천을 봅니다",
    Icon: FolderTree,
    tone: {
      card: "hover:border-primary/40 hover:bg-primary/5",
      icon: "bg-primary/15 text-primary group-hover:bg-primary/25",
    },
  },
  {
    axis: "byRiver",
    label: "하천별",
    hint: "하천을 기준으로 기본계획을 봅니다",
    Icon: List,
    tone: {
      card: "hover:border-emerald-500/40 hover:bg-emerald-500/5",
      icon: "bg-emerald-500/15 text-emerald-600 group-hover:bg-emerald-500/25 dark:text-emerald-400",
    },
  },
];

type Props = {
  open: boolean;
  selectedAxis: RiverBasicPlanListAxis | null;
  onSelect: (axis: RiverBasicPlanListAxis) => void;
  onClose: () => void;
};

/** 기본계획 시작 — 보고서별 / 하천별 보기 선택 */
export function RiverBasicPlanScopeModal({ open, selectedAxis, onSelect, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="z-[60] flex max-h-[min(560px,88vh)] flex-col gap-0 overflow-hidden rounded-[5px] border-border p-0 shadow-xl sm:max-w-[560px]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 pt-3 pb-2">
          <DialogTitle className="text-lg font-medium leading-tight text-foreground">
            목록 보기 선택
          </DialogTitle>
          <DialogDescription className="sr-only">
            보고서별 또는 하천별로 목록을 봅니다.
          </DialogDescription>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <p className="mb-3 text-sm text-muted-foreground">
            목록을 어떤 기준으로 볼지 선택하면 이 창이 닫히고 목록이 열립니다.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {SCOPES.map((s) => {
              const active = selectedAxis === s.axis;
              const Icon = s.Icon;
              return (
                <button
                  key={s.axis}
                  type="button"
                  onClick={() => onSelect(s.axis)}
                  className={cn(
                    "group flex cursor-pointer flex-col items-center gap-3 rounded-xl border bg-background p-5 text-center shadow-sm transition-all hover:shadow-md",
                    active ? "border-primary/60" : "border-border",
                    s.tone.card
                  )}
                >
                  <span
                    className={cn(
                      "flex size-12 items-center justify-center rounded-full transition-colors",
                      s.tone.icon
                    )}
                  >
                    <Icon className="size-6" />
                  </span>
                  <span className="text-[15px] font-medium text-foreground">{s.label}</span>
                  <span className="whitespace-nowrap text-xs leading-snug text-muted-foreground">
                    {s.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border bg-muted/50 px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
