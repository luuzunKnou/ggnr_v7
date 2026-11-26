import { NextRequest, NextResponse } from 'next/server';
import { submitLayerShpRequest } from '@/service/dataRequestService';

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '';
    const result = await submitLayerShpRequest({
      ...body,
      userIp,
    });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error === 'Unauthorized' ? 401 : 400 }
      );
    }
    return NextResponse.json({
      success: true,
      fileGroupKey: result.fileGroupKey,
      auth: result.auth,
      immediateDownload: result.immediateDownload,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[data-request/submit-layer-shp]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
