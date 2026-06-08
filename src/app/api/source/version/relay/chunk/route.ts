import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { uploadVersionRelayChunk } from '@/service/sourceVersionRelayService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('uploadId');
    const chunkIndexStr = searchParams.get('chunkIndex');
    const totalChunksStr = searchParams.get('totalChunks');
    if (!uploadId || chunkIndexStr == null || totalChunksStr == null) {
      return NextResponse.json(
        { error: 'uploadId, chunkIndex, totalChunks required' },
        { status: 400 }
      );
    }
    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);
    if (Number.isNaN(chunkIndex) || Number.isNaN(totalChunks) || chunkIndex < 0 || totalChunks < 1) {
      return NextResponse.json({ error: 'Invalid chunkIndex or totalChunks' }, { status: 400 });
    }

    const buffer = await request.arrayBuffer();
    await uploadVersionRelayChunk({
      uploadId,
      chunkIndex,
      totalChunks,
      chunkData: Buffer.from(buffer),
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'relay chunk failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
