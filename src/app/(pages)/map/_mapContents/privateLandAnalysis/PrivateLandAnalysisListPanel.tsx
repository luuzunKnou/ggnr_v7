'use client';

import { useMemo } from 'react';
import { Loader2, MapPin, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { usePrivateLandAnalysis, type PrivateLandAnalysisPhase } from './PrivateLandAnalysisContext';
import { PrivateLandAnalysisAreaModal } from './PrivateLandAnalysisAreaModal';
import { PrivateLandAnalysisMapGuide } from './PrivateLandAnalysisMapGuide';
import {
  formatSqm,
  jimokBadgeStyle,
  ownGbnBadgeStyle,
  ownFilterOptions,
  ownGbnShort,
} from './privateLandAnalysisFormat';

type Props = {
  onClose: () => void;
};

const RANGING_TEXT: Partial<Record<PrivateLandAnalysisPhase, string>> = {
  start: '지도에서 하천 위 시작 위치를 찍으세요.',
  loadingBase: '하천 도형을 불러오는 중…',
  end: '하천을 따라 끝 위치를 찍으세요.',
  ranged: '지도에서 적용을 누르면 바로 분석합니다.',
  applying: '구간을 계산하는 중…',
};

const CLOSED_RANGING_TEXT: Partial<Record<PrivateLandAnalysisPhase, string>> = {
  start: '지도에서 도로를 가로질러 경계선을 찍으세요.',
  ranged: '경계선으로 범위를 닫고 적용하세요.',
};

/** 소유구분 필터 한 줄 칸 수 — 넘치면 두 줄 */
const OWN_FILTER_COLS = 6;

const CHIP_BASE =
  'min-w-0 truncate rounded border px-0.5 py-1 text-center text-[10px] font-medium leading-tight transition-colors';
const CHIP_ON = 'border-primary bg-primary/10 text-primary';
const CHIP_OFF = 'border-border bg-background text-muted-foreground hover:bg-muted/50';

const BTN_CHANGE =
  'h-7 flex-1 gap-1 border-primary/40 bg-primary/5 px-2 text-[10px] font-medium text-primary hover:bg-primary/10 hover:text-primary';
const BTN_RESET =
  'h-7 flex-1 gap-1 border-amber-300/80 bg-amber-50 px-2 text-[11px] font-medium text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60 dark:hover:text-amber-100';
type SummaryRow = { label: string; value: string; highlight?: boolean };

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={cn('flex items-stretch', index !== rows.length - 1 && 'border-b border-border')}
        >
          <div className="flex w-[64px] shrink-0 items-start bg-muted px-2.5 py-1.5">
            <span className="text-[11px] leading-snug text-muted-foreground">{row.label}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-start px-2.5 py-1.5">
            <span
              className={cn(
                'break-words text-[11px] leading-snug',
                row.highlight ? 'font-medium text-primary' : 'text-muted-foreground'
              )}
            >
              {row.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PrivateLandAnalysisListPanel({ onClose }: Props) {
  const {
    layer,
    phase,
    baseName,
    zoneAreaSqm,
    parcels,
    truncated,
    ownFilter,
    keyword,
    filteredParcels,
    selectedPnu,
    includeTributary,
    tribCutCount,
    rangeMode,
    closedLineCount,
    openAreaModal,
    changeArea,
    resetAll,
    setOwnFilter,
    setKeyword,
    selectParcel,
  } = usePrivateLandAnalysis();

  const ownFilters = useMemo(() => ownFilterOptions(parcels.map((p) => p.ownGbn)), [parcels]);

  const confirmed = phase === 'applied' || phase === 'analyzing' || phase === 'result';
  const closed = rangeMode === 'closed';
  const rangingText = closed ? (CLOSED_RANGING_TEXT[phase] ?? RANGING_TEXT[phase]) : RANGING_TEXT[phase];

  const summaryRows: SummaryRow[] = [
    { label: '구역', value: layer?.label ?? '—' },
    ...(closed
      ? [{ label: '경계선', value: `${closedLineCount}개` }]
      : [
          { label: '대상', value: baseName || '—', highlight: true },
          { label: '지류', value: includeTributary && tribCutCount > 0 ? `포함 ${tribCutCount}곳` : '미포함' },
        ]),
    ...(zoneAreaSqm != null ? [{ label: '면적', value: `약 ${formatSqm(zoneAreaSqm)}` }] : []),
  ];

  return (
    <div className="flex min-h-0 h-full flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">사유지분석</h3>
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
        <span className="text-[11px] text-muted-foreground">분석 구역·구간 지정</span>
      </header>

      <div className="shrink-0 border-b border-border">
        <div className="px-4 py-2">
          <span className="text-[12px] font-semibold text-muted-foreground">분석 영역</span>
        </div>
        <div className="px-3 pb-3">
          {confirmed ? (
            <SummaryTable rows={summaryRows} />
          ) : rangingText ? (
            <div className="rounded border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
              <p className="font-medium text-foreground/80">{layer?.label}</p>
              <p className="mt-0.5 flex items-center gap-1">
                {phase === 'loadingBase' || phase === 'applying' ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                ) : null}
                {rangingText}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">분석 영역을 먼저 지정하세요.</p>
          )}

          <div className="mt-2 flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={BTN_CHANGE}
              title={confirmed || rangingText ? '같은 구역에서 구간만 다시 지정' : '분석할 구역을 선택'}
              onClick={confirmed || rangingText ? changeArea : openAreaModal}
              disabled={phase === 'analyzing' || phase === 'applying'}
            >
              {confirmed || rangingText ? (
                <Pencil className="size-3 shrink-0" aria-hidden />
              ) : (
                <MapPin className="size-3 shrink-0" aria-hidden />
              )}
              {confirmed || rangingText ? '영역 변경' : '영역 지정'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={BTN_RESET}
              title="구역 선택부터 다시 시작"
              onClick={resetAll}
              disabled={phase === 'analyzing' || phase === 'applying'}
            >
              <RotateCcw className="size-3 shrink-0" aria-hidden />
              재설정
            </Button>
          </div>
        </div>
      </div>

      {phase === 'result' ? (
        <div className="shrink-0 space-y-1.5 border-b border-border px-2.5 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="주소·소유구분·지목"
              className="h-8 w-full rounded border border-border pl-7 pr-2.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div
            className="grid w-full gap-0.5"
            style={{ gridTemplateColumns: `repeat(${Math.min(ownFilters.length, OWN_FILTER_COLS)}, minmax(0, 1fr))` }}
            role="group"
            aria-label="소유구분 필터"
          >
            {ownFilters.map((f) => {
              const active = ownFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setOwnFilter(f.key)}
                  title={f.label}
                  aria-pressed={active}
                  className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF)}
                >
                  <span className="block truncate">{f.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>목록 {filteredParcels.length}건</span>
            {truncated ? <span className="text-[10px] text-chart-4">최대 1,000건까지 표시</span> : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {phase !== 'result' ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {phase === 'analyzing' ? '필지를 분석하는 중…' : '구간을 적용하면 필지 목록이 표시됩니다.'}
          </p>
        ) : filteredParcels.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {parcels.length === 0 ? '구간과 겹치는 필지가 없습니다.' : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col />
              <col className="w-[5.75rem]" />
            </colgroup>
            <tbody>
              {filteredParcels.map((p) => {
                const isSelected = selectedPnu === p.pnu;
                return (
                  <tr
                    key={p.pnu || p.address}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectParcel(isSelected ? null : p.pnu)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectParcel(isSelected ? null : p.pnu);
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border align-middle transition-colors',
                      isSelected
                        ? 'border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]'
                        : 'border-l-[3px] border-l-transparent hover:bg-muted/50'
                    )}
                  >
                    <td className="min-w-0 overflow-hidden px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="inline-flex w-[3.5rem] shrink-0 items-center justify-center truncate whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                          style={ownGbnBadgeStyle(p.ownGbn)}
                          title={p.ownGbn}
                        >
                          {ownGbnShort(p.ownGbn)}
                        </span>
                        {p.jimok ? (
                          <span
                            className="inline-flex w-[2.5rem] shrink-0 items-center justify-center truncate whitespace-nowrap rounded border px-0.5 py-0.5 text-[10px] font-semibold leading-none"
                            style={jimokBadgeStyle(p.jimok)}
                            title={p.jimok}
                          >
                            {p.jimok}
                          </span>
                        ) : null}
                        <p
                          className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground"
                          title={p.address || p.pnu}
                        >
                          {p.address || p.pnu}
                        </p>
                      </div>
                    </td>
                    <td
                      className="min-w-0 px-3 py-2.5 pl-1.5 text-right text-[11px] tabular-nums text-muted-foreground"
                      title="편입면적"
                    >
                      <span className="block truncate">{formatSqm(p.intersectAreaSqm)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PrivateLandAnalysisAreaModal />
      <PrivateLandAnalysisMapGuide />
    </div>
  );
}
