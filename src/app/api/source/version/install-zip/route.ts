import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  classifySourcePath,
  shouldSkipSourceDir,
  shouldUploadSourcePath,
  type SourceUploadMode,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export const dynamic = 'force-dynamic';

type IncludedFile = {
  absPath: string;
  relPath: string;
  category: 'core' | 'runtime' | 'data';
};

function toPosixRelative(absPath: string, root: string): string {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function buildInstallZip(params: {
  files: IncludedFile[];
  zipPath: string;
  bundleRoot: string;
  mode: SourceUploadMode;
  date: string;
  workspaceRoot: string;
}): Promise<void> {
  const { files, zipPath, bundleRoot, mode, date, workspaceRoot } = params;
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    for (const f of files) {
      archive.file(f.absPath, { name: `${bundleRoot}/${f.relPath}` });
    }
    const metaText = [
      `date=${date}`,
      `mode=${mode}`,
      `workspaceRoot=${workspaceRoot}`,
      `includedFileCount=${files.length}`,
      `generatedAt=${new Date().toISOString()}`,
      '',
    ].join('\n');
    archive.append(metaText, { name: `${bundleRoot}/_upload_meta.txt` });
    archive.finalize().catch(reject);
  });
}

export async function GET() {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mode: SourceUploadMode = 'install';
    const date = todayYmd();
    const workspaceRoot = process.cwd();
    const included: IncludedFile[] = [];

    async function walk(absDir: string): Promise<void> {
      const relDir = toPosixRelative(absDir, workspaceRoot);
      if (relDir && shouldSkipSourceDir(relDir, mode)) return;
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        const childAbs = path.join(absDir, entry.name);
        const childRel = toPosixRelative(childAbs, workspaceRoot);
        if (!childRel || childRel.startsWith('..')) continue;
        if (entry.isDirectory()) {
          if (!shouldSkipSourceDir(childRel, mode)) await walk(childAbs);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!shouldUploadSourcePath(childRel, mode)) continue;
        included.push({
          absPath: childAbs,
          relPath: childRel,
          category: classifySourcePath(childRel),
        });
      }
    }

    await walk(workspaceRoot);
    if (included.length === 0) {
      return NextResponse.json({ error: '설치 ZIP 대상 파일이 없습니다.' }, { status: 400 });
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const bundleRoot = `${date}_${stamp}`;
    const zipName = `source_install_${date}_${stamp}.zip`;
    const tmpDir = path.join(os.tmpdir(), 'ggnr_source_install_download', stamp);
    const zipPath = path.join(tmpDir, zipName);
    await buildInstallZip({ files: included, zipPath, bundleRoot, mode, date, workspaceRoot });

    const nodeStream = fsSync.createReadStream(zipPath);
    const cleanup = () => {
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    };
    nodeStream.on('close', cleanup);
    nodeStream.on('error', cleanup);

    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'install zip build failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

