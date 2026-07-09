import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { registerSourceVersion } from '@/service/sourceVersionRegistryService';

export const SOURCE_BUNDLE_CHUNK_SIZE = 2 * 1024 * 1024;

type SourceBundleMeta = {
  uploadType: 'sourceBundle';
  fileName: string;
  totalSize: number;
  expectedChunks: number;
  chunkSize: number;
  mode: string;
  date: string;
  changeNote: string;
  bundleRoot: string;
  includeNodeModules: boolean;
  runNpmInstall: boolean;
};

function tempDir(uploadId: string): string {
  return path.join(os.tmpdir(), 'ggnr_source_bundle', uploadId);
}

export async function initSourceBundleUpload(params: {
  fileName: string;
  totalSize: number;
  mode: string;
  date: string;
  changeNote: string;
  bundleRoot: string;
  includeNodeModules: boolean;
}): Promise<{ uploadId: string; chunkSize: number; expectedChunks: number }> {
  if (!params.fileName.trim()) throw new Error('fileName required');
  if (!Number.isFinite(params.totalSize) || params.totalSize <= 0) {
    throw new Error('totalSize must be positive');
  }
  const expectedChunks = Math.ceil(params.totalSize / SOURCE_BUNDLE_CHUNK_SIZE) || 1;
  const uploadId = nanoid();
  const dir = tempDir(uploadId);
  await fs.mkdir(dir, { recursive: true });
  const meta: SourceBundleMeta = {
    uploadType: 'sourceBundle',
    fileName: path.basename(params.fileName.replace(/\\/g, '/')),
    totalSize: params.totalSize,
    expectedChunks,
    chunkSize: SOURCE_BUNDLE_CHUNK_SIZE,
    mode: params.mode,
    date: params.date,
    changeNote: params.changeNote,
    bundleRoot: params.bundleRoot,
    includeNodeModules: params.includeNodeModules,
    runNpmInstall: !params.includeNodeModules,
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf-8');
  return { uploadId, chunkSize: SOURCE_BUNDLE_CHUNK_SIZE, expectedChunks };
}

export async function saveSourceBundleChunk(params: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: Buffer;
}): Promise<{ ok: boolean }> {
  const dir = tempDir(params.uploadId);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf-8')) as SourceBundleMeta;
  if (params.totalChunks !== meta.expectedChunks) throw new Error('totalChunks mismatch');
  if (params.chunkIndex < 0 || params.chunkIndex >= meta.expectedChunks) throw new Error('Invalid chunk index');
  await fs.writeFile(path.join(dir, `chunk_${params.chunkIndex}`), params.chunkData);
  return { ok: true };
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await spawnAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ]);
    return;
  }
  await spawnAsync('unzip', ['-oq', zipPath, '-d', destDir]);
}

function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function pickExtractedRoot(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const dirs = entries.filter((e) => e.isDirectory());
  if (files.length === 0 && dirs.length === 1) return path.join(extractDir, dirs[0]!.name);
  return extractDir;
}

async function copyIntoWorkspace(srcRoot: string, dstRoot: string): Promise<number> {
  let count = 0;
  async function walk(rel: string): Promise<void> {
    const abs = rel ? path.join(srcRoot, rel) : srcRoot;
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const srcPath = path.join(srcRoot, childRel);
      const dstPath = path.join(dstRoot, childRel);
      if (entry.isDirectory()) {
        await fs.mkdir(dstPath, { recursive: true });
        await walk(childRel);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.copyFile(srcPath, dstPath);
        count += 1;
      }
    }
  }
  await walk('');
  return count;
}

export type NpmInstallProgressCallback = (line: string) => void;

export async function runNpmInstallAtRoot(
  workspaceRoot: string,
  onLine?: NpmInstallProgressCallback
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
      cwd: workspaceRoot,
      shell: false,
      env: process.env,
    });
    let stderr = '';
    child.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8').trim();
      if (text) onLine?.(text);
    });
    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8').trim();
      stderr += text;
      if (text) onLine?.(text);
    });
    child.on('error', (err) => {
      resolve({ ok: false, message: err.message });
    });
    child.on('close', (code) => {
      if ((code ?? 1) === 0) resolve({ ok: true, message: 'npm install 완료' });
      else resolve({ ok: false, message: stderr || `npm install 실패 (code=${code})` });
    });
  });
}

export type CompleteSourceBundleResult = {
  mergedZipPath: string;
  extractedPath?: string;
  savedPath: string;
  totalSize: number;
  appliedFiles?: number;
  npmInstall?: { ok: boolean; message: string; skipped?: boolean };
  versionMeta?: Awaited<ReturnType<typeof registerSourceVersion>>;
  ok: true;
};

export async function completeSourceBundleUpload(params: {
  uploadId: string;
  extract?: boolean;
  extractFolder?: string;
  preserveBundleZip?: boolean;
  onNpmLine?: NpmInstallProgressCallback;
}): Promise<CompleteSourceBundleResult> {
  const dir = tempDir(params.uploadId);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf-8')) as SourceBundleMeta;
  const zipPath = path.join(dir, meta.fileName);
  const handle = await fs.open(zipPath, 'w');
  try {
    for (let i = 0; i < meta.expectedChunks; i++) {
      const buf = await fs.readFile(path.join(dir, `chunk_${i}`));
      await handle.write(buf);
    }
  } finally {
    await handle.close();
  }
  const stat = await fs.stat(zipPath);
  if (stat.size !== meta.totalSize) {
    throw new Error(`병합 크기 불일치: expected=${meta.totalSize}, got=${stat.size}`);
  }

  const workspaceRoot = process.cwd();
  let extractedPath: string | undefined;
  let appliedFiles: number | undefined;
  let npmInstall: CompleteSourceBundleResult['npmInstall'];

  if (params.extract !== false) {
    const extractBase = path.join(dir, 'extracted');
    await extractZip(zipPath, extractBase);
    const bundleRoot = params.extractFolder?.trim() || meta.bundleRoot;
    const srcRoot = bundleRoot
      ? path.join(extractBase, bundleRoot.replace(/\\/g, path.sep))
      : await pickExtractedRoot(extractBase);
    extractedPath = srcRoot;
    appliedFiles = await copyIntoWorkspace(srcRoot, workspaceRoot);

    if (meta.runNpmInstall) {
      npmInstall = await runNpmInstallAtRoot(workspaceRoot, params.onNpmLine);
      if (!npmInstall.ok) {
        throw new Error(npmInstall.message);
      }
    } else {
      npmInstall = { ok: true, message: 'node_modules 포함 — npm install 생략', skipped: true };
    }
  }

  const versionMeta = await registerSourceVersion({
    zipPath,
    fileName: meta.fileName,
    mode: meta.mode,
    changeNote: meta.changeNote,
    bundleRoot: meta.bundleRoot,
  });

  const savedPath = versionMeta.zipPath;
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  return {
    ok: true,
    mergedZipPath: zipPath,
    extractedPath,
    savedPath,
    totalSize: stat.size,
    appliedFiles,
    npmInstall,
    versionMeta,
  };
}

export async function readSourceBundleMeta(uploadId: string): Promise<SourceBundleMeta | null> {
  try {
    const raw = await fs.readFile(path.join(tempDir(uploadId), 'meta.json'), 'utf-8');
    return JSON.parse(raw) as SourceBundleMeta;
  } catch {
    return null;
  }
}
