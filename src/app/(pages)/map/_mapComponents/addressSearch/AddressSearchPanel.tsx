"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Search, X } from "lucide-react";
import { Input } from "@/app/shadcnComponents/ui/input";
import { searchAddress, type VWorldAddressItem } from "./vworldAddressSearch";

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
};

/** 지도 map-search-bar와 동일한 VWorld 주소검색 UI */
export function AddressSearchPanel({
  vworldApiKey,
  onSelect,
  placeholder = "주소/지번 검색",
}: Props) {
  const [query, setQuery] = useState("");
  const [addressResults, setAddressResults] = useState<VWorldAddressItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => loadRecentQueries());

  const addRecentQuery = useCallback((trimmed: string) => {
    if (!trimmed) return;
    setRecentQueries((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, RECENT_QUERIES_MAX);
      saveRecentQueries(next);
      return next;
    });
  }, []);

  const runSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed || !vworldApiKey) {
        setAddressResults([]);
        return;
      }
      setLoading(true);
      searchAddress(trimmed, { maxResults: ADDRESS_RESULT_MAX, type: "address", apiKey: vworldApiKey })
        .then((items) => setAddressResults(items))
        .finally(() => setLoading(false));
    },
    [vworldApiKey]
  );

  useEffect(() => {
    if (!query.trim()) {
      setAddressResults([]);
      return;
    }
    if (!vworldApiKey) return;
    const t = setTimeout(() => runSearch(query), ADDRESS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch, vworldApiKey]);

  const handleSelect = useCallback(
    (item: VWorldAddressItem) => {
      if (query.trim()) addRecentQuery(query.trim());
      onSelect(item);
    },
    [addRecentQuery, onSelect, query]
  );

  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="flex items-center gap-2 rounded-[5px] border border-slate-200 bg-white px-2 py-1.5"
      >
        <button
          type="submit"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-slate-600 hover:bg-slate-100"
          aria-label="검색"
        >
          <Search className="h-4 w-4" />
        </button>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-5 min-h-5 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:border-0 focus-visible:ring-0"
        />
        {query.trim().length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAddressResults([]);
            }}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="검색어 지우기"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {!vworldApiKey && (
        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-2 text-[11px] text-amber-800">
          VWorld API 키가 설정되지 않아 주소검색을 사용할 수 없습니다.
        </div>
      )}

      <div className="max-h-[280px] overflow-y-auto rounded-[5px] border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            검색 중…
          </div>
        ) : addressResults.length > 0 ? (
          <ul className="py-0.5">
            {addressResults.map((item, idx) => (
              <li key={`${item.id ?? item.address}-${idx}`}>
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="flex min-h-[44px] w-full flex-col justify-center gap-0.5 border-b border-slate-100 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  {item.roadAddress && (
                    <div className="flex min-h-[1.25rem] items-center gap-2">
                      <span className="w-12 shrink-0 rounded bg-blue-100 py-0.5 text-center text-[10px] font-semibold text-blue-700">
                        도로명
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">
                        {item.roadAddress}
                        {item.buildingName ? ` (${item.buildingName})` : ""}
                      </span>
                    </div>
                  )}
                  {item.jibunAddress && (
                    <div className="flex min-h-[1.25rem] items-center gap-2">
                      <span className="w-12 shrink-0 rounded bg-amber-100 py-0.5 text-center text-[10px] font-semibold text-amber-800">
                        지번
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">{item.jibunAddress}</span>
                    </div>
                  )}
                  {!item.roadAddress && !item.jibunAddress && (
                    <span className="line-clamp-2 text-[12px] text-slate-800">{item.address}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <div className="py-6 text-center text-[12px] text-slate-500">검색 결과가 없습니다</div>
        ) : recentQueries.length > 0 ? (
          <div className="px-3 py-2">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
              <History className="h-3.5 w-3.5" />
              최근 검색어
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {recentQueries.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(q);
                      runSearch(q);
                    }}
                    className="rounded-[5px] bg-slate-100 px-2.5 py-1.5 text-[12px] text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="py-6 text-center text-[12px] text-slate-400">주소 또는 지번을 입력하세요</div>
        )}
      </div>
    </div>
  );
}
