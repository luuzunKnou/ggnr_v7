/**
 * GeoServer CSS simple style parse/build for POINT, LINE, POLYGON.
 */

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
  opacity?: number;
  labelField?: string;
  size?: number; // POINT: mark-size / font-size
  /** POINT + 외부 심볼: 아이콘 URL (있으면 심볼 있는 버전 CSS 생성) */
  symbolUrl?: string;
};

const DEFAULT_PROPS: StyleProps = {
  fillColor: '#808080',
  strokeColor: '#000000',
  strokeWidth: 1,
  opacity: 0.3,
  labelField: '',
  size: 8,
};

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

function extractOuterStarBlock(cssText: string): string {
  const range = findOuterStarBlockRange(cssText);
  if (!range) return '';
  return cssText.slice(range.braceStart + 1, range.braceEnd);
}

/**
 * Extract the first * { ... } block and parse key: value; into StyleProps.
 * Infers geometry type from presence of mark/fill/stroke.
 */
export function parseSimpleStyleFromCss(cssText: string): {
  styleProps: StyleProps;
  geometryType: GeometryType;
} {
  const styleProps: StyleProps = { ...DEFAULT_PROPS };

  const block = extractOuterStarBlock(cssText);

  const parseOne = (key: string, value: string) => {
    const v = value.trim();
    if (key === 'fill') styleProps.fillColor = v;
    else if (key === 'stroke') {
      // LINE 스타일은 "#FFFFFF, 실제색상" 형태(흰 테두리+메인색)로 저장되므로 마지막 값만 취함
      const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
      styleProps.strokeColor = parts.length > 1 ? parts[parts.length - 1] : v;
    }
    else if (key === 'stroke-width') styleProps.strokeWidth = parseFloat(v) || 1;
    // "투명도" 입력은 fill-opacity만 반영 (stroke-opacity는 폴리곤에서 항상 1.0으로 고정되는 별개 값)
    else if (key === 'fill-opacity') styleProps.opacity = parseFloat(v);
    else if (key === 'font-size' || key === 'mark-size') styleProps.size = parseFloat(v) || 8;
    else if (key === 'label') {
      const m = v.match(/\[\s*([^\]]+)\s*\]/);
      if (m) styleProps.labelField = m[1].trim();
    }
  };

  // ":mark { fill: ...; }" 처럼 중첩된 하위 셀렉터의 속성도 그대로 잡아내도록
  // 블록 전체에서 "key: value;" 패턴을 전역으로 훑는다 (중첩 depth 무시하고 평탄화).
  const propRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = propRe.exec(block))) {
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    parseOne(key, value);
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
 * Build a single * { } CSS block from geometry type and style props.
 */
export function buildCssFromSimpleStyle(
  geometryType: GeometryType,
  styleProps: StyleProps
): string {
  const f = styleProps.fillColor ?? DEFAULT_PROPS.fillColor;
  const s = styleProps.strokeColor ?? DEFAULT_PROPS.strokeColor;
  const sw = styleProps.strokeWidth ?? DEFAULT_PROPS.strokeWidth;
  const op = styleProps.opacity ?? DEFAULT_PROPS.opacity;
  const label = styleProps.labelField?.trim();
  const size = styleProps.size ?? DEFAULT_PROPS.size ?? 8;

  const lines: string[] = [];

  if (geometryType === 'POINT') {
    const symbolUrl = styleProps.symbolUrl?.trim();
    if (symbolUrl) {
      // Point - 심볼이 있을 때
      const mime = symbolUrl.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      lines.push(`  mark: url("${symbolUrl}");`);
      lines.push(`  mark-mime: "${mime}";`);
      lines.push(`  mark-size: [min(18, 5 + sqrt(100000 / env('wms_scale_denominator', 10000)) * 4.0)];`);
    } else {
      // Point - 심볼이 없을 때
      lines.push(`  mark: symbol(circle);`);
      lines.push(`  mark-size: [min(18, 5 + sqrt(100000 / env('wms_scale_denominator', 10000)) * 1.5)];`);
      lines.push(`  :mark {`);
      lines.push(`    fill: ${f};`);
      lines.push(`    stroke: ${s};`);
      lines.push(`    stroke-width: ${sw};`);
      lines.push(`    stroke-opacity: 0.5;`);
      lines.push(`    fill-opacity: 0.5;`);
      lines.push(`  }`);
    }
    if (label) {
      lines.push(`  label: [${label}];`);
      lines.push(`  font-size: ${size};`);
      lines.push('  font-fill: #000000;');
      lines.push('  halo-radius: 1;');
      lines.push('  halo-color: #FFFFFF;');
    }
  } else if (geometryType === 'LINE') {
    // Line: 테두리 흰색(3px) + 메인 색(2px)
    lines.push(`  stroke: #FFFFFF, ${s};`);
    lines.push(`  stroke-width: 3, 2;`);
    lines.push(`  stroke-opacity: 0.4, 0.5;`);
    if (label) {
      lines.push(`  label: [${label}];`);
      lines.push(`  font-size: ${size};`);
      lines.push('  font-fill: #000000;');
      lines.push('  halo-radius: 1;');
      lines.push('  halo-color: #FFFFFF;');
    }
  } else {
    // POLYGON — 테두리는 항상 불투명, 면만 fill-opacity로 조절
    lines.push(`  fill: ${f};`);
    lines.push(`  stroke: ${s};`);
    lines.push(`  stroke-width: ${sw};`);
    lines.push(`  fill-opacity: ${op};`);
    lines.push(`  stroke-opacity: 1.0;`);
    if (label) {
      lines.push(`  label: [${label}];`);
      lines.push(`  font-size: ${size};`);
      lines.push('  font-fill: #000000;');
      lines.push('  halo-radius: 1;');
      lines.push('  halo-color: #FFFFFF;');
    }
  }

  return `* {\n${lines.join('\n')}\n}`;
}

/**
 * Replace the first * { ... } block in cssText with newStarBlock; keep the rest.
 */
export function replaceDefaultRuleInCss(cssText: string, newStarBlock: string): string {
  const range = findOuterStarBlockRange(cssText);
  if (!range) return newStarBlock + (cssText.trim() ? '\n\n' + cssText : '');
  const starIdx = cssText.lastIndexOf('*', range.braceStart);
  const idx = starIdx === -1 ? range.braceStart : starIdx;
  const end = range.braceEnd + 1;
  const before = cssText.slice(0, idx);
  const after = cssText.slice(end).trim();
  return (before + newStarBlock + (after ? '\n\n' + after : '')).trim();
}
