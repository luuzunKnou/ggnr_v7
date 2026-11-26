'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Overlay from 'ol/Overlay';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  type SecurityLightListItem,
  type SecurityLightSourceFilter,
} from './securityLightTypes';
import { SecurityLightHitPopup } from './SecurityLightHitPopup';
import {
  flyToSecurityLight,
  useSecurityLightMapHighlight,
  type SecurityLightMapHit,
} from './useSecurityLightMapHighlight';

const SOURCE_TABS: { key: SecurityLightSourceFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'supply', label: '도로과' },
  { key: 'public', label: '재난안전' },
];

type Props = {
  onClose: () => void;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
};

export function SecurityLightListPanel({
  onClose,
  selectedKey,
  onSelectKey,
}: Props) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;

  const [items, setItems] = useState<SecurityLightListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SecurityLightSourceFilter>('all');
  const [keyword, setKeyword] = useState('');
  /** 지도 위 데이터 목록(Overlay) — FeatureIdentifyPopup과 동일 */
  const [mapHits, setMapHits] = useState<SecurityLightMapHit[]>([]);
  const overlayRef = useRef<Overlay | null>(null);
  const popupElRef = useRef<HTMLDivElement | null>(null);
  const [, setPopupReady] = useState(0);

  const fetchList = useCallback(async (source: SecurityLightSourceFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'securityLightService',
        action: 'list',
        params: {
          keyword: '',
          source: source === 'all' ? 'all' : source,
          limit: 20000,
        },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.items)
        ? (data.items as SecurityLightListItem[])
        : [];
      setItems(rows);
    } catch (e: unknown) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList(sourceFilter);
  }, [sourceFilter, fetchList]);

  const clearMapHitPopup = useCallback(() => {
    setMapHits([]);
    overlayRef.current?.setPosition(undefined);
  }, []);

  useEffect(() => {
    clearMapHitPopup();
  }, [sourceFilter, keyword, clearMapHitPopup]);

  useEffect(() => {
    if (!map) return;
    const el = document.createElement('div');
    popupElRef.current = el;
    const overlay = new Overlay({
      element: el,
      positioning: 'top-left',
      stopEvent: true,
      offset: [12, 12],
    });
    map.addOverlay(overlay);
    overlayRef.current = overlay;
    setPopupReady((n) => n + 1);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
      popupElRef.current = null;
    };
  }, [map]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    let rows =
      sourceFilter === 'all' ? items : items.filter((r) => r.source === sourceFilter);
    if (q) {
      rows = rows.filter(
        (r) =>
          r.location.toLowerCase().includes(q) ||
          r.manageNo.toLowerCase().includes(q) ||
          r.sourceLabel.includes(q)
      );
    }
    return rows;
  }, [items, sourceFilter, keyword]);

  useEffect(() => {
    if (!selectedKey) return;
    if (filtered.some((r) => r.key === selectedKey)) return;
    onSelectKey(null);
  }, [filtered, selectedKey, onSelectKey]);

  const applyHit = useCallback(
    (key: string, flyOpts?: { minZoom?: number; duration?: number }) => {
      onSelectKey(key);
      const hit = filtered.find((r) => r.key === key) ?? null;
      flyToSecurityLight(map, hit, flyOpts);
    },
    [filtered, map, onSelectKey]
  );

  useSecurityLightMapHighlight(map, filtered, selectedKey, {
    removeOnUnmount: true,
    onMapHits: ({ hits, coordinate }) => {
      if (hits.length <= 1) {
        clearMapHitPopup();
        if (hits[0]) applyHit(hits[0].key);
        return;
      }
      setMapHits(hits);
      overlayRef.current?.setPosition(coordinate);
      // 목록만 띄우고 자동 선택은 하지 않음 — 사용자가 고름
    },
  });

  const handleSelect = (row: SecurityLightListItem) => {
    clearMapHitPopup();
    onSelectKey(row.key);
    flyToSecurityLight(map, row);
  };

  const handlePopupSelect = (key: string) => {
    clearMapHitPopup();
    // 데이터 목록에서 고르면 해당 점으로 이동·확대
    applyHit(key, { minZoom: 18, duration: 400 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">보안등</span>
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

      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="flex items-stretch gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="위치·관리번호 검색"
              className="h-8 w-full rounded border border-border bg-background pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>

        <div
          className="flex w-full flex-nowrap gap-0.5"
          role="group"
          aria-label="출처 필터"
        >
          {SOURCE_TABS.map((tab) => {
            const active = sourceFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSourceFilter(tab.key)}
                title={tab.label}
                className={cn(
                  'flex-auto whitespace-nowrap rounded border px-1 py-1 text-center text-[10px] font-medium leading-tight transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50'
                )}
                aria-pressed={active}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>목록 {filtered.length.toLocaleString('ko-KR')}건</span>
          {loading ? <span>조회 중…</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {loading && filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">불러오는 중...</p>
        ) : error ? (
          <p className="px-3 py-2.5 text-xs text-destructive">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[4.5rem]" />
              <col />
              <col className="w-[7.5rem]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted/95 backdrop-blur-sm">
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">출처</th>
                <th className="px-2 py-2 text-left font-medium">위치</th>
                <th className="px-2 py-2 text-right font-medium">관리번호</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isSelected = row.key === selectedKey;
                const hasLocation = Boolean(row.location.trim()) && row.location !== '-';
                return (
                  <tr
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(row);
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border align-middle transition-colors',
                      isSelected
                        ? 'border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]'
                        : 'border-l-[3px] border-l-transparent hover:bg-muted/50'
                    )}
                  >
                    <td className="px-2 py-2 align-middle">
                      <span
                        className={cn(
                          'inline-flex w-full items-center justify-center whitespace-nowrap rounded border px-1 py-0.5 text-[10px] font-semibold leading-none',
                          row.source === 'public'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-primary/40 bg-primary/10 text-primary'
                        )}
                        title={row.sourceLabel}
                      >
                        {row.sourceLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-2 py-2">
                      <p
                        className={cn(
                          'truncate text-sm font-medium leading-tight',
                          hasLocation ? 'text-foreground' : 'text-muted-foreground'
                        )}
                        title={row.location}
                      >
                        {hasLocation ? row.location : '(위치 없음)'}
                      </p>
                    </td>
                    <td
                      className="min-w-0 px-2 py-2 text-right text-[11px] text-muted-foreground"
                      title={row.manageNo}
                    >
                      <span className="block truncate">{row.manageNo || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {mapHits.length > 1 && popupElRef.current ? (
        <SecurityLightHitPopup
          hits={mapHits}
          selectedKey={selectedKey}
          portalTarget={popupElRef.current}
          onSelect={handlePopupSelect}
          onClose={clearMapHitPopup}
        />
      ) : null}
    </div>
  );
}
