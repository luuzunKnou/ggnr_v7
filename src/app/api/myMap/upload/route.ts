import { NextRequest, NextResponse } from 'next/server';
import { createFromShpUpload } from '@/service/myMapService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = new Set(['shp', 'shx', 'dbf', 'prj', 'cpg']);

/**
 * POST /api/myMap/upload — SHP 구성 파일 multipart → 나의지도 레이어 생성
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽을 수 없습니다.' }, { status: 400 });
  }

  const layerKey = String(form.get('layerKey') ?? '').trim();
  const layerName = String(form.get('layerName') ?? '').trim();
  const layerGroup = String(form.get('layerGroup') ?? '').trim();
  const sourceSrsOverride = String(form.get('sourceSrsOverride') ?? '').trim();
  const keyField = String(form.get('keyField') ?? '').trim();
  const columnsJson = String(form.get('columnsJson') ?? '');
  const styleJson = String(form.get('styleJson') ?? '');

  if (!layerKey || !layerName) {
    return NextResponse.json({ error: '영문명·한글명이 필요합니다.' }, { status: 400 });
  }

  const files: Array<{ fileName: string; bytes: Buffer }> = [];
  let total = 0;
  for (const [key, value] of form.entries()) {
    if (!(value instanceof File)) continue;
    if (key !== 'file' && !key.startsWith('file')) continue;
    const name = value.name?.trim() || 'upload.bin';
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED.has(ext)) continue;
    total += value.size;
    if (total > MAX_BYTES) {
      return NextResponse.json({ error: '파일 총 용량이 너무 큽니다.' }, { status: 413 });
    }
    const ab = await value.arrayBuffer();
    files.push({ fileName: name, bytes: Buffer.from(ab) });
  }

  const hasShp = files.some((f) => f.fileName.toLowerCase().endsWith('.shp'));
  const hasShx = files.some((f) => f.fileName.toLowerCase().endsWith('.shx'));
  const hasDbf = files.some((f) => f.fileName.toLowerCase().endsWith('.dbf'));
  if (!hasShp || !hasShx || !hasDbf) {
    return NextResponse.json({ error: 'shp·shx·dbf 파일이 모두 필요합니다.' }, { status: 400 });
  }

  try {
    const result = await createFromShpUpload({
      layerKey,
      layerName,
      layerGroup: layerGroup || undefined,
      sourceSrsOverride: sourceSrsOverride || undefined,
      keyField: keyField || undefined,
      columnsJson: columnsJson || undefined,
      styleJson: styleJson || undefined,
      files,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      typeof e === 'object' && e && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : /로그인|세션|인증/.test(msg)
          ? 401
          : /이미 존재/.test(msg)
            ? 409
            : 500;
    console.error('[myMap/upload]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
