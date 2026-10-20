"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAddressStripSidoSigungu } from "@/lib/formatAddressStripAdmin";
import { LayerRowAddButton } from "../../../_mapComponents/layerRowEdit";
import {
  RIVER_ILLEGAL_OCCUPATION_NEW_ID,
  splitRiverIllegalLines,
  useRiverIllegalOccupationCards,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import { formatRiverIllegalCardDate } from "./riverIllegalOccupationFormat";

type SortKey = "serialNo" | "location" | "firstCheckYmd";
type SortDir = "asc" | "desc";
type SortSpec = { key: SortKey; dir: SortDir };

/** 접도구역 건축물 목록과 같은 정렬 머리 — 누를 때마다 오름 → 내림 → 해제, 여러 열 함께 */
const SORT_COLUMNS: { key: SortKey; label: string; align: "left" | "center" }[] = [
  { key: "serialNo", label: "연번", align: "left" },
  { key: "location", label: "위치", align: "left" },
  { key: "firstCheckYmd", label: "최초확인일자", align: "center" },
];

function compareCards(a: RiverIllegalOccupationCard, b: RiverIllegalOccupationCard, sorts: SortSpec[]): number {
  for (const { key, dir } of sorts) {
    const av = String(a[key] ?? "").trim();
    const bv = String(b[key] ?? "").trim();
    /** 빈 값은 방향과 관계없이 뒤로 */
    if (!av && bv) return 1;
    if (av && !bv) return -1;
    const c = av.localeCompare(bv, "ko", { numeric: true });
    if (c !== 0) return dir === "asc" ? c : -c;
  }
  return 0;
}

type Props = {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onClose: () => void;
};

/** 불법점용 관리카드 목록 — 접도구역 건축물 목록과 같은 구성 */
export function RiverIllegalOccupationListPanel({ selectedId, onSelectId, onClose }: Props) {
  const cards = useRiverIllegalOccupationCards();
  const [keyword, setKeyword] = useState("");
  const [sorts, setSorts] = useState<SortSpec[]>([]);

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const filtered = q
      ? cards.filter((c) =>
          [c.serialNo, c.location, c.riverType, splitRiverIllegalLines(c.actor).join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : cards;
    return sorts.length > 0 ? [...filtered].sort((a, b) => compareCards(a, b, sorts)) : filtered;
  }, [cards, keyword, sorts]);

  const toggleSort = (key: SortKey) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx < 0) return [...prev, { key, dir: "asc" }];
      if (prev[idx]!.dir === "asc") {
        const next = [...prev];
        next[idx] = { key, dir: "desc" };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title truncate">불법점용 관리카드</span>
        <div className="flex items-center gap-1">
          <LayerRowAddButton
            onClick={() => onSelectId(RIVER_ILLEGAL_OCCUPATION_NEW_ID)}
            disabled={selectedId === RIVER_ILLEGAL_OCCUPATION_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (연번, 위치, 하천구분, 행위자)"
            className="standard-search-input"
          />
        </div>
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table w-full table-fixed">
            <colgroup>
              <col className="w-[34%]" />
              <col />
              <col className="w-[100px]" />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const dir = active ? sorts[sortIdx]!.dir : null;
                  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        "standard-table-th",
                        col.align === "center" ? "standard-table-th-center" : "standard-table-th-left"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "standard-sort-button",
                          col.align === "center" ? "standard-sort-button-center" : "standard-sort-button-left",
                          active && "standard-sort-button-active"
                        )}
                        title={
                          !active
                            ? `${col.label} 정렬 추가`
                            : dir === "asc"
                              ? `${col.label} 방향 바꾸기`
                              : `${col.label} 정렬 해제`
                        }
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="standard-table-empty">
                    {keyword.trim() ? "검색 결과가 없습니다." : "등록된 관리카드가 없습니다."}
                  </td>
                </tr>
              ) : (
                items.map((c) => {
                  const isSelected = c.id === selectedId;
                  const loc = formatAddressStripSidoSigungu(c.location) || c.location || "(위치 미입력)";
                  return (
                    <tr
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectId(c.id);
                        }
                      }}
                      className={cn("standard-list-row", isSelected && "standard-list-row-selected")}
                    >
                      <td className="standard-table-td-text" title={c.serialNo}>
                        {c.serialNo || "(연번 미입력)"}
                      </td>
                      <td className="standard-table-td-text-muted" title={c.location}>
                        {loc}
                      </td>
                      <td className="standard-table-td-date text-center" title={c.firstCheckYmd}>
                        {formatRiverIllegalCardDate(c.firstCheckYmd) || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          {items.length.toLocaleString()}건
          {keyword.trim() && items.length !== cards.length ? ` / 전체 ${cards.length.toLocaleString()}건` : ""}
        </div>
      </div>
    </div>
  );
}
