'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Cctv,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Gauge,
  List,
  Loader2,
  MapPin,
  RefreshCw,
  X,
} from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import { cn } from '@/lib/utils';
import { SafetyWaterStationFloating } from './SafetyWaterStationFloating';
import { buildDummyRiskAreas, riskFillRgba } from './safetyWaterDummyRisk';
import { useSafetyWater } from './safetyWaterContext';
import type { FloodTimeType, SafetyWaterDummyRisk } from './safetyWaterTypes';

const TIME_OPTIONS: { value: FloodTimeType; label: string }[] = [
  { value: '10M', label: '10분' },
  { value: '1H', label: '1시간' },
  { value: '1D', label: '1일' },
];

function formatTime(d: Date) {
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Ymdhm: 12+ → HH:mm, 10 → MM-DD HH시, 8 → YYYY-MM-DD */
function formatYmdhm(ymdhm: string | undefined) {
  if (!ymdhm) return '—';
  const s = ymdhm.replace(/\D/g, '');
  if (s.length >= 12) {
    return `${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }
  if (s.length >= 10) {
    return `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}시`;
  }
  if (s.length >= 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return '—';
}

function formatForecastAncdt(raw: string) {
  const s = raw.replace(/\D/g, '');
  if (s.length >= 12) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }
  if (s.length >= 8) return formatYmdhm(s);
  return raw || '—';
}

function TimeChipGroup({
  value,
  onChange,
}: {
  value: FloodTimeType;
  onChange: (value: FloodTimeType) => void;
}) {
  return (
    <div className="inline-flex rounded border border-slate-200 bg-white p-0.5" role="group">
      {TIME_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              'cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
              active ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type Props = {
  onClose: () => void;
};

export function SafetyWaterPanel({ onClose }: Props) {
  const stationRowRef = useRef<HTMLDivElement>(null);
  const {
    loading,
    refreshing,
    obsLoading,
    listOpen,
    setListOpen,
    stations,
    waterObs,
    rainObs,
    obsError,
    uiError,
    selectedStationId,
    setSelectedStationId,
    focusStation,
    selectedStation,
    timeType,
    setTimeType,
    statsKinds,
    toggleStats,
    rainIsPaired,
    waterIsPaired,
    rainLabel,
    waterLabel,
    isAverageMode,
    lastRefresh,
    refreshStations,
    forecasts,
    forecastLoading,
    forecastOpen,
    toggleForecastOpen,
    cctvOpen,
    toggleCctvOpen,
    hasCctvForSelection,
    stationIdsWithCctv,
    map,
    mapReady,
  } = useSafetyWater();

  const riskAreas = useMemo(() => buildDummyRiskAreas(stations), [stations]);

  const flyToRisk = useCallback(
    (area: SafetyWaterDummyRisk) => {
      if (!mapReady) return;
      const instance = map;
      if (!instance) return;
      instance.getView().animate({
        center: fromLonLat([area.lon, area.lat]),
        zoom: Math.max(instance.getView().getZoom() ?? 15, 16),
        duration: 450,
      });
    },
    [map, mapReady]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden opacity-[0.98]" aria-label="침수 홍수 현황">
      <div className="relative shrink-0 border-b border-slate-200 bg-gradient-to-b from-[#f0f9fc] to-white">
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-800">침수·홍수 현황</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              강수량·수위·피해 예상 지역을 한 화면에서 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={stationRowRef} className="relative border-t border-slate-200/80">
          <button
            type="button"
            onClick={() => setListOpen(!listOpen)}
            className={cn(
              'flex h-10 w-full cursor-pointer items-center justify-between gap-2 px-4 text-left transition-colors',
              listOpen ? 'bg-slate-100' : 'hover:bg-slate-100'
            )}
            title="목록 보기"
            aria-label="목록 보기"
            aria-expanded={listOpen}
          >
            <span
              className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-none text-slate-800"
              title={selectedStation?.name ?? '전체'}
            >
              {selectedStation?.name ?? (loading ? '불러오는 중…' : '전체')}
            </span>
            <span className="inline-flex shrink-0 items-center justify-center text-slate-500" aria-hidden>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <List className="h-4 w-4" />}
            </span>
          </button>
          <SafetyWaterStationFloating
            open={listOpen}
            stations={stations}
            selectedId={selectedStationId}
            onSelect={(id) => {
              if (id == null) setSelectedStationId(null);
              else focusStation(id);
              setListOpen(false);
            }}
            onClose={() => setListOpen(false)}
            anchorRef={stationRowRef}
            cctvStationIds={stationIdsWithCctv}
          />
        </div>

        <div className="flex h-10 w-full items-center gap-2 border-t border-slate-200/80 px-4">
          <span className="text-[11px] leading-none text-slate-500">마지막 갱신</span>
          <span className="text-[11px] font-medium leading-none tabular-nums text-slate-700">
            {lastRefresh ? formatTime(lastRefresh) : '—'}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={refreshStations}
            disabled={refreshing || loading}
            className={cn(
              'inline-flex h-full cursor-pointer items-center gap-1 text-[11px] font-medium transition-colors',
              refreshing || loading ? 'cursor-wait text-slate-400' : 'text-primary hover:text-primary/80'
            )}
            title="현황 새로고침"
            aria-label="현황 새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (refreshing || loading) && 'animate-spin')} />
            새로고침
          </button>
        </div>

        <div className="flex w-full items-center gap-2 border-t border-slate-200/80 px-4 py-2">
          <div className="flex flex-col gap-1">
            <TimeChipGroup value={timeType} onChange={setTimeType} />
          </div>
          <span className="flex-1" />
          <button
            type="button"
            title="홍수 예보"
            aria-label="홍수 예보"
            aria-pressed={forecastOpen}
            onClick={toggleForecastOpen}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors',
              forecastOpen
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            홍수 예보
          </button>
          <button
            type="button"
            title="주변 도로 현황"
            aria-label="주변 도로 현황"
            aria-pressed={cctvOpen}
            disabled={!hasCctvForSelection}
            onClick={toggleCctvOpen}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors',
              !hasCctvForSelection
                ? 'cursor-not-allowed border-slate-200 text-slate-400'
                : cctvOpen
                  ? 'border-sky-300 bg-sky-50 text-sky-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            )}
          >
            <Cctv className="h-3.5 w-3.5" aria-hidden />
            주변 도로
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/90 p-3">
        {(uiError || obsError) && (
          <div
            className={cn(
              'rounded-[5px] border px-3 py-2 text-[12px] font-medium',
              (uiError ?? obsError)!.errorClass === 'provider'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-800'
            )}
            role="alert"
          >
            {(uiError ?? obsError)!.uiMessage}
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleStats('rain')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleStats('rain');
            }
          }}
          className={cn(
            'cursor-pointer rounded-[5px] border bg-white p-3 text-left shadow-sm transition-colors hover:bg-slate-50',
            statsKinds.includes('rain') ? 'border-primary ring-1 ring-primary/30' : 'border-slate-200/90'
          )}
          title={statsKinds.includes('rain') ? '강수량 기간별 통계 닫기' : '강수량 기간별 통계 보기'}
          aria-label={statsKinds.includes('rain') ? '강수량 기간별 통계 닫기' : '강수량 기간별 통계 보기'}
          aria-pressed={statsKinds.includes('rain')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <Droplets className="h-4 w-4 shrink-0 text-sky-600" strokeWidth={1.75} aria-hidden />
              <h3 className="text-[12px] font-semibold text-slate-800">현재 강수량</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isAverageMode && rainObs?.averageCount != null ? (
                <span className="text-[10px] leading-none text-slate-500">
                  관측소 {rainObs.averageCount}개 평균
                </span>
              ) : null}
              {rainIsPaired ? (
                <span className="max-w-[9rem] text-right text-[10px] leading-snug text-slate-500">
                  가장 가까운 강수 관측소 값
                </span>
              ) : null}
              <span
                title={statsKinds.includes('rain') ? '강수량 기간별 통계 닫기' : '강수량 기간별 통계 보기'}
                className="inline-flex text-slate-400"
              >
                {statsKinds.includes('rain') ? (
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                )}
              </span>
            </div>
          </div>
          <dl className="mt-2 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="min-w-0 truncate text-slate-500">{rainLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-slate-800">
                {rainObs?.value != null ? `${rainObs.value.toFixed(1)} mm` : '— mm'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">기준 시각</dt>
              <dd className="tabular-nums text-slate-600">{formatYmdhm(rainObs?.observedAt)}</dd>
            </div>
          </dl>
          {obsLoading ? <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden /> : null}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleStats('water')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleStats('water');
            }
          }}
          className={cn(
            'cursor-pointer rounded-[5px] border bg-white p-3 text-left shadow-sm transition-colors hover:bg-slate-50',
            statsKinds.includes('water') ? 'border-primary ring-1 ring-primary/30' : 'border-slate-200/90'
          )}
          title={statsKinds.includes('water') ? '수위 기간별 통계 닫기' : '수위 기간별 통계 보기'}
          aria-label={statsKinds.includes('water') ? '수위 기간별 통계 닫기' : '수위 기간별 통계 보기'}
          aria-pressed={statsKinds.includes('water')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <Gauge className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
              <h3 className="text-[12px] font-semibold text-slate-800">현재 수위</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isAverageMode && waterObs?.averageCount != null ? (
                <span className="text-[10px] leading-none text-slate-500">
                  관측소 {waterObs.averageCount}개 평균
                </span>
              ) : null}
              {waterIsPaired ? (
                <span className="max-w-[9rem] text-right text-[10px] leading-snug text-slate-500">
                  가장 가까운 수위 관측소 값
                </span>
              ) : null}
              <span
                title={statsKinds.includes('water') ? '수위 기간별 통계 닫기' : '수위 기간별 통계 보기'}
                className="inline-flex text-slate-400"
              >
                {statsKinds.includes('water') ? (
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                )}
              </span>
            </div>
          </div>
          <dl className="mt-2 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="min-w-0 truncate text-slate-500">{waterLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-slate-800">
                {waterObs?.value != null ? `${waterObs.value.toFixed(2)} m` : '— m'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">기준 시각</dt>
              <dd className="tabular-nums text-slate-600">{formatYmdhm(waterObs?.observedAt)}</dd>
            </div>
          </dl>
          {obsLoading ? <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden /> : null}
        </div>

        <section className="rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" strokeWidth={1.75} aria-hidden />
            <h3 className="text-[12px] font-semibold text-slate-800">홍수 예보 발령</h3>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              (더미)
            </span>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">최근 24시간 내 예보</p>
          {forecastLoading ? (
            <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden />
          ) : forecasts.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-500">해당 없음</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
              {forecasts.map((f, i) => (
                <li
                  key={`${f.sttnm}-${f.ancdt}-${f.no}-${i}`}
                  className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-[11px]"
                >
                  <div className="font-medium text-slate-800">
                    {f.kind || '예보'}
                    {f.obsnm ? ` · ${f.obsnm}` : ''}
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    {formatForecastAncdt(f.ancdt)}
                    {f.rvrnm ? ` · ${f.rvrnm}` : ''}
                  </div>
                  {f.wrnaranm ? (
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">주의 지역 · {f.wrnaranm}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[5px] border border-slate-200/90 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <MapPin className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.75} aria-hidden />
            <h3 className="text-[12px] font-semibold text-slate-800">피해 예상 지역</h3>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              더미 사용중
            </span>
          </div>
          <p className="mt-2 text-[13px] font-semibold tabular-nums text-slate-900">
            예상 <span className="text-primary">{riskAreas.length}</span> 건
            <span className="ml-1 text-[11px] font-normal text-slate-500">(필지·블록)</span>
          </p>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
            {riskAreas.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  title={`${r.name}로 이동`}
                  onClick={() => flyToRisk(r)}
                  className="w-full cursor-pointer rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-left text-[11px] transition-colors hover:border-sky-200 hover:bg-sky-50/80"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-200"
                      style={{ backgroundColor: riskFillRgba(r.proximity) }}
                      title={
                      r.proximity >= 0.7
                        ? '피해 많음(짙은 파랑)'
                        : r.proximity >= 0.4
                          ? '피해 보통'
                          : '피해 적음(연한 파랑)'
                    }
                      aria-hidden
                    />
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    {r.riskLevel}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
