import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import {
  listVersionHistory,
  recordVersionHistory,
  type VersionHistoryFilter,
  type VersionHistoryType,
} from '@/service/mngVersionHistoryService';

export const dynamic = 'force-dynamic';

function parseFilter(raw: string): VersionHistoryFilter {
  const v = raw.trim();
  if (v === 'source_upload') return 'source_upload_only';
  if (v === 'install_zip' || v === 'apply_latest') return v as VersionHistoryType;
  if (v === 'all' || v === 'version_all') return 'version_all';
  return 'version_all';
}

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sp = req.nextUrl.searchParams;
    const filter = parseFilter(sp.get('filter') ?? 'version_all');
    const dateYmd = sp.get('date')?.trim() ?? '';
    const limitRaw = Number(sp.get('limit'));
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const result = await listVersionHistory({
      filter,
      dateYmd: dateYmd || undefined,
      limit,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? '조회 실패' }, { status: 500 });
    }
    return NextResponse.json({ items: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'history query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const historyType = String(body.historyType ?? '').trim() as VersionHistoryType;
    const status = body.status === 'success' ? 'success' : 'fail';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    const ip = pickClientIpFromRequest(req, bodyIp);

    if (historyType !== 'source_upload' && historyType !== 'install_zip' && historyType !== 'apply_latest') {
      return NextResponse.json({ error: 'invalid historyType' }, { status: 400 });
    }

    const result = await recordVersionHistory({
      historyType,
      status,
      message: message || undefined,
      ip,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '기록 실패' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, mvhKey: result.mvhKey });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'history record failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
