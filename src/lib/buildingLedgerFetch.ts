/**
 * 건축물대장 공공데이터 조회 (서버) — 필지분석 4-C·우클릭 필지정보 공유
 */
import { getLandLinkageConfig, getParcelAnalysisTuning } from '@/service/configService';
import {
  getBuildingLedgersFromCache,
  upsertBuildingLedgerCache,
} from '@/lib/buildingLedgerCache';

export type BuildingLedgerRawRow = Record<string, string>;

type LedgerUpstreamResult =
  | { kind: 'data'; rows: BuildingLedgerRawRow[] }
  | { kind: 'empty' }
  | { kind: 'error' };

type BuildingLedgerApiParcel = {
  pnu: string;
  jibun: string;
  row: BuildingLedgerDisplayRow | null;
  cacheable: boolean;
};

function buildPnuQueryParams(pnu: string): URLSearchParams {
  const sigunguCd = pnu.slice(0, 5);
  const bjdongCd = pnu.slice(5, 10);
  const platGbCd = String(Math.max(Number(pnu.slice(10, 11)) - 1, 0));
  const bun = pnu.slice(11, 15);
  const ji = pnu.slice(15, 19);
  const qs = new URLSearchParams();
  qs.set('sigunguCd', sigunguCd);
  qs.set('bjdongCd', bjdongCd);
  qs.set('platGbCd', platGbCd);
  qs.set('bun', bun);
  qs.set('ji', ji);
  qs.set('numOfRows', '10');
  qs.set('pageNo', '1');
  qs.set('format', 'json');
  return qs;
}

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
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) return { kind: 'error' };
    if (text.trim().startsWith('{')) {
      return parseJsonLedgerUpstream(text);
    }
    const xmlRows = parseXmlRows(text);
    return xmlRows.length ? { kind: 'data', rows: xmlRows } : { kind: 'empty' };
  } catch {
    return { kind: 'error' };
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
};

function getField(row: BuildingLedgerRawRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function formatJibun(row: BuildingLedgerRawRow): string {
  const mnnm = Number(getField(row, 'mnnm', 'mnnm'));
  const slno = Number(getField(row, 'slno', 'slno'));
  if (!Number.isFinite(mnnm)) return '-';
  return `${mnnm}${Number.isFinite(slno) && slno !== 0 ? `-${slno}` : ''}`;
}

function formatRoadAddr(row: BuildingLedgerRawRow): string {
  const roadNm = getField(row, 'na_road_cd_nm', 'naRoadCdNm');
  if (!roadNm) return '-';
  const parts = [
    getField(row, 'sigungu_cd_nm', 'sigunguCdNm'),
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

export function normalizeBuildingLedgerRow(pnu: string, addr: string, row: BuildingLedgerRawRow): BuildingLedgerDisplayRow {
  const bldNm = [getField(row, 'bld_nm', 'bldNm'), getField(row, 'dong_nm', 'dongNm')]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    pnu,
    addr,
    bldNm: bldNm || '-',
    platLoc:
      [getField(row, 'sigungu_cd_nm', 'sigunguCdNm'), getField(row, 'bjdong_cd_nm', 'bjdongCdNm')]
        .filter(Boolean)
        .join(' ')
        .trim() || '-',
    jibun: formatJibun(row),
    roadAddr: formatRoadAddr(row),
    bcRat: formatUnit(getField(row, 'bcrat', 'bcRat'), '%'),
    vlRat: formatUnit(getField(row, 'vlrat', 'vlRat'), '%'),
    jijigu: getField(row, 'jijigu_nm', 'jijiguNm') || '-',
    platArea: formatUnit(getField(row, 'plat_area', 'platArea'), '㎡'),
    totArea: formatUnit(getField(row, 'totarea', 'totArea'), '㎡'),
  };
}

function hasLedgerDisplayData(row: BuildingLedgerDisplayRow): boolean {
  return [row.bldNm, row.totArea, row.platArea, row.platLoc, row.jibun].some((v) => v && v !== '-');
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
): Promise<BuildingLedgerApiParcel[]> {
  return mapPool(parcels, concurrency, async (parcel) => {
    const upstream = await fetchLedgerUpstream(parcel.pnu, dataPortalKey);
    if (upstream.kind === 'error') {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null, cacheable: false };
    }
    if (upstream.kind === 'empty') {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null, cacheable: true };
    }
    const first = upstream.rows[0];
    if (!first) {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null, cacheable: true };
    }
    const normalized = normalizeBuildingLedgerRow(parcel.pnu, parcel.jibun || parcel.pnu, first);
    const row = hasLedgerDisplayData(normalized) ? normalized : null;
    return { pnu: parcel.pnu, jibun: parcel.jibun, row, cacheable: true };
  });
}

/** PNU 목록 건축물대장 조회 (캐시 → API, 표제부 1건 우선) */
export async function fetchBuildingLedgersByPnus(params: {
  parcels?: Array<{ pnu?: string; jibun?: string }>;
  concurrency?: number;
}): Promise<{ ok: boolean; rows: BuildingLedgerDisplayRow[]; error?: string }> {
  const { dataPortalKey } = getLandLinkageConfig();
  if (!dataPortalKey) return { ok: true, rows: [] };

  const input = Array.isArray(params.parcels) ? params.parcels : [];
  const unique = [...new Map(
    input
      .map((p) => ({
        pnu: String(p.pnu ?? '').trim(),
        jibun: String(p.jibun ?? '').trim(),
      }))
      .filter((p) => /^\d{19}$/.test(p.pnu))
      .map((p) => [p.pnu, p])
  ).values()].slice(0, BUILDING_PNU_CAP);

  if (!unique.length) return { ok: true, rows: [] };

  const concurrency = Math.max(
    1,
    Math.min(16, params.concurrency ?? getParcelAnalysisTuning().buildingConcurrency)
  );

  try {
    const pnus = unique.map((p) => p.pnu);
    const { cachedPnus, rows: cachedRows } = await getBuildingLedgersFromCache(pnus);
    const missing = unique.filter((p) => !cachedPnus.has(p.pnu));

    const fetchedRows: BuildingLedgerDisplayRow[] = [...cachedRows];
    if (missing.length) {
      const apiResults = await fetchBuildingLedgersFromApi(missing, dataPortalKey, concurrency);
      void upsertBuildingLedgerCache(
        apiResults
          .filter((r) => r.cacheable)
          .map((r) => ({ pnu: r.pnu, row: r.row, addr: r.jibun || r.pnu }))
      ).catch(() => undefined);
      for (const r of apiResults) {
        if (r.row) fetchedRows.push(r.row);
      }
    }

    return { ok: true, rows: fetchedRows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, rows: [], error: msg };
  }
}
