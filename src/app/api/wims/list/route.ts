import { NextRequest, NextResponse } from 'next/server';
import { selectHistoryPage } from '@/service/wimsService';
import { readListQuery, requireUser, requireWimsConfigured, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const notConfigured = requireWimsConfigured();
  if (notConfigured) return notConfigured;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const page = await selectHistoryPage(readListQuery(body));
    return NextResponse.json({ dataList: page.rows, totalCount: page.totalCount });
  } catch (err) {
    return wimsError(err);
  }
}
