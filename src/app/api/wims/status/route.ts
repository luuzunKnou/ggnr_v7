import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isWimsConfigured, parseWimsInfo } from '@/lib/wimsOracle';

export const dynamic = 'force-dynamic';

export async function GET() {
  const usrId = await getSessionUsrId();
  console.log('[wims/status] start', { usrId: usrId ? `${usrId.slice(0, 4)}…` : null });
  if (!usrId) {
    console.log('[wims/status] 401 unauthorized');
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const raw = process.env.WIMS_INFO;
  const parsed = parseWimsInfo(raw);
  const enabled = isWimsConfigured();
  console.log('[wims/status] result', {
    enabled,
    hasRaw: Boolean(raw),
    rawPreview: raw ? `${String(raw).split('/').slice(0, 3).join('/')}/…` : null,
    parts: raw ? String(raw).split('/').length : 0,
    schema: parsed?.schema ?? null,
  });
  return NextResponse.json({
    enabled,
    debug: {
      hasRaw: Boolean(raw),
      parts: raw ? String(raw).split('/').length : 0,
      schema: parsed?.schema ?? null,
      connectType: parsed?.connectType ?? null,
    },
  });
}
