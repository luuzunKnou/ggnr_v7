import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** 브라우저가 GNMS cancelUrl 을 직접 호출합니다. */
export async function POST() {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        'GNMS 취소는 브라우저에서 cancelUrl로 직접 통지합니다. /api/source/version/gnms-config 를 확인하세요.',
    },
    { status: 410 }
  );
}
