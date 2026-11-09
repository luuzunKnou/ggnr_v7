import { NextRequest, NextResponse } from 'next/server';
import { loadParcelWims } from '@/service/wimsService';
import { requireUser, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  console.log('[wims/parcel] start');
  const denied = await requireUser();
  if (denied) {
    console.log('[wims/parcel] unauthorized');
    return denied;
  }
  try {
    const body = (await req.json()) as { pnu?: unknown };
    const pnu = String(body.pnu ?? '').trim();
    console.log('[wims/parcel] body', { pnu, digit19: /^\d{19}$/.test(pnu) });
    if (!/^\d{19}$/.test(pnu)) {
      return NextResponse.json({ error: '필지 번호가 올바르지 않습니다.' }, { status: 400 });
    }
    const result = await loadParcelWims(pnu);
    console.log('[wims/parcel] ok', {
      pnu,
      meters: result.meters.length,
      stat: result.statList.length,
      list: result.dataList.length,
      total: result.totalCount,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[wims/parcel] error', err);
    return wimsError(err);
  }
}
