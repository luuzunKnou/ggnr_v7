"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { call } from "@/lib/api";
import { formatAddressStripSidoSigungu } from "@/lib/formatAddressStripAdmin";
import { LayerRowAddButton, LayerRowPanelButton } from "../../../_mapComponents/layerRowEdit";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  RIVER_ILLEGAL_OCCUPATION_NEW_ID,
  getRiverIllegalOccupationCardsSnapshot,
  loadRiverIllegalOccupationCards,
  riverIllegalMgmtNoRank,
  splitRiverIllegalLines,
  useRiverIllegalOccupationCards,
  useRiverIllegalOccupationLoading,
  type RiverIllegalOccupationCard,
} from "./riverIllegalOccupationStore";
import { formatRiverIllegalCardDate } from "./riverIllegalOccupationFormat";
import { downloadRiverIllegalOccupationCardsPdf } from "./riverIllegalOccupationPrint";
import {
  riverIllegalColumnLabel,
  useRiverIllegalOccupationFieldLabels,
} from "./useRiverIllegalOccupationFieldLabels";
import {
  clearRiverIllegalOccupationWmsLayer,
  ensureRiverIllegalOccupationWmsLayer,
} from "./riverIllegalOccupationMapSync";

type SortKey = "serialNo" | "location" | "firstCheckYmd";
type SortDir = "asc" | "desc";
type SortSpec = { key: SortKey; dir: SortDir };

/** 접도구역 건축물 목록과 같은 정렬 머리 — 누를 때마다 오름 → 내림 → 해제, 여러 열 함께 */
const SORT_COLUMNS: { key: SortKey; align: "left" | "center" }[] = [
  { key: "serialNo", align: "left" },
  { key: "location", align: "left" },
  { key: "firstCheckYmd", align: "center" },
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
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const cards = useRiverIllegalOccupationCards();
  const loading = useRiverIllegalOccupationLoading();
  const fieldLabels = useRiverIllegalOccupationFieldLabels();
  const [keyword, setKeyword] = useState("");
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [pdfSaving, setPdfSaving] = useState(false);
  /** 서버 PDF 캐시 워밍 완료 전 — 전체 PDF 버튼 비활성 */
  const [pdfCacheReady, setPdfCacheReady] = useState(false);
  const [pdfCacheProgress, setPdfCacheProgress] = useState<{ cached: number; total: number }>({
    cached: 0,
    total: 0,
  });
  const sortColumns = useMemo(
    () =>
      SORT_COLUMNS.map((col) => ({
        ...col,
        label: riverIllegalColumnLabel(fieldLabels, col.key),
      })),
    [fieldLabels]
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollStatus = async () => {
      try {
        const res = await call("", "POST", {
          service: "riverIllegalOccupationService",
          action: "getPdfCacheStatus",
          params: {},
        });
        if (cancelled) return;
        const data = (res?.data ?? res) as {
          ready?: boolean;
          running?: boolean;
          cached?: number;
          total?: number;
          error?: string | null;
        };
        const total = Number(data?.total ?? 0);
        const cached = Number(data?.cached ?? 0);
        setPdfCacheProgress({ cached, total });
        if (data?.ready === true) {
          setPdfCacheReady(true);
          return;
        }
        // 워밍 실패해도 버튼은 열어 두어 저장 시 온디맨드 생성 가능
        if (data?.running === false && data?.error) {
          setPdfCacheReady(true);
          return;
        }
        setPdfCacheReady(false);
        timer = setTimeout(() => {
          void pollStatus();
        }, 1500);
      } catch {
        if (cancelled) return;
        setPdfCacheReady(true);
      }
    };

    void loadRiverIllegalOccupationCards().then(() => {
      if (cancelled) return;
      // 서버 디스크 캐시 미리 채움 → 완료 전 버튼 비활성
      void call("", "POST", {
        service: "riverIllegalOccupationService",
        action: "warmPdfCache",
        params: {},
      })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) void pollStatus();
        });
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    ensureRiverIllegalOccupationWmsLayer(mapContextRef.current?.setVisibleLayerNames);
    return () => {
      clearRiverIllegalOccupationWmsLayer(mapContextRef.current?.setVisibleLayerNames);
    };
  }, []);

  useEffect(() => {
    const pickRef = mapContext?.applyRiverIllegalOccupationMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const ogcFid = String(pick?.ogcFid ?? "").trim();
      if (ogcFid) {
        onSelectId(ogcFid);
        return;
      }
      const mgmtNo = String(pick?.mgmtNo ?? "").trim();
      if (!mgmtNo) return;
      const hit = getRiverIllegalOccupationCardsSnapshot().find(
        (c) => String(c.mgmtNo ?? "").trim() === mgmtNo
      );
      if (hit) onSelectId(hit.id);
    };
    return () => {
      pickRef.current = null;
    };
  }, [mapContext, onSelectId]);

  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const filtered = q
      ? cards.filter((c) =>
          [c.serialNo, c.location, c.riverType, splitRiverIllegalLines(c.actor).join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : [...cards];
    if (sorts.length > 0) return filtered.sort((a, b) => compareCards(a, b, sorts));
    // 기본: 최신 관리번호(숫자 큰 값) 위
    return filtered.sort((a, b) => riverIllegalMgmtNoRank(b.mgmtNo) - riverIllegalMgmtNoRank(a.mgmtNo));
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
          <LayerRowPanelButton
            loading={pdfSaving || (!pdfCacheReady && items.length > 0)}
            disabled={items.length === 0 || !pdfCacheReady || pdfSaving}
            title={
              !pdfCacheReady
                ? "관리카드 PDF를 서버에 준비하는 중입니다. 완료되면 저장할 수 있습니다."
                : "서버에 미리 만든 카드 PDF를 합쳐 받습니다(새로고침해도 유지)."
            }
            onClick={() => {
              if (pdfSaving || !pdfCacheReady) return;
              setPdfSaving(true);
              void downloadRiverIllegalOccupationCardsPdf(items)
                .catch((e: unknown) =>
                  window.alert(e instanceof Error ? e.message : "PDF 저장에 실패했습니다.")
                )
                .finally(() => setPdfSaving(false));
            }}
          >
            {pdfSaving || !pdfCacheReady ? null : <FileDown className="h-3 w-3" />}
            {pdfSaving
              ? "PDF 저장 중…"
              : !pdfCacheReady
                ? pdfCacheProgress.total > 0 &&
                  pdfCacheProgress.cached >= pdfCacheProgress.total
                  ? "합본 준비 중…"
                  : pdfCacheProgress.total > 0
                    ? `준비 중 (${pdfCacheProgress.cached}/${pdfCacheProgress.total})…`
                    : "준비 중…"
                : "전체 PDF 저장"}
          </LayerRowPanelButton>
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
                {sortColumns.map((col) => {
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
                    {loading
                      ? "불러오는 중..."
                      : keyword.trim()
                        ? "검색 결과가 없습니다."
                        : "목록이 비어 있습니다. 데이터 적재 후 새로고침하세요."}
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
