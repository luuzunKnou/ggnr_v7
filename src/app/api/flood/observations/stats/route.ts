import { NextRequest, NextResponse } from 'next/server';
import { buildFloodErrorBody, logFloodError } from '../../_lib/hrfcoErrors';
import {
  fetchHrfco,
  getFloodApiKey,
  parseRainObservations,
  parseWaterObservations,
} from '../../_lib/hrfcoClient';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;
const ALLOWED_TIME = new Set(['10M', '1H', '1D']);

type StationReq = { code: string };
type StatPoint = { date: string; value: number | null; count: number };
type TimeType = '10M' | '1H' | '1D';

function tokenLen(time: TimeType) {
  if (time === '1D') return 8;
  if (time === '1H') return 10;
  return 12;
}

function isToken(raw: string, time: TimeType) {
  return new RegExp(`^\\d{${tokenLen(time)}}$`).test(raw);
}

function parseToken(raw: string, time: TimeType): Date | null {
  if (!isToken(raw, time)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const h = time === '1D' ? 0 : Number(raw.slice(8, 10));
  const min = time === '10M' ? Number(raw.slice(10, 12)) : 0;
  const dt = new Date(y, m, d, h, min, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function formatToken(d: Date, time: TimeType): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (time === '1D') return `${y}${m}${day}`;
  if (time === '1H') return `${y}${m}${day}${h}`;
  return `${y}${m}${day}${h}${min}`;
}

function stepMs(time: TimeType) {
  if (time === '1D') return DAY_MS;
  if (time === '1H') return 60 * 60 * 1000;
  return 10 * 60 * 1000;
}

function maxRangeMs(time: TimeType) {
  if (time === '1D') return 365 * DAY_MS;
  return 31 * DAY_MS;
}

function mapByBucket(
  items: { observedAt: string; value: number | null }[],
  time: TimeType
) {
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

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
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

/**
 * 기간 통계.
 * Body: { kind, time: 10M|1H|1D, stations: [{code}], sdt, edt }
 * sdt/edt: 10M=yyyyMMddHHmm, 1H=yyyyMMddHH, 1D=yyyyMMdd
 */
export async function POST(req: NextRequest) {
  const apiKey = getFloodApiKey();
  if (!apiKey) {
    const body = buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured');
    logFloodError('observations/stats', body);
    return NextResponse.json(body, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    const body = buildFloodErrorBody(null, 'ours', 'invalid JSON body');
    logFloodError('observations/stats', body);
    return NextResponse.json(body, { status: 400 });
  }

  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const kind = String(o.kind ?? '').trim().toLowerCase();
  const timeRaw = String(o.time ?? '1D').trim().toUpperCase();
  const time = (ALLOWED_TIME.has(timeRaw) ? timeRaw : '1D') as TimeType;
  const sdt = String(o.sdt ?? '').trim();
  const edt = String(o.edt ?? '').trim();
  const stationsRaw = Array.isArray(o.stations) ? o.stations : [];

  if (kind !== 'water' && kind !== 'rain') {
    const body = buildFloodErrorBody(null, 'ours', 'kind=water|rain required');
    logFloodError('observations/stats', body);
    return NextResponse.json(body, { status: 400 });
  }

  const start = parseToken(sdt, time);
  const end = parseToken(edt, time);
  if (!start || !end || start > end) {
    const body = buildFloodErrorBody(
      null,
      'ours',
      `valid sdt/edt required (${time === '1D' ? 'yyyyMMdd' : time === '1H' ? 'yyyyMMddHH' : 'yyyyMMddHHmm'})`
    );
    logFloodError('observations/stats', body);
    return NextResponse.json(body, { status: 400 });
  }

  if (end.getTime() - start.getTime() > maxRangeMs(time)) {
    const body = buildFloodErrorBody(
      null,
      'ours',
      time === '1D' ? 'date range must be within 1 year' : 'date range must be within 1 month'
    );
    logFloodError('observations/stats', body);
    return NextResponse.json(body, { status: 400 });
  }

  const stations: StationReq[] = [];
  for (const s of stationsRaw) {
    if (!s || typeof s !== 'object') continue;
    const code = String((s as Record<string, unknown>).code ?? '').trim();
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) continue;
    stations.push({ code });
  }

  if (stations.length === 0) {
    return NextResponse.json({ kind, time, sdt, edt, items: [] satisfies StatPoint[] });
  }

  const results = await mapPool(stations, CONCURRENCY, async ({ code }) => {
    const path =
      kind === 'water'
        ? `waterlevel/list/${time}/${encodeURIComponent(code)}/${sdt}/${edt}.xml`
        : `rainfall/list/${time}/${encodeURIComponent(code)}/${sdt}/${edt}.xml`;
    const res = await fetchHrfco(apiKey, path, 'xml', { quietCodes: [990] });
    if (!res.ok) return { ok: false as const, status: res.status, body: res.body };
    const items =
      kind === 'water'
        ? parseWaterObservations(res.data, code)
        : parseRainObservations(res.data, code);
    return { ok: true as const, rows: mapByBucket(items, time) };
  });

  const fatal = results.find((r) => !r.ok && r.body.errorClass === 'provider');
  if (fatal && !fatal.ok) {
    logFloodError('observations/stats', fatal.body);
    return NextResponse.json(fatal.body, { status: fatal.status ?? 502 });
  }

  const step = stepMs(time);
  const items: StatPoint[] = [];
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
    const sum = values.reduce((acc, cur) => acc + cur, 0);
    items.push({ date: key, value: sum / values.length, count: values.length });
  }

  return NextResponse.json({ kind, time, sdt, edt, items });
}
