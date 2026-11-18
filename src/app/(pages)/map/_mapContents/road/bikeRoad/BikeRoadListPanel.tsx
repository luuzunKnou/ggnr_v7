"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LayerRowPanelButton } from "../../../_mapComponents/layerRowEdit";
import {
  BIKE_ROAD_MOCK_ROUTES,
  normalizeBikeRoadKind,
  type BikeRoadRoute,
} from "./bikeRoadMock";

type KindFilter = "전체" | "전용도로" | "겸용도로(양측)" | "겸용도로(편측)";

type Props = {
  onClose: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  routes?: BikeRoadRoute[];
};

function kindBadge(kind: string): {
  short: string;
  bg: string;
  text: string;
  border: string;
} {
  const normalized = normalizeBikeRoadKind(kind);
  if (normalized === "전용도로") {
    return {
      short: "전용",
      bg: "bg-chart-2/15",
      text: "text-chart-2",
      border: "border-chart-2/40",
    };
  }
  if (normalized === "겸용도로(편측)") {
    return {
      short: "편측",
      bg: "bg-amber-500/10",
      text: "text-amber-700 dark:text-amber-400",
      border: "border-amber-500/35",
    };
  }
  return {
    short: "양측",
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/30",
  };
}

function matchesKindFilter(kind: string, filter: KindFilter): boolean {
  if (filter === "전체") return true;
  return normalizeBikeRoadKind(kind) === filter;
}

export function BikeRoadListPanel({
  onClose,
  selectedId,
  onSelect,
  onAdd,
  routes = BIKE_ROAD_MOCK_ROUTES,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("전체");

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return routes.filter((r) => {
      if (!matchesKindFilter(r.kind, kindFilter)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q) ||
        r.direction.toLowerCase().includes(q) ||
        r.startPoint.toLowerCase().includes(q) ||
        r.endPoint.toLowerCase().includes(q) ||
        r.remark.toLowerCase().includes(q) ||
        r.totalLength.toLowerCase().includes(q)
      );
    });
  }, [routes, keyword, kindFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <h2 className="text-sm font-semibold text-foreground">자전거도로</h2>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            onClick={onAdd}
            title="노선 추가"
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            추가
          </LayerRowPanelButton>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-1.5 border-b border-border px-2.5 py-1.5">
        <div className="flex items-stretch gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="시점·종점·진행방향·비고 검색"
              className="h-8 w-full rounded border border-border bg-background pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>
        <div
          className="flex flex-wrap items-stretch gap-0.5"
          role="group"
          aria-label="구분 필터"
          title="구분"
        >
          {(
            [
              "전체",
              "전용도로",
              "겸용도로(양측)",
              "겸용도로(편측)",
            ] as const
          ).map((filter) => {
            const active = kindFilter === filter;
            const label =
              filter === "전체"
                ? "전체"
                : filter === "전용도로"
                  ? "전용"
                  : filter === "겸용도로(양측)"
                    ? "양측"
                    : "편측";
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setKindFilter(filter)}
                title={filter}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50"
                )}
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">
          목록 {filtered.length}건
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => {
              const active = r.id === selectedId;
              const badge = kindBadge(r.kind);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-l-[3px] px-3 py-1.5 text-left transition-colors",
                      active
                        ? "border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]"
                        : "border-l-transparent hover:bg-muted/50"
                    )}
                  >
                    <p
                      className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground"
                      title={r.title}
                    >
                      {r.title}
                    </p>
                    <span
                      className={cn(
                        "inline-flex w-[2.75rem] shrink-0 items-center justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                        badge.bg,
                        badge.text,
                        badge.border
                      )}
                      title={normalizeBikeRoadKind(r.kind)}
                    >
                      {badge.short}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
