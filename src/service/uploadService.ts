/**
 * Chunked upload service.
 * 베이스 = GGNR_DATA_DIR. upload_data/*, service_data/shp_data|excel_data|file_data/...
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { getSessionUsrId, userHasSerAccess } from '@/lib/auth/guard';
import { assertSafeServiceFileBasename, fileDataRelativeDir } from '@/lib/serviceFileData';
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

type BaseMeta = {
  fileName: string;
  totalSize: number;
  expectedChunks: number;
  chunkSize: number;
};

type UploadMetaStandard = BaseMeta & {
  uploadType: 'tif' | 'las' | 'shp' | 'excel' | 'fileData';
};

type UploadMetaServiceFileData = BaseMeta & {
  uploadType: 'serviceFileData';
  layerName: string;
  keyValue: string;
  ownerUsrId: string;
  serEng: string;
  /** GGNR_DATA_DIR 기준 상대 디렉터리 (슬래시) */
  relativeDir: string;
};

type UploadMeta = UploadMetaStandard | UploadMetaServiceFileData;

export type InitChunkedUploadResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
};

/**
 * 청크 업로드 초기화. uploadId와 메타데이터 저장.
 * serviceFileData 타입은 사용할 수 없습니다 — initServiceFileDataUpload 를 사용하세요.
 */
export async function initChunkedUpload(params: {
  uploadType: 'tif' | 'las' | 'shp' | 'excel' | 'fileData';
  fileName: string;
  totalSize: number;
}): Promise<InitChunkedUploadResult> {
  const { uploadType, fileName, totalSize } = params;
  if (uploadType !== 'tif' && uploadType !== 'las' && uploadType !== 'shp' && uploadType !== 'excel' && uploadType !== 'fileData') {
    throw new Error('uploadType must be tif, las, shp, excel, or fileData');
  }
  const expectedChunks = Math.ceil(totalSize / CHUNK_SIZE) || 1;
  const uploadId = nanoid();
  const tempDir = getUploadTempDir(uploadId);
  await fs.mkdir(tempDir, { recursive: true });
  const meta: UploadMetaStandard = {
    uploadType,
    fileName,
    totalSize,
    expectedChunks,
    chunkSize: CHUNK_SIZE,
  };
  await fs.writeFile(path.join(tempDir, 'meta.json'), JSON.stringify(meta), 'utf-8');
  return {
    uploadId,
    chunkSize: CHUNK_SIZE,
    expectedChunks,
  };
}

/**
 * service_data/file_data/{layer}/{key}/ 에 청크 업로드할 세션 시작.
 * 호출부에서 serEng·layer·key·ownerUsrId 검증 후 전달.
 */
export async function initServiceFileDataUpload(params: {
  fileName: string;
  totalSize: number;
  layerName: string;
  keyValue: string;
  ownerUsrId: string;
  serEng: string;
}): Promise<InitChunkedUploadResult> {
  if (!(await userHasSerAccess(params.ownerUsrId, params.serEng.trim(), 'write'))) {
    throw new Error('Forbidden');
  }
  const safeName = assertSafeServiceFileBasename(params.fileName);
  if (!safeName) {
    throw new Error('유효하지 않은 파일명입니다.');
  }
  const relDir = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!relDir) {
    throw new Error('유효하지 않은 layer 또는 key 입니다.');
  }
  const expectedChunks = Math.ceil(params.totalSize / CHUNK_SIZE) || 1;
  const uploadId = nanoid();
  const tempDir = getUploadTempDir(uploadId);
  await fs.mkdir(tempDir, { recursive: true });
  const meta: UploadMetaServiceFileData = {
    uploadType: 'serviceFileData',
    fileName: safeName,
    totalSize: params.totalSize,
    expectedChunks,
    chunkSize: CHUNK_SIZE,
    layerName: params.layerName.trim(),
    keyValue: String(params.keyValue),
    ownerUsrId: params.ownerUsrId,
    serEng: params.serEng.trim(),
    relativeDir: relDir,
  };
  await fs.writeFile(path.join(tempDir, 'meta.json'), JSON.stringify(meta), 'utf-8');
  return {
    uploadId,
    chunkSize: CHUNK_SIZE,
    expectedChunks,
  };
}

async function readMetaAsync(tempDir: string): Promise<UploadMeta> {
  const raw = await fs.readFile(path.join(tempDir, 'meta.json'), 'utf-8');
  return JSON.parse(raw) as UploadMeta;
}

/**
 * 청크 데이터 저장. Route Handler에서 바이너리 받아 Buffer로 전달.
 * serviceFileData 세션은 sessionUsrId 가 메타의 ownerUsrId 와 일치해야 합니다.
 */
export async function uploadChunk(params: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: Buffer;
  sessionUsrId: string | null;
}): Promise<{ ok: boolean }> {
  const { uploadId, chunkIndex, totalChunks, chunkData, sessionUsrId } = params;
  const tempDir = getUploadTempDir(uploadId);
  let meta: UploadMeta;
  try {
    meta = await readMetaAsync(tempDir);
  } catch {
    throw new Error('Upload session not found or expired');
  }
  if (totalChunks !== meta.expectedChunks) {
    throw new Error('totalChunks mismatch');
  }
  if (meta.uploadType === 'serviceFileData') {
    if (!sessionUsrId || sessionUsrId !== meta.ownerUsrId) {
      throw new Error('Forbidden');
    }
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
 * 청크 병합 후 최종 경로에 저장, 임시 디렉터리 삭제.
 * serviceFileData 는 현재 세션 사용자가 소유자이며 해당 serEng 에 쓰기 권한이 있어야 합니다.
 */
export async function completeChunkedUpload(params: { uploadId: string }): Promise<CompleteChunkedUploadResult> {
  const { uploadId } = params;
  const base = getBaseDir();
  const tempDir = getUploadTempDir(uploadId);
  let meta: UploadMeta;
  try {
    meta = await readMetaAsync(tempDir);
  } catch {
    throw new Error('Upload session not found or expired');
  }

  if (meta.uploadType === 'serviceFileData') {
    const uid = await getSessionUsrId();
    if (!uid || uid !== meta.ownerUsrId) {
      throw new Error('Forbidden');
    }
    if (!(await userHasSerAccess(uid, meta.serEng, 'write'))) {
      throw new Error('Forbidden');
    }
  }

  await ensureBaseStructure();
  let subDir: string;
  let saveFileName: string;

  if (meta.uploadType === 'serviceFileData') {
    subDir = meta.relativeDir.replace(/\\/g, '/');
    saveFileName = meta.fileName;
  } else if (meta.uploadType === 'tif') {
    subDir = 'upload_data/tif';
    saveFileName = meta.fileName;
  } else if (meta.uploadType === 'shp') {
    subDir = 'service_data/shp_data';
    saveFileName = meta.fileName;
  } else if (meta.uploadType === 'excel') {
    subDir = 'service_data/excel_data';
    saveFileName = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${meta.fileName}`;
  } else if (meta.uploadType === 'fileData') {
    subDir = 'service_data/file_data';
    saveFileName = meta.fileName;
  } else {
    subDir = 'upload_data/las';
    saveFileName = meta.fileName;
  }

  const targetDir = path.join(base, ...subDir.split('/'));
  const normalized = path.normalize(saveFileName).replace(/\\/g, '/');
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid fileName path');
  }
  const segments = normalized.split('/').filter((p) => p && p !== '.');
  if (segments.some((p) => p === '..')) {
    throw new Error('Invalid fileName path');
  }
  const targetPath =
    meta.uploadType === 'fileData'
      ? path.join(targetDir, ...segments)
      : path.join(targetDir, segments[segments.length - 1] ?? normalized);
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
  const savedPath =
    meta.uploadType === 'fileData'
      ? `${subDir}/${segments.join('/')}`
      : `${subDir}/${segments[segments.length - 1] ?? path.basename(normalized)}`;

  if (
    meta.uploadType !== 'shp' &&
    meta.uploadType !== 'excel' &&
    meta.uploadType !== 'serviceFileData' &&
    meta.uploadType !== 'fileData'
  ) {
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
