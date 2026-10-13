import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** 브라우저가 GNMS install ZIP을 직접 받습니다. */
export async function GET() {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        '설치 ZIP은 브라우저가 GNMS install latest/download를 직접 호출합니다.',
    },
    { status: 410 }
  );
}
