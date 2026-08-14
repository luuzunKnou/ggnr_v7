import fs from 'node:fs/promises';
import path from 'node:path';
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

/** 타입 검사용 스테이징: 워크스페이스 복제(제외 경로 생략) + ZIP 병합 오버레이 */
export async function buildTypeCheckStagingRoot(params: {
  workspaceRoot: string;
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
}): Promise<void> {
  const { workspaceRoot, extractRoot, stagingRoot, excludePrefixes } = params;
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });

  await fs.cp(workspaceRoot, stagingRoot, {
    recursive: true,
    force: true,
    filter: (src) => {
      const rel = normalizeSlashes(path.relative(workspaceRoot, src));
      if (!rel || rel === '.') return true;
      return !shouldSkipStagingCopyRel(rel.endsWith(path.sep) ? `${rel}/` : rel, excludePrefixes);
    },
  });

  await overlayExtractOntoStaging({
    extractRoot,
    stagingRoot,
    excludePrefixes,
  });

  const mergeIncludesNodeModules = !excludePrefixes.some((p) => p === 'node_modules/');
  if (!mergeIncludesNodeModules) {
    const nmTarget = path.join(stagingRoot, 'node_modules');
    try {
      await fs.symlink(
        path.join(workspaceRoot, 'node_modules'),
        nmTarget,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`타입 검사 스테이징 node_modules 연결 실패: ${msg}`);
    }
  }
}

async function overlayExtractOntoStaging(params: {
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
}): Promise<void> {
  const { extractRoot, stagingRoot, excludePrefixes } = params;

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
    }
  }

  await walk('');
}

export async function runStagingTypeCheck(params: {
  workspaceRoot: string;
  extractRoot: string;
  stagingRoot: string;
  excludePrefixes: string[];
  onLine?: (line: string) => void;
}): Promise<{ ok: boolean; message: string }> {
  await buildTypeCheckStagingRoot(params);
  const result = await runWorkspaceTypeCheck(params.stagingRoot, params.onLine);
  return { ok: result.ok, message: result.message };
}
