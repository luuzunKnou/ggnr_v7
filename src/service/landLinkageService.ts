/**
 * 필지 토지·소유 보강 — 행망(KRAS·KOREPS)은 서버, 브이월드는 브라우저(JSONP).
 */
import { buildPnuFromKrasRow, parseKrasLandInfoRows } from '@/lib/krasLandXml';
import {
  parseKrasBodyFieldMaps,
  zonesFromKrasLandUseRows,
  type KrasBodyRecord,
} from '@/lib/krasLandUseXml';
import {
  emptyParcelLandInfoTab,
  hasParcelLandInfoTabData,
  mapKrasToParcelLandInfoTab,
  normalizeFromKrasRow,
  type HangmangCallLine,
  type NormalizedParcelLand,
  type ParcelLandEnrichmentMap,
  type ParcelLandInfoTabData,
  type ParcelLandSource,
} from '@/lib/parcelLandNormalize';
import { getLandLinkageConfig } from '@/service/configService';
import {
  PARCEL_ANALYSIS_LINKAGE_CONCURRENCY,
  PARCEL_ANALYSIS_LINKAGE_TIMEOUT_MS,
} from '@/lib/parcelAnalysisTheme';
import {
  decodeGatewayBody,
  krasXmlFault,
  logKrasGatewayFault,
  redactKrasUrl,
} from '@/integrations/krasGateway';

const KRAS_LAND_QUERY_ID = 'KRAS000002';
const KRAS_SHARE_QUERY_ID = 'KRAS000003';
const KRAS_MOVE_HIST_QUERY_ID = 'KRAS000006';
const KRAS_CHANGE_HIST_QUERY_ID = 'KRAS000007';
const KRAS_LAND_USE_QUERY_ID = 'KRAS000025';
const KRAS_LAYER_LIST_QUERY_ID = 'KRAS000037';
const KOREPS_PRICE_QUERY_ID = 'KOREPS00011';

export type ParcelLandModalKind = 'share' | 'move' | 'change' | 'price';

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function toNumPositive(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type KorepsPriceRow = {
  pannJiga: number | null;
  pannYmd: string;
  baseYear: string;
  baseMon: string;
  jigaJibn: string;
  remark: string;
  raw: KrasBodyRecord;
};

/** KOREPS00011 BODY → 공시지가 행 (최신 1건 우선: 목록 첫 행) */
function parseKorepsPriceRows(xml: string): KorepsPriceRow[] {
  const maps = parseKrasBodyFieldMaps(xml);
  return maps
    .map((raw) => {
      const pannJiga =
        toNumPositive(raw.PANN_JIGA) ??
        toNumPositive(raw.PNILP) ??
        toNumPositive(raw.pblntfPclnd) ??
        toNumPositive(raw.PBLNTF_PCLND);
      return {
        pannJiga,
        pannYmd: toStr(raw.PANN_YMD),
        baseYear: toStr(raw.BASE_YEAR) || toStr(raw.base_year),
        baseMon: toStr(raw.BASE_MON) || toStr(raw.stdmt),
        jigaJibn: toStr(raw.JIGA_JIBN) || toStr(raw.jiga_jibn),
        remark: toStr(raw.REMARK) || toStr(raw.etc_cntn),
        raw,
      };
    })
    .filter((r) => r.pannJiga != null || r.pannYmd || r.baseYear);
}

function pickLatestKorepsPrice(rows: KorepsPriceRow[]): KorepsPriceRow | null {
  if (!rows.length) return null;
  const withPrice = rows.filter((r) => r.pannJiga != null);
  return (withPrice[0] ?? rows[0]) ?? null;
}

function parsePnuParts(pnu: string) {
  return {
    land_loc_cd: pnu.slice(5, 10),
    ledg_gbn: pnu.slice(10, 11),
    bobn: pnu.slice(11, 15),
    bubn: pnu.slice(15, 19),
  };
}

function buildKrasParam(
  pnu: string,
  queryId: string,
  cfg: ReturnType<typeof getLandLinkageConfig>,
  connSysId?: string
): string {
  const parts = parsePnuParts(pnu);
  const qs = new URLSearchParams();
  qs.set('conn_sys_id', connSysId || cfg.krasKey);
  qs.set('conn_svc_id', queryId);
  qs.set('adm_sect_cd', cfg.sggCode);
  qs.set('land_loc_cd', parts.land_loc_cd);
  qs.set('ledg_gbn', parts.ledg_gbn);
  qs.set('bobn', parts.bobn);
  qs.set('bubn', parts.bubn);
  return qs.toString();
}

function buildKrasUrl(cfg: ReturnType<typeof getLandLinkageConfig>): string | null {
  if (!cfg.krasIp || !cfg.krasPort) return null;
  const path = cfg.krasPath.startsWith('/') ? cfg.krasPath : `/${cfg.krasPath}`;
  return `http://${cfg.krasIp}:${cfg.krasPort}${path === '/' ? '' : path}`;
}

/** KOREPS ※공시지가 시스템 — URL에 쿼리ID 경로 붙임 (v6 동일) */
function buildKorepsUrl(cfg: ReturnType<typeof getLandLinkageConfig>): string | null {
  if (!cfg.korepsIp || !cfg.korepsPort || !cfg.korepsKey || !cfg.sggCode) return null;
  const base = cfg.korepsPath.startsWith('/')
    ? cfg.korepsPath
    : cfg.korepsPath
      ? `/${cfg.korepsPath}`
      : '';
  const withSlash = base.endsWith('/') ? base.slice(0, -1) : base;
  return `http://${cfg.korepsIp}:${cfg.korepsPort}${withSlash}/${KOREPS_PRICE_QUERY_ID}`;
}

function linkageXmlIssue(xml: string): string | null {
  const head = xml.slice(0, 800);
  if (/<!DOCTYPE html/i.test(head) || /<html[\s>]/i.test(head) || /Licensed to the Apache Software Foundation/i.test(head)) {
    return '행망이 웹 페이지를 반환(게이트웨이 경로 확인)';
  }
  if (!/<\?xml|<RESPONSE[\s>]|<HEADER[\s>]/i.test(head)) return null;
  const code = xml.match(/<CODE>([\s\S]*?)<\/CODE>/i)?.[1]?.trim() ?? '';
  const msg = xml.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/i)?.[1]?.trim() ?? '';
  if (code === '0000' || /^success$/i.test(msg)) return null;
  if (msg) return `행망 응답: ${msg}`;
  return '행망 XML 오류';
}

type LinkageXmlResult = { xml: string; error?: string };
type LinkageProbeResult = { xml: string; httpStatus: number; error?: string };

function pickXmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? '';
}

async function fetchLinkageXmlResult(
  url: string,
  query: string,
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST'
): Promise<LinkageXmlResult> {
  const ms = timeoutMs ?? PARCEL_ANALYSIS_LINKAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const q = query.replace(/^\?/, '');
  const requestUrl = method === 'GET' ? `${url.replace(/\/+$/, '')}?${q}` : url;
  const shown = redactKrasUrl(requestUrl);
  try {
    const res =
      method === 'GET'
        ? await fetch(requestUrl, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store',
          })
        : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: q,
            signal: controller.signal,
            cache: 'no-store',
          });
    const buf = Buffer.from(await res.arrayBuffer());
    const xml = decodeGatewayBody(buf);
    const requestHint = method === 'POST' ? `본문: ${q.replace(/conn_sys_id=[^&]*/gi, 'conn_sys_id=***')}\n\n` : '';
    if (!res.ok) {
      logKrasGatewayFault(requestUrl, `HTTP ${res.status}`, `${requestHint}${xml}`);
      return { xml: '', error: `HTTP ${res.status} (${shown})` };
    }
    if (!xml.trim()) return { xml: '', error: `빈 응답 (${shown})` };
    const xmlErr = krasXmlFault(buf, true);
    if (xmlErr) {
      logKrasGatewayFault(requestUrl, xmlErr.message, `${requestHint}${xmlErr.xml}`);
      return { xml: '', error: `${xmlErr.message} (${shown})` };
    }
    const issue = linkageXmlIssue(xml);
    if (issue) {
      logKrasGatewayFault(requestUrl, issue, `${requestHint}${xml}`);
      return { xml: '', error: `${issue} (${shown})` };
    }
    return { xml };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError' || (e instanceof Error && /aborted/i.test(e.message))) {
      return { xml: '', error: `시간 초과 ${ms}ms (${shown})` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { xml: '', error: `연결 실패 (${shown}) ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

async function probeLinkageXml(
  url: string,
  query: string,
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST'
): Promise<LinkageProbeResult> {
  const r = await fetchLinkageXmlResult(url, query, timeoutMs, method);
  if (r.error) {
    const httpMatch = r.error.match(/^HTTP (\d+)/);
    return { xml: r.xml, httpStatus: httpMatch ? Number(httpMatch[1]) : 0, error: r.error };
  }
  return { xml: r.xml, httpStatus: 200 };
}

async function fetchLinkageXml(
  url: string,
  query: string,
  timeoutMs?: number,
  method: 'GET' | 'POST' = 'POST'
): Promise<string> {
  const r = await fetchLinkageXmlResult(url, query, timeoutMs, method);
  return r.xml;
}

function hangmangCallFromProbe(svcId: string, probe: LinkageProbeResult): HangmangCallLine {
  if (probe.error && !probe.xml) {
    const skipped = probe.error.includes('키/주소 없음');
    return { svcId, called: !skipped, detail: probe.error };
  }
  const code = pickXmlTag(probe.xml, 'CODE');
  const message = pickXmlTag(probe.xml, 'MESSAGE');
  if (code || message) {
    return { svcId, called: true, detail: [code, message].filter(Boolean).join(' ') };
  }
  if (probe.httpStatus && probe.httpStatus !== 200) {
    return { svcId, called: true, detail: `HTTP${probe.httpStatus}` };
  }
  if (probe.xml.trim()) {
    return { svcId, called: true, detail: `HTTP${probe.httpStatus || 200}` };
  }
  return { svcId, called: true, detail: '응답없음' };
}

function skippedHangmangCalls(reason: string): HangmangCallLine[] {
  return [
    KRAS_LAYER_LIST_QUERY_ID,
    KRAS_LAND_QUERY_ID,
    KRAS_LAND_USE_QUERY_ID,
    KRAS_SHARE_QUERY_ID,
    KRAS_MOVE_HIST_QUERY_ID,
    KRAS_CHANGE_HIST_QUERY_ID,
    KOREPS_PRICE_QUERY_ID,
  ].map((svcId) => ({ svcId, called: false, detail: reason }));
}

async function probeHangmangCalls(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<{
  calls: HangmangCallLine[];
  landXml: string;
  useXml: string;
}> {
  const krasUrl = buildKrasUrl(cfg);
  const korepsUrl = buildKorepsUrl(cfg);
  const emptyProbe: LinkageProbeResult = { xml: '', httpStatus: 0, error: undefined };

  const krasReady = Boolean(krasUrl && cfg.krasKey && cfg.sggCode);
  const korepsReady = Boolean(korepsUrl);

  const [p037, p002, p025, p003, p006, p007, pKoreps] = await Promise.all([
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_LAYER_LIST_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_SHARE_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_MOVE_HIST_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? probeLinkageXml(krasUrl!, buildKrasParam(pnu, KRAS_CHANGE_HIST_QUERY_ID, cfg), undefined, 'GET')
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    korepsReady
      ? probeLinkageXml(
          korepsUrl!,
          buildKrasParam(pnu, KOREPS_PRICE_QUERY_ID, cfg, cfg.korepsKey),
          undefined,
          'POST'
        )
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
  ]);

  return {
    calls: [
      hangmangCallFromProbe(KRAS_LAYER_LIST_QUERY_ID, p037),
      hangmangCallFromProbe(KRAS_LAND_QUERY_ID, p002),
      hangmangCallFromProbe(KRAS_LAND_USE_QUERY_ID, p025),
      hangmangCallFromProbe(KRAS_SHARE_QUERY_ID, p003),
      hangmangCallFromProbe(KRAS_MOVE_HIST_QUERY_ID, p006),
      hangmangCallFromProbe(KRAS_CHANGE_HIST_QUERY_ID, p007),
      hangmangCallFromProbe(KOREPS_PRICE_QUERY_ID, pKoreps),
    ],
    landXml: p002.xml,
    useXml: p025.xml,
  };
}

async function fetchKrasForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<NormalizedParcelLand | null> {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) return null;
  const xml = await fetchLinkageXml(url, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg), undefined, 'GET');
  const rows = parseKrasLandInfoRows(xml);
  const row = rows[0];
  if (!row) return null;
  const resolvedPnu = buildPnuFromKrasRow(row) || pnu;
  return normalizeFromKrasRow(resolvedPnu, row);
}

async function fetchKrasBatch(
  pnus: string[],
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<ParcelLandEnrichmentMap> {
  const results = await mapPool(pnus, PARCEL_ANALYSIS_LINKAGE_CONCURRENCY, (pnu) =>
    fetchKrasForPnu(pnu, cfg)
  );
  const out: ParcelLandEnrichmentMap = {};
  pnus.forEach((pnu, idx) => {
    const row = results[idx];
    if (row) out[pnu] = row;
  });
  return out;
}

async function fetchKorepsPriceForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<number | null> {
  const url = buildKorepsUrl(cfg);
  if (!url) return null;
  const xml = await fetchLinkageXml(
    url,
    buildKrasParam(pnu, KOREPS_PRICE_QUERY_ID, cfg, cfg.korepsKey),
    undefined,
    'POST'
  );
  const latest = pickLatestKorepsPrice(parseKorepsPriceRows(xml));
  return latest?.pannJiga ?? null;
}

/** KRAS에 공시가 없거나 행 없을 때 KOREPS00011로 공시지가 보강 */
async function applyKorepsPrices(
  pnus: string[],
  enrichments: ParcelLandEnrichmentMap,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<{ enrichments: ParcelLandEnrichmentMap; used: boolean }> {
  if (!buildKorepsUrl(cfg)) return { enrichments, used: false };

  const targets = pnus.filter((pnu) => {
    const row = enrichments[pnu];
    return !row || row.publicPrice == null || !(row.publicPrice > 0);
  });
  if (!targets.length) return { enrichments, used: false };

  const prices = await mapPool(targets, PARCEL_ANALYSIS_LINKAGE_CONCURRENCY, (pnu) =>
    fetchKorepsPriceForPnu(pnu, cfg)
  );

  const next = { ...enrichments };
  let used = false;
  targets.forEach((pnu, i) => {
    const price = prices[i];
    if (price == null || !(price > 0)) return;
    used = true;
    const prev = next[pnu];
    if (prev) {
      next[pnu] = {
        ...prev,
        publicPrice: price,
        source:
          prev.source && prev.source !== 'koreps' && prev.source !== 'db'
            ? 'mixed'
            : 'koreps',
      };
    } else {
      next[pnu] = {
        pnu,
        jimok: '',
        jimokNm: '',
        areaSqm: 0,
        ownerName: '',
        ownerType: '',
        publicPrice: price,
        source: 'koreps',
      };
    }
  });
  return { enrichments: next, used };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
  return out;
}

function mergeMaps(...maps: ParcelLandEnrichmentMap[]): ParcelLandEnrichmentMap {
  const out: ParcelLandEnrichmentMap = {};
  for (const map of maps) Object.assign(out, map);
  return out;
}

/** PNU 목록 보강 — 서버는 행망(KRAS → KOREPS 공시). 브이월드는 클라이언트 JSONP. */
export async function enrichParcelLandsByPnus(params: {
  pnus: string[];
}): Promise<{ enrichments: ParcelLandEnrichmentMap; source: ParcelLandSource | 'mixed' | 'db' }> {
  const cfg = getLandLinkageConfig();
  const unique = [...new Set((params.pnus ?? []).map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  const pnus = unique;
  if (!pnus.length) return { enrichments: {}, source: 'db' };

  let enrichments: ParcelLandEnrichmentMap = {};
  const usedSources = new Set<ParcelLandSource>();

  if (cfg.useKras) {
    const kras = await fetchKrasBatch(pnus, cfg);
    enrichments = mergeMaps(enrichments, kras);
    if (Object.keys(kras).length) usedSources.add('kras');

    const koreps = await applyKorepsPrices(pnus, enrichments, cfg);
    enrichments = koreps.enrichments;
    if (koreps.used) usedSources.add('koreps');
  }

  let source: ParcelLandSource | 'mixed' | 'db' = 'db';
  if (usedSources.size === 1) source = [...usedSources][0]!;
  else if (usedSources.size > 1) source = 'mixed';

  return { enrichments, source };
}

async function fetchKrasLandUseZonesForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<string[]> {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) return [];
  const xml = await fetchLinkageXml(url, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg), undefined, 'GET');
  const rows = parseKrasBodyFieldMaps(xml);
  return zonesFromKrasLandUseRows(rows);
}

/** 토지이용계획 용도지역 — 서버는 행망(KRAS)만. 브이월드는 클라이언트 JSONP. */
export async function fetchLandUseZonesByPnus(params: {
  pnus?: string[];
}): Promise<{ ok: boolean; zonesByPnu: Record<string, string[]>; error?: string }> {
  const empty = { ok: false as const, zonesByPnu: {} as Record<string, string[]> };
  const cfg = getLandLinkageConfig();
  const unique = [...new Set((params.pnus ?? []).map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  if (!unique.length) return { ok: true, zonesByPnu: {} };

  const zonesByPnu: Record<string, string[]> = {};

  try {
    if (cfg.useKras) {
      const krasResults = await mapPool(unique, PARCEL_ANALYSIS_LINKAGE_CONCURRENCY, (pnu) =>
        fetchKrasLandUseZonesForPnu(pnu, cfg)
      );
      unique.forEach((pnu, i) => {
        const zones = krasResults[i] ?? [];
        if (zones.length) zonesByPnu[pnu] = zones;
      });
    }

    return { ok: true, zonesByPnu };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }
}

async function fetchKrasLandInfoRowForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<{ row: ReturnType<typeof parseKrasLandInfoRows>[number] | null; error?: string }> {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) {
    return { row: null, error: '토지행정망 접속정보(키·주소·시군구 코드)가 없습니다.' };
  }
  const r = await fetchLinkageXmlResult(url, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg), undefined, 'GET');
  if (r.error) return { row: null, error: `토지대장 ${r.error}` };
  const row = parseKrasLandInfoRows(r.xml)[0] ?? null;
  if (!row) return { row: null, error: '토지대장 응답에 필지 항목이 없습니다.' };
  return { row };
}

async function fetchKrasLandUseRowsForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
): Promise<{ rows: KrasBodyRecord[]; error?: string }> {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) {
    return { rows: [], error: '토지행정망 접속정보(키·주소·시군구 코드)가 없습니다.' };
  }
  const r = await fetchLinkageXmlResult(url, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg), undefined, 'GET');
  if (r.error) return { rows: [], error: `이용계획 ${r.error}` };
  return { rows: parseKrasBodyFieldMaps(r.xml) };
}

/** 우클릭 필지정보 탭 — 서버는 행망(KRAS)만. 브이월드는 클라이언트 JSONP. */
export async function fetchParcelLandInfoTab(params: { pnu?: string }): Promise<
  ParcelLandInfoTabData & {
    ok: boolean;
    error?: string;
    krasSkipReason?: string;
    hangmangCalls?: HangmangCallLine[];
  }
> {
  const pnu = toStr(params.pnu);
  const empty = { ...emptyParcelLandInfoTab(), ok: false as const };
  if (!/^\d{19}$/.test(pnu)) return { ...empty, error: '유효한 PNU(19자리)가 필요합니다.' };

  const cfg = getLandLinkageConfig();
  const ggnrEnv = (process.env.GGNR_ENV ?? '').trim() || '(없음)';

  try {
    if (!cfg.useKras) {
      const krasSkipReason = `개발 실행(GGNR_ENV=${ggnrEnv})이라 행망을 호출하지 않음`;
      console.warn(`[landLinkage] 필지정보 행망 건너뜀 pnu=${pnu} ${krasSkipReason}`);
      return {
        ...emptyParcelLandInfoTab(),
        ok: true,
        krasSkipReason,
        hangmangCalls: skippedHangmangCalls(krasSkipReason),
      };
    }

    const probed = await probeHangmangCalls(pnu, cfg);
    const landRow = parseKrasLandInfoRows(probed.landXml)[0] ?? null;
    const useRows = parseKrasBodyFieldMaps(probed.useXml);
    const krasTab = mapKrasToParcelLandInfoTab(landRow, useRows);
    if (hasParcelLandInfoTabData(krasTab)) {
      return { ...krasTab, ok: true, hangmangCalls: probed.calls };
    }

    const krasSkipReason =
      [landRow ? undefined : '토지대장 응답에 필지 항목이 없습니다.', useRows.length ? undefined : '이용계획 응답 없음']
        .filter(Boolean)
        .join(' · ') || '행망 응답을 필지정보에 쓸 수 없음';
    console.warn(`[landLinkage] 필지정보 행망 미사용 pnu=${pnu} ${krasSkipReason}`);
    return {
      ...emptyParcelLandInfoTab(),
      ok: true,
      krasSkipReason,
      hangmangCalls: probed.calls,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[landLinkage] 필지정보 행망 예외 pnu=${pnu} ${msg}`);
    return { ...empty, error: msg, krasSkipReason: msg, hangmangCalls: skippedHangmangCalls(msg) };
  }
}

function formatKrasYmd(raw: string): string {
  const d = toStr(raw).replace(/\D/g, '');
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return toStr(raw);
}

function formatPriceCell(value: unknown): string {
  const n = toNumPositive(value);
  if (n == null) return toStr(value) || '-';
  return `${n.toLocaleString('ko-KR')}원/㎡`;
}

function formatAreaCell(value: unknown): string {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return toStr(value) || '-';
  return `${n.toLocaleString('ko-KR')}㎡`;
}

/** 우클릭 필지정보 모달 — 공유인·이동연혁·변동연혁·공시지가 목록 */
export async function fetchParcelLandModalList(params: {
  pnu?: string;
  kind?: ParcelLandModalKind;
}): Promise<{
  ok: boolean;
  kind: ParcelLandModalKind | null;
  headers: string[];
  rows: string[][];
  message?: string;
  error?: string;
}> {
  const pnu = toStr(params.pnu);
  const kind = params.kind;
  if (!kind || !['share', 'move', 'change', 'price'].includes(kind)) {
    return { ok: false, kind: null, headers: [], rows: [], error: '조회 종류가 필요합니다.' };
  }
  if (!/^\d{19}$/.test(pnu)) {
    return { ok: false, kind, headers: [], rows: [], error: '유효한 PNU(19자리)가 필요합니다.' };
  }

  const cfg = getLandLinkageConfig();
  if (!cfg.useKras) {
    return {
      ok: true,
      kind,
      headers: [],
      rows: [],
      message: `개발 실행(GGNR_ENV=${(process.env.GGNR_ENV ?? '').trim() || '(없음)'})이라 행망을 호출하지 않음`,
    };
  }

  try {
    if (kind === 'price') {
      const url = buildKorepsUrl(cfg);
      if (!url) {
        return { ok: true, kind, headers: [], rows: [], message: '공시지가 접속정보가 없습니다.' };
      }
      const r = await fetchLinkageXmlResult(
        url,
        buildKrasParam(pnu, KOREPS_PRICE_QUERY_ID, cfg, cfg.korepsKey),
        undefined,
        'POST'
      );
      if (r.error) return { ok: false, kind, headers: [], rows: [], error: r.error };
      const parsed = parseKorepsPriceRows(r.xml);
      const headers = ['공시지가', '공시일자', '기준년도', '기준월', '지번', '비고'];
      const rows = parsed.map((item) => [
        formatPriceCell(item.pannJiga ?? item.raw.PANN_JIGA),
        formatKrasYmd(item.pannYmd),
        item.baseYear ? `${item.baseYear}년` : '-',
        item.baseMon ? `${item.baseMon}월` : '-',
        item.jigaJibn || '-',
        item.remark || '-',
      ]);
      return {
        ok: true,
        kind,
        headers,
        rows,
        message: rows.length ? undefined : '요청된 공시지가 데이터가 없습니다.',
      };
    }

    const url = buildKrasUrl(cfg);
    if (!url || !cfg.krasKey || !cfg.sggCode) {
      return { ok: true, kind, headers: [], rows: [], message: '토지행정망 접속정보가 없습니다.' };
    }

    const svcId =
      kind === 'share'
        ? KRAS_SHARE_QUERY_ID
        : kind === 'move'
          ? KRAS_MOVE_HIST_QUERY_ID
          : KRAS_CHANGE_HIST_QUERY_ID;
    const r = await fetchLinkageXmlResult(url, buildKrasParam(pnu, svcId, cfg), undefined, 'GET');
    if (r.error) return { ok: false, kind, headers: [], rows: [], error: r.error };
    let maps = parseKrasBodyFieldMaps(r.xml);

    if (kind === 'share') {
      maps = [...maps].sort((a, b) => Number(a.SHR_SEQNO ?? 0) - Number(b.SHR_SEQNO ?? 0));
      const headers = [
        '등록번호',
        '소유자',
        '소유자주소',
        '구분',
        '지분',
        '변동원인',
        '변동일자',
        '말소일자',
      ];
      const rows = maps.map((item) => [
        toStr(item.OWNER_REGNO) || '-',
        toStr(item.OWNER_NM) || '-',
        toStr(item.OWNER_ADDR) || '-',
        toStr(item.OWN_GBN_NM) || '-',
        toStr(item.OWN_RGT_JIBUN) || '-',
        toStr(item.OWN_RGT_CHG_RSN_NM) || '-',
        formatKrasYmd(toStr(item.OWN_RGT_CHG_YMD)) || '-',
        formatKrasYmd(toStr(item.OWN_RGT_CHG_DEL_YMD)) || '-',
      ]);
      return {
        ok: true,
        kind,
        headers,
        rows,
        message: rows.length ? undefined : '요청된 대상지의 공유지연명부 정보가 없습니다.',
      };
    }

    if (kind === 'move') {
      const headers = [
        '이동일자',
        '토지이동사유',
        '지목',
        '면적',
        '공유인수',
        '토지이동말소일자',
        '관련지번',
      ];
      const rows = maps.map((item) => {
        const rel = toStr(item.RELJIBUN)
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ');
        return [
          toStr(item.DYMD) || formatKrasYmd(toStr(item.LAND_MOV_YMD)) || '-',
          toStr(item.LAND_MOV_RSN_CD_NM) || '-',
          toStr(item.JIMOK_NM) || '-',
          formatAreaCell(item.PAREA),
          toStr(item.SHR_CNT) ? `${toStr(item.SHR_CNT)}명` : '-',
          formatKrasYmd(toStr(item.LAND_MOV_DEL_YMD)) || '-',
          rel || '-',
        ];
      });
      return {
        ok: true,
        kind,
        headers,
        rows,
        message: rows.length ? undefined : '요청된 이동연혁 데이터가 없습니다.',
      };
    }

    const headers = ['소재지코드', '등록번호', '소유구분', '소유자', '변동원인', '변동일자', '공유인수'];
    const rows = maps.map((item) => [
      toStr(item.LAND_LOC_CD) || '-',
      toStr(item.DREGNO) || '-',
      toStr(item.OWN_GBN_NM) || '-',
      toStr(item.OWNER_NM) || '-',
      toStr(item.OWN_RGT_CHG_RSN_CD_NM) || '-',
      formatKrasYmd(toStr(item.DYMD)) || '-',
      toStr(item.SHR_CNT) ? `${toStr(item.SHR_CNT)}명` : '-',
    ]);
    return {
      ok: true,
      kind,
      headers,
      rows,
      message: rows.length ? undefined : '요청된 변동연혁 데이터가 없습니다.',
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind, headers: [], rows: [], error: msg };
  }
}
