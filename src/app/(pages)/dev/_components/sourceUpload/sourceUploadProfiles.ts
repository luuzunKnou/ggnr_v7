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
  '.cad-preview-work/',
  'python/env/',
  'geoserver_modules/data_dir/logs/',
  'geoserver_modules/data_dir/gwc/',
];

const ALWAYS_EXCLUDE_EXACT = ['next-env.d.ts'];

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

export function packageProfileFromInclude(includeNodeModules: boolean): SourcePackageProfile {
  return includeNodeModules ? 'closed' : 'open';
}

export function includeNodeModulesFromProfile(profile: SourcePackageProfile): boolean {
  return profileIncludesNodeModules(profile);
}

export function excludePrefixesForProfile(profile: SourcePackageProfile): string[] {
  return profileIncludesNodeModules(profile) ? [] : ['node_modules/'];
}
