import { NextRequest, NextResponse } from 'next/server';
import { selectHistory, selectHistoryCount } from '@/service/wimsService';
import { readListQuery, requireUser, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const query = readListQuery(body);
    const [dataList, totalCount] = await Promise.all([
      selectHistory(query, 'page'),
      selectHistoryCount(query),
    ]);
    return NextResponse.json({ dataList, totalCount });
  } catch (err) {
    return wimsError(err);
  }
}
