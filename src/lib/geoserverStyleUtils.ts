/**
 * GeoServer CSS simple style parse/build for POINT, LINE, POLYGON.
 */

import { normalizeGeoServerSymbolUrl } from '@/lib/geoserverSymbolPath';

export type GeometryType = 'POINT' | 'LINE' | 'POLYGON';

/** Material Tone palette (hex) for random default styles */
export const MATERIAL_TONE_COLORS = [
  '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4',
  '#00BCD4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107',
  '#FF9800', '#FF5722',
];

/** Get Material Tone color by index (deterministic "random") */
export function getMaterialToneColor(index: number): string {
  return MATERIAL_TONE_COLORS[Math.abs(index) % MATERIAL_TONE_COLORS.length];
}

/** Darker shade for polygon stroke (same hue, darker) - simple darken */
export function darkerHex(hex: string, factor: number = 0.7): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = Math.max(0, Math.floor(parseInt(m[1], 16) * factor));
  const g = Math.max(0, Math.floor(parseInt(m[2], 16) * factor));
  const b = Math.max(0, Math.floor(parseInt(m[3], 16) * factor));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export type StyleProps = {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** 면 투명도. CSS fill-opacity */
  opacity?: number;
  /** 선 투명도. CSS stroke-opacity. 선은 색 있는 선(뒤 값) */
  strokeOpacity?: number;
  labelField?: string;
  size?: number; // 라벨 글자크기 (font-size)
  /** 점·심볼 표시 크기. CSS mark-size 상한(줌인 시 최대 픽셀) */
  markSize?: number;
  /** POINT + 외부 심볼: 아이콘 URL (있으면 심볼 있는 버전 CSS 생성) */
  symbolUrl?: string;
};

const DEFAULT_PROPS: StyleProps = {
  fillColor: '#808080',
  strokeColor: '#000000',
  strokeWidth: 1,
  opacity: 0.3,
  strokeOpacity: 1,
  labelField: '',
  size: 14,
  markSize: 18,
};

const MARK_SIZE_SCALE_SYMBOL = 4.0;
const MARK_SIZE_SCALE_POINT = 1.5;

function markSizeCssLine(markSize: number, scaleFactor: number): string {
  const n = Number.isFinite(markSize) && markSize > 0 ? markSize : DEFAULT_PROPS.markSize ?? 18;
  return `  mark-size: [min(${n}, 5 + sqrt(100000 / env('wms_scale_denominator', 10000)) * ${scaleFactor})];`;
}

/** 라벨 필드 지정 시 자동으로 넣는 글자·후광 기본값 (항공지도 가독성) */
const LABEL_STYLE_DEFAULTS = {
  fontSize: 14,
  fontFill: '#FFFFFF',
  haloRadius: 2,
  haloColor: '#222222',
  fontWeight: 'bold',
  // emd와 동일. z-index로 규칙을 나누면 첫 글꼴만 쓰이므로 생성 CSS도 단일 규칙에 둘 것.
  fontFamily: '"Nanum Gothic", "Malgun Gothic", "SansSerif"',
} as const;

/**
 * 라벨 공통 스타일 + 도형별 배치.
 * SLD LabelPlacement 대응:
 * - POINT: PointPlacement anchor(0.5,1) + displacement(0,-10)
 * - LINE: LinePlacement perpendicularOffset 5
 * - POLYGON: PointPlacement anchor(0.5,1) + displacement(0,0) + goodnessOfFit 0
 */
function pushLabelStyleLines(
  lines: string[],
  geometryType: GeometryType,
  label: string,
  fontSize: number
): void {
  lines.push(`  label: [${label}];`);
  lines.push(`  font-size: ${fontSize};`);
  lines.push(`  font-fill: ${LABEL_STYLE_DEFAULTS.fontFill};`);
  lines.push(`  font-weight: ${LABEL_STYLE_DEFAULTS.fontWeight};`);
  lines.push(`  font-family: ${LABEL_STYLE_DEFAULTS.fontFamily};`);
  lines.push(`  halo-radius: ${LABEL_STYLE_DEFAULTS.haloRadius};`);
  lines.push(`  halo-color: ${LABEL_STYLE_DEFAULTS.haloColor};`);

  if (geometryType === 'POINT') {
    lines.push('  label-anchor: 0.5 1.0;');
    lines.push('  label-offset: 0 -10;');
  } else if (geometryType === 'LINE') {
    lines.push('  label-follow-line: true;');
    lines.push('  label-offset: 5;');
  } else {
    // POLYGON
    lines.push('  label-geometry: [centroid(geom)];');
    lines.push('  label-anchor: 0.5 1.0;');
    lines.push('  label-offset: 0 0;');
    lines.push('  label-fit-goodness: 0;');
  }
}

/**
 * 첫 "* {" 시작 위치부터 중괄호 깊이를 세어 매칭되는 닫는 "}"까지의 범위를 찾는다.
 * ":mark { ... }" 같은 중첩 셀렉터가 있어도 바깥 블록 전체를 온전히 가져온다
 * (기존 non-greedy 정규식은 첫 "}"에서 멈춰 중첩 블록이 있으면 바깥 블록이 잘렸음).
 * braceStart/braceEnd는 각각 여는/닫는 중괄호 자체의 인덱스.
 */
function findOuterStarBlockRange(cssText: string): { braceStart: number; braceEnd: number } | null {
  const starIdx = cssText.search(/\*\s*\{/);
  if (starIdx === -1) return null;
  const braceStart = cssText.indexOf('{', starIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < cssText.length; i++) {
    if (cssText[i] === '{') depth++;
    else if (cssText[i] === '}') {
      depth--;
      if (depth === 0) return { braceStart, braceEnd: i };
    }
  }
  return null;
}

/**
 * `fromIndex` 이후에서 다음 맨손 `* { ... }` 블록 범위를 찾는다.
 * `*:nth-symbol` / `[@z] *` 처럼 *와 { 사이에 다른 토큰이 있으면 건너뛴다.
 */
function findNextBareStarBlockRange(
  cssText: string,
  fromIndex: number
): { starIdx: number; braceStart: number; braceEnd: number } | null {
  let searchFrom = fromIndex;
  while (searchFrom < cssText.length) {
    const rel = cssText.slice(searchFrom).search(/\*\s*\{/);
    if (rel === -1) return null;
    const starIdx = searchFrom + rel;
    const braceStart = cssText.indexOf('{', starIdx);
    if (braceStart === -1) return null;
    // `*` 와 `{` 사이는 공백만 허용 (맨손 * 규칙)
    const between = cssText.slice(starIdx + 1, braceStart);
    if (!/^\s*$/.test(between)) {
      searchFrom = braceStart + 1;
      continue;
    }
    let depth = 0;
    for (let i = braceStart; i < cssText.length; i++) {
      if (cssText[i] === '{') depth++;
      else if (cssText[i] === '}') {
        depth--;
        if (depth === 0) return { starIdx, braceStart, braceEnd: i };
      }
    }
    return null;
  }
  return null;
}

function extractOuterStarBlock(cssText: string): string {
  const range = findOuterStarBlockRange(cssText);
  if (!range) return '';
  return cssText.slice(range.braceStart + 1, range.braceEnd);
}

/** 블록 본문이 라벨 전용인지 (도형 mark/fill/stroke 없이 label만) */
function isLabelOnlyBlock(blockBody: string): boolean {
  const hasLabel = /(?:^|[^\w-])label\s*:/i.test(blockBody);
  if (!hasLabel) return false;
  // font-fill / stroke-opacity 등과 구분 — 속성명 경계에 하이픈이 있으면 제외
  const hasMark =
    /(?:^|[^\w-])mark\s*:/i.test(blockBody) || /(?:^|[^\w-])mark-size\b/i.test(blockBody);
  const hasFill = /(?:^|[^\w-])fill\s*:/i.test(blockBody);
  const hasStroke = /(?:^|[^\w-])stroke\s*:/i.test(blockBody);
  return !hasMark && !hasFill && !hasStroke;
}

/**
 * Extract the first * { ... } block and parse key: value; into StyleProps.
 * Infers geometry type from presence of mark/fill/stroke.
 * 라벨은 뒤쪽 전용 규칙에 있을 수 있으므로 CSS 전체에서 조회한다.
 */
export function parseSimpleStyleFromCss(cssText: string): {
  styleProps: StyleProps;
  geometryType: GeometryType;
} {
  const styleProps: StyleProps = { ...DEFAULT_PROPS };

  const block = extractOuterStarBlock(cssText);

  const parseOne = (key: string, value: string, target: StyleProps) => {
    const v = value.trim();
    if (key === 'fill') target.fillColor = v;
    else if (key === 'stroke') {
      // LINE 스타일은 "#FFFFFF, 실제색상" 형태(흰 테두리+메인색)로 저장되므로 마지막 값만 취함
      const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
      target.strokeColor = parts.length > 1 ? parts[parts.length - 1] : v;
    }
    else if (key === 'stroke-width') target.strokeWidth = parseFloat(v) || 1;
    else if (key === 'fill-opacity') target.opacity = parseFloat(v);
    else if (key === 'stroke-opacity') {
      const parts = v.split(',').map((p) => parseFloat(p.trim())).filter((n) => !Number.isNaN(n));
      if (parts.length) target.strokeOpacity = parts[parts.length - 1];
    }
    else if (key === 'font-size') target.size = parseFloat(v) || LABEL_STYLE_DEFAULTS.fontSize;
    else if (key === 'mark-size') {
      const n = parseFloat(v);
      if (!Number.isNaN(n) && !/[\[\]]/.test(v)) {
        target.markSize = n;
        return;
      }
      const cap = v.match(/min\s*\(\s*([0-9.]+)/i);
      if (cap) target.markSize = parseFloat(cap[1]);
    }
    else if (key === 'label') {
      const m = v.match(/\[\s*([^\]]+)\s*\]/);
      if (m) target.labelField = m[1].trim();
    }
    else if (key === 'mark') {
      const urlMatch = v.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/i);
      if (urlMatch) target.symbolUrl = normalizeGeoServerSymbolUrl(urlMatch[1].trim());
    }
  };

  // ":mark { fill: ...; }" 처럼 중첩된 하위 셀렉터의 속성도 그대로 잡아내도록
  // 블록 전체에서 "key: value;" 패턴을 전역으로 훑는다 (중첩 depth 무시하고 평탄화).
  const propRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = propRe.exec(block))) {
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    parseOne(key, value, styleProps);
  }

  // 라벨·글자크기는 CSS 전체(뒤쪽 라벨 전용 규칙 포함)에서 보강
  const allPropRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
  while ((match = allPropRe.exec(cssText))) {
    const key = match[1].trim().toLowerCase();
    if (key !== 'label' && key !== 'font-size') continue;
    parseOne(key, match[2].trim(), styleProps);
  }

  const hasMark = /\bmark\s*:/i.test(block) || /\bmark-size\b/i.test(block);
  const hasFill = /\bfill\s*:/i.test(block);
  const hasStroke = /\bstroke\s*:/i.test(block);

  let geometryType: GeometryType = 'POLYGON';
  if (hasMark || (hasFill && hasStroke && block.includes('mark'))) {
    geometryType = 'POINT';
  } else if (hasStroke && !hasFill) {
    geometryType = 'LINE';
  } else if (hasFill || hasStroke) {
    geometryType = 'POLYGON';
  }

  return { styleProps, geometryType };
}

/**
 * Build CSS from geometry type and style props.
 * 라벨이 있으면 도형 규칙 뒤에 라벨 전용 * 규칙을 두어 라벨이 위에 그려지게 한다.
 */
export function buildCssFromSimpleStyle(
  geometryType: GeometryType,
  styleProps: StyleProps
): string {
  const f = styleProps.fillColor ?? DEFAULT_PROPS.fillColor;
  const s = styleProps.strokeColor ?? DEFAULT_PROPS.strokeColor;
  const sw = styleProps.strokeWidth ?? DEFAULT_PROPS.strokeWidth;
  const op = styleProps.opacity ?? DEFAULT_PROPS.opacity;
  const strokeOp = styleProps.strokeOpacity ?? DEFAULT_PROPS.strokeOpacity;
  const label = styleProps.labelField?.trim();
  const fontSize = styleProps.size ?? DEFAULT_PROPS.size ?? LABEL_STYLE_DEFAULTS.fontSize;

  const geomLines: string[] = [];

  if (geometryType === 'POINT') {
    const symbolUrlRaw = styleProps.symbolUrl?.trim();
    const symbolUrl = symbolUrlRaw ? normalizeGeoServerSymbolUrl(symbolUrlRaw) : '';
    if (symbolUrl) {
      // Point - 심볼이 있을 때 (호스트 없는 /www/symbol/… 만 기록)
      const mime = symbolUrl.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      geomLines.push(`  mark: url("${symbolUrl}");`);
      geomLines.push(`  mark-mime: "${mime}";`);
      const markSize = styleProps.markSize ?? DEFAULT_PROPS.markSize ?? 18;
      geomLines.push(markSizeCssLine(markSize, MARK_SIZE_SCALE_SYMBOL));
    } else {
      // Point - 심볼이 없을 때
      geomLines.push(`  mark: symbol(circle);`);
      const markSize = styleProps.markSize ?? DEFAULT_PROPS.markSize ?? 18;
      geomLines.push(markSizeCssLine(markSize, MARK_SIZE_SCALE_POINT));
      geomLines.push(`  :mark {`);
      geomLines.push(`    fill: ${f};`);
      geomLines.push(`    stroke: ${s};`);
      geomLines.push(`    stroke-width: ${sw};`);
      geomLines.push(`    stroke-opacity: ${strokeOp};`);
      geomLines.push(`    fill-opacity: ${op};`);
      geomLines.push(`  };`);
    }
  } else if (geometryType === 'LINE') {
    // Line: 테두리 흰색(3px) + 메인 색(2px)
    geomLines.push(`  stroke: #FFFFFF, ${s};`);
    geomLines.push(`  stroke-width: 3, 2;`);
    geomLines.push(`  stroke-opacity: 0.4, ${strokeOp};`);
  } else {
    geomLines.push(`  fill: ${f};`);
    geomLines.push(`  stroke: ${s};`);
    geomLines.push(`  stroke-width: ${sw};`);
    geomLines.push(`  fill-opacity: ${op};`);
    geomLines.push(`  stroke-opacity: ${strokeOp};`);
  }

  const geomBlock = `* {\n${geomLines.join('\n')}\n  z-index: 0;\n}`;
  if (!label) return geomBlock;

  const labelLines: string[] = [];
  pushLabelStyleLines(labelLines, geometryType, label, fontSize);
  // z-index가 높을수록 나중에 그려짐 → 모든 도형을 그린 뒤 라벨을 올려 도형 위에 표시
  labelLines.push('  z-index: 1;');
  const labelBlock = `* {\n${labelLines.join('\n')}\n}`;
  return `${geomBlock}\n\n${labelBlock}`;
}

/** 주제도 라벨 — 기본 종류명만. 도로폭(광로·소로·대로·중로)은 alias 포함 식 */
export const THEMATIC_MAP_LABEL_EXPRESSION = 'layer_korname';

export const THEMATIC_MAP_LABEL_WITH_ALIAS_EXPRESSION =
  "if_then_else(isNull(alias), layer_korname, if_then_else(equalTo(alias, ''), layer_korname, Concatenate(Concatenate(layer_korname, ' ('), Concatenate(alias, ')'))))";

/** 주제도 라벨 기본 글자 크기 */
export const THEMATIC_MAP_LABEL_FONT_SIZE = 12;

const ROAD_WIDTH_KOR_PREFIX = /^(광로|소로|대로|중로)/;

export function usesThematicAliasLabel(korName: string): boolean {
  return ROAD_WIDTH_KOR_PREFIX.test(String(korName ?? '').trim());
}

/**
 * 주제도 폴리곤 CSS — emd.css와 같이 단일 * 규칙에 도형+라벨.
 * font-fill은 면 색, halo는 흰색 (항공·배경 위 가독성).
 */
export function buildThematicMapPolygonCss(styleProps: StyleProps): string {
  const f = styleProps.fillColor ?? DEFAULT_PROPS.fillColor!;
  const s = styleProps.strokeColor ?? DEFAULT_PROPS.strokeColor!;
  const sw = styleProps.strokeWidth ?? DEFAULT_PROPS.strokeWidth!;
  const op = styleProps.opacity ?? DEFAULT_PROPS.opacity!;
  const strokeOp = styleProps.strokeOpacity ?? DEFAULT_PROPS.strokeOpacity!;
  const label = styleProps.labelField?.trim() || THEMATIC_MAP_LABEL_EXPRESSION;
  const fontSize = styleProps.size ?? THEMATIC_MAP_LABEL_FONT_SIZE;

  return `* {
  fill: ${f};
  stroke: ${s};
  stroke-width: ${sw};
  fill-opacity: ${op};
  stroke-opacity: ${strokeOp};

  label: [${label}];
  label-anchor: 0.5 0.5;
  label-geometry: [centroid(geom)];

  font-family: ${LABEL_STYLE_DEFAULTS.fontFamily};
  font-size: ${fontSize};
  font-weight: ${LABEL_STYLE_DEFAULTS.fontWeight};
  font-fill: ${f};

  halo-color: #FFFFFF;
  halo-radius: 3;
  halo-opacity: 0.9;

  label-conflict-resolution: true;
  label-group: true;
  label-max-displacement: 0;
  label-priority: [area(geom)];
  label-fit-goodness: 0.1;
}
`;
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sldCssParam(name: string, value: string | number): string {
  return `<CssParameter name="${name}">${xmlText(String(value))}</CssParameter>`;
}

/** 화면의 색·선으로 만드는 기본 SLD. 화살표·벤더 옵션은 포함하지 않는다. */
export function buildSldFromSimpleStyle(
  geometryType: GeometryType,
  styleProps: StyleProps,
  styleName: string
): string {
  const f = styleProps.fillColor ?? DEFAULT_PROPS.fillColor ?? '#808080';
  const s = styleProps.strokeColor ?? DEFAULT_PROPS.strokeColor ?? '#000000';
  const sw = styleProps.strokeWidth ?? DEFAULT_PROPS.strokeWidth ?? 1;
  const op = styleProps.opacity ?? DEFAULT_PROPS.opacity ?? 0.3;
  const strokeOp = styleProps.strokeOpacity ?? DEFAULT_PROPS.strokeOpacity ?? 1;
  const label = styleProps.labelField?.trim() ?? '';
  const fontSize = styleProps.size ?? DEFAULT_PROPS.size ?? LABEL_STYLE_DEFAULTS.fontSize;
  const markSize = styleProps.markSize ?? DEFAULT_PROPS.markSize ?? 18;
  const safeLabel = /^[A-Za-z_][A-Za-z0-9_]*$/.test(label) ? label : '';

  let symbolizer = '';
  if (geometryType === 'POINT') {
    const symbolUrlRaw = styleProps.symbolUrl?.trim();
    const symbolUrl = symbolUrlRaw ? normalizeGeoServerSymbolUrl(symbolUrlRaw) : '';
    const graphic = symbolUrl
      ? `<ExternalGraphic><OnlineResource xlink:type="simple" xlink:href="${xmlText(symbolUrl)}"/><Format>${symbolUrl.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png'}</Format></ExternalGraphic>`
      : `<Mark><WellKnownName>circle</WellKnownName><Fill>${sldCssParam('fill', f)}${sldCssParam('fill-opacity', op)}</Fill><Stroke>${sldCssParam('stroke', s)}${sldCssParam('stroke-width', sw)}${sldCssParam('stroke-opacity', strokeOp)}</Stroke></Mark>`;
    symbolizer = `<PointSymbolizer><Graphic>${graphic}<Size>${markSize}</Size></Graphic></PointSymbolizer>`;
  } else if (geometryType === 'LINE') {
    symbolizer = [
      `<LineSymbolizer><Stroke>${sldCssParam('stroke', '#FFFFFF')}${sldCssParam('stroke-width', 3)}${sldCssParam('stroke-opacity', 0.4)}</Stroke></LineSymbolizer>`,
      `<LineSymbolizer><Stroke>${sldCssParam('stroke', s)}${sldCssParam('stroke-width', 2)}${sldCssParam('stroke-opacity', strokeOp)}</Stroke></LineSymbolizer>`,
    ].join('');
  } else {
    symbolizer = `<PolygonSymbolizer><Fill>${sldCssParam('fill', f)}${sldCssParam('fill-opacity', op)}</Fill><Stroke>${sldCssParam('stroke', s)}${sldCssParam('stroke-width', sw)}${sldCssParam('stroke-opacity', strokeOp)}</Stroke></PolygonSymbolizer>`;
  }

  let textSymbolizer = '';
  if (safeLabel) {
    const placement =
      geometryType === 'LINE'
        ? '<LabelPlacement><LinePlacement><PerpendicularOffset>5</PerpendicularOffset></LinePlacement></LabelPlacement>'
        : `<LabelPlacement><PointPlacement><AnchorPoint><AnchorPointX>0.5</AnchorPointX><AnchorPointY>1.0</AnchorPointY></AnchorPoint><Displacement><DisplacementX>0</DisplacementX><DisplacementY>${geometryType === 'POINT' ? '-10' : '0'}</DisplacementY></Displacement></PointPlacement></LabelPlacement>`;
    const geometry =
      geometryType === 'POLYGON'
        ? '<Geometry><ogc:Function name="centroid"><ogc:PropertyName>geom</ogc:PropertyName></ogc:Function></Geometry>'
        : '';
    textSymbolizer = `<TextSymbolizer>${geometry}<Label><ogc:PropertyName>${safeLabel}</ogc:PropertyName></Label><Font>${sldCssParam('font-family', 'Nanum Gothic')}${sldCssParam('font-size', fontSize)}${sldCssParam('font-weight', 'bold')}</Font>${placement}<Halo><Radius>2</Radius><Fill>${sldCssParam('fill', '#222222')}</Fill></Halo><Fill>${sldCssParam('fill', '#FFFFFF')}</Fill></TextSymbolizer>`;
  }

  const name = xmlText(styleName.trim() || 'style');
  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>${name}</Name>
    <UserStyle>
      <Name>${name}</Name>
      <FeatureTypeStyle>
        <Rule>${symbolizer}${textSymbolizer}</Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
`;
}

/** layer_korname 라벨이면 주제도(emd형) CSS 빌더 사용 */
export function buildCssForLayerStyle(
  geometryType: GeometryType,
  styleProps: StyleProps
): string {
  const label = styleProps.labelField?.trim() ?? '';
  if (
    geometryType === 'POLYGON' &&
    (label.includes('layer_korname') || label === 'layer_korname')
  ) {
    return buildThematicMapPolygonCss(styleProps);
  }
  return buildCssFromSimpleStyle(geometryType, styleProps);
}

/**
 * 첫 * { ... } 도형 블록을 newStarBlock으로 교체.
 * newStarBlock에 라벨 전용 규칙이 포함될 수 있으므로,
 * 바로 뒤에 있던 기존 라벨 전용 * 규칙은 제거해 중복을 막는다.
 */
export function replaceDefaultRuleInCss(cssText: string, newStarBlock: string): string {
  const range = findNextBareStarBlockRange(cssText, 0) ?? (() => {
    const r = findOuterStarBlockRange(cssText);
    if (!r) return null;
    const starIdx = cssText.lastIndexOf('*', r.braceStart);
    return { starIdx: starIdx === -1 ? r.braceStart : starIdx, braceStart: r.braceStart, braceEnd: r.braceEnd };
  })();

  if (!range) return newStarBlock + (cssText.trim() ? '\n\n' + cssText : '');

  const idx = range.starIdx;
  let end = range.braceEnd + 1;

  // 바로 다음 맨손 * 블록이 라벨 전용이면 함께 제거 (이전 저장분 정리)
  const next = findNextBareStarBlockRange(cssText, end);
  if (next) {
    const between = cssText.slice(end, next.starIdx);
    if (/^\s*$/.test(between)) {
      const nextBody = cssText.slice(next.braceStart + 1, next.braceEnd);
      if (isLabelOnlyBlock(nextBody)) {
        end = next.braceEnd + 1;
      }
    }
  }

  const before = cssText.slice(0, idx);
  const after = cssText.slice(end).trim();
  return (before + newStarBlock + (after ? '\n\n' + after : '')).trim();
}

/** @deprecated 앱 전용 `/symbol/…` 아이콘용. 레이어 심볼은 resolveSymbolPreviewUrl 사용 */
export function toPublicSymbolPreviewUrl(symbolUrlOrName: string): string | null {
  const raw = String(symbolUrlOrName ?? '').trim();
  if (!raw) return null;
  if (/^\/?symbol\//i.test(raw) && !/www\/symbol/i.test(raw)) {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
  const file = raw.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  const m = file.match(/^(.+)\.(svg|png)$/i);
  if (m) return `/symbol/${m[1]}.${m[2].toLowerCase()}`;
  if (/^[a-zA-Z0-9._-]+$/.test(raw)) return `/symbol/${raw}.svg`;
  return null;
}

/**
 * 브라우저 img/다운로드용 심볼 URL.
 * SLD의 `/www/symbol/…`는 GeoServer 공개 경로로 풀고,
 * 앱 전용 `/symbol/…`는 Next static 그대로 둔다.
 * 파일명만 있으면 water 폴더를 기본으로 둔다.
 */
export function resolveSymbolPreviewUrl(
  symbolUrlOrName: string,
  geoserverBase?: string | null
): string | null {
  const raw = String(symbolUrlOrName ?? '').trim();
  if (!raw) return null;
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;

  // 안전시설·CCTV 등 Next public/symbol 전용
  if (/^\/?symbol\//i.test(raw) && !/www\/symbol/i.test(raw)) {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  const base = String(geoserverBase ?? '').replace(/\/$/, '');
  const withBase = (href: string) => (base ? `${base}${href.startsWith('/') ? href : `/${href}`}` : href);

  const wwwMatch = raw.match(/(?:(?:\.\.\/)+)?\/?(www\/symbol\/[^\s?#]+)/i);
  if (wwwMatch) return withBase(`/${wwwMatch[1]}`);

  const file = raw.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  const m = file.match(/^(.+)\.(svg|png)$/i);
  if (m) return withBase(`/www/symbol/water/${m[1]}.${m[2].toLowerCase()}`);
  if (/^[a-zA-Z0-9._-]+$/.test(raw)) return withBase(`/www/symbol/water/${raw}.svg`);
  return null;
}

/** 심볼 주소에서 폴더명 추출. `…/www/symbol/{폴더}/{파일}` 또는 `../www/symbol/…` 형식 */
export function parseSymbolFolderFromUrl(symbolUrl: string): string | null {
  const raw = String(symbolUrl ?? '').trim();
  if (!raw) return null;
  const m = raw.split(/[?#]/)[0].match(/(?:\.\.\/)?www\/symbol\/([^/]+)\/[^/]+\.(?:svg|png)$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** 심볼 주소에서 파일명만 추출 (모달 표시용) */
export function symbolFileNameFromUrl(symbolUrl: string): string {
  const raw = String(symbolUrl ?? '').trim();
  if (!raw) return '';
  return raw.split(/[?#]/)[0].split(/[\\/]/).pop() ?? raw;
}

const SLD_ENV_PAIR_SOURCE =
  '<(?:[\\w]+:)?Function\\s+name="env">\\s*<(?:[\\w]+:)?Literal>\\s*([^<]+?)\\s*</(?:[\\w]+:)?Literal>\\s*<(?:[\\w]+:)?Literal>\\s*([^<]*?)\\s*</(?:[\\w]+:)?Literal>';

function sldEnvPairPattern(): RegExp {
  return new RegExp(SLD_ENV_PAIR_SOURCE, 'g');
}

function sldRuleBlocks(sld: string): string[] {
  return sld.match(/<(?:[\w]+:)?Rule\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?Rule>/g) ?? [];
}

function sldRuleTitle(rule: string): string {
  return rule.match(/<(?:[\w]+:)?Title>\s*([^<]+?)\s*<\/(?:[\w]+:)?Title>/)?.[1]?.trim() ?? '';
}

function sldEnvDefaults(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(sldEnvPairPattern())) {
    const key = match[1]?.trim();
    if (!key || found.has(key)) continue;
    found.set(key, match[2]?.trim() ?? '');
  }
  return found;
}

function sldRuleName(rule: string): string {
  return rule.match(/<(?:[\w]+:)?Name>\s*([^<]+?)\s*<\/(?:[\w]+:)?Name>/)?.[1]?.trim() ?? '';
}

function sldHasGeomSymbolizer(rule: string): boolean {
  return /<(?:[\w]+:)?(?:Point|Line|Polygon)Symbolizer\b/i.test(rule);
}

/** 범례 전용·라벨·화살표 규칙은 대표 스타일에서 제외 */
function sldIsSecondaryRule(rule: string): boolean {
  const title = sldRuleTitle(rule).toLowerCase();
  const name = sldRuleName(rule).toLowerCase();
  if (/_label$|_arrow$|_halo$/.test(title) || /_label$|_arrow$|_halo$/.test(name)) return true;
  if (name === 'legend_sample' || name.includes('legend') || title.includes('legend')) return true;
  if (/<(?:[\w]+:)?TextSymbolizer\b/i.test(rule) && !sldHasGeomSymbolizer(rule)) return true;
  const maxScale = rule.match(/<(?:[\w]+:)?MaxScaleDenominator>\s*([0-9.]+)/i)?.[1];
  if (maxScale != null && Number(maxScale) <= 1) return true;
  return false;
}

/**
 * 편집 대상 규칙: 스타일명 Title 우선 → 없으면 첫 도형 심볼라이저 규칙
 * (Title 없는 점 심볼·한글 Title 분류 규칙 등 보정)
 */
function findPrimaryStyleRule(sld: string, styleName: string): { title: string; rule: string } | null {
  const name = styleName.trim();
  const rules = sldRuleBlocks(sld);
  if (!rules.length) return null;

  const byTitle =
    rules.find((block) => sldRuleTitle(block) === name) ??
    rules.find((block) => sldRuleTitle(block).toLowerCase() === name.toLowerCase());
  if (byTitle) return { title: sldRuleTitle(byTitle) || name, rule: byTitle };

  const geomRules = rules.filter((r) => sldHasGeomSymbolizer(r) && !sldIsSecondaryRule(r));
  const pick = geomRules[0] ?? rules.find((r) => sldHasGeomSymbolizer(r)) ?? null;
  if (!pick) return null;
  return { title: sldRuleTitle(pick) || name, rule: pick };
}

/** @deprecated findPrimaryStyleRule 사용. 호환용 별칭 */
function ruleWithStyleTitle(sld: string, styleName: string): { title: string; rule: string } | null {
  return findPrimaryStyleRule(sld, styleName);
}

/** CssParameter 본문에서 색·숫자 리터럴 추출 (고정값 또는 env 기본값) */
function sldCssParamLiteral(rule: string, paramName: string): string | null {
  const re = new RegExp(
    `<(?:[\\w]+:)?CssParameter\\s+name=["']${paramName}["']\\s*>([\\s\\S]*?)</(?:[\\w]+:)?CssParameter>`,
    'i'
  );
  const m = rule.match(re);
  if (!m) return null;
  const body = m[1];
  const plain = body.replace(/<[^>]+>/g, '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(plain) || /^-?[0-9]+(?:\.[0-9]+)?$/.test(plain)) return plain;
  const literals = [...body.matchAll(/<(?:[\w]+:)?Literal>\s*([^<]*?)\s*<\/(?:[\w]+:)?Literal>/gi)].map(
    (x) => x[1].trim()
  );
  for (let i = literals.length - 1; i >= 0; i--) {
    const v = literals[i];
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(v) && !/_/.test(v)) return v;
  }
  return null;
}

function sldGraphicSize(rule: string): number | undefined {
  const sizeBlock = rule.match(/<(?:[\w]+:)?Size>([\s\S]*?)<\/(?:[\w]+:)?Size>/i)?.[1];
  if (!sizeBlock) return undefined;
  const plain = sizeBlock.replace(/<[^>]+>/g, '').trim();
  if (/^[0-9.]+$/.test(plain)) {
    const n = Number(plain);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const literals = [...sizeBlock.matchAll(/<(?:[\w]+:)?Literal>\s*([^<]*?)\s*<\/(?:[\w]+:)?Literal>/gi)]
    .map((x) => x[1].trim())
    .filter((v) => /^[0-9.]+$/.test(v))
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 200);
  return literals[0];
}

function hexFromEnv(value: string): string {
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`;
  return raw;
}

function hexToEnv(value: string | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

/** PointSymbolizer ExternalGraphic 주소. CSS mark:url(...) ↔ SLD 심볼 대응 */
function sldExternalGraphicHref(block: string): string | null {
  const m =
    block.match(/<(?:[\w]+:)?OnlineResource\b[^>]*\bxlink:href\s*=\s*["']([^"']+)["']/i) ??
    block.match(/<(?:[\w]+:)?OnlineResource\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  const href = m?.[1]?.trim();
  return href || null;
}

function sldMimeForSymbolUrl(url: string): string {
  return url.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
}

/** 점 크기: 제목_size → 규칙 내 기타 *_size(라벨 제외) → 숫자 Size */
function sldPointMarkSize(
  rule: string,
  env: Map<string, string>,
  title: string
): number | undefined {
  const titled = env.get(`${title}_size`);
  if (titled != null && titled !== '') {
    const n = Number(titled);
    if (Number.isFinite(n)) return n;
  }
  for (const [key, value] of env) {
    if (/_label_size$/i.test(key) || !/_size$/i.test(key) || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  const plain = rule.match(/<(?:[\w]+:)?Size>\s*([0-9.]+)\s*<\/(?:[\w]+:)?Size>/i);
  if (plain) {
    const n = Number(plain[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * 규칙 Graphic을 CSS와 같이 심볼(url) ↔ 원(Mark)으로 맞춘다.
 * - symbolUrl 있음: ExternalGraphic href/Format 갱신, 없으면 Mark→ExternalGraphic
 * - symbolUrl 없음 + ExternalGraphic: circle Mark로 교체 (POINT)
 */
function patchSldRuleGraphicSymbol(rule: string, symbolUrl: string | undefined): string {
  const urlRaw = symbolUrl?.trim() ?? '';
  const url = urlRaw ? normalizeGeoServerSymbolUrl(urlRaw) : '';
  const hasExternal = /<(?:[\w]+:)?ExternalGraphic\b/i.test(rule);
  const hasMark = /<(?:[\w]+:)?Mark\b/i.test(rule);

  if (url) {
    const mime = sldMimeForSymbolUrl(url);
    const hrefAttr = xmlText(url);
    if (hasExternal) {
      let next = rule.replace(
        /<(?:[\w]+:)?OnlineResource\b[^>]*>/gi,
        (tag) => {
          if (/\bxlink:href\s*=/i.test(tag)) {
            return tag.replace(/\bxlink:href\s*=\s*["'][^"']*["']/i, `xlink:href="${hrefAttr}"`);
          }
          if (/\bhref\s*=/i.test(tag)) {
            return tag.replace(/\bhref\s*=\s*["'][^"']*["']/i, `href="${hrefAttr}"`);
          }
          return tag.replace(/\/?>$/, ` xlink:href="${hrefAttr}"$&`);
        }
      );
      next = next.replace(
        /(<(?:[\w]+:)?ExternalGraphic\b[\s\S]*?<(?:[\w]+:)?Format>)([^<]*)(<\/(?:[\w]+:)?Format>)/i,
        `$1${mime}$3`
      );
      return next;
    }
    if (hasMark) {
      const graphic = `<ExternalGraphic><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${hrefAttr}"/><Format>${mime}</Format></ExternalGraphic>`;
      return rule.replace(/<(?:[\w]+:)?Mark\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?Mark>/i, graphic);
    }
    return rule;
  }

  if (hasExternal) {
    return rule.replace(
      /<(?:[\w]+:)?ExternalGraphic\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?ExternalGraphic>/i,
      '<Mark><WellKnownName>circle</WellKnownName></Mark>'
    );
  }
  return rule;
}

function envValueBySuffixes(env: Map<string, string>, styleName: string, title: string, suffix: string): string | undefined {
  for (const key of [`${styleName}${suffix}`, `${title}${suffix}`]) {
    const v = env.get(key);
    if (v != null) return v;
  }
  for (const [key, value] of env) {
    if (key.endsWith(suffix) && (suffix !== '_size' || !/_label_size$/i.test(key))) return value;
  }
  return undefined;
}

/** 대표 규칙의 env·CssParameter·심볼을 화면 값으로 읽는다. Title 불일치·고정색 SLD도 보정. */
export function parseSldEnvStyle(
  sld: string,
  styleName: string
): { styleProps: StyleProps; geometryType: GeometryType } | null {
  if (!styleName.trim() || !sld.trim()) return null;
  const found = findPrimaryStyleRule(sld, styleName);
  if (!found) return null;
  const { title, rule } = found;
  if (!sldHasGeomSymbolizer(rule)) return null;

  const env = sldEnvDefaults(rule);
  // 라벨 env는 *_label 규칙에 있을 수 있음
  const labelRule =
    sldRuleBlocks(sld).find((r) => {
      const t = sldRuleTitle(r);
      return t === `${styleName}_label` || t === `${title}_label`;
    }) ?? null;
  const labelEnv = labelRule ? sldEnvDefaults(labelRule) : env;

  const styleProps: StyleProps = {};
  const stroke = envValueBySuffixes(env, styleName, title, '_stroke') ?? sldCssParamLiteral(rule, 'stroke');
  const strokeOpacity =
    envValueBySuffixes(env, styleName, title, '_stroke_opacity') ?? sldCssParamLiteral(rule, 'stroke-opacity');
  const strokeWidth =
    envValueBySuffixes(env, styleName, title, '_stroke_width') ?? sldCssParamLiteral(rule, 'stroke-width');
  const fill = envValueBySuffixes(env, styleName, title, '_fill') ?? sldCssParamLiteral(rule, 'fill');
  const fillOpacity =
    envValueBySuffixes(env, styleName, title, '_fill_opacity') ??
    envValueBySuffixes(env, styleName, title, '_opacity') ??
    sldCssParamLiteral(rule, 'fill-opacity');
  const label =
    envValueBySuffixes(labelEnv, styleName, title, '_label_property_name') ??
    envValueBySuffixes(env, styleName, title, '_label_property_name');
  const labelSize =
    envValueBySuffixes(labelEnv, styleName, title, '_label_size') ??
    envValueBySuffixes(env, styleName, title, '_label_size');
  const markSize = sldPointMarkSize(rule, env, title) ?? sldGraphicSize(rule);
  const symbolUrl = sldExternalGraphicHref(rule);

  if (stroke != null && stroke !== '') styleProps.strokeColor = hexFromEnv(stroke);
  if (strokeOpacity != null && strokeOpacity !== '') {
    const n = Number(strokeOpacity);
    if (Number.isFinite(n)) styleProps.strokeOpacity = n;
  }
  if (strokeWidth != null && strokeWidth !== '') {
    const n = Number(strokeWidth);
    if (Number.isFinite(n) && n > 0) styleProps.strokeWidth = n;
  }
  if (fill != null && fill !== '') styleProps.fillColor = hexFromEnv(fill);
  if (fillOpacity != null && fillOpacity !== '') {
    const n = Number(fillOpacity);
    if (Number.isFinite(n)) styleProps.opacity = n;
  }
  if (label != null && String(label).trim() !== '') styleProps.labelField = label;
  if (labelSize != null && labelSize !== '') {
    const n = Number(labelSize);
    if (Number.isFinite(n) && n > 0) styleProps.size = n;
  }
  if (markSize != null && markSize > 0) styleProps.markSize = markSize;
  if (symbolUrl) styleProps.symbolUrl = normalizeGeoServerSymbolUrl(symbolUrl);

  let geometryType: GeometryType = 'POLYGON';
  if (/<(?:[\w]+:)?LineSymbolizer\b/.test(rule)) geometryType = 'LINE';
  else if (/<(?:[\w]+:)?PointSymbolizer\b/.test(rule) && !/<(?:[\w]+:)?PolygonSymbolizer\b/.test(rule)) {
    geometryType = 'POINT';
  }
  return { styleProps, geometryType };
}

function envUpdatesForStyle(styleName: string, props: StyleProps, keys: Set<string>): Map<string, string> {
  const updates = new Map<string, string>();
  const put = (suffix: string, value: string | null) => {
    if (value == null || value === '') return;
    const preferred = `${styleName}${suffix}`;
    if (keys.has(preferred)) {
      updates.set(preferred, value);
      return;
    }
    for (const key of keys) {
      if (suffix === '_size' && /_label_size$/i.test(key)) continue;
      if (!key.endsWith(suffix)) continue;
      updates.set(key, value);
    }
  };
  put('_stroke', hexToEnv(props.strokeColor));
  put('_fill', hexToEnv(props.fillColor));
  if (props.strokeOpacity != null && Number.isFinite(props.strokeOpacity)) {
    put('_stroke_opacity', String(props.strokeOpacity));
  }
  if (props.opacity != null && Number.isFinite(props.opacity)) {
    put('_fill_opacity', String(props.opacity));
    put('_opacity', String(props.opacity));
  }
  if (props.strokeWidth != null && Number.isFinite(props.strokeWidth)) {
    put('_stroke_width', String(props.strokeWidth));
  }
  if (props.size != null && Number.isFinite(props.size)) put('_label_size', String(props.size));
  if (props.markSize != null && Number.isFinite(props.markSize)) put('_size', String(props.markSize));
  const label = props.labelField?.trim() ?? '';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) put('_label_property_name', label);
  return updates;
}

/** 중첩 Function 없는 CssParameter 고정값만 화면 값으로 교체 */
function patchSldRuleCssParams(rule: string, props: StyleProps): string {
  let next = rule;
  const patchPlain = (paramName: string, value: string | undefined) => {
    if (value == null || value === '') return;
    const re = new RegExp(
      `(<(?:[\\w]+:)?CssParameter\\s+name=["']${paramName}["']\\s*>)([^<]*)(</(?:[\\w]+:)?CssParameter>)`,
      'i'
    );
    next = next.replace(re, (whole, open: string, body: string, close: string) => {
      if (String(body).includes('<')) return whole;
      return `${open}${value}${close}`;
    });
  };
  if (props.strokeColor?.trim()) patchPlain('stroke', props.strokeColor.trim());
  if (props.fillColor?.trim()) patchPlain('fill', props.fillColor.trim());
  if (props.strokeWidth != null && Number.isFinite(props.strokeWidth)) {
    patchPlain('stroke-width', String(props.strokeWidth));
  }
  if (props.strokeOpacity != null && Number.isFinite(props.strokeOpacity)) {
    patchPlain('stroke-opacity', String(props.strokeOpacity));
  }
  if (props.opacity != null && Number.isFinite(props.opacity)) {
    patchPlain('fill-opacity', String(props.opacity));
  }
  if (props.markSize != null && Number.isFinite(props.markSize)) {
    next = next.replace(
      /(<(?:[\w]+:)?Size>)\s*[0-9.]+\s*(<\/(?:[\w]+:)?Size>)/i,
      `$1${props.markSize}$2`
    );
  }
  return next;
}

/**
 * 대표 규칙의 env·CssParameter·심볼을 화면 값으로 맞춘다.
 * 선색 env는 문서 전체(화살표 규칙 포함)에서 같은 이름으로 바뀐다.
 */
export function patchSldEnvDefaults(sld: string, styleName: string, props: StyleProps): string | null {
  const found = findPrimaryStyleRule(sld, styleName);
  if (!found) return null;
  // env 키는 문서 전체(화살표 공유) + 대표 규칙
  const keys = new Set([...sldEnvDefaults(sld).keys(), ...sldEnvDefaults(found.rule).keys()]);
  const updates = envUpdatesForStyle(styleName, props, keys);
  let patchedRule = patchSldRuleGraphicSymbol(found.rule, props.symbolUrl);
  patchedRule = patchSldRuleCssParams(patchedRule, props);
  const ruleChanged = patchedRule !== found.rule;

  let next = sld;
  if (ruleChanged) {
    const idx = sld.indexOf(found.rule);
    if (idx < 0) return null;
    next = sld.slice(0, idx) + patchedRule + sld.slice(idx + found.rule.length);
  }

  if (updates.size === 0) return formatSldXml(next);

  const patched = next.replace(sldEnvPairPattern(), (whole, key: string, current: string) => {
    const envNext = updates.get(String(key).trim());
    const prev = String(current).trim();
    if (envNext == null || envNext === prev) return whole;
    const escaped = prev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return whole.replace(
      new RegExp(`(<ogc:Literal>|<Literal>)\\s*${escaped}\\s*(</ogc:Literal>|</Literal>)`),
      `$1${envNext}$2`
    );
  });
  return formatSldXml(patched);
}

/**
 * GeoServer CSS→SLD 변환이 붙이는 ruleEvaluation VendorOption만 제거.
 * conflictResolution·followLine 등 다른 VendorOption은 그대로 둔다.
 */
export function stripSldRuleEvaluationVendorOption(sld: string): string {
  const raw = String(sld ?? '');
  if (!raw) return raw;
  return raw
    .replace(
      /\s*<\s*(?:[\w]+:)?VendorOption\b[^>]*\bname\s*=\s*["']ruleEvaluation["'][^>]*>[\s\S]*?<\/(?:[\w]+:)?VendorOption\s*>/gi,
      ''
    )
    .replace(
      /\s*<\s*(?:[\w]+:)?VendorOption\b[^>]*\bname\s*=\s*["']ruleEvaluation["'][^>]*\/\s*>/gi,
      ''
    );
}

/** 한 줄 SLD를 기존 스타일 파일과 같이 두 칸 들여쓰기로 펼친다. 글자만 있는 태그는 한 줄로 둔다. */
export function formatSldXml(xml: string): string {
  const trimmed = xml.trim();
  if (!trimmed) return '';
  if (trimmed.includes('\n')) return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  return layoutSldXml(trimmed.replace(/>\s+</g, '><'));
}

function layoutSldXml(compact: string): string {
  const parts = compact.match(/<\?[^?]*\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [compact];
  const lines: string[] = [];
  let indent = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    if (part.startsWith('<?') || part.startsWith('<!')) {
      lines.push(part.trim());
      continue;
    }
    if (part.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      lines.push(`${'  '.repeat(indent)}${part.trim()}`);
      continue;
    }
    if (part.startsWith('<')) {
      const selfClosing = /\/>$/.test(part.trim());
      lines.push(`${'  '.repeat(indent)}${part.trim()}`);
      if (!selfClosing) indent += 1;
      continue;
    }
    lines.push(`${'  '.repeat(indent)}${part.trim()}`);
  }
  const collapsed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = collapsed[collapsed.length - 1];
    const cur = lines[i];
    const next = lines[i + 1];
    if (prev && next && !cur.trim().startsWith('<') && next.trim().startsWith('</')) {
      const openName = prev.trim().match(/^<([A-Za-z0-9:._-]+)/)?.[1];
      const closeName = next.trim().match(/^<\/([A-Za-z0-9:._-]+)/)?.[1];
      if (openName && openName === closeName && !prev.trim().endsWith('/>')) {
        collapsed[collapsed.length - 1] = `${prev.trimEnd()}${cur.trim()}${next.trim()}`;
        i += 1;
        continue;
      }
    }
    collapsed.push(cur);
  }
  return `${collapsed.join('\n')}\n`;
}
