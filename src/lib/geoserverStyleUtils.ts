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
};

const DEFAULT_PROPS: StyleProps = {
  fillColor: '#808080',
  strokeColor: '#000000',
  strokeWidth: 1,
  opacity: 1,
  labelField: '',
  size: 8,
};

/**
 * Extract the first * { ... } block and parse key: value; into StyleProps.
 * Infers geometry type from presence of mark/fill/stroke.
 */
export function parseSimpleStyleFromCss(cssText: string): {
  styleProps: StyleProps;
  geometryType: GeometryType;
} {
  const styleProps: StyleProps = { ...DEFAULT_PROPS };

  const starBlockMatch = cssText.match(/\*\s*\{([\s\S]*?)\}/);
  const block = starBlockMatch ? starBlockMatch[1] : '';

  const parseOne = (key: string, value: string) => {
    const v = value.trim();
    if (key === 'fill') styleProps.fillColor = v;
    else if (key === 'stroke') styleProps.strokeColor = v;
    else if (key === 'stroke-width') styleProps.strokeWidth = parseFloat(v) || 1;
    else if (key === 'stroke-opacity' || key === 'fill-opacity') styleProps.opacity = parseFloat(v);
    else if (key === 'font-size' || key === 'mark-size') styleProps.size = parseFloat(v) || 8;
    else if (key === 'label') {
      const m = v.match(/\[\s*([^\]]+)\s*\]/);
      if (m) styleProps.labelField = m[1].trim();
    }
  };

  block.split(';').forEach((part) => {
    const colon = part.indexOf(':');
    if (colon === -1) return;
    const key = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '-');
    const value = part.slice(colon + 1).trim();
    parseOne(key, value);
  });

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
    lines.push(`  fill: ${f};`);
    lines.push(`  stroke: ${s};`);
    lines.push(`  stroke-width: ${sw};`);
    lines.push(`  stroke-opacity: ${op};`);
    lines.push(`  fill-opacity: ${op};`);
    lines.push(`  mark-size: ${size};`);
    if (label) {
      lines.push(`  label: [${label}];`);
      lines.push(`  font-size: ${size};`);
      lines.push('  font-fill: #000000;');
      lines.push('  halo-radius: 1;');
      lines.push('  halo-color: #FFFFFF;');
    }
  } else if (geometryType === 'LINE') {
    lines.push(`  stroke: ${s};`);
    lines.push(`  stroke-width: ${sw};`);
    lines.push(`  stroke-opacity: ${op};`);
    if (label) {
      lines.push(`  label: [${label}];`);
      lines.push(`  font-size: ${size};`);
      lines.push('  font-fill: #000000;');
      lines.push('  halo-radius: 1;');
      lines.push('  halo-color: #FFFFFF;');
    }
  } else {
    // POLYGON
    lines.push(`  fill: ${f};`);
    lines.push(`  stroke: ${s};`);
    lines.push(`  stroke-width: ${sw};`);
    lines.push(`  fill-opacity: ${op};`);
    lines.push(`  stroke-opacity: ${op};`);
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
  const match = cssText.match(/\*\s*\{[\s\S]*?\}/);
  if (!match) return newStarBlock + (cssText.trim() ? '\n\n' + cssText : '');
  const idx = match.index!;
  const end = idx + match[0].length;
  const before = cssText.slice(0, idx);
  const after = cssText.slice(end).trim();
  return (before + newStarBlock + (after ? '\n\n' + after : '')).trim();
}
