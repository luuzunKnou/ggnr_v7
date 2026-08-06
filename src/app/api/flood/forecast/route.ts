import { NextRequest, NextResponse } from 'next/server';
import { buildFloodErrorBody, logFloodError } from '../_lib/hrfcoErrors';
import {
  fetchHrfco,
  getFloodApiKey,
  parseFloodForecasts,
  parseForecastAncdt,
} from '../_lib/hrfcoClient';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 홍수예보 발령 (fldfct/list.xml)
 * Query: codes — 쉼표 구분 관측소 코드(STTNM 매칭). 없으면 최근 24시간 전체(필터 없음).
 */
export async function GET(req: NextRequest) {
  const apiKey = getFloodApiKey();
  if (!apiKey) {
    console.warn('[flood] FLOOD_API_KEY is not configured');
    const body = buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured');
    logFloodError('forecast', body);
    return NextResponse.json(body, { status: 503 });
  }

  const codesParam = req.nextUrl.searchParams.get('codes')?.trim() ?? '';
  const codeSet = new Set(
    codesParam
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
  );

  const res = await fetchHrfco(apiKey, 'fldfct/list.xml', 'xml');
  if (!res.ok) {
    return NextResponse.json(res.body, { status: res.status });
  }

  const now = Date.now();
  let items = parseFloodForecasts(res.data).filter((it) => {
    const dt = parseForecastAncdt(it.ancdt);
    if (!dt) return true; // API가 이미 24h — 시각 파싱 실패 시 유지
    return now - dt.getTime() <= DAY_MS;
  });

  if (codeSet.size > 0) {
    items = items.filter((it) => codeSet.has(it.sttnm));
  }

  return NextResponse.json({ items });
}
