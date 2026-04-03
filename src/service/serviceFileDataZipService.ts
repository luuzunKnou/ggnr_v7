/**
 * service_data/file_data/{layer}/{key}/ 폴더를 ZIP 스트림으로 묶기 (스트리밍).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { fileDataRelativeDir } from '@/lib/serviceFileData';
import { listServiceFileDataFiles } from './fileManagerService';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

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

export async function createServiceFileDataZipStream(params: {
  layerName: string;
  keyValue: string;
  displayLabel?: string | null;
}): Promise<{ stream: PassThrough; downloadFileName: string }> {
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) throw new Error('Invalid path');
  const dir = path.join(GGNR_DATA_DIR, ...rel.split('/'));
  const files = await listServiceFileDataFiles(params);
  const pass = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err: unknown) => {
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  archive.pipe(pass);
  for (const f of files) {
    const fp = path.join(dir, f.name);
    try {
      const st = await fs.stat(fp);
      if (st.isFile()) {
        archive.file(fp, { name: f.name });
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
