/**
 * 공공데이터포털 건축물대장·인허가 — 브라우저 직접 호출용.
 * apis.data.go.kr 는 Origin 반영 CORS 허용. 폐쇄 서버 아웃바운드와 무관하게 PC에서 조회한다.
 */

import { buildPnuQueryParams } from '@/lib/parcelLandNormalize';

export type DataPortalBuildingKind = 'ledger' | 'recap' | 'floor' | 'arch' | 'housing';

const PORTAL_URL: Record<DataPortalBuildingKind, string> = {
  ledger: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
  recap: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo',
  floor: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo',
  arch: 'https://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo',
  housing: 'https://apis.data.go.kr/1613000/HsPmsHubService/getHpBasisOulnInfo',
};

export type PortalRawRow = Record<string, string>;

export function buildDataPortalBuildingUrl(
  kind: DataPortalBuildingKind,
  pnu: string,
  serviceKey: string,
  extras?: { numOfRows?: string; pageNo?: string }
): string {
  const qs = buildPnuQueryParams(pnu);
  qs.set('serviceKey', serviceKey);
  if (extras?.numOfRows) qs.set('numOfRows', extras.numOfRows);
  if (extras?.pageNo) qs.set('pageNo', extras.pageNo);
  return `${PORTAL_URL[kind]}?${qs.toString()}`;
}

function getField(row: PortalRawRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function portalRegisterType(row: PortalRawRow): string {
  const kind = getField(
    row,
    'regstrKindCdNm',
    'regstr_kind_cd_nm',
    'regstrGbCdNm',
    'regstr_gb_cd_nm'
  );
  if (kind.includes('총괄')) return '총괄표제부';
  if (kind.includes('일반')) return '일반건축물';
  if (kind.includes('표제')) return '표제부';
  return '표제부';
}

function portalPk(row: PortalRawRow): string {
  return getField(row, 'mgmBldrgstPk', 'mgm_bldrgst_pk', 'comm_bld_esnc_no');
}

export function toPortalRegisterRow(
  row: PortalRawRow,
  type: string
): Record<string, unknown> {
  const pk = portalPk(row);
  return {
    ...row,
    type,
    source: 'portal',
    bldrgst_seqno: pk,
    comm_bld_esnc_no: getField(row, 'comm_bld_esnc_no') || pk,
    bld_nm: getField(row, 'bldNm', 'bld_nm'),
    dong_nm: getField(row, 'dongNm', 'dong_nm'),
    main_prpos_cd_nm: getField(row, 'mainPurpsCdNm', 'main_prpos_cd_nm'),
    main_strct_cd_nm: getField(row, 'mainStrctCdNm', 'strctCdNm', 'strct_cd_nm', 'main_strct_cd_nm'),
    strct_cd_nm: getField(row, 'strctCdNm', 'strct_cd_nm', 'mainStrctCdNm'),
    totarea: getField(row, 'totArea', 'totarea'),
    plat_area: getField(row, 'platArea', 'plat_area'),
    arch_area: getField(row, 'archArea', 'arch_area'),
    bcrat: getField(row, 'bcRat', 'bcrat'),
    vlrat: getField(row, 'vlRat', 'vlrat'),
    vlrat_calc_totarea: getField(row, 'vlRatEstmTotArea', 'vlrat_calc_totarea'),
    ugrnd_flrcnt: getField(row, 'ugrndFlrCnt', 'ugrnd_flrcnt'),
    grnd_flrcnt: getField(row, 'grndFlrCnt', 'grnd_flrcnt'),
    heit: getField(row, 'heit'),
    roof_cd_nm: getField(row, 'roofCdNm', 'roof_cd_nm'),
    ho_cnt: getField(row, 'hoCnt', 'ho_cnt'),
    fmly_cnt: getField(row, 'fmlyCnt', 'fmly_cnt'),
    hhldcnt: getField(row, 'hhldCnt', 'hhldcnt'),
    atch_bild_cnt: getField(row, 'atchBldCnt', 'atch_bild_cnt'),
    atch_bild_area: getField(row, 'atchBldArea', 'atch_bild_area'),
    tot_pkng_cnt: getField(row, 'totPkngCnt', 'tot_pkng_cnt'),
    main_bild_cnt: getField(row, 'mainBldCnt', 'main_bild_cnt', 'mainBildCnt'),
    plat_plc: getField(row, 'platPlc', 'plat_plc'),
    new_plat_plc: getField(row, 'newPlatPlc', 'new_plat_plc'),
    sigungu_cd_nm: getField(row, 'sigunguCdNm', 'sigungu_cd_nm'),
    bjdong_cd_nm: getField(row, 'bjdongCdNm', 'bjdong_cd_nm'),
    mnnm: getField(row, 'mnnm'),
    slno: getField(row, 'slno'),
    violbld_yn: getField(row, 'violBldYn', 'violbld_yn'),
    spcmt_cntt: getField(row, 'spcmtCntt', 'spcmt_cntt'),
    flrno_nm: getField(row, 'flrNoNm', 'flrno_nm'),
    area: getField(row, 'area'),
  };
}

export function matchPortalDong(row: PortalRawRow, bldNm: string): boolean {
  const want = bldNm.trim();
  if (!want) return true;
  const names = [getField(row, 'dongNm', 'dong_nm'), getField(row, 'bldNm', 'bld_nm')];
  return names.some((n) => n && (n === want || n.includes(want) || want.includes(n)));
}

/** XML item 행 — 브라우저 DOMParser / 서버 정규식 공용은 호출측에서 파싱 */
export function parsePortalJsonRows(text: string): PortalRawRow[] {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{')) return [];
  try {
    type Envelope = {
      header?: { resultCode?: string };
      body?: { items?: unknown };
    };
    const json = JSON.parse(trimmed) as Envelope & {
      response?: Envelope;
      OpenAPI_ServiceResponse?: unknown;
    };
    if (json.OpenAPI_ServiceResponse) return [];
    const root = json.response ?? json;
    const code = String(root.header?.resultCode ?? '').trim();
    if (code && code !== '00' && code !== '03') return [];
    const rawItems = root.body?.items;
    if (rawItems == null || rawItems === '') return [];

    let list: unknown[] = [];
    if (Array.isArray(rawItems)) {
      list = rawItems;
    } else if (typeof rawItems === 'object') {
      const item = (rawItems as { item?: unknown }).item;
      if (item == null) return [];
      list = Array.isArray(item) ? item : [item];
    } else {
      return [];
    }

    return list.map((row) => {
      const out: PortalRawRow = {};
      if (!row || typeof row !== 'object') return out;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s) out[k] = s;
      }
      return out;
    });
  } catch {
    return [];
  }
}

export function parsePortalXmlRows(xmlText: string): PortalRawRow[] {
  if (!xmlText || typeof DOMParser === 'undefined') {
    const rows: PortalRawRow[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xmlText)) !== null) {
      const block = m[1] ?? '';
      const row: PortalRawRow = {};
      const fieldRe = /<([^>/]+)>([\s\S]*?)<\/\1>/g;
      let field: RegExpExecArray | null;
      while ((field = fieldRe.exec(block)) !== null) {
        row[field[1]!] = field[2]!.trim();
      }
      if (Object.keys(row).length) rows.push(row);
    }
    return rows;
  }
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'text/xml');
  return Array.from(xml.getElementsByTagName('item')).map((item) => {
    const row: PortalRawRow = {};
    for (const child of Array.from(item.children)) {
      row[child.tagName] = child.textContent?.trim() ?? '';
    }
    return row;
  });
}

export function parsePortalRows(text: string): PortalRawRow[] {
  const jsonRows = parsePortalJsonRows(text);
  if (jsonRows.length) return jsonRows;
  return parsePortalXmlRows(text);
}

export type PortalFetchResult = {
  status: number;
  text: string;
  transient: boolean;
};

function isPortalTransientFailure(status: number, text: string): boolean {
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  const t = String(text ?? '').toLowerCase();
  return (
    t.includes('service_timeout') ||
    t.includes('servicetimeout') ||
    t.includes('연결실패') ||
    t.includes('http_error') ||
    t.includes('failed to fetch') ||
    /\breturnreasoncode["\s:]*["']?0[45]\b/.test(t)
  );
}

async function fetchOnce(url: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, text: msg };
  }
}

export async function fetchDataPortalBuildingText(
  url: string,
  opts?: { retryMax?: number; retryDelayMs?: number }
): Promise<PortalFetchResult> {
  const retryMax = opts?.retryMax ?? 2;
  const retryDelayMs = opts?.retryDelayMs ?? 500;
  let last = { status: 0, text: '' };
  for (let attempt = 0; attempt <= retryMax; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
    last = await fetchOnce(url);
    const transient = isPortalTransientFailure(last.status, last.text);
    if (!transient) return { ...last, transient: false };
  }
  return { ...last, transient: true };
}

export type ClientPortalRegisterResult = {
  ok: boolean;
  mode: 'recap' | 'title' | null;
  buildings: Record<string, unknown>[];
  children: Record<string, unknown>[];
  notice?: string;
};

async function portalOpRowsClient(
  pnu: string,
  serviceKey: string,
  kind: 'ledger' | 'recap' | 'floor'
): Promise<{ rows: PortalRawRow[]; notice?: string; transient?: boolean }> {
  const url = buildDataPortalBuildingUrl(kind, pnu, serviceKey, { numOfRows: '100' });
  const res = await fetchDataPortalBuildingText(url);
  if (res.transient) {
    return {
      rows: [],
      notice: '공공데이터포털 연결이 불안정합니다. 잠시 후 다시 조회해 주세요',
      transient: true,
    };
  }
  return { rows: parsePortalRows(res.text) };
}

export async function fetchPortalBuildingRegisterClient(params: {
  pnu: string;
  serviceKey: string;
}): Promise<ClientPortalRegisterResult> {
  const pnu = String(params.pnu ?? '').trim();
  const key = String(params.serviceKey ?? '').trim();
  if (!/^\d{19}$/.test(pnu) || !key) {
    return { ok: true, mode: null, buildings: [], children: [] };
  }

  const recap = await portalOpRowsClient(pnu, key, 'recap');
  const titles = await portalOpRowsClient(pnu, key, 'ledger');
  const notice = recap.notice || titles.notice;

  if (recap.rows.length) {
    return {
      ok: true,
      mode: 'recap',
      buildings: recap.rows.map((r) => toPortalRegisterRow(r, '총괄표제부')),
      children: titles.rows.map((r) => toPortalRegisterRow(r, portalRegisterType(r))),
      notice,
    };
  }

  if (titles.rows.length) {
    const buildings = titles.rows.map((r) => toPortalRegisterRow(r, portalRegisterType(r)));
    const floors = await fetchPortalBuildingFloorListClient({
      pnu,
      serviceKey: key,
      seqNo: String(buildings[0]?.bldrgst_seqno ?? ''),
    });
    return { ok: true, mode: 'title', buildings, children: floors.children, notice };
  }

  return { ok: true, mode: null, buildings: [], children: [], notice };
}

export async function fetchPortalBuildingFloorListClient(params: {
  pnu: string;
  serviceKey: string;
  seqNo?: string;
}): Promise<{ ok: boolean; children: Record<string, unknown>[] }> {
  const pnu = String(params.pnu ?? '').trim();
  const key = String(params.serviceKey ?? '').trim();
  const seqNo = String(params.seqNo ?? '').trim();
  if (!/^\d{19}$/.test(pnu) || !key) return { ok: true, children: [] };
  const floors = await portalOpRowsClient(pnu, key, 'floor');
  let rows = floors.rows;
  if (seqNo) {
    const filtered = rows.filter((r) => portalPk(r) === seqNo);
    if (filtered.length) rows = filtered;
  }
  return { ok: true, children: rows.map((r) => toPortalRegisterRow(r, '층')) };
}

export async function fetchPortalBuildingRegisterByDongClient(params: {
  pnu: string;
  serviceKey: string;
  bldNm: string;
}): Promise<{
  ok: boolean;
  buildings: Record<string, unknown>[];
  children: Record<string, unknown>[];
}> {
  const pnu = String(params.pnu ?? '').trim();
  const key = String(params.serviceKey ?? '').trim();
  const bldNm = String(params.bldNm ?? '').trim();
  if (!/^\d{19}$/.test(pnu) || !key) return { ok: true, buildings: [], children: [] };
  const titles = await portalOpRowsClient(pnu, key, 'ledger');
  const pick = titles.rows.filter((r) => matchPortalDong(r, bldNm));
  if (!pick.length) return { ok: true, buildings: [], children: [] };
  const buildings = pick.map((r) => toPortalRegisterRow(r, portalRegisterType(r)));
  const floors = await fetchPortalBuildingFloorListClient({
    pnu,
    serviceKey: key,
    seqNo: String(buildings[0]?.bldrgst_seqno ?? ''),
  });
  return { ok: true, buildings, children: floors.children };
}
