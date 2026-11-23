/**
 * file_data/{layer}/{key}/ 폴더를 ZIP 스트림으로 묶기 (스트리밍).
 * 하위 폴더(공사대장 탭 등) 파일도 상대 경로 유지해 포함.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { fileDataRelativeDir, shouldHideServiceFileDataFileName } from '@/lib/serviceFileData';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';

function getZipDataDir(): string {
  return resolveGgnrDataDir();
}

/** Asia/Seoul 기준 YYYYMMDDHHmmss (14자리) */
export function seoulCompactTimestampForZip(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value?.padStart(2, '0') ?? '00';
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');
  return `${y}${mo}${d}${h}${mi}${s}`;
}

function sanitizeZipDisplayLabel(s: string): string {
  const t = s
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return t || '첨부';
}

/** 예: 20260329154931_하천시설물(배수암거) 첨부파일.zip */
export function buildServiceFileDataZipDownloadFileName(params: {
  layerName: string;
  keyValue: string;
  displayLabel?: string | null;
}): string {
  const ts = seoulCompactTimestampForZip();
  const raw =
    params.displayLabel != null && params.displayLabel.trim() !== ''
      ? params.displayLabel.trim()
      : `${params.layerName}_${params.keyValue}`;
  const label = sanitizeZipDisplayLabel(raw);
  return `${ts}_${label} 첨부파일.zip`;
}

type ZipFileEntry = { absPath: string; entryName: string };

/** 디렉터리 재귀 수집 — .tmp 소프트삭제 파일 제외, ZIP entry는 posix 상대경로 */
async function collectFilesRecursive(
  absDir: string,
  prefix = ''
): Promise<ZipFileEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ZipFileEntry[] = [];
  for (const ent of entries) {
    const name = String(ent.name ?? '');
    if (!name || name === '.' || name === '..') continue;
    if (shouldHideServiceFileDataFileName(name)) continue;
    const absPath = path.join(absDir, name);
    const entryName = prefix ? `${prefix}/${name}` : name;
    if (ent.isDirectory()) {
      out.push(...(await collectFilesRecursive(absPath, entryName)));
      continue;
    }
    if (ent.isFile()) {
      out.push({ absPath, entryName });
    }
  }
  return out;
}

async function archiveEntriesToBuffer(
  files: ZipFileEntry[]
): Promise<Buffer> {
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on('data', (c: Buffer | string) => {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  });
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<Buffer>((resolve, reject) => {
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(pass);
  for (const f of files) {
    try {
      const st = await fs.stat(f.absPath);
      if (st.isFile()) {
        archive.file(f.absPath, { name: f.entryName });
      }
    } catch {
      // 목록과 불일치 시 건너뜀
    }
  }
  await archive.finalize();
  return done;
}

export async function createServiceFileDataZipStream(params: {
  layerName: string;
  keyValue: string;
  displayLabel?: string | null;
}): Promise<{ stream: PassThrough; downloadFileName: string }> {
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) throw new Error('Invalid path');
  const dir = path.join(getZipDataDir(), ...rel.split('/'));
  const files = await collectFilesRecursive(dir);
  if (files.length === 0) {
    throw new Error('다운로드할 첨부파일이 없습니다.');
  }
  const pass = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err: unknown) => {
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  archive.pipe(pass);
  for (const f of files) {
    try {
      const st = await fs.stat(f.absPath);
      if (st.isFile()) {
        archive.file(f.absPath, { name: f.entryName });
      }
    } catch {
      // 목록과 불일치 시 건너뜀
    }
  }
  void archive.finalize();
  const downloadFileName = buildServiceFileDataZipDownloadFileName({
    layerName: params.layerName,
    keyValue: params.keyValue,
    displayLabel: params.displayLabel,
  });
  return { stream: pass, downloadFileName };
}

/** 폴더 전체 ZIP 버퍼 (데이터요청 접수용) */
export async function createServiceFileDataZipBuffer(params: {
  layerName: string;
  keyValue: string;
  displayLabel?: string | null;
}): Promise<{ zipBuffer: Buffer; downloadFileName: string }> {
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) throw new Error('Invalid path');
  const dir = path.join(getZipDataDir(), ...rel.split('/'));
  const files = await collectFilesRecursive(dir);
  if (files.length === 0) {
    throw new Error('다운로드할 첨부파일이 없습니다.');
  }
  const zipBuffer = await archiveEntriesToBuffer(files);
  const downloadFileName = buildServiceFileDataZipDownloadFileName({
    layerName: params.layerName,
    keyValue: params.keyValue,
    displayLabel: params.displayLabel,
  });
  return { zipBuffer, downloadFileName };
}

/** 지정 파일들 ZIP 버퍼 (선택·미리보기 묶음 등) */
export async function createServiceFileEntriesZipBuffer(
  entries: ZipFileEntry[],
  downloadFileName: string
): Promise<{ zipBuffer: Buffer; downloadFileName: string }> {
  if (entries.length === 0) {
    throw new Error('다운로드할 첨부파일이 없습니다.');
  }
  const zipBuffer = await archiveEntriesToBuffer(entries);
  const name = downloadFileName.toLowerCase().endsWith('.zip')
    ? downloadFileName
    : `${downloadFileName}.zip`;
  return { zipBuffer, downloadFileName: name };
}

/** 메모리 바이트를 ZIP으로 (엑셀 등 클라이언트 생성 파일 접수용) */
export async function createZipBufferFromMemoryEntries(
  entries: { entryName: string; data: Buffer | Uint8Array }[],
  downloadFileName: string
): Promise<{ zipBuffer: Buffer; downloadFileName: string }> {
  if (entries.length === 0) {
    throw new Error('다운로드할 파일이 없습니다.');
  }
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on('data', (c: Buffer | string) => {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  });
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<Buffer>((resolve, reject) => {
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(pass);
  for (const e of entries) {
    const name = String(e.entryName ?? '').trim() || 'file.bin';
    archive.append(Buffer.from(e.data), { name });
  }
  await archive.finalize();
  const zipBuffer = await done;
  const name = downloadFileName.toLowerCase().endsWith('.zip')
    ? downloadFileName
    : `${downloadFileName}.zip`;
  return { zipBuffer, downloadFileName: name };
}

export type { ZipFileEntry };
