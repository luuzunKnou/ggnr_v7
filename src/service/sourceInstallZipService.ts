import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
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
import { createPythonEnvSplitParts } from '@/service/pythonEnvSplitZip';
import {
  completeInstallZipProgress,
  failInstallZipProgress,
  getInstallZipProgress,
  patchInstallZipProgress,
  setInstallZipPhase,
  setInstallZipScanProgress,
} from '@/service/sourceInstallZipProgress';
import { installZipHistoryOptions } from '@/lib/versionHistoryMessage';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

/**
 * 설치 ZIP 임시 루트.
 * path.join(os.tmpdir(), 'ggnr_source_install_download', …) 형태로 두면
 * Turbopack이 프로젝트 전체 글로브로 추적해 «Overly broad patterns» 경고가 난다.
 * leaf를 런타임에 이어 붙여 정적 경로 추적을 피한다.
 */
function installZipDownloadRoot(): string {
  const leaf = ['ggnr', 'source', 'install', 'download'].join('_');
  return [process.cwd(), '.tmp', leaf].join(path.sep);
}

function legacyOsTmpLeaf(leaf: string): string {
  return `${os.tmpdir()}${path.sep}${leaf}`;
}

/** 이전 C: TEMP·워크스페이스 .tmp 잔여 설치 ZIP/분할본 삭제 */
async function purgeStaleInstallTemps(): Promise<void> {
  const dirs = [
    installZipDownloadRoot(),
    [process.cwd(), '.tmp', ['ggnr', 'python', 'env', 'split'].join('_')].join(path.sep),
    legacyOsTmpLeaf(['ggnr', 'source', 'install', 'download'].join('_')),
    legacyOsTmpLeaf(['ggnr', 'python', 'env', 'split'].join('_')),
  ];
  for (const dir of dirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function formatInstallZipError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOSPC|no space left/i.test(raw)) {
    return '디스크 공간이 부족합니다. 설치 ZIP은 프로젝트 .tmp 에 만들며, 이전 임시 파일은 자동으로 지웁니다. C 드라이브 용량을 확보한 뒤 다시 시도하세요.';
  }
  return raw || '설치 ZIP 생성 실패';
}

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
}): Promise<{
  included: IncludedFile[];
  skipped: number;
  skippedPaths: string[];
  skippedTruncated: boolean;
}> {
  const includeNodeModules = includeNodeModulesFromProfile(params.profile);
  const mode: SourceUploadMode = 'install';
  const workspaceRoot = process.cwd();
  const included: IncludedFile[] = [];
  const skippedPaths: string[] = [];
  const SKIPPED_PATHS_CAP = 500;
  let skipped = 0;
  let skippedTruncated = false;
  let scanTicks = 0;

  const rememberSkipped = (rel: string) => {
    skipped += 1;
    if (skippedPaths.length < SKIPPED_PATHS_CAP) {
      skippedPaths.push(rel);
    } else {
      skippedTruncated = true;
    }
  };

  const pushScanProgress = () => {
    if (!params.progressId) return;
    setInstallZipScanProgress(params.progressId, {
      fileCount: included.length,
      skipped,
      skippedPaths: [...skippedPaths],
      skippedTruncated,
    });
  };

  async function walk(absDir: string): Promise<void> {
    const relDir = toPosixRelative(absDir, workspaceRoot);
    if (relDir && shouldSkipSourceDir(relDir, mode, includeNodeModules)) return;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const childAbs = path.join(absDir, entry.name);
      const childRel = toPosixRelative(childAbs, workspaceRoot);
      if (!childRel || childRel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        if (shouldSkipSourceDir(childRel, mode, includeNodeModules)) {
          rememberSkipped(`${childRel}/`);
        } else {
          await walk(childAbs);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldUploadSourcePath(childRel, mode, includeNodeModules)) {
        rememberSkipped(childRel);
      } else {
        included.push({
          absPath: childAbs,
          relPath: childRel,
          category: classifySourcePath(childRel),
        });
      }
      scanTicks += 1;
      if (params.progressId && scanTicks % 80 === 0) {
        pushScanProgress();
        await new Promise<void>((r) => setImmediate(r));
      }
    }
  }

  await walk(workspaceRoot);
  pushScanProgress();
  return { included, skipped, skippedPaths, skippedTruncated };
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
      if (!fsSync.existsSync(f.absPath)) continue;
      const level = archiverLevelForPath(f.relPath);
      // @types/archiver EntryData에 store/zlib이 빠져 있어 런타임 옵션만 전달
      archive.file(
        f.absPath,
        {
          name: `${bundleRoot}/${f.relPath}`,
          ...(level === 0 ? { store: true } : { zlib: { level } }),
        } as never
      );
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
  skippedCount: number;
  bundleRoot: string;
};

export async function buildInstallZip(params: {
  profile: SourcePackageProfile;
  progressId?: string;
}): Promise<BuildInstallZipResult> {
  const { profile, progressId } = params;
  const date = todayYmd();
  if (progressId) setInstallZipPhase(progressId, 'scan', '이전 임시 파일 정리 중...');
  await purgeStaleInstallTemps();
  if (progressId) setInstallZipPhase(progressId, 'scan', '설치 ZIP 스캔 중...');
  const scan = await scanInstallFiles({ profile, progressId });
  const files = [...scan.included];
  let envPartsTmp: string | null = null;
  try {
    if (progressId) {
      setInstallZipPhase(progressId, 'zip', '파이썬 환경 분할 압축 중...');
    }
    const split = await createPythonEnvSplitParts(process.cwd());
    if (split) {
      envPartsTmp = split.tmpDir;
      for (const part of split.parts) {
        files.push({
          absPath: part.absPath,
          relPath: part.relPath,
          category: 'runtime',
        });
      }
    }
    if (files.length === 0) throw new Error('설치 ZIP 대상 파일이 없습니다.');
    if (progressId) {
      setInstallZipScanProgress(progressId, {
        fileCount: files.length,
        skipped: scan.skipped,
        skippedPaths: scan.skippedPaths,
        skippedTruncated: scan.skippedTruncated,
        message: `스캔 완료 포함 ${files.length} / 제외 ${scan.skipped}`,
      });
      setInstallZipPhase(progressId, 'zip', `ZIP 생성 중 (${files.length}건)...`, {
        fileCount: files.length,
        scanSkipped: scan.skipped,
        scanSkippedPaths: scan.skippedPaths,
        scanSkippedTruncated: scan.skippedTruncated,
      });
    }
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const bundleRoot = `${date}_${stamp}`;
    const zipName = `source_install_${date}_${stamp}.zip`;
    const tmpDir = `${installZipDownloadRoot()}${path.sep}${stamp}`;
    const zipPath = `${tmpDir}${path.sep}${zipName}`;
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
      patchInstallZipProgress(progressId, {
        fileCount: files.length,
        scanSkipped: scan.skipped,
        scanSkippedPaths: scan.skippedPaths,
        scanSkippedTruncated: scan.skippedTruncated,
      });
    }
    return {
      zipPath,
      zipName,
      zipSize,
      fileCount: files.length,
      skippedCount: scan.skipped,
      bundleRoot,
    };
  } finally {
    if (envPartsTmp) {
      await fs.rm(envPartsTmp, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** progressId → zipPath (다운로드 연결용, 프로세스 메모리) */
const builtZipByProgressId = new Map<string, string>();

export function rememberBuiltInstallZip(progressId: string, zipPath: string): void {
  builtZipByProgressId.set(progressId, zipPath);
}

export function resolveBuiltInstallZipPath(progressId: string): string | undefined {
  return builtZipByProgressId.get(progressId);
}

async function findInstallZipByName(zipName: string): Promise<string | undefined> {
  const root = installZipDownloadRoot();
  const stampDirs = await fs.readdir(root).catch(() => [] as string[]);
  for (const stamp of stampDirs) {
    const candidate = `${root}${path.sep}${stamp}${path.sep}${zipName}`;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

/** 다운로드용 ZIP 절대경로 (메모리 Map → tmp 폴백) */
export async function resolveInstallZipForDownload(opts: {
  progressId?: string;
  zipName?: string;
}): Promise<string | undefined> {
  const progressId = opts.progressId?.trim() ?? '';
  const zipNameParam = opts.zipName?.trim() ?? '';
  if (progressId) {
    const fromMem = resolveBuiltInstallZipPath(progressId);
    if (fromMem) return fromMem;
    const progress = getInstallZipProgress(progressId);
    if (progress?.zipName) {
      const found = await findInstallZipByName(progress.zipName);
      if (found) return found;
    }
  }
  if (zipNameParam) return findInstallZipByName(zipNameParam);
  return undefined;
}

/** 다운로드 스트림 준비 (route에서 fs·path.join 직접 쓰지 않음 — Turbopack 추적 완화) */
export async function openInstallZipDownloadStream(zipPath: string): Promise<{
  fileName: string;
  size: number;
  webStream: ReadableStream;
  cleanup: () => void;
}> {
  const fileName = path.basename(zipPath);
  const { size } = await fs.stat(zipPath);
  const cleanup = scheduleInstallZipCleanup(zipPath);
  const nodeStream = fsSync.createReadStream(zipPath);
  nodeStream.on('close', cleanup);
  nodeStream.on('error', cleanup);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return { fileName, size, webStream, cleanup };
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
    message: params.message.trim(),
    option: installZipHistoryOptions(params.profile),
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
