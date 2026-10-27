import fs from 'node:fs';
import path from 'node:path';

const STYLES_DIR = path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');

function readStyleSld(styleName: string): string | null {
  const file = path.join(STYLES_DIR, `${styleName}.sld`);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function ruleBlocks(sld: string): string[] {
  return [...sld.matchAll(/<(?:sld:)?Rule>([\s\S]*?)<\/(?:sld:)?Rule>/gi)].map((m) => m[1] ?? '');
}

/** 라벨·화살표만 있는 규칙은 썸네일에서 글자로 보이므로 제외 */
function isAnnotationOnlyRule(rule: string): boolean {
  const title = (rule.match(/<(?:sld:)?Title>([^<]*)<\/(?:sld:)?Title>/i)?.[1] ?? '').toLowerCase();
  const name = (rule.match(/<(?:sld:)?Name>([^<]*)<\/(?:sld:)?Name>/i)?.[1] ?? '').toLowerCase();
  return title.endsWith('_label') || title.endsWith('_arrow') || name === 'flow_arrow' || name.endsWith('_arrow');
}

function isArrowSymbolizer(symbolizer: string): boolean {
  return /PointSymbolizer/i.test(symbolizer) && /shape:\/\/oarrow|shape:\/\/arrow/i.test(symbolizer);
}

/** 같은 규칙의 화살표 점은 건너뛰고 선·면·점만 고른다 */
function firstGraphicSymbolizer(rule: string): string | null {
  const re =
    /<(?:sld:)?(?:LineSymbolizer|PolygonSymbolizer|PointSymbolizer)\b[\s\S]*?<\/(?:sld:)?(?:LineSymbolizer|PolygonSymbolizer|PointSymbolizer)>/gi;
  for (const match of rule.matchAll(re)) {
    const block = match[0];
    if (isArrowSymbolizer(block)) continue;
    return block;
  }
  return null;
}

function resolveEnvLiterals(xml: string): string {
  let out = xml.replace(
    /<(?:ogc:)?Function name="strConcat">\s*<(?:ogc:)?Literal>#<\/(?:ogc:)?Literal>\s*<(?:ogc:)?Function name="env">\s*<(?:ogc:)?Literal>[^<]*<\/(?:ogc:)?Literal>\s*<(?:ogc:)?Literal>([^<]*)<\/(?:ogc:)?Literal>\s*<\/(?:ogc:)?Function>\s*<\/(?:ogc:)?Function>/gi,
    '#$1'
  );
  out = out.replace(
    /<(?:ogc:)?Function name="env">\s*<(?:ogc:)?Literal>[^<]*<\/(?:ogc:)?Literal>\s*<(?:ogc:)?Literal>([^<]*)<\/(?:ogc:)?Literal>\s*<\/(?:ogc:)?Function>/gi,
    '$1'
  );
  return out;
}

function flattenFunctionParams(xml: string): string {
  return xml.replace(
    /(<(?:sld:)?CssParameter name="(?:stroke-width|stroke-opacity|fill-opacity)">)([\s\S]*?)(<\/(?:sld:)?CssParameter>)/gi,
    (all, open, body, close) => {
      if (!String(body).includes('Function')) return all;
      const name = String(open);
      const value = name.includes('stroke-width') ? '2' : '1';
      return `${open}${value}${close}`;
    }
  );
}

function withLegendPointSize(symbolizer: string): string {
  if (!/PointSymbolizer/i.test(symbolizer)) return symbolizer;
  const sizeBody = symbolizer.match(/<(?:sld:)?Size>([\s\S]*?)<\/(?:sld:)?Size>/i)?.[1];
  if (!sizeBody || !/Function/i.test(sizeBody)) return symbolizer;
  const pixels = [...sizeBody.matchAll(/<(?:ogc:)?Literal>\s*(-?\d+(?:\.\d+)?)\s*<\/(?:ogc:)?Literal>/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 8 && n <= 48);
  const size = pixels.length ? String(Math.round(Math.max(...pixels))) : '18';
  return symbolizer.replace(/<(?:sld:)?Size>[\s\S]*?<\/(?:sld:)?Size>/i, `<Size>${size}</Size>`);
}

function rewriteGraphicHref(symbolizer: string, geoserverBase: string): string {
  const root = geoserverBase.replace(/\/$/, '');
  if (!root) return symbolizer;
  return symbolizer.replace(/xlink:href="\/(?!\/)/g, `xlink:href="${root}/`);
}

function stripGeometry(xml: string): string {
  return xml.replace(/<(?:sld:)?Geometry>[\s\S]*?<\/(?:sld:)?Geometry>/gi, '');
}

function wrapSymbolizer(layerName: string, symbolizer: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer>
    <Name>${layerName}</Name>
    <UserStyle>
      <FeatureTypeStyle>
        <Rule>${symbolizer}</Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`;
}

/**
 * 규칙이 여러 개이거나 라벨·화살표가 섞여 있으면 첫 선/면/점만 남긴 SLD.
 * 도형만 있는 규칙 하나면 null (원본 스타일 범례를 그대로 쓴다).
 */
export function buildPrimaryLegendSld(
  styleName: string,
  layerName: string,
  geoserverBase?: string
): string | null {
  const raw = readStyleSld(styleName);
  if (!raw) return null;
  const rules = ruleBlocks(raw);
  if (rules.length === 0) return null;
  const graphic = rules.filter((rule) => !isAnnotationOnlyRule(rule));
  const symbolizer = graphic.map(firstGraphicSymbolizer).find((item) => item != null);
  if (!symbolizer) return null;
  const mixed =
    rules.length > 1 ||
    rules.some((rule) => /TextSymbolizer/i.test(rule) || /shape:\/\/oarrow|shape:\/\/arrow/i.test(rule));
  if (!mixed) return null;
  const simple = stripGeometry(
    flattenFunctionParams(resolveEnvLiterals(rewriteGraphicHref(withLegendPointSize(symbolizer), geoserverBase ?? '')))
  );
  return wrapSymbolizer(layerName, simple);
}
