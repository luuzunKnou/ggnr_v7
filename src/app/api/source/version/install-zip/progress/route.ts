import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getInstallZipProgress } from '@/service/sourceInstallZipProgress';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const progress = getInstallZipProgress(id);
    if (!progress) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(progress);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'progress failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
