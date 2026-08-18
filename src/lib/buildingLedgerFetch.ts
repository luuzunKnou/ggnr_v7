/**
 * 건축물대장 공공데이터 조회 (서버 전용) — 필지분석·우클릭은 call로만 사용.
 * 클라이언트에서 이 파일을 import하면 안 된다(pg/fs 번들 오류).
 */
import { getLandLinkageConfig } from '@/service/configService';
import {
  PARCEL_ANALYSIS_BUILDING_CONCURRENCY,
  PARCEL_ANALYSIS_BUILDING_GAP_MS,
  PARCEL_ANALYSIS_BUILDING_TIMEOUT_MS,
} from '@/lib/parcelAnalysisTheme';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { buildPnuQueryParams } from '@/lib/parcelLandNormalize';

export type BuildingLedgerRawRow = Record<string, string>;

type PortalErrorReason = 'quota' | 'http' | 'api' | 'timeout' | 'network' | 'other';

type LedgerUpstreamResult =
  | { kind: 'data'; rows: BuildingLedgerRawRow[] }
  | { kind: 'empty'; status?: number; bodyPreview?: string }
  | {
      kind: 'error';
      reason: PortalErrorReason;
      status?: number;
      resultCode?: string;
      bodyPreview?: string;
    };

type BuildingLedgerApiParcel = {
  pnu: string;
  jibun: string;
  row: BuildingLedgerDisplayRow | null;
  quota?: boolean;
  portalOutcome?: 'ok' | 'empty' | 'quota' | 'error';
  portalDetail?: {
    reason?: PortalErrorReason;
    status?: number;
    resultCode?: string;
    bodyPreview?: string;
  };
};

/** 개발용 — 응답 본문 앞부분만 (키·장문 로그 방지) */
function previewResponseBody(text: string, max = 280): string {
  return String(text ?? '')
    .replace(/serviceKey=[^&\s"']+/gi, 'serviceKey=***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 우클릭·필지분석 공통 — 브라우저/터미널용 요약 */
export type BuildingLedgerFetchDebug = {
  requested: number;
  fromSeum: number;
  portalAttempted: number;
  portalOk: number;
  portalEmpty: number;
  portalQuota: number;
  portalOtherError: number;
  useSeum: boolean;
  hasPortalKey: boolean;
  seumError?: string;
  samples: Array<{
    pnu: string;
    outcome: string;
    status?: number;
    resultCode?: string;
    reason?: string;
    bodyPreview?: string;
    count?: number;
    samplePnus?: string[];
  }>;
};

/** 공공데이터포털 일일/트래픽 호출 한도 초과 여부 (연결실패·타임아웃 05는 제외) */
export function isDataPortalQuotaMessage(status: number, text: string): boolean {
  if (status === 429) return true;
  const t = String(text ?? '').toLowerCase();
  if (!t) return false;
  // 게이트웨이 05 = 서비스 연결/타임아웃 — 한도로 보지 않음
  if (t.includes('service_timeout') || t.includes('returnreasoncode":"05') || /\breturnreasoncode["\s:]*["']?05\b/.test(t)) {
    return false;
  }
  return (
    t.includes('quota') ||
    t.includes('limit exceed') ||
    t.includes('limited_number') ||
    t.includes('per_second') ||
    t.includes('per day') ||
    t.includes('service_request') ||
    (t.includes('트래픽') && t.includes('초과')) ||
    (t.includes('호출') && t.includes('한도')) ||
    (t.includes('초당') && t.includes('초과')) ||
    (t.includes('일일') && t.includes('초과')) ||
    t.includes('요청제한') ||
    /\breturnreasoncode["\s:]*["']?2[23]\b/.test(t)
  );
}

function isPortalTimeoutMessage(text: string): boolean {
  const t = String(text ?? '').toLowerCase();
  return (
    t.includes('service_timeout') ||
    t.includes('연결실패') ||
    /\breturnreasoncode["\s:]*["']?05\b/.test(t)
  );
}

export const BUILDING_LEDGER_PORTAL_QUOTA_NOTICE =
  '공공데이터포털 호출이 제한되어 전부 가져오지 못했습니다. 잠시 후 다시 조회해 주세요';

export const BUILDING_LEDGER_PORTAL_TIMEOUT_NOTICE =
  '공공데이터포털 연결이 불안정합니다. 잠시 후 다시 조회해 주세요';

/** 포털 일시 장애·타임아웃 재시도 (초당 한도 완화와 맞춤) */
const PORTAL_RETRY_MAX = 2;
const PORTAL_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchLedgerUpstreamOnce(
  pnu: string,
  serviceKey: string
): Promise<LedgerUpstreamResult> {
  const qs = buildPnuQueryParams(pnu);
  qs.set('serviceKey', serviceKey);
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?${qs.toString()}`;
  const timeoutMs = PARCEL_ANALYSIS_BUILDING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    const preview = previewResponseBody(text);
    if (isDataPortalQuotaMessage(res.status, text)) {
      return { kind: 'error', reason: 'quota', status: res.status, bodyPreview: preview };
    }
    if (isPortalTimeoutMessage(text)) {
      return { kind: 'error', reason: 'timeout', status: res.status, resultCode: '05', bodyPreview: preview };
    }
    if (!res.ok) {
      return { kind: 'error', reason: 'http', status: res.status, bodyPreview: preview };
    }
    if (text.trim().startsWith('{')) {
      return parseJsonLedgerUpstream(text, res.status);
    }
    const xmlRows = parseXmlRows(text);
    if (xmlRows.length) return { kind: 'data', rows: xmlRows };
    if (isDataPortalQuotaMessage(res.status, text)) {
      return { kind: 'error', reason: 'quota', status: res.status, bodyPreview: preview };
    }
    return { kind: 'empty', status: res.status, bodyPreview: preview };
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'AbortError' || /aborted/i.test(msg)) {
      return { kind: 'error', reason: 'timeout', bodyPreview: `timeout ${timeoutMs}ms` };
    }
    return { kind: 'error', reason: 'network', bodyPreview: previewResponseBody(msg, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/** 타임아웃·네트워크만 재시도 (한도·정상 empty는 즉시 반환) */
async function fetchLedgerUpstream(
  pnu: string,
  serviceKey: string
): Promise<LedgerUpstreamResult> {
  let last: LedgerUpstreamResult | null = null;
  for (let attempt = 0; attempt <= PORTAL_RETRY_MAX; attempt++) {
    if (attempt > 0) await sleep(PORTAL_RETRY_DELAY_MS * attempt);
    last = await fetchLedgerUpstreamOnce(pnu, serviceKey);
    if (last.kind !== 'error') return last;
    if (last.reason !== 'timeout' && last.reason !== 'network') return last;
  }
  return last!;
}

function parseJsonLedgerUpstream(text: string, status?: number): LedgerUpstreamResult {
  const preview = previewResponseBody(text);
  try {
    type LedgerJsonEnvelope = {
      header?: { resultCode?: string; resultMsg?: string };
      body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } };
    };
    const json = JSON.parse(text) as LedgerJsonEnvelope & {
      OpenAPI_ServiceResponse?: {
        cmmMsgHeader?: {
          errMsg?: string;
          returnAuthMsg?: string;
          returnReasonCode?: string;
        };
      };
      /** 일부 응답은 response 래퍼, 일부는 최상위에 header/body */
      response?: LedgerJsonEnvelope;
    };

    const openApiHdr = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (openApiHdr) {
      const errMsg = String(openApiHdr.errMsg ?? '').trim();
      const authMsg = String(openApiHdr.returnAuthMsg ?? '').trim();
      const reasonCode = String(openApiHdr.returnReasonCode ?? '').trim();
      const blob = `${errMsg} ${authMsg} ${reasonCode} ${text}`;
      if (isDataPortalQuotaMessage(status ?? 200, blob)) {
        return {
          kind: 'error',
          reason: 'quota',
          status,
          resultCode: reasonCode || undefined,
          bodyPreview: preview,
        };
      }
      if (isPortalTimeoutMessage(blob) || reasonCode === '05') {
        return {
          kind: 'error',
          reason: 'timeout',
          status,
          resultCode: reasonCode || '05',
          bodyPreview: preview,
        };
      }
      return {
        kind: 'error',
        reason: 'api',
        status,
        resultCode: reasonCode || undefined,
        bodyPreview: previewResponseBody(authMsg || errMsg || preview, 280),
      };
    }

    const root: LedgerJsonEnvelope = json.response ?? json;
    const code = String(root.header?.resultCode ?? '').trim();
    const resultMsg = String(root.header?.resultMsg ?? '').trim();
    if (isDataPortalQuotaMessage(status ?? 200, `${code} ${resultMsg} ${text}`)) {
      return { kind: 'error', reason: 'quota', status, resultCode: code, bodyPreview: preview };
    }
    if (code && code !== '00' && code !== '03') {
      return {
        kind: 'error',
        reason: 'api',
        status,
        resultCode: code,
        bodyPreview: previewResponseBody(resultMsg || preview, 280),
      };
    }
    const item = root.body?.items?.item;
    if (!item) return { kind: 'empty', status, bodyPreview: preview };
    const list = Array.isArray(item) ? item : [item];
    const rows = list.map((row) => toRowStrings(row));
    return rows.length
      ? { kind: 'data', rows }
      : { kind: 'empty', status, bodyPreview: preview };
  } catch {
    return { kind: 'error', reason: 'other', status, bodyPreview: preview };
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
  /** 세움 고유번호 또는 포털 관리건축물대장PK */
  mgmBldrgstPk?: string;
  /** 포털 원문 키(camelCase) — 우클릭 상세 이중화용 */
  raw?: BuildingLedgerRawRow;
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
    mgmBldrgstPk:
      getField(row, 'comm_bld_esnc_no', 'mgmBldrgstPk', 'mgm_bldrgst_pk') || undefined,
    raw: row,
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

/** 동시 N + 요청 시작 최소 간격(ms). shouldSkip이 true면 나머지 호출 없이 채움 */
async function mapPoolWithStartGap<T, R>(
  items: T[],
  concurrency: number,
  gapMs: number,
  fn: (item: T) => Promise<R>,
  opts: {
    shouldSkip: () => boolean;
    skippedResult: (item: T) => R;
  }
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  let lastStartAt = 0;
  let gapChain: Promise<void> = Promise.resolve();

  async function waitStartGap() {
    const prev = gapChain;
    let release!: () => void;
    gapChain = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      if (gapMs > 0 && lastStartAt > 0) {
        const wait = gapMs - (Date.now() - lastStartAt);
        if (wait > 0) await sleep(wait);
      }
      lastStartAt = Date.now();
    } finally {
      release();
    }
  }

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      if (opts.shouldSkip()) {
        results[i] = opts.skippedResult(items[i]!);
        continue;
      }
      await waitStartGap();
      if (opts.shouldSkip()) {
        results[i] = opts.skippedResult(items[i]!);
        continue;
      }
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function skippedQuotaParcel(parcel: { pnu: string; jibun: string }): BuildingLedgerApiParcel {
  return {
    pnu: parcel.pnu,
    jibun: parcel.jibun,
    row: null,
    quota: true,
    portalOutcome: 'quota',
    portalDetail: {
      reason: 'quota',
      bodyPreview: 'skipped: earlier request hit per-second limit',
    },
  };
}

async function fetchBuildingLedgersFromApi(
  parcels: Array<{ pnu: string; jibun: string }>,
  dataPortalKey: string,
  concurrency: number,
  gapMs: number
): Promise<{ results: BuildingLedgerApiParcel[]; portalQuotaExceeded: boolean; portalTimeoutHit: boolean }> {
  let portalQuotaExceeded = false;
  let portalTimeoutHit = false;

  const runOne = async (parcel: { pnu: string; jibun: string }): Promise<BuildingLedgerApiParcel> => {
    const upstream = await fetchLedgerUpstream(parcel.pnu, dataPortalKey);
    if (upstream.kind === 'error' && upstream.reason === 'quota') {
      portalQuotaExceeded = true;
      return {
        pnu: parcel.pnu,
        jibun: parcel.jibun,
        row: null,
        quota: true,
        portalOutcome: 'quota' as const,
        portalDetail: {
          reason: upstream.reason,
          status: upstream.status,
          resultCode: upstream.resultCode,
          bodyPreview: upstream.bodyPreview,
        },
      };
    }
    if (upstream.kind === 'error') {
      if (upstream.reason === 'timeout') portalTimeoutHit = true;
      return {
        pnu: parcel.pnu,
        jibun: parcel.jibun,
        row: null,
        portalOutcome: 'error' as const,
        portalDetail: {
          reason: upstream.reason,
          status: upstream.status,
          resultCode: upstream.resultCode,
          bodyPreview: upstream.bodyPreview,
        },
      };
    }
    if (upstream.kind === 'empty') {
      return {
        pnu: parcel.pnu,
        jibun: parcel.jibun,
        row: null,
        portalOutcome: 'empty' as const,
        portalDetail: {
          status: upstream.status,
          bodyPreview: upstream.bodyPreview,
        },
      };
    }
    const first = upstream.rows[0];
    if (!first) {
      return { pnu: parcel.pnu, jibun: parcel.jibun, row: null, portalOutcome: 'empty' as const };
    }
    const normalized = normalizeBuildingLedgerRow(parcel.pnu, parcel.jibun || parcel.pnu, first);
    const row = hasLedgerDisplayData(normalized) ? normalized : null;
    return {
      pnu: parcel.pnu,
      jibun: parcel.jibun,
      row,
      portalOutcome: row ? ('ok' as const) : ('empty' as const),
    };
  };

  const results =
    parcels.length <= 1
      ? await mapPool(parcels, 1, runOne)
      : await mapPoolWithStartGap(parcels, concurrency, gapMs, runOne, {
          shouldSkip: () => portalQuotaExceeded,
          skippedResult: skippedQuotaParcel,
        });

  return { results, portalQuotaExceeded, portalTimeoutHit };
}

/** 포털 결과를 사유별로 묶어 터미널 1회 로그용 */
function groupPortalByReason(apiResults: BuildingLedgerApiParcel[]) {
  type Group = {
    outcome: string;
    count: number;
    status?: number;
    resultCode?: string;
    reason?: string;
    bodyPreview?: string;
    samplePnus: string[];
  };
  const map = new Map<string, Group>();
  for (const r of apiResults) {
    const outcome = r.portalOutcome ?? 'error';
    const detailReason = r.portalDetail?.reason;
    const key =
      outcome === 'error' && detailReason
        ? `error:${detailReason}`
        : outcome === 'quota'
          ? 'quota'
          : outcome;
    let g = map.get(key);
    if (!g) {
      g = {
        outcome: key,
        count: 0,
        status: r.portalDetail?.status,
        resultCode: r.portalDetail?.resultCode,
        reason: detailReason,
        bodyPreview: r.portalDetail?.bodyPreview,
        samplePnus: [],
      };
      map.set(key, g);
    }
    g.count += 1;
    if (g.samplePnus.length < 3) g.samplePnus.push(r.pnu);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
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
  debug?: BuildingLedgerFetchDebug;
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

  if (!unique.length) {
    return {
      ok: true,
      rows: [],
      debug: {
        requested: 0,
        fromSeum: 0,
        portalAttempted: 0,
        portalOk: 0,
        portalEmpty: 0,
        portalQuota: 0,
        portalOtherError: 0,
        useSeum: cfg.useSeum,
        hasPortalKey: Boolean(dataPortalKey),
        samples: [],
      },
    };
  }

  // 우클릭 1건은 동시 1·간격 없음, 다건은 동시 3 + 시작 간격
  const defaultConcurrency =
    unique.length <= 1 ? 1 : (params.concurrency ?? PARCEL_ANALYSIS_BUILDING_CONCURRENCY);
  const concurrency = Math.max(1, Math.min(PARCEL_ANALYSIS_BUILDING_CONCURRENCY, defaultConcurrency));
  const gapMs = unique.length <= 1 ? 0 : PARCEL_ANALYSIS_BUILDING_GAP_MS;

  try {
    const fetchedRows: BuildingLedgerDisplayRow[] = [];
    let remaining = unique;
    let portalQuotaExceeded = false;
    let portalTimeoutHit = false;
    let seumError: string | undefined;
    let apiResults: BuildingLedgerApiParcel[] = [];

    if (cfg.useSeum) {
      try {
        const { fetchSeumBuildingLedgersByPnus } = await import('@/service/seumService');
        const seumMap = await fetchSeumBuildingLedgersByPnus(remaining);
        for (const [pnu, row] of seumMap) {
          fetchedRows.push({ ...row, source: 'seum' });
        }
        remaining = remaining.filter((p) => !seumMap.has(p.pnu));
      } catch (e: unknown) {
        seumError = e instanceof Error ? e.message : String(e);
      }
    }

    const skippedPortalNoKey = Boolean(remaining.length && !dataPortalKey);

    if (remaining.length && dataPortalKey) {
      const portal = await fetchBuildingLedgersFromApi(
        remaining,
        dataPortalKey,
        concurrency,
        gapMs
      );
      apiResults = portal.results;
      portalQuotaExceeded = portal.portalQuotaExceeded;
      portalTimeoutHit = portal.portalTimeoutHit;
      for (const r of apiResults) {
        if (r.row) fetchedRows.push({ ...r.row, source: 'portal' });
      }
    }

    const portalOk = apiResults.filter((r) => r.portalOutcome === 'ok').length;
    const portalEmpty = apiResults.filter((r) => r.portalOutcome === 'empty').length;
    const portalQuota = apiResults.filter((r) => r.portalOutcome === 'quota').length;
    const portalOtherError = apiResults.filter((r) => r.portalOutcome === 'error').length;
    const byReason = groupPortalByReason(apiResults);

    const samples = byReason
      .filter((g) => g.outcome !== 'ok')
      .map((g) => ({
        pnu: g.samplePnus[0] ?? '',
        outcome: g.outcome,
        status: g.status,
        resultCode: g.resultCode,
        reason: g.reason,
        bodyPreview: g.bodyPreview,
        count: g.count,
        samplePnus: g.samplePnus,
      }));

    const debug: BuildingLedgerFetchDebug = {
      requested: unique.length,
      fromSeum: fetchedRows.filter((r) => r.source === 'seum').length,
      portalAttempted: apiResults.length,
      portalOk,
      portalEmpty,
      portalQuota,
      portalOtherError,
      useSeum: cfg.useSeum,
      hasPortalKey: Boolean(dataPortalKey),
      seumError,
      samples,
    };

    const notice = portalQuotaExceeded
      ? BUILDING_LEDGER_PORTAL_QUOTA_NOTICE
      : portalTimeoutHit && !fetchedRows.length
        ? BUILDING_LEDGER_PORTAL_TIMEOUT_NOTICE
        : undefined;

    const logPayload = {
      summary: byReason.map((g) => `${g.outcome}=${g.count}`).join(' ') || 'none',
      requested: debug.requested,
      fromSeum: debug.fromSeum,
      portalOk,
      portalEmpty,
      portalQuota,
      portalOtherError,
      concurrency,
      gapMs,
      notice,
      sample: samples[0]
        ? {
            outcome: samples[0].outcome,
            count: samples[0].count,
            resultCode: samples[0].resultCode,
            bodyPreview: samples[0].bodyPreview?.slice(0, 160),
          }
        : undefined,
      skippedPortalNoKey: skippedPortalNoKey || undefined,
      seumError,
    };
    if (portalQuotaExceeded || portalOtherError > 0 || seumError || skippedPortalNoKey) {
      console.warn('[건축물대장]', logPayload);
    } else {
      console.info('[건축물대장]', logPayload);
    }

    if (!fetchedRows.length) {
      return { ok: true, rows: [], notice, portalQuotaExceeded, debug };
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
          debug,
        };
      }
    } catch {
      /* 주소 보강 실패해도 건축물 행은 유지 */
    }

    return { ok: true, rows: fetchedRows, notice, portalQuotaExceeded, debug };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[건축물대장]', { error: msg });
    return { ok: false, rows: [], error: msg };
  }
}
