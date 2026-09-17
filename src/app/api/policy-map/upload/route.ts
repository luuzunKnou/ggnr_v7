import { NextRequest, NextResponse } from 'next/server';
import { createFromFiles, createFromZip } from '@/service/policyMapService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isFile(v: FormDataEntryValue | null): v is File {
  return typeof File !== 'undefined' && v instanceof File && v.size >= 0 && Boolean(v.name);
}

/** 정책지도 업로드 — zip / 단일 HTML / 다중·폴더 파일 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const title = String(form.get('title') ?? '').trim();

    const collected: File[] = [];
    for (const v of form.getAll('files')) {
      if (isFile(v)) collected.push(v);
    }
    const single = form.get('file');
    if (isFile(single)) collected.push(single);

    if (!collected.length) {
      return NextResponse.json(
        { success: false, error: '올릴 파일(zip·HTML·폴더)이 필요합니다.' },
        { status: 400 }
      );
    }

    // zip 하나면 압축 해제 경로
    if (
      collected.length === 1 &&
      String(collected[0]!.name ?? '')
        .toLowerCase()
        .endsWith('.zip')
    ) {
      const buf = new Uint8Array(await collected[0]!.arrayBuffer());
      const row = await createFromZip({ title, zipBytes: buf });
      return NextResponse.json({ success: true, data: row });
    }

    // zip이 여러 개에 섞이면 거절
    if (collected.some((f) => String(f.name).toLowerCase().endsWith('.zip'))) {
      return NextResponse.json(
        { success: false, error: 'zip은 한 개만 올리거나, HTML·리소스만 선택해 주세요.' },
        { status: 400 }
      );
    }

    const files: Array<{ relativePath: string; bytes: Uint8Array }> = [];
    for (const f of collected) {
      const rel =
        (typeof (f as File & { webkitRelativePath?: string }).webkitRelativePath === 'string' &&
          (f as File & { webkitRelativePath?: string }).webkitRelativePath?.trim()) ||
        f.name;
      files.push({
        relativePath: rel,
        bytes: new Uint8Array(await f.arrayBuffer()),
      });
    }

    const row = await createFromFiles({ title, files });
    return NextResponse.json({ success: true, data: row });
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
