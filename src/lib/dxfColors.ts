import type { IDxf, IEntity, ILayer } from "dxf-parser";
import { getAcadColor } from "dxf-parser/dist/ParseHelpers.js";

/** TrueColor(0xRRGGBB)·ACI 정수 → CSS rgb */
function trueColorToRgbCss(n: number): string {
  const v = Math.abs(n) >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgb(${r},${g},${b})`;
}

function layerColorRgb(dxf: IDxf | null, layerName: string | undefined): number | null {
  if (!dxf?.tables?.layer?.layers || !layerName) return null;
  const layers = dxf.tables.layer.layers;
  let lay: ILayer | undefined = layers[layerName] ?? layers[layerName.toUpperCase()];
  if (!lay) {
    const k = Object.keys(layers).find((x) => x.toUpperCase() === layerName.toUpperCase());
    if (k) lay = layers[k];
  }
  if (!lay || typeof lay.color !== "number") return null;
  return lay.color;
}

/**
 * DXF 엔티티 → 선 색·면 채움·선 두께 (미리보기용 근사)
 * - colorIndex 256: BYLAYER
 */
export function resolveEntityStyle(
  ent: IEntity,
  dxf: IDxf | null
): { strokeCss: string; fillRgba: string; strokeWidth: number } {
  let rgb = 0xe2e8f0;
  const idx = ent.colorIndex;

  if (idx === 256) {
    const lc = layerColorRgb(dxf, ent.layer);
    rgb = lc != null ? lc : typeof ent.color === "number" && ent.color !== 0 ? ent.color : 0xe2e8f0;
  } else if (typeof ent.color === "number" && ent.color !== 0) {
    rgb = ent.color;
  } else if (typeof idx === "number" && idx > 0 && idx < 256) {
    rgb = getAcadColor(idx) ?? 0xffffff;
  }

  const strokeCss = trueColorToRgbCss(rgb);
  const v = Math.abs(rgb) >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const fillRgba = `rgba(${r},${g},${b},0.14)`;

  let lw = 1.1;
  const lwRaw = ent.lineweight;
  if (typeof lwRaw === "number" && lwRaw > 0 && lwRaw < 500) {
    lw = Math.min(6, Math.max(0.35, lwRaw / 40));
  }

  return { strokeCss, fillRgba, strokeWidth: lw };
}
