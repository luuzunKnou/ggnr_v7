import type { SourceUploadCategory, SourceUploadMode } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

export type SourceScanSummary = {
  included: number;
  skipped: number;
  dbSql: number;
  dbReview: number;
  images: number;
  packages: number;
  schemaDbDiffCount: number;
  byCategory: Record<SourceUploadCategory, number>;
};

const SQL_SUFFIXES = ['.sql'];
const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
const DB_REVIEW_PREFIXES = [
  'src/database/',
  'scripts/db',
  'scripts/migrate',
  'drizzle/',
];

function normalizeRelPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function hasSuffix(p: string, suffixes: string[]): boolean {
  const lower = p.toLowerCase();
  return suffixes.some((s) => lower.endsWith(s));
}

function isDbReviewPath(p: string): boolean {
  return DB_REVIEW_PREFIXES.some((prefix) => p.startsWith(prefix)) && !hasSuffix(p, SQL_SUFFIXES);
}

export function createEmptyScanSummary(): SourceScanSummary {
  return {
    included: 0,
    skipped: 0,
    dbSql: 0,
    dbReview: 0,
    images: 0,
    packages: 0,
    schemaDbDiffCount: 0,
    byCategory: { core: 0, runtime: 0, data: 0 },
  };
}

export function bumpScanSummary(
  summary: SourceScanSummary,
  params: {
    relPath: string;
    included: boolean;
    category?: SourceUploadCategory;
    mode: SourceUploadMode;
  }
): void {
  const p = normalizeRelPath(params.relPath);
  if (params.included) {
    summary.included += 1;
    const cat = params.category ?? 'core';
    summary.byCategory[cat] += 1;
    if (hasSuffix(p, SQL_SUFFIXES)) summary.dbSql += 1;
    if (isDbReviewPath(p)) summary.dbReview += 1;
    if (hasSuffix(p, IMAGE_SUFFIXES)) summary.images += 1;
    if (p.startsWith('node_modules/') || p.includes('/node_modules/')) summary.packages += 1;
  } else {
    summary.skipped += 1;
    if (p.startsWith('node_modules/') || p.includes('/node_modules/')) summary.packages += 1;
  }
}

export function formatScanDetail(summary: SourceScanSummary, currentPath?: string): string {
  const parts = [
    `포함 ${summary.included}`,
    `제외 ${summary.skipped}`,
    `DB(SQL) ${summary.dbSql}`,
    `DB(확인 필요) ${summary.dbReview}`,
    `이미지 ${summary.images}`,
    `패키지 ${summary.packages}`,
  ];
  if (summary.schemaDbDiffCount > 0) {
    parts.push(`스키마 SQL ↔ DB 차이 ${summary.schemaDbDiffCount}건`);
  }
  if (currentPath) {
    const short = currentPath.length > 40 ? `...${currentPath.slice(-37)}` : currentPath;
    parts.push(short);
  }
  return parts.join(' · ');
}

/** 단계 호버·로그용 — 실제 제외 경로 목록 (길면 자름) */
export function formatSkippedPathsTitle(
  paths: string[] | undefined,
  options?: { truncated?: boolean; totalSkipped?: number; maxLines?: number }
): string | undefined {
  if (!paths?.length) {
    const n = options?.totalSkipped ?? 0;
    return n > 0 ? `제외 ${n}건 (경로 목록 없음)` : undefined;
  }
  const maxLines = options?.maxLines ?? 40;
  const head = paths.slice(0, maxLines);
  const lines = [...head];
  const remain = Math.max(0, (options?.totalSkipped ?? paths.length) - head.length);
  if (remain > 0 || options?.truncated) {
    lines.push(`…외 ${remain > 0 ? remain : '다수'}건`);
  }
  return lines.join('\n');
}
