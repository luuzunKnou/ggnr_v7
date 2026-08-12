'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import {
  searchAddress,
  type VWorldAddressItem,
} from '../../_mapComponents/addressSearch/vworldAddressSearch';

const inputClass =
  'w-full rounded border border-slate-200 bg-white py-0.5 pl-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30';
const btnClass =
  'inline-flex shrink-0 items-center justify-center rounded border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const clearBtnClass =
  'absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600';

const DEBOUNCE_MS = 300;
const RESULT_MAX = 8;

type Props = {
  value: string;
  onChange: (value: string) => void;
  vworldApiKey: string;
  placeholder?: string;
};

function displayAddress(item: VWorldAddressItem): string {
  return (
    (item.roadAddress ?? '').trim() ||
    (item.jibunAddress ?? '').trim() ||
    (item.address ?? '').trim()
  );
}

/** 점용장소 직접입력 + 주소검색 (공통 점용·울진 하천점용 공용) */
export function OccupationLedgerPlaceInput({
  value,
  onChange,
  vworldApiKey,
  placeholder = '지번/도로명 입력',
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<VWorldAddressItem[]>([]);

  const runSearch = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim();
      if (!trimmed || !vworldApiKey) {
        setResults([]);
        return;
      }
      setLoading(true);
      searchAddress(trimmed, {
        maxResults: RESULT_MAX,
        type: 'address',
        apiKey: vworldApiKey,
      })
        .then((items) => setResults(items))
        .finally(() => setLoading(false));
    },
    [vworldApiKey]
  );

  useEffect(() => {
    if (!open) return;
    if (!value.trim() || !vworldApiKey) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => runSearch(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, open, runSearch, vworldApiKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setOpen(true);
                runSearch(value);
              }
            }}
            className={`${inputClass} ${value.trim().length > 0 ? 'pr-6' : 'pr-1.5'}`}
            placeholder={placeholder}
          />
          {value.trim().length > 0 ? (
            <button
              type="button"
              className={clearBtnClass}
              title="지우기"
              aria-label="지우기"
              onClick={() => {
                onChange('');
                setResults([]);
                setOpen(false);
              }}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={btnClass}
          title="주소검색"
          aria-label="주소검색"
          disabled={!vworldApiKey || !value.trim() || loading}
          onClick={() => {
            setOpen(true);
            runSearch(value);
          }}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
      {!vworldApiKey ? (
        <p className="mt-0.5 text-[10px] text-amber-700">주소검색 API 키가 없습니다.</p>
      ) : null}
      {open && (loading || results.length > 0 || value.trim()) ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-[180px] overflow-y-auto rounded border border-slate-200 bg-white shadow-md">
          {loading ? (
            <div className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              검색 중…
            </div>
          ) : results.length > 0 ? (
            <ul className="py-0.5">
              {results.map((item, idx) => {
                const label = displayAddress(item);
                return (
                  <li key={`${item.id ?? label}-${idx}`}>
                    <button
                      type="button"
                      title={label}
                      className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-2 py-1.5 text-left last:border-b-0 hover:bg-slate-50"
                      onClick={() => {
                        if (label) onChange(label);
                        setResults([]);
                        setOpen(false);
                      }}
                    >
                      {item.roadAddress ? (
                        <span className="truncate text-[11px] text-slate-800">
                          <span className="mr-1 rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">
                            도로명
                          </span>
                          {item.roadAddress}
                        </span>
                      ) : null}
                      {item.jibunAddress ? (
                        <span className="truncate text-[11px] text-slate-700">
                          <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                            지번
                          </span>
                          {item.jibunAddress}
                        </span>
                      ) : null}
                      {!item.roadAddress && !item.jibunAddress ? (
                        <span className="truncate text-[11px] text-slate-800">{label}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-3 text-center text-[11px] text-slate-500">검색 결과가 없습니다</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
