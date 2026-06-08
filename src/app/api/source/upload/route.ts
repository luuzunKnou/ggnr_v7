import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await getSessionUsrId())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const mode = String(form.get('mode') ?? 'update').trim();
    const date = String(form.get('date') ?? '').trim();
    const changeNote = String(form.get('changeNote') ?? '').trim();
    const single = form.get('file');
    const many = form.getAll('files');
    const files = [
      ...(single instanceof File ? [single] : []),
      ...many.filter((x): x is File => x instanceof File),
    ];

    // 실제 대용량 처리 경로는 init/chunk/complete 입니다.
    // 이 엔드포인트는 API 안내 및 단건 테스트 호환용입니다.
    return NextResponse.json({
      ok: true,
      message: 'Use /api/source/upload/init + /chunk + /complete for production uploads.',
      mode,
      date,
      changeNote,
      fileCount: files.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

