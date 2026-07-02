'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  type BoundaryEmdSelection,
  type EmdRiOption,
} from './parcelAnalysisTypes';
import { countBoundarySelection } from './boundarySelectionUtils';
import { useParcelAnalysisRegion } from './useParcelAnalysisRegion';
import {
  PARCEL_PREVIEW_MANY_EMD_PARAM,
  PREVIEW_MANY_EMD_OPTIONS,
} from './parcelAnalysisBoundaryPreview';

type Props = {
  initialSelection?: BoundaryEmdSelection[];
  onSelectionChange?: (selection: BoundaryEmdSelection[]) => void;
};

type RiState = Record<string, { allRi: boolean; riCodes: Set<string> }>;

const EMD_SCROLL_THRESHOLD = 9;

export function ParcelAnalysisBoundaryPicker({
  initialSelection = [],
  onSelectionChange,
}: Props) {
  const searchParams = useSearchParams();
  const { sido, sigungu } = useParcelAnalysisRegion();
  const previewManyEmd = searchParams.get('parcelPreview') === PARCEL_PREVIEW_MANY_EMD_PARAM;

  const [emdOptions, setEmdOptions] = useState<EmdRiOption[]>([]);
  const [selectedEmdCodes, setSelectedEmdCodes] = useState<Set<string>>(() => new Set());
  const [riByEmd, setRiByEmd] = useState<Record<string, EmdRiOption[]>>({});
  const [riState, setRiState] = useState<RiState>({});

  useEffect(() => {
    let cancelled = false;
    call('', 'POST', { service: 'devTestService', action: 'getEmdRiOptions', params: {} })
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
    if (riByEmd[emdCode]) return riByEmd[emdCode];
    if (emdCode.startsWith('preview-')) {
      const mockRi: EmdRiOption[] = [
        { code: `${emdCode}-r1`, name: '리1' },
        { code: `${emdCode}-r2`, name: '리2' },
        { code: `${emdCode}-r3`, name: '리3' },
      ];
      setRiByEmd((prev) => ({ ...prev, [emdCode]: mockRi }));
      return mockRi;
    }
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode },
    });
    const data = res?.data ?? res;
    const ri = Array.isArray(data?.ri) ? (data.ri as EmdRiOption[]) : [];
    setRiByEmd((prev) => ({ ...prev, [emdCode]: ri }));
    return ri;
  }, [riByEmd]);

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
      <p className="flex items-center gap-1.5 text-sm text-slate-600">
        <span className="text-slate-500">{sido || '—'}</span>
        <span className="text-slate-300" aria-hidden>
          &gt;
        </span>
        <span className="font-medium text-slate-800">{sigungu || '—'}</span>
      </p>

      <div
        className={cn(
          'flex flex-wrap gap-2',
          emdScrollable && 'max-h-24 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]'
        )}
      >
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
                  ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              {emd.name}
            </button>
          );
        })}
        {optionSource.length === 0 && (
          <p className="text-sm text-slate-500">읍·면·동 목록을 불러오는 중…</p>
        )}
      </div>

      {previewManyEmd && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          UI 미리보기 (mock 18개). URL에서 <span className="font-mono">parcelPreview=manyEmd</span> 제거 시 실제 목록으로 복귀합니다.
        </p>
      )}

      {selectedEmdCodes.size > 0 && (
        <div className="max-h-48 space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
          {[...selectedEmdCodes].map((emdCode) => {
            const emd = optionSource.find((e) => e.code === emdCode);
            const riList = riByEmd[emdCode] ?? [];
            const st = riState[emdCode];
            if (!emd || !st) return null;
            const allRiChecked = st.allRi;
            const someRiChecked = st.riCodes.size > 0;
            const isIndeterminate =
              someRiChecked && riList.length > 0 && st.riCodes.size < riList.length && !st.allRi;
            return (
              <div key={emdCode} className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer rounded border-slate-300 text-blue-600"
                    checked={allRiChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={(e) => toggleAllRi(emdCode, e.target.checked)}
                  />
                  <span className="font-medium">{emd.name}</span>
                  <span className="text-slate-500">전체</span>
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
                  {riList.map((ri) => (
                    <label
                      key={ri.code}
                      className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 cursor-pointer rounded border-slate-300 text-blue-600"
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

      <div className="text-sm text-slate-700">
        <div className="flex items-center justify-between gap-2">
          <span>
            선택 항목 <span className="font-medium text-slate-900">({selectionCount}건)</span>
          </span>
          {canResetDraft && (
            <button
              type="button"
              onClick={resetDraft}
              className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              선택 초기화
            </button>
          )}
        </div>
        {selectionLabels.length > 0 ? (
          <span className="mt-1 block text-sm leading-relaxed text-slate-500">
            {selectionLabels.join(', ')}
          </span>
        ) : selectedEmdCodes.size > 0 ? (
          <span className="mt-1 block text-sm text-amber-700">리를 1개 이상 선택하세요.</span>
        ) : (
          <span className="mt-1 block text-sm text-slate-400">읍·면·동을 선택하세요.</span>
        )}
      </div>
    </div>
  );
}

export function getBoundarySelectionCount(selection: BoundaryEmdSelection[]): number {
  return countBoundarySelection(selection);
}
