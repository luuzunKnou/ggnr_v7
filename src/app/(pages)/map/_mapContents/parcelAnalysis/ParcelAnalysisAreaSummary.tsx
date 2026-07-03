'use client';

import { cn } from '@/lib/utils';
import type { ParcelAnalysisArea } from './parcelAnalysisTypes';

type Props = {
  area: ParcelAnalysisArea | null;
  /** 영역 확정 후 초기화 등으로 area만 비운 상태 */
  areaCleared?: boolean;
  onChangeClick: () => void;
  onClearClick: () => void;
  onSpecifyClick: () => void;
};

type SummaryRow = { label: string; value: string; highlight?: boolean };

function buildRows(area: ParcelAnalysisArea): SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: '방식', value: area.method === 'boundary' ? '행정경계' : '도형 그리기' },
    { label: '대상', value: area.targetLabel, highlight: true },
  ];
  if (area.areaSqm > 0) {
    rows.push({ label: '면적', value: `약 ${area.areaSqm.toLocaleString('ko-KR')} ㎡` });
  }
  return rows;
}

export function ParcelAnalysisAreaSummary({
  area,
  areaCleared = false,
  onChangeClick,
  onClearClick,
  onSpecifyClick,
}: Props) {
  const rows = area ? buildRows(area) : [];

  return (
    <div className="border-b border-slate-200">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="text-[12px] font-semibold text-[#666]">분석 영역</span>
        {area ? (
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onChangeClick}
              className="cursor-pointer text-[11px] font-medium text-primary hover:underline"
            >
              변경
            </button>
            <button
              type="button"
              onClick={onClearClick}
              className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              재설정
            </button>
          </div>
        ) : areaCleared ? (
          <button
            type="button"
            onClick={onSpecifyClick}
            className="cursor-pointer text-[11px] font-medium text-primary hover:underline"
          >
            영역 지정
          </button>
        ) : null}
      </div>

      <div className="px-3 pb-2">
        {area ? (
          <div className="overflow-hidden rounded border border-slate-200">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={cn('flex items-stretch', index !== rows.length - 1 && 'border-b border-slate-200')}
              >
                <div className="flex w-[64px] shrink-0 items-start bg-slate-100 px-2.5 py-1.5">
                  <span className="text-[11px] leading-snug text-[#666]">{row.label}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-start px-2.5 py-1.5">
                  <span
                    className={cn(
                      'break-words text-[11px] leading-snug',
                      row.highlight ? 'font-medium text-primary' : 'text-[#666]'
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : areaCleared ? (
          <p className="text-[11px] text-slate-500">분석 영역이 초기화되었습니다. 다시 지정해 주세요.</p>
        ) : (
          <p className="text-[11px] text-amber-700">분석 영역을 먼저 지정하세요.</p>
        )}
      </div>
    </div>
  );
}
