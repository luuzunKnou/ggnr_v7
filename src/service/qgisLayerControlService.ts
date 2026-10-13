/**
 * QGIS WFS 레이어 권한 · GeoServer 프록시
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq, isNull, or } from 'drizzle-orm';
import db from '@/database/db';
import { layerControl } from '@/database/schema/layer_control';
import { userLayerControl } from '@/database/schema/user_layer_control';
import { usr } from '@/database/schema/usr';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import { getBasePath } from '@/lib/basePath';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';
import { allowProjectLayerTable } from '@/lib/projectLayerAllowlist';

const WORKSPACE = (process.env.GEOSERVER_WORKSPACE?.trim() || 'ggnr').replace(/\/$/, '');

export type LayerPermissionRow = {
  layerName: string;
  canRead: boolean;
  canWrite: boolean;
};

function yn(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'Y';
}

function toYn(v: boolean): string {
  return v ? 'Y' : 'N';
}

function localLayerName(name: string): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  return s.includes(':') ? s.slice(s.indexOf(':') + 1).trim() : s;
}

function qualifiedLayerName(local: string): string {
  const l = localLayerName(local);
  return l ? `${WORKSPACE}:${l}` : '';
}

/** GeoServer REST/WFS-T용 Basic 인증 (layers.properties 쓰기=ADMIN 대응) */
function geoServerAuthHeader(): string {
  const user = process.env.GEOSERVER_USER ?? 'admin';
  const pass = process.env.GEOSERVER_PASSWORD ?? 'geoserver';
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

/** 레거시와 비슷한 짧은 접속 키 (12자) */
function newQgisKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i]! % alphabet.length]!;
  }
  return out;
}

function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const DEFINE_LAYER_FIELDS_DIR = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'fields'
);
const DEFINE_LAYER_TABLES_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
);

/** QGIS DescribeFeatureType에서 숨길 필드(자동증가 PK 등) */
function loadHiddenDescribeFields(layerName: string): Set<string> {
  const out = new Set<string>();
  const local = localLayerName(layerName);
  if (!local) return out;
  const safe = local.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<{
        define_field_name?: string;
        define_field_is_key?: string;
        define_field_read_only?: string;
        define_field_show_list?: string;
        define_field_show_detail?: string;
      }>;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const eng = String(row.define_field_name ?? '').trim();
          if (!eng) continue;
          const isKey = String(row.define_field_is_key ?? '').toLowerCase() === 'true';
          // 키이면서 목록·상세 모두 비표시 → QGIS에도 숨김 (auto increment PK)
          const hideUi =
            String(row.define_field_show_list ?? '') === 'false' &&
            String(row.define_field_show_detail ?? '') === 'false';
          if (isKey && hideUi) out.add(eng);
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (local === 'memo' || local.startsWith('memo_')) out.add('memo_key');
  return out;
}

/** DescribeFeatureType XSD에서 지정 필드 element 제거 */
export function stripFieldsFromDescribeFeatureType(
  xsd: string,
  hideNames: Set<string>
): string {
  if (!hideNames.size) return xsd;
  let out = xsd;
  for (const name of hideNames) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // self-closing
    out = out.replace(
      new RegExp(
        `\\s*<(?:xsd:|xs:)?element\\b([^>]*\\bname\\s*=\\s*["']${esc}["'][^>]*)\\/>`,
        'gi'
      ),
      ''
    );
    // with body
    out = out.replace(
      new RegExp(
        `\\s*<(xsd:|xs:)?element\\b([^>]*\\bname\\s*=\\s*["']${esc}["'][^>]*)>[\\s\\S]*?<\\/\\1?element>`,
        'gi'
      ),
      ''
    );
  }
  return out;
}

const SKIP_FIELD_ALIAS = new Set([
  'geom',
  'the_geom',
  'shape',
  'geometry',
  'wkb_geometry',
]);

/** XML NCName으로 쓸 수 있는 한글 필드명만 허용 */
function toXmlFieldName(kor: string): string | null {
  const t = String(kor ?? '').trim();
  if (!t) return null;
  if (/[\s<>&"'/=\\]/.test(t)) return null;
  if (/^[-.0-9]/.test(t)) return null;
  return t;
}

export type FieldAliasMaps = {
  engToKor: Map<string, string>;
  korToEng: Map<string, string>;
};

/** defineLayer 영문↔한글 필드 매핑 (QGIS 표시용) */
export function loadFieldAliasMaps(layerName: string): FieldAliasMaps {
  const engToKor = new Map<string, string>();
  const korToEng = new Map<string, string>();
  const local = localLayerName(layerName);
  if (!local) return { engToKor, korToEng };
  const safe = local.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return { engToKor, korToEng };
    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<{
      define_field_name?: string;
      define_field_kor_name?: string;
    }>;
    if (!Array.isArray(rows)) return { engToKor, korToEng };
    for (const row of rows) {
      const eng = String(row.define_field_name ?? '').trim();
      if (!eng || SKIP_FIELD_ALIAS.has(eng.toLowerCase())) continue;
      const kor = toXmlFieldName(String(row.define_field_kor_name ?? ''));
      if (!kor || kor === eng) continue;
      if (korToEng.has(kor)) continue; // 한글 중복 시 첫 필드만
      engToKor.set(eng, kor);
      korToEng.set(kor, eng);
    }
  } catch {
    /* ignore */
  }
  return { engToKor, korToEng };
}

function mergeFieldAliasMaps(layers: string[]): FieldAliasMaps {
  const engToKor = new Map<string, string>();
  const korToEng = new Map<string, string>();
  for (const layer of layers) {
    const m = loadFieldAliasMaps(layer);
    for (const [e, k] of m.engToKor) {
      if (!engToKor.has(e) && !korToEng.has(k)) {
        engToKor.set(e, k);
        korToEng.set(k, e);
      }
    }
  }
  return { engToKor, korToEng };
}

/** DescribeFeatureType: name="memo_title" → name="제목" */
export function applyKoreanFieldNamesToDescribeFeatureType(
  xsd: string,
  engToKor: Map<string, string>
): string {
  if (!engToKor.size) return xsd;
  let out = xsd;
  const entries = [...engToKor.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [eng, kor] of entries) {
    const esc = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(\\bname\\s*=\\s*["'])${esc}(["'])`, 'gi'),
      `$1${kor}$2`
    );
  }
  return out;
}

/** GML/XSD 태그명 치환 — &lt;ggnr:memo_title&gt; ↔ &lt;ggnr:제목&gt; */
export function rewriteXmlPropertyNames(xml: string, fromTo: Map<string, string>): string {
  if (!fromTo.size) return xml;
  let out = xml;
  const entries = [...fromTo.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`<([\\w.-]+:)?${esc}(\\s[^>]*)?>`, 'g'),
      `<$1${to}$2>`
    );
    out = out.replace(new RegExp(`</([\\w.-]+:)?${esc}>`, 'g'), `</$1${to}>`);
  }
  return out;
}

/**
 * Update/Filter 의 &lt;Name&gt;제목&lt;/Name&gt;, &lt;PropertyName&gt;제목&lt;/PropertyName&gt; 텍스트 값 치환
 * (레이어명 ggnr:memo 처럼 콜론 포함 값은 건드리지 않음)
 */
export function rewriteXmlNameTextValues(xml: string, fromTo: Map<string, string>): string {
  if (!fromTo.size) return xml;
  return xml.replace(
    /<(?:([\w.-]+):)?(PropertyName|Name)\b([^>]*)>\s*([^<]+?)\s*<\/(?:\1:)?\2>/gi,
    (full, ns: string | undefined, tag: string, attrs: string, value: string) => {
      const v = String(value ?? '').trim();
      if (!v || v.includes(':')) return full;
      const mapped = fromTo.get(v);
      if (!mapped) return full;
      const open = ns ? `<${ns}:${tag}${attrs || ''}>` : `<${tag}${attrs || ''}>`;
      const close = ns ? `</${ns}:${tag}>` : `</${tag}>`;
      return `${open}${mapped}${close}`;
    }
  );
}

/** PROPERTYNAME=a,b 쿼리·CSV 속성명 치환 */
export function rewriteCsvPropertyNames(value: string, fromTo: Map<string, string>): string {
  if (!fromTo.size) return value;
  return String(value)
    .split(',')
    .map((part) => {
      const t = part.trim();
      if (!t) return part;
      return fromTo.get(t) || fromTo.get(localLayerName(t)) || part;
    })
    .join(',');
}

/** GetFeature POST 등 typeName 추출 */
export function extractLayerNamesFromWfsRequestXml(body: string): string[] {
  const result: string[] = [];
  const re = /\btypeNames?\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    for (const part of String(m[1]).split(',')) {
      const local = localLayerName(part);
      if (local) result.push(local);
    }
  }
  return [...new Set(result)];
}

function loadDefineTableKorName(layerName: string): string | null {
  const local = localLayerName(layerName);
  if (!local) return null;
  try {
    if (!fs.existsSync(DEFINE_LAYER_TABLES_PATH)) return null;
    const tables = JSON.parse(fs.readFileSync(DEFINE_LAYER_TABLES_PATH, 'utf8')) as Array<{
      define_table_name?: string;
      define_table_kor_name?: string;
    }>;
    if (!Array.isArray(tables)) return null;
    const hit = tables.find(
      (t) => String(t.define_table_name ?? '').trim().toLowerCase() === local.toLowerCase()
    );
    const kor = String(hit?.define_table_kor_name ?? '').trim();
    if (kor && kor !== local) return kor;
  } catch {
    /* ignore */
  }
  if (local === 'memo') return '메모';
  return null;
}

/** GetCapabilities FeatureType Title을 한글명으로 */
function applyKoreanFeatureTypeTitles(capabilitiesXml: string): string {
  return capabilitiesXml.replace(
    /<(?:[\w.]+:)?FeatureType\b[^>]*>[\s\S]*?<\/(?:[\w.]+:)?FeatureType>/gi,
    (block) => {
      const nm = block.match(/<(?:[\w.]+:)?Name\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w.]+:)?Name>/i);
      if (!nm) return block;
      const kor = loadDefineTableKorName(nm[1].trim());
      if (!kor) return block;
      if (/<(?:[\w.]+:)?Title\b[^>]*>[\s\S]*?<\/(?:[\w.]+:)?Title>/i.test(block)) {
        return block.replace(
          /<(?:[\w.]+:)?Title\b[^>]*>[\s\S]*?<\/(?:[\w.]+:)?Title>/i,
          (t) => t.replace(/>[\s\S]*</, `>${escapeXml(kor)}<`)
        );
      }
      return block.replace(
        /(<(?:[\w.]+:)?Name\b[^>]*>\s*[^<]+?\s*<\/(?:[\w.]+:)?Name>)/i,
        `$1<Title>${escapeXml(kor)}</Title>`
      );
    }
  );
}

function ogcErrorXml(message: string, code: string, locator: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ServiceExceptionReport version="1.1.1"\n` +
    `  xmlns="http://www.opengis.net/ogc"\n` +
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <ServiceException code="${escapeXml(code)}" locator="${escapeXml(locator)}">\n` +
    `    ${escapeXml(message)}\n` +
    `  </ServiceException>\n` +
    `</ServiceExceptionReport>`
  );
}

export function buildOgcErrorBytes(message: string, code: string, locator: string): Uint8Array {
  return new TextEncoder().encode(ogcErrorXml(message, code, locator));
}

function buildTransactionDenied(
  layerName: string
): { status: number; contentType: string; body: Uint8Array } {
  // 레거시 WfsController.buildOgcErrorResponse 와 동일: HTTP 200 + ServiceExceptionReport
  // (QGIS는 403이면 본문 예외를 못 읽고 “객체를 추가할 수 없습니다”만 띄우는 경우가 많음)
  return {
    status: 200,
    contentType: 'application/xml; charset=utf-8',
    body: buildOgcErrorBytes(
      '수정 권한이 없습니다',
      'PermissionDenied',
      layerName || 'typeName'
    ),
  };
}

/** 요청 기준 앱 베이스 URL (프록시·베이스패스 포함) */
export function buildAppBaseUrl(opts: {
  proto?: string | null;
  host?: string | null;
  fallbackOrigin?: string;
}): string {
  const proto = (opts.proto || 'http').replace(/:$/, '');
  const host = (opts.host || '').trim() || 'localhost:3000';
  const basePath = getBasePath();
  return `${proto}://${host}${basePath}`;
}

export async function getControlIdByQgisKey(key: string): Promise<number | null> {
  const k = String(key ?? '').trim();
  if (!k) return null;
  const rows = await db
    .select({ controlId: userLayerControl.controlId })
    .from(userLayerControl)
    .where(eq(userLayerControl.qgisKey, k))
    .limit(1);
  return rows[0]?.controlId ?? null;
}

export async function listLayerPermissionsByControlId(
  controlId: number
): Promise<Array<{ layerName: string; canRead: string; canWrite: string }>> {
  const rows = await db
    .select({
      layerName: layerControl.layerName,
      canRead: layerControl.canRead,
      canWrite: layerControl.canWrite,
    })
    .from(layerControl)
    .where(eq(layerControl.controlId, controlId));
  return rows.map((r) => ({
    layerName: String(r.layerName ?? ''),
    canRead: String(r.canRead ?? 'N'),
    canWrite: String(r.canWrite ?? 'N'),
  }));
}

export async function getReadableQualifiedLayerNames(controlId: number): Promise<Set<string>> {
  const rows = await listLayerPermissionsByControlId(controlId);
  const out = new Set<string>();
  for (const r of rows) {
    if (!yn(r.canRead)) continue;
    const local = localLayerName(r.layerName);
    if (!local) continue;
    out.add(qualifiedLayerName(local));
    out.add(local);
  }
  return out;
}

export async function selectCanWrite(controlId: number, layerName: string): Promise<string> {
  const local = localLayerName(layerName);
  if (!local) return 'N';
  const rows = await listLayerPermissionsByControlId(controlId);
  const hit = rows.find((r) => {
    const ln = localLayerName(r.layerName);
    return ln.toLowerCase() === local.toLowerCase();
  });
  return yn(hit?.canWrite) ? 'Y' : 'N';
}

/** GetCapabilities에 실리는 범위가 점 하나만큼 좁으면 QGIS가 피처를 안 가져옴 → 한반도 수준으로 보정 */
const WFS_CAPS_WGS84 = {
  minx: 124.5,
  miny: 33.0,
  maxx: 132.0,
  maxy: 39.0,
} as const;
/** EPSG:5181 대략 남한 범위 */
const WFS_CAPS_5181 = {
  minx: 100000,
  miny: 100000,
  maxx: 700000,
  maxy: 600000,
} as const;

/** Capabilities FeatureType 의 좁은 bbox를 넓혀 QGIS 초기 조회가 비지 않게 */
export function expandWfsCapabilitiesBoundingBoxes(xml: string): string {
  let out = xml;

  // WFS 1.0 LatLongBoundingBox
  out = out.replace(
    /<(?:[\w.]+:)?LatLongBoundingBox\b[^>]*\/?>/gi,
    () =>
      `<LatLongBoundingBox minx="${WFS_CAPS_WGS84.minx}" miny="${WFS_CAPS_WGS84.miny}" maxx="${WFS_CAPS_WGS84.maxx}" maxy="${WFS_CAPS_WGS84.maxy}"/>`
  );

  // WFS 1.1 / OWS WGS84BoundingBox
  out = out.replace(
    /<(?:[\w.]+:)?WGS84BoundingBox\b[^>]*>[\s\S]*?<\/(?:[\w.]+:)?WGS84BoundingBox>/gi,
    () =>
      `<ows:WGS84BoundingBox>` +
      `<ows:LowerCorner>${WFS_CAPS_WGS84.minx} ${WFS_CAPS_WGS84.miny}</ows:LowerCorner>` +
      `<ows:UpperCorner>${WFS_CAPS_WGS84.maxx} ${WFS_CAPS_WGS84.maxy}</ows:UpperCorner>` +
      `</ows:WGS84BoundingBox>`
  );

  // FeatureType 안 BoundingBox (EPSG:5181 등)
  out = out.replace(
    /<(?:[\w.]+:)?BoundingBox\b([^>]*)\/?>/gi,
    (full, attrs: string) => {
      const crsM = String(attrs || '').match(/\b(?:CRS|srsName)\s*=\s*["']([^"']+)["']/i);
      const crs = (crsM?.[1] || '').toUpperCase();
      const is5181 = /5181/.test(crs);
      const box = is5181 ? WFS_CAPS_5181 : WFS_CAPS_WGS84;
      const crsAttr = crsM?.[1] ? ` CRS="${crsM[1]}"` : ' CRS="EPSG:4326"';
      return `<BoundingBox${crsAttr} minx="${box.minx}" miny="${box.miny}" maxx="${box.maxx}" maxy="${box.maxy}"/>`;
    }
  );

  // ows:BoundingBox with LowerCorner/UpperCorner
  out = out.replace(
    /<(?:[\w.]+:)?BoundingBox\b([^>]*)>[\s\S]*?<\/(?:[\w.]+:)?BoundingBox>/gi,
    (_full, attrs: string) => {
      const crsM = String(attrs || '').match(/\b(?:crs|srsName)\s*=\s*["']([^"']+)["']/i);
      const crs = (crsM?.[1] || '').toUpperCase();
      const is5181 = /5181/.test(crs);
      const box = is5181 ? WFS_CAPS_5181 : WFS_CAPS_WGS84;
      const crsAttr = crsM?.[1] ? ` crs="${crsM[1]}"` : ' crs="EPSG:4326"';
      return (
        `<ows:BoundingBox${crsAttr}>` +
        `<ows:LowerCorner>${box.minx} ${box.miny}</ows:LowerCorner>` +
        `<ows:UpperCorner>${box.maxx} ${box.maxy}</ows:UpperCorner>` +
        `</ows:BoundingBox>`
      );
    }
  );

  return out;
}

/** GetCapabilities XML: 모든 WFS 엔드포인트를 프록시로 + 읽기 허용 FeatureType만 유지 */
export function filterWfsCapabilitiesXml(
  xml: string,
  readable: Set<string>,
  transactionUrl: string,
  wfsProxyUrl?: string
): string {
  const txHref = transactionUrl.replace(/"/g, '&quot;');
  const wfsHref = (wfsProxyUrl || transactionUrl).replace(/"/g, '&quot;');

  // OperationsMetadata: GetFeature/Describe 등 → wfs.do, Transaction → wfsUpdate.do
  // (GeoServer가 127.0.0.1:8090 을 광고하면 QGIS가 저장/스키마를 섞어 실패함)
  let out = xml.replace(
    /<([^>\s]+:)?Operation\b([^>]*)>[\s\S]*?<\/\1?Operation>/gi,
    (block, _pfx, attrs) => {
      const nameM = String(attrs || '').match(/\bname\s*=\s*["']([^"']+)["']/i);
      const opName = (nameM?.[1] || '').trim();
      const target = /^Transaction$/i.test(opName) ? txHref : wfsHref;
      return block
        .replace(/\bxlink:href\s*=\s*["'][^"']*["']/gi, `xlink:href="${target}"`)
        .replace(/(?<!xlink:)\bhref\s*=\s*["'][^"']*["']/gi, `href="${target}"`);
    }
  );

  // WFS 1.0.0 Request 섹션 onlineResource
  out = out.replace(
    /<(?:[\w.]+:)?(?:GetCapabilities|DescribeFeatureType|GetFeature|Transaction|LockFeature)\b[^>]*>[\s\S]*?<\/(?:[\w.]+:)?(?:GetCapabilities|DescribeFeatureType|GetFeature|Transaction|LockFeature)>/gi,
    (block) => {
      if (!/onlineResource|DCPType|HTTP/i.test(block)) return block;
      const isTx = /<(?:[\w.]+:)?Transaction\b/i.test(block);
      const target = isTx ? txHref : wfsHref;
      return block
        .replace(/\bonlineResource\s*=\s*["'][^"']*["']/gi, `onlineResource="${target}"`)
        .replace(/\bxlink:href\s*=\s*["'][^"']*["']/gi, `xlink:href="${target}"`);
    }
  );

  out = out.replace(
    /<([^>\s]+:)?FeatureType\b[^>]*>[\s\S]*?<\/\1?FeatureType>/gi,
    (block) => {
      const m = block.match(/<([^>\s]+:)?Name\b[^>]*>\s*([^<]+?)\s*<\/\1?Name>/i);
      if (!m) return '';
      const name = m[2].trim();
      const local = localLayerName(name);
      if (readable.has(name) || readable.has(local) || readable.has(qualifiedLayerName(local))) {
        return block;
      }
      return '';
    }
  );
  return expandWfsCapabilitiesBoundingBoxes(out);
}

/** Transaction body에서 레이어 localName 추출 */
export function extractLayerNamesFromWfsTransaction(body: string): string[] {
  const result: string[] = [];
  const insertRe =
    /<(?:[\w.]+:)?Insert\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?Insert>/gi;
  let im: RegExpExecArray | null;
  while ((im = insertRe.exec(body))) {
    const inner = im[1];
    const fe = inner.match(/<([\w.]+):([\w.]+)\b|<([\w.]+)\b/);
    if (fe) {
      const local = (fe[2] || fe[3] || '').trim();
      if (local && !/^Insert$/i.test(local)) result.push(localLayerName(local));
    }
  }
  for (const op of ['Update', 'Delete'] as const) {
    const re = new RegExp(
      `<(?:[\\w.]+:)?${op}\\b([^>]*)>`,
      'gi'
    );
    let um: RegExpExecArray | null;
    while ((um = re.exec(body))) {
      const attrs = um[1] || '';
      const tm =
        attrs.match(/\btypeNames?\s*=\s*["']([^"']+)["']/i) ||
        attrs.match(/\btypeName\s*=\s*["']([^"']+)["']/i);
      if (tm?.[1]) result.push(localLayerName(tm[1]));
    }
  }
  return [...new Set(result.filter(Boolean))];
}

/**
 * QGIS WFS 1.0/1.1 이 srsName=urn:ogc:def:crs:EPSG::5181 로 보내면
 * 좌표를 (N,E)/(Y,X) 순으로 넣는 경우가 많음. PostGIS·이 시스템 geom은 (E,N)/(X,Y).
 * → URN을 EPSG:코드 로 바꾸고, pos/coordinates 첫 두 값을 스왑.
 */
export function fixQgisWfsTransactionAxisOrder(xml: string): string {
  const usesUrnAxis =
    /srsName\s*=\s*["']urn:ogc:def:crs:EPSG::\d+["']/i.test(xml) ||
    /srsName\s*=\s*["']http:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#\d+["']/i.test(xml);

  let out = xml
    .replace(
      /srsName\s*=\s*["']urn:ogc:def:crs:EPSG::(\d+)["']/gi,
      'srsName="EPSG:$1"'
    )
    .replace(
      /srsName\s*=\s*["']http:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#(\d+)["']/gi,
      'srsName="EPSG:$1"'
    );

  if (!usesUrnAxis) return out;

  // <gml:pos>Y X</gml:pos> 또는 Y X Z
  out = out.replace(
    /(<(?:[\w.]+:)?pos\b[^>]*>)\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(\s+[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)?\s*(<\/(?:[\w.]+:)?pos>)/gi,
    (_m, open, a, b, z, close) => `${open}${b} ${a}${z || ''}${close}`
  );

  // <gml:coordinates>Y,X</gml:coordinates> (cs="," 기본)
  out = out.replace(
    /(<(?:[\w.]+:)?coordinates\b[^>]*>)\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(\s+[+-]?\d+(?:\.\d+)?)?\s*(<\/(?:[\w.]+:)?coordinates>)/gi,
    (_m, open, a, b, z, close) => `${open}${b},${a}${z || ''}${close}`
  );

  return out;
}

function requestParam(
  params: URLSearchParams,
  name: string
): string | null {
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return null;
}

export async function proxyWfsGet(opts: {
  searchParams: URLSearchParams;
  appBaseUrl: string;
}): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const key = String(requestParam(opts.searchParams, 'key') ?? '').trim();
  if (!key) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes("'key' 파라미터가 누락되었습니다.", 'MissingParameterValue', 'key'),
    };
  }

  const controlId = await getControlIdByQgisKey(key);
  if (controlId == null) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        "'key' 값이 유효하지 않거나 권한이 없습니다.",
        'InvalidParameterValue',
        'key'
      ),
    };
  }

  const readable = await getReadableQualifiedLayerNames(controlId);
  const requestName = String(requestParam(opts.searchParams, 'REQUEST') ?? '').trim();
  const serviceName = String(requestParam(opts.searchParams, 'SERVICE') ?? 'WFS').trim();

  if (/^WMS$/i.test(serviceName)) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        '이 주소는 WFS 전용입니다. QGIS에서 WFS 연결로 추가하세요. (WMS 아님)',
        'InvalidParameterValue',
        'SERVICE'
      ),
    };
  }

  const typeName =
    requestParam(opts.searchParams, 'TYPENAME') ||
    requestParam(opts.searchParams, 'TYPENAMES') ||
    requestParam(opts.searchParams, 'typeName') ||
    requestParam(opts.searchParams, 'typeNames');

  if (
    typeName &&
    /^(GetFeature|DescribeFeatureType)$/i.test(requestName)
  ) {
    const locals = String(typeName)
      .split(',')
      .map((s) => localLayerName(s))
      .filter(Boolean);
    const denied = locals.some(
      (l) => !readable.has(l) && !readable.has(qualifiedLayerName(l))
    );
    if (denied || locals.length === 0) {
      return {
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: buildOgcErrorBytes('읽기 권한이 없습니다.', 'AccessDenied', 'typeName'),
      };
    }
  }

  const typeLocals = typeName
    ? String(typeName)
        .split(',')
        .map((s) => localLayerName(s))
        .filter(Boolean)
    : [];
  const fieldAliases = mergeFieldAliasMaps(typeLocals);

  const upstream = new URL(`${getGeoServerInternalBase()}/wfs`);
  for (const [k, v] of opts.searchParams.entries()) {
    if (k.toLowerCase() === 'key') continue;
    // QGIS가 한글 속성명으로 PROPERTYNAME을내면 GeoServer용 영문으로 되돌림
    if (/^propertyname$/i.test(k) && fieldAliases.korToEng.size) {
      upstream.searchParams.append(k, rewriteCsvPropertyNames(v, fieldAliases.korToEng));
      continue;
    }
    upstream.searchParams.append(k, v);
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        `GeoServer에 연결할 수 없습니다 (${getGeoServerInternalBase()}). GeoServer를 기동한 뒤 다시 시도하세요. (${detail})`,
        'NoApplicableCode',
        'geoserver'
      ),
    };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/xml; charset=utf-8';
  const isXml = contentType.toLowerCase().includes('xml');
  const isGetCapabilities = /^GetCapabilities$/i.test(requestName);

  if (isXml && isGetCapabilities) {
    const xml = new TextDecoder('utf-8').decode(buf);
    const wfsUrl = `${opts.appBaseUrl}/wfs.do?key=${encodeURIComponent(key)}`;
    const txUrl = `${opts.appBaseUrl}/wfsUpdate.do?key=${encodeURIComponent(key)}`;
    const filtered = applyKoreanFeatureTypeTitles(
      filterWfsCapabilitiesXml(xml, readable, txUrl, wfsUrl)
        // QGIS가 URN 축순서(Y,X)로 저장하지 않도록 선언 CRS를 EPSG:코드 형태로
        .replace(
          /<(?:[\w.]+:)?(?:DefaultSRS|DefaultCRS|OtherSRS|OtherCRS)\b[^>]*>\s*urn:[^<]*EPSG[^\d]*(\d+)\s*<\/(?:[\w.]+:)?(?:DefaultSRS|DefaultCRS|OtherSRS|OtherCRS)>/gi,
          (full, code) => full.replace(/urn:[^<]+/, `EPSG:${code}`)
        )
    );
    return {
      status: res.status,
      contentType: 'application/xml; charset=utf-8',
      body: new TextEncoder().encode(filtered),
    };
  }

  // DescribeFeatureType: PK 숨김 + defineLayer 한글 필드명
  if (isXml && /^DescribeFeatureType$/i.test(requestName) && typeName) {
    const firstLocal = localLayerName(String(typeName).split(',')[0] ?? '');
    const hide = loadHiddenDescribeFields(firstLocal);
    const { engToKor } = loadFieldAliasMaps(firstLocal);
    const xml = new TextDecoder('utf-8').decode(buf);
    const stripped = stripFieldsFromDescribeFeatureType(xml, hide);
    const aliased = applyKoreanFieldNamesToDescribeFeatureType(stripped, engToKor);
    return {
      status: res.status,
      contentType: 'application/xml; charset=utf-8',
      body: new TextEncoder().encode(aliased),
    };
  }

  // GetFeature: 속성 태그 영문→한글 (QGIS 속성 테이블 헤더)
  if (isXml && /^GetFeature$/i.test(requestName) && fieldAliases.engToKor.size) {
    const xml = new TextDecoder('utf-8').decode(buf);
    const aliased = rewriteXmlPropertyNames(xml, fieldAliases.engToKor);
    return {
      status: res.status,
      contentType: 'application/xml; charset=utf-8',
      body: new TextEncoder().encode(aliased),
    };
  }

  return { status: res.status, contentType, body: buf };
}

/** WMS 레이어명 비교용 — workspace·_cog(.tif) 접미사 제거 */
function normalizeWmsLayerKey(name: string): string {
  return localLayerName(name).replace(/_cog(\.tif)?$/i, '');
}

function isReadableWmsLayer(name: string, readable: Set<string>): boolean {
  const local = localLayerName(name);
  const norm = normalizeWmsLayerKey(local);
  if (
    readable.has(name) ||
    readable.has(local) ||
    readable.has(qualifiedLayerName(local)) ||
    readable.has(norm) ||
    readable.has(qualifiedLayerName(norm))
  ) {
    return true;
  }
  for (const r of readable) {
    if (normalizeWmsLayerKey(r) === norm) return true;
  }
  return false;
}

/**
 * WMS GetCapabilities — 읽기 권한 드론영상만 직접 생성.
 * WMS는 드론영상 전용(일반 레이어는 WFS)이며, GeoServer 전역 Capabilities는
 * 모든 워크스페이스 레이어의 DB 스키마를 검사해 공용 GeoServer에서 오류가 대량 발생한다.
 */
async function buildWmsCapabilitiesXml(
  readable: Set<string>,
  wmsProxyUrl: string
): Promise<string> {
  const { buildWmsExtentXml, buildOrthoWmsLayerXml, listOrthoExtentsForWmsCaps } = await import(
    '@/service/orthoWmsRenderService'
  );

  let orthoXml = '';
  try {
    const orthoLayers = await listOrthoExtentsForWmsCaps(readable);
    if (orthoLayers.length > 0) {
      orthoXml =
        `<Layer><Title>드론영상</Title>` +
        orthoLayers.map(buildOrthoWmsLayerXml).join('') +
        `</Layer>`;
    }
  } catch {
    /* ignore */
  }

  const href = escapeXml(wmsProxyUrl);
  const online = `<OnlineResource xlink:type="simple" xlink:href="${href}"/>`;
  const dcp = `<DCPType><HTTP><Get>${online}</Get></HTTP></DCPType>`;
  const fmt = (list: string[]) => list.map((f) => `<Format>${f}</Format>`).join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.opengis.net/wms http://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd">` +
    `<Service><Name>WMS</Name><Title>${escapeXml(WORKSPACE)} WMS</Title>${online}</Service>` +
    `<Capability>` +
    `<Request>` +
    `<GetCapabilities>${fmt(['text/xml'])}${dcp}</GetCapabilities>` +
    `<GetMap>${fmt(['image/png'])}${dcp}</GetMap>` +
    `</Request>` +
    `<Exception>${fmt(['XML'])}</Exception>` +
    `<Layer><Title>${escapeXml(WORKSPACE)}</Title>` +
    buildWmsExtentXml(WFS_CAPS_WGS84.minx, WFS_CAPS_WGS84.miny, WFS_CAPS_WGS84.maxx, WFS_CAPS_WGS84.maxy) +
    orthoXml +
    `</Layer>` +
    `</Capability>` +
    `</WMS_Capabilities>`
  );
}

/** GET /wms.do — key 권한 WMS 프록시 (레거시 GeoServerService.wms) */
export async function proxyWmsGet(opts: {
  searchParams: URLSearchParams;
  appBaseUrl: string;
}): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const key = String(requestParam(opts.searchParams, 'key') ?? '').trim();
  if (!key) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes("'key' 파라미터가 누락되었습니다.", 'MissingParameterValue', 'key'),
    };
  }

  const controlId = await getControlIdByQgisKey(key);
  if (controlId == null) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        "'key' 값이 유효하지 않거나 권한이 없습니다.",
        'InvalidParameterValue',
        'key'
      ),
    };
  }

  const readable = await getReadableQualifiedLayerNames(controlId);
  if (readable.size === 0) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes('읽기 가능한 레이어가 없습니다.', 'AccessDenied', 'key'),
    };
  }

  const requestName = String(requestParam(opts.searchParams, 'REQUEST') ?? '').trim();

  if (/^GetCapabilities$/i.test(requestName)) {
    const wmsUrl = `${opts.appBaseUrl}/wms.do?key=${encodeURIComponent(key)}`;
    const xml = await buildWmsCapabilitiesXml(readable, wmsUrl);
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: new TextEncoder().encode(xml),
    };
  }

  const layersParam =
    requestParam(opts.searchParams, 'LAYERS') ||
    requestParam(opts.searchParams, 'LAYER') ||
    requestParam(opts.searchParams, 'QUERY_LAYERS');

  if (layersParam && /^(GetMap|GetFeatureInfo)$/i.test(requestName)) {
    const locals = String(layersParam)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const denied = locals.some((l) => !isReadableWmsLayer(l, readable));
    if (denied || locals.length === 0) {
      return {
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: buildOgcErrorBytes('읽기 권한이 없습니다.', 'AccessDenied', 'LAYERS'),
      };
    }
  }

  // WMS는 드론영상 전용 — GeoServer 없이 원본 TIF 렌더
  if (/^GetMap$/i.test(requestName) && layersParam) {
    const { parseOrthoWmsTuKey } = await import('@/service/aerialOrthoService');
    const layerList = String(layersParam)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allOrtho = layerList.length > 0 && layerList.every((l) => parseOrthoWmsTuKey(l) != null);
    if (!allOrtho) {
      return {
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        body: buildOgcErrorBytes(
          'WMS는 드론영상 전용입니다. 일반 레이어는 WFS 연결로 추가하세요.',
          'LayerNotDefined',
          'LAYERS'
        ),
      };
    }
    const { renderOrthoWmsGetMap } = await import('@/service/orthoWmsRenderService');
    const bbox = String(requestParam(opts.searchParams, 'BBOX') ?? '').trim();
    const width = Number(requestParam(opts.searchParams, 'WIDTH') ?? 256);
    const height = Number(requestParam(opts.searchParams, 'HEIGHT') ?? 256);
    const crs =
      requestParam(opts.searchParams, 'CRS') ||
      requestParam(opts.searchParams, 'SRS') ||
      'EPSG:3857';
    const version = String(requestParam(opts.searchParams, 'VERSION') ?? '1.3.0');
    // 다중 레이어면 첫 레이어만 (QGIS는 보통 단건)
    return renderOrthoWmsGetMap({
      layerName: layerList[0]!,
      bbox,
      width,
      height,
      crs: String(crs),
      version,
    });
  }

  return {
    status: 200,
    contentType: 'application/xml; charset=utf-8',
    body: buildOgcErrorBytes(
      `지원하지 않는 WMS 요청입니다 (${requestName || 'REQUEST 누락'}).`,
      'OperationNotSupported',
      'REQUEST'
    ),
  };
}

/** POST /wfs.do — GetFeature 등 (Transaction 제외). 레거시처럼 GeoServer로 중계 */
export async function proxyWfsPost(opts: {
  searchParams: URLSearchParams;
  body: Uint8Array;
  contentType?: string | null;
  keyHint?: string;
  appBaseUrl: string;
}): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const key = String(
    requestParam(opts.searchParams, 'key') ?? opts.keyHint ?? ''
  ).trim();
  if (!key) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes("'key' 파라미터가 누락되었습니다.", 'MissingParameterValue', 'key'),
    };
  }
  const controlId = await getControlIdByQgisKey(key);
  if (controlId == null) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        "'key' 값이 유효하지 않거나 권한이 없습니다.",
        'InvalidParameterValue',
        'key'
      ),
    };
  }

  const bodyRaw = new TextDecoder('utf-8').decode(opts.body);
  const typeFromQuery =
    requestParam(opts.searchParams, 'TYPENAME') ||
    requestParam(opts.searchParams, 'TYPENAMES') ||
    requestParam(opts.searchParams, 'typeName') ||
    requestParam(opts.searchParams, 'typeNames');
  const typeLocals = [
    ...extractLayerNamesFromWfsRequestXml(bodyRaw),
    ...(typeFromQuery
      ? String(typeFromQuery)
          .split(',')
          .map((s) => localLayerName(s))
          .filter(Boolean)
      : []),
  ];
  const fieldAliases = mergeFieldAliasMaps([...new Set(typeLocals)]);

  let bodyText = bodyRaw;
  if (fieldAliases.korToEng.size) {
    bodyText = rewriteXmlPropertyNames(bodyText, fieldAliases.korToEng);
    bodyText = rewriteXmlNameTextValues(bodyText, fieldAliases.korToEng);
  }

  const upstream = new URL(`${getGeoServerInternalBase()}/wfs`);
  for (const [k, v] of opts.searchParams.entries()) {
    if (k.toLowerCase() === 'key') continue;
    if (/^propertyname$/i.test(k) && fieldAliases.korToEng.size) {
      upstream.searchParams.append(k, rewriteCsvPropertyNames(v, fieldAliases.korToEng));
      continue;
    }
    upstream.searchParams.append(k, v);
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': opts.contentType || 'application/xml; charset=utf-8',
        Accept: 'application/xml, text/xml, */*',
      },
      body: Buffer.from(new TextEncoder().encode(bodyText)),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        `GeoServer에 연결할 수 없습니다 (${getGeoServerInternalBase()}). (${detail})`,
        'NoApplicableCode',
        'geoserver'
      ),
    };
  }
  const resBuf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/xml; charset=utf-8';
  if (contentType.toLowerCase().includes('xml') && fieldAliases.engToKor.size) {
    const resXml = new TextDecoder('utf-8').decode(resBuf);
    // GetFeature 응답만 속성 태그 한글화 (ExceptionReport 등은 키 미매칭으로 무해)
    if (/<(?:[\w.]+:)?(FeatureCollection|featureMember|member)\b/i.test(resXml)) {
      return {
        status: res.status,
        contentType: 'application/xml; charset=utf-8',
        body: new TextEncoder().encode(
          rewriteXmlPropertyNames(resXml, fieldAliases.engToKor)
        ),
      };
    }
  }
  return {
    status: res.status,
    contentType,
    body: resBuf,
  };
}

export async function proxyWfsUpdate(opts: {
  key: string;
  body: Uint8Array;
  contentType?: string | null;
}): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const key = String(opts.key ?? '').trim();
  if (!key) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes("'key' 파라미터가 누락되었습니다.", 'MissingParameterValue', 'key'),
    };
  }
  const controlId = await getControlIdByQgisKey(key);
  if (controlId == null) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        "'key' 값이 유효하지 않거나 권한이 없습니다.",
        'InvalidParameterValue',
        'key'
      ),
    };
  }

  const textRaw = new TextDecoder('utf-8').decode(opts.body);
  const textAxis = fixQgisWfsTransactionAxisOrder(textRaw);
  const layers = extractLayerNamesFromWfsTransaction(textAxis);
  const { korToEng } = mergeFieldAliasMaps(layers);
  let text = textAxis;
  if (korToEng.size) {
    text = rewriteXmlPropertyNames(text, korToEng);
    text = rewriteXmlNameTextValues(text, korToEng);
  }
  console.info('[wfsUpdate] incoming', {
    key: key.slice(0, 4) + '…',
    layers,
    contentType: opts.contentType,
    axisFixed: textAxis !== textRaw,
    fieldAlias: korToEng.size > 0,
    bodyHead: text.slice(0, 500).replace(/\s+/g, ' '),
  });
  if (layers.length === 0) {
    console.warn('[wfsUpdate] no layer in body', text.slice(0, 800));
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes('레이어명을 확인할 수 없습니다.', 'InvalidParameterValue', 'typeName'),
    };
  }

  // 레거시: 첫 레이어만 can_write 검사
  const primary = layers[0]!;
  const can = await selectCanWrite(controlId, primary);
  if (can !== 'Y') {
    console.warn('[wfsUpdate] PermissionDenied', { controlId, layer: primary, layers });
    return buildTransactionDenied(primary);
  }

  const geoserverURL = `${getGeoServerInternalBase()}/wfs`;
  const ct = (opts.contentType || 'application/xml; charset=utf-8').trim();
  const bodyBuf = new TextEncoder().encode(text);
  let res: Response;
  try {
    res = await fetch(geoserverURL, {
      method: 'POST',
      headers: {
        'Content-Type': ct,
        Accept: 'application/xml, text/xml, */*',
        // GeoServer layers.properties: *.* .w=ADMIN → 비인증 Transaction은 read-only
        Authorization: geoServerAuthHeader(),
      },
      body: Buffer.from(bodyBuf),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[wfsUpdate] GeoServer connect failed', geoserverURL, detail);
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: buildOgcErrorBytes(
        `GeoServer에 연결할 수 없습니다 (${geoserverURL}). (${detail})`,
        'NoApplicableCode',
        'geoserver'
      ),
    };
  }

  // 레거시와 동일: GeoServer 응답 status/body 그대로 전달 (임의 403 변환 금지)
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/xml; charset=utf-8';
  if (!res.ok) {
    console.warn('[wfsUpdate] GeoServer status', res.status, {
      layer: primary,
      bodyHead: new TextDecoder('utf-8').decode(buf).slice(0, 400),
    });
  }
  return {
    status: res.status,
    contentType,
    body: buf,
  };
}

async function requireUsr(): Promise<string> {
  const usrId = await getSessionUsrId();
  if (!usrId) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  return usrId;
}

/** QGIS 권한 관리 — 슈퍼계정 또는 부서관리자만 */
async function requireQgisAdmin(): Promise<string> {
  const usrId = await requireUsr();
  if (isSuperUser(usrId)) return usrId;
  const rows = await db
    .select({ usrIsManager: usr.usrIsManager })
    .from(usr)
    .where(eq(usr.usrId, usrId))
    .limit(1);
  if (rows[0]?.usrIsManager === true) return usrId;
  throw Object.assign(new Error('관리자만 사용할 수 있습니다.'), { status: 403 });
}

async function getOrCreateControlForUsr(
  targetUsrId: string
): Promise<{ controlId: number; qgisKey: string | null }> {
  const existing = await db
    .select()
    .from(userLayerControl)
    .where(eq(userLayerControl.usrId, targetUsrId))
    .limit(1);
  if (existing[0]) {
    return {
      controlId: existing[0].controlId,
      qgisKey: existing[0].qgisKey ? String(existing[0].qgisKey) : null,
    };
  }
  const inserted = await db
    .insert(userLayerControl)
    .values({ usrId: targetUsrId, qgisKey: null })
    .returning({ controlId: userLayerControl.controlId, qgisKey: userLayerControl.qgisKey });
  return {
    controlId: inserted[0].controlId,
    qgisKey: inserted[0].qgisKey ? String(inserted[0].qgisKey) : null,
  };
}

export type AdminUserKeyRow = {
  usrId: string;
  usrName: string | null;
  ugName: string | null;
  utName: string | null;
  qgisKey: string | null;
  controlId: number | null;
};

export type AdminLayerPermRow = {
  layerName: string;
  layerTitle: string;
  layerGroup?: string;
  canRead: boolean;
  canWrite: boolean;
};

/** 권한 UI용 레이어 — 현재 DB에 있는 공간테이블만. 한글명·그룹은 정의에서 보강 */
async function listGeoserverLayersWithTitle(): Promise<
  Array<{ layerName: string; layerTitle: string; layerGroup?: string }>
> {
  const byName = new Map<string, { layerName: string; layerTitle: string; layerGroup?: string }>();

  try {
    const { getDefineLayerTables, getLayerTableList } = await import('@/service/devTestService');
    const [def, dbTableRes] = await Promise.all([
      getDefineLayerTables(),
      getLayerTableList(),
    ]);
    const defineByKey = new Map<
      string,
      { layerName: string; layerTitle: string; layerGroup?: string }
    >();
    for (const row of def.tables ?? []) {
      const layerName = localLayerName(String(row.define_table_name ?? ''));
      if (!layerName) continue;
      const layerTitle = String(row.define_table_kor_name ?? '').trim() || layerName;
      const layerGroup = String(row.define_table_group ?? '').trim() || undefined;
      defineByKey.set(layerName.toLowerCase(), { layerName, layerTitle, layerGroup });
    }
    for (const table of dbTableRes.tables ?? []) {
      const physical = localLayerName(String(table.table ?? ''));
      if (!physical) continue;
      const meta = defineByKey.get(physical.toLowerCase());
      const layerName = meta?.layerName ?? physical;
      if (byName.has(layerName)) continue;
      byName.set(layerName, {
        layerName,
        layerTitle: meta?.layerTitle || layerName,
        layerGroup: meta?.layerGroup,
      });
    }
  } catch {
    /* DB 조회 실패 시 드론영상만 */
  }

  try {
    const { getSystemList } = await import('@/service/configService');
    const sysKeys = getSystemList().systems.map((s) => s.sys_key);
    for (const key of [...byName.keys()]) {
      if (!allowProjectLayerTable(key, sysKeys)) byName.delete(key);
    }
  } catch {
    /* 시스템 목록을 못 읽으면 표 목록 유지 */
  }

  // 변환완료 드론영상 (QGIS WMS 전용. 테이블이 아닌 현재 작업 영상)
  try {
    const { listOrthoCatalogForPermissions } = await import('@/service/orthoWmsRenderService');
    const ortho = await listOrthoCatalogForPermissions();
    for (const row of ortho) {
      if (!row.layerName || byName.has(row.layerName)) continue;
      byName.set(row.layerName, {
        layerName: row.layerName,
        layerTitle: row.layerTitle,
        layerGroup: row.layerGroup,
      });
    }
  } catch {
    /* ignore */
  }

  return [...byName.values()].sort((a, b) => {
    const g = String(a.layerGroup ?? '').localeCompare(String(b.layerGroup ?? ''), 'ko');
    if (g !== 0) return g;
    return a.layerTitle.localeCompare(b.layerTitle, 'ko');
  });
}

/** 관리: 사용자 목록 + KEY (부서 그룹용) */
export async function listAdminUsersWithKeys(_params?: unknown): Promise<AdminUserKeyRow[]> {
  await requireQgisAdmin();
  const users = await db
    .select({
      usrId: usr.usrId,
      usrName: usr.usrName,
      ugName: usr.ugName,
      utName: usr.utName,
    })
    .from(usr)
    .where(or(eq(usr.usrIsDel, false), isNull(usr.usrIsDel)))
    .orderBy(asc(usr.ugName), asc(usr.utName), asc(usr.usrId));

  const keys = await db
    .select({
      usrId: userLayerControl.usrId,
      controlId: userLayerControl.controlId,
      qgisKey: userLayerControl.qgisKey,
    })
    .from(userLayerControl);

  const byUsr = new Map(
    keys.map((k) => [
      k.usrId,
      {
        controlId: k.controlId as number,
        qgisKey: k.qgisKey ? String(k.qgisKey) : null,
      },
    ])
  );

  return users.map((u) => {
    const k = byUsr.get(u.usrId);
    return {
      usrId: u.usrId,
      usrName: u.usrName,
      ugName: u.ugName,
      utName: u.utName,
      qgisKey: k?.qgisKey ?? null,
      controlId: k?.controlId ?? null,
    };
  });
}

/** 관리: 키 발급·재발급 */
export async function regenerateUserQgisKey(params: {
  usrId: string;
}): Promise<{ usrId: string; qgisKey: string; wfsUrlHint: string; wmsUrlHint: string }> {
  await requireQgisAdmin();
  const target = String(params?.usrId ?? '').trim();
  if (!target) throw new Error('사용자 아이디가 없습니다.');
  const { controlId } = await getOrCreateControlForUsr(target);
  const qgisKey = newQgisKey();
  await db
    .update(userLayerControl)
    .set({ qgisKey })
    .where(eq(userLayerControl.controlId, controlId));
  return {
    usrId: target,
    qgisKey,
    wfsUrlHint: `/wfs.do?key=${encodeURIComponent(qgisKey)}`,
    wmsUrlHint: `/wms.do?key=${encodeURIComponent(qgisKey)}`,
  };
}

/** 관리: 키 삭제 */
export async function deleteUserQgisKey(params: { usrId: string }): Promise<{ ok: true }> {
  await requireQgisAdmin();
  const target = String(params?.usrId ?? '').trim();
  if (!target) throw new Error('사용자 아이디가 없습니다.');
  const existing = await db
    .select({ controlId: userLayerControl.controlId })
    .from(userLayerControl)
    .where(eq(userLayerControl.usrId, target))
    .limit(1);
  if (existing[0]) {
    await db
      .update(userLayerControl)
      .set({ qgisKey: null })
      .where(eq(userLayerControl.controlId, existing[0].controlId));
  }
  return { ok: true };
}

/** 관리: 선택 사용자 레이어 권한 */
export async function getUserLayerPermissions(params: {
  usrId: string;
}): Promise<{ usrId: string; controlId: number; layers: AdminLayerPermRow[] }> {
  await requireQgisAdmin();
  const target = String(params?.usrId ?? '').trim();
  if (!target) throw new Error('사용자 아이디가 없습니다.');
  const { controlId } = await getOrCreateControlForUsr(target);
  const perms = await listLayerPermissionsByControlId(controlId);
  const byName = new Map(perms.map((p) => [localLayerName(p.layerName), p]));
  const catalog = await listGeoserverLayersWithTitle();
  const nameSet = new Set(catalog.map((c) => c.layerName));
  const titleByName = new Map(catalog.map((c) => [c.layerName, c.layerTitle]));
  const groupByName = new Map(
    catalog.map((c) => [c.layerName, c.layerGroup ?? ''])
  );
  const layers: AdminLayerPermRow[] = [...nameSet]
    .sort((a, b) => {
      const g = String(groupByName.get(a) ?? '').localeCompare(
        String(groupByName.get(b) ?? ''),
        'ko'
      );
      if (g !== 0) return g;
      return (titleByName.get(a) || a).localeCompare(titleByName.get(b) || b, 'ko');
    })
    .map((layerName) => {
      const p = byName.get(layerName);
      return {
        layerName,
        layerTitle: titleByName.get(layerName) || layerName,
        layerGroup: groupByName.get(layerName) || undefined,
        canRead: yn(p?.canRead),
        canWrite: yn(p?.canWrite),
      };
    });
  return { usrId: target, controlId, layers };
}

/** 관리: 선택 사용자 레이어 권한 저장 */
export async function saveUserLayerPermissions(params: {
  usrId: string;
  layers: Array<{ layerName: string; canRead: boolean; canWrite: boolean }>;
}): Promise<{ ok: true; count: number }> {
  await requireQgisAdmin();
  const target = String(params?.usrId ?? '').trim();
  if (!target) throw new Error('사용자 아이디가 없습니다.');
  const { controlId } = await getOrCreateControlForUsr(target);
  const layers = Array.isArray(params?.layers) ? params.layers : [];
  await db.delete(layerControl).where(eq(layerControl.controlId, controlId));
  const values = layers
    .map((row) => ({
      controlId,
      layerName: localLayerName(row.layerName),
      canRead: toYn(Boolean(row.canRead)),
      canWrite: toYn(Boolean(row.canWrite && row.canRead)),
    }))
    .filter((r) => r.layerName && (r.canRead === 'Y' || r.canWrite === 'Y'));
  if (values.length > 0) {
    await db.insert(layerControl).values(values);
  }
  return { ok: true, count: values.length };
}

/** @deprecated 본인 키 UI용 — 관리자 API로 대체 */
export async function listGeoserverLayerNames(_params?: unknown): Promise<string[]> {
  await requireQgisAdmin();
  const rows = await listGeoserverLayersWithTitle();
  return rows.map((r) => r.layerName);
}
