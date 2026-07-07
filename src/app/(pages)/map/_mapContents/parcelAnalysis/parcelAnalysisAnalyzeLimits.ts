import type { ParcelAnalysisArea } from './parcelAnalysisTypes';

/** PostgreSQL statement_timeout — analyzeParcels DB 집계 (서버 한도, 클라이언트는 기다림) */
export const PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT = '600s';

/** 면적 기준 대형 영역(㎡) — 약 100만㎡(1㎢) 이상이면 사전 경고 */
export const PARCEL_ANALYZE_LARGE_AREA_SQM = 1_000_000;

/** 행정경계 다중 선택 기준 — 읍·리 단위 합이 이 값 이상이면 사전 경고 */
export const PARCEL_ANALYZE_LARGE_BOUNDARY_ITEMS = 5;

/** 초기 분석 스피너 최소 표시 시간(ms) — 결과 모달 전환 전 */
export const PARCEL_ANALYZE_MIN_SPINNER_MS = 3000;

export function delayForMinElapsed(startedAtMs: number, minMs: number): Promise<void> {
  const remain = Math.max(0, minMs - (Date.now() - startedAtMs));
  if (remain <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, remain);
  });
}

export function isLargeParcelAnalysisArea(area: ParcelAnalysisArea): boolean {
  if (area.areaSqm >= PARCEL_ANALYZE_LARGE_AREA_SQM) return true;
  if (area.method === 'boundary' && area.itemCount >= PARCEL_ANALYZE_LARGE_BOUNDARY_ITEMS) {
    return true;
  }
  return false;
}

export function buildLargeAreaConfirmMessage(area: ParcelAnalysisArea): string {
  const areaLine =
    area.areaSqm > 0
      ? `분석 영역 면적: 약 ${area.areaSqm.toLocaleString('ko-KR')} ㎡`
      : '분석 영역이 넓습니다';
  const boundaryLine =
    area.method === 'boundary' && area.itemCount > 1
      ? `\n행정경계 선택: ${area.itemCount}개 단위`
      : '';
  return [
    areaLine + boundaryLine,
    '',
    '필지가 많으면 수 분 이상 걸릴 수 있습니다. 토지현황·토지이용계획은 100건씩 순차 표시됩니다.',
    '분석 중 «취소»로 중단할 수 있습니다.',
    '',
    '분석을 진행하시겠습니까?',
  ].join('\n');
}
