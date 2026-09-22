'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Users } from 'lucide-react';
import Draw from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';
import GeoJSON from 'ol/format/GeoJSON';
import { LineString } from 'ol/geom';
import WKT from 'ol/format/WKT';
import { Fill, Stroke, Style } from 'ol/style';
import type { Map as OlMap } from 'ol';
import type Geometry from 'ol/geom/Geometry';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fetchLandInfoConfig } from '@/lib/vworldParcelLandClient';
import { fetchParcelTabData } from '../../../_mapComponents/landInfo/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';

type Phase = 'off' | 'line1' | 'line2' | 'querying' | 'done';

export type ParcelRow = {
  address: string;
  pnu: string;
  ownGbn: string;
  intersectAreaSqm: number | null;
  geometry3857?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
};

type Props = {
  tab: 'river' | 'smallRiver';
  riverName: string;
  planYear: string;
  planName: string;
  planLen: string;
  children: ReactNode;
};

const OWN_GBN_KO: Record<string, string> = {
  '00': '일본인, 창씨명등',
  '01': '개인',
  '02': '국유지',
  '03': '외국인, 외국공공기관',
  '04': '시, 도유지',
  '05': '군유지',
  '06': '법인',
  '07': '종중',
  '08': '종교단체',
  '09': '기타단체',
};

const OWN_GBN_ORDER = Object.values(OWN_GBN_KO);

/** 색인도·사유지 요약 카드 공통 */
const SUMMARY_CHIP_CLASS =
  'flex min-h-[40px] w-full items-center justify-start gap-1.5 rounded border border-border bg-background px-1.5 py-1.5 text-left text-[11px] font-medium leading-tight text-foreground hover:bg-muted/50';

/** 하천기본계획 속성표와 동일 */
const PLAN_ATTR_LABEL =
  'bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap';
const PLAN_ATTR_VALUE =
  'min-w-0 px-2.5 py-1.5 text-[11px] text-muted-foreground break-all';

const TABLE_TH_CLASS =
  'border-b border-border bg-muted px-2.5 py-1.5 align-middle text-[11px] font-medium text-muted-foreground';

const LINE_STYLE = new Style({
  stroke: new Stroke({ color: '#2196F3', width: 2.5 }),
});
const STRIP_STYLE = new Style({
  stroke: new Stroke({ color: '#2196F3', width: 1 }),
  fill: new Fill({ color: 'rgba(33, 150, 243, 0.15)' }),
});
const PARCEL_STYLE = new Style({
  stroke: new Stroke({ color: '#F59E0B', width: 2 }),
  fill: new Fill({ color: 'rgba(245, 158, 11, 0.28)' }),
});
const PARCEL_PICKED_STYLE = new Style({
  stroke: new Stroke({ color: '#EA580C', width: 2.5 }),
  fill: new Fill({ color: 'rgba(234, 88, 12, 0.4)' }),
});

function ownGbnLabel(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s || s === '미상') return '미상';
  if (/[가-힣]/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;
  return OWN_GBN_KO[digits.padStart(2, '0')] ?? s;
}

function fieldOf(row: Record<string, unknown> | undefined, keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

type LandCtx = {
  canStart: boolean;
  phase: Phase;
  hint: string;
  error: string;
  parcels: ParcelRow[];
  categoryView: string | null;
  sectionOpen: boolean;
  pickedPnu: string | null;
  ownerLoading: boolean;
  ownerError: string;
  owner: Record<string, string> | null;
  begin: () => void;
  setSectionOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  openCategoryView: (label: string) => void;
  closeCategoryView: () => void;
  pick: (pnu: string) => void;
  groups: [string, ParcelRow[]][];
};

const Ctx = createContext<LandCtx | null>(null);

function useLand() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('사유지 컨텍스트가 없습니다.');
  return ctx;
}

/** 상세 스크롤 분기용 */
export function useRiverBasicPlanPrivateLandCategoryView(): string | null {
  return useContext(Ctx)?.categoryView ?? null;
}

export function RiverBasicPlanPrivateLandRoot({
  tab,
  riverName,
  planYear,
  planName,
  planLen,
  children,
}: Props) {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef;
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const lineRef = useRef<LineString | null>(null);

  const [phase, setPhase] = useState<Phase>('off');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [categoryView, setCategoryView] = useState<string | null>(null);
  const [pickedPnu, setPickedPnu] = useState<string | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const [owner, setOwner] = useState<Record<string, string> | null>(null);

  const planKey = `${tab}|${riverName}|${planYear}|${planName}|${planLen}`;
  const canStart = Boolean(riverName.trim() && planName.trim());

  const groups = useMemo(() => {
    const map = new Map<string, ParcelRow[]>();
    for (const row of parcels) {
      const key = row.ownGbn || '미상';
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => {
      const ai = OWN_GBN_ORDER.indexOf(a[0]);
      const bi = OWN_GBN_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [parcels]);

  const clearMap = useCallback(() => {
    const map = mapRef?.current ?? null;
    if (drawRef.current && map) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    if (layerRef.current && map) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    sourceRef.current = null;
    lineRef.current = null;
  }, [mapRef]);

  const reset = useCallback(() => {
    clearMap();
    setPhase('off');
    setHint('');
    setError('');
    setParcels([]);
    setSectionOpen(true);
    setCategoryView(null);
    setPickedPnu(null);
    setOwner(null);
    setOwnerError('');
  }, [clearMap]);

  useEffect(() => {
    reset();
  }, [planKey, reset]);

  useEffect(() => () => clearMap(), [clearMap]);

  const ensureLayer = useCallback((map: OlMap) => {
    if (sourceRef.current && layerRef.current) return sourceRef.current;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        if (feature.get('kind') === 'parcel') {
          return feature.get('picked') ? PARCEL_PICKED_STYLE : PARCEL_STYLE;
        }
        const t = feature.getGeometry()?.getType();
        return t === 'Polygon' || t === 'MultiPolygon' ? STRIP_STYLE : LINE_STYLE;
      },
      zIndex: 80,
    });
    layer.set('mapSplitNoMirror', true);
    map.addLayer(layer);
    sourceRef.current = source;
    layerRef.current = layer;
    return source;
  }, []);

  const clearParcelFeatures = useCallback((source: VectorSource) => {
    source
      .getFeatures()
      .filter((f) => f.get('kind') === 'parcel')
      .forEach((f) => source.removeFeature(f));
  }, []);

  const syncParcelFeatures = useCallback(
    (rows: ParcelRow[], selectedPnu: string | null, fit: boolean) => {
      const map = mapRef?.current ?? null;
      const source = sourceRef.current;
      if (!map || !source) return;
      clearParcelFeatures(source);
      const format = new GeoJSON();
      let fitExtent: [number, number, number, number] | null = null;
      for (const row of rows) {
        if (!row.geometry3857 || typeof row.geometry3857 !== 'object') continue;
        try {
          const olGeom = format.readGeometry(row.geometry3857, {
            dataProjection: 'EPSG:3857',
            featureProjection: 'EPSG:3857',
          }) as Geometry | null;
          if (!olGeom) continue;
          const feature = new Feature(olGeom);
          feature.set('kind', 'parcel');
          feature.set('pnu', row.pnu);
          feature.set('picked', Boolean(selectedPnu && row.pnu === selectedPnu));
          source.addFeature(feature);
          const ext =
            row.extent3857 &&
            Array.isArray(row.extent3857) &&
            row.extent3857.length === 4
              ? row.extent3857
              : (olGeom.getExtent() as [number, number, number, number]);
          if (selectedPnu && row.pnu === selectedPnu) {
            fitExtent = ext;
          } else if (!selectedPnu && ext) {
            if (!fitExtent) fitExtent = [...ext];
            else {
              fitExtent[0] = Math.min(fitExtent[0], ext[0]);
              fitExtent[1] = Math.min(fitExtent[1], ext[1]);
              fitExtent[2] = Math.max(fitExtent[2], ext[2]);
              fitExtent[3] = Math.max(fitExtent[3], ext[3]);
            }
          }
        } catch {
          /* 개별 필지 표시 실패는 무시 */
        }
      }
      if (fit && fitExtent) {
        scheduleFitMapToExtent3857(map, fitExtent, { maxZoom: MAP_AUTO_NAV_MAX_ZOOM });
      }
    },
    [clearParcelFeatures, mapRef]
  );

  const queryBetweenLines = useCallback(
    async (line1: LineString, line2: LineString, source: VectorSource) => {
      setPhase('querying');
      setHint('겹치는 필지를 조회하는 중');
      setError('');
      const line1Wkt3857 = new WKT().writeGeometry(line1);
      const line2Wkt3857 = new WKT().writeGeometry(line2);
      try {
        const res = await call('', 'POST', {
          service: 'riverBasicPlanService',
          action: 'listRiverBasicPlanPrivateLand',
          params: { tab, riverName, planYear, planName, planLen, line1Wkt3857, line2Wkt3857 },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          setError(String(data.error));
          setParcels([]);
          setPhase('done');
          setSectionOpen(true);
          return;
        }
        // 두 선으로 자른 하천 구간만 지도에 표시
        const zoneGeom = data?.zoneGeometry3857;
        if (zoneGeom != null && typeof zoneGeom === 'object') {
          try {
            const olGeom = new GeoJSON().readGeometry(zoneGeom, {
              dataProjection: 'EPSG:3857',
              featureProjection: 'EPSG:3857',
            }) as Geometry | null;
            if (olGeom) {
              source.getFeatures().forEach((f) => {
                const t = f.getGeometry()?.getType();
                if (t === 'Polygon' || t === 'MultiPolygon') source.removeFeature(f);
              });
              const zoneFeature = new Feature(olGeom);
              zoneFeature.set('kind', 'zone');
              source.addFeature(zoneFeature);
            }
          } catch {
            /* 표시 실패해도 목록은 유지 */
          }
        }
        const rows = (Array.isArray(data?.parcels) ? (data.parcels as ParcelRow[]) : []).map((row) => ({
          ...row,
          ownGbn: ownGbnLabel(row.ownGbn),
        }));
        setParcels(rows);
        setPhase('done');
        setSectionOpen(true);
        setHint('');
      } catch {
        setError('필지 목록을 불러오지 못했습니다.');
        setPhase('done');
        setSectionOpen(true);
      }
    },
    [planLen, planName, planYear, riverName, tab]
  );

  const startDraw = useCallback(
    (which: 'line1' | 'line2', map: OlMap) => {
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      const source = ensureLayer(map);
      const draw = new Draw({
        source,
        type: 'LineString',
        maxPoints: 2,
        stopClick: true,
        style: LINE_STYLE,
      });
      draw.on('drawend', (evt) => {
        const geom = evt.feature.getGeometry();
        if (!(geom instanceof LineString)) return;
        map.removeInteraction(draw);
        drawRef.current = null;
        if (which === 'line1') {
          lineRef.current = geom;
          setPhase('line2');
          setHint('종료선을 자유롭게 긋으세요');
          startDraw('line2', map);
          return;
        }
        const first = lineRef.current;
        if (!first) {
          setError('시작선이 없습니다.');
          setPhase('done');
          return;
        }
        void queryBetweenLines(first, geom, source);
      });
      map.addInteraction(draw);
      drawRef.current = draw;
    },
    [ensureLayer, queryBetweenLines]
  );

  const begin = useCallback(() => {
    if (!canStart) return;
    if (phase === 'line1' || phase === 'line2' || phase === 'querying') {
      reset();
      return;
    }
    const map = mapRef?.current ?? null;
    if (!map) {
      setError('지도가 없습니다.');
      return;
    }
    reset();
    setPhase('line1');
    setHint('시작선을 자유롭게 긋으세요');
    setError('');
    startDraw('line1', map);
  }, [canStart, mapRef, phase, reset, startDraw]);

  const openCategoryView = useCallback((label: string) => {
    setCategoryView(label);
    setPickedPnu(null);
    setOwner(null);
    setOwnerError('');
  }, []);

  const closeCategoryView = useCallback(() => {
    setCategoryView(null);
    setPickedPnu(null);
    setOwner(null);
    setOwnerError('');
    const source = sourceRef.current;
    if (source) clearParcelFeatures(source);
  }, [clearParcelFeatures]);

  const pick = useCallback((pnu: string) => {
    setPickedPnu((prev) => (prev === pnu ? null : pnu));
  }, []);

  /** 소유구분 진입·필지 선택 시 지도에 필지 표시 */
  useEffect(() => {
    if (!categoryView) return;
    const rows = parcels.filter((p) => (p.ownGbn || '미상') === categoryView);
    syncParcelFeatures(rows, pickedPnu, true);
  }, [categoryView, parcels, pickedPnu, syncParcelFeatures]);

  /** 모달 활성 시 지도에서 필지 클릭 → 목록 선택 */
  useEffect(() => {
    if (!categoryView) return;
    const map = mapRef?.current ?? null;
    if (!map) return;

    const onClick = (evt: { pixel: number[]; stopPropagation: () => void }) => {
      const layer = layerRef.current;
      if (!layer) return;
      let hitPnu = '';
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, featLayer) => {
          if (featLayer !== layer) return undefined;
          if (feature.get('kind') !== 'parcel') return undefined;
          const pnu = String(feature.get('pnu') ?? '').trim();
          if (!pnu) return undefined;
          hitPnu = pnu;
          return true;
        },
        { hitTolerance: 5, layerFilter: (l) => l === layer }
      );
      if (!hitPnu) return;
      evt.stopPropagation();
      setPickedPnu(hitPnu);
    };

    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [categoryView, mapRef]);

  useEffect(() => {
    if (!pickedPnu) {
      setOwner(null);
      setOwnerError('');
      return;
    }
    let alive = true;
    setOwnerLoading(true);
    setOwnerError('');
    setOwner(null);
    void (async () => {
      try {
        const cfg = await fetchLandInfoConfig();
        const tabData = await fetchParcelTabData({ pnu: pickedPnu, vworldKey: cfg.vworldKey });
        if (!alive) return;
        const row = (tabData.possessions?.[0] ?? {}) as Record<string, unknown>;
        const next = {
          소유구분: fieldOf(row, ['posesnSeCodeNm']),
          소유자명: fieldOf(row, ['ownerNm', 'ownerName']),
          소유자주소: fieldOf(row, ['ownerAddr', 'address']),
          공유인수: fieldOf(row, ['cnrsPsnCo', 'shareCnt']),
          변동원인: fieldOf(row, ['ownshipChgCauseCodeNm']),
        };
        const has = Object.values(next).some(Boolean);
        setOwner(has ? next : null);
        if (!has) setOwnerError(tabData.krasSkipReason || '소유자 정보가 없습니다.');
      } catch {
        if (alive) setOwnerError('소유자 정보를 불러오지 못했습니다.');
      } finally {
        if (alive) setOwnerLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pickedPnu]);

  const value = useMemo<LandCtx>(
    () => ({
      canStart,
      phase,
      hint,
      error,
      parcels,
      categoryView,
      sectionOpen,
      pickedPnu,
      ownerLoading,
      ownerError,
      owner,
      begin,
      setSectionOpen,
      openCategoryView,
      closeCategoryView,
      pick,
      groups,
    }),
    [
      begin,
      canStart,
      categoryView,
      closeCategoryView,
      error,
      groups,
      hint,
      openCategoryView,
      owner,
      ownerError,
      ownerLoading,
      parcels,
      phase,
      pick,
      pickedPnu,
      sectionOpen,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RiverBasicPlanPrivateLandButton() {
  const { canStart, phase, begin } = useLand();
  const drawing = phase === 'line1' || phase === 'line2' || phase === 'querying';
  const active = drawing || phase === 'done';
  return (
    <button
      type="button"
      disabled={!canStart}
      onClick={begin}
      title={canStart ? '시작선·종료선 사이의 소유 필지' : '기본계획을 선택하세요'}
      className={cn(
        'h-7 text-[11px] rounded border flex-1 min-w-0 whitespace-nowrap inline-flex items-center justify-center gap-1',
        !canStart
          ? 'border-border bg-muted/50 text-muted-foreground opacity-50 cursor-not-allowed'
          : active
            ? 'border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15'
            : 'border-border bg-muted/50 text-foreground/90 hover:bg-muted'
      )}
    >
      {drawing ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      사유지
    </button>
  );
}

/** 메인 상세 — 소유구분 요약만 (색인도 그리드·제목 패딩과 동일) */
export function RiverBasicPlanPrivateLandSection() {
  const { phase, hint, error, groups, sectionOpen, setSectionOpen, openCategoryView } = useLand();

  if (phase === 'off') return null;

  const total = groups.reduce((n, [, rows]) => n + rows.length, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setSectionOpen((v) => !v)}
          title={sectionOpen ? '사유지 접기' : '사유지 펼치기'}
        >
          {sectionOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span>사유지</span>
        </button>
        {phase === 'done' && !error ? (
          <span className="text-[11px] text-muted-foreground">총 {total}건</span>
        ) : null}
      </div>
      {sectionOpen ? (
        <div className="space-y-2">
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
          {error ? <p className="text-sm text-destructive py-1">{error}</p> : null}
          {phase === 'done' && !error && groups.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">겹치는 필지가 없습니다.</p>
          ) : null}
          {phase === 'done' && !error && groups.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {groups.map(([label, rows]) => (
                <button
                  key={label}
                  type="button"
                  className={SUMMARY_CHIP_CLASS}
                  title={`${label} ${rows.length}건`}
                  onClick={() => openCategoryView(label)}
                >
                  <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{rows.length}건</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 소유구분 선택 시 — 색인도 상세와 같이 스크롤 영역 전환 */
export function RiverBasicPlanPrivateLandCategoryPanel() {
  const {
    categoryView,
    closeCategoryView,
    groups,
    pickedPnu,
    pick,
    ownerLoading,
    ownerError,
    owner,
  } = useLand();

  const rows = useMemo(() => {
    if (!categoryView) return [];
    return groups.find(([label]) => label === categoryView)?.[1] ?? [];
  }, [categoryView, groups]);

  const picked = useMemo(
    () => rows.find((r) => r.pnu && r.pnu === pickedPnu) ?? null,
    [pickedPnu, rows]
  );

  const ownerRows = useMemo(() => {
    if (!picked) return [];
    const list: { label: string; value: string }[] = [
      { label: '주소', value: picked.address || picked.pnu },
      {
        label: '면적',
        value:
          picked.intersectAreaSqm != null
            ? `${Math.round(picked.intersectAreaSqm).toLocaleString()}㎡`
            : '—',
      },
      { label: '소유구분', value: owner?.소유구분 || categoryView || '—' },
    ];
    if (owner) {
      if (owner.소유자명) list.push({ label: '소유자명', value: owner.소유자명 });
      if (owner.소유자주소) list.push({ label: '소유자주소', value: owner.소유자주소 });
      if (owner.공유인수) list.push({ label: '공유인수', value: owner.공유인수 });
      if (owner.변동원인) list.push({ label: '변동원인', value: owner.변동원인 });
    }
    return list;
  }, [categoryView, owner, picked]);

  useEffect(() => {
    if (!pickedPnu) return;
    const el = document.querySelector(`[data-pnu="${CSS.escape(pickedPnu)}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [pickedPnu]);

  if (!categoryView) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">사유지 · {categoryView}</p>
        <button
          type="button"
          onClick={closeCategoryView}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          title="사유지 목록으로"
          aria-label="사유지 목록으로"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex min-h-0 max-h-[min(480px,60vh)] flex-1 flex-col overflow-hidden rounded border border-border bg-background">
          <table className="w-full shrink-0 text-[11px] text-foreground">
            <colgroup>
              <col className="w-8" />
              <col />
              <col className="w-[5.5rem]" />
            </colgroup>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className={cn(TABLE_TH_CLASS, 'text-center')}>
                  No
                </th>
                <th scope="col" className={cn(TABLE_TH_CLASS, 'text-left')}>
                  주소
                </th>
                <th scope="col" className={cn(TABLE_TH_CLASS, 'text-right')}>
                  면적
                </th>
              </tr>
            </thead>
          </table>
          <MapSideDetailScroll className="min-h-0 flex-1">
            <table className="w-full text-[11px] text-foreground">
              <colgroup>
                <col className="w-8" />
                <col />
                <col className="w-[5.5rem]" />
              </colgroup>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2.5 py-3 text-center text-muted-foreground">
                      필지가 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const selected = pickedPnu === row.pnu && Boolean(row.pnu);
                    return (
                      <tr
                        key={row.pnu || `${index}`}
                        data-pnu={row.pnu || undefined}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'border-b border-border last:border-b-0 cursor-pointer',
                          selected
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted/50 text-foreground/90'
                        )}
                        onClick={() => row.pnu && pick(row.pnu)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (row.pnu) pick(row.pnu);
                          }
                        }}
                      >
                        <td className="px-2.5 py-1.5 text-center tabular-nums text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="min-w-0 truncate px-2.5 py-1.5" title={row.address}>
                          {row.address || row.pnu}
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {row.intersectAreaSqm != null
                            ? `${Math.round(row.intersectAreaSqm).toLocaleString()}㎡`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </MapSideDetailScroll>
        </div>

        {picked ? (
          <div className="shrink-0 overflow-hidden rounded border border-border bg-background">
            {ownerLoading ? (
              <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">소유자 조회 중…</p>
            ) : ownerError && ownerRows.length <= 3 ? (
              <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">{ownerError}</p>
            ) : (
              <>
                {ownerRows.map((row, index) => (
                  <div
                    key={row.label}
                    className={cn('flex', index !== ownerRows.length - 1 && 'border-b border-border')}
                  >
                    <div className={cn(PLAN_ATTR_LABEL, 'flex w-[5.5rem] shrink-0 items-start self-stretch')}>
                      {row.label}
                    </div>
                    <div className={cn(PLAN_ATTR_VALUE, 'flex-1')}>{row.value || '—'}</div>
                  </div>
                ))}
                {ownerError && ownerRows.length > 3 ? (
                  <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    {ownerError}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <p className="shrink-0 text-[11px] text-muted-foreground">주소를 선택하면 소유 정보가 표시됩니다.</p>
        )}
      </div>
    </div>
  );
}
