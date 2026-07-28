import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  initSourceBundleUpload,
  readSourceBundleMeta,
} from '@/service/sourceUploadBundleService';
import { initChunkedUpload } from '@/service/uploadService';
import {
  shouldUploadSourcePath,
  type SourceUploadMode,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

function normalizeRelativePath(input: string): string | null {
  const p = String(input ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p) return null;
  const norm = path.posix.normalize(p);
  if (!norm || norm === '.' || norm.startsWith('../') || norm.includes('/../')) return null;
  return norm;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  try {
    const usrId = await getSessionUsrId();
    if (!usrId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const bundleType = String(body.bundleType ?? '').trim();

    if (bundleType === 'sourceZip') {
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const totalSize =
        typeof body.totalSize === 'number' && Number.isFinite(body.totalSize) ? body.totalSize : -1;
      const mode = String(body.mode ?? 'install').trim();
      const dateRaw = typeof body.date === 'string' ? body.date.trim() : '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayYmd();
      const changeNote = typeof body.changeNote === 'string' ? body.changeNote.trim() : '';
      const bundleRoot = typeof body.bundleRoot === 'string' ? body.bundleRoot.trim() : date;
      const includeNodeModules = body.includeNodeModules === true;

      if (!fileName || totalSize < 0) {
        return NextResponse.json({ error: 'fileName, totalSize 가 필요합니다.' }, { status: 400 });
      }

      const result = await initSourceBundleUpload({
        fileName,
        totalSize,
        mode,
        date,
        changeNote,
        bundleRoot,
        includeNodeModules,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const relativePathRaw =
      typeof body.relativePath === 'string' && body.relativePath.trim()
        ? body.relativePath.trim()
        : fileName;
    const totalSize =
      typeof body.totalSize === 'number' && Number.isFinite(body.totalSize) ? body.totalSize : -1;
    const modeRaw = typeof body.mode === 'string' ? body.mode.trim() : 'update';
    const mode: SourceUploadMode = modeRaw === 'install' ? 'install' : 'update';
    const dateRaw = typeof body.date === 'string' ? body.date.trim() : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayYmd();

    if (!fileName || totalSize < 0) {
      return NextResponse.json({ error: 'fileName, totalSize 가 필요합니다.' }, { status: 400 });
    }
    const relativePath = normalizeRelativePath(relativePathRaw);
    if (!relativePath) {
      return NextResponse.json({ error: '유효하지 않은 relativePath 입니다.' }, { status: 400 });
    }
    if (!shouldUploadSourcePath(relativePath, mode, true)) {
      return NextResponse.json({
        skipped: true,
        reason: `mode=${mode} 에서 제외 대상 경로`,
        relativePath,
      });
    }

    const savePath = `source_upload/${mode}/${date}/${relativePath}`.replace(/\\/g, '/');
    const result = await initChunkedUpload({
      uploadType: 'source',
      fileName: savePath,
      totalSize,
    });
    return NextResponse.json({
      skipped: false,
      uploadId: result.uploadId,
      chunkSize: result.chunkSize,
      expectedChunks: result.expectedChunks,
      savePath,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Init failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get('uploadId')?.trim();
  if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
  const meta = await readSourceBundleMeta(uploadId);
  if (!meta) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  return NextResponse.json({ ok: true, meta });
}
