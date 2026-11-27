import { NextRequest, NextResponse } from 'next/server';
import { submitWtlNetworkShpRequest } from '@/service/dataRequestService';

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '';
    const result = await submitWtlNetworkShpRequest({
      ...body,
      userIp,
    });
    if (!result.success) {
      const code = 'code' in result ? result.code : undefined;
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          ...(code ? { code } : {}),
        },
        { status: result.error === 'Unauthorized' ? 401 : 400 }
      );
    }
    return NextResponse.json({
      success: true,
      fileGroupKey: result.fileGroupKey,
      warning: result.warning ?? null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[data-request/submit-wtl-network-shp]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
