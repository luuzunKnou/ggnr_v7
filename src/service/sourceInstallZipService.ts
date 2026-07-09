import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import archiver from 'archiver';
import {
  classifySourcePath,
  includeNodeModulesFromProfile,
  shouldSkipSourceDir,
  shouldUploadSourcePath,
  type SourcePackageProfile,
  type SourceUploadMode,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { archiverLevelForPath } from '@/service/sourceInstallZipCompression';
import {
  completeInstallZipProgress,
  failInstallZipProgress,
  setInstallZipPhase,
  setInstallZipScanProgress,
} from '@/service/sourceInstallZipProgress';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

type IncludedFile = {
  absPath: string;
  relPath: string;
  category: 'core' | 'runtime' | 'data';
};

function toPosixRelative(absPath: string, root: string): string {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type InstallZipInfo = {
  workspaceRoot: string;
  hostname: string;
  nodeVersion?: string;
  mode: SourceUploadMode;
  packageProfile: SourcePackageProfile;
  includeNodeModules: boolean;
};

export async function getInstallZipInfo(profile: SourcePackageProfile): Promise<InstallZipInfo> {
  const includeNodeModules = includeNodeModulesFromProfile(profile);
  return {
    workspaceRoot: process.cwd(),
    hostname: os.hostname(),
    nodeVersion: process.version,
    mode: 'install',
    packageProfile: profile,
    includeNodeModules,
  };
}

async function scanInstallFiles(params: {
  profile: SourcePackageProfile;
  progressId?: string;
}): Promise<IncludedFile[]> {
  const includeNodeModules = includeNodeModulesFromProfile(params.profile);
  const mode: SourceUploadMode = 'install';
  const workspaceRoot = process.cwd();
  const included: IncludedFile[] = [];

  async function walk(absDir: string): Promise<void> {
    const relDir = toPosixRelative(absDir, workspaceRoot);
    if (relDir && shouldSkipSourceDir(relDir, mode, includeNodeModules)) return;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const childAbs = path.join(absDir, entry.name);
      const childRel = toPosixRelative(childAbs, workspaceRoot);
      if (!childRel || childRel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        if (!shouldSkipSourceDir(childRel, mode, includeNodeModules)) await walk(childAbs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldUploadSourcePath(childRel, mode, includeNodeModules)) continue;
      included.push({
        absPath: childAbs,
        relPath: childRel,
        category: classifySourcePath(childRel),
      });
      if (params.progressId && included.length % 200 === 0) {
        setInstallZipScanProgress(params.progressId, { fileCount: included.length });
      }
    }
  }

  await walk(workspaceRoot);
  return included;
}

async function buildInstallZipFile(params: {
  files: IncludedFile[];
  zipPath: string;
  bundleRoot: string;
  mode: SourceUploadMode;
  date: string;
  workspaceRoot: string;
  profile: SourcePackageProfile;
  progressId?: string;
}): Promise<void> {
  const { files, zipPath, bundleRoot, mode, date, workspaceRoot, profile, progressId } = params;
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  const total = files.length + 1;
  let processed = 0;

  await new Promise<void>((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('entry', () => {
      processed += 1;
      if (progressId && (processed === 1 || processed % 50 === 0 || processed >= total)) {
        setInstallZipPhase(progressId, 'zip', `ZIP ${processed}/${total}`, {
          progressPct: Math.min(85, 25 + Math.round((processed / total) * 60)),
        });
      }
    });
    archive.pipe(output);
    for (const f of files) {
      archive.file(f.absPath, {
        name: `${bundleRoot}/${f.relPath}`,
        store: archiverLevelForPath(f.relPath) === 0,
      });
    }
    const metaText = [
      `date=${date}`,
      `mode=${mode}`,
      `packageProfile=${profile}`,
      `workspaceRoot=${workspaceRoot}`,
      `includedFileCount=${files.length}`,
      `generatedAt=${new Date().toISOString()}`,
      '',
    ].join('\n');
    archive.append(metaText, { name: `${bundleRoot}/_upload_meta.txt` });
    archive.finalize().catch(reject);
  });
}

export type BuildInstallZipResult = {
  zipPath: string;
  zipName: string;
  zipSize: number;
  fileCount: number;
  bundleRoot: string;
};

export async function buildInstallZip(params: {
  profile: SourcePackageProfile;
  progressId?: string;
}): Promise<BuildInstallZipResult> {
  const { profile, progressId } = params;
  const date = todayYmd();
  if (progressId) setInstallZipPhase(progressId, 'scan', '설치 ZIP 스캔 중...');
  const files = await scanInstallFiles({ profile, progressId });
  if (files.length === 0) throw new Error('설치 ZIP 대상 파일이 없습니다.');
  if (progressId) {
    setInstallZipScanProgress(progressId, { fileCount: files.length, message: `스캔 완료 ${files.length}건` });
    setInstallZipPhase(progressId, 'zip', `ZIP 생성 중 (${files.length}건)...`, { fileCount: files.length });
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const bundleRoot = `${date}_${stamp}`;
  const zipName = `source_install_${date}_${stamp}.zip`;
  const tmpDir = path.join(os.tmpdir(), 'ggnr_source_install_download', stamp);
  const zipPath = path.join(tmpDir, zipName);
  await buildInstallZipFile({
    files,
    zipPath,
    bundleRoot,
    mode: 'install',
    date,
    workspaceRoot: process.cwd(),
    profile,
    progressId,
  });
  const zipSize = (await fs.stat(zipPath)).size;
  if (progressId) {
    rememberBuiltInstallZip(progressId, zipPath);
    completeInstallZipProgress(progressId, 'ZIP 생성 완료', zipName, zipSize);
  }
  return { zipPath, zipName, zipSize, fileCount: files.length, bundleRoot };
}

/** progressId → zipPath (다운로드 연결용, 프로세스 메모리) */
const builtZipByProgressId = new Map<string, string>();

export function rememberBuiltInstallZip(progressId: string, zipPath: string): void {
  builtZipByProgressId.set(progressId, zipPath);
}

export function resolveBuiltInstallZipPath(progressId: string): string | undefined {
  return builtZipByProgressId.get(progressId);
}

export async function recordInstallZipHistory(params: {
  ok: boolean;
  message: string;
  ip?: string;
  clientHost?: string;
  profile: SourcePackageProfile;
}): Promise<void> {
  await recordVersionHistory({
    historyType: 'install_zip',
    status: params.ok ? 'success' : 'fail',
    message: `${params.profile === 'closed' ? '폐쇄망' : '개방망'} — ${params.message}`,
    ip: params.ip,
    clientHost: params.clientHost,
  });
}

/** 다운로드 후 임시 폴더 정리용 */
export function scheduleInstallZipCleanup(zipPath: string): () => void {
  const tmpDir = path.dirname(zipPath);
  return () => {
    void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };
}

export function failInstallZipBuild(progressId: string | undefined, error: string): void {
  if (progressId) failInstallZipProgress(progressId, error);
}
