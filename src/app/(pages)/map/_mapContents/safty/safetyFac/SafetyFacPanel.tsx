'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Search, X } from 'lucide-react';
import { transform } from 'ol/proj';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { SAFETY_FAC_PANEL_GEO_TABLE_NAMES } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { SafetyFacilityDetailFloating } from './SafetyFacilityDetailFloating';

type TabId = 'heatCold' | 'evac' | 'housing';

type SubtypeId =
  | 'coldShelter'
  | 'heatShelter'
  | 'heatMitigation'
  | 'eqOutdoor'
  | 'tsunamiEvac'
  | 'displacedHousing';

type FacilityRow = {
  id: string;
  table: string;
  subtype: SubtypeId;
  name: string;
  address: string;
  phone?: string;
  lon?: number;
  lat?: number;
  detailAttrs: Record<string, unknown>;
};

const SUBTYPE_TO_TABLE: Record<SubtypeId, string> = {
  coldShelter: 'sd_cold_wave_shelter',
  heatShelter: 'sd_heat_wave_shelter',
  heatMitigation: 'sd_heat_mitigation_facility',
  eqOutdoor: 'sd_earthquake_outdoor_evac_site',
  tsunamiEvac: 'sd_tsunami_emergency_evac_site',
  displacedHousing: 'sd_mois_displaced_temp_housing',
};

const TAB_DEFS: {
  id: TabId;
  label: string;
  subtypes: { id: SubtypeId; label: string }[];
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
      { id: 'tsunamiEvac', label: '지진해일피소' },
    ],
  },
  {
    id: 'housing',
    label: '임시주거시설',
    subtypes: [{ id: 'displacedHousing', label: '이재민 임시주거시설' }],
  },
];

type Props = {
  onClose: () => void;
};

function subtypeIdsForTab(tab: TabId): SubtypeId[] {
  const t = TAB_DEFS.find((x) => x.id === tab)!;
  return t.subtypes.map((s) => s.id);
}

function getSubtypeLabel(subtype: SubtypeId): string {
  for (const t of TAB_DEFS) {
    const s = t.subtypes.find((x) => x.id === subtype);
    if (s) return s.label;
  }
  return subtype;
}

export function SafetyFacPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const [tabId, setTabId] = useState<TabId>('heatCold');
  const tabDef = TAB_DEFS.find((t) => t.id === tabId)!;
  const [selectedSubtypeIds, setSelectedSubtypeIds] = useState<SubtypeId[]>(() =>
    subtypeIdsForTab('heatCold')
  );

  const [searchText, setSearchText] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailFacility, setDetailFacility] = useState<FacilityRow | null>(null);

  const handleTabChange = (next: TabId) => {
    setTabId(next);
    setSelectedSubtypeIds(subtypeIdsForTab(next));
  };

  const toggleSubtype = (id: SubtypeId) => {
    setSelectedSubtypeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSearch = useCallback(() => {
    setAppliedQuery(searchText.trim());
  }, [searchText]);

  const selectedSubtypeKey = useMemo(
    () => [...selectedSubtypeIds].sort().join(','),
    [selectedSubtypeIds]
  );

  const geoTableSet = useMemo(() => new Set(SAFETY_FAC_PANEL_GEO_TABLE_NAMES), []);

  /** 선택한 유형에 해당하는 GeoServer WMS 레이어 표시 (재난안전지도 GeoServer 레이어와 동일 경로) */
  useEffect(() => {
    const setVis = mapContext?.setSafetyMapLayerVisibility;
    if (!setVis) return;
    setVis((prev) => {
      const next = { ...prev };
      for (const st of Object.keys(SUBTYPE_TO_TABLE) as SubtypeId[]) {
        const t = SUBTYPE_TO_TABLE[st];
        if (geoTableSet.has(t)) {
          next[t] = selectedSubtypeIds.includes(st);
        }
      }
      return next;
    });
  }, [geoTableSet, mapContext?.setSafetyMapLayerVisibility, selectedSubtypeKey]);

  /** 패널을 닫을 때만 재난대응시설 전용 WMS 토글 상태 정리 */
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
    };
  }, [mapContext?.setSafetyMapLayerVisibility]);

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
    const requests = selectedSubtypeIds.map((id) => ({
      subtype: id,
      table: SUBTYPE_TO_TABLE[id],
    }));
    call('', 'POST', {
      service: 'standardService',
      action: 'listSafetyFacilities',
      params: {
        requests,
        search: appliedQuery,
        schema: 'layer',
        limitPerTable: 150,
      },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        const raw = Array.isArray(data?.items) ? data.items : [];
        const next: FacilityRow[] = raw.map((row: Record<string, unknown>) => {
          const da = row.detailAttrs;
          const detailAttrs =
            da != null && typeof da === 'object' && !Array.isArray(da)
              ? (da as Record<string, unknown>)
              : {};
          return {
            id: String(row.id ?? ''),
            table: String(row.table ?? ''),
            subtype: row.subtype as SubtypeId,
            name: String(row.name ?? ''),
            address: String(row.address ?? ''),
            detailAttrs,
            ...(typeof row.phone === 'string' && row.phone.trim() ? { phone: row.phone.trim() } : {}),
            ...(typeof row.lon === 'number' && typeof row.lat === 'number' ? { lon: row.lon, lat: row.lat } : {}),
          };
        });
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
  }, [appliedQuery, selectedSubtypeKey]);

  const flyToFacility = useCallback(
    (f: FacilityRow) => {
      if (f.lon == null || f.lat == null) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const view = map.getView();
      const center3857 = transform([f.lon, f.lat], 'EPSG:4326', 'EPSG:3857');
      view.setCenter(center3857);
      view.setZoom(16);
    },
    [mapContext]
  );

  const selectionSummary = useMemo(() => {
    const labels = tabDef.subtypes
      .filter((s) => selectedSubtypeIds.includes(s.id))
      .map((s) => s.label);
    if (labels.length === 0) return '선택 없음';
    return labels.join(', ');
  }, [tabDef.subtypes, selectedSubtypeIds]);

  const tablistId = 'safety-fac-tabs';
  const subtypeGroupId = 'safety-fac-subtype';

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden opacity-[0.98]"
      aria-label="재난대응시설"
    >
      <div className="shrink-0 bg-gradient-to-b from-[#f0f9fc] to-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-800">재난대응시설</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              유형을 선택한 뒤 검색·목록에서 시설을 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/90">
        <div className="shrink-0 bg-white px-3 py-2.5">
          <div
            id={tablistId}
            role="tablist"
            aria-label="시설 구분"
            className="flex gap-1 rounded-md"
          >
            {TAB_DEFS.map((t) => {
              const selected = t.id === tabId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`safety-fac-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`safety-fac-tabpanel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => handleTabChange(t.id)}
                  className={cn(
                    'min-w-0 flex-1 rounded-[5px] border px-1.5 py-1.5 text-[10.5px] font-medium leading-tight transition-colors break-keep',
                    selected
                      ? 'border-slate-300 bg-slate-100/95 text-slate-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id={`safety-fac-tabpanel-${tabId}`}
          role="tabpanel"
          aria-labelledby={`safety-fac-tab-${tabId}`}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 space-y-2.5 border-b border-slate-200/90 bg-white px-3 py-2.5">
            <div className="flex gap-1.5">
              <label className="sr-only" htmlFor="safety-fac-search">
                시설명·주소 검색
              </label>
              <input
                id="safety-fac-search"
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="시설명·주소"
                className="min-w-0 flex-1 rounded-[5px] border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleSearch}
                className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                aria-label="검색"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={2} />
                검색
              </button>
            </div>
            <div
              id={subtypeGroupId}
              role="group"
              aria-label={`${tabDef.label} 유형 (복수 선택)`}
              className="flex flex-wrap gap-1.5"
            >
              {tabDef.subtypes.map((s) => {
                const on = selectedSubtypeIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleSubtype(s.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      on
                        ? 'border-slate-300 bg-slate-100/95 text-slate-600'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
              <p className="text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800">{selectionSummary}</span>
                <span className="mx-1 text-slate-400">·</span>
                <span className="tabular-nums">총 {facilities.length}건</span>
              </p>
            </div>

            {loadError ? (
              <p className="rounded-[5px] border border-red-200 bg-red-50/80 px-3 py-3 text-center text-[12px] text-red-800">
                {loadError}
              </p>
            ) : loading ? (
              <p className="flex items-center justify-center gap-2 rounded-[5px] border border-slate-200 bg-white px-3 py-8 text-[12px] text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                불러오는 중…
              </p>
            ) : facilities.length === 0 ? (
              <p className="rounded-[5px] border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-[12px] text-slate-500">
                조건에 맞는 시설이 없습니다.
              </p>
            ) : (
              <ul className="space-y-2" role="list">
                {facilities.map((f) => {
                  const canMap = f.lon != null && f.lat != null && mapContext?.mapInstanceRef?.current;
                  return (
                    <li key={`${f.table}-${f.subtype}-${f.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          if (canMap) flyToFacility(f);
                          setDetailFacility(f);
                        }}
                        className={cn(
                          'w-full rounded-[5px] border border-slate-200/90 bg-white p-3 text-left shadow-sm transition-colors',
                          'hover:border-primary/30 hover:bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-primary/25'
                        )}
                        aria-label={`${f.name}, 상세 보기`}
                      >
                        <div className="flex items-start gap-2">
                          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold leading-snug text-slate-900">{f.name}</p>
                            <p className="mt-1 text-[11px] leading-snug text-slate-600">{f.address}</p>
                            {f.phone ? (
                              <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">{f.phone}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <SafetyFacilityDetailFloating
        open={detailFacility != null}
        table={detailFacility?.table ?? ''}
        subtypeLabel={detailFacility ? getSubtypeLabel(detailFacility.subtype) : ''}
        facilityName={detailFacility?.name ?? ''}
        detailAttrs={detailFacility?.detailAttrs ?? {}}
        onClose={() => setDetailFacility(null)}
      />
    </div>
  );
}
