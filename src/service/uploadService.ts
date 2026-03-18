/**
 * Chunked upload service.
 * 베이스 = GGNR_DATA_DIR. 사업명 폴더 없음 (upload_data/tif, upload_data/las).
 * LAS 업로드 완료 시 이력 추가 후 파이프라인 비동기 실행.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { appendUploadConvertHistory, ensureBaseStructure } from './fileManagerService';
import { runLasPipeline } from './pipelineService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const CHUNK_SIZE = 512 * 1024; // 512KB

function getBaseDir(): string {
  return GGNR_DATA_DIR;
}

function getUploadTempDir(uploadId: string): string {
  return path.join(getBaseDir(), '.tmp', 'uploads', uploadId);
}

type UploadMeta = {
  uploadType: 'tif' | 'las' | 'shp' | 'excel';
  fileName: string;
  totalSize: number;
  expectedChunks: number;
  chunkSize: number;
};

export type InitChunkedUploadResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
};

/**
 * 청크 업로드 초기화. uploadId와 메타데이터 저장.
 */
export async function initChunkedUpload(params: {
  uploadType: 'tif' | 'las' | 'shp' | 'excel';
  fileName: string;
  totalSize: number;
}): Promise<InitChunkedUploadResult> {
  const { uploadType, fileName, totalSize } = params;
  if (uploadType !== 'tif' && uploadType !== 'las' && uploadType !== 'shp' && uploadType !== 'excel') {
    throw new Error('uploadType must be tif, las, shp, or excel');
  }
  const expectedChunks = Math.ceil(totalSize / CHUNK_SIZE) || 1;
  const uploadId = nanoid();
  const tempDir = getUploadTempDir(uploadId);
  await fs.mkdir(tempDir, { recursive: true });
  const meta: UploadMeta = {
    uploadType,
    fileName,
    totalSize,
    expectedChunks,
    chunkSize: CHUNK_SIZE,
  };
  await fs.writeFile(
    path.join(tempDir, 'meta.json'),
    JSON.stringify(meta),
    'utf-8'
  );
  return {
    uploadId,
    chunkSize: CHUNK_SIZE,
    expectedChunks,
  };
}

/**
 * 청크 데이터 저장. Route Handler에서 바이너리 받아 Buffer로 전달.
 */
export async function uploadChunk(params: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: Buffer;
}): Promise<{ ok: boolean }> {
  const { uploadId, chunkIndex, totalChunks, chunkData } = params;
  const tempDir = getUploadTempDir(uploadId);
  const metaPath = path.join(tempDir, 'meta.json');
  let meta: UploadMeta;
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw) as UploadMeta;
  } catch {
    throw new Error('Upload session not found or expired');
  }
  if (chunkIndex < 0 || chunkIndex >= meta.expectedChunks) {
    throw new Error('Invalid chunk index');
  }
  const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);
  await fs.writeFile(chunkPath, chunkData);
  return { ok: true };
}

export type CompleteChunkedUploadResult = {
  savedPath: string;
  size: number;
};

/**
 * 청크 병합 후 upload_data/tif 또는 upload_data/las에 저장, 임시 디렉터리 삭제.
 */
export async function completeChunkedUpload(params: {
  uploadId: string;
}): Promise<CompleteChunkedUploadResult> {
  const { uploadId } = params;
  const base = getBaseDir();
  const tempDir = getUploadTempDir(uploadId);
  const metaPath = path.join(tempDir, 'meta.json');
  let meta: UploadMeta;
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw) as UploadMeta;
  } catch {
    throw new Error('Upload session not found or expired');
  }
  await ensureBaseStructure();
  let subDir: string;
  if (meta.uploadType === 'tif') {
    subDir = 'upload_data/tif';
  } else if (meta.uploadType === 'shp') {
    subDir = 'service_data/shp_data';
  } else if (meta.uploadType === 'excel') {
    subDir = 'service_data/excel_data';
  } else {
    subDir = 'upload_data/las';
  }
  const targetDir = path.join(base, subDir);
  // Excel: 파일명 앞에 YYYYMMDDHHmmss 접두어로 덮어쓰기 방지
  const saveFileName =
    meta.uploadType === 'excel'
      ? `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${meta.fileName}`
      : meta.fileName;
  const targetPath = path.join(targetDir, saveFileName);
  const normalized = path.normalize(saveFileName).replace(/\\/g, '/');
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid fileName path');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const buffers: Buffer[] = [];
  for (let i = 0; i < meta.expectedChunks; i++) {
    const chunkPath = path.join(tempDir, `chunk_${i}`);
    const buf = await fs.readFile(chunkPath);
    buffers.push(buf);
  }
  await fs.writeFile(targetPath, Buffer.concat(buffers));
  const stat = await fs.stat(targetPath);
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  const savedPath = `${subDir}/${normalized}`;

  if (meta.uploadType !== 'shp' && meta.uploadType !== 'excel') {
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'upload',
      sourceFile: meta.fileName,
      pathOrResult: savedPath,
      status: '완료',
    }).catch((err) => {
      console.error('[uploadService] appendUploadConvertHistory failed:', err);
    });
  }

  if (meta.uploadType === 'las') {
    setImmediate(() => {
      runLasPipeline({ lasRelativePath: savedPath });
    });
  }

  return {
    savedPath,
    size: stat.size,
  };
}
