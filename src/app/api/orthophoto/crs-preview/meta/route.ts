import { NextRequest, NextResponse } from 'next/server';
import { ensureOrthophotoCrsPreviewImage } from '@/service/orthophotoService';

export const dynamic = 'force-dynamic';

export const maxDuration = 180;

/** 미리보기 이미지 범위(EPSG:3857) — OpenLayers ImageStatic.imageExtent 용 */
export async function GET(req: NextRequest) {
  const groupName = req.nextUrl.searchParams.get('groupName')?.trim() ?? '';
  const epsgStr = req.nextUrl.searchParams.get('epsg') ?? '';
  const epsg = parseInt(epsgStr, 10);
  if (!groupName || !Number.isFinite(epsg)) {
    return NextResponse.json({ error: 'groupName and epsg are required' }, { status: 400 });
  }

  const r = await ensureOrthophotoCrsPreviewImage({ groupName, epsg });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  return NextResponse.json({
    extent3857: r.extent3857,
    contentType: r.contentType,
  });
}
