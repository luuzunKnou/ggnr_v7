import { NextRequest, NextResponse } from 'next/server';
import {
  buildFloodErrorBody,
  logFloodError,
} from '../../_lib/hrfcoErrors';
import {
  fetchHrfco,
  getFloodApiKey,
  parseRainObservations,
  parseWaterObservations,
  pickLatestObservation,
} from '../../_lib/hrfcoClient';

const ALLOWED_TIME = new Set(['10M', '1H', '1D']);
const CONCURRENCY = 6;

type StationReq = { kind: 'water' | 'rain'; code: string };

type KindAvg = {
  average: number | null;
  count: number;
  observedAt: string;
};

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
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
 * 다건 관측 조회 후 종류별 산술 평균.
 * Body: { time?: '10M'|'1H'|'1D', stations: { kind, code }[] }
 */
export async function POST(req: NextRequest) {
  const apiKey = getFloodApiKey();
  if (!apiKey) {
    console.warn('[flood] FLOOD_API_KEY is not configured');
    const body = buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured');
    logFloodError('observations/batch', body);
    return NextResponse.json(body, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    const body = buildFloodErrorBody(null, 'ours', 'invalid JSON body');
    logFloodError('observations/batch', body);
    return NextResponse.json(body, { status: 400 });
  }

  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const timeRaw = String(o.time ?? '10M').trim().toUpperCase();
  const time = ALLOWED_TIME.has(timeRaw) ? timeRaw : '10M';

  const stationsRaw = Array.isArray(o.stations) ? o.stations : [];
  const stations: StationReq[] = [];
  for (const s of stationsRaw) {
    if (!s || typeof s !== 'object') continue;
    const row = s as Record<string, unknown>;
    const kind = String(row.kind ?? '').trim().toLowerCase();
    const code = String(row.code ?? '').trim();
    if ((kind !== 'water' && kind !== 'rain') || !code || !/^[A-Za-z0-9_-]+$/.test(code)) {
      continue;
    }
    stations.push({ kind, code });
  }

  if (stations.length === 0) {
    return NextResponse.json({
      time,
      water: { average: null, count: 0, observedAt: '' } satisfies KindAvg,
      rain: { average: null, count: 0, observedAt: '' } satisfies KindAvg,
    });
  }

  type OneResult = {
    kind: 'water' | 'rain';
    value: number | null;
    observedAt: string;
    ok: boolean;
    errorBody?: ReturnType<typeof buildFloodErrorBody>;
    status?: number;
  };

  const results = await mapPool(stations, CONCURRENCY, async (st): Promise<OneResult> => {
    const path =
      st.kind === 'water'
        ? `waterlevel/list/${time}/${encodeURIComponent(st.code)}.json`
        : `rainfall/list/${time}/${encodeURIComponent(st.code)}.json`;
    const res = await fetchHrfco(apiKey, path, 'json', { quietCodes: [990] });
    if (!res.ok) {
      return {
        kind: st.kind,
        value: null,
        observedAt: '',
        ok: false,
        errorBody: res.body,
        status: res.status,
      };
    }
    const items =
      st.kind === 'water'
        ? parseWaterObservations(res.data, st.code)
        : parseRainObservations(res.data, st.code);
    const latest = pickLatestObservation(items);
    return {
      kind: st.kind,
      value: latest?.value ?? null,
      observedAt: latest?.observedAt ?? '',
      ok: true,
    };
  });

  const fatal = results.find((r) => !r.ok && r.errorBody?.errorClass === 'provider');
  if (fatal?.errorBody) {
    logFloodError('observations/batch', fatal.errorBody);
    return NextResponse.json(fatal.errorBody, { status: fatal.status ?? 502 });
  }

  function avgOf(kind: 'water' | 'rain'): KindAvg {
    const vals: number[] = [];
    let latestAt = '';
    for (const r of results) {
      if (r.kind !== kind || !r.ok || r.value == null || !Number.isFinite(r.value)) continue;
      vals.push(r.value);
      if ((r.observedAt || '') > latestAt) latestAt = r.observedAt || '';
    }
    if (vals.length === 0) return { average: null, count: 0, observedAt: '' };
    const sum = vals.reduce((a, b) => a + b, 0);
    return { average: sum / vals.length, count: vals.length, observedAt: latestAt };
  }

  const waterAvg = avgOf('water');
  const rainAvg = avgOf('rain');
  console.info(
    `[flood] batch average time=${time} requested=${stations.length} water=${waterAvg.count}/${stations.filter((s) => s.kind === 'water').length} rain=${rainAvg.count}/${stations.filter((s) => s.kind === 'rain').length}`
  );

  return NextResponse.json({
    time,
    water: waterAvg,
    rain: rainAvg,
    meta: {
      requested: stations.length,
      waterOk: waterAvg.count,
      rainOk: rainAvg.count,
    },
  });
}
