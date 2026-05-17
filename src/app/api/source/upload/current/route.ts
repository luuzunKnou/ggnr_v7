import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { getSessionUsrId } from '@/lib/auth/guard';
import {
  classifySourcePath,
  shouldSkipSourceDir,
  shouldUploadSourcePath,
  type SourceUploadMode,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export const dynamic = 'force-dynamic';

const SOURCE_UPLOAD_REMOTE_BASE =
  process.env.SOURCE_UPLOAD_REMOTE_BASE ?? 'http://192.168.126.1:3000/api/source/upload';
const SOURCE_UPLOAD_REMOTE_BEARER = process.env.SOURCE_UPLOAD_REMOTE_BEARER ?? '';

type ItemStatus = 'ok' | 'skipped' | 'fail';
type UploadItem = {
  file: string;
  category: 'core' | 'runtime' | 'data';
  status: ItemStatus;
  error?: string;
};

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

async function buildZipBundle(params: {
  files: IncludedFile[];
  zipPath: string;
  bundleRoot: string;
  mode: SourceUploadMode;
  date: string;
  changeNote: string;
  workspaceRoot: string;
}): Promise<void> {
  const { files, zipPath, bundleRoot, mode, date, changeNote, workspaceRoot } = params;
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
      `changeNote=${changeNote}`,
      `workspaceRoot=${workspaceRoot}`,
      `includedFileCount=${files.length}`,
      `generatedAt=${new Date().toISOString()}`,
      '',
    ].join('\n');
    archive.append(metaText, { name: `${bundleRoot}/_upload_meta.txt` });
    archive.finalize().catch(reject);
  });
}

async function uploadZipByChunks(params: {
  zipPath: string;
  zipName: string;
  totalSize: number;
  mode: SourceUploadMode;
  date: string;
  changeNote: string;
  bundleRoot: string;
}): Promise<Record<string, unknown>> {
  const { zipPath, zipName, totalSize, mode, date, changeNote, bundleRoot } = params;
  const base = SOURCE_UPLOAD_REMOTE_BASE.replace(/\/+$/, '');
  const initUrl = `${base}/init`;
  const chunkUrl = `${base}/chunk`;
  const completeUrl = `${base}/complete`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SOURCE_UPLOAD_REMOTE_BEARER) {
    headers.Authorization = `Bearer ${SOURCE_UPLOAD_REMOTE_BEARER}`;
  }

  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName: zipName,
      totalSize,
      mode,
      date,
      changeNote,
      bundleRoot,
      bundleType: 'sourceZip',
    }),
    cache: 'no-store',
  });
  const initJson = (await initRes.json().catch(() => ({}))) as {
    uploadId?: string;
    chunkSize?: number;
    expectedChunks?: number;
    error?: string;
  };
  if (!initRes.ok) {
    throw new Error(initJson?.error ?? `remote init failed (${initRes.status})`);
  }
  const uploadId = String(initJson.uploadId ?? '').trim();
  const chunkSize = Number(initJson.chunkSize ?? 512 * 1024);
  const expectedChunks = Number(initJson.expectedChunks ?? Math.ceil(totalSize / chunkSize));
  if (!uploadId || !Number.isFinite(chunkSize) || chunkSize <= 0 || !Number.isFinite(expectedChunks) || expectedChunks <= 0) {
    throw new Error('remote init response invalid');
  }

  const fh = await fs.open(zipPath, 'r');
  try {
    let position = 0;
    for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
      const remain = totalSize - position;
      const want = Math.min(chunkSize, Math.max(remain, 0));
      if (want <= 0) break;
      const buf = Buffer.allocUnsafe(want);
      const read = await fh.read(buf, 0, want, position);
      if (read.bytesRead <= 0) break;
      position += read.bytesRead;
      const url = `${chunkUrl}?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
      const chunkRes = await fetch(url, {
        method: 'POST',
        body: buf.subarray(0, read.bytesRead),
        headers: SOURCE_UPLOAD_REMOTE_BEARER ? { Authorization: `Bearer ${SOURCE_UPLOAD_REMOTE_BEARER}` } : undefined,
        cache: 'no-store',
      });
      if (!chunkRes.ok) {
        const chunkTxt = await chunkRes.text().catch(() => '');
        throw new Error(chunkTxt || `remote chunk failed (${chunkRes.status})`);
      }
    }
  } finally {
    await fh.close();
  }

  const completeRes = await fetch(completeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uploadId,
      // 원격 서버에서 합치기 완료 후 압축 해제까지 처리 가능하도록 힌트 전달
      extract: true,
      extractFolder: bundleRoot,
      preserveBundleZip: true,
    }),
    cache: 'no-store',
  });
  const completeJson = (await completeRes.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
  };
  if (!completeRes.ok) {
    throw new Error(completeJson?.error ?? `remote complete failed (${completeRes.status})`);
  }
  return { uploadId, chunkSize, expectedChunks, complete: completeJson };
}

export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const modeRaw = typeof body.mode === 'string' ? body.mode.trim() : 'update';
    const mode: SourceUploadMode = modeRaw === 'install' ? 'install' : 'update';
    const dateRaw = typeof body.date === 'string' ? body.date.trim() : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayYmd();
    const changeNote = typeof body.changeNote === 'string' ? body.changeNote.trim() : '';

    const workspaceRoot = process.cwd();
    const items: UploadItem[] = [];
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
          if (!shouldSkipSourceDir(childRel, mode)) {
            await walk(childAbs);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const category = classifySourcePath(childRel);
        if (!shouldUploadSourcePath(childRel, mode)) {
          items.push({ file: childRel, category, status: 'skipped' });
          continue;
        }
        included.push({ absPath: childAbs, relPath: childRel, category });
      }
    }

    await walk(workspaceRoot);

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const bundleRoot = `${date}_${stamp}`;
    const zipName = `source_${mode}_${date}_${stamp}.zip`;
    const tmpDir = path.join(os.tmpdir(), 'ggnr_source_upload');
    const zipPath = path.join(tmpDir, zipName);
    let zipSize = 0;
    let remoteResult: Record<string, unknown> | null = null;

    if (included.length > 0) {
      await buildZipBundle({
        files: included,
        zipPath,
        bundleRoot,
        mode,
        date,
        changeNote,
        workspaceRoot,
      });
      zipSize = (await fs.stat(zipPath)).size;
      remoteResult = await uploadZipByChunks({
        zipPath,
        zipName,
        totalSize: zipSize,
        mode,
        date,
        changeNote,
        bundleRoot,
      });
      for (const f of included) {
        items.push({ file: f.relPath, category: f.category, status: 'ok' });
      }
      await fs.rm(zipPath, { force: true }).catch(() => {});
    }

    return NextResponse.json({
      remoteBase: SOURCE_UPLOAD_REMOTE_BASE,
      workspaceRoot,
      zipName,
      zipSize,
      bundleRoot,
      total: items.length,
      ok: items.filter((x) => x.status === 'ok').length,
      skipped: items.filter((x) => x.status === 'skipped').length,
      fail: items.filter((x) => x.status === 'fail').length,
      remoteResult,
      items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

