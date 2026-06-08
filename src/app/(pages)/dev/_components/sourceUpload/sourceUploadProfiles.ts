export type SourceUploadCategory = 'core' | 'runtime' | 'data';
export type SourceUploadMode = 'install' | 'update';

/**
 * 모드와 무관하게 항상 업로드에서 제외할 "경로 prefix" 목록.
 * - 용량이 크거나 재생성 가능한 산출물
 * - IDE/패키지 캐시/빌드 결과물
 * - 런타임 로그·캐시 디렉터리
 *
 * 주의: `node_modules/`는 설치(install) 모드에서 대상 서버 구동에 필요하므로
 * 여기서 제외하지 않고, `MODE_EXCLUDE_PREFIXES.update`에서만 제외한다.
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

/** 모드와 무관하게 항상 제외할 "정확한 파일명" 목록. */
const ALWAYS_EXCLUDE_EXACT = [
  'next-env.d.ts',
];

/**
 * 경로 분류 시 runtime 카테고리로 간주할 prefix.
 * (업데이트 모드에서 기본 제외되는 대상)
 */
const RUNTIME_PREFIXES = [
  'scripts/',
  'src/config/projects/',
  'geoserver_modules/scripts/',
];

/**
 * 경로 분류 시 data 카테고리로 간주할 prefix.
 * (모드별 업로드 허용 정책에서 별도 판단)
 */
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

/**
 * update 모드에서 data 카테고리 중 업로드 허용할 prefix.
 * 현재는 geoserver data_dir만 허용.
 */
const UPDATE_DATA_ALLOW_PREFIXES = ['geoserver_modules/data_dir/'];

/**
 * 모드별 추가 제외 prefix.
 * - install: 구동 필수 번들(node_modules 포함)도 포함해야 하므로 추가 제외 없음
 * - update: 무거운 실행 바이너리/서비스 번들 및 의존성 디렉터리는 제외
 */
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

export function isExcludedSourcePath(relativePath: string, mode: SourceUploadMode): boolean {
  const p = normalizeRelPath(relativePath);
  if (!p) return true;
  if (ALWAYS_EXCLUDE_EXACT.includes(p)) return true;
  if (p.endsWith('.log')) return true;
  if (hasAnyPrefix(p, ALWAYS_EXCLUDE_PREFIXES)) return true;
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

export function shouldUploadSourcePath(relativePath: string, mode: SourceUploadMode): boolean {
  const p = normalizeRelPath(relativePath);
  if (isExcludedSourcePath(p, mode)) return false;
  const category = classifySourcePath(p);
  if (mode === 'install') return true;
  if (category === 'runtime') return false;
  if (category === 'data') return hasAnyPrefix(p, UPDATE_DATA_ALLOW_PREFIXES);
  return true;
}

export function shouldSkipSourceDir(relativeDir: string, mode: SourceUploadMode): boolean {
  const p = normalizeRelPath(relativeDir);
  if (!p) return false;
  const dir = p.endsWith('/') ? p : `${p}/`;
  return hasAnyPrefix(dir, ALWAYS_EXCLUDE_PREFIXES) || hasAnyPrefix(dir, MODE_EXCLUDE_PREFIXES[mode]);
}

