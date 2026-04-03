/**
 * GGNR_DATA_DIR 기준 service_data/file_data/{layer}/{key}/ 첨부 저장소.
 * (사업별로 GGNR_DATA_DIR가 이미 프로젝트 루트를 가리킴)
 */

const UNSAFE_SEGMENT = /[\0\/\\]/;

/** 단일 경로 세그먼트(폴더명) 검증 */
export function assertSafeFileDataSegment(segment: string): string | null {
  const t = segment.trim();
  if (!t || t === '.' || t === '..' || t.includes('..') || UNSAFE_SEGMENT.test(t)) return null;
  return t;
}

/** 목록 조회용 상대 디렉터리 (슬래시 구분) */
export function fileDataRelativeDir(layerName: string, keyValue: string): string | null {
  const L = assertSafeFileDataSegment(layerName);
  const K = assertSafeFileDataSegment(String(keyValue));
  if (!L || !K) return null;
  return `service_data/file_data/${L}/${K}`;
}

/**
 * 다운로드 허용: service_data/file_data/{layer}/{key}/{file}
 */
export function isAllowedServiceFileDataDownloadPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = 'service_data/file_data/';
  if (!norm.startsWith(prefix)) return false;
  const rest = norm.slice(prefix.length);
  if (!rest || rest.includes('..')) return false;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 3) return false;
  const fileName = parts[parts.length - 1];
  if (!fileName || UNSAFE_SEGMENT.test(fileName) || fileName.includes('..')) return false;
  if (isServiceFileDataTmpMarkedFileName(fileName)) return false;
  return true;
}

/** 업로드 저장 파일명 (경로 제거, path traversal 방지) */
export function assertSafeServiceFileBasename(name: string): string | null {
  const base = name.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  if (!base || base === '.' || base === '..' || base.includes('..')) return null;
  if (UNSAFE_SEGMENT.test(base)) return null;
  if (base.length > 240) return null;
  return base;
}

/** 소프트삭제(rename → *.tmp)된 파일 — 목록·다운로드에서 제외 */
export function isServiceFileDataTmpMarkedFileName(fileName: string): boolean {
  return fileName.endsWith('.tmp');
}
