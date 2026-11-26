/**
 * 침수현황 — 브라우저에서 HRFCO 직접 호출 (서버 /api/flood 프록시 미사용)
 */
import { call } from '@/lib/api';
import {
  buildFloodErrorBody,
  type FloodApiErrorBody,
} from '@/lib/hrfcoErrors';
import {
  fetchHrfco,
  inBbox,
  parseFloodForecasts,
  parseForecastAncdt,
  parseRainObservations,
  parseRainStations,
  parseWaterObservations,
  parseWaterStations,
  pickLatestObservation,
  stationIncludesSggNm,
  type ParsedFloodForecast,
  type ParsedObservation,
  type ParsedStation,
} from '@/lib/hrfcoClient';
import type {
  FloodBatchKindAvg,
  FloodTimeType,
  SafetyWaterObservation,
  SafetyWaterStatPoint,
  SafetyWaterStation,
  SafetyWaterStationKind,
} from './safetyWaterTypes';

const ALLOWED_TIME = new Set(['10M', '1H', '1D']);
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_CONCURRENCY = 6;
const STATS_CONCURRENCY = 4;

let cachedApiKey: string | null | undefined;
let apiKeyPromise: Promise<string | null> | null = null;

export async function resolveFloodApiKey(): Promise<string | null> {
  if (cachedApiKey !== undefined) return cachedApiKey;
  if (!apiKeyPromise) {
    apiKeyPromise = (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getMapConfig',
          params: {},
        });
        const data = (res?.data ?? res) as { FLOOD_API_KEY?: string } | null;
        const key = String(data?.FLOOD_API_KEY ?? '').trim();
        cachedApiKey = key || null;
        return cachedApiKey;
      } catch {
        cachedApiKey = null;
        return null;
      } finally {
        apiKeyPromise = null;
      }
    })();
  }
  return apiKeyPromise;
}

async function requireFloodApiKey(): Promise<
  { ok: true; apiKey: string } | { ok: false; body: FloodApiErrorBody }
> {
  const apiKey = await resolveFloodApiKey();
  if (!apiKey) {
    return {
      ok: false,
      body: buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured'),
    };
  }
  return { ok: true, apiKey };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function fetchFloodSggNames(): Promise<string[]> {
  try {
    const res = await call('', 'POST', {
      service: 'floodRiskService',
      action: 'listFloodFilterSggNames',
      params: {},
    });
    const data = (res?.data ?? res) as { items?: string[] } | null;
    return Array.isArray(data?.items) ? data.items.filter((n) => String(n).trim()) : [];
  } catch {
    return [];
  }
}

export type FloodStationsResult =
  | { ok: true; items: SafetyWaterStation[]; sggNames: string[] }
  | { ok: false; body: FloodApiErrorBody };

export async function fetchFloodStations(bbox: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): Promise<FloodStationsResult> {
  const keyRes = await requireFloodApiKey();
  if (!keyRes.ok) return { ok: false, body: keyRes.body };

  const { minX, maxX, minY, maxY } = bbox;
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
    return {
      ok: false,
      body: buildFloodErrorBody(null, 'ours', 'minX,maxX,minY,maxY(WGS84) required'),
    };
  }

  const [waterRes, rainRes, sggNames] = await Promise.all([
    fetchHrfco(keyRes.apiKey, 'waterlevel/info.xml', 'xml'),
    fetchHrfco(keyRes.apiKey, 'rainfall/info.xml', 'xml'),
    fetchFloodSggNames(),
  ]);

  if (!waterRes.ok && !rainRes.ok) {
    const prefer =
      waterRes.body.errorClass === 'provider' || rainRes.body.errorClass === 'provider'
        ? waterRes.body.errorClass === 'provider'
          ? waterRes
          : rainRes
        : waterRes;
    return { ok: false, body: prefer.body };
  }

  const water = waterRes.ok ? parseWaterStations(waterRes.data) : [];
  const rain = rainRes.ok ? parseRainStations(rainRes.data) : [];
  const items = ([...water, ...rain] as ParsedStation[]).filter(
    (s) =>
      inBbox(s.lon, s.lat, minX, maxX, minY, maxY) && stationIncludesSggNm(s, sggNames)
  ) as SafetyWaterStation[];

  return { ok: true, items, sggNames };
}

export type FloodObservationResult =
  | {
      ok: true;
      kind: SafetyWaterStationKind;
      code: string;
      time: FloodTimeType;
      item: ParsedObservation | null;
      items: ParsedObservation[];
      noData?: boolean;
    }
  | { ok: false; body: FloodApiErrorBody; noData?: boolean };

export async function fetchFloodObservation(opts: {
  kind: SafetyWaterStationKind;
  code: string;
  time?: FloodTimeType;
}): Promise<FloodObservationResult> {
  const keyRes = await requireFloodApiKey();
  if (!keyRes.ok) return { ok: false, body: keyRes.body };

  const timeRaw = (opts.time ?? '10M').toUpperCase();
  const time = (ALLOWED_TIME.has(timeRaw) ? timeRaw : '10M') as FloodTimeType;
  const code = opts.code.trim();
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return { ok: false, body: buildFloodErrorBody(null, 'ours', 'code(Wlobscd|Rfobscd) required') };
  }

  const path =
    opts.kind === 'water'
      ? `waterlevel/list/${time}/${encodeURIComponent(code)}.json`
      : `rainfall/list/${time}/${encodeURIComponent(code)}.json`;

  const res = await fetchHrfco(keyRes.apiKey, path, 'json', { quietCodes: [990] });
  if (!res.ok) {
    return {
      ok: false,
      body: res.body,
      noData: res.body.code === 990,
    };
  }

  const items =
    opts.kind === 'water'
      ? parseWaterObservations(res.data, code)
      : parseRainObservations(res.data, code);
  return {
    ok: true,
    kind: opts.kind,
    code,
    time,
    item: pickLatestObservation(items),
    items,
  };
}

export type FloodBatchResult =
  | {
      ok: true;
      time: FloodTimeType;
      water: FloodBatchKindAvg;
      rain: FloodBatchKindAvg;
      items: { kind: SafetyWaterStationKind; code: string; value: number | null; observedAt: string }[];
    }
  | { ok: false; body: FloodApiErrorBody };

export async function fetchFloodObservationsBatch(opts: {
  time?: FloodTimeType;
  stations: { kind: SafetyWaterStationKind; code: string }[];
}): Promise<FloodBatchResult> {
  const keyRes = await requireFloodApiKey();
  if (!keyRes.ok) return { ok: false, body: keyRes.body };

  const timeRaw = String(opts.time ?? '10M').trim().toUpperCase();
  const time = (ALLOWED_TIME.has(timeRaw) ? timeRaw : '10M') as FloodTimeType;
  const stations = opts.stations.filter(
    (s) =>
      (s.kind === 'water' || s.kind === 'rain') &&
      s.code &&
      /^[A-Za-z0-9_-]+$/.test(s.code)
  );

  if (stations.length === 0) {
    return {
      ok: true,
      time,
      water: { average: null, count: 0, observedAt: '' },
      rain: { average: null, count: 0, observedAt: '' },
      items: [],
    };
  }

  type OneResult = {
    kind: SafetyWaterStationKind;
    code: string;
    value: number | null;
    observedAt: string;
    ok: boolean;
    body?: FloodApiErrorBody;
  };

  const results = await mapPool(stations, BATCH_CONCURRENCY, async (st): Promise<OneResult> => {
    const path =
      st.kind === 'water'
        ? `waterlevel/list/${time}/${encodeURIComponent(st.code)}.json`
        : `rainfall/list/${time}/${encodeURIComponent(st.code)}.json`;
    const res = await fetchHrfco(keyRes.apiKey, path, 'json', { quietCodes: [990] });
    if (!res.ok) {
      return {
        kind: st.kind,
        code: st.code,
        value: null,
        observedAt: '',
        ok: false,
        body: res.body,
      };
    }
    const list =
      st.kind === 'water'
        ? parseWaterObservations(res.data, st.code)
        : parseRainObservations(res.data, st.code);
    const latest = pickLatestObservation(list);
    return {
      kind: st.kind,
      code: st.code,
      value: latest?.value ?? null,
      observedAt: latest?.observedAt ?? '',
      ok: true,
    };
  });

  const fatal = results.find((r) => !r.ok && r.body?.errorClass === 'provider');
  if (fatal?.body) return { ok: false, body: fatal.body };

  function avgOf(kind: SafetyWaterStationKind): FloodBatchKindAvg {
    const vals: number[] = [];
    let latestAt = '';
    for (const r of results) {
      if (r.kind !== kind || !r.ok || r.value == null || !Number.isFinite(r.value)) continue;
      vals.push(r.value);
      if ((r.observedAt || '') > latestAt) latestAt = r.observedAt || '';
    }
    if (vals.length === 0) return { average: null, count: 0, observedAt: '' };
    return {
      average: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length,
      observedAt: latestAt,
    };
  }

  return {
    ok: true,
    time,
    water: avgOf('water'),
    rain: avgOf('rain'),
    items: results
      .filter((r) => r.ok)
      .map((r) => ({
        kind: r.kind,
        code: r.code,
        value: r.value,
        observedAt: r.observedAt,
      })),
  };
}

function tokenLen(time: FloodTimeType) {
  if (time === '1D') return 8;
  if (time === '1H') return 10;
  return 12;
}

function isToken(raw: string, time: FloodTimeType) {
  return new RegExp(`^\\d{${tokenLen(time)}}$`).test(raw);
}

function parseToken(raw: string, time: FloodTimeType): Date | null {
  if (!isToken(raw, time)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const h = time === '1D' ? 0 : Number(raw.slice(8, 10));
  const min = time === '10M' ? Number(raw.slice(10, 12)) : 0;
  const dt = new Date(y, m, d, h, min, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function formatToken(d: Date, time: FloodTimeType): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (time === '1D') return `${y}${m}${day}`;
  if (time === '1H') return `${y}${m}${day}${h}`;
  return `${y}${m}${day}${h}${min}`;
}

function stepMs(time: FloodTimeType) {
  if (time === '1D') return DAY_MS;
  if (time === '1H') return 60 * 60 * 1000;
  return 10 * 60 * 1000;
}

function maxRangeMs(time: FloodTimeType) {
  if (time === '1D') return 365 * DAY_MS;
  return 31 * DAY_MS;
}

function mapByBucket(items: { observedAt: string; value: number | null }[], time: FloodTimeType) {
  const len = tokenLen(time);
  const out = new Map<string, number[]>();
  for (const item of items) {
    const raw = item.observedAt.replace(/\D/g, '');
    if (raw.length < len || item.value == null || !Number.isFinite(item.value)) continue;
    const key = raw.slice(0, len);
    const found = out.get(key);
    if (found) found.push(item.value);
    else out.set(key, [item.value]);
  }
  return out;
}

export type FloodStatsResult =
  | { ok: true; kind: SafetyWaterStationKind; time: FloodTimeType; sdt: string; edt: string; items: SafetyWaterStatPoint[] }
  | { ok: false; body: FloodApiErrorBody };

export async function fetchFloodObservationStats(opts: {
  kind: SafetyWaterStationKind;
  time?: FloodTimeType;
  sdt: string;
  edt: string;
  stations: { code: string }[];
}): Promise<FloodStatsResult> {
  const keyRes = await requireFloodApiKey();
  if (!keyRes.ok) return { ok: false, body: keyRes.body };

  const kind = opts.kind;
  const timeRaw = String(opts.time ?? '1D').trim().toUpperCase();
  const time = (ALLOWED_TIME.has(timeRaw) ? timeRaw : '1D') as FloodTimeType;
  const sdt = opts.sdt.trim();
  const edt = opts.edt.trim();

  const start = parseToken(sdt, time);
  const end = parseToken(edt, time);
  if (!start || !end || start > end) {
    return {
      ok: false,
      body: buildFloodErrorBody(
        null,
        'ours',
        `valid sdt/edt required (${time === '1D' ? 'yyyyMMdd' : time === '1H' ? 'yyyyMMddHH' : 'yyyyMMddHHmm'})`
      ),
    };
  }
  if (end.getTime() - start.getTime() > maxRangeMs(time)) {
    return {
      ok: false,
      body: buildFloodErrorBody(
        null,
        'ours',
        time === '1D' ? 'date range must be within 1 year' : 'date range must be within 1 month'
      ),
    };
  }

  const stations = opts.stations.filter((s) => s.code && /^[A-Za-z0-9_-]+$/.test(s.code));
  if (stations.length === 0) {
    return { ok: true, kind, time, sdt, edt, items: [] };
  }

  const results = await mapPool(stations, STATS_CONCURRENCY, async ({ code }) => {
    const path =
      kind === 'water'
        ? `waterlevel/list/${time}/${encodeURIComponent(code)}/${sdt}/${edt}.xml`
        : `rainfall/list/${time}/${encodeURIComponent(code)}/${sdt}/${edt}.xml`;
    const res = await fetchHrfco(keyRes.apiKey, path, 'xml', { quietCodes: [990] });
    if (!res.ok) return { ok: false as const, body: res.body };
    const list =
      kind === 'water'
        ? parseWaterObservations(res.data, code)
        : parseRainObservations(res.data, code);
    return { ok: true as const, rows: mapByBucket(list, time) };
  });

  const fatal = results.find((r) => !r.ok && r.body.errorClass === 'provider');
  if (fatal && !fatal.ok) return { ok: false, body: fatal.body };

  const step = stepMs(time);
  const items: SafetyWaterStatPoint[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const key = formatToken(new Date(t), time);
    const values: number[] = [];
    for (const result of results) {
      if (!result.ok) continue;
      const bucket = result.rows.get(key);
      if (bucket) values.push(...bucket);
    }
    if (values.length === 0) {
      items.push({ date: key, value: null, count: 0 });
      continue;
    }
    items.push({
      date: key,
      value: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    });
  }

  return { ok: true, kind, time, sdt, edt, items };
}

export type FloodForecastResult =
  | { ok: true; items: ParsedFloodForecast[] }
  | { ok: false; body: FloodApiErrorBody };

export async function fetchFloodForecasts(codes?: string[]): Promise<FloodForecastResult> {
  const keyRes = await requireFloodApiKey();
  if (!keyRes.ok) return { ok: false, body: keyRes.body };

  // 990 = 최근 발령 없음 — 정상(빈 목록). console.error 올리지 않음.
  const res = await fetchHrfco(keyRes.apiKey, 'fldfct/list.xml', 'xml', { quietCodes: [990] });
  if (!res.ok) {
    if (res.body.code === 990) return { ok: true, items: [] };
    return { ok: false, body: res.body };
  }

  const codeSet = new Set((codes ?? []).map((c) => c.trim()).filter(Boolean));
  const now = Date.now();
  let items = parseFloodForecasts(res.data).filter((it) => {
    const dt = parseForecastAncdt(it.ancdt);
    if (!dt) return true;
    return now - dt.getTime() <= DAY_MS;
  });
  if (codeSet.size > 0) {
    items = items.filter((it) => codeSet.has(it.sttnm));
  }
  return { ok: true, items };
}

export function avgToObservation(
  kind: SafetyWaterStationKind,
  avg: FloodBatchKindAvg | null | undefined
): SafetyWaterObservation | null {
  if (!avg) return null;
  return {
    code: '',
    value: avg.average,
    observedAt: avg.observedAt ?? '',
    isAverage: true,
    averageCount: avg.count,
    stationName: kind === 'water' ? '평균 수위' : '평균 강수량',
  };
}
