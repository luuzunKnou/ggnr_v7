/**
 * GeoServer data_dir CSS에서 면 색(fill)·선 색(stroke) 읽기 — 목록 범례·ThreeJs 관로 색용.
 * GetLegendGraphic 동시 요청 실패·투명도 희석과 무관하게 안정적으로 표시.
 */
import fs from 'node:fs';
import path from 'node:path';

function stylesDir(): string {
  return path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');
}

function readCssFile(styleName: string): string | null {
  const name = styleName.trim().toLowerCase();
  if (!name || !/^[a-z0-9_]+$/.test(name)) return null;
  const cssPath = path.join(stylesDir(), `${name}.css`);
  if (!fs.existsSync(cssPath)) return null;
  try {
    return fs.readFileSync(cssPath, 'utf8');
  } catch {
    return null;
  }
}

/** `fill: #RRGGBB;` 첫 값. 없으면 null */
export function readGeoServerCssFillColor(styleName: string): string | null {
  const css = readCssFile(styleName);
  if (!css) return null;
  const m = css.match(/(?:^|[\s{;])fill\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/);
  return m?.[1] ?? null;
}

/**
 * 선 스타일 `stroke: #halo, #main;` — 본선색(마지막 비흰색, 없으면 마지막 hex).
 * 관로 CSS 이중 스트로크(흰 테두리 + 본색) 관례에 맞춤.
 */
export function readGeoServerCssStrokeColor(styleName: string): string | null {
  const css = readCssFile(styleName);
  if (!css) return null;
  const m = css.match(/(?:^|[\s{;])stroke\s*:\s*([^;]+);/i);
  if (!m?.[1]) return null;
  const hexes = [...m[1].matchAll(/#[0-9A-Fa-f]{3,8}/g)].map((x) => x[0]);
  if (!hexes.length) return null;
  const isWhite = (h: string) => {
    const s = h.length === 4
      ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
      : h;
    return /^#ffffff$/i.test(s);
  };
  for (let i = hexes.length - 1; i >= 0; i--) {
    if (!isWhite(hexes[i])) return hexes[i];
  }
  return hexes[hexes.length - 1] ?? null;
}

/**
 * wtl_pipe_lm 용도코드 → GeoServer 스타일명 (관망조회 분할과 동일).
 * SAA003→saa003, SAA004→saa004, 그 외→etc, 최후→wtl_pipe_lm
 */
export function resolveWtlPipeLmStyleName(saaCde?: string | null): string {
  const code = String(saaCde ?? '')
    .trim()
    .toUpperCase();
  if (code === 'SAA003') return 'wtl_pipe_lm_saa003';
  if (code === 'SAA004') return 'wtl_pipe_lm_saa004';
  if (code) return 'wtl_pipe_lm_etc';
  return 'wtl_pipe_lm';
}

/** 상수관로 스타일 stroke 색. 실패 시 기본값 */
export function readWtlPipeLmStrokeColor(
  saaCde?: string | null,
  fallback = '#F44336'
): string {
  const primary = resolveWtlPipeLmStyleName(saaCde);
  const color =
    readGeoServerCssStrokeColor(primary) ??
    readGeoServerCssStrokeColor('wtl_pipe_lm') ??
    fallback;
  return color;
}

function wwwSymbolPath(fileName: string): string {
  return path.join(
    process.cwd(),
    'geoserver_modules',
    'data_dir',
    'www',
    'symbol',
    'water',
    fileName
  );
}

function expandHex3(h: string): string {
  if (h.length === 4) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toLowerCase();
  }
  return h.toLowerCase();
}

function isNearWhite(hex: string): boolean {
  const s = expandHex3(hex);
  return /^#f{6}$/i.test(s) || /^#fff$/i.test(hex);
}

/**
 * POINT 심볼 SVG에서 본색(흰색 제외 fill).
 * `fill: #…` / `fill="#…"` 모두 수집 후 마지막 비흰색.
 */
export function readGeoServerPointSymbolFillColor(
  symbolFileBase: string
): string | null {
  const base = symbolFileBase.trim().toLowerCase().replace(/\.svg$/i, '');
  if (!base || !/^[a-z0-9_]+$/.test(base)) return null;
  const svgPath = wwwSymbolPath(`${base}.svg`);
  if (!fs.existsSync(svgPath)) return null;
  let svg: string;
  try {
    svg = fs.readFileSync(svgPath, 'utf8');
  } catch {
    return null;
  }
  const hexes: string[] = [];
  for (const m of svg.matchAll(/fill\s*[:=]\s*["']?(#[0-9A-Fa-f]{3,8})/gi)) {
    if (m[1]) hexes.push(m[1]);
  }
  if (!hexes.length) return null;
  for (let i = hexes.length - 1; i >= 0; i--) {
    if (!isNearWhite(hexes[i]!)) return expandHex3(hexes[i]!);
  }
  return expandHex3(hexes[hexes.length - 1]!);
}

/** 상수맨홀(wtl_manh_ps) 심볼 본색. 실패 시 기본값 */
export function readWtlManhPsSymbolColor(fallback = '#a42b96'): string {
  return readGeoServerPointSymbolFillColor('wtl_manh_ps') ?? fallback;
}

function readSldFile(styleName: string): string | null {
  const name = styleName.trim().toLowerCase();
  if (!name || !/^[a-z0-9_]+$/.test(name)) return null;
  const sldPath = path.join(stylesDir(), `${name}.sld`);
  if (!fs.existsSync(sldPath)) return null;
  try {
    return fs.readFileSync(sldPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * SLD env stroke 기본 Literal (예: wtl_sply_ls_stroke → 26A3D1).
 * `#` 없이 오면 붙인다.
 */
export function readGeoServerSldEnvStrokeColor(styleName: string): string | null {
  const sld = readSldFile(styleName);
  if (!sld) return null;
  const key = `${styleName.trim().toLowerCase()}_stroke`;
  const re = new RegExp(
    `<ogc:Literal>${key}<\\/ogc:Literal>\\s*<ogc:Literal>([0-9A-Fa-f]{3,8})<\\/ogc:Literal>`,
    'i'
  );
  const m = sld.match(re);
  if (!m?.[1]) return null;
  return `#${m[1]}`;
}

/** CSS stroke → SLD env stroke → null */
export function readWtlLayerLineColor(
  styleName: string,
  fallback?: string
): string {
  const color =
    readGeoServerCssStrokeColor(styleName) ??
    readGeoServerSldEnvStrokeColor(styleName) ??
    fallback ??
    '#F44336';
  return color;
}

/**
 * POINT 심볼 SVG·CSS mark fill 본색.
 * fallback이 '' 이면 실패 시 빈 문자열(호출측에서 다음 후보).
 */
export function readWtlLayerPointColor(
  styleName: string,
  fallback = '#888888'
): string {
  const color =
    readGeoServerPointSymbolFillColor(styleName) ??
    readGeoServerCssFillColor(styleName) ??
    null;
  if (color) return color;
  return fallback;
}

export function readGeoServerCssFillColors(
  styleNames: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of styleNames) {
    const key = String(raw ?? '').trim().toLowerCase();
    if (!key || out[key]) continue;
    const color = readGeoServerCssFillColor(key);
    if (color) out[key] = color;
  }
  return out;
}
