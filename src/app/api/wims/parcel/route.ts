import { NextRequest, NextResponse } from 'next/server';
import { loadParcelWims } from '@/service/wimsService';
import { requireUser, requireWimsConfigured, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const notConfigured = requireWimsConfigured();
  if (notConfigured) return notConfigured;
  try {
    const body = (await req.json()) as { pnu?: unknown };
    const pnu = String(body.pnu ?? '').trim();
    if (!/^\d{19}$/.test(pnu)) {
      return NextResponse.json({ error: '필지 번호가 올바르지 않습니다.' }, { status: 400 });
    }
    const result = await loadParcelWims(pnu);
    return NextResponse.json(result);
  } catch (err) {
    return wimsError(err);
  }
}
