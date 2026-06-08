import { NextRequest, NextResponse } from 'next/server';
import { uploadChunk } from '@/service/uploadService';
import { getSessionUsrId } from '@/lib/auth/guard';

/**
 * POST: 청크 바이너리 본문 저장.
 * Query: uploadId, chunkIndex, totalChunks
 */
export async function POST(request: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('uploadId');
    const chunkIndexStr = searchParams.get('chunkIndex');
    const totalChunksStr = searchParams.get('totalChunks');
    if (!uploadId || chunkIndexStr == null || totalChunksStr == null) {
      return NextResponse.json(
        { success: false, error: 'uploadId, chunkIndex, totalChunks required' },
        { status: 400 }
      );
    }
    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);
    if (Number.isNaN(chunkIndex) || Number.isNaN(totalChunks) || chunkIndex < 0 || totalChunks < 1) {
      return NextResponse.json(
        { success: false, error: 'Invalid chunkIndex or totalChunks' },
        { status: 400 }
      );
    }
    const buffer = await request.arrayBuffer();
    await uploadChunk({
      uploadId,
      chunkIndex,
      totalChunks,
      chunkData: Buffer.from(buffer),
      sessionUsrId: usrId,
    });
    return NextResponse.json({ success: true, data: { ok: true } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload chunk failed';
    const status = message === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
