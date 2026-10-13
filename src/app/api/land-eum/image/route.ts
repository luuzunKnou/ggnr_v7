import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fetchEumLandImage } from '@/lib/eumLandProxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await getSessionUsrId())) {
    return new NextResponse(null, { status: 401 });
  }
  const imageKey = String(req.nextUrl.searchParams.get('key') ?? '').trim();
  if (!/^\d+-\d+$/.test(imageKey) || imageKey.length > 80) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const image = await fetchEumLandImage(imageKey);
    return new NextResponse(image.body, {
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
