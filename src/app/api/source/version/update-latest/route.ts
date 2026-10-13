import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 서버→GNMS 직접 적용 폐기. 브라우저 relay 중계를 사용하세요. */
export async function POST() {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        'update-latest는 서버→GNMS 경로로 폐기되었습니다. 최신 소스 적용 UI(브라우저→GNMS→relay)를 사용하세요.',
    },
    { status: 410 }
  );
}
