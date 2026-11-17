"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { cleanRoadNetworkDisplayText } from "./roadNetworkFormat";
import {
  extent3857FromRoadNetworkGeoms,
  roadNetworkVisibleSiblingSegments,
} from "./roadNetworkGroup";
import { roadNetworkTypeHasAddress } from "./roadNetworkFields";
import { formatRoadNetworkLengthKm, type RoadNetworkRow } from "./roadNetworkMock";

const EMPTY_ROWS: RoadNetworkRow[] = [];
const SEGMENT_FIT_PADDING = [80, 80, 80, 80] as const;
const SEGMENT_FIT_MAX_ZOOM = Math.min(16, MAP_AUTO_NAV_MAX_ZOOM);

const headCellClass =
  "bg-muted px-1.5 py-1 text-[11px] font-normal leading-snug text-muted-foreground";
const bodyCellClass = "px-1.5 py-1 text-[11px] leading-snug";

type Props = {
  row: RoadNetworkRow;
  /** 편집 중에는 구간 전환 막음 */
  disabled?: boolean;
};

/** 같은 노선번호 구간 목록 — 구간이 2개 이상일 때만 표시 (속성정보와 같은 접기 섹션) */
export function RoadNetworkSegmentListSection({ row, disabled = false }: Props) {
  const mapContext = useMapContext();
  const rows = mapContext?.roadNetworkRows ?? EMPTY_ROWS;
  const setSelectedId = mapContext?.setRoadNetworkSelectedId;
  const wholeRoad = mapContext?.roadNetworkWholeRoad ?? false;
  const setWholeRoad = mapContext?.setRoadNetworkWholeRoad;
  const [open, setOpen] = useState(true);
  const activeRowRef = useRef<HTMLTableRowElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  const visibleRows = mapContext?.roadNetworkOverlayRows;
  const segments = useMemo(
    () => roadNetworkVisibleSiblingSegments(rows, visibleRows, row),
    [rows, visibleRows, row]
  );
  const showPlace = roadNetworkTypeHasAddress(row.roadType);

  /** 지도 클릭 등으로 선택 구간이 바뀌면 목록 안에서 보이도록 */
  useEffect(() => {
    const box = scrollBoxRef.current;
    const tr = activeRowRef.current;
    if (!box || !tr) return;
    const headH = box.querySelector("thead")?.offsetHeight ?? 0;
    const top = tr.offsetTop - headH;
    const bottom = tr.offsetTop + tr.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [row.id, open, wholeRoad]);

  if (segments.length < 2) return null;

  const currentIndex = wholeRoad ? -1 : segments.findIndex((s) => s.id === row.id);

  /** 구간 클릭=선택, 선택된 구간 다시 클릭=해제(노선 전체) */
  const handleSelect = (seg: RoadNetworkRow) => {
    if (disabled) return;
    const deselect = !wholeRoad && seg.id === row.id;
    if (!deselect) setSelectedId?.(seg.id);
    setWholeRoad?.(deselect);
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    const ext = extent3857FromRoadNetworkGeoms(
      deselect ? segments.map((s) => s.geom) : [seg.geom]
    );
    if (!ext) return;
    scheduleFitMapToExtent3857(map, ext, {
      fitPadding: [...SEGMENT_FIT_PADDING],
      maxZoom: SEGMENT_FIT_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

  return (
    <section className="shrink-0 border-b border-border">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
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
          구간
        </button>
        <span className="shrink-0 pr-1 text-[11px] tabular-nums text-muted-foreground">
          {currentIndex >= 0 ? `${currentIndex + 1} / ${segments.length}` : `전체 ${segments.length}`}
        </span>
      </div>
      {open ? (
        <div className="px-3 pb-2.5">
          <div
            ref={scrollBoxRef}
            className="max-h-40 overflow-y-auto overflow-x-hidden overscroll-contain rounded-[5px] border border-border scrollbar-thin"
          >
            <table className="w-full table-fixed border-collapse text-left">
              {showPlace ? (
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[34%]" />
                  <col className="w-[26%]" />
                  <col className="w-[22%]" />
                </colgroup>
              ) : (
                <colgroup>
                  <col className="w-[24%]" />
                  <col className="w-[44%]" />
                  <col className="w-[32%]" />
                </colgroup>
              )}
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-border">
                  <th scope="col" className={cn(headCellClass, "text-center")}>순번</th>
                  {showPlace ? (
                    <th scope="col" className={headCellClass}>읍면동</th>
                  ) : null}
                  <th scope="col" className={cn(headCellClass, "text-right")}>연장</th>
                  <th scope="col" className={cn(headCellClass, "text-center")}>개설</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg, i) => {
                  const active = !wholeRoad && seg.id === row.id;
                  const place = cleanRoadNetworkDisplayText(seg.address);
                  return (
                    <tr
                      key={seg.id}
                      ref={active ? activeRowRef : undefined}
                      role="button"
                      tabIndex={disabled ? -1 : 0}
                      aria-pressed={active}
                      title={active ? "다시 누르면 선택 해제(노선 전체)" : undefined}
                      onClick={() => handleSelect(seg)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelect(seg);
                        }
                      }}
                      className={cn(
                        "border-b border-border align-middle transition-colors last:border-b-0",
                        active
                          ? "bg-primary/[0.06] font-medium text-primary"
                          : disabled
                            ? "cursor-not-allowed text-muted-foreground opacity-50"
                            : "cursor-pointer text-muted-foreground hover:bg-muted/50"
                      )}
                    >
                      <td className={cn(bodyCellClass, "text-center tabular-nums")}>{i + 1}</td>
                      {showPlace ? (
                        <td className={cn(bodyCellClass, "truncate")} title={place || undefined}>
                          {place || "—"}
                        </td>
                      ) : null}
                      <td className={cn(bodyCellClass, "text-right tabular-nums")}>
                        {formatRoadNetworkLengthKm(Number(seg.lengthM))}
                      </td>
                      <td className={cn(bodyCellClass, "text-center")}>{seg.openStatus ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
