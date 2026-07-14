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

function formatJibun(row: BuildingLedgerRawRow): string {
  const mnnmRaw = getField(row, 'mnnm', 'mnnm');
  const slnoRaw = getField(row, 'slno', 'slno');
  if (mnnmRaw) {
    const mnnm = Number(mnnmRaw);
    const slno = Number(slnoRaw);
    if (Number.isFinite(mnnm)) {
      return `${mnnm}${Number.isFinite(slno) && slno !== 0 ? `-${slno}` : ''}`;
    }
  }
  return '-';
}

function formatRoadAddr(row: BuildingLedgerRawRow): string {
  const roadNm = getField(row, 'na_road_cd_nm', 'naRoadCdNm', 'newPlatPlc', 'roadAddr', 'road_addr');
  if (!roadNm) return '-';
  // 시·군·구명은 붙이지 않음 — 도로명+건물본번만 (시·도 포함 시 아래 normalize에서 제거)
  const parts = [
    roadNm,
    getField(row, 'na_mnnm', 'naMnnm') ? Number(getField(row, 'na_mnnm', 'naMnnm')) : '',
    getField(row, 'na_slno', 'naSlno') && Number(getField(row, 'na_slno', 'naSlno')) !== 0
      ? `-${Number(getField(row, 'na_slno', 'naSlno'))}`
      : '',
  ].filter(Boolean);
  return parts.join(' ').trim() || '-';
}

function formatUnit(value: string, unit: string): string {
  const v = String(value ?? '').trim();
  return v ? `${v}${unit}` : '-';
}

function stripAdminOrDash(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t || t === '-') return t || '-';
  return formatAddressStripSidoSigungu(t) || t;
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
  const platLocRaw =
    [getField(row, 'bjdong_cd_nm', 'bjdongCdNm'), getField(row, 'plat_plc', 'platPlc')]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    [getField(row, 'sigungu_cd_nm', 'sigunguCdNm'), getField(row, 'bjdong_cd_nm', 'bjdongCdNm')]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    '-';
  return {
    pnu,
    addr: stripAdminOrDash(addr),
    bldNm: bldNm || '-',
    platLoc: stripAdminOrDash(platLocRaw),
    jibun: formatJibun(row),
    roadAddr: stripAdminOrDash(formatRoadAddr(row)),
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
    ? formatAddressStripSidoSigungu(parts.platLoc ?? '') || row.platLoc
    : row.platLoc;
  const jibun = isMissingAddressPart(row.jibun) ? String(parts.lot ?? '').trim() || row.jibun : row.jibun;
  return { ...row, platLoc: platLoc || row.platLoc, jibun: jibun || row.jibun };
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
