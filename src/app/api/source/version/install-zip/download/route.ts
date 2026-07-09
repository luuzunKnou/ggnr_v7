import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { getInstallZipProgress } from '@/service/sourceInstallZipProgress';
import {
  resolveBuiltInstallZipPath,
  scheduleInstallZipCleanup,
} from '@/service/sourceInstallZipService';

export const dynamic = 'force-dynamic';

async function findZipByName(zipName: string): Promise<string | undefined> {
  const root = path.join(os.tmpdir(), 'ggnr_source_install_download');
  const stampDirs = await fs.readdir(root).catch(() => [] as string[]);
  for (const stamp of stampDirs) {
    const candidate = path.join(root, stamp, zipName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const progressId = req.nextUrl.searchParams.get('progressId')?.trim() ?? '';
    const zipNameParam = req.nextUrl.searchParams.get('zipName')?.trim() ?? '';

    let zipPath = progressId ? resolveBuiltInstallZipPath(progressId) : undefined;
    const progress = progressId ? getInstallZipProgress(progressId) : null;
    if (!zipPath && progress?.zipName) {
      zipPath = await findZipByName(progress.zipName);
    }
    if (!zipPath && zipNameParam) {
      zipPath = await findZipByName(zipNameParam);
    }
    if (!zipPath) {
      return NextResponse.json({ error: 'ZIP 파일을 찾을 수 없습니다. build를 먼저 실행하세요.' }, { status: 404 });
    }

    const fileName = path.basename(zipPath);
    const { size } = await fs.stat(zipPath);
    const cleanup = scheduleInstallZipCleanup(zipPath);
    const nodeStream = fsSync.createReadStream(zipPath);
    nodeStream.on('close', cleanup);
    nodeStream.on('error', cleanup);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'download failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
