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

const KRAS_LAND_QUERY_ID = 'KRAS000002';
const KRAS_LAND_USE_QUERY_ID = 'KRAS000025';
const KRAS_LAYER_LIST_QUERY_ID = 'KRAS000037';
const KOREPS_PRICE_QUERY_ID = 'KOREPS00011';

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

function pickXmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? '';
}

async function postKrasXmlDetailed(
  url: string,
  body: string,
  timeoutMs?: number
): Promise<{ xml: string; httpStatus: number; error?: string }> {
  const ms = timeoutMs ?? PARCEL_ANALYSIS_LINKAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    const xml = await res.text().catch(() => '');
    return { xml, httpStatus: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = msg.toLowerCase().includes('abort');
    return { xml: '', httpStatus: 0, error: aborted ? '타임아웃' : msg };
  } finally {
    clearTimeout(timer);
  }
}

async function postKrasXml(url: string, body: string, timeoutMs?: number): Promise<string> {
  return (await postKrasXmlDetailed(url, body, timeoutMs)).xml;
}

function hangmangCallFromProbe(
  svcId: string,
  probe: { xml: string; httpStatus: number; error?: string }
): HangmangCallLine {
  if (probe.error && !probe.xml) {
    const skipped = probe.error === '키/주소 없음';
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
  const emptyProbe = { xml: '', httpStatus: 0 as const, error: undefined as string | undefined };

  const krasReady = Boolean(krasUrl && cfg.krasKey && cfg.sggCode);
  const korepsReady = Boolean(korepsUrl);

  const [p037, p002, p025, pKoreps] = await Promise.all([
    krasReady
      ? postKrasXmlDetailed(krasUrl!, buildKrasParam(pnu, KRAS_LAYER_LIST_QUERY_ID, cfg))
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? postKrasXmlDetailed(krasUrl!, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg))
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    krasReady
      ? postKrasXmlDetailed(krasUrl!, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg))
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
    korepsReady
      ? postKrasXmlDetailed(
          korepsUrl!,
          buildKrasParam(pnu, KOREPS_PRICE_QUERY_ID, cfg, cfg.korepsKey)
        )
      : Promise.resolve({ ...emptyProbe, error: '키/주소 없음' }),
  ]);

  return {
    calls: [
      hangmangCallFromProbe(KRAS_LAYER_LIST_QUERY_ID, p037),
      hangmangCallFromProbe(KRAS_LAND_QUERY_ID, p002),
      hangmangCallFromProbe(KRAS_LAND_USE_QUERY_ID, p025),
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
  const xml = await postKrasXml(url, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg));
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
  const xml = await postKrasXml(
    url,
    buildKrasParam(pnu, KOREPS_PRICE_QUERY_ID, cfg, cfg.korepsKey)
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
  const xml = await postKrasXml(url, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg));
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

/** 우클릭 필지정보 탭 — 서버는 행망(KRAS)만. 브이월드는 클라이언트 JSONP. */
export async function fetchParcelLandInfoTab(params: { pnu?: string }): Promise<
  ParcelLandInfoTabData & { ok: boolean; error?: string }
> {
  const pnu = toStr(params.pnu);
  const empty = { ...emptyParcelLandInfoTab(), ok: false as const };
  if (!/^\d{19}$/.test(pnu)) return { ...empty, error: '유효한 PNU(19자리)가 필요합니다.' };

  const cfg = getLandLinkageConfig();

  try {
    if (!cfg.useKras) {
      return {
        ...emptyParcelLandInfoTab(),
        ok: true,
        hangmangCalls: skippedHangmangCalls('외부망'),
      };
    }

    const probed = await probeHangmangCalls(pnu, cfg);
    const landRow = parseKrasLandInfoRows(probed.landXml)[0] ?? null;
    const useRows = parseKrasBodyFieldMaps(probed.useXml);
    const krasTab = mapKrasToParcelLandInfoTab(landRow, useRows);
    return {
      ...krasTab,
      ok: true,
      hangmangCalls: probed.calls,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg, hangmangCalls: skippedHangmangCalls(msg) };
  }
}
