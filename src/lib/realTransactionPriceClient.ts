/**
 * 토지 매매 실거래가 — 브라우저에서 RTMS 직접 조회.
 * 읍면동·리 경계/옵션은 기존처럼 서버(DB) call 유지.
 */
'use client';

import { call } from '@/lib/api';
import { fetchLandInfoConfig } from '@/lib/vworldParcelLandClient';

export type DongSummaryRowClient = {
  umdNm: string;
  emdCd: string | null;
  riCd: string | null;
  boundaryKind: 'emd' | 'ri' | null;
  count: number;
  medianPerSqm: number | null;
  avgPerSqm: number | null;
  totalAmountMan: number;
};

export type LandTradeRowClient = {
  umdNm: string;
  jibun: string;
  jimok: string;
  landUse: string;
  dealArea: number | null;
  dealAmountMan: number | null;
  perSqm: number | null;
  dealDate: string;
  dealingGbn: string;
  shareDealingType: string;
};

export type DongMapFeatureClient = DongSummaryRowClient & {
  wkt: string;
  center: { x: number; y: number } | null;
};

const LAND_TRADE_URL =
  'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PAGES = 40;
const PAGE_SIZE = 1000;

type LandTradeRaw = {
  umdNm: string;
  jibun: string;
  jimok: string;
  landUse: string;
  dealArea: number | null;
  dealAmountMan: number | null;
  dealYear: string;
  dealMonth: string;
  dealDay: string;
  cdealType: string;
  dealingGbn: string;
  shareDealingType: string;
};

type CacheEntry = { at: number; trades: LandTradeRaw[] };
const tradeCache = new Map<string, CacheEntry>();

function throwMsg(message: string): never {
  throw new Error(message);
}

function xmlTag(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,
    'i'
  );
  const m = block.match(re);
  return (m?.[1] ?? '').trim();
}

function parseAmountMan(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseArea(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLandTradeXml(xml: string): {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  items: LandTradeRaw[];
  authError?: string;
} {
  const authMsg = xmlTag(xml, 'returnAuthMsg') || xmlTag(xml, 'errMsg');
  if (authMsg) {
    return {
      resultCode: xmlTag(xml, 'returnReasonCode') || 'AUTH',
      resultMsg: authMsg,
      totalCount: 0,
      items: [],
      authError: authMsg,
    };
  }

  const resultCode = xmlTag(xml, 'resultCode') || '000';
  const resultMsg = xmlTag(xml, 'resultMsg') || '';
  const totalCount = Number(xmlTag(xml, 'totalCount') || '0') || 0;
  const items: LandTradeRaw[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1] ?? '';
    items.push({
      umdNm: xmlTag(block, 'umdNm'),
      jibun: xmlTag(block, 'jibun'),
      jimok: xmlTag(block, 'jimok'),
      landUse: xmlTag(block, 'landUse'),
      dealArea: parseArea(xmlTag(block, 'dealArea')),
      dealAmountMan: parseAmountMan(xmlTag(block, 'dealAmount')),
      dealYear: xmlTag(block, 'dealYear'),
      dealMonth: xmlTag(block, 'dealMonth'),
      dealDay: xmlTag(block, 'dealDay'),
      cdealType: xmlTag(block, 'cdealType'),
      dealingGbn: xmlTag(block, 'dealingGbn'),
      shareDealingType: xmlTag(block, 'shareDealingType'),
    });
  }
  return { resultCode, resultMsg, totalCount, items };
}

function isCancelled(trade: LandTradeRaw): boolean {
  const t = trade.cdealType.trim();
  if (!t) return false;
  return t !== '0' && !/^N$/i.test(t);
}

function normalizeUmd(name: string): string {
  return name.replace(/\s+/g, '').trim();
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return Math.round(sorted[mid]!);
}

function perSqmWon(amountMan: number | null, area: number | null): number | null {
  if (amountMan == null || area == null || area <= 0) return null;
  return Math.round((amountMan * 10_000) / area);
}

function dealDateLabel(t: LandTradeRaw): string {
  const y = t.dealYear.padStart(4, '0');
  const m = t.dealMonth.padStart(2, '0');
  const d = t.dealDay.padStart(2, '0');
  if (!y || y === '0000') return '—';
  return `${y}-${m}-${d}`;
}

function toTradeRow(t: LandTradeRaw): LandTradeRowClient {
  return {
    umdNm: t.umdNm,
    jibun: t.jibun || '—',
    jimok: t.jimok || '—',
    landUse: t.landUse || '—',
    dealArea: t.dealArea,
    dealAmountMan: t.dealAmountMan,
    perSqm: perSqmWon(t.dealAmountMan, t.dealArea),
    dealDate: dealDateLabel(t),
    dealingGbn: t.dealingGbn || '—',
    shareDealingType: t.shareDealingType || '',
  };
}

async function fetchRtmsKeys(): Promise<{ serviceKey: string; lawdCd: string }> {
  const [cfg, sggRes] = await Promise.all([
    fetchLandInfoConfig(),
    call('', 'POST', { service: 'configService', action: 'getSggCode', params: {} }),
  ]);
  const sggData = (sggRes?.data ?? sggRes) as { sggCode?: string };
  const lawdCd = String(sggData?.sggCode ?? '').trim();
  const serviceKey = String(cfg.dataPortalKey ?? '').trim();
  if (!lawdCd) throwMsg('시군구 코드(SGG_CODE)가 설정되어 있지 않습니다.');
  if (!serviceKey) throwMsg('공공데이터포털 인증키가 없습니다.');
  return { serviceKey, lawdCd };
}

async function fetchLandTradesPage(args: {
  serviceKey: string;
  lawdCd: string;
  dealYmd: string;
  pageNo: number;
}): Promise<{
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  items: LandTradeRaw[];
  authError?: string;
}> {
  const qs = new URLSearchParams();
  qs.set('serviceKey', args.serviceKey);
  qs.set('LAWD_CD', args.lawdCd);
  qs.set('DEAL_YMD', args.dealYmd);
  qs.set('pageNo', String(args.pageNo));
  qs.set('numOfRows', String(PAGE_SIZE));
  const res = await fetch(`${LAND_TRADE_URL}?${qs.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });
  const text = await res.text();
  return parseLandTradeXml(text);
}

async function loadTradesForMonth(dealYmd: string): Promise<LandTradeRaw[]> {
  const { serviceKey, lawdCd } = await fetchRtmsKeys();
  const cacheKey = `${lawdCd}:${dealYmd}`;
  const hit = tradeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.trades;

  const all: LandTradeRaw[] = [];
  let totalCount = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = await fetchLandTradesPage({
      serviceKey,
      lawdCd,
      dealYmd,
      pageNo: page,
    });
    if (parsed.authError) {
      throwMsg(
        `실거래가 API 인증 실패: ${parsed.authError}. 공공데이터포털에서 «토지 매매 실거래가» 활용신청을 확인하세요.`
      );
    }
    if (parsed.resultCode && parsed.resultCode !== '000' && parsed.resultCode !== '00') {
      if (parsed.resultCode === '03' || /NODATA|NO_DATA/i.test(parsed.resultMsg)) {
        break;
      }
      throwMsg(`실거래가 API 오류(${parsed.resultCode}): ${parsed.resultMsg || '조회 실패'}`);
    }
    totalCount = parsed.totalCount || totalCount;
    all.push(...parsed.items);
    if (all.length >= totalCount || parsed.items.length === 0) break;
  }

  const active = all.filter((t) => !isCancelled(t) && t.umdNm);
  tradeCache.set(cacheKey, { at: Date.now(), trades: active });
  return active;
}

function buildNameCodeMap(rows: { code: string; name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const name = normalizeUmd(row.name);
    if (!name || map.has(name)) continue;
    map.set(name, row.code);
  }
  return map;
}

function resolveBoundary(
  umdNm: string,
  emdMap: Map<string, string>,
  riMap: Map<string, string>
): { kind: 'emd' | 'ri' | null; emdCd: string | null; riCd: string | null } {
  const key = normalizeUmd(umdNm);
  const emdCd = emdMap.get(key) ?? null;
  if (emdCd) return { kind: 'emd', emdCd, riCd: null };

  const riExact = riMap.get(key) ?? null;
  if (riExact) return { kind: 'ri', emdCd: null, riCd: riExact };

  let bestName = '';
  let bestCd: string | null = null;
  for (const [riName, riCd] of riMap) {
    if (riName.length < 2) continue;
    if (!key.endsWith(riName)) continue;
    if (riName.length > bestName.length) {
      bestName = riName;
      bestCd = riCd;
    }
  }
  if (bestCd) return { kind: 'ri', emdCd: null, riCd: bestCd };
  return { kind: null, emdCd: null, riCd: null };
}

async function loadBoundaryMaps(): Promise<{
  emdMap: Map<string, string>;
  riMap: Map<string, string>;
}> {
  const [emdRes, riRes] = await Promise.all([
    call('', 'POST', { service: 'devTestService', action: 'getEmdRiOptions', params: {} }),
    call('', 'POST', { service: 'devTestService', action: 'getRiOptionsByEmd', params: {} }),
  ]);
  const emdPayload = (emdRes?.data ?? emdRes) as { emd?: { code: string; name: string }[] };
  const riPayload = (riRes?.data ?? riRes) as { ri?: { code: string; name: string }[] };
  return {
    emdMap: buildNameCodeMap(emdPayload.emd ?? []),
    riMap: buildNameCodeMap(riPayload.ri ?? []),
  };
}

/** 계약 연월별 읍면동·리 집계 */
export async function dongSummaryClient(params: {
  dealYmd?: string;
}): Promise<{
  dealYmd: string;
  sggCode: string;
  tradeCount: number;
  dongCount: number;
  rows: DongSummaryRowClient[];
}> {
  const dealYmd = String(params.dealYmd ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(dealYmd)) throwMsg('계약년월(YYYYMM)이 필요합니다.');

  const [{ lawdCd }, trades, { emdMap, riMap }] = await Promise.all([
    fetchRtmsKeys(),
    loadTradesForMonth(dealYmd),
    loadBoundaryMaps(),
  ]);

  const byDong = new Map<string, LandTradeRaw[]>();
  for (const t of trades) {
    const key = t.umdNm.trim();
    if (!key) continue;
    const list = byDong.get(key) ?? [];
    list.push(t);
    byDong.set(key, list);
  }

  const rows: DongSummaryRowClient[] = [];
  for (const [umdNm, list] of byDong) {
    const perSqmList: number[] = [];
    let totalAmountMan = 0;
    for (const t of list) {
      if (t.dealAmountMan != null) totalAmountMan += t.dealAmountMan;
      const p = perSqmWon(t.dealAmountMan, t.dealArea);
      if (p != null) perSqmList.push(p);
    }
    const avg =
      perSqmList.length > 0
        ? Math.round(perSqmList.reduce((a, b) => a + b, 0) / perSqmList.length)
        : null;
    const bound = resolveBoundary(umdNm, emdMap, riMap);
    rows.push({
      umdNm,
      emdCd: bound.emdCd,
      riCd: bound.riCd,
      boundaryKind: bound.kind,
      count: list.length,
      medianPerSqm: median(perSqmList),
      avgPerSqm: avg,
      totalAmountMan,
    });
  }

  rows.sort((a, b) => b.count - a.count || a.umdNm.localeCompare(b.umdNm, 'ko'));

  return {
    dealYmd,
    sggCode: lawdCd,
    tradeCount: trades.length,
    dongCount: rows.length,
    rows,
  };
}

/** 선택 읍면동의 거래 목록 */
export async function dongTradesClient(params: {
  dealYmd?: string;
  umdNm?: string;
}): Promise<{
  dealYmd: string;
  umdNm: string;
  emdCd: string | null;
  riCd: string | null;
  boundaryKind: 'emd' | 'ri' | null;
  count: number;
  medianPerSqm: number | null;
  avgPerSqm: number | null;
  avgAmountMan: number | null;
  totalAmountMan: number;
  rows: LandTradeRowClient[];
}> {
  const dealYmd = String(params.dealYmd ?? '').replace(/\D/g, '');
  const umdNm = String(params.umdNm ?? '').trim();
  if (!/^\d{6}$/.test(dealYmd)) throwMsg('계약년월(YYYYMM)이 필요합니다.');
  if (!umdNm) throwMsg('읍면동명이 필요합니다.');

  const [trades, { emdMap, riMap }] = await Promise.all([
    loadTradesForMonth(dealYmd),
    loadBoundaryMaps(),
  ]);
  const target = normalizeUmd(umdNm);
  const matched = trades.filter((t) => normalizeUmd(t.umdNm) === target);
  const rows = matched.map(toTradeRow).sort((a, b) => b.dealDate.localeCompare(a.dealDate));

  const perSqmList: number[] = [];
  const amountList: number[] = [];
  let totalAmountMan = 0;
  for (const t of matched) {
    if (t.dealAmountMan != null) {
      totalAmountMan += t.dealAmountMan;
      amountList.push(t.dealAmountMan);
    }
    const p = perSqmWon(t.dealAmountMan, t.dealArea);
    if (p != null) perSqmList.push(p);
  }
  const avgPerSqm =
    perSqmList.length > 0
      ? Math.round(perSqmList.reduce((a, b) => a + b, 0) / perSqmList.length)
      : null;
  const avgAmountMan =
    amountList.length > 0
      ? Math.round(amountList.reduce((a, b) => a + b, 0) / amountList.length)
      : null;

  const bound = resolveBoundary(umdNm, emdMap, riMap);

  return {
    dealYmd,
    umdNm: matched[0]?.umdNm ?? umdNm,
    emdCd: bound.emdCd,
    riCd: bound.riCd,
    boundaryKind: bound.kind,
    count: rows.length,
    medianPerSqm: median(perSqmList),
    avgPerSqm,
    avgAmountMan,
    totalAmountMan,
    rows,
  };
}

/** 지도 색칠용 — 읍면동·리 집계 + 행정경계 WKT(서버 DB) */
export async function dongMapFeaturesClient(params: {
  dealYmd?: string;
}): Promise<{ dealYmd: string; features: DongMapFeatureClient[] }> {
  const summary = await dongSummaryClient(params);
  const withCode = summary.rows.filter((r) => r.boundaryKind && (r.emdCd || r.riCd));
  const features: DongMapFeatureClient[] = [];

  const chunk = 12;
  for (let i = 0; i < withCode.length; i += chunk) {
    const batch = withCode.slice(i, i + chunk);
    const parts = await Promise.all(
      batch.map(async (row) => {
        const res =
          row.boundaryKind === 'ri' && row.riCd
            ? await call('', 'POST', {
                service: 'devTestService',
                action: 'getRiGeometry',
                params: { riCode: String(row.riCd) },
              })
            : row.emdCd
              ? await call('', 'POST', {
                  service: 'devTestService',
                  action: 'getEmdGeometry',
                  params: { emdCode: String(row.emdCd) },
                })
              : null;
        const g = (res?.data ?? res ?? {}) as {
          wkt?: string | null;
          center?: { x?: number; y?: number } | null;
        };
        const wkt = g.wkt != null ? String(g.wkt).trim() : '';
        if (!wkt) return null;
        return {
          ...row,
          wkt,
          center:
            g.center?.x != null && g.center?.y != null
              ? { x: Number(g.center.x), y: Number(g.center.y) }
              : null,
        } satisfies DongMapFeatureClient;
      })
    );
    for (const p of parts) {
      if (p) features.push(p);
    }
  }

  return {
    dealYmd: summary.dealYmd,
    features,
  };
}
