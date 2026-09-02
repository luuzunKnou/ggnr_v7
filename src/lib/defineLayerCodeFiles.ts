import fs from 'fs';
import path from 'path';

export const DEFINE_LAYER_CODES_BASE_DIR = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'codes'
);

/** 프로젝트별 코드 오버레이 — 단계적으로 확장 */
const CODE_OVERLAY_PROJECTS = new Set(['build_yy']);

/** 프로젝트 오버레이 대상 필드 (법정동·관리기관 코드만) */
const PROJECT_OVERLAY_FIELD_NAMES = new Set(['hjd_cde', 'mng_cde']);

export function sanitizeDefineLayerTableFieldKey(tableField: string): string {
  return String(tableField).replace(/[^a-zA-Z0-9_-]/g, '');
}

/** tableField = tableName__fieldName → fieldName */
export function extractDefineLayerCodeFieldName(tableField: string): string {
  const safe = sanitizeDefineLayerTableFieldKey(tableField);
  const sep = safe.lastIndexOf('__');
  return sep >= 0 ? safe.slice(sep + 2) : safe;
}

/** tableField = tableName__fieldName */
export function isDefineLayerProjectOverlayCodeField(tableField: string): boolean {
  const field = extractDefineLayerCodeFieldName(tableField);
  return PROJECT_OVERLAY_FIELD_NAMES.has(field.toLowerCase());
}

export function getDefineLayerCodeOverlayProject(): string | null {
  const project = (process.env.GGNR_PROJECT ?? '').trim();
  if (!project || !CODE_OVERLAY_PROJECTS.has(project)) return null;
  return project;
}

export function getCommonDefineLayerCodeFilePath(tableField: string): string {
  const safe = sanitizeDefineLayerTableFieldKey(tableField);
  return path.join(DEFINE_LAYER_CODES_BASE_DIR, `field_${safe}.json`);
}

/** 레이어 공통 프로젝트 오버레이 — codes/{project}/field__hjd_cde.json */
export function getSharedProjectOverlayCodeFilePath(
  project: string,
  tableField: string
): string {
  const field = extractDefineLayerCodeFieldName(tableField).toLowerCase();
  return path.join(DEFINE_LAYER_CODES_BASE_DIR, project, `field__${field}.json`);
}

/** @deprecated 레이어별 프로젝트 파일 — 읽기 fallback만 */
export function getProjectDefineLayerCodeFilePath(
  project: string,
  tableField: string
): string {
  const safe = sanitizeDefineLayerTableFieldKey(tableField);
  return path.join(DEFINE_LAYER_CODES_BASE_DIR, project, `field_${safe}.json`);
}

/** dev·API 저장 경로 — 오버레이 대상은 프로젝트 공통 field__{필드}.json */
export function getDefineLayerCodeWriteFilePath(tableField: string): string {
  const overlay = getDefineLayerCodeOverlayProject();
  if (overlay && isDefineLayerProjectOverlayCodeField(tableField)) {
    return getSharedProjectOverlayCodeFilePath(overlay, tableField);
  }
  return getCommonDefineLayerCodeFilePath(tableField);
}

function parseCodesFile(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function normalizeCodeNameKey(name: unknown): string {
  const s = String(name ?? '').trim().toLowerCase();
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

/** 공통 + 프로젝트 오버레이 (동일 코드명은 프로젝트 우선) */
export function mergeDefineLayerCodeRows(
  common: Array<Record<string, unknown>>,
  overlay: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of common) {
    const key = normalizeCodeNameKey(row.define_code_name);
    if (key) map.set(key, row);
  }
  for (const row of overlay) {
    const key = normalizeCodeNameKey(row.define_code_name);
    if (key) map.set(key, row);
  }
  return Array.from(map.values());
}

export function readDefineLayerCodes(tableField: string): Array<Record<string, unknown>> {
  const common = parseCodesFile(getCommonDefineLayerCodeFilePath(tableField));
  const overlayProject = getDefineLayerCodeOverlayProject();
  if (!overlayProject || !isDefineLayerProjectOverlayCodeField(tableField)) return common;

  const sharedPath = getSharedProjectOverlayCodeFilePath(overlayProject, tableField);
  const shared = parseCodesFile(sharedPath);
  /** 프로젝트 공통 오버레이 — 지역 코드만 (공통 안동 등과 병합하지 않음) */
  if (shared.length > 0) return shared;

  const legacyOverlay = parseCodesFile(
    getProjectDefineLayerCodeFilePath(overlayProject, tableField)
  );
  if (legacyOverlay.length === 0) return common;
  return mergeDefineLayerCodeRows(common, legacyOverlay);
}

export function writeDefineLayerCodes(tableField: string, codes: unknown[]): string {
  const filePath = getDefineLayerCodeWriteFilePath(tableField);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(codes, null, 2) + '\n', 'utf-8');
  return filePath;
}

export function defineLayerCodesFileExists(tableField: string): boolean {
  if (fs.existsSync(getCommonDefineLayerCodeFilePath(tableField))) return true;
  const overlay = getDefineLayerCodeOverlayProject();
  if (!overlay || !isDefineLayerProjectOverlayCodeField(tableField)) return false;
  if (fs.existsSync(getSharedProjectOverlayCodeFilePath(overlay, tableField))) return true;
  return fs.existsSync(getProjectDefineLayerCodeFilePath(overlay, tableField));
}
