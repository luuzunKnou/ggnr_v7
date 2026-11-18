import { NextRequest, NextResponse } from 'next/server';
import { convertDwgBufferToDxf } from '@/lib/dwgToDxf';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { saveUploadedDxf } from '@/service/drawingDisplayService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 150 * 1024 * 1024;

/**
 * POST /api/drawingDisplay/upload — multipart `file`(DXF·DWG) → 서버 저장 후 목록 항목 반환
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

  const name = entry.name?.trim() || 'drawing.dxf';
  const lower = name.toLowerCase();
  if (!lower.endsWith('.dxf') && !lower.endsWith('.dwg')) {
    return NextResponse.json({ error: 'DXF 또는 DWG 파일만 올릴 수 있습니다.' }, { status: 400 });
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
    let dxfText: string;

    if (lower.endsWith('.dwg')) {
      const result = await convertDwgBufferToDxf(buf, name);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 422 });
      }
      dxfText = result.dxfText;
    } else {
      dxfText = decodeDxfBytes(ab);
    }

    const item = await saveUploadedDxf({ fileName: name, dxfText });
    return NextResponse.json({ ok: true, item, dxfText });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[drawingDisplay/upload]', msg);
    const status = /로그인|세션|인증/.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
