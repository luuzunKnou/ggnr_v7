import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';
import { applySourceZipFile, type RestartMode } from '@/service/sourceVersionService';

export const VERSION_RELAY_CHUNK_SIZE = 2 * 1024 * 1024;

type RelayMeta = {
  fileName: string;
  totalSize: number;
  expectedChunks: number;
  chunkSize: number;
  version: string;
  requestedBy: string;
  restart: boolean;
  restartMode: RestartMode;
  includeNodeModules: boolean;
};

function assertSafeUploadId(uploadId: string): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(uploadId)) {
    throw new Error('Invalid uploadId');
  }
}

function getRelayTempDir(uploadId: string): string {
  assertSafeUploadId(uploadId);
  return path.join(os.tmpdir(), 'ggnr_version_relay', uploadId);
}

/** 취소·실패 시 청크 tmp 디렉터리 삭제 (없으면 ok) */
export async function abortVersionRelay(params: { uploadId: string }): Promise<{ ok: boolean; removed: boolean }> {
  const { uploadId } = params;
  const tempDir = getRelayTempDir(uploadId);
  try {
    await fs.access(tempDir);
  } catch {
    return { ok: true, removed: false };
  }
  await fs.rm(tempDir, { recursive: true, force: true });
  return { ok: true, removed: true };
}

async function readMeta(tempDir: string): Promise<RelayMeta> {
  const raw = await fs.readFile(path.join(tempDir, 'meta.json'), 'utf-8');
  return JSON.parse(raw) as RelayMeta;
}

export type InitVersionRelayResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
};

export async function initVersionRelay(params: {
  fileName: string;
  totalSize: number;
  version: string;
  requestedBy: string;
  restart: boolean;
  restartMode: RestartMode;
  includeNodeModules?: boolean;
}): Promise<InitVersionRelayResult> {
  const { fileName, totalSize, version, requestedBy, restart, restartMode, includeNodeModules = true } = params;
  if (!fileName.trim()) throw new Error('fileName required');
  if (!Number.isFinite(totalSize) || totalSize <= 0) throw new Error('totalSize must be positive');

  const expectedChunks = Math.ceil(totalSize / VERSION_RELAY_CHUNK_SIZE) || 1;
  const uploadId = nanoid();
  const tempDir = getRelayTempDir(uploadId);
  await fs.mkdir(tempDir, { recursive: true });

  const meta: RelayMeta = {
    fileName,
    totalSize,
    expectedChunks,
    chunkSize: VERSION_RELAY_CHUNK_SIZE,
    version,
    requestedBy,
    restart,
    restartMode,
    includeNodeModules,
  };
  await fs.writeFile(path.join(tempDir, 'meta.json'), JSON.stringify(meta), 'utf-8');

  return { uploadId, chunkSize: VERSION_RELAY_CHUNK_SIZE, expectedChunks };
}

export async function uploadVersionRelayChunk(params: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: Buffer;
}): Promise<{ ok: boolean }> {
  const { uploadId, chunkIndex, totalChunks, chunkData } = params;
  const tempDir = getRelayTempDir(uploadId);
  let meta: RelayMeta;
  try {
    meta = await readMeta(tempDir);
  } catch {
    throw new Error('Relay session not found or expired');
  }
  if (totalChunks !== meta.expectedChunks) {
    throw new Error('totalChunks mismatch');
  }
  if (chunkIndex < 0 || chunkIndex >= meta.expectedChunks) {
    throw new Error('Invalid chunk index');
  }
  await fs.writeFile(path.join(tempDir, `chunk_${chunkIndex}`), chunkData);
  return { ok: true };
}

export async function completeVersionRelay(params: { uploadId: string }) {
  const { uploadId } = params;
  const tempDir = getRelayTempDir(uploadId);
  let meta: RelayMeta;
  try {
    meta = await readMeta(tempDir);
  } catch {
    throw new Error('Relay session not found or expired');
  }

  const safeName = path.basename(meta.fileName.replace(/\\/g, '/'));
  if (!safeName || safeName.includes('..')) {
    throw new Error('Invalid fileName');
  }

  const zipPath = path.join(tempDir, safeName);
  const handle = await fs.open(zipPath, 'w');
  try {
    for (let i = 0; i < meta.expectedChunks; i++) {
      const chunkPath = path.join(tempDir, `chunk_${i}`);
      const buf = await fs.readFile(chunkPath);
      await handle.write(buf);
    }
  } finally {
    await handle.close();
  }

  const stat = await fs.stat(zipPath);
  if (stat.size !== meta.totalSize) {
    throw new Error(`병합 크기 불일치: expected=${meta.totalSize}, got=${stat.size}`);
  }

  const applied = await applySourceZipFile({
    zipPath,
    version: meta.version,
    fileName: meta.fileName,
    requestedBy: meta.requestedBy,
    restart: meta.restart,
    restartMode: meta.restartMode,
    includeNodeModules: meta.includeNodeModules,
  });

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  return {
    ok: true,
    mergedZipPath: zipPath,
    mergedSize: stat.size,
    ...applied,
  };
}
