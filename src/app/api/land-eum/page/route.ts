import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { fetchEumLandHtml } from '@/lib/eumLandProxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const pnu = String(req.nextUrl.searchParams.get('pnu') ?? '').trim();
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ error: '필지 번호가 올바르지 않습니다.' }, { status: 400 });
  }
  const view = req.nextUrl.searchParams.get('view') === 'plan' ? 'plan' : 'land';
  try {
    const html = await fetchEumLandHtml(pnu, view);
    return new NextResponse(Buffer.from(html, 'latin1'), {
      headers: {
        'Content-Type': 'text/html; charset=euc-kr',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '토지이음 화면을 불러오지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
