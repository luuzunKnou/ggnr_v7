import type { BoundaryEmdSelection } from './parcelAnalysisTypes';

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
