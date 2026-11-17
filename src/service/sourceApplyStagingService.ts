import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupOrphanManagedFiles } from '@/service/sourceApplyOrphanCleanup';
import { runWorkspaceTypeCheck } from '@/service/sourceBuildCheckService';

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function shouldSkipStagingCopyRel(relPath: string, excludePrefixes: string[]): boolean {
  const posixRel = normalizeSlashes(relPath);
  return excludePrefixes.some(
    (prefix) => posixRel === prefix.slice(0, -1) || posixRel.startsWith(prefix)
  );
}

/**
 * 타입검사 스테이징 전용 추가 제외 — live 병합 exclude 와 별도.
 * (주석에 글롭 별표-슬래시 조합을 넣지 말 것: 블록 주석이 중간에 닫힘)
 * tsc가 긁는 ts 파일 중 불필요한 대용량·바이너리·문서·런타임 산출물.
 * - geoserver_modules / python: 타입 검사 대상 아님 (요청)
 * - runtime: 번들 Node 런타임(node_modules 의 d.ts 다수)
 * - QCAD/Blender 모듈·미리보기·임시·정적 public 등
 * scripts/ 는 프로젝트 ts 스크립트가 있어 유지.
 */
const STAGING_ALWAYS_EXCLUDE = [
  'node_modules/',
  'geoserver_modules/',
  'python/',
  'docs/',
  'drizzle/',
  'coverage/',
  'out/',
  'build/',
  '.next/',
  '.git/',
  'nssm/',
  '.cursor/',
  '.cursor-runtime/',
  '.vscode/',
  '.tmp/',
  '.cad-preview-work/',
  'file_data/',
  'shp_data/',
  'excel_data/',
  'source_upload/',
  '3dtiles_las/',
  'tiles_tif/',
  'tiles_jpg/',
  '3dtiles_b3dm/',
  '3dtiles_pnts/',
  '3dtiles_obj/',
  '3dtiles_tiff/',
  'runtime/',
  'modules_blender/',
  'QCAD_modules/',
  'public/',
  'patches/',
  'temp/',
  'default/',
  'integrations/',
  'lib/',
] as const;

/** merge용 exclude + 스테이징 전용 제외를 합치고, node_modules 는 항상 제외 */
export function buildStagingExcludePrefixes(mergeExcludePrefixes: string[]): string[] {
  const set = new Set<string>();
  for (const p of mergeExcludePrefixes) {
    const n = normalizeSlashes(p.trim());
    if (!n) continue;
    set.add(n.endsWith('/') ? n : `${n}/`);
  }
  for (const p of STAGING_ALWAYS_EXCLUDE) {
    set.add(p);
  }
  return [...set];
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

type StagingLog = (line: string) => void;

const PROGRESS_EVERY_N = 2000;
const PROGRESS_EVERY_MS = 5000;

/**
 * fs.cp 유지 + filter에서 주기적 heartbeat.
 * 순회 복사·robocopy 미사용 (Windows 배포 · 동작 동일성 우선).
 */
function createCopyProgress(onLog?: StagingLog): {
  filterTick: (rel: string, included: boolean) => void;
  summary: () => { visited: number; included: number; elapsedSec: number };
} {
  let visited = 0;
  let included = 0;
  let lastLogAt = Date.now();
  let lastRel = '';
  const startedAt = Date.now();

  const maybeLog = () => {
    const now = Date.now();
    if (visited % PROGRESS_EVERY_N !== 0 && now - lastLogAt < PROGRESS_EVERY_MS) {
      return;
    }
    lastLogAt = now;
    const sec = Math.max(1, Math.round((now - startedAt) / 1000));
    onLog?.(
      `staging: 복사 진행 — 방문 ${visited}건 · 포함 ${included}건 · ${sec}초 · 최근 ${lastRel || '.'}`
    );
  };

  return {
    filterTick: (rel, isIncluded) => {
      visited += 1;
      if (isIncluded) included += 1;
      lastRel = rel || '.';
      maybeLog();
    },
    summary: () => ({
      visited,
      included,
      elapsedSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
    }),
  };
}

/** ZIP에 node_modules 있으면 그쪽, 없으면 live — Windows junction */
async function linkNodeModulesForStaging(params: {
  workspaceRoot: string;
  extractRoot: string;
  stagingRoot: string;
  onLog?: StagingLog;
}): Promise<void> {
  const { workspaceRoot, extractRoot, stagingRoot, onLog } = params;
  const extractNm = path.join(extractRoot, 'node_modules');
  const liveNm = path.join(workspaceRoot, 'node_modules');
  const target = (await pathExists(extractNm)) ? extractNm : liveNm;
  if (!(await pathExists(target))) {
    throw new Error(
      `타입 검사 스테이징 node_modules 없음 (extract·live 모두 없음): ${extractNm} / ${liveNm}`
    );
  }
  const nmTarget = path.join(stagingRoot, 'node_modules');
  const via = target === extractNm ? 'ZIP(extract)' : 'live';
  if (await pathExists(nmTarget)) {
    onLog?.('staging: node_modules 잔여 경로 제거 후 junction');
    await fs.rm(nmTarget, { recursive: true, force: true });
  }
  onLog?.(`staging: node_modules junction ← ${via}`);
  try {
    await fs.symlink(target, nmTarget, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`타입 검사 스테이징 node_modules 연결 실패: ${msg}`);
  }
}

function includeNodeModulesFromExcludePrefixes(excludePrefixes: string[]): boolean {
  return !excludePrefixes.some((p) => {
    const n = normalizeSlashes(p).replace(/\/+$/, '');
    return n === 'node_modules' || n.startsWith('node_modules/');
  });
}

/** 타입 검사용 스테이징: 워크스페이스 복제(제외 경로 생략) + ZIP 병합 오버레이 + 잔여 정리 */
export async function buildTypeCheckStagingRoot(params: {
  workspaceRoot: string;
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
  /** ZIP에 포함된 상대 경로 (잔여 소스 정리용). 없으면 extractRoot에서 재집계 */
  mergeRelPaths?: string[];
  onLog?: StagingLog;
}): Promise<void> {
  const { workspaceRoot, extractRoot, stagingRoot, onLog } = params;
  const stagingExcludes = buildStagingExcludePrefixes(params.excludePrefixes);
  onLog?.(
    `staging: 제외 ${stagingExcludes.length}개 (node_modules·geoserver_modules 등 항상 제외, junction으로 nm 연결)`
  );

  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });

  onLog?.('staging: 워크스페이스 복사 시작 (fs.cp · 진행 로그 주기적)');
  const progress = createCopyProgress(onLog);
  await fs.cp(workspaceRoot, stagingRoot, {
    recursive: true,
    force: true,
    filter: (src) => {
      const rel = normalizeSlashes(path.relative(workspaceRoot, src));
      if (!rel || rel === '.') {
        progress.filterTick('.', true);
        return true;
      }
      const skip = shouldSkipStagingCopyRel(
        rel.endsWith(path.sep) ? `${rel}/` : rel,
        stagingExcludes
      );
      const included = !skip;
      progress.filterTick(rel, included);
      return included;
    },
  });
  const done = progress.summary();
  onLog?.(
    `staging: 워크스페이스 복사 완료 — 방문 ${done.visited}건 · 포함 ${done.included}건 · ${done.elapsedSec}초`
  );

  onLog?.('staging: ZIP 오버레이 시작 (node_modules 등 스테이징 제외 동일)');
  const overlay = await overlayExtractOntoStaging({
    extractRoot,
    stagingRoot,
    excludePrefixes: stagingExcludes,
    onLog,
  });
  onLog?.(
    `staging: ZIP 오버레이 완료 — 파일 ${overlay.copied}건 · ${overlay.elapsedSec}초`
  );

  const mergeRelPaths =
    params.mergeRelPaths ??
    (await listExtractRelFiles(extractRoot, params.excludePrefixes));
  const includeNodeModules = includeNodeModulesFromExcludePrefixes(params.excludePrefixes);
  onLog?.('staging: 패키지에 없는 잔여 소스 정리 시작');
  const orphanRemoved = await cleanupOrphanManagedFiles({
    workspaceRoot: stagingRoot,
    mergeRelSet: new Set(mergeRelPaths.map(normalizeSlashes)),
    includeNodeModules,
    onLog: (msg) => onLog?.(`staging: ${msg}`),
  });
  onLog?.(`staging: 잔여 소스 정리 완료 — ${orphanRemoved}건`);

  await linkNodeModulesForStaging({
    workspaceRoot,
    extractRoot,
    stagingRoot,
    onLog,
  });
}

async function listExtractRelFiles(
  extractRoot: string,
  excludePrefixes: string[]
): Promise<string[]> {
  const out: string[] = [];
  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(extractRoot, relDir) : extractRoot;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (shouldSkipStagingCopyRel(relPath, excludePrefixes)) continue;
      if (entry.isDirectory()) {
        await walk(relPath);
        continue;
      }
      if (entry.isFile()) out.push(relPath);
    }
  }
  await walk('');
  return out;
}

async function overlayExtractOntoStaging(params: {
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
  onLog?: StagingLog;
}): Promise<{ copied: number; elapsedSec: number }> {
  const { extractRoot, stagingRoot, excludePrefixes, onLog } = params;
  let copied = 0;
  let lastLogAt = Date.now();
  const startedAt = Date.now();

  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(extractRoot, relDir) : extractRoot;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (shouldSkipStagingCopyRel(relPath, excludePrefixes)) continue;
      const dstPath = path.join(stagingRoot, relPath);
      if (entry.isDirectory()) {
        await fs.mkdir(dstPath, { recursive: true });
        await walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.copyFile(path.join(absDir, entry.name), dstPath);
      copied += 1;
      const now = Date.now();
      if (copied % PROGRESS_EVERY_N === 0 || now - lastLogAt >= PROGRESS_EVERY_MS) {
        lastLogAt = now;
        const sec = Math.max(1, Math.round((now - startedAt) / 1000));
        onLog?.(`staging: ZIP 오버레이 진행 — ${copied}건 · ${sec}초 · 최근 ${relPath}`);
      }
    }
  }

  await walk('');
  return {
    copied,
    elapsedSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
  };
}

export async function runStagingTypeCheck(params: {
  workspaceRoot: string;
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
  mergeRelPaths?: string[];
  onLine?: (line: string) => void;
}): Promise<{ ok: boolean; message: string }> {
  await buildTypeCheckStagingRoot({
    ...params,
    onLog: params.onLine,
  });
  params.onLine?.('staging: 타입 검사(tsc) 시작');
  const result = await runWorkspaceTypeCheck(params.stagingRoot, params.onLine);
  return { ok: result.ok, message: result.message };
}
