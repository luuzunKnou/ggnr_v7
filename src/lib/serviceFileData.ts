/**
 * GGNR_DATA_DIR 기준 file_data/{layer}/{key}/ 첨부 저장소.
 * (사업별로 GGNR_DATA_DIR가 이미 프로젝트 루트를 가리킴)
 */

const UNSAFE_SEGMENT = /[\0\/\\]/;

/**
 * 게이트(BASE_PATH)·프록시가 쿼리의 한글·비ASCII 파일명을 깨뜨리는 경우 대비.
 * 상대경로를 ASCII-only base64url 로 실어 보낸다.
 */
export function encodeServiceFileDataPathB64(relativePath: string): string {
  const bytes = new TextEncoder().encode(relativePath);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** pathB64 → UTF-8 상대경로. 실패 시 null */
export function decodeServiceFileDataPathB64(pathB64: string): string | null {
  const raw = String(pathB64 ?? '').trim();
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const padded = b64 + pad;
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf8');
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** 단일 경로 세그먼트(폴더명) 검증 */
export function assertSafeFileDataSegment(segment: string): string | null {
  const t = segment.trim();
  if (!t || t === '.' || t === '..' || t.includes('..') || UNSAFE_SEGMENT.test(t)) return null;
  return t;
}

/** 목록 조회용 상대 디렉터리 (슬래시 구분). optional subfolder → file_data/{layer}/{key}/{subfolder} */
export function fileDataRelativeDir(
  layerName: string,
  keyValue: string,
  subfolder?: string | null
): string | null {
  const L = assertSafeFileDataSegment(layerName);
  const K = assertSafeFileDataSegment(String(keyValue));
  if (!L || !K) return null;
  const base = `file_data/${L}/${K}`;
  const sub = String(subfolder ?? '').trim();
  if (!sub) return base;
  const S = assertSafeFileDataSegment(sub);
  if (!S) return null;
  return `${base}/${S}`;
}

/**
 * 다운로드 허용: file_data/{layer}/{key}/{file}
 */
export function isAllowedServiceFileDataDownloadPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = 'file_data/';
  if (!norm.startsWith(prefix)) return false;
  const rest = norm.slice(prefix.length);
  if (!rest || rest.includes('..')) return false;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 3) return false;
  const fileName = parts[parts.length - 1];
  if (!fileName || UNSAFE_SEGMENT.test(fileName) || fileName.includes('..')) return false;
  if (isServiceFileDataTmpMarkedFileName(fileName)) return false;
  if (isServiceFileDataSystemJunkFileName(fileName)) return false;
  return true;
}

/** 업로드 저장 파일명 (경로 제거, path traversal 방지) */
export function assertSafeServiceFileBasename(name: string): string | null {
  const base = name.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  if (!base || base === '.' || base === '..' || base.includes('..')) return null;
  if (UNSAFE_SEGMENT.test(base)) return null;
  if (base.length > 240) return null;
  if (isServiceFileDataSystemJunkFileName(base)) return null;
  return base;
}

/** 소프트삭제(rename → *.tmp)된 파일 — 목록·다운로드에서 제외 */
export function isServiceFileDataTmpMarkedFileName(fileName: string): boolean {
  return fileName.endsWith('.tmp');
}

/** OS가 폴더 탐색 시 만드는 캐시·설정 파일·폴더 — 첨부 목록·다운로드에서 제외 */
const SERVICE_FILE_DATA_SYSTEM_JUNK = new Set([
  'thumbs',
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.ds_store',
]);

/** Thumbs.db, Thumbs_기타.db, Thumbs_도면.db 등 탐색기 미리보기 캐시 */
const THUMBS_DB_RE = /^(eh)?thumbs.*\.db$/i;

export function isServiceFileDataSystemJunkFileName(fileName: string): boolean {
  const name = String(fileName ?? '').trim().toLowerCase();
  if (!name) return false;
  if (SERVICE_FILE_DATA_SYSTEM_JUNK.has(name)) return true;
  return THUMBS_DB_RE.test(name);
}

/** 목록·다운로드·루트파일 판정에서 숨길 파일 */
export function shouldHideServiceFileDataFileName(fileName: string): boolean {
  return (
    isServiceFileDataTmpMarkedFileName(fileName) || isServiceFileDataSystemJunkFileName(fileName)
  );
}
