/**
 * 촬영(영상) 업로드 저장 경로 — GGNR_DATA_DIR 기준 상대 경로.
 * {GGNR_DATA_DIR}/aerial/{kind}/{folderName}/
 */

export const AERIAL_UPLOAD_ROOT = 'aerial';

export const AERIAL_KINDS = ['ortho', 'drone', 'panorama', 'satellite'] as const;
export type AerialUploadKind = (typeof AERIAL_KINDS)[number];

export function isAerialUploadKind(v: unknown): v is AerialUploadKind {
  return typeof v === 'string' && (AERIAL_KINDS as readonly string[]).includes(v);
}

/** 안내·진행표시용 루트 (끝에 /) */
export function aerialKindRelativeRoot(kind: AerialUploadKind): string {
  return `${AERIAL_UPLOAD_ROOT}/${kind}/`;
}

/**
 * 폴더명 안전화.
 * 경로 구분자·예약문자만 차단. `_` 구분자(작업일_구분_좌표계_작업명)는 유지.
 */
export function sanitizeAerialFolderName(raw: string): string | null {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  if (/[\\/]/.test(trimmed)) return null;
  if (/[\u0000-\u001f]/.test(trimmed)) return null;
  if (/[<>:"|?*]/.test(trimmed)) return null;
  if (trimmed.length > 180) return null;
  return trimmed;
}

/** GGNR_DATA_DIR 기준 상대 디렉터리 (슬래시) */
export function aerialWorkUnitRelativeDir(kind: AerialUploadKind, folderName: string): string | null {
  if (!isAerialUploadKind(kind)) return null;
  const name = sanitizeAerialFolderName(folderName);
  if (!name) return null;
  return `${AERIAL_UPLOAD_ROOT}/${kind}/${name}`;
}
