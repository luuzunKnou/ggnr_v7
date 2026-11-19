/**
 * 필지분석 건축물대장 — 공공데이터포털 배치를 브라우저에서 직접 호출.
 * 세움은 서버 조회 유지. 이 모듈은 세움 결과가 비었을 때만 쓴다.
 */
'use client';

import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import {
  buildDataPortalBuildingUrl,
  fetchDataPortalBuildingText,
  parsePortalRows,
  type PortalRawRow,
} from '@/lib/dataPortalBuildingClient';
import {
  PARCEL_ANALYSIS_BUILDING_CONCURRENCY,
  PARCEL_ANALYSIS_BUILDING_GAP_MS,
} from '@/lib/parcelAnalysisTheme';
import { fetchLandInfoConfig } from '@/lib/vworldParcelLandClient';

export type BuildingLedgerDisplayRowClient = {
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
  mgmBldrgstPk?: string;
  raw?: Record<string, string>;
  source?: 'seum' | 'portal';
};

export const BUILDING_LEDGER_PORTAL_QUOTA_NOTICE =
  '공공데이터포털 호출이 제한되어 전부 가져오지 못했습니다. 잠시 후 다시 조회해 주세요';

export const BUILDING_LEDGER_PORTAL_TIMEOUT_NOTICE =
  '공공데이터포털 연결이 불안정합니다. 잠시 후 다시 조회해 주세요';

const BUILDING_PNU_CAP = 100;

function getField(row: PortalRawRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function stripTrailingParen(raw: string): string {
  return String(raw ?? '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
}

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

function withBeonjiSuffix(lot: string): string {
  const t = String(lot ?? '').trim();
  if (!t || t === '-') return t || '-';
  if (/번지$/u.test(t)) return t;
  if (/^산?\d+(?:-\d+)?$/u.test(t)) return `${t}번지`;
  return t;
}

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

function shortenBuildingRoadAddr(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t || t === '-') return t || '-';
  let s = formatAddressStripSidoSigungu(t) || t;
  s = stripTrailingParen(s);
  return s || '-';
}

function formatJibun(row: PortalRawRow): string {
  const mnnmRaw = getField(row, 'mnnm');
  const slnoRaw = getField(row, 'slno');
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

function formatRoadAddr(row: PortalRawRow): string {
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

function isMissingAddressPart(value: string | undefined): boolean {
  const v = String(value ?? '').trim();
  return !v || v === '-';
}

function normalizeBuildingLedgerRow(
  pnu: string,
  addr: string,
  row: PortalRawRow
): BuildingLedgerDisplayRowClient {
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
    mgmBldrgstPk:
      getField(row, 'comm_bld_esnc_no', 'mgmBldrgstPk', 'mgm_bldrgst_pk') || undefined,
    raw: row,
    source: 'portal',
  };
}

function hasLedgerDisplayData(row: BuildingLedgerDisplayRowClient): boolean {
  return [row.bldNm, row.totArea, row.platArea, row.platLoc, row.jibun].some(
    (v) => v && v !== '-'
  );
}

function isQuotaMessage(status: number, text: string): boolean {
  if (status === 429) return true;
  const t = String(text ?? '').toLowerCase();
  if (!t) return false;
  if (
    t.includes('service_timeout') ||
    t.includes('returnreasoncode":"05') ||
    /\breturnreasoncode["\s:]*["']?05\b/.test(t)
  ) {
    return false;
  }
  return (
    t.includes('quota') ||
    t.includes('limit exceed') ||
    t.includes('limited_number') ||
    t.includes('per_second') ||
    (t.includes('트래픽') && t.includes('초과')) ||
    (t.includes('호출') && t.includes('한도')) ||
    /\breturnreasoncode["\s:]*["']?2[23]\b/.test(t)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchOnePortalRow(
  parcel: { pnu: string; jibun: string },
  serviceKey: string
): Promise<{
  row: BuildingLedgerDisplayRowClient | null;
  quota: boolean;
  timeout: boolean;
}> {
  const url = buildDataPortalBuildingUrl('ledger', parcel.pnu, serviceKey, {
    numOfRows: '100',
  });
  const res = await fetchDataPortalBuildingText(url);
  if (isQuotaMessage(res.status, res.text)) {
    return { row: null, quota: true, timeout: false };
  }
  if (res.transient) {
    return { row: null, quota: false, timeout: true };
  }
  const rows = parsePortalRows(res.text);
  const first = rows[0];
  if (!first) return { row: null, quota: false, timeout: false };
  const normalized = normalizeBuildingLedgerRow(
    parcel.pnu,
    parcel.jibun || parcel.pnu,
    first
  );
  return {
    row: hasLedgerDisplayData(normalized) ? normalized : null,
    quota: false,
    timeout: false,
  };
}

/** 세움 없을 때 포털 배치 — 동시성·간격 유지 */
export async function fetchBuildingLedgersPortalBatchClient(params: {
  parcels: Array<{ pnu?: string; jibun?: string }>;
  concurrency?: number;
}): Promise<{
  ok: boolean;
  rows: BuildingLedgerDisplayRowClient[];
  notice?: string;
  portalQuotaExceeded?: boolean;
}> {
  const cfg = await fetchLandInfoConfig();
  const serviceKey = cfg.dataPortalKey.trim();
  if (!serviceKey) {
    return { ok: true, rows: [] };
  }

  const unique = [
    ...new Map(
      (params.parcels ?? [])
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
    Math.min(
      PARCEL_ANALYSIS_BUILDING_CONCURRENCY,
      params.concurrency ?? (unique.length <= 1 ? 1 : PARCEL_ANALYSIS_BUILDING_CONCURRENCY)
    )
  );
  const gapMs = unique.length <= 1 ? 0 : PARCEL_ANALYSIS_BUILDING_GAP_MS;

  const out: BuildingLedgerDisplayRowClient[] = [];
  let portalQuotaExceeded = false;
  let portalTimeoutHit = false;
  let index = 0;

  async function worker() {
    while (true) {
      if (portalQuotaExceeded) return;
      const i = index++;
      if (i >= unique.length) return;
      if (gapMs > 0) await sleep(gapMs);
      if (portalQuotaExceeded) return;
      const parcel = unique[i]!;
      const one = await fetchOnePortalRow(parcel, serviceKey);
      if (one.quota) {
        portalQuotaExceeded = true;
        return;
      }
      if (one.timeout) portalTimeoutHit = true;
      if (one.row) out.push(one.row);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, () => worker())
  );

  const notice = portalQuotaExceeded
    ? BUILDING_LEDGER_PORTAL_QUOTA_NOTICE
    : portalTimeoutHit && !out.length
      ? BUILDING_LEDGER_PORTAL_TIMEOUT_NOTICE
      : undefined;

  return {
    ok: true,
    rows: out,
    notice,
    portalQuotaExceeded,
  };
}
