"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Search, X } from "lucide-react";
import { Input } from "@/app/shadcnComponents/ui/input";
import { searchAddress, searchAddressAndPlace, type VWorldAddressItem } from "./vworldAddressSearch";

const ADDRESS_DEBOUNCE_MS = 300;
const ADDRESS_RESULT_MAX = 8;
const RECENT_QUERIES_KEY = "map-address-recent";
const RECENT_QUERIES_MAX = 10;

function loadRecentQueries(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_QUERIES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, RECENT_QUERIES_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecentQueries(queries: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(queries.slice(0, RECENT_QUERIES_MAX)));
  } catch {
    // ignore
  }
}

type Props = {
  vworldApiKey: string;
  onSelect: (item: VWorldAddressItem) => void;
  placeholder?: string;
  /** 저장된·선택된 주소 — 마운트·변경 시 검색창에 반영 */
  initialQuery?: string;
  /** 검색어 지우기 시 (폼 주소 비우기 등) */
  onClear?: () => void;
  /** field: 타이핑한 값을 폼에 그대로 반영 (선택 없이 직접 입력) */
  onQueryChange?: (query: string) => void;
  /**
   * default: 지도용 전체 패널
   * field: 폼 Input 한 칸 대체(결과만 드롭다운)
   */
  layout?: 'default' | 'field';
  /** field일 때 표 칸 높이에 맞춤 */
  compact?: boolean;
  /** true면 주소(도로명·지번)와 장소(POI)를 함께 검색 */
  includePlace?: boolean;
};

/** 지도 map-search-bar와 동일한 VWorld 주소검색 UI */
export function AddressSearchPanel({
  vworldApiKey,
  onSelect,
  placeholder = "주소/지번 검색",
  initialQuery = '',
  onClear,
  onQueryChange,
  layout = 'default',
  compact = false,
  includePlace = false,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [addressResults, setAddressResults] = useState<VWorldAddressItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => loadRecentQueries());
  /** field: 선택·초기값 반영 직후 재검색·드롭다운 억제 */
  const [dropdownClosed, setDropdownClosed] = useState(true);
  const isField = layout === 'field';
  /** onQueryChange로 올린 값 — 같은 값이 initialQuery로 돌아오면 드롭다운을 닫지 않음 */
  const lastEmittedQueryRef = useRef(initialQuery ?? '');

  useEffect(() => {
    const next = initialQuery ?? '';
    if (next === lastEmittedQueryRef.current) {
      setQuery(next);
      return;
    }
    lastEmittedQueryRef.current = next;
    setQuery(next);
    if (isField) {
      setAddressResults([]);
      setDropdownClosed(true);
    }
  }, [initialQuery, isField]);

  const addRecentQuery = useCallback((trimmed: string) => {
    if (!trimmed) return;
    setRecentQueries((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, RECENT_QUERIES_MAX);
      saveRecentQueries(next);
      return next;
    });
  }, []);

  const removeRecentQuery = useCallback((target: string) => {
    setRecentQueries((prev) => {
      const next = prev.filter((q) => q !== target);
      saveRecentQueries(next);
      return next;
    });
  }, []);

  const clearRecentQueries = useCallback(() => {
    setRecentQueries([]);
    saveRecentQueries([]);
  }, []);

  const runSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed || !vworldApiKey) {
        setAddressResults([]);
        return;
      }
      setLoading(true);
      const search = includePlace ? searchAddressAndPlace : searchAddress;
      search(trimmed, {
        maxResults: ADDRESS_RESULT_MAX,
        type: "address",
        apiKey: vworldApiKey,
      })
        .then((items) => setAddressResults(items))
        .finally(() => setLoading(false));
    },
    [includePlace, vworldApiKey]
  );

  useEffect(() => {
    if (isField && dropdownClosed) {
      setAddressResults([]);
      return;
    }
    if (!query.trim()) {
      setAddressResults([]);
      return;
    }
    if (!vworldApiKey) return;
    const t = setTimeout(() => runSearch(query), ADDRESS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch, vworldApiKey, isField, dropdownClosed]);

  const handleSelect = useCallback(
    (item: VWorldAddressItem) => {
      if (query.trim()) addRecentQuery(query.trim());
      const display =
        (item.roadAddress ?? '').trim() ||
        (item.jibunAddress ?? '').trim() ||
        (item.title ?? '').trim() ||
        (item.address ?? '').trim();
      if (display) {
        lastEmittedQueryRef.current = display;
        setQuery(display);
      }
      setAddressResults([]);
      setDropdownClosed(true);
      onSelect(item);
    },
    [addRecentQuery, onSelect, query]
  );

  const clearQuery = useCallback(() => {
    lastEmittedQueryRef.current = '';
    setQuery('');
    setAddressResults([]);
    setDropdownClosed(true);
    onQueryChange?.('');
    onClear?.();
  }, [onClear, onQueryChange]);

  const showResultsPanel = isField
    ? !dropdownClosed && (loading || addressResults.length > 0 || Boolean(query.trim()))
    : true;

  return (
    <div className={isField ? 'relative flex flex-col gap-1' : 'flex flex-col gap-2'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isField) setDropdownClosed(false);
          runSearch(query);
        }}
        className={
          isField
            ? compact
              ? 'flex h-[20px] items-center gap-0.5 rounded-none border-0 bg-transparent px-0'
              : 'flex h-8 items-center gap-1.5 rounded-md border border-border/80 bg-muted/30 px-2'
            : 'flex items-center gap-2 rounded-[5px] border border-border bg-background px-2 py-1.5'
        }
      >
        <button
          type="submit"
          title="검색"
          className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted/80"
          aria-label="검색"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <Input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            lastEmittedQueryRef.current = next;
            setDropdownClosed(false);
            setQuery(next);
            onQueryChange?.(next);
          }}
          placeholder={placeholder}
          style={isField ? { fontSize: compact ? '11px' : '12px' } : undefined}
          className={
            isField
              ? compact
                ? 'h-[20px] min-h-0 border-0 bg-transparent px-0.5 text-[11px] shadow-none focus-visible:border-0 focus-visible:ring-0'
                : 'h-7 min-h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:border-0 focus-visible:ring-0'
              : 'h-5 min-h-5 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:border-0 focus-visible:ring-0'
          }
        />
        {query.trim().length > 0 && (
          <button
            type="button"
            title="지우기"
            onClick={clearQuery}
            className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80"
            aria-label="검색어 지우기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {!vworldApiKey && !compact && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          VWorld API 키가 설정되지 않아 주소검색을 사용할 수 없습니다.
        </div>
      )}

      {showResultsPanel && (
        <div
          className={
            isField
              ? 'absolute left-0 right-0 top-full z-30 mt-1 max-h-[220px] overflow-y-auto rounded-md border border-border bg-card shadow-md'
              : 'max-h-[280px] overflow-y-auto rounded-[5px] border border-border bg-background'
          }
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              검색 중…
            </div>
          ) : addressResults.length > 0 ? (
            <ul className="py-0.5">
              {addressResults.map((item, idx) => (
                <li key={`${item.id ?? item.address}-${idx}`}>
                  <button
                    type="button"
                    title={item.address}
                    onClick={() => handleSelect(item)}
                    className="flex min-h-[44px] w-full cursor-pointer flex-col justify-center gap-0.5 border-b border-border/60 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    {item.title && (
                      <div className="flex min-h-[1.25rem] items-center gap-2">
                        <span className="w-12 shrink-0 rounded bg-emerald-100 py-0.5 text-center text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                          장소
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                          {item.title}
                        </span>
                      </div>
                    )}
                    {item.roadAddress && (
                      <div className="flex min-h-[1.25rem] items-center gap-2">
                        <span className="w-12 shrink-0 rounded bg-blue-100 py-0.5 text-center text-[10px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                          도로명
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                          {item.roadAddress}
                          {item.buildingName ? ` (${item.buildingName})` : ""}
                        </span>
                      </div>
                    )}
                    {item.jibunAddress && (
                      <div className="flex min-h-[1.25rem] items-center gap-2">
                        <span className="w-12 shrink-0 rounded bg-amber-100 py-0.5 text-center text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          지번
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                          {item.jibunAddress}
                        </span>
                      </div>
                    )}
                    {!item.roadAddress && !item.jibunAddress && !item.title && (
                      <span className="line-clamp-2 text-[12px] text-foreground">{item.address}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">검색 결과가 없습니다</div>
          ) : !isField && recentQueries.length > 0 ? (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  최근 검색어
                </p>
                <button
                  type="button"
                  onClick={clearRecentQueries}
                  className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  전체 삭제
                </button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {recentQueries.map((q) => (
                  <li key={q}>
                    <span className="inline-flex max-w-full items-center gap-0.5 rounded-[5px] bg-muted pl-2.5 text-[12px] text-foreground transition-colors hover:bg-muted/80">
                      <button
                        type="button"
                        title={q}
                        onClick={() => {
                          setQuery(q);
                          runSearch(q);
                        }}
                        className="cursor-pointer truncate py-1.5 text-left"
                      >
                        {q}
                      </button>
                      <button
                        type="button"
                        title="삭제"
                        aria-label={`${q} 삭제`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentQuery(q);
                        }}
                        className="cursor-pointer rounded-r-[5px] px-1.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : isField ? null : (
            <div className="py-6 text-center text-[12px] text-muted-foreground/70">
              {includePlace ? '주소, 지번 또는 장소를 입력하세요' : '주소 또는 지번을 입력하세요'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
