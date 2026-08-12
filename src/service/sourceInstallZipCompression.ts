/** 설치 ZIP 압축 — 무압축 확장자·압축 레벨 */
import path from 'node:path';

const STORE_EXTENSIONS = new Set([
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp4',
  '.mp3',
  '.pdf',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.ico',
  '.pbf',
  '.las',
  '.laz',
]);

export function zipEntryName(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

export function archiverLevelForPath(relPath: string): 0 | 1 | 9 {
  const posix = relPath.replace(/\\/g, '/');
  if (posix.startsWith('python/env_parts/')) return 0;
  const ext = path.extname(relPath).toLowerCase();
  if (STORE_EXTENSIONS.has(ext)) return 0;
  if (/^\.z\d+$/i.test(ext)) return 0;
  return 1;
}

export function defaultZipLevel(): 1 {
  return 1;
}
