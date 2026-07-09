import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { completeChunkedUpload } from '@/service/uploadService';
import { completeSourceBundleUpload } from '@/service/sourceUploadBundleService';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId 가 필요합니다.' }, { status: 400 });
    }

    const extract = body.extract === true;
    const extractFolder = typeof body.extractFolder === 'string' ? body.extractFolder.trim() : undefined;
    const preserveBundleZip = body.preserveBundleZip === true;

    if (extract || extractFolder || preserveBundleZip) {
      const result = await completeSourceBundleUpload({
        uploadId,
        extract,
        extractFolder,
        preserveBundleZip,
      });
      return NextResponse.json({
        ok: true,
        mergedZipPath: result.mergedZipPath,
        extractedPath: result.extractedPath,
        savedPath: result.savedPath,
        totalSize: result.totalSize,
        appliedFiles: result.appliedFiles,
        npmInstall: result.npmInstall,
        versionMeta: result.versionMeta,
      });
    }

    const result = await completeChunkedUpload({ uploadId });
    return NextResponse.json({ savedPath: result.savedPath, size: result.size, ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Complete failed';
    const status = message === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
