/**
 * 필지 토지·소유 보강 — 행망 KRAS 우선, 실패 시 캐시·브이월드.
 * 필지분석 4-A 및 추후 우클릭 필지정보가 공유한다.
 */
import { buildPnuFromKrasRow, parseKrasLandInfoRows } from '@/lib/krasLandXml';
import { parseKrasBodyFieldMaps, zonesFromKrasLandUseRows } from '@/lib/krasLandUseXml';
import {
  normalizeFromCacheRow,
  normalizeFromKrasRow,
  normalizeFromVworldParts,
  type NormalizedParcelLand,
  type ParcelLandEnrichmentMap,
  type ParcelLandSource,
} from '@/lib/parcelLandNormalize';
import { getLandLinkageConfig, getParcelAnalysisTuning } from '@/service/configService';
import {
  emptyParcelLandInfoTab,
  hasParcelLandInfoTabData,
  mapKrasToParcelLandInfoTab,
  type ParcelLandInfoTabData,
} from '@/lib/parcelLandInfoTab';
import { getJijukLandAttrsByPnus, getParcelTabDataFromCache, upsertJijukLandAttrFromParcelData } from '@/service/jijukLandAttrService';

const KRAS_LAND_QUERY_ID = 'KRAS000002';
const KRAS_LAND_USE_QUERY_ID = 'KRAS000025';
const BATCH_CHUNK = 100;

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function toNum(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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
  cfg: ReturnType<typeof getLandLinkageConfig>
): string {
  const parts = parsePnuParts(pnu);
  const qs = new URLSearchParams();
  qs.set('conn_sys_id', cfg.krasKey);
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

async function postKrasXml(url: string, body: string, timeoutMs = 5000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
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
  const out: ParcelLandEnrichmentMap = {};
  for (let i = 0; i < pnus.length; i += BATCH_CHUNK) {
    const chunk = pnus.slice(i, i + BATCH_CHUNK);
    const results = await Promise.all(chunk.map((pnu) => fetchKrasForPnu(pnu, cfg)));
    chunk.forEach((pnu, idx) => {
      const row = results[idx];
      if (row) out[pnu] = row;
    });
  }
  return out;
}

type VworldJson = {
  landCharacteristicss?: { field?: Record<string, unknown> | Record<string, unknown>[] };
  possessions?: { field?: Record<string, unknown> | Record<string, unknown>[] };
  indvdLandPrices?: { field?: Record<string, unknown> | Record<string, unknown>[] };
};

function pickVworldField(payload: VworldJson | null, rootKey: keyof VworldJson): Record<string, unknown> | null {
  if (!payload) return null;
  const root = payload[rootKey] as { field?: unknown } | undefined;
  const field = root?.field;
  if (!field) return null;
  if (Array.isArray(field)) return (field[0] as Record<string, unknown>) ?? null;
  return field as Record<string, unknown>;
}

async function fetchVworldJson(url: string): Promise<VworldJson | null> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VworldJson;
  } catch {
    return null;
  }
}

async function fetchVworldForPnu(
  pnu: string,
  vworldKey: string
): Promise<NormalizedParcelLand | null> {
  if (!vworldKey) return null;
  const base = 'https://api.vworld.kr/ned/data';
  const q = (path: string) => {
    const u = new URL(`${base}/${path}`);
    u.searchParams.set('key', vworldKey);
    u.searchParams.set('pnu', pnu);
    u.searchParams.set('format', 'json');
    u.searchParams.set('numOfRows', '1000');
    return u.toString();
  };
  const [charRaw, possRaw, priceRaw] = await Promise.all([
    fetchVworldJson(q('getLandCharacteristics')),
    fetchVworldJson(q('getPossessionAttr')),
    fetchVworldJson(q('getIndvdLandPriceAttr')),
  ]);
  const char = pickVworldField(charRaw, 'landCharacteristicss');
  const poss = pickVworldField(possRaw, 'possessions');
  const price = pickVworldField(priceRaw, 'indvdLandPrices');
  if (!char && !poss && !price) return null;
  return normalizeFromVworldParts(pnu, {
    jimok: toStr(char?.lndcgrCodeNm),
    jimokNm: toStr(char?.lndcgrCodeNm),
    areaSqm: toNum(char?.lndpclAr),
    ownerName: toStr(poss?.ownerNm),
    ownerType: toStr(poss?.posesnSeCodeNm) || toStr(poss?.nationInsttSeCodeNm),
    publicPrice: toNum(price?.pblntfPclnd) || null,
  });
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

async function fetchCacheBatch(pnus: string[]): Promise<ParcelLandEnrichmentMap> {
  const { rows } = await getJijukLandAttrsByPnus({ pnus });
  const out: ParcelLandEnrichmentMap = {};
  for (const pnu of pnus) {
    const row = rows[pnu];
    if (row) out[pnu] = normalizeFromCacheRow(pnu, row);
  }
  return out;
}

async function fetchVworldBatch(
  pnus: string[],
  vworldKey: string
): Promise<ParcelLandEnrichmentMap> {
  const results = await mapPool(pnus, getParcelAnalysisTuning().linkageConcurrency, (pnu) => fetchVworldForPnu(pnu, vworldKey));
  const out: ParcelLandEnrichmentMap = {};
  pnus.forEach((pnu, i) => {
    const row = results[i];
    if (row) out[pnu] = row;
  });
  return out;
}

function mergeMaps(...maps: ParcelLandEnrichmentMap[]): ParcelLandEnrichmentMap {
  const out: ParcelLandEnrichmentMap = {};
  for (const map of maps) Object.assign(out, map);
  return out;
}

function missingPnus(pnus: string[], map: ParcelLandEnrichmentMap): string[] {
  return pnus.filter((p) => !map[p]);
}

/** PNU 목록 보강 — 행망 우선, fallback 시 캐시→브이월드 */
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
  }

  const needExternal = cfg.useKras ? cfg.useKrasFallback && missingPnus(pnus, enrichments).length > 0 : true;

  if (needExternal) {
    const targets = cfg.useKras ? missingPnus(pnus, enrichments) : pnus;
    const cached = await fetchCacheBatch(targets);
    enrichments = mergeMaps(enrichments, cached);
    if (Object.keys(cached).length) usedSources.add('cache');

    const vworldTargets = missingPnus(targets, enrichments);
    if (vworldTargets.length && cfg.vworldKey) {
      const vworld = await fetchVworldBatch(vworldTargets, cfg.vworldKey);
      enrichments = mergeMaps(enrichments, vworld);
      if (Object.keys(vworld).length) usedSources.add('vworld');
    }
  }

  let source: ParcelLandSource | 'mixed' | 'db' = 'db';
  if (usedSources.size === 1) source = [...usedSources][0]!;
  else if (usedSources.size > 1) source = 'mixed';

  return { enrichments, source };
}

export function shouldMaskParcelOwners(): boolean {
  return getLandLinkageConfig().maskPersonalInfo;
}

type VworldLandUseJson = {
  landUses?: { field?: Record<string, unknown> | Record<string, unknown>[] };
};

async function fetchVworldLandUseJson(url: string): Promise<VworldLandUseJson | null> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VworldLandUseJson;
  } catch {
    return null;
  }
}

function parseVworldLandUseZones(payload: VworldLandUseJson | null): string[] {
  if (!payload?.landUses?.field) return [];
  const field = payload.landUses.field;
  const rows = Array.isArray(field) ? field : [field];
  const zones = new Set<string>();
  for (const row of rows) {
    const label = toStr(row.prposAreaDstrcCodeNm);
    if (label) zones.add(label);
  }
  return [...zones];
}

async function fetchVworldLandUseZonesForPnu(pnu: string, vworldKey: string): Promise<string[]> {
  if (!vworldKey) return [];
  const u = new URL('https://api.vworld.kr/ned/data/getLandUseAttr');
  u.searchParams.set('key', vworldKey);
  u.searchParams.set('pnu', pnu);
  u.searchParams.set('format', 'json');
  u.searchParams.set('numOfRows', '1000');
  const raw = await fetchVworldLandUseJson(u.toString());
  return parseVworldLandUseZones(raw);
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

function missingLandUsePnus(pnus: string[], zonesByPnu: Record<string, string[]>): string[] {
  return pnus.filter((p) => !(zonesByPnu[p]?.length > 0));
}

/** 토지이용계획 용도지역 — 행망(KRAS000025) 우선, 실패 시 캐시→브이월드 */
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
      const krasResults = await mapPool(unique, getParcelAnalysisTuning().linkageConcurrency, (pnu) =>
        fetchKrasLandUseZonesForPnu(pnu, cfg)
      );
      unique.forEach((pnu, i) => {
        const zones = krasResults[i] ?? [];
        if (zones.length) zonesByPnu[pnu] = zones;
      });
    }

    const needExternal = cfg.useKras
      ? cfg.useKrasFallback && missingLandUsePnus(unique, zonesByPnu).length > 0
      : true;

    if (needExternal) {
      const targets = cfg.useKras ? missingLandUsePnus(unique, zonesByPnu) : unique;

      const { rows } = await getJijukLandAttrsByPnus({ pnus: targets });
      const stillMissing: string[] = [];
      for (const pnu of targets) {
        const main = toStr(rows[pnu]?.prpos_area_main);
        if (main) zonesByPnu[pnu] = [main];
        else stillMissing.push(pnu);
      }

      if (stillMissing.length && cfg.vworldKey) {
        const vworldResults = await mapPool(stillMissing, getParcelAnalysisTuning().linkageConcurrency, (pnu) =>
          fetchVworldLandUseZonesForPnu(pnu, cfg.vworldKey)
        );
        stillMissing.forEach((pnu, i) => {
          const zones = vworldResults[i] ?? [];
          if (zones.length) zonesByPnu[pnu] = zones;
        });
      }
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
) {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) return null;
  const xml = await postKrasXml(url, buildKrasParam(pnu, KRAS_LAND_QUERY_ID, cfg));
  return parseKrasLandInfoRows(xml)[0] ?? null;
}

async function fetchKrasLandUseRowsForPnu(
  pnu: string,
  cfg: ReturnType<typeof getLandLinkageConfig>
) {
  const url = buildKrasUrl(cfg);
  if (!url || !cfg.krasKey || !cfg.sggCode) return [];
  const xml = await postKrasXml(url, buildKrasParam(pnu, KRAS_LAND_USE_QUERY_ID, cfg));
  return parseKrasBodyFieldMaps(xml);
}

type VworldNedJson = {
  landCharacteristicss?: { field?: Record<string, unknown> | Record<string, unknown>[] };
  landUses?: { field?: Record<string, unknown> | Record<string, unknown>[] };
  indvdLandPrices?: { field?: Record<string, unknown> | Record<string, unknown>[] };
  possessions?: { field?: Record<string, unknown> | Record<string, unknown>[] };
};

async function fetchVworldNedJson(url: string): Promise<VworldNedJson | null> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VworldNedJson;
  } catch {
    return null;
  }
}

function pickVworldRows(
  payload: VworldNedJson | null,
  rootKey: keyof VworldNedJson
): Record<string, unknown>[] {
  if (!payload) return [];
  const root = payload[rootKey] as { field?: unknown } | undefined;
  const field = root?.field;
  if (Array.isArray(field)) {
    return field.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  }
  if (field && typeof field === 'object') return [field as Record<string, unknown>];
  return [];
}

function dedupeVworldRows(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const signature = keys.map((k) => toStr(row[k])).join('||');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(row);
  }
  return out;
}

async function fetchVworldParcelTabData(
  pnu: string,
  vworldKey: string
): Promise<ParcelLandInfoTabData> {
  if (!vworldKey) return emptyParcelLandInfoTab('vworld');
  const base = 'https://api.vworld.kr/ned/data';
  const q = (path: string) => {
    const u = new URL(`${base}/${path}`);
    u.searchParams.set('key', vworldKey);
    u.searchParams.set('pnu', pnu);
    u.searchParams.set('format', 'json');
    u.searchParams.set('numOfRows', '1000');
    return u.toString();
  };
  const [charRaw, landUseRaw, priceRaw, possRaw] = await Promise.all([
    fetchVworldNedJson(q('getLandCharacteristics')),
    fetchVworldNedJson(q('getLandUseAttr')),
    fetchVworldNedJson(q('getIndvdLandPriceAttr')),
    fetchVworldNedJson(q('getPossessionAttr')),
  ]);
  return {
    characteristics: dedupeVworldRows(pickVworldRows(charRaw, 'landCharacteristicss'), [
      'ldCodeNm',
      'stdrYear',
      'stdrMt',
      'pblntfPclnd',
      'lndcgrCodeNm',
      'lndpclAr',
    ]),
    landUses: dedupeVworldRows(pickVworldRows(landUseRaw, 'landUses'), [
      'prposAreaDstrcCodeNm',
      'cnflcAtNm',
      'registDt',
    ]),
    prices: dedupeVworldRows(pickVworldRows(priceRaw, 'indvdLandPrices'), [
      'pblntfDe',
      'pblntfPclnd',
      'registDt',
    ]),
    possessions: dedupeVworldRows(pickVworldRows(possRaw, 'possessions'), [
      'posesnSeCodeNm',
      'nationInsttSeCodeNm',
      'ownerNm',
      'ownerAddr',
      'ownshipChgDe',
    ]),
    source: 'vworld',
  };
}

/** 우클릭 필지정보 탭 — 행망(KRAS) 우선, 실패 시 캐시→브이월드 */
export async function fetchParcelLandInfoTab(params: { pnu?: string }): Promise<
  ParcelLandInfoTabData & { ok: boolean; error?: string }
> {
  const pnu = toStr(params.pnu);
  const empty = { ...emptyParcelLandInfoTab(), ok: false as const };
  if (!/^\d{19}$/.test(pnu)) return { ...empty, error: '유효한 PNU(19자리)가 필요합니다.' };

  const cfg = getLandLinkageConfig();

  try {
    if (cfg.useKras) {
      const [landRow, useRows] = await Promise.all([
        fetchKrasLandInfoRowForPnu(pnu, cfg),
        fetchKrasLandUseRowsForPnu(pnu, cfg),
      ]);
      const krasTab = mapKrasToParcelLandInfoTab(landRow, useRows);
      if (hasParcelLandInfoTabData(krasTab)) {
        return { ...krasTab, ok: true };
      }
    }

    const needExternal = cfg.useKras ? cfg.useKrasFallback : true;
    if (!needExternal) {
      return { ...emptyParcelLandInfoTab('kras'), ok: true };
    }

    const cached = await getParcelTabDataFromCache({ pnu });
    if (cached.hit) {
      return {
        characteristics: cached.characteristics ?? [],
        landUses: cached.landUses ?? [],
        prices: cached.prices ?? [],
        possessions: cached.possessions ?? [],
        source: 'cache',
        ok: true,
      };
    }

    const vworldTab = await fetchVworldParcelTabData(pnu, cfg.vworldKey);
    if (hasParcelLandInfoTabData(vworldTab)) {
      void upsertJijukLandAttrFromParcelData({
        pnu,
        characteristics: vworldTab.characteristics,
        landUses: vworldTab.landUses,
        prices: vworldTab.prices,
        possessions: vworldTab.possessions,
      }).catch(() => undefined);
    }
    return { ...vworldTab, ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }
}
