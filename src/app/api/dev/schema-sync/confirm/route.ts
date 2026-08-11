import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { confirmPendingSchemaApply } from '@/service/sourceVersionService';

export const dynamic = 'force-dynamic';

/** 스키마 안내 모달 [진행] — 재기동 예약·스냅샷 삭제 */
export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { pendingId?: string };
    const pendingId = typeof body.pendingId === 'string' ? body.pendingId.trim() : '';
    if (!pendingId) {
      return NextResponse.json({ ok: false, error: 'pendingId가 필요합니다.' }, { status: 400 });
    }

    const result = await confirmPendingSchemaApply({
      pendingId,
      requestedBy: String(usrId),
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'schema confirm failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
