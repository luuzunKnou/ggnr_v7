import { NextRequest, NextResponse } from 'next/server';
import { convertDwgBufferToDxf } from '@/lib/dwgToDxf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 150 * 1024 * 1024;

/**
 * POST /api/drawingDisplay/dwg-to-dxf — multipart `file`(DWG) → DXF 텍스트
 * 임시 표시용. 서버에 원본을 남기지 않는다.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽을 수 없습니다.' }, { status: 400 });
  }

  const entry = form.get('file');
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: 'file 필드가 필요합니다.' }, { status: 400 });
  }

  const name = entry.name?.trim() || 'input.dwg';
  if (!name.toLowerCase().endsWith('.dwg')) {
    return NextResponse.json({ error: 'DWG 파일만 변환할 수 있습니다.' }, { status: 400 });
  }

  if (entry.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `파일 크기는 ${MAX_BYTES / 1024 / 1024}MB 이하여야 합니다.` },
      { status: 413 }
    );
  }

  try {
    const ab = await entry.arrayBuffer();
    const buf = Buffer.from(ab);
    const result = await convertDwgBufferToDxf(buf, name);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 422 });
    }
    return NextResponse.json({ dxfText: result.dxfText });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[drawingDisplay/dwg-to-dxf]', msg);
    return NextResponse.json({ error: `변환 중 오류: ${msg}` }, { status: 500 });
  }
}
