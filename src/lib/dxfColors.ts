import type { IDxf, IEntity, ILayer } from "dxf-parser";
import { getAcadColor } from "dxf-parser/dist/ParseHelpers.js";

/** TrueColor(0xRRGGBB)·이미 변환된 RGB 정수 → CSS rgb */
function trueColorToRgbCss(n: number): string {
  const v = Math.abs(n) >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgb(${r},${g},${b})`;
}

type LayerRgb = { rgb: number; colorIndex?: number };

function layerColorRgb(dxf: IDxf | null, layerName: string | undefined): LayerRgb | null {
  if (!dxf?.tables?.layer?.layers || !layerName) return null;
  const layers = dxf.tables.layer.layers;
  let lay: ILayer | undefined = layers[layerName] ?? layers[layerName.toUpperCase()];
  if (!lay) {
    const k = Object.keys(layers).find((x) => x.toUpperCase() === layerName.toUpperCase());
    if (k) lay = layers[k];
  }
  if (!lay) return null;
  const colorIndex = (lay as { colorIndex?: number }).colorIndex;
  // dxf-parser: layer.color 는 ACI→RGB. 0(검정)도 유효
  if (typeof lay.color === "number" && Number.isFinite(lay.color)) {
    return { rgb: lay.color >>> 0, colorIndex };
  }
  if (typeof colorIndex === "number" && colorIndex > 0 && colorIndex < 256) {
    const rgb = getAcadColor(colorIndex);
    return typeof rgb === "number" ? { rgb: rgb >>> 0, colorIndex } : null;
  }
  return null;
}

/**
 * CAD 어두운 배경용 ACI 7(흰/검 겸용) · 순백 → 밝은 지도에서는 검정으로.
 */
function adaptCadColorForLightMap(rgb: number, colorIndex?: number): number {
  const absIdx = colorIndex != null ? Math.abs(colorIndex) : undefined;
  if (absIdx === 7) return 0x000000;
  const v = rgb >>> 0;
  if (v === 0xffffff) return 0x000000;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  if (r >= 250 && g >= 250 && b >= 250) return 0x000000;
  return v;
}

/**
 * DXF 엔티티 → 선 색·면 채움·선 두께 (미리보기용 근사)
 *
 * - BYLAYER/BYBLOCK → 레이어 색
 * - ACI 7·순백은 밝은 지도용 검정
 * - 기본 면 채움 투명 (닫힌 선 배경색 방지). SOLID만 연한 채움
 */
export function resolveEntityStyle(
  ent: IEntity,
  dxf: IDxf | null
): { strokeCss: string; fillRgba: string; strokeWidth: number } {
  const DEFAULT_RGB = 0x1e293b;
  const idx = ent.colorIndex;
  const inherits =
    idx === undefined || idx === null || Number.isNaN(idx) || idx === 256 || idx === 0;

  let rgb: number | null = null;
  let resolvedIndex: number | undefined =
    typeof idx === "number" && Math.abs(idx) > 0 && Math.abs(idx) < 256 ? Math.abs(idx) : undefined;

  if (!inherits) {
    if (typeof ent.color === "number" && Number.isFinite(ent.color)) {
      rgb = ent.color >>> 0;
    } else if (typeof idx === "number" && idx > 0 && idx < 256) {
      const fromAci = getAcadColor(idx);
      if (typeof fromAci === "number") rgb = fromAci >>> 0;
    }
  }

  if (rgb == null) {
    const lc = layerColorRgb(dxf, ent.layer);
    if (lc != null) {
      rgb = lc.rgb;
      if (resolvedIndex == null && lc.colorIndex != null) {
        resolvedIndex = Math.abs(lc.colorIndex);
      }
    }
  }

  if (
    rgb == null &&
    typeof ent.color === "number" &&
    Number.isFinite(ent.color) &&
    idx !== 256 &&
    idx !== 0
  ) {
    rgb = ent.color >>> 0;
  }

  if (rgb == null) rgb = DEFAULT_RGB;
  rgb = adaptCadColorForLightMap(rgb, resolvedIndex);

  const strokeCss = trueColorToRgbCss(rgb);
  const v = rgb >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const fillRgba = ent.type === "SOLID" ? `rgba(${r},${g},${b},0.35)` : "rgba(0,0,0,0)";

  let lw = 1.1;
  const lwRaw = ent.lineweight;
  if (typeof lwRaw === "number" && lwRaw > 0 && lwRaw < 500) {
    lw = Math.min(6, Math.max(0.35, lwRaw / 40));
  }

  return { strokeCss, fillRgba, strokeWidth: lw };
}
