export type SourceUploadCategory = 'core' | 'runtime' | 'data';
export type SourceUploadMode = 'install' | 'update';

/** 폐쇄망=node_modules 포함, 개방망=미포함 */
export type SourcePackageProfile = 'closed' | 'open';

export function profileIncludesNodeModules(profile: SourcePackageProfile): boolean {
  return profile === 'closed';
}

/**
 * 모드와 무관하게 항상 업로드에서 제외할 "경로 prefix" 목록.
 */
const ALWAYS_EXCLUDE_PREFIXES = [
  '.cursor/',
  '.vscode/',
  '.next/',
  '.git/',
  '.yarn/',
  'coverage/',
  'out/',
  'build/',
  'docs/',
  '.cad-preview-work/',
  'python/env/',
  'python/env_parts/',
  'geoserver_modules/data_dir/logs/',
  'geoserver_modules/data_dir/gwc/',
];

/** 운영 서버마다 다른 기동 bat·Next 생성 타입 등은 패키지에 넣지 않음 */
const ALWAYS_EXCLUDE_EXACT = ['next-env.d.ts', 'ggnr_start.bat', 'python/env.zip'];

/** python/env 옆의 env.zip·env.z01 — 분할본은 python/env_parts/ 만 사용 */
function isPythonEnvRootSplitFile(p: string): boolean {
  return p === 'python/env.zip' || /^python\/env\.z\d+$/i.test(p);
}

const RUNTIME_PREFIXES = [
  'scripts/',
  'src/config/projects/',
  'geoserver_modules/scripts/',
];

const DATA_PREFIXES = [
  '3dtiles_las/',
  'tiles_tif/',
  'tiles_jpg/',
  '3dtiles_b3dm/',
  '3dtiles_pnts/',
  '3dtiles_obj/',
  '3dtiles_tiff/',
  'file_data/',
  'shp_data/',
  'excel_data/',
  'source_upload/',
  'geoserver_modules/data_dir/',
];

const UPDATE_DATA_ALLOW_PREFIXES = ['geoserver_modules/data_dir/'];

const MODE_EXCLUDE_PREFIXES: Record<SourceUploadMode, string[]> = {
  install: [],
  update: [
    'node_modules/',
    'geoserver_modules/java/',
    'geoserver_modules/geoserver/',
    'pg_map_modules/services/pg_tileserv/',
    'pg_map_modules/services/pg_featureserv/',
  ],
};

function normalizeRelPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function hasAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

export function classifySourcePath(relativePath: string): SourceUploadCategory {
  const p = normalizeRelPath(relativePath);
  if (hasAnyPrefix(p, DATA_PREFIXES)) return 'data';
  if (hasAnyPrefix(p, RUNTIME_PREFIXES)) return 'runtime';
  return 'core';
}

export function isExcludedSourcePath(
  relativePath: string,
  mode: SourceUploadMode,
  includeNodeModules = true
): boolean {
  const p = normalizeRelPath(relativePath);
  if (!p) return true;
  if (ALWAYS_EXCLUDE_EXACT.includes(p)) return true;
  if (isPythonEnvRootSplitFile(p)) return true;
  if (p.endsWith('.log')) return true;
  if (hasAnyPrefix(p, ALWAYS_EXCLUDE_PREFIXES)) return true;
  if (!includeNodeModules && (p === 'node_modules' || p.startsWith('node_modules/'))) return true;
  if (hasAnyPrefix(p, MODE_EXCLUDE_PREFIXES[mode])) return true;
  if (
    mode === 'update' &&
    p.startsWith('pg_map_modules/services/') &&
    (p.endsWith('.zip') || p.endsWith('.exe'))
  ) {
    return true;
  }
  if (p.includes('/.cache/')) return true;
  if (p.includes('/.tmp/')) return true;
  return false;
}

export function shouldUploadSourcePath(
  relativePath: string,
  mode: SourceUploadMode,
  includeNodeModules = true
): boolean {
  const p = normalizeRelPath(relativePath);
  if (isExcludedSourcePath(p, mode, includeNodeModules)) return false;
  const category = classifySourcePath(p);
  if (mode === 'install') return true;
  if (category === 'runtime') return false;
  if (category === 'data') return hasAnyPrefix(p, UPDATE_DATA_ALLOW_PREFIXES);
  return true;
}

export function shouldSkipSourceDir(
  relativeDir: string,
  mode: SourceUploadMode,
  includeNodeModules = true
): boolean {
  const p = normalizeRelPath(relativeDir);
  if (!p) return false;
  const dir = p.endsWith('/') ? p : `${p}/`;
  if (!includeNodeModules && (dir === 'node_modules/' || dir.startsWith('node_modules/'))) return true;
  return hasAnyPrefix(dir, ALWAYS_EXCLUDE_PREFIXES) || hasAnyPrefix(dir, MODE_EXCLUDE_PREFIXES[mode]);
}

/**
 * 최신 소스 적용 — 잔여 정리·롤백 삭제 금지 경로.
 * 소스 업로드·설치 ZIP 제외 + 데이터/대용량 + 적용 시 병합 제외와 합집합.
 */
const APPLY_EXTRA_PROTECT_PREFIXES = [
  'python/env/',
  'python/env_parts/',
  '3dtiles_las/',
  'tiles_tif/',
  'tiles_jpg/',
  '3dtiles_b3dm/',
  '3dtiles_pnts/',
  '3dtiles_obj/',
  '3dtiles_tiff/',
  'file_data/',
  'shp_data/',
  'excel_data/',
  'source_upload/',
  'geoserver_modules/data_dir/',
  'geoserver_modules/java/',
  'geoserver_modules/geoserver/',
  'pg_map_modules/',
  '.cursor-runtime/',
];

/** 잔여 정리 walk 루트 (패키지 관리 대상) */
export const APPLY_ORPHAN_WALK_ROOTS = [
  'src/',
  'scripts/',
  'public/',
  'geoserver_modules/scripts/',
] as const;

export function isProtectedApplyResidualPath(
  relativePath: string,
  includeNodeModules = true
): boolean {
  const p = normalizeRelPath(relativePath);
  if (!p) return true;
  if (ALWAYS_EXCLUDE_EXACT.includes(p)) return true;
  if (p.endsWith('.log')) return true;
  if (hasAnyPrefix(p, ALWAYS_EXCLUDE_PREFIXES)) return true;
  if (hasAnyPrefix(p, DATA_PREFIXES)) return true;
  if (hasAnyPrefix(p, APPLY_EXTRA_PROTECT_PREFIXES)) return true;
  if (p === '.cursor-runtime' || p.startsWith('.cursor-runtime/')) return true;
  if (isExcludedSourcePath(p, 'install', includeNodeModules)) return true;
  return false;
}

/** 잔여 정리 후보인지 (보호·데이터 제외, managed 루트 또는 루트 단일 파일) */
export function isManagedApplyOrphanCandidate(
  relativePath: string,
  includeNodeModules = true
): boolean {
  const p = normalizeRelPath(relativePath);
  if (!p || isProtectedApplyResidualPath(p, includeNodeModules)) return false;
  if (APPLY_ORPHAN_WALK_ROOTS.some((root) => p.startsWith(root))) return true;
  /** 워크스페이스 루트 파일만 (하위에서 보호되지 않은 임의 폴더 전체 walk 방지) */
  if (!p.includes('/')) return true;
  return false;
}

export function packageProfileFromInclude(includeNodeModules: boolean): SourcePackageProfile {
  return includeNodeModules ? 'closed' : 'open';
}

export function includeNodeModulesFromProfile(profile: SourcePackageProfile): boolean {
  return profileIncludesNodeModules(profile);
}

export function excludePrefixesForProfile(profile: SourcePackageProfile): string[] {
  return profileIncludesNodeModules(profile) ? [] : ['node_modules/'];
}
