import { NextRequest, NextResponse } from 'next/server';
import {
  buildFloodErrorBody,
  logFloodError,
} from '../_lib/hrfcoErrors';
import {
  fetchHrfco,
  getFloodApiKey,
  parseRainObservations,
  parseWaterObservations,
  pickLatestObservation,
} from '../_lib/hrfcoClient';

const ALLOWED_TIME = new Set(['10M', '1H', '1D']);

/**
 * 한강홍수통제소 관측소별 수위/강수
 * Query: kind=water|rain, code=Wlobscd|Rfobscd, time=10M|1H|1D (기본 10M)
 * upstream: waterlevel/list/{time}/{code}.json | rainfall/list/{time}/{code}.json
 */
export async function GET(req: NextRequest) {
  const apiKey = getFloodApiKey();
  if (!apiKey) {
    console.warn('[flood] FLOOD_API_KEY is not configured');
    const body = buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured');
    logFloodError('observations', body);
    return NextResponse.json(body, { status: 503 });
  }

  const kind = (req.nextUrl.searchParams.get('kind') ?? '').trim().toLowerCase();
  const code = (req.nextUrl.searchParams.get('code') ?? '').trim();
  const timeRaw = (req.nextUrl.searchParams.get('time') ?? '10M').trim().toUpperCase();
  const time = ALLOWED_TIME.has(timeRaw) ? timeRaw : '10M';

  if (kind !== 'water' && kind !== 'rain') {
    const body = buildFloodErrorBody(null, 'ours', 'kind=water|rain required');
    logFloodError('observations', body);
    return NextResponse.json(body, { status: 400 });
  }
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
    const body = buildFloodErrorBody(null, 'ours', 'code(Wlobscd|Rfobscd) required');
    logFloodError('observations', body);
    return NextResponse.json(body, { status: 400 });
  }

  const path =
    kind === 'water'
      ? `waterlevel/list/${time}/${encodeURIComponent(code)}.json`
      : `rainfall/list/${time}/${encodeURIComponent(code)}.json`;

  const res = await fetchHrfco(apiKey, path, 'json');
  if (!res.ok) {
    return NextResponse.json(res.body, { status: res.status });
  }

  const items =
    kind === 'water'
      ? parseWaterObservations(res.data, code)
      : parseRainObservations(res.data, code);
  const latest = pickLatestObservation(items);

  return NextResponse.json({
    kind,
    code,
    time,
    item: latest,
    items,
  });
}
