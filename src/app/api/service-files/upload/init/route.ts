import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { assertSafeFileDataSegment } from '@/lib/serviceFileData';
import { parseSerEngForServiceFileData } from '@/lib/serviceFileDataPolicy';
import { initServiceFileDataUpload } from '@/service/uploadService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    }
    const o = body as Record<string, unknown>;
    const serEng = parseSerEngForServiceFileData(typeof o.serEng === 'string' ? o.serEng : null);
    if (serEng == null) {
      return NextResponse.json({ error: '유효하지 않은 serEng 입니다.' }, { status: 400 });
    }
    const layer = typeof o.layer === 'string' ? o.layer : null;
    const key = typeof o.key === 'string' ? o.key : o.key != null ? String(o.key) : null;
    const fileName = typeof o.fileName === 'string' ? o.fileName : null;
    const totalSize = typeof o.totalSize === 'number' && Number.isFinite(o.totalSize) ? o.totalSize : null;
    const subfolderRaw = typeof o.subfolder === 'string' ? o.subfolder.trim() : '';
    const subfolder =
      subfolderRaw && subfolderRaw !== '기타' ? subfolderRaw : undefined;
    if (layer == null || key == null || fileName == null || totalSize == null || totalSize < 0) {
      return NextResponse.json({ error: 'layer, key, fileName, totalSize 가 필요합니다.' }, { status: 400 });
    }
    if (assertSafeFileDataSegment(layer) == null || assertSafeFileDataSegment(key) == null) {
      return NextResponse.json({ error: '유효하지 않은 layer 또는 key 입니다.' }, { status: 400 });
    }
    if (subfolder != null && assertSafeFileDataSegment(subfolder) == null) {
      return NextResponse.json({ error: '유효하지 않은 subfolder 입니다.' }, { status: 400 });
    }
    const result = await initServiceFileDataUpload({
      serEng,
      layerName: layer,
      keyValue: key,
      fileName,
      totalSize,
      ownerUsrId: usrId,
      subfolder,
    });
    return NextResponse.json({
      uploadId: result.uploadId,
      chunkSize: result.chunkSize,
      expectedChunks: result.expectedChunks,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Init failed';
    const status = message === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
