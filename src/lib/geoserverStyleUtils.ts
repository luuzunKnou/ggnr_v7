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
    // "투명도" 입력은 fill-opacity만 반영 (stroke-opacity는 폴리곤에서 항상 1.0으로 고정되는 별개 값)
    else if (key === 'fill-opacity') target.opacity = parseFloat(v);
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
      if (urlMatch) target.symbolUrl = urlMatch[1].trim();
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
  const label = styleProps.labelField?.trim();
  const fontSize = styleProps.size ?? DEFAULT_PROPS.size ?? LABEL_STYLE_DEFAULTS.fontSize;

  const geomLines: string[] = [];

  if (geometryType === 'POINT') {
    const symbolUrl = styleProps.symbolUrl?.trim();
    if (symbolUrl) {
      // Point - 심볼이 있을 때
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
      geomLines.push(`    stroke-opacity: 0.5;`);
      geomLines.push(`    fill-opacity: 0.5;`);
      geomLines.push(`  };`);
    }
  } else if (geometryType === 'LINE') {
    // Line: 테두리 흰색(3px) + 메인 색(2px)
    geomLines.push(`  stroke: #FFFFFF, ${s};`);
    geomLines.push(`  stroke-width: 3, 2;`);
    geomLines.push(`  stroke-opacity: 0.4, 0.5;`);
  } else {
    // POLYGON — 테두리는 항상 불투명, 면만 fill-opacity로 조절
    geomLines.push(`  fill: ${f};`);
    geomLines.push(`  stroke: ${s};`);
    geomLines.push(`  stroke-width: ${sw};`);
    geomLines.push(`  fill-opacity: ${op};`);
    geomLines.push(`  stroke-opacity: 1.0;`);
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

/** GeoServer www 주소 또는 파일명 → Next public/symbol 미리보기 경로 */
export function toPublicSymbolPreviewUrl(symbolUrlOrName: string): string | null {
  const raw = String(symbolUrlOrName ?? '').trim();
  if (!raw) return null;
  const file = raw.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  const m = file.match(/^(.+)\.(svg|png)$/i);
  if (m) return `/symbol/${m[1]}.${m[2].toLowerCase()}`;
  if (/^[a-zA-Z0-9._-]+$/.test(raw)) return `/symbol/${raw}.svg`;
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
