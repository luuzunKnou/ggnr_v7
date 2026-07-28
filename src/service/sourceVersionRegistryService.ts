import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

export type SourceVersionMeta = {
  version: string;
  fileName: string;
  zipPath: string;
  checksumSha256?: string;
  size: number;
  createdAt: string;
  mode?: string;
  changeNote?: string;
  bundleRoot?: string;
};

function versionsRoot(): string {
  return path.join(GGNR_DATA_DIR, GGNR_DATA_PATHS.sourceUpload, 'versions');
}

function latestJsonPath(): string {
  return path.join(versionsRoot(), 'latest.json');
}

export async function ensureVersionRegistryDirs(): Promise<void> {
  await fs.mkdir(versionsRoot(), { recursive: true });
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function registerSourceVersion(params: {
  zipPath: string;
  fileName: string;
  version?: string;
  mode?: string;
  changeNote?: string;
  bundleRoot?: string;
}): Promise<SourceVersionMeta> {
  await ensureVersionRegistryDirs();
  const stat = await fs.stat(params.zipPath);
  const version =
    params.version?.trim() ||
    new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const versionDir = path.join(versionsRoot(), version);
  await fs.mkdir(versionDir, { recursive: true });
  const destZip = path.join(versionDir, 'bundle.zip');
  await fs.copyFile(params.zipPath, destZip);
  const checksumSha256 = await sha256File(destZip).catch(() => undefined);
  const relZipPath = path
    .join(GGNR_DATA_PATHS.sourceUpload, 'versions', version, 'bundle.zip')
    .replace(/\\/g, '/');

  const meta: SourceVersionMeta = {
    version,
    fileName: params.fileName,
    zipPath: relZipPath,
    checksumSha256,
    size: stat.size,
    createdAt: new Date().toISOString(),
    mode: params.mode,
    changeNote: params.changeNote,
    bundleRoot: params.bundleRoot,
  };
  await fs.writeFile(path.join(versionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  await fs.writeFile(latestJsonPath(), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

export async function readLatestSourceVersion(): Promise<SourceVersionMeta | null> {
  try {
    const raw = await fs.readFile(latestJsonPath(), 'utf-8');
    return JSON.parse(raw) as SourceVersionMeta;
  } catch {
    return null;
  }
}

export async function resolveLatestZipAbsolutePath(): Promise<{ absPath: string; meta: SourceVersionMeta } | null> {
  const meta = await readLatestSourceVersion();
  if (!meta?.zipPath) return null;
  const absPath = path.isAbsolute(meta.zipPath)
    ? meta.zipPath
    : path.join(GGNR_DATA_DIR, meta.zipPath.replace(/\//g, path.sep));
  try {
    await fs.access(absPath);
    return { absPath, meta };
  } catch {
    return null;
  }
}

export function publicLatestResponse(meta: SourceVersionMeta): Record<string, unknown> {
  return {
    version: meta.version,
    fileName: meta.fileName,
    downloadUrl: '/api/source/version/download/latest',
    checksumSha256: meta.checksumSha256,
    createdAt: meta.createdAt,
    size: meta.size,
    sizeBytes: meta.size,
    totalSize: meta.size,
  };
}
