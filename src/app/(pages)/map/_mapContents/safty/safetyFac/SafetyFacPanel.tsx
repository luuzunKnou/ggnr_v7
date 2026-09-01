'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Landmark, Loader2, Pentagon, Plus, RefreshCw, Search, Square, X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { canStartMapDrawInteraction } from '../../../_mapComponents/mapDrawInteraction';
import { SAFETY_FAC_PANEL_GEO_TABLE_NAMES } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import {
  SAFETY_FAC_LIST_CHIP_LABEL,
  SAFETY_FAC_SUBTYPE_TO_TABLE,
  getSafetyFacBadgeStyle,
  type SafetyFacFacilityRow,
  type SafetyFacSubtypeId,
} from './safetyFacSymbols';
import { animateSafetyFacToFacility, useSafetyFacMapClick } from './useSafetyFacMapClick';
import { useSafetyFacMapHighlight } from './useSafetyFacMapHighlight';

type TabId = 'heatCold' | 'evac' | 'housing';
type SearchTab = 'keyword' | 'shape' | 'boundary';
type SpatialTool = 'rectangle' | 'polygon' | 'circle';

type BoundaryBadgeItem = {
  key: string;
  kind: 'emd' | 'ri';
  code: string;
  label: string;
};

export type { SafetyFacFacilityRow };

const TAB_DEFS: {
  id: TabId;
  label: string;
  subtypes: { id: SafetyFacSubtypeId; label: string }[];
}[] = [
  {
    id: 'heatCold',
    label: '한파·무더위 쉼터',
    subtypes: [
      { id: 'coldShelter', label: '한파쉼터' },
      { id: 'heatShelter', label: '무더위쉼터' },
      { id: 'heatMitigation', label: '폭염저감시설' },
    ],
  },
  {
    id: 'evac',
    label: '대피소',
    subtypes: [
      { id: 'eqOutdoor', label: '지진옥외대피소' },
      { id: 'tsunamiEvac', label: '지진해일대피소' },
      { id: 'civilDefense', label: '민방위' },
    ],
  },
  {
    id: 'housing',
    label: '임시주거시설',
    subtypes: [{ id: 'displacedHousing', label: '이재민 임시주거시설' }],
  },
];

const SPATIAL_TOOLS: { id: SpatialTool; label: string; icon: typeof Square }[] = [
  { id: 'rectangle', label: '사각형', icon: Square },
  { id: 'polygon', label: '다각형', icon: Pentagon },
  { id: 'circle', label: '원형', icon: Circle },
];

type Props = {
  onClose: () => void;
  selectedFacility: SafetyFacFacilityRow | null;
  onSelectFacility: (facility: SafetyFacFacilityRow | null) => void;
};

function subtypeIdsForTab(tab: TabId): SafetyFacSubtypeId[] {
  const t = TAB_DEFS.find((x) => x.id === tab)!;
  return t.subtypes.map((s) => s.id);
}

export function getSafetyFacSubtypeLabel(subtype: SafetyFacSubtypeId): string {
  for (const t of TAB_DEFS) {
    const s = t.subtypes.find((x) => x.id === subtype);
    if (s) return s.label;
  }
  return subtype;
}

function facilityKey(f: SafetyFacFacilityRow): string {
  return `${f.table}-${f.subtype}-${f.id}`;
}

/** 공백으로 나눈 앞 2토큰(시·도·시·군·구 등)은 목록에서 숨김 */
function formatSafetyFacListAddress(raw: string): string {
  const parts = String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 2) return '';
  return parts.slice(2).join(' ');
}

export function SafetyFacPanel({ onClose, selectedFacility, onSelectFacility }: Props) {
  const mapContext = useMapContext();
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const spatialDrawRequest = mapContext?.spatialDrawRequest ?? null;

  const [tabId, setTabId] = useState<TabId>('heatCold');
  const tabDef = TAB_DEFS.find((t) => t.id === tabId)!;
  const [selectedSubtypeIds, setSelectedSubtypeIds] = useState<SafetyFacSubtypeId[]>(() =>
    subtypeIdsForTab('heatCold')
  );

  const [searchTab, setSearchTab] = useState<SearchTab>('keyword');
  const [searchText, setSearchText] = useState('');
  const [spatialWkt, setSpatialWkt] = useState<string | null>(null);
  const [activeSpatialTool, setActiveSpatialTool] = useState<SpatialTool | null>(null);
  const [boundaryBadges, setBoundaryBadges] = useState<BoundaryBadgeItem[]>([]);
  const [emdSelected, setEmdSelected] = useState('');
  const [riSelected, setRiSelected] = useState('');
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([]);
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([]);
  const [boundaryLoading, setBoundaryLoading] = useState(false);

  const [facilities, setFacilities] = useState<SafetyFacFacilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleTabChange = (next: TabId) => {
    setTabId(next);
    setSelectedSubtypeIds(subtypeIdsForTab(next));
    onSelectFacility(null);
  };

  const toggleSubtype = (id: SafetyFacSubtypeId) => {
    setSelectedSubtypeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const tabSubtypeIds = tabDef.subtypes.map((s) => s.id);
  const allSubtypesOn =
    tabSubtypeIds.length > 0 && tabSubtypeIds.every((id) => selectedSubtypeIds.includes(id));
  const toggleAllSubtypes = () => {
    setSelectedSubtypeIds(allSubtypesOn ? [] : tabSubtypeIds);
  };

  const handleClearSearch = useCallback(() => {
    setSearchText('');
  }, []);

  const showSearchClear = Boolean(searchText.trim());

  const selectedSubtypeKey = useMemo(
    () => [...selectedSubtypeIds].sort().join(','),
    [selectedSubtypeIds]
  );

  const geoTableSet = useMemo(() => new Set(SAFETY_FAC_PANEL_GEO_TABLE_NAMES), []);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => {
      const next = { ...prev };
      for (const st of Object.keys(SAFETY_FAC_SUBTYPE_TO_TABLE) as SafetyFacSubtypeId[]) {
        const t = SAFETY_FAC_SUBTYPE_TO_TABLE[st];
        if (geoTableSet.has(t)) {
          next[t] = selectedSubtypeIds.includes(st);
        }
      }
      return next;
    });
  }, [geoTableSet, mapContext?.setSafetyMapLayerVisibility, selectedSubtypeKey, selectedSubtypeIds]);

  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    return () => {
      if (!setVis) return;
      setVis((prev) => {
        const next = { ...prev };
        for (const t of SAFETY_FAC_PANEL_GEO_TABLE_NAMES) {
          next[t] = false;
        }
        return next;
      });
      setSpatialDrawRequest?.(null);
      setSpatialFilterWkt?.(null);
    };
  }, [mapContext?.setSafetyMapLayerVisibility, setSpatialDrawRequest, setSpatialFilterWkt]);

  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdRiOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : []);
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTab !== 'boundary' || !emdSelected) {
      setRiOptions([]);
      setRiSelected('');
      return;
    }
    let cancelled = false;
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRiOptions(Array.isArray(data?.ri) ? data.ri : []);
        setRiSelected('');
      })
      .catch(() => {
        if (!cancelled) setRiOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchTab, emdSelected]);

  useEffect(() => {
    if (selectedSubtypeIds.length === 0) {
      setFacilities([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const subtypeOrder = tabDef.subtypes.map((s) => s.id);
    const requests = subtypeOrder
      .filter((id) => selectedSubtypeIds.includes(id))
      .map((id) => ({
        subtype: id,
        table: SAFETY_FAC_SUBTYPE_TO_TABLE[id],
      }));
    call('', 'POST', {
      service: 'standardService',
      action: 'listSafetyFacilities',
      params: {
        requests,
        search: searchText.trim(),
        ...(spatialWkt ? { wkt5181: spatialWkt } : {}),
        schema: 'layer',
        limitPerTable: 150,
      },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const raw = Array.isArray(data?.items) ? data.items : [];
        const next: SafetyFacFacilityRow[] = raw.map((row: Record<string, unknown>) => {
          const da = row.detailAttrs;
          const detailAttrs =
            da != null && typeof da === 'object' && !Array.isArray(da)
              ? (da as Record<string, unknown>)
              : {};
          return {
            id: String(row.id ?? ''),
            table: String(row.table ?? ''),
            subtype: row.subtype as SafetyFacSubtypeId,
            name: String(row.name ?? ''),
            address: String(row.address ?? ''),
            detailAttrs,
            ...(typeof row.phone === 'string' && row.phone.trim() ? { phone: row.phone.trim() } : {}),
            ...(typeof row.lon === 'number' && typeof row.lat === 'number'
              ? { lon: row.lon, lat: row.lat }
              : {}),
            ...(row.geomJson != null ? { geomJson: row.geomJson } : {}),
          };
        });
        const order = new Map(subtypeOrder.map((id, i) => [id, i]));
        next.sort(
          (a, b) => (order.get(a.subtype) ?? 99) - (order.get(b.subtype) ?? 99)
        );
        setFacilities(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setFacilities([]);
        setLoadError(msg || '목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchText, selectedSubtypeKey, selectedSubtypeIds, spatialWkt, tabDef.subtypes]);

  const flyToFacility = useCallback(
    (f: SafetyFacFacilityRow) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      // 상세 패널 오픈 후 padding이 반영된 apply를 실행 시점에 읽는다
      animateSafetyFacToFacility(map, f, () => {
        mapContext?.applyMapViewPaddingRef?.current?.();
      });
    },
    [mapContext]
  );

  /** 목록 선택 후 상세 패널 padding 반영 뒤에 지도 이동 (최초 선택 누락 방지) */
  const selectFacilityAndFly = useCallback(
    (f: SafetyFacFacilityRow, canMap: boolean) => {
      onSelectFacility(f);
      if (!canMap) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flyToFacility(f);
        });
      });
    },
    [onSelectFacility, flyToFacility]
  );

  const clearSpatial = useCallback(() => {
    setSpatialWkt(null);
    setActiveSpatialTool(null);
    setSpatialDrawRequest?.(null);
    setSpatialFilterWkt?.(null);
    setBoundaryLoading(false);
  }, [setSpatialDrawRequest, setSpatialFilterWkt]);

  const clearBoundaryForm = useCallback(() => {
    setBoundaryBadges([]);
    setEmdSelected('');
    setRiSelected('');
  }, []);

  const applySpatialWkt = useCallback(
    (wkt5181: string) => {
      setSpatialWkt(wkt5181);
      setSpatialFilterWkt?.(wkt5181);
      setActiveSpatialTool(null);
      setSpatialDrawRequest?.(null);
    },
    [setSpatialDrawRequest, setSpatialFilterWkt]
  );

  const startSpatial = useCallback(
    (type: SpatialTool) => {
      if (!setSpatialDrawRequest) return;
      if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return;
      setSearchTab('shape');
      setActiveSpatialTool(type);
      setSpatialDrawRequest({
        type,
        onComplete: (wkt5181: string) => {
          applySpatialWkt(wkt5181);
        },
      });
    },
    [applySpatialWkt, mapContext, setSpatialDrawRequest]
  );

  const addBoundaryBadgeFromDraft = useCallback(() => {
    if (riSelected) {
      const label = riOptions.find((o) => o.code === riSelected)?.name ?? riSelected;
      const item: BoundaryBadgeItem = {
        key: `ri:${riSelected}`,
        kind: 'ri',
        code: riSelected,
        label,
      };
      setBoundaryBadges((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
      return;
    }
    if (emdSelected) {
      const label = emdOptions.find((o) => o.code === emdSelected)?.name ?? emdSelected;
      const item: BoundaryBadgeItem = {
        key: `emd:${emdSelected}`,
        kind: 'emd',
        code: emdSelected,
        label,
      };
      setBoundaryBadges((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
      return;
    }
    window.alert('읍면동 또는 리를 선택한 뒤 + 를 눌러 주세요.');
  }, [riSelected, emdSelected, riOptions, emdOptions]);

  const runBoundarySearch = useCallback(async () => {
    if (boundaryBadges.length === 0) {
      window.alert('추가된 읍면동·리가 없습니다. 선택 후 + 를 눌러 추가하세요.');
      return;
    }
    setBoundaryLoading(true);
    try {
      const wktParts: string[] = [];
      for (const b of boundaryBadges) {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: b.kind === 'emd' ? 'getEmdGeometry' : 'getRiGeometry',
          params: b.kind === 'emd' ? { emdCode: b.code } : { riCode: b.code },
        });
        const data = res?.data ?? res;
        const w = data?.wkt != null ? String(data.wkt).trim() : '';
        if (w) wktParts.push(w);
      }
      if (wktParts.length === 0) {
        window.alert('행정경계 도형을 가져오지 못했습니다.');
        return;
      }
      let unionWkt: string | null = wktParts[0] ?? null;
      if (wktParts.length > 1) {
        const ures = await call('', 'POST', {
          service: 'devTestService',
          action: 'unionWkts5181',
          params: { wkts: wktParts },
        });
        const udata = ures?.data ?? ures;
        unionWkt = udata?.wkt != null ? String(udata.wkt).trim() : null;
      }
      if (!unionWkt) {
        window.alert('행정경계 도형을 합치지 못했습니다.');
        return;
      }
      applySpatialWkt(unionWkt);
    } catch {
      window.alert('행정경계 검색 중 오류가 발생했습니다.');
    } finally {
      setBoundaryLoading(false);
    }
  }, [applySpatialWkt, boundaryBadges]);

  const selectedKey = selectedFacility ? facilityKey(selectedFacility) : null;
  const tablistId = 'safety-fac-tabs';
  const subtypeGroupId = 'safety-fac-subtype';
  const itemEls = useRef(new Map<string, HTMLTableRowElement>());

  useSafetyFacMapClick({
    enabled: true,
    facilities,
    onSelectFacility,
  });
  useSafetyFacMapHighlight(Boolean(mapContext?.mapReady), selectedFacility);

  useEffect(() => {
    if (!selectedKey) return;
    itemEls.current.get(selectedKey)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedKey]);

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background"
      aria-label="재난대응시설"
    >
      <div className="relative shrink-0 border-b border-border bg-gradient-to-b from-primary/5 to-background px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[12px] font-semibold leading-tight text-foreground">재난대응시설</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              유형을 선택한 뒤 검색·목록에서 시설을 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSpatial();
              clearBoundaryForm();
              onSelectFacility(null);
              onClose();
            }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
        <div
          id={tablistId}
          role="tablist"
          aria-label="시설 구분"
          className="flex shrink-0 gap-0 border-b border-border bg-background px-3"
        >
          {TAB_DEFS.map((t) => {
            const selected = t.id === tabId;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`safety-fac-tab-${t.id}`}
                title={t.label}
                aria-selected={selected}
                aria-controls={`safety-fac-tabpanel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => handleTabChange(t.id)}
                className={cn(
                  'relative -mb-px min-w-0 flex-1 border-b-2 px-1.5 py-2 text-[11px] font-medium leading-tight transition-colors break-keep',
                  selected
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div
          id={`safety-fac-tabpanel-${tabId}`}
          role="tabpanel"
          aria-labelledby={`safety-fac-tab-${tabId}`}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 space-y-2.5 border-b border-border/90 bg-background px-3 py-2.5">
            <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setSearchTab('keyword');
                  setSpatialDrawRequest?.(null);
                  setActiveSpatialTool(null);
                }}
                className={cn(
                  'flex-1 rounded py-1.5 text-[11px] font-medium transition-colors',
                  searchTab === 'keyword'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                통합검색
              </button>
              <button
                type="button"
                onClick={() => setSearchTab('shape')}
                className={cn(
                  'flex-1 rounded py-1.5 text-[11px] font-medium transition-colors',
                  searchTab === 'shape'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                도형검색
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchTab('boundary');
                  setSpatialDrawRequest?.(null);
                  setActiveSpatialTool(null);
                }}
                className={cn(
                  'flex-1 rounded px-0.5 py-1.5 text-[10px] font-medium leading-tight transition-colors',
                  searchTab === 'boundary'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                행정경계 검색
              </button>
            </div>

            {searchTab === 'keyword' ? (
              <div className="standard-search-wrap min-w-0">
                <Search className="standard-search-icon h-3.5 w-3.5" aria-hidden />
                <input
                  id="safety-fac-search"
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="시설명·주소"
                  aria-label="시설명·주소 검색"
                  className={cn(
                    'standard-search-input min-h-[2rem] rounded-[5px] py-1.5 text-[12px] placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
                    showSearchClear ? 'pr-7' : 'pr-3'
                  )}
                />
                {showSearchClear ? (
                  <button
                    type="button"
                    title="검색 초기화"
                    aria-label="검색 초기화"
                    onClick={handleClearSearch}
                    className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            ) : null}

            {searchTab === 'shape' ? (
              <div className="flex flex-wrap items-stretch gap-1.5">
                {SPATIAL_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  const active =
                    activeSpatialTool === tool.id ||
                    (spatialDrawRequest?.type === tool.id && !spatialWkt);
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      title={`지도에 ${tool.label} 그리기`}
                      onClick={() => startSpatial(tool.id)}
                      className={cn(
                        'flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border py-1.5 text-[10px] transition-colors',
                        active
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                      {tool.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  title="검색 초기화"
                  onClick={clearSpatial}
                  className="flex min-w-[2.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded border border-border bg-background py-1.5 text-muted-foreground transition-colors hover:border-border hover:text-primary"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="text-[10px]">초기화</span>
                </button>
                {spatialDrawRequest ? (
                  <p className="w-full text-[10px] text-muted-foreground">지도에 도형을 그려 주세요.</p>
                ) : null}
              </div>
            ) : null}

            {searchTab === 'boundary' ? (
              <div className="space-y-1.5">
                <div className="flex items-end gap-1.5">
                  <div className="min-w-0 flex-1">
                    <select
                      value={emdSelected}
                      onChange={(e) => {
                        setEmdSelected(e.target.value);
                        setRiSelected('');
                      }}
                      disabled={boundaryLoading}
                      className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]"
                    >
                      <option value="">읍면동 선택</option>
                      {emdOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <select
                      value={riSelected}
                      onChange={(e) => setRiSelected(e.target.value)}
                      disabled={!emdSelected || boundaryLoading}
                      className="h-8 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 [color-scheme:light] dark:[color-scheme:dark]"
                    >
                      <option value="">리 선택</option>
                      {riOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    title="추가"
                    onClick={addBoundaryBadgeFromDraft}
                    disabled={boundaryLoading}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </button>
                </div>
                {boundaryBadges.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {boundaryBadges.map((b) => (
                      <span
                        key={b.key}
                        className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-primary/25 bg-primary/8 py-0.5 pl-1.5 pr-0.5 text-[10px] text-foreground"
                      >
                        <Landmark className="h-2.5 w-2.5 shrink-0 text-primary/70" />
                        <span className="max-w-[4.5rem] truncate" title={b.label}>
                          {b.label}
                        </span>
                        <button
                          type="button"
                          title="목록에서 제거"
                          onClick={() =>
                            setBoundaryBadges((prev) => prev.filter((x) => x.key !== b.key))
                          }
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-primary"
                        >
                          <X className="h-2.5 w-2.5" strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    title="검색"
                    onClick={() => void runBoundarySearch()}
                    disabled={boundaryLoading || boundaryBadges.length === 0}
                    className="min-h-8 flex-1 rounded-md border border-primary bg-primary py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {boundaryLoading ? '검색 중…' : '검색'}
                  </button>
                  <button
                    type="button"
                    title="선택·목록·지도 필터 초기화"
                    onClick={() => {
                      clearBoundaryForm();
                      clearSpatial();
                    }}
                    disabled={boundaryLoading}
                    className="min-h-8 flex-1 rounded-md border border-border bg-background py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-primary disabled:opacity-50"
                  >
                    초기화
                  </button>
                </div>
              </div>
            ) : null}

            {tabDef.subtypes.length > 1 ? (
            <div
              id={subtypeGroupId}
              role="group"
              aria-label={`${tabDef.label} 유형 (복수 선택)`}
              className="flex flex-wrap gap-1.5"
            >
              <button
                type="button"
                role="checkbox"
                title="전체"
                aria-checked={allSubtypesOn}
                onClick={toggleAllSubtypes}
                className={cn(
                  'inline-flex items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors',
                  allSubtypesOn
                    ? 'border border-primary/40 bg-primary/14 text-primary'
                    : 'border border-border bg-background text-muted-foreground hover:border-border'
                )}
              >
                전체
              </button>
              {tabDef.subtypes.map((s) => {
                const on = selectedSubtypeIds.includes(s.id);
                const chipName = SAFETY_FAC_LIST_CHIP_LABEL[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    title={s.label}
                    aria-checked={on}
                    onClick={() => toggleSubtype(s.id)}
                    className="inline-flex items-center rounded px-2.5 py-1.5 text-[10px] font-medium leading-tight transition-colors"
                    style={getSafetyFacBadgeStyle(s.id, on)}
                  >
                    {chipName}
                  </button>
                );
              })}
            </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="min-h-0 flex-1 overflow-auto scrollbar-thin bg-background">
            {loadError ? (
              <p className="px-3 py-2.5 text-xs text-red-600">{loadError}</p>
            ) : loading ? (
              <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                불러오는 중...
              </p>
            ) : facilities.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">조건에 맞는 시설이 없습니다.</p>
            ) : (
              <table className="w-full table-fixed border-collapse text-xs">
                <colgroup>
                  <col />
                  <col className="w-[42%]" />
                </colgroup>
                <tbody>
                  {facilities.map((f) => {
                    const canMap =
                      (f.lon != null && f.lat != null) || f.geomJson != null;
                    const key = facilityKey(f);
                    const isSelected = selectedKey === key;
                    const typeLabel = getSafetyFacSubtypeLabel(f.subtype);
                    const chipName = SAFETY_FAC_LIST_CHIP_LABEL[f.subtype];
                    const listAddress = formatSafetyFacListAddress(f.address);
                    const hasName = Boolean(f.name.trim());
                    const selectRow = () => {
                      selectFacilityAndFly(f, canMap);
                    };
                    return (
                      <tr
                        key={key}
                        ref={(el) => {
                          if (el) itemEls.current.set(key, el);
                          else itemEls.current.delete(key);
                        }}
                        role="button"
                        tabIndex={0}
                        title={`${typeLabel} · ${f.name}`}
                        aria-label={`${f.name}, 상세 보기`}
                        onClick={selectRow}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectRow();
                          }
                        }}
                        className={cn(
                          'cursor-pointer border-b border-border align-middle transition-colors',
                          isSelected
                            ? 'border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]'
                            : 'border-l-[3px] border-l-transparent hover:bg-muted/50'
                        )}
                      >
                        <td className="min-w-0 overflow-hidden px-3 py-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {f.subtype !== 'displacedHousing' ? (
                              <span
                                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                                style={getSafetyFacBadgeStyle(f.subtype)}
                              >
                                {chipName}
                              </span>
                            ) : null}
                            <p
                              className={cn(
                                'min-w-0 flex-1 truncate text-sm font-normal leading-tight',
                                hasName ? 'text-foreground' : 'text-muted-foreground'
                              )}
                              title={f.name || undefined}
                            >
                              {f.name || '—'}
                            </p>
                          </div>
                        </td>
                        <td
                          className="min-w-0 px-3 py-2 pl-1.5 text-right text-[11px] text-muted-foreground"
                          title={f.address}
                        >
                          <span className="block truncate">{listAddress}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
            <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground tabular-nums">
              총 {facilities.length}건
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
