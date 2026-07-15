/**
 * 건축물대장 공공데이터 조회 (서버 전용) — 필지분석·우클릭은 call로만 사용.
 * 클라이언트에서 이 파일을 import하면 안 된다(pg/fs 번들 오류).
 */
import { getLandLinkageConfig } from '@/service/configService';
import {
  PARCEL_ANALYSIS_BUILDING_CONCURRENCY,
  PARCEL_ANALYSIS_BUILDING_TIMEOUT_MS,
} from '@/lib/parcelAnalysisTheme';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { buildPnuQueryParams } from '@/lib/parcelLandNormalize';

export type BuildingLedgerRawRow = Record<string, string>;

type LedgerUpstreamResult =
  | { kind: 'data'; rows: BuildingLedgerRawRow[] }
  | { kind: 'empty' }
  | { kind: 'error'; reason?: 'quota' | 'other' };

type BuildingLedgerApiParcel = {
  pnu: string;
  jibun: string;
  row: BuildingLedgerDisplayRow | null;
  quota?: boolean;
};

/** 공공데이터포털 일일/트래픽 호출 한도 초과 여부 */
export function isDataPortalQuotaMessage(status: number, text: string): boolean {
  if (status === 429) return true;
  const t = String(text ?? '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('quota') ||
    t.includes('limit exceed') ||
    (t.includes('트래픽') && t.includes('초과')) ||
    (t.includes('호출') && t.includes('한도'))
  );
}

export const BUILDING_LEDGER_PORTAL_QUOTA_NOTICE =
  '공공데이터포털 호출 한도(쿼터)를 초과해 건축물대장을 가져오지 못했습니다. 한도 회복 후 다시 조회하세요.';


function toRowStrings(raw: Record<string, unknown>): BuildingLedgerRawRow {
  const out: BuildingLedgerRawRow = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return out;
}

function parseXmlRows(xmlText: string): BuildingLedgerRawRow[] {
  const rows: BuildingLedgerRawRow[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const row: BuildingLedgerRawRow = {};
    const fieldRegex = /<([^>/]+)>([\s\S]*?)<\/\1>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRegex.exec(block)) !== null) {
      row[field[1]] = field[2].trim();
    }
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

async function fetchLedgerUpstream(pnu: string, serviceKey: string): Promise<LedgerUpstreamResult> {
  const qs = buildPnuQueryParams(pnu);
  qs.set('serviceKey', serviceKey);
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?${qs.toString()}`;
  const timeoutMs = PARCEL_ANALYSIS_BUILDING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    if (isDataPortalQuotaMessage(res.status, text)) {
      return { kind: 'error', reason: 'quota' };
    }
    if (!res.ok) return { kind: 'error', reason: 'other' };
    if (text.trim().startsWith('{')) {
      return parseJsonLedgerUpstream(text);
    }
    const xmlRows = parseXmlRows(text);
    return xmlRows.length ? { kind: 'data', rows: xmlRows } : { kind: 'empty' };
  } catch {
    return { kind: 'error', reason: 'other' };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonLedgerUpstream(text: string): LedgerUpstreamResult {
  try {
    const json = JSON.parse(text) as {
      response?: {
        header?: { resultCode?: string };
        body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } };
      };
    };
    const code = String(json.response?.header?.resultCode ?? '').trim();
    if (code && code !== '00' && code !== '03') return { kind: 'error' };
    const item = json.response?.body?.items?.item;
    if (!item) return { kind: 'empty' };
    const list = Array.isArray(item) ? item : [item];
    const rows = list.map((row) => toRowStrings(row));
    return rows.length ? { kind: 'data', rows } : { kind: 'empty' };
  } catch {
    return { kind: 'error' };
  }
}

export type BuildingLedgerSource = 'seum' | 'portal';

export type BuildingLedgerDisplayRow = {
  pnu: string;
  addr: string;
  bldNm: string;
  platLoc: string;
  jibun: string;
  roadAddr: string;
  bcRat: string;
  vlRat: string;
  jijigu: string;
  platArea: string;
  totArea: string;
  source?: BuildingLedgerSource;
};

function getField(row: BuildingLedgerRawRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

/** 끝 괄호 법정동 표기 제거 — 예: `영양창수로 53 (영양읍 동부리)` → `영양창수로 53` */
function stripTrailingParen(raw: string): string {
  return String(raw ?? '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
}

/** 행정 위치에서 읍·면부터 리·동·가까지 남김 — 예: `영양읍 동부리` 그대로 */
function pickRiOrDong(loc: string): string {
  const parts = String(loc ?? '')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const start = parts.findIndex((p) => /(읍|면|동|리|가)$/u.test(p));
  if (start >= 0) {
    let end = start;
    for (let i = parts.length - 1; i >= start; i--) {
      if (/(읍|면|동|리|가)$/u.test(parts[i]!)) {
        end = i;
        break;
      }
    }
    return parts.slice(start, end + 1).join(' ');
  }
  return parts.join(' ') || String(loc ?? '').trim();
}

/** 본·부번에 `번지` 접미 (이미 있으면 유지) */
function withBeonjiSuffix(lot: string): string {
  const t = String(lot ?? '').trim();
  if (!t || t === '-') return t || '-';
  if (/번지$/u.test(t)) return t;
  if (/^산?\d+(?:-\d+)?$/u.test(t)) return `${t}번지`;
  return t;
}

/**
 * 대지위치 원문 → 읍·면·리·동 + 지번 분리
 * 예: `경상북도 영양군 영양읍 동부리 128번지` → `{ loc: '영양읍 동부리', lot: '128번지' }`
 */
function splitPlatLocAndLot(raw: string): { loc: string; lot: string } {
  let s = formatAddressStripSidoSigungu(raw) || String(raw ?? '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s === '-') return { loc: '-', lot: '-' };

  let loc = s;
  let lot = '';
  const withBeonji = s.match(/^(.*?)(?:\s+)?(산?\d+(?:-\d+)?)\s*번지\s*$/u);
  if (withBeonji && withBeonji[1]?.trim()) {
    loc = withBeonji[1].trim();
    lot = withBeonji[2] ?? '';
  } else {
    const bare = s.match(/^(.*\S)\s+(산?\d+(?:-\d+)?)\s*$/u);
    if (bare && bare[1]?.trim()) {
      loc = bare[1].trim();
      lot = bare[2] ?? '';
    }
  }

  loc = pickRiOrDong(loc) || '-';
  lot = lot ? withBeonjiSuffix(lot) : '-';
  return { loc, lot };
}

function shortenBuildingPlatLoc(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t || t === '-') return t || '-';
  return splitPlatLocAndLot(t).loc;
}

function shortenBuildingRoadAddr(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t || t === '-') return t || '-';
  let s = formatAddressStripSidoSigungu(t) || t;
  s = stripTrailingParen(s);
  return s || '-';
}

function formatJibun(row: BuildingLedgerRawRow): string {
  const mnnmRaw = getField(row, 'mnnm', 'mnnm');
  const slnoRaw = getField(row, 'slno', 'slno');
  if (mnnmRaw) {
    const mnnm = Number(mnnmRaw);
    const slno = Number(slnoRaw);
    if (Number.isFinite(mnnm)) {
      const base = `${mnnm}${Number.isFinite(slno) && slno !== 0 ? `-${slno}` : ''}`;
      return withBeonjiSuffix(base);
    }
  }
  return '-';
}

function formatRoadAddr(row: BuildingLedgerRawRow): string {
  // newPlatPlc 등은 전체 도로명주소(괄호 법정동 포함)인 경우가 많음 → 축약만
  const full = getField(row, 'newPlatPlc', 'roadAddr', 'road_addr');
  if (full && (/\(|로|길|대로/u.test(full) || full.length > 4)) {
    const shortened = shortenBuildingRoadAddr(full);
    if (shortened && shortened !== '-') return shortened;
  }
  const roadNm = getField(row, 'na_road_cd_nm', 'naRoadCdNm');
  if (!roadNm) return '-';
  const parts = [
    roadNm,
    getField(row, 'na_mnnm', 'naMnnm') ? Number(getField(row, 'na_mnnm', 'naMnnm')) : '',
    getField(row, 'na_slno', 'naSlno') && Number(getField(row, 'na_slno', 'naSlno')) !== 0
      ? `-${Number(getField(row, 'na_slno', 'naSlno'))}`
      : '',
  ].filter(Boolean);
  return shortenBuildingRoadAddr(parts.join(' ').trim()) || '-';
}

function formatUnit(value: string, unit: string): string {
  const v = String(value ?? '').trim();
  return v ? `${v}${unit}` : '-';
}

export function normalizeBuildingLedgerRow(
  pnu: string,
  addr: string,
  row: BuildingLedgerRawRow
): BuildingLedgerDisplayRow {
  const bldNm = [getField(row, 'bld_nm', 'bldNm'), getField(row, 'dong_nm', 'dongNm')]
    .filter(Boolean)
    .join(' ')
    .trim();

  const platPlc = getField(row, 'plat_plc', 'platPlc');
  const bjdong = getField(row, 'bjdong_cd_nm', 'bjdongCdNm');
  const fromPlat = platPlc ? splitPlatLocAndLot(platPlc) : { loc: '-', lot: '-' };

  let platLoc = fromPlat.loc;
  let jibun = formatJibun(row);
  if (isMissingAddressPart(jibun) && !isMissingAddressPart(fromPlat.lot)) {
    jibun = fromPlat.lot;
  }
  if (isMissingAddressPart(platLoc) && bjdong) {
    platLoc = pickRiOrDong(formatAddressStripSidoSigungu(bjdong) || bjdong) || '-';
  }

  return {
    pnu,
    addr: formatAddressStripSidoSigungu(addr) || addr || '-',
    bldNm: bldNm || '-',
    platLoc: isMissingAddressPart(platLoc) ? '-' : platLoc,
    jibun: isMissingAddressPart(jibun) ? '-' : jibun,
    roadAddr: formatRoadAddr(row),
    bcRat: formatUnit(getField(row, 'bcrat', 'bcRat'), '%'),
    vlRat: formatUnit(getField(row, 'vlrat', 'vlRat'), '%'),
    jijigu: getField(row, 'jijigu_nm', 'jijiguNm') || '-',
    platArea: formatUnit(getField(row, 'plat_area', 'platArea'), '㎡'),
    totArea: formatUnit(getField(row, 'totarea', 'totArea'), '㎡'),
  };
}

function isMissingAddressPart(value: string | undefined): boolean {
  const v = String(value ?? '').trim();
  return !v || v === '-';
}

function fillBuildingLedgerAddressFromParts(
  row: BuildingLedgerDisplayRow,
  parts?: { platLoc?: string; lot?: string } | null
): BuildingLedgerDisplayRow {
  if (!parts) return row;
  const platLoc = isMissingAddressPart(row.platLoc)
    ? shortenBuildingPlatLoc(parts.platLoc ?? '')
    : row.platLoc;
  const jibun = isMissingAddressPart(row.jibun)
    ? withBeonjiSuffix(String(parts.lot ?? '').trim()) || row.jibun
    : row.jibun;
  return {
    ...row,
    platLoc: isMissingAddressPart(platLoc) ? row.platLoc : platLoc,
    jibun: isMissingAddressPart(jibun) ? row.jibun : jibun,
  };
}

function hasLedgerDisplayData(row: BuildingLedgerDisplayRow): boolean {
  return [row.bldNm, row.totArea, row.platArea, row.platLoc, row.jibun].some(
    (v) => v && v !== '-'
  );
}

const BUILDING_PNU_CAP = 100;

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchBuildingLedgersFromApi(
  parcels: Array<{ pnu: string; jibun: string }>,
  dataPortalKey: string,
  concurrency: number
): Promise<{ results: BuildingLedgerApiParcel[]; portalQuotaExceeded: boolean }> {
  let portalQuotaExceeded = false;
  const results = await mapPool(parcels, concurrency, async (parcel) => {
    const upstream = await fetchLedgerUpstream(parcel.pnu, dataPortalKey);
    if (upstream.kind === 'error' && upstream.reason === 'quota') {
      portalQuotaExceeded = true;
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null, quota: true };
    }
    if (upstream.kind === 'error' || upstream.kind === 'empty') {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null };
    }
    const first = upstream.rows[0];
    if (!first) {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null };
    }
    const normalized = normalizeBuildingLedgerRow(parcel.pnu, parcel.jibun || parcel.pnu, first);
    const row = hasLedgerDisplayData(normalized) ? normalized : null;
    return { pnu: parcel.pnu, jibun: parcel.jibun, row };
  });
  return { results, portalQuotaExceeded };
}

/** PNU 목록 건축물대장 — 세움터 → 공공데이터포털 (`jijuk_building_ledger` 캐시 미사용) */
export async function fetchBuildingLedgersByPnus(params: {
  parcels?: Array<{ pnu?: string; jibun?: string }>;
  concurrency?: number;
}): Promise<{
  ok: boolean;
  rows: BuildingLedgerDisplayRow[];
  error?: string;
  notice?: string;
  portalQuotaExceeded?: boolean;
}> {
  const cfg = getLandLinkageConfig();
  const { dataPortalKey } = cfg;

  const input = Array.isArray(params.parcels) ? params.parcels : [];
  const unique = [
    ...new Map(
      input
        .map((p) => ({
          pnu: String(p.pnu ?? '').trim(),
          jibun: String(p.jibun ?? '').trim(),
        }))
        .filter((p) => /^\d{19}$/.test(p.pnu))
        .map((p) => [p.pnu, p])
    ).values(),
  ].slice(0, BUILDING_PNU_CAP);

  if (!unique.length) return { ok: true, rows: [] };

  const concurrency = Math.max(
    1,
    Math.min(16, params.concurrency ?? PARCEL_ANALYSIS_BUILDING_CONCURRENCY)
  );

  try {
    const fetchedRows: BuildingLedgerDisplayRow[] = [];
    let remaining = unique;
    let portalQuotaExceeded = false;

    if (cfg.useSeum) {
      try {
        const { fetchSeumBuildingLedgersByPnus } = await import('@/service/seumService');
        const seumMap = await fetchSeumBuildingLedgersByPnus(remaining);
        for (const [pnu, row] of seumMap) {
          fetchedRows.push({ ...row, source: 'seum' });
        }
        remaining = remaining.filter((p) => !seumMap.has(p.pnu));
      } catch {
        /* 세움 실패 → 포털 */
      }
    }

    if (remaining.length && dataPortalKey) {
      const { results: apiResults, portalQuotaExceeded: quotaHit } = await fetchBuildingLedgersFromApi(
        remaining,
        dataPortalKey,
        concurrency
      );
      portalQuotaExceeded = quotaHit;
      for (const r of apiResults) {
        if (r.row) fetchedRows.push({ ...r.row, source: 'portal' });
      }
    }

    if (portalQuotaExceeded) {
      console.warn('[건축물대장]', BUILDING_LEDGER_PORTAL_QUOTA_NOTICE, {
        requested: unique.length,
        fromSeum: fetchedRows.filter((r) => r.source === 'seum').length,
        remainingPortal: remaining.length,
      });
    }

    const notice = portalQuotaExceeded ? BUILDING_LEDGER_PORTAL_QUOTA_NOTICE : undefined;

    if (!fetchedRows.length) {
      return { ok: true, rows: [], notice, portalQuotaExceeded };
    }

    try {
      const { resolvePlatLocAndLotByPnus } = await import('@/service/layerRowService');
      const needAddr = fetchedRows.filter(
        (r) => isMissingAddressPart(r.platLoc) || isMissingAddressPart(r.jibun)
      );
      if (needAddr.length) {
        const addrByPnu = await resolvePlatLocAndLotByPnus(needAddr.map((r) => r.pnu));
        return {
          ok: true,
          rows: fetchedRows.map((row) =>
            fillBuildingLedgerAddressFromParts(row, addrByPnu.get(row.pnu))
          ),
          notice,
          portalQuotaExceeded,
        };
      }
    } catch {
      /* 주소 보강 실패해도 건축물 행은 유지 */
    }

    return { ok: true, rows: fetchedRows, notice, portalQuotaExceeded };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, rows: [], error: msg };
  }
}
