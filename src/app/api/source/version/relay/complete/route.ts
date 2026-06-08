import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { completeVersionRelay } from '@/service/sourceVersionRelayService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const uploadId = String(body.uploadId ?? '').trim();
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    const result = await completeVersionRelay({ uploadId });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'relay complete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
