import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  APPLY_ORPHAN_WALK_ROOTS,
  isManagedApplyOrphanCandidate,
  isProtectedApplyResidualPath,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * 패키지에 없는 관리 대상 잔여 파일 삭제.
 * 최신소스 적용 commit 후·타입검사 스테이징(ZIP 오버레이 후)에서 동일 규칙으로 사용.
 */
export async function cleanupOrphanManagedFiles(params: {
  workspaceRoot: string;
  mergeRelSet: Set<string>;
  includeNodeModules: boolean;
  onLog?: (msg: string) => void;
}): Promise<number> {
  const { workspaceRoot, mergeRelSet, includeNodeModules, onLog } = params;
  let removed = 0;

  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(workspaceRoot, relDir) : workspaceRoot;
    if (!fsSync.existsSync(absDir)) return;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (isProtectedApplyResidualPath(relPath, includeNodeModules)) continue;
      if (entry.isDirectory()) {
        const asPrefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
        if (isProtectedApplyResidualPath(asPrefix, includeNodeModules)) continue;
        await walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isManagedApplyOrphanCandidate(relPath, includeNodeModules)) continue;
      if (mergeRelSet.has(relPath)) continue;
      try {
        await fs.rm(path.join(workspaceRoot, relPath), { force: true });
        removed += 1;
      } catch {
        /* skip locked */
      }
    }
  }

  for (const root of APPLY_ORPHAN_WALK_ROOTS) {
    const dir = root.replace(/\/$/, '');
    await walk(dir);
  }

  const rootEntries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    const relPath = normalizeSlashes(entry.name);
    if (!isManagedApplyOrphanCandidate(relPath, includeNodeModules)) continue;
    if (mergeRelSet.has(relPath)) continue;
    try {
      await fs.rm(path.join(workspaceRoot, relPath), { force: true });
      removed += 1;
    } catch {
      /* skip */
    }
  }

  onLog?.(`잔여 소스 정리 ${removed}건`);
  return removed;
}
