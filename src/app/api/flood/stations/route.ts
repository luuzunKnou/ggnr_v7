import { NextRequest, NextResponse } from 'next/server';
import {
  buildFloodErrorBody,
  logFloodError,
} from '../_lib/hrfcoErrors';
import {
  fetchHrfco,
  getFloodApiKey,
  inBbox,
  parseRainStations,
  parseWaterStations,
} from '../_lib/hrfcoClient';
import { fetchPublicLayerSggNames, stationIncludesSggNm } from '../_lib/sggFilter';

/**
 * 한강홍수통제소 수위·강수 관측소 목록 (FLOOD_API_KEY 서버 전용)
 * Query: minX,maxX,minY,maxY (WGS84)
 * 필터: bbox 안 AND (명칭·주소에 public_layer.sgg.sgg_nm 포함)
 */
export async function GET(req: NextRequest) {
  const apiKey = getFloodApiKey();
  if (!apiKey) {
    console.warn('[flood] FLOOD_API_KEY is not configured');
    const body = buildFloodErrorBody(null, 'ours', 'FLOOD_API_KEY is not configured');
    logFloodError('stations', body);
    return NextResponse.json(body, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const minX = Number(sp.get('minX'));
  const maxX = Number(sp.get('maxX'));
  const minY = Number(sp.get('minY'));
  const maxY = Number(sp.get('maxY'));
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
    const body = buildFloodErrorBody(null, 'ours', 'minX,maxX,minY,maxY(WGS84) required');
    logFloodError('stations', body);
    return NextResponse.json(body, { status: 400 });
  }

  const [waterRes, rainRes, sggNames] = await Promise.all([
    fetchHrfco(apiKey, 'waterlevel/info.xml', 'xml'),
    fetchHrfco(apiKey, 'rainfall/info.xml', 'xml'),
    fetchPublicLayerSggNames(),
  ]);

  if (!waterRes.ok && !rainRes.ok) {
    const prefer =
      waterRes.body.errorClass === 'provider' || rainRes.body.errorClass === 'provider'
        ? waterRes.body.errorClass === 'provider'
          ? waterRes
          : rainRes
        : waterRes;
    return NextResponse.json(prefer.body, { status: prefer.status });
  }

  const water = waterRes.ok ? parseWaterStations(waterRes.data) : [];
  const rain = rainRes.ok ? parseRainStations(rainRes.data) : [];

  if (!waterRes.ok) {
    console.warn(`[flood] waterlevel/info failed, continuing with rainfall only: ${waterRes.body.error}`);
  }
  if (!rainRes.ok) {
    console.warn(`[flood] rainfall/info failed, continuing with waterlevel only: ${rainRes.body.error}`);
  }
  if (sggNames.length === 0) {
    console.warn('[flood] sgg_nm 없음 — bbox만 적용');
  }

  const items = [...water, ...rain].filter(
    (s) =>
      inBbox(s.lon, s.lat, minX, maxX, minY, maxY) && stationIncludesSggNm(s, sggNames)
  );

  return NextResponse.json({
    items,
    sggNames,
    warnings: [
      !waterRes.ok ? waterRes.body : null,
      !rainRes.ok ? rainRes.body : null,
    ].filter(Boolean),
  });
}
