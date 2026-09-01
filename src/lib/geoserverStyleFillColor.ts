/**
 * GeoServer data_dir CSS에서 면 색(fill) 읽기 — 목록 범례 고정 색용.
 * GetLegendGraphic 동시 요청 실패·투명도 희석과 무관하게 안정적으로 표시.
 */
import fs from 'node:fs';
import path from 'node:path';

function stylesDir(): string {
  return path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');
}

/** `fill: #RRGGBB;` 첫 값. 없으면 null */
export function readGeoServerCssFillColor(styleName: string): string | null {
  const name = styleName.trim().toLowerCase();
  if (!name || !/^[a-z0-9_]+$/.test(name)) return null;
  const cssPath = path.join(stylesDir(), `${name}.css`);
  if (!fs.existsSync(cssPath)) return null;
  try {
    const css = fs.readFileSync(cssPath, 'utf8');
    const m = css.match(/(?:^|[\s{;])fill\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
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
