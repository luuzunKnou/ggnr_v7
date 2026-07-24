import type { SafetyWaterDummyRisk, SafetyWaterStation } from './safetyWaterTypes';

/** 관측소 없을 때 폴백 (영양 일대 대략 좌표) */
const FALLBACK_LON = 129.12;
const FALLBACK_LAT = 36.66;

/**
 * 수위 관측소 기준 더미 필지 4개.
 * damage 1 = 피해 많음(짙은 파랑), 낮을수록 연한 파랑.
 * 쿼리·DB 없음. 필지형 네모 폴리곤.
 */
const PARCEL_SPECS: {
  dLon: number;
  dLat: number;
  halfLon: number;
  halfLat: number;
  /** 0~1 피해 강도 */
  damage: number;
  riskLevel: string;
  note: string;
}[] = [
  {
    dLon: 0.00035,
    dLat: 0.00028,
    halfLon: 0.00022,
    halfLat: 0.00018,
    damage: 1,
    riskLevel: '경계',
    note: '관측소 인접 · 피해 많음',
  },
  {
    dLon: -0.0007,
    dLat: 0.00055,
    halfLon: 0.00025,
    halfLat: 0.0002,
    damage: 0.72,
    riskLevel: '주의',
    note: '인접 농경지 · 피해 중',
  },
  {
    dLon: 0.0011,
    dLat: -0.00075,
    halfLon: 0.00028,
    halfLat: 0.00022,
    damage: 0.42,
    riskLevel: '주의',
    note: '하수·역류 · 피해 보통',
  },
  {
    dLon: -0.0014,
    dLat: -0.00105,
    halfLon: 0.0003,
    halfLat: 0.00024,
    damage: 0.18,
    riskLevel: '관심',
    note: '외곽 · 피해 적음',
  },
];

/** 필지형 사각형 링 (닫힌 링) */
function parcelRectRing(
  cx: number,
  cy: number,
  halfLon: number,
  halfLat: number,
  jitter: number
): [number, number][] {
  const j = jitter * 0.00004;
  const ring: [number, number][] = [
    [cx - halfLon + j, cy - halfLat],
    [cx + halfLon, cy - halfLat + j],
    [cx + halfLon - j, cy + halfLat],
    [cx - halfLon, cy + halfLat - j],
  ];
  ring.push(ring[0]);
  return ring;
}

/**
 * 수위 관측소 좌표 기준 더미 피해 필지 3~4개.
 * proximity = 피해 강도(많을수록 1) → 짙은 파랑.
 */
export function buildDummyRiskAreas(stations: SafetyWaterStation[]): SafetyWaterDummyRisk[] {
  const water = stations.filter((s) => s.kind === 'water');
  const anchor =
    water.length > 0
      ? { lon: water[0].lon, lat: water[0].lat, name: water[0].name }
      : { lon: FALLBACK_LON, lat: FALLBACK_LAT, name: '폴백' };

  return PARCEL_SPECS.map((spec, i) => {
    const cx = anchor.lon + spec.dLon;
    const cy = anchor.lat + spec.dLat;
    return {
      id: `dummy-risk-${i + 1}`,
      name: `더미 필지 ${i + 1}`,
      riskLevel: spec.riskLevel,
      note: `${spec.note} · 기준 ${anchor.name}`,
      lon: cx,
      lat: cy,
      proximity: spec.damage,
      ring: parcelRectRing(cx, cy, spec.halfLon, spec.halfLat, i + 1),
    };
  });
}

/**
 * 피해 강도(proximity) 0~1 → 연한 하늘 ~ 짙은 파랑.
 * 단계가 눈에 띄도록 채도·불투명도를 키움.
 */
export function riskFillRgba(proximity: number): string {
  const t = Math.min(1, Math.max(0, proximity));
  // 연한: #BAE6FD (sky-200) → 짙은: #1E3A8A (blue-900)
  const r = Math.round(186 + (30 - 186) * t);
  const g = Math.round(230 + (58 - 230) * t);
  const b = Math.round(253 + (138 - 253) * t);
  const a = 0.32 + 0.55 * t;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function riskStrokeRgba(proximity: number): string {
  const t = Math.min(1, Math.max(0, proximity));
  const r = Math.round(125 + (30 - 125) * t);
  const g = Math.round(211 + (64 - 211) * t);
  const b = Math.round(252 + (175 - 252) * t);
  return `rgba(${r}, ${g}, ${b}, ${0.75 + 0.2 * t})`;
}
