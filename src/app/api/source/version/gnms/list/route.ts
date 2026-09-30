import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** 브라우저가 GNMS /list 를 직접 호출합니다. 이 엔드포인트는 더 이상 사용하지 않습니다. */
export async function GET() {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        'GNMS 버전 목록은 브라우저에서 직접 조회합니다. /api/source/version/gnms-config 의 listUrl을 사용하세요.',
    },
    { status: 410 }
  );
}
