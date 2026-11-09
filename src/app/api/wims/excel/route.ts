import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { buildWimsExcel } from '@/service/wimsExcel';
import { readListQuery, requireUser, requireWimsConfigured, wimsError } from '../_lib';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const notConfigured = requireWimsConfigured();
  if (notConfigured) return notConfigured;
  try {
    const session = await auth();
    const body = (await req.json()) as Record<string, unknown>;
    const bytes = await buildWimsExcel(readListQuery(body), session?.user?.name ?? '');
    const filename = encodeURIComponent('WIMS_검침이력.xlsx');
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="WIMS_meter_history.xlsx"; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return wimsError(err);
  }
}
