/**
 * spf_fac GeoServer CSS — 시설 `type` 으로 심볼 구분.
 * DB 기준: 소교량·낙차공·취입보 = POINT, 세천·농로·마을진입로 = LINESTRING.
 * 면(폴리곤) 유형이 추가되면 POLYGON 규칙을 이어서 넣으면 된다.
 */

export const SPF_FAC_LAYER_NAME = 'spf_fac'

/** 점 시설 (도형 POINT) */
export const SPF_FAC_POINT_TYPES = ['소교량', '낙차공', '취입보'] as const

/** 선 시설 (도형 LINESTRING) */
export const SPF_FAC_LINE_TYPES = ['세천', '농로', '마을진입로'] as const

const POINT_STYLE: Record<(typeof SPF_FAC_POINT_TYPES)[number], { fill: string; stroke: string }> = {
  소교량: { fill: '#2563eb', stroke: '#ffffff' },
  낙차공: { fill: '#7c3aed', stroke: '#ffffff' },
  취입보: { fill: '#0891b2', stroke: '#ffffff' },
}

const LINE_STYLE: Record<(typeof SPF_FAC_LINE_TYPES)[number], { stroke: string; width: number }> = {
  세천: { stroke: '#0ea5e9', width: 2.5 },
  농로: { stroke: '#ca8a04', width: 2 },
  마을진입로: { stroke: '#16a34a', width: 2.5 },
}

function esc(type: string): string {
  return type.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** GeoCSS 본문 — type 속성 규칙 + 미분류 폴백(점·선) */
export function buildSpfFacCss(): string {
  const blocks: string[] = [
    '/* spf_fac — 시설 type별 점/선 스타일 (geom 혼재) */',
    '',
  ]

  for (const t of SPF_FAC_POINT_TYPES) {
    const c = POINT_STYLE[t]
    blocks.push(`[type='${esc(t)}'] {
  mark: symbol(circle);
  mark-size: 9;
  fill: ${c.fill};
  fill-opacity: 0.92;
  stroke: ${c.stroke};
  stroke-width: 1.2;
  z-index: 2;
}
`)
  }

  for (const t of SPF_FAC_LINE_TYPES) {
    const c = LINE_STYLE[t]
    blocks.push(`[type='${esc(t)}'] {
  stroke: ${c.stroke};
  stroke-width: ${c.width};
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-opacity: 0.9;
  z-index: 1;
}
`)
  }

  /* type 비어 있거나 새 유형 — 점·선 둘 다 그려 보이게 */
  blocks.push(`/* 미분류 */
* {
  mark: symbol(square);
  mark-size: 7;
  fill: #64748b;
  stroke: #334155;
  stroke-width: 1.5;
  stroke-opacity: 0.85;
  z-index: 0;
}
`)

  return blocks.join('\n')
}
