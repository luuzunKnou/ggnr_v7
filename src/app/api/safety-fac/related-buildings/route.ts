import { NextRequest, NextResponse } from 'next/server';
import { getSafetyFacRelatedBuildingLayers } from '@/service/standardService';

export async function GET(req: NextRequest) {
  const lon = parseFloat(req.nextUrl.searchParams.get('lon') ?? '');
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '');
  // 건물·도로 기본 스키마: public_layer
  const schema = req.nextUrl.searchParams.get('schema') ?? 'public_layer';

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: 'lon, lat required' }, { status: 400 });
  }

  try {
    const data = await getSafetyFacRelatedBuildingLayers({ lon, lat, schema });
    return NextResponse.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
