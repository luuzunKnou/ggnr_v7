import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codesPath = path.join(
  root,
  'src/config/defineLayer/codes/field_sd_heat_mitigation_facility__stdg_cd.json'
);
const cssPath = path.join(root, 'geoserver_modules/data_dir/styles/sd_heat_mitigation_facility.css');
const sldPath = path.join(root, 'geoserver_modules/data_dir/styles/sd_heat_mitigation_facility.sld');

const codes = JSON.parse(fs.readFileSync(codesPath, 'utf8'));

/** XML 숫자 참조 — GeoServer·Windows 인코딩 무관 */
function toXmlHexEntities(s) {
  return [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp > 127) return `&#x${cp.toString(16).toUpperCase()};`;
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      return ch;
    })
    .join('');
}

/** CSS·ECQL 유니코드 이스케이프 — 파일에 한글 원문 없음 */
function toCssUnicodeEscapes(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${hi.toString(16).toUpperCase()}\\u${lo.toString(16).toUpperCase()}`;
    } else if (cp > 127) {
      out += `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    } else if (ch === '\\') {
      out += '\\\\';
    } else if (ch === "'") {
      out += "\\'";
    } else {
      out += ch;
    }
  }
  return out;
}

const labelFontCss = [
  '  font-size: 14;',
  '  font-fill: #FF9800;',
  '  font-weight: bold;',
  '  font-family: "Noto Sans KR", "Malgun Gothic", "Nanum Gothic", "Pretendard", "SansSerif";',
  '  halo-radius: 2;',
  '  halo-color: #FFFFFF;',
  '  label-anchor: 0.5 1.0;',
  '  label-offset: 0 -16;',
  '  z-index: 1;',
];

function textSymbolizerSld(labelInner) {
  return `          <sld:TextSymbolizer>
            <sld:Label>
${labelInner}
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Noto Sans KR</sld:CssParameter>
              <sld:CssParameter name="font-size">14</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>1.0</sld:AnchorPointY>
                </sld:AnchorPoint>
                <sld:Displacement>
                  <sld:DisplacementX>0</sld:DisplacementX>
                  <sld:DisplacementY>-16</sld:DisplacementY>
                </sld:Displacement>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>2</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#FF9800</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>`;
}

function stdgFilterSld(code) {
  const num = Number(code);
  if (Number.isFinite(num) && String(num) === code) {
    return `          <ogc:Filter>
            <ogc:Or>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>stdg_cd</ogc:PropertyName>
                <ogc:Literal>${code}</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>stdg_cd</ogc:PropertyName>
                <ogc:Literal>${num}</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:Or>
          </ogc:Filter>`;
  }
  return `          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>stdg_cd</ogc:PropertyName>
              <ogc:Literal>${code}</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>`;
}

// --- CSS (unicode escape) ---
const cssLines = [
  '* {',
  '  mark: url("sd_heat_mitigation_facility.svg");',
  '  mark-mime: "image/svg+xml";',
  "  mark-size: [min(18, 5 + sqrt(100000 / env('wms_scale_denominator', 10000)) * 4.0)];",
  '  mark-anchor: 0.5 0.5;',
  '  mark-offset: 0 0;',
  '  z-index: 0;',
  '}',
  '',
];

for (const c of codes) {
  const code = String(c.define_code_name ?? '').trim();
  const name = String(c.define_code_kor_name ?? '').trim();
  if (!code || !name) continue;
  const num = Number(code);
  const selector =
    Number.isFinite(num) && String(num) === code
      ? `[stdg_cd = '${code}'], [stdg_cd = ${code}]`
      : `[stdg_cd = '${code}']`;
  const prefix = toCssUnicodeEscapes(`${name} - `);
  cssLines.push(`${selector} {`);
  cssLines.push(`  label: [strConcat('${prefix}', mng_no)];`);
  cssLines.push(...labelFontCss);
  cssLines.push('}');
  cssLines.push('');
}

cssLines.push('* {');
cssLines.push('  label: [mng_no];');
cssLines.push(...labelFontCss);
cssLines.push('}');
cssLines.push('');

fs.writeFileSync(cssPath, cssLines.join('\n'), 'ascii');

// --- SLD (XML numeric entities) ---
const sldRules = [];

for (const c of codes) {
  const code = String(c.define_code_name ?? '').trim();
  const name = String(c.define_code_kor_name ?? '').trim();
  if (!code || !name) continue;
  const prefix = toXmlHexEntities(`${name} - `);
  sldRules.push(`        <sld:Rule>
${stdgFilterSld(code)}
${textSymbolizerSld(`              <ogc:Function name="strConcat">
                <ogc:Literal>${prefix}</ogc:Literal>
                <ogc:PropertyName>mng_no</ogc:PropertyName>
              </ogc:Function>`)}
        </sld:Rule>`);
}

sldRules.push(`        <sld:Rule>
${textSymbolizerSld('              <ogc:PropertyName>mng_no</ogc:PropertyName>')}
        </sld:Rule>`);

const sld = `<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="sd_heat_mitigation_facility.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="min">
                  <ogc:Literal>18</ogc:Literal>
                  <ogc:Add>
                    <ogc:Literal>5</ogc:Literal>
                    <ogc:Mul>
                      <ogc:Function name="sqrt">
                        <ogc:Div>
                          <ogc:Literal>100000</ogc:Literal>
                          <ogc:Function name="env">
                            <ogc:Literal>wms_scale_denominator</ogc:Literal>
                            <ogc:Literal>10000</ogc:Literal>
                          </ogc:Function>
                        </ogc:Div>
                      </ogc:Function>
                      <ogc:Literal>4.0</ogc:Literal>
                    </ogc:Mul>
                  </ogc:Add>
                </ogc:Function>
              </sld:Size>
              <sld:AnchorPoint>
                <sld:AnchorPointX>0.5</sld:AnchorPointX>
                <sld:AnchorPointY>0.5</sld:AnchorPointY>
              </sld:AnchorPoint>
              <sld:Displacement>
                <sld:DisplacementX>0</sld:DisplacementX>
                <sld:DisplacementY>0</sld:DisplacementY>
              </sld:Displacement>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
      <sld:FeatureTypeStyle>
${sldRules.join('\n')}
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>
`;

fs.writeFileSync(sldPath, sld, 'utf8');
console.log(`Wrote ${cssPath} (unicode escape, ASCII)`);
console.log(`Wrote ${sldPath} (${codes.length} stdg_cd rules + fallback, XML entities)`);
