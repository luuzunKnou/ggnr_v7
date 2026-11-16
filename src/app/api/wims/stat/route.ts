import { NextRequest, NextResponse } from 'next/server';
import { selectStat } from '@/service/wimsService';
import { readStatQuery, requireUser, requireWimsConfigured, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const notConfigured = requireWimsConfigured();
  if (notConfigured) return notConfigured;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const dataList = await selectStat(readStatQuery(body));
    return NextResponse.json({ dataList });
  } catch (err) {
    return wimsError(err);
  }
}
