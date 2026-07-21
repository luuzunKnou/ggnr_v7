import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { compareSchemaWithConnectedDb } from '@/service/sourceUploadDbCompareService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await compareSchemaWithConnectedDb();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'db compare failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
