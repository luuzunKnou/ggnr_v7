import {
  buildFloodErrorBody,
  extractHrfcoCode,
  logFloodError,
  type FloodApiErrorBody,
} from './hrfcoErrors';

const HRFCO_BASE = 'https://api.hrfco.go.kr';

export function getFloodApiKey(): string | null {
  const key = process.env.FLOOD_API_KEY?.trim();
  return key || null;
}

export function hrfcoUrl(apiKey: string, path: string): string {
  const p = path.replace(/^\//, '');
  return `${HRFCO_BASE}/${apiKey}/${p}`;
}

/** 로그용 URL (인증키 마스킹) */
export function hrfcoUrlForLog(apiKey: string, path: string): string {
  const p = path.replace(/^\//, '');
  return `${HRFCO_BASE}/***/${p}`;
}

function pickField(row: Record<string, unknown>, ...keys: string[]): string {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    lowerMap.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase());
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | null {
  const s = pickField(row, ...keys);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * HRFCO 좌표: `37-37-27` / `128-33-04` (도-분-초) 또는 십진.
 */
export function parseHrfcoCoord(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const dms = /^(-?\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(s);
  if (dms) {
    const deg = Number(dms[1]);
    const min = Number(dms[2]);
    const sec = Number(dms[3]);
    if (![deg, min, sec].every(Number.isFinite)) return null;
    const sign = deg < 0 ? -1 : 1;
    return sign * (Math.abs(deg) + min / 60 + sec / 3600);
  }
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickCoord(row: Record<string, unknown>, ...keys: string[]): number | null {
  const s = pickField(row, ...keys);
  if (!s) return null;
  return parseHrfcoCoord(s);
}

function pickXmlTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** XML content 내 반복 블록 → 필드 맵 배열 */
export function parseHrfcoXmlBlocks(xml: string, blockTag: string): Record<string, unknown>[] {
  const re = new RegExp(`<${blockTag}>([\\s\\S]*?)</${blockTag}>`, 'gi');
  const out: Record<string, unknown>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const row: Record<string, unknown> = {};
    const tagRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(block)) !== null) {
      const name = tm[1];
      if (row[name] == null) {
        row[name] = tm[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      }
    }
    // 표준 태그 보강
    for (const f of [
      'addr',
      'etcaddr',
      'lat',
      'lon',
      'obsnm',
      'rfobscd',
      'wlobscd',
      'gdt',
      'attwl',
      'wrnwl',
      'almwl',
      'srswl',
      'pfh',
    ]) {
      const v = pickXmlTag(block, f);
      if (v && row[f] == null) row[f] = v;
    }
    out.push(row);
  }
  return out;
}

/** content 배열 또는 최상위 배열 추출 */
export function extractContentRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((r): r is Record<string, unknown> => r != null && typeof r === 'object');
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['content', 'list', 'data', 'CONTENT', 'LIST', 'DATA']) {
      const v = o[key];
      if (Array.isArray(v)) {
        return v.filter((r): r is Record<string, unknown> => r != null && typeof r === 'object');
      }
    }
  }
  return [];
}

export type ParsedStation = {
  id: string;
  code: string;
  kind: 'water' | 'rain';
  name: string;
  lon: number;
  lat: number;
  address: string;
  gdt?: number | null;
  attwl?: number | null;
  wrnwl?: number | null;
  almwl?: number | null;
  srswl?: number | null;
  pfh?: number | null;
};

function rowsToWaterStations(rows: Record<string, unknown>[]): ParsedStation[] {
  const out: ParsedStation[] = [];
  for (const row of rows) {
    const code = pickField(row, 'Wlobscd', 'wlobscd');
    if (!code) continue;
    const lon = pickCoord(row, 'Lon', 'lon');
    const lat = pickCoord(row, 'Lat', 'lat');
    if (lon == null || lat == null) continue;
    const addr = pickField(row, 'Addr', 'addr');
    const etc = pickField(row, 'Etcaddr', 'etcaddr');
    out.push({
      id: `wl:${code}`,
      code,
      kind: 'water',
      name: pickField(row, 'Obsnm', 'obsnm') || code,
      lon,
      lat,
      address: [addr, etc].filter(Boolean).join(' ') || addr,
      gdt: pickNumber(row, 'Gdt', 'gdt', 'GDT'),
      attwl: pickNumber(row, 'Attwl', 'attwl', 'ATTWL'),
      wrnwl: pickNumber(row, 'Wrnwl', 'wrnwl', 'WRNWL'),
      almwl: pickNumber(row, 'Almwl', 'almwl', 'ALMWL'),
      srswl: pickNumber(row, 'Srswl', 'srswl', 'SRSWL'),
      pfh: pickNumber(row, 'Pfh', 'pfh', 'PFH'),
    });
  }
  return out;
}

function rowsToRainStations(rows: Record<string, unknown>[]): ParsedStation[] {
  const out: ParsedStation[] = [];
  for (const row of rows) {
    const code = pickField(row, 'Rfobscd', 'rfobscd');
    if (!code) continue;
    const lon = pickCoord(row, 'Lon', 'lon');
    const lat = pickCoord(row, 'Lat', 'lat');
    if (lon == null || lat == null) continue;
    const addr = pickField(row, 'Addr', 'addr');
    const etc = pickField(row, 'Etcaddr', 'etcaddr');
    out.push({
      id: `rf:${code}`,
      code,
      kind: 'rain',
      name: pickField(row, 'Obsnm', 'obsnm') || code,
      lon,
      lat,
      address: [addr, etc].filter(Boolean).join(' ') || addr,
    });
  }
  return out;
}

export function parseWaterStations(raw: unknown): ParsedStation[] {
  if (typeof raw === 'string' && raw.includes('<')) {
    return rowsToWaterStations(parseHrfcoXmlBlocks(raw, 'WaterlevelInfo'));
  }
  return rowsToWaterStations(extractContentRows(raw));
}

export function parseRainStations(raw: unknown): ParsedStation[] {
  if (typeof raw === 'string' && raw.includes('<')) {
    return rowsToRainStations(parseHrfcoXmlBlocks(raw, 'Rainfall'));
  }
  return rowsToRainStations(extractContentRows(raw));
}

export type ParsedObservation = {
  code: string;
  value: number | null;
  observedAt: string;
};

function rowsToWaterObservations(
  rows: Record<string, unknown>[],
  fallbackCode?: string
): ParsedObservation[] {
  const out: ParsedObservation[] = [];
  for (const row of rows) {
    const code = pickField(row, 'Wlobscd', 'wlobscd') || fallbackCode || '';
    if (!code) continue;
    const value = pickNumber(row, 'Wl', 'wl', 'Waterlevel', 'waterlevel');
    const observedAt = pickField(row, 'Ymdhm', 'ymdhm', 'YMDHM');
    out.push({ code, value, observedAt });
  }
  return out;
}

function rowsToRainObservations(
  rows: Record<string, unknown>[],
  fallbackCode?: string
): ParsedObservation[] {
  const out: ParsedObservation[] = [];
  for (const row of rows) {
    const code = pickField(row, 'Rfobscd', 'rfobscd') || fallbackCode || '';
    if (!code) continue;
    const value = pickNumber(row, 'Rf', 'rf', 'Rainfall', 'rainfall', 'Rainfall1h');
    const observedAt = pickField(row, 'Ymdhm', 'ymdhm', 'YMDHM');
    out.push({ code, value, observedAt });
  }
  return out;
}

/** 관측 XML 블록 태그 후보 (list/{code}.xml) */
function observationXmlRows(xml: string, kind: 'water' | 'rain'): Record<string, unknown>[] {
  const tags =
    kind === 'water'
      ? ['Waterlevel', 'waterlevel', 'WaterlevelInfo']
      : ['Rainfall', 'rainfall'];
  for (const tag of tags) {
    const rows = parseHrfcoXmlBlocks(xml, tag);
    if (rows.length > 0) return rows;
  }
  return [];
}

export function parseWaterObservations(raw: unknown, fallbackCode?: string): ParsedObservation[] {
  if (typeof raw === 'string' && raw.includes('<')) {
    return rowsToWaterObservations(observationXmlRows(raw, 'water'), fallbackCode);
  }
  return rowsToWaterObservations(extractContentRows(raw), fallbackCode);
}

export function parseRainObservations(raw: unknown, fallbackCode?: string): ParsedObservation[] {
  if (typeof raw === 'string' && raw.includes('<')) {
    return rowsToRainObservations(observationXmlRows(raw, 'rain'), fallbackCode);
  }
  return rowsToRainObservations(extractContentRows(raw), fallbackCode);
}

/** ymdhm 기준 최신 1건 */
export function pickLatestObservation(items: ParsedObservation[]): ParsedObservation | null {
  if (items.length === 0) return null;
  let best = items[0];
  for (const it of items) {
    if ((it.observedAt || '') > (best.observedAt || '')) best = it;
  }
  return best;
}

export function inBbox(
  lon: number,
  lat: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean {
  return lon >= minX && lon <= maxX && lat >= minY && lat <= maxY;
}

export type ParsedFloodForecast = {
  ancdt: string;
  ancnm: string;
  fctdt: string;
  kind: string;
  no: string;
  obsnm: string;
  rvrnm: string;
  sttcurdt: string;
  sttcurhgt: string;
  sttcursealvl: string;
  sttnm: string;
  wrnaranm: string;
};

function rowsToFloodForecasts(rows: Record<string, unknown>[]): ParsedFloodForecast[] {
  const out: ParsedFloodForecast[] = [];
  for (const row of rows) {
    const sttnm = pickField(row, 'STTNM', 'sttnm');
    if (!sttnm) continue;
    out.push({
      ancdt: pickField(row, 'ANCDT', 'ancdt'),
      ancnm: pickField(row, 'ANCNM', 'ancnm'),
      fctdt: pickField(row, 'FCTDT', 'fctdt'),
      kind: pickField(row, 'KIND', 'kind'),
      no: pickField(row, 'NO', 'no'),
      obsnm: pickField(row, 'OBSNM', 'obsnm'),
      rvrnm: pickField(row, 'RVRNM', 'rvrnm'),
      sttcurdt: pickField(row, 'STTCURDT', 'sttcurdt'),
      sttcurhgt: pickField(row, 'STTCURHGT', 'sttcurhgt'),
      sttcursealvl: pickField(row, 'STTCURSEALVL', 'sttcursealvl'),
      sttnm,
      wrnaranm: pickField(row, 'WRNARANM', 'wrnaranm'),
    });
  }
  return out;
}

/** fldfct/list.xml — 최근 24시간은 API 기본 제공. 클라이언트에서 STTNM∈code 필터 */
export function parseFloodForecasts(raw: unknown): ParsedFloodForecast[] {
  if (typeof raw === 'string' && raw.includes('<')) {
    for (const tag of ['Fldfct', 'fldfct', 'FloodForecast', 'content']) {
      const rows = parseHrfcoXmlBlocks(raw, tag);
      if (rows.length > 0) return rowsToFloodForecasts(rows);
    }
    return [];
  }
  return rowsToFloodForecasts(extractContentRows(raw));
}

/** ANCDT 등 yyyyMMddHHmm(ss) → Date. 파싱 실패 시 null */
export function parseForecastAncdt(raw: string): Date | null {
  const s = raw.replace(/\D/g, '');
  if (s.length < 8) return null;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const h = s.length >= 10 ? Number(s.slice(8, 10)) : 0;
  const mi = s.length >= 12 ? Number(s.slice(10, 12)) : 0;
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  const dt = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export type HrfcoFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; body: FloodApiErrorBody };

function looksLikeXmlError(text: string): number | null {
  const m =
    /<result[^>]*>\s*(\d{3})\s*<\/result>/i.exec(text) ||
    /<code[^>]*>\s*(\d{3})\s*<\/code>/i.exec(text);
  if (m) return Number(m[1]);
  return extractHrfcoCode(text);
}

/**
 * HRFCO GET (xml|json).
 * @param options.quietCodes — 해당 HRFCO 코드는 로그 생략 (배치 평균 시 990 등)
 */
export async function fetchHrfco(
  apiKey: string,
  path: string,
  format: 'json' | 'xml' = 'json',
  options?: { quietCodes?: number[] }
): Promise<HrfcoFetchResult> {
  const quietCodes = new Set(options?.quietCodes ?? []);
  const url = hrfcoUrl(apiKey, path);
  const urlForLog = hrfcoUrlForLog(apiKey, path);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: format === 'xml' ? 'application/xml,text/xml,*/*' : 'application/json' },
      next: { revalidate: 0 },
    });
    const text = await res.text();

    if (format === 'xml') {
      const codeFromBody = looksLikeXmlError(text);
      const hasEntities =
        /<(WaterlevelInfo|Waterlevel|Rainfall|Fldfct|fldfct|content)\b/i.test(text);
      const looksLikeError =
        codeFromBody != null &&
        (codeFromBody >= 900 ||
          (codeFromBody >= 400 && codeFromBody < 600 && !hasEntities));

      if (!res.ok || looksLikeError) {
        const body = buildFloodErrorBody(
          codeFromBody ?? (res.ok ? null : res.status),
          res.status >= 500 ? 'provider' : 'ours',
          !res.ok ? `HTTP ${res.status}` : undefined
        );
        if (codeFromBody == null || !quietCodes.has(codeFromBody)) {
          logFloodError(path, body, urlForLog);
        }
        return { ok: false, status: res.status >= 400 ? res.status : 502, body };
      }
      return { ok: true, data: text };
    }

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    const codeFromBody = extractHrfcoCode(parsed, res.status);
    const rows = extractContentRows(parsed);
    const looksLikeError =
      codeFromBody != null &&
      (codeFromBody >= 900 ||
        (codeFromBody >= 400 && codeFromBody < 600 && rows.length === 0));

    if (!res.ok || looksLikeError) {
      const body = buildFloodErrorBody(
        codeFromBody ?? (res.ok ? null : res.status),
        res.status >= 500 ? 'provider' : 'ours',
        !res.ok ? `HTTP ${res.status}` : undefined
      );
      if (codeFromBody == null || !quietCodes.has(codeFromBody)) {
        logFloodError(path, body, urlForLog);
      }
      return { ok: false, status: res.status >= 400 ? res.status : 502, body };
    }

    return { ok: true, data: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const body = buildFloodErrorBody(null, 'ours', msg);
    logFloodError(path, body, urlForLog);
    return { ok: false, status: 502, body };
  }
}

export async function fetchHrfcoJson(apiKey: string, path: string): Promise<HrfcoFetchResult> {
  return fetchHrfco(apiKey, path, 'json');
}
