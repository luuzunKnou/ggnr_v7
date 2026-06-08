import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { ensureOrthophotoCrsPreviewImage } from '@/service/orthophotoService';

export const dynamic = 'force-dynamic';

/** gdalwarp + gdal_translate 미리보기 생성 허용 시간 */
export const maxDuration = 180;

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

  const buf = await fs.readFile(r.imagePath);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': r.contentType,
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
