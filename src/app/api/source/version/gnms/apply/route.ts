import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 브라우저 → GNMS 다운로드 + relay 중계로 대체됨. 서버→GNMS ZIP 적용은 사용하지 않습니다. */
export async function POST() {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        'GNMS 적용은 브라우저 다운로드 후 /api/source/version/relay/* 중계를 사용합니다.',
    },
    { status: 410 }
  );
}
