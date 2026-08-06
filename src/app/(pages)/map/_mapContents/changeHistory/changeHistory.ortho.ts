/**
 * 변동이력 결과 지도 — 디스크 등록 자체 정사(연도) 선택.
 * 업로드 타임라인·고정 aerial/high-res 목록은 쓰지 않음(로드 실패·라벨 불일치 방지).
 * satellite_YYYY* 만 후보.
 */
import {
  buildCustomAerialBackgroundOptions,
  type OrthophotoTileOutputsPayload,
} from '@/app/(pages)/map/_mapComponents/mapControlPanel/backgroundMapSelector';

export function extractOrthoPhotographyYear(id: string): number | null {
  const s = String(id).trim();
  const dyn = /^satellite_(\d{4})(?:_|$)/i.exec(s);
  if (dyn) return parseInt(dyn[1], 10);
  const aerial = /^aerial-(\d{4})$/i.exec(s);
  if (aerial) return parseInt(aerial[1], 10);
  const hires = /^high-res-(\d{4})$/i.exec(s);
  if (hires) return parseInt(hires[1], 10);
  return null;
}

/** 같은 연도 후보 중 대표 id (satellite_YYYY 우선) */
export function pickRepresentativeOrthoIdForYear(year: number, ids: string[]): string {
  const set = new Set(ids);
  const sat = `satellite_${year}`;
  if (set.has(sat)) return sat;
  const sorted = [...ids].sort((a, b) => {
    const aPlain = a.toLowerCase() === sat.toLowerCase() ? 0 : a.toLowerCase().startsWith(`${sat}_`) ? 1 : 2;
    const bPlain = b.toLowerCase() === sat.toLowerCase() ? 0 : b.toLowerCase().startsWith(`${sat}_`) ? 1 : 2;
    if (aPlain !== bPlain) return aPlain - bPlain;
    return a.localeCompare(b);
  });
  return sorted[0] ?? ids[0];
}

/** 디스크 tiles_jpg 그룹만 (실제로 바로 깔 수 있는 satellite_*) */
function collectOrthoCandidateIds(payload: OrthophotoTileOutputsPayload | null | undefined): string[] {
  return buildCustomAerialBackgroundOptions(payload ?? {}).map((o) => o.id);
}

/**
 * 선택일(YYYY-MM-DD) 연도 이하에서 가장 가까운 등록 정사 id.
 * 예: 2026-08-03 + 디스크 2012/2017/2022 → satellite_2022*
 */
export function pickNearestOrthoBackgroundId(
  selectedDate: string,
  payload: OrthophotoTileOutputsPayload | null | undefined
): string | null {
  const y = Number(String(selectedDate ?? '').slice(0, 4));
  if (!Number.isFinite(y) || y < 1900) return null;

  const byYear = new Map<number, string[]>();
  for (const id of collectOrthoCandidateIds(payload)) {
    const year = extractOrthoPhotographyYear(id);
    if (year == null || year > y) continue;
    const list = byYear.get(year) ?? [];
    list.push(id);
    byYear.set(year, list);
  }
  if (byYear.size === 0) return null;

  const bestYear = Math.max(...byYear.keys());
  const ids = byYear.get(bestYear) ?? [];
  if (ids.length === 0) return null;
  return pickRepresentativeOrthoIdForYear(bestYear, ids);
}

/** 하단·지도 뱃지 — 자체 정사 vs VWorld 항공 구분 */
export function formatChangeHistoryBackgroundLabel(
  isOwnOrtho: boolean,
  year: string | null | undefined
): string {
  if (isOwnOrtho) {
    const y = year != null && String(year).trim() !== '' ? String(year).trim() : null;
    return y ? `배경 정사 - 자체항공영상(${y})` : '배경 정사 - 자체항공영상';
  }
  return '배경 정사 - 항공영상';
}
