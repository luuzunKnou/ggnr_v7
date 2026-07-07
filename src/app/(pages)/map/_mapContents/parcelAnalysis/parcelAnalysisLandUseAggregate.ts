import type { MockLandUseStat } from './mockParcelAnalysisResult';

type ZoneBucket = { count: number; areaSqm: number };

function formatSqm(areaSqm: number): string {
  return `${Math.round(areaSqm).toLocaleString('ko-KR')}㎡`;
}

function ratioText(areaSqm: number, totalSqm: number): string {
  if (!(totalSqm > 0)) return '-';
  return `${((areaSqm / totalSqm) * 100).toFixed(1)}%`;
}

/** 청크별 용도지역 집계를 기존 누적에 합산 */
export function mergeLandUseZoneChunk(
  prev: Map<string, ZoneBucket>,
  parcels: Array<{ pnu: string; areaSqm: number }>,
  zonesByPnu: Record<string, string[]>
): Map<string, ZoneBucket> {
  const next = new Map(prev);
  for (const parcel of parcels) {
    const zones = zonesByPnu[parcel.pnu] ?? [];
    const label = zones.find((z) => z.trim())?.trim() || '미상';
    const cur = next.get(label) ?? { count: 0, areaSqm: 0 };
    next.set(label, {
      count: cur.count + 1,
      areaSqm: cur.areaSqm + Math.max(0, Math.round(parcel.areaSqm)),
    });
  }
  return next;
}

export function landUseBucketToStats(
  buckets: Map<string, ZoneBucket>,
  totalAreaSqm: number
): MockLandUseStat[] {
  return [...buckets.entries()]
    .map(([zone, { count, areaSqm }]) => ({
      zone,
      count,
      area: formatSqm(areaSqm),
      ratio: ratioText(areaSqm, totalAreaSqm),
    }))
    .sort((a, b) => {
      const areaA = Number(a.area.replace(/[^\d]/g, '')) || 0;
      const areaB = Number(b.area.replace(/[^\d]/g, '')) || 0;
      return areaB - areaA;
    });
}
