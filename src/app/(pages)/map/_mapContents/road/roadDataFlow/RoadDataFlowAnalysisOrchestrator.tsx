'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMapContext, type DataFlowReportSnapshot } from '@/app/(pages)/map/_mapComponents/MapContext';
import {
  getAllRoadLedgerDocLayerIds,
  ROAD_LEDGER_SUMMARY_LAYER_ID,
} from '@/app/(pages)/map/_mapContents/road/roadLedger/roadLedgerDocLayerMap';
import { LOCAL_ORTHO_BACKGROUND_IDS } from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';

const ROAD_DATA_FLOW_KEY = 'roadDataFlow';

type TimelineKind = 'orthophoto' | 'data_edit';

export type RoadDataFlowTimelineItem = {
  id: string;
  kind: TimelineKind;
  /** 정렬·최근 영상 매칭용 ISO 날짜 (YYYY-MM-DD) */
  sortIso: string;
  line: string;
  /** 지도 배경(자체항공 타일 id) */
  backgroundMapId: string;
};

/**
 * 자체항공영상 타일 id에서 촬영 연도만 인정 (배경지도·OpenLayers 정사 목록 규칙과 동일).
 * 업로드 폴더명 등 임의 문자열에서 첫 4자리 숫자를 뜯지 않음.
 */
function extractOrthoPhotographyYear(id: string): number | null {
  const s = String(id).trim();
  const dyn = /^satellite_(\d{4})(?:_|$)/i.exec(s);
  if (dyn) return parseInt(dyn[1], 10);
  const aerial = /^aerial-(\d{4})$/i.exec(s);
  if (aerial) return parseInt(aerial[1], 10);
  const hires = /^high-res-(\d{4})$/i.exec(s);
  if (hires) return parseInt(hires[1], 10);
  return null;
}

/** 같은 연도에 타일 id가 여러 개면 대표 1개 선택 */
function pickRepresentativeOrthoIdForYear(year: number, ids: string[]): string {
  const set = new Set(ids);
  const sat = `satellite_${year}`;
  if (set.has(sat)) return sat;
  const aerial = `aerial-${year}`;
  if (set.has(aerial)) return aerial;
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  return sorted[0] ?? ids[0];
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  return `${y}.${(m ?? '00').padStart(2, '0')}.${(d ?? '00').padStart(2, '0')}`;
}

/** 수정이력 날짜 → YYYY-MM-DD (정렬용). 파싱 불가면 맨 뒤로 보냄. */
function parseLayerHistorySortIso(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(String(raw ?? '').trim());
  if (!Number.isNaN(ms)) {
    const x = new Date(ms);
    const y = x.getFullYear();
    const mo = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  return '9999-12-31';
}

const TIMELINE_KIND_ORDER: Record<TimelineKind, number> = { orthophoto: 0, data_edit: 1 };

/** 날짜 오름차순(과거→최신). 같은 날이면 정사영상 → 데이터 수정, 그다음 id */
function compareTimelineByDateAsc(a: RoadDataFlowTimelineItem, b: RoadDataFlowTimelineItem): number {
  const t = a.sortIso.localeCompare(b.sortIso);
  if (t !== 0) return t;
  const k = TIMELINE_KIND_ORDER[a.kind] - TIMELINE_KIND_ORDER[b.kind];
  if (k !== 0) return k;
  return a.id.localeCompare(b.id);
}

function pickNearestOrthoBackground(
  orthoItems: { sortIso: string; backgroundMapId: string }[],
  beforeIso: string
): string {
  let best: { sortIso: string; backgroundMapId: string } | null = null;
  for (const o of orthoItems) {
    if (o.sortIso <= beforeIso && (!best || o.sortIso > best.sortIso)) best = o;
  }
  if (best) return best.backgroundMapId;
  return orthoItems.length ? orthoItems[orthoItems.length - 1].backgroundMapId : 'aerial-2022';
}

function roadLedgerTimelineLayerSet(): Set<string> {
  const s = new Set<string>();
  s.add(ROAD_LEDGER_SUMMARY_LAYER_ID.toLowerCase());
  for (const id of getAllRoadLedgerDocLayerIds()) {
    s.add(id.toLowerCase());
  }
  return s;
}

export function RoadDataFlowAnalysisOrchestrator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();

  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) ?? [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const roadDataFlowOpen = openedWindows.includes(ROAD_DATA_FLOW_KEY);

  const dataFlowReport = mapContext?.dataFlowReport ?? null;
  const setDataFlowReport = mapContext?.setDataFlowReport;
  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest;
  const setSpatialFilterWkt = mapContext?.setSpatialFilterWkt;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setDataFlowCompareWithCurrentLayers = mapContext?.setDataFlowCompareWithCurrentLayers;
  const dataFlowCompareWithCurrentLayers = mapContext?.dataFlowCompareWithCurrentLayers ?? false;
  const setDataFlowForcedBackgroundMapId = mapContext?.setDataFlowForcedBackgroundMapId;

  const mapBgRef = mapContext?.mapBackgroundMapIdRef;
  const visibleRef = useRef<Set<string>>(new Set(mapContext?.visibleLayerNames ?? []));
  const lastReportRef = useRef<DataFlowReportSnapshot | null>(null);

  useEffect(() => {
    visibleRef.current = new Set(mapContext?.visibleLayerNames ?? []);
  }, [mapContext?.visibleLayerNames]);

  useEffect(() => {
    if (dataFlowReport) lastReportRef.current = dataFlowReport;
  }, [dataFlowReport]);

  /** 변동이력 메뉴 종료 시 복원·초기화 */
  useEffect(() => {
    if (roadDataFlowOpen) return;
    const snap = lastReportRef.current;
    lastReportRef.current = null;
    if (snap && setVisibleLayerNames && setDataFlowForcedBackgroundMapId) {
      setVisibleLayerNames(new Set(snap.preReportVisibleLayerNames.map((x) => x.toLowerCase())));
      setDataFlowForcedBackgroundMapId(snap.preReportBackgroundMapId);
      queueMicrotask(() => setDataFlowForcedBackgroundMapId(null));
    } else {
      setDataFlowForcedBackgroundMapId?.(null);
    }
    setSpatialDrawRequest?.(null);
    setDataFlowReport?.(null);
    setDataFlowCompareWithCurrentLayers?.(false);
    setSpatialFilterWkt?.(null);
  }, [
    roadDataFlowOpen,
    setSpatialDrawRequest,
    setDataFlowReport,
    setDataFlowCompareWithCurrentLayers,
    setDataFlowForcedBackgroundMapId,
    setSpatialFilterWkt,
    setVisibleLayerNames,
  ]);

  useEffect(() => {
    if (!roadDataFlowOpen || !setSpatialDrawRequest || !setDataFlowReport) return;
    if (dataFlowReport) return;

    setSpatialDrawRequest({
      type: 'rectangle',
      onComplete: (wkt5181) => {
        const preLayers = Array.from(visibleRef.current);
        const preBg = mapBgRef?.current ?? 'aerial-2022';
        setDataFlowReport({
          extentWkt5181: wkt5181,
          preReportVisibleLayerNames: preLayers,
          preReportBackgroundMapId: preBg,
        });
        setSpatialFilterWkt?.(wkt5181);
      },
    });
    return () => {
      setSpatialDrawRequest(null);
    };
  }, [roadDataFlowOpen, dataFlowReport, setSpatialDrawRequest, setDataFlowReport, setSpatialFilterWkt, mapBgRef]);

  const [timeline, setTimeline] = useState<RoadDataFlowTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!dataFlowReport) {
      setTimeline([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    const run = async () => {
      try {
        const [orthoRes, histRes] = await Promise.all([
          call('', 'POST', {
            service: 'orthophotoService',
            action: 'listOrthophotoTileOutputs',
            params: {},
          }),
          call('', 'POST', {
            service: 'layerHistoryService',
            action: 'getLayerHistoryList',
            params: { page: 1, limit: 40 },
          }),
        ]);
        if (cancelled) return;
        const orthoData = (orthoRes?.data ?? orthoRes) as {
          groups?: { groupName: string; tileSetIds: string[] }[];
          legacyTileSetIds?: string[];
        };
        /** 업로드 그룹 폴더명 제외 — 타일 세트 id만 (연도는 id 규칙으로만 판별) */
        const idSet = new Set<string>();
        for (const id of orthoData.legacyTileSetIds ?? []) idSet.add(String(id));
        for (const g of orthoData.groups ?? []) {
          for (const tid of g.tileSetIds ?? []) idSet.add(String(tid));
        }
        for (const id of LOCAL_ORTHO_BACKGROUND_IDS) idSet.add(id);

        const yearToIds = new Map<number, string[]>();
        for (const rawId of idSet) {
          const y = extractOrthoPhotographyYear(rawId);
          if (y == null) continue;
          const cur = yearToIds.get(y) ?? [];
          cur.push(rawId);
          yearToIds.set(y, cur);
        }

        const orthoEvents: RoadDataFlowTimelineItem[] = [...yearToIds.entries()]
          .sort(([a], [b]) => a - b)
          .map(([year, ids]) => ({
            id: `ortho-year-${year}`,
            kind: 'orthophoto' as const,
            sortIso: `${year}-01-01`,
            line: `${year}년 — 정사영상 촬영`,
            backgroundMapId: pickRepresentativeOrthoIdForYear(year, ids),
          }));

        const histOuter = (histRes?.data ?? histRes) as {
          data?: Array<{
            lhKey: number;
            lhContents: string | null;
            lhCreateDate: string | null;
          }>;
        };
        const rows = Array.isArray(histOuter?.data) ? histOuter.data : [];
        const dataEvents: RoadDataFlowTimelineItem[] = rows.map((r) => {
          const sortIso = parseLayerHistorySortIso(r.lhCreateDate);
          const summary = (r.lhContents ?? '').trim();
          const dateLabel = sortIso === '9999-12-31' ? '날짜 미상' : formatDisplayDate(sortIso);
          return {
            id: `data-${r.lhKey}`,
            kind: 'data_edit',
            sortIso,
            line: `${dateLabel} — 데이터 수정${summary ? ` (${summary.slice(0, 24)}${summary.length > 24 ? '…' : ''})` : ''}`,
            backgroundMapId: '',
          };
        });

        const merged = [...orthoEvents, ...dataEvents].sort(compareTimelineByDateAsc);

        const withOrtho = orthoEvents.map((o) => ({ sortIso: o.sortIso, backgroundMapId: o.backgroundMapId }));
        for (const ev of merged) {
          if (ev.kind === 'data_edit') {
            ev.backgroundMapId = pickNearestOrthoBackground(withOrtho, ev.sortIso);
          }
        }

        setTimeline(merged);
        if (merged.length) setSelectedId(merged[merged.length - 1].id);
      } catch {
        if (!cancelled) setTimeline([]);
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [dataFlowReport]);

  const selected = useMemo(
    () => timeline.find((t) => t.id === selectedId) ?? null,
    [timeline, selectedId]
  );

  useEffect(() => {
    if (!dataFlowReport || !selected || !setVisibleLayerNames || !setDataFlowForcedBackgroundMapId) return;
    const roadSet = roadLedgerTimelineLayerSet();
    const next = new Set<string>(roadSet);
    if (dataFlowCompareWithCurrentLayers) {
      for (const x of dataFlowReport.preReportVisibleLayerNames) {
        next.add(x.toLowerCase());
      }
    }
    setVisibleLayerNames(next);
    setDataFlowForcedBackgroundMapId(selected.backgroundMapId);
  }, [
    dataFlowReport,
    selected,
    dataFlowCompareWithCurrentLayers,
    setVisibleLayerNames,
    setDataFlowForcedBackgroundMapId,
  ]);

  const exitToMap = useCallback(() => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const nextOpened = openedWindows.filter((w) => w !== ROAD_DATA_FLOW_KEY);
    if (nextOpened.length) current.set('opened', nextOpened.join(','));
    else current.delete('opened');
    router.push(`/map?${current.toString()}`);
  }, [router, searchParams, openedWindows]);

  if (!roadDataFlowOpen) return null;

  return (
    <>
      {roadDataFlowOpen && !dataFlowReport && (
        <div className="pointer-events-none fixed left-1/2 top-4 z-[120] -translate-x-1/2 rounded-md bg-slate-900/85 px-4 py-2 text-center text-sm text-white shadow-lg">
          관심 영역을 지도에서 <strong>사각형</strong>으로 그려 주세요.
        </div>
      )}

      {dataFlowReport && (
        <div
          className="fixed inset-0 z-[160] flex bg-black/25"
          role="dialog"
          aria-modal="true"
          aria-labelledby="road-data-flow-title"
        >
          <div className="flex h-full w-[min(100%,380px)] shrink-0 flex-col border-r border-slate-200 bg-white shadow-xl pointer-events-auto">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
              <div>
                <h2 id="road-data-flow-title" className="text-sm font-semibold text-slate-900">
                  변동이력 분석
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">타임라인 선택 시 해당 시점 영상·도로대장 레이어</p>
              </div>
              <button
                type="button"
                onClick={exitToMap}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                title="닫기"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-[12px] text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={dataFlowCompareWithCurrentLayers}
                onChange={(e) => setDataFlowCompareWithCurrentLayers?.(e.target.checked)}
              />
              현재 레이어 보기 (분석 전 켜 둔 레이어와 비교)
            </label>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {timelineLoading && (
                <p className="px-2 py-4 text-center text-xs text-slate-500">타임라인 불러오는 중…</p>
              )}
              {!timelineLoading && timeline.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-slate-500">표시할 이력이 없습니다.</p>
              )}
              <ul className="space-y-1">
                {timeline.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'w-full rounded-md border px-2.5 py-2 text-left text-[12px] leading-snug transition-colors',
                        selectedId === item.id
                          ? 'border-blue-500 bg-blue-50 text-slate-900'
                          : 'border-transparent bg-slate-50 text-slate-700 hover:bg-slate-100'
                      )}
                    >
                      <span className="block font-medium text-slate-800">{item.line}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {item.kind === 'orthophoto' ? '자체항공영상' : '데이터 수정이력'} · 배경{' '}
                        <code className="text-[10px]">{item.backgroundMapId}</code>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="min-w-0 flex-1 pointer-events-none" aria-hidden />
        </div>
      )}
    </>
  );
}
