'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  type BoundaryEmdSelection,
  type EmdRiOption,
  type ParcelAnalysisRegion,
} from './parcelAnalysis.types';
import { PARCEL_ANALYSIS_SIGUNGU_BOUNDARY_STYLE } from './parcelAnalysis.mapStyle';
import { useMapContext } from '../../_mapComponents/MapContext';

const EMPTY_REGION: ParcelAnalysisRegion = { sido: '', sigungu: '' };
const REGION_TIMEOUT_MS = 12_000;

/** 푸터 설정 기준 시·군구 — 행정경계 선택 기본값 */
function useParcelAnalysisRegion(): ParcelAnalysisRegion {
  const [region, setRegion] = useState<ParcelAnalysisRegion>(EMPTY_REGION);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REGION_TIMEOUT_MS);

    call(
      '',
      'POST',
      {
        service: 'configService',
        action: 'getParcelAnalysisRegionFromFooter',
        params: {},
      },
      { signal: controller.signal }
    )
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRegion({
          sido: String(data?.sido ?? '').trim(),
          sigungu: String(data?.sigungu ?? '').trim(),
        });
      })
      .catch(() => {
        if (!cancelled) setRegion(EMPTY_REGION);
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return region;
}

/** 모달·패널 공통 건수 (리 전체 = 1건, 리 일부 = 리 수) */
export function countBoundarySelection(selection: BoundaryEmdSelection[]): number {
  return selection.reduce((n, s) => {
    if (s.allRi) return n + 1;
    return n + Math.max(s.riCodes.length, 0);
  }, 0);
}

/** 패널·모달 하단 표시용 라벨 목록 */
export function expandBoundaryDisplayLabels(selection: BoundaryEmdSelection[]): string[] {
  const labels: string[] = [];
  for (const s of selection) {
    if (s.allRi) {
      labels.push(s.emdName);
      continue;
    }
    if (s.riNames && s.riNames.length > 0) {
      for (const riName of s.riNames) {
        labels.push(`${s.emdName} ${riName}`);
      }
    } else if (s.riCodes.length > 0) {
      labels.push(`${s.emdName} (${s.riCodes.length}개 리)`);
    }
  }
  return labels;
}

export function formatBoundaryAreaSummary(
  selection: BoundaryEmdSelection[],
  areaSqm: number
): { itemCount: number; summaryLabel: string; summaryDetail?: string; targetLabel: string } {
  const itemCount = countBoundarySelection(selection);
  const labels = expandBoundaryDisplayLabels(selection);
  const areaText = `약 ${areaSqm.toLocaleString('ko-KR')} ㎡`;
  const targetLabel = labels.length > 0 ? labels.join(', ') : '행정경계';

  if (itemCount <= 0) {
    return { itemCount: 0, summaryLabel: `행정경계 · ${areaText}`, targetLabel };
  }

  if (itemCount === 1 && labels.length === 1) {
    return {
      itemCount,
      summaryLabel: `행정경계 · ${labels[0]} · ${areaText}`,
      targetLabel,
    };
  }

  return {
    itemCount,
    summaryLabel: `행정경계 ${itemCount}개 · ${areaText}`,
    summaryDetail: labels.join(', '),
    targetLabel,
  };
}

/** UI 확인용 — `/map?opened=parcelAnalysis&parcelPreview=manyEmd` */
export const PREVIEW_MANY_EMD_OPTIONS: EmdRiOption[] = [
  { code: 'preview-01', name: '가락동' },
  { code: 'preview-02', name: '거여동' },
  { code: 'preview-03', name: '마천동' },
  { code: 'preview-04', name: '문정동' },
  { code: 'preview-05', name: '방이동' },
  { code: 'preview-06', name: '삼전동' },
  { code: 'preview-07', name: '석촌동' },
  { code: 'preview-08', name: '송파동' },
  { code: 'preview-09', name: '신천동' },
  { code: 'preview-10', name: '오금동' },
  { code: 'preview-11', name: '오륜동' },
  { code: 'preview-12', name: '잠실동' },
  { code: 'preview-13', name: '장지동' },
  { code: 'preview-14', name: '풍납동' },
  { code: 'preview-15', name: '하남동' },
  { code: 'preview-16', name: '학동' },
  { code: 'preview-17', name: '헬리오시티' },
  { code: 'preview-18', name: '화양동' },
];

export const PARCEL_PREVIEW_MANY_EMD_PARAM = 'manyEmd';

export type EmdRiOptionsResult = { emd: EmdRiOption[]; error?: string };

const FETCH_TIMEOUT_MS = 20_000;

let cached: EmdRiOptionsResult | null = null;
let inflight: Promise<EmdRiOptionsResult> | null = null;

function parseEmdResponse(res: unknown): EmdRiOptionsResult {
  const data = (res as { data?: unknown })?.data ?? res;
  const raw = data as { emd?: EmdRiOption[]; error?: string };
  const emd = Array.isArray(raw?.emd) ? raw.emd : [];
  if (!emd.length) {
    const msg = raw?.error ? String(raw.error) : '읍·면·동 목록이 비어 있습니다.';
    return { emd: [], error: msg };
  }
  return { emd };
}

async function fetchEmdRiOptions(): Promise<EmdRiOptionsResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await call(
      '',
      'POST',
      { service: 'devTestService', action: 'getEmdRiOptions', params: {} },
      { signal: controller.signal }
    );
    return parseEmdResponse(res);
  } catch (error: unknown) {
    const aborted =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');
    return {
      emd: [],
      error: aborted
        ? '목록 조회가 지연되고 있습니다. «다시 불러오기»를 눌러 주세요.'
        : '읍·면·동 목록을 불러오지 못했습니다.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

/** 세션 내 읍·면·동 목록 — 동시 요청은 하나로 합침 */
export function fetchEmdRiOptionsCached(force = false): Promise<EmdRiOptionsResult> {
  if (force) {
    cached = null;
    inflight = null;
  }
  if (!force && cached) return Promise.resolve(cached);
  if (!force && inflight) return inflight;

  inflight = fetchEmdRiOptions()
    .then((result) => {
      cached = result;
      return result;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearEmdRiOptionsCache(): void {
  cached = null;
  inflight = null;
}

export function getCachedEmdRiOptions(): EmdRiOptionsResult | null {
  return cached;
}

const RI_FETCH_TIMEOUT_MS = 15_000;

const riCache = new Map<string, EmdRiOption[]>();
const riInflight = new Map<string, Promise<EmdRiOption[]>>();

export function getCachedRiOptions(emdCode: string): EmdRiOption[] | null {
  const hit = riCache.get(emdCode);
  return hit && hit.length > 0 ? hit : null;
}

export function fetchRiOptionsCached(emdCode: string, force = false): Promise<EmdRiOption[]> {
  const code = emdCode.trim();
  if (!code) return Promise.resolve([]);

  if (!force) {
    const hit = riCache.get(code);
    if (hit) return Promise.resolve(hit);
    const pending = riInflight.get(code);
    if (pending) return pending;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), RI_FETCH_TIMEOUT_MS);
    try {
      const res = await call(
        '',
        'POST',
        {
          service: 'devTestService',
          action: 'getRiOptionsByEmd',
          params: { emdCode: code },
        },
        { signal: controller.signal }
      );
      const data = res?.data ?? res;
      const ri = Array.isArray(data?.ri) ? (data.ri as EmdRiOption[]) : [];
      riCache.set(code, ri);
      return ri;
    } catch {
      riCache.set(code, []);
      return [] as EmdRiOption[];
    } finally {
      window.clearTimeout(timer);
      riInflight.delete(code);
    }
  })();

  riInflight.set(code, promise);
  return promise;
}

export function useParcelAnalysisBoundaryCatalog(isOpen: boolean) {
  const [emdOptions, setEmdOptions] = useState<EmdRiOption[]>(() => getCachedEmdRiOptions()?.emd ?? []);
  const [emdLoading, setEmdLoading] = useState(false);
  const [emdError, setEmdError] = useState<string | null>(() => getCachedEmdRiOptions()?.error ?? null);

  const applyResult = useCallback((result: { emd: EmdRiOption[]; error?: string }) => {
    setEmdOptions(result.emd);
    setEmdError(result.error ?? null);
  }, []);

  const syncEmdFromCache = useCallback(() => {
    const hit = getCachedEmdRiOptions();
    if (!hit?.emd?.length) return false;
    applyResult(hit);
    setEmdLoading(false);
    return true;
  }, [applyResult]);

  const reloadEmdOptions = useCallback(() => {
    clearEmdRiOptionsCache();
    setEmdLoading(true);
    setEmdError(null);
    return fetchEmdRiOptionsCached(true)
      .then(applyResult)
      .finally(() => setEmdLoading(false));
  }, [applyResult]);

  useEffect(() => {
    if (!isOpen) {
      setEmdLoading(false);
      return;
    }

    if (syncEmdFromCache()) return;

    let cancelled = false;
    setEmdLoading(true);
    setEmdError(null);

    void fetchEmdRiOptionsCached()
      .then((result) => {
        if (!cancelled) applyResult(result);
      })
      .finally(() => {
        if (!cancelled) setEmdLoading(false);
      });

    return () => {
      cancelled = true;
      setEmdLoading(false);
    };
  }, [isOpen, applyResult, syncEmdFromCache]);

  return { emdOptions, emdLoading, emdError, reloadEmdOptions, syncEmdFromCache };
}

/** 지적 편집(900)보다 아래, 배경 위 — 경계는 참고 표시용 */
const BOUNDARY_LAYER_Z = 850;

/**
 * 필지분석 진입 시 사업 시군구(읍면동 union) 경계를 지도에 표시.
 * 좌측 패널 없이 영역을 지정하는 단계에서 대상 지역을 눈으로 확인하기 위한 참고 레이어.
 * 필지분석 종료 시 레이어를 제거한다.
 */
export function useParcelAnalysisSigunguBoundary(active: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !active) return;

    let cancelled = false;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: PARCEL_ANALYSIS_SIGUNGU_BOUNDARY_STYLE, zIndex: BOUNDARY_LAYER_Z });
    layer.set('parcelAnalysisBoundary', true);
    map.addLayer(layer);
    layerRef.current = layer;

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getProjectEmdBoundary5181',
          params: {},
        });
        const data = res?.data ?? res;
        const wkt = data?.wkt ? String(data.wkt) : null;
        if (!wkt || cancelled) return;
        const geom = new WKT().readGeometry(wkt, {
          dataProjection: 'EPSG:5181',
          featureProjection: 'EPSG:3857',
        });
        source.clear();
        source.addFeature(new Feature(geom));
      } catch {
        /* 경계 표시는 참고용 — 실패해도 필지분석 진행 */
      }
    })();

    return () => {
      cancelled = true;
      map.removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [active, mapContext?.mapInstanceRef]);
}

type Props = {
  initialSelection?: BoundaryEmdSelection[];
  onSelectionChange?: (selection: BoundaryEmdSelection[]) => void;
  emdOptions: EmdRiOption[];
  emdLoading: boolean;
  emdError: string | null;
  onReloadEmd: () => void;
};

type RiState = Record<string, { allRi: boolean; riCodes: Set<string> }>;

const EMD_SCROLL_THRESHOLD = 9;

export function ParcelAnalysisBoundaryPicker({
  initialSelection = [],
  onSelectionChange,
  emdOptions,
  emdLoading,
  emdError,
  onReloadEmd,
}: Props) {
  const searchParams = useSearchParams();
  const { sido, sigungu } = useParcelAnalysisRegion();
  const previewManyEmd = searchParams.get('parcelPreview') === PARCEL_PREVIEW_MANY_EMD_PARAM;

  const [selectedEmdCodes, setSelectedEmdCodes] = useState<Set<string>>(() => new Set());
  const [riByEmd, setRiByEmd] = useState<Record<string, EmdRiOption[]>>({});
  const [riState, setRiState] = useState<RiState>({});
  const [riLoadingCodes, setRiLoadingCodes] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const selection = initialSelection;

    const hydrate = async () => {
      if (selection.length === 0) {
        setSelectedEmdCodes(new Set());
        setRiState({});
        return;
      }

      const codes = new Set(selection.map((s) => s.emdCode));
      const nextRi: RiState = {};
      for (const s of selection) {
        nextRi[s.emdCode] = { allRi: s.allRi, riCodes: new Set(s.riCodes) };
      }
      setSelectedEmdCodes(codes);
      setRiState(nextRi);

      for (const s of selection) {
        if (cancelled) return;
        await loadRiForEmd(s.emdCode);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
    // 마운트 시에만 복원 (모달 뒤로→재진입·패널 [변경] 시 리마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRiForEmd = useCallback(async (emdCode: string) => {
    if (emdCode.startsWith('preview-')) {
      const mockRi: EmdRiOption[] = [
        { code: `${emdCode}-r1`, name: '리1' },
        { code: `${emdCode}-r2`, name: '리2' },
        { code: `${emdCode}-r3`, name: '리3' },
      ];
      setRiByEmd((prev) => ({ ...prev, [emdCode]: mockRi }));
      return mockRi;
    }

    let cached: EmdRiOption[] | undefined;
    setRiByEmd((prev) => {
      if (prev[emdCode]?.length) cached = prev[emdCode];
      return prev;
    });
    if (cached) return cached;

    setRiLoadingCodes((prev) => new Set(prev).add(emdCode));
    try {
      const ri = await fetchRiOptionsCached(emdCode);
      setRiByEmd((prev) => ({ ...prev, [emdCode]: ri }));
      return ri;
    } finally {
      setRiLoadingCodes((prev) => {
        const next = new Set(prev);
        next.delete(emdCode);
        return next;
      });
    }
  }, []);

  const optionSource = previewManyEmd ? PREVIEW_MANY_EMD_OPTIONS : emdOptions;

  const emitSelection = useCallback(
    (emdCodes: Set<string>, state: RiState) => {
      const selection: BoundaryEmdSelection[] = [];
      for (const code of emdCodes) {
        const emd = optionSource.find((e) => e.code === code);
        const st = state[code];
        if (!emd || !st || st.riCodes.size === 0) continue;
        const riList = riByEmd[code] ?? [];
        const riCodes = Array.from(st.riCodes);
        const allRi = st.allRi || (riList.length > 0 && riCodes.length === riList.length);
        selection.push({
          emdCode: code,
          emdName: emd.name,
          allRi,
          riCodes,
          riNames: allRi
            ? undefined
            : riCodes.map((c) => riList.find((r) => r.code === c)?.name ?? c),
        });
      }
      onSelectionChange?.(selection);
    },
    [optionSource, onSelectionChange, riByEmd]
  );

  const toggleEmd = useCallback(
    async (code: string) => {
      const next = new Set(selectedEmdCodes);
      let nextRi = { ...riState };
      if (next.has(code)) {
        next.delete(code);
        delete nextRi[code];
      } else {
        next.add(code);
        const riList = await loadRiForEmd(code);
        nextRi[code] = { allRi: true, riCodes: new Set(riList.map((r) => r.code)) };
      }
      setSelectedEmdCodes(next);
      setRiState(nextRi);
      emitSelection(next, nextRi);
    },
    [selectedEmdCodes, riState, loadRiForEmd, emitSelection]
  );

  const toggleAllRi = useCallback(
    (emdCode: string, checked: boolean) => {
      const riList = riByEmd[emdCode] ?? [];
      const nextRi: RiState = {
        ...riState,
        [emdCode]: {
          allRi: checked,
          riCodes: checked ? new Set(riList.map((r) => r.code)) : new Set<string>(),
        },
      };
      setRiState(nextRi);
      emitSelection(selectedEmdCodes, nextRi);
    },
    [riByEmd, riState, selectedEmdCodes, emitSelection]
  );

  const toggleRi = useCallback(
    (emdCode: string, riCode: string, checked: boolean) => {
      const riList = riByEmd[emdCode] ?? [];
      const prev = riState[emdCode] ?? { allRi: false, riCodes: new Set<string>() };
      const nextCodes = new Set(prev.riCodes);
      if (checked) nextCodes.add(riCode);
      else nextCodes.delete(riCode);
      const allRi = riList.length > 0 && riList.every((r) => nextCodes.has(r.code));
      const nextRi: RiState = { ...riState, [emdCode]: { allRi, riCodes: nextCodes } };
      setRiState(nextRi);
      emitSelection(selectedEmdCodes, nextRi);
    },
    [riByEmd, riState, selectedEmdCodes, emitSelection]
  );

  const selectionLabels = useMemo(() => {
    const labels: string[] = [];
    for (const code of selectedEmdCodes) {
      const emd = optionSource.find((e) => e.code === code);
      const st = riState[code];
      const riList = riByEmd[code] ?? [];
      if (!emd || !st) continue;
      if (st.allRi || st.riCodes.size === riList.length) {
        labels.push(emd.name);
      } else {
        for (const riCode of st.riCodes) {
          const ri = riList.find((r) => r.code === riCode);
          labels.push(`${emd.name} ${ri?.name ?? riCode}`);
        }
      }
    }
    return labels;
  }, [selectedEmdCodes, optionSource, riState, riByEmd]);

  const selectionCount = selectionLabels.length;
  const emdScrollable = optionSource.length >= EMD_SCROLL_THRESHOLD;
  const canResetDraft = selectedEmdCodes.size > 0 || selectionCount > 0;

  const resetDraft = useCallback(() => {
    setSelectedEmdCodes(new Set());
    setRiState({});
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-muted-foreground">{sido || '—'}</span>
        <span className="text-muted-foreground/40" aria-hidden>
          &gt;
        </span>
        <span className="font-medium text-foreground">{sigungu || '—'}</span>
      </p>

      <div
        className={cn(
          'flex flex-wrap gap-2',
          emdScrollable && 'max-h-24 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]'
        )}
      >
        {emdLoading && optionSource.length === 0 && (
          <p className="text-sm text-muted-foreground">읍·면·동 목록을 불러오는 중…</p>
        )}
        {!emdLoading && emdError && optionSource.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{emdError}</p>
            <button
              type="button"
              onClick={onReloadEmd}
              className="cursor-pointer text-xs font-medium text-primary hover:underline"
            >
              다시 불러오기
            </button>
          </div>
        )}
        {!emdLoading && !emdError && optionSource.length === 0 && (
          <p className="text-sm text-muted-foreground">표시할 읍·면·동이 없습니다.</p>
        )}
        {emdLoading && optionSource.length > 0 && (
          <p className="w-full text-xs text-muted-foreground">목록 갱신 중…</p>
        )}
        {optionSource.map((emd) => {
          const selected = selectedEmdCodes.has(emd.code);
          return (
            <button
              key={emd.code}
              type="button"
              onClick={() => void toggleEmd(emd.code)}
              className={cn(
                'cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border-border bg-background text-foreground hover:border-border hover:bg-muted/60'
              )}
            >
              {emd.name}
            </button>
          );
        })}
      </div>

      {previewManyEmd && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          UI 미리보기 (mock 18개). URL에서 <span className="font-mono">parcelPreview=manyEmd</span> 제거 시 실제 목록으로 복귀합니다.
        </p>
      )}

      {selectedEmdCodes.size > 0 && (
        <div className="max-h-48 space-y-4 overflow-y-auto rounded-lg border border-border bg-background p-3">
          {[...selectedEmdCodes].map((emdCode) => {
            const emd = optionSource.find((e) => e.code === emdCode);
            const riList = riByEmd[emdCode] ?? [];
            const st = riState[emdCode];
            const riLoading = riLoadingCodes.has(emdCode);
            if (!emd || !st) return null;
            const allRiChecked = st.allRi;
            const someRiChecked = st.riCodes.size > 0;
            const isIndeterminate =
              someRiChecked && riList.length > 0 && st.riCodes.size < riList.length && !st.allRi;
            return (
              <div key={emdCode} className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer rounded border-border text-primary"
                    checked={allRiChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={(e) => toggleAllRi(emdCode, e.target.checked)}
                  />
                  <span className="font-medium">{emd.name}</span>
                  <span className="text-muted-foreground">전체</span>
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
                  {riLoading && (
                    <p className="text-xs text-muted-foreground">리 목록을 불러오는 중…</p>
                  )}
                  {!riLoading && riList.length === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">리 목록이 없습니다.</p>
                  )}
                  {!riLoading &&
                    riList.map((ri) => (
                    <label
                      key={ri.code}
                      className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 cursor-pointer rounded border-border text-primary"
                        checked={st.riCodes.has(ri.code)}
                        onChange={(e) => toggleRi(emdCode, ri.code, e.target.checked)}
                      />
                      {ri.name}
                    </label>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-sm text-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>
            선택 항목 <span className="font-medium text-foreground">({selectionCount}건)</span>
          </span>
          {canResetDraft && (
            <button
              type="button"
              onClick={resetDraft}
              className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              선택 초기화
            </button>
          )}
        </div>
        {selectionLabels.length > 0 ? (
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {selectionLabels.join(', ')}
          </span>
        ) : selectedEmdCodes.size > 0 ? (
          <span className="mt-1 block text-sm text-amber-700 dark:text-amber-300">리를 1개 이상 선택하세요.</span>
        ) : (
          <span className="mt-1 block text-sm text-muted-foreground">읍·면·동을 선택하세요.</span>
        )}
      </div>
    </div>
  );
}

export function getBoundarySelectionCount(selection: BoundaryEmdSelection[]): number {
  return countBoundarySelection(selection);
}
