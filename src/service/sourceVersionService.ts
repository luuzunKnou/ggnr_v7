import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { resolveAppStartCommand, pickBootForSignalMerge } from '@/lib/ggnrBootCommand';
import { applyLatestHistoryOptions } from '@/lib/versionHistoryMessage';
import { ensureGeoServerRunning, stopGeoServerAndVerify } from '@/service/geoserverProcessService';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';
import {
  APPLY_ORPHAN_WALK_ROOTS,
  isManagedApplyOrphanCandidate,
  isProtectedApplyResidualPath,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';

const GEOSERVER_STOP_SETTLE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** UI·API 공용. 옛 command/startB 는 normalizeRestartMode 에서 exit 로 합침 */
export type RestartMode = 'none' | 'exit' | 'launcher';

/** 레거시 command·startB·nodeWatch → exit */
export function normalizeRestartMode(value: unknown): RestartMode {
  if (value === 'launcher') return 'launcher';
  if (value === 'none') return 'none';
  if (
    value === 'exit' ||
    value === 'command' ||
    value === 'startB' ||
    value === 'nodeWatch'
  ) {
    return 'exit';
  }
  return 'none';
}

/**
 * 구동 시 기록된 명령(restart-request.json boot / GGNR_RUN_SCRIPT)을 재사용.
 * .env의 GGNR_RESTART_COMMAND는 사용하지 않음.
 */
export function resolveRestartCommand(): string {
  const project = process.env.GGNR_PROJECT?.trim() ?? '';
  const type = process.env.GGNR_ENV?.trim() ?? '';
  if (!project || !type) return '';
  return resolveAppStartCommand(project, type);
}

export function isRestartCommandConfigured(): boolean {
  const project = process.env.GGNR_PROJECT?.trim() ?? '';
  const type = process.env.GGNR_ENV?.trim() ?? '';
  return Boolean(project && type);
}

const LAUNCHER_MISSING_MSG =
  '구동 프로젝트/타입이 없어 Node 런처 재시작을 쓸 수 없습니다. npm run dev|start -- <project> <type> 으로 기동하세요.';

export function buildApplySuccessHistoryMessage(opts: {
  /** 이력 버전 컬럼용. 본문에는 넣지 않음 */
  version: string;
  mode: RestartMode;
  command: string;
  appliedFiles: number;
  skippedFiles: number;
  netLabel: string;
  geoserverMsg: string;
}): string {
  void opts.version;
  const command = opts.command.trim() || '-';
  return `mode=${opts.mode} / command=${command} / 적용 ${opts.appliedFiles}건 / 제외 ${opts.skippedFiles}건 / ${opts.netLabel} / GeoServer: ${opts.geoserverMsg}`;
}

function spawnInheritAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function runNpmInstallAsyncInProcess(): Promise<void> {
  console.log('[SourceCodeUpload] npm install 시작 (사전·개방망)');
  await spawnInheritAsync('npm', ['install', '--no-audit', '--no-fund']);
  console.log('[SourceCodeUpload] npm install 완료');
}

async function runNpmBuildAsyncInProcess(): Promise<void> {
  console.log('[SourceCodeUpload] 사전 빌드 시작');
  await spawnInheritAsync('npm', ['run', 'build']);
  console.log('[SourceCodeUpload] 사전 빌드 완료');
}

export type ApplyLatestSourceOptions = {
  requestedBy: string;
  clientIp?: string;
  restart: boolean;
  restartMode: RestartMode;
};

export type GeoServerApplyStep = {
  stopped: boolean;
  started: boolean;
  /** 재시작 시 기동을 run.ts에 맡김(적용 경로 기동 생략) */
  deferredStart?: boolean;
  message: string;
  stopMessage?: string;
  startMessage?: string;
};

export type ApplyLatestSourceResult = {
  gnmsBaseUrl: string;
  latestUrl: string;
  downloadUrl: string;
  version: string;
  fileName: string;
  downloadedBytes: number;
  extractedRoot: string;
  appliedFiles: number;
  skippedFiles: number;
  skippedSamples: string[];
  geoserver: GeoServerApplyStep;
  restart: {
    requested: boolean;
    mode: RestartMode;
    commandConfigured: boolean;
    scheduled: boolean;
    signalFile: string;
    message: string;
  };
};

type GnmsLatestPayload = {
  version?: string;
  fileName?: string;
  downloadUrl?: string;
  checksumSha256?: string;
};

const DEFAULT_EXCLUDE_PREFIXES = [
  '.git/',
  '.next/',
  'node_modules/',
  '.cursor/',
  '.vscode/',
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
  'coverage/',
  'out/',
  'build/',
];

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function parseExcludePrefixes(includeNodeModules = true): string[] {
  const raw = process.env.GGNR_SOURCE_UPDATE_EXCLUDE_PREFIXES?.trim();
  let prefixes = raw
    ? raw
        .split(',')
        .map((x) => normalizeSlashes(x.trim()))
        .filter(Boolean)
        .map((x) => (x.endsWith('/') ? x : `${x}/`))
    : [...DEFAULT_EXCLUDE_PREFIXES];
  if (includeNodeModules) {
    prefixes = prefixes.filter((p) => p !== 'node_modules/');
  } else if (!prefixes.includes('node_modules/')) {
    prefixes.push('node_modules/');
  }
  return prefixes;
}

function shouldSkipRelPath(relPath: string, excludePrefixes: string[]): boolean {
  const posixRel = normalizeSlashes(relPath);
  return excludePrefixes.some((prefix) => posixRel === prefix.slice(0, -1) || posixRel.startsWith(prefix));
}

type ApplyRollbackSnapshot = {
  root: string;
  filesDir: string;
  backedUp: string[];
  created: string[];
  nextDir: string | null;
  nodeModulesDir: string | null;
};

async function listMergeRelFiles(
  srcRoot: string,
  excludePrefixes: string[]
): Promise<string[]> {
  const out: string[] = [];
  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(srcRoot, relDir) : srcRoot;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (shouldSkipRelPath(relPath, excludePrefixes)) continue;
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

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  await fs.cp(src, dst, { recursive: true, force: true });
}

async function createSourceRollbackSnapshot(params: {
  workspaceRoot: string;
  mergeRelPaths: string[];
  includeNodeModules: boolean;
  /** false면 .next 통째 복사 생략 (재시작·사전 빌드 경로) */
  includeNext?: boolean;
}): Promise<ApplyRollbackSnapshot> {
  const { workspaceRoot, mergeRelPaths, includeNodeModules, includeNext = true } = params;
  const root = path.join(os.tmpdir(), 'ggnr_source_rollback', `${Date.now()}`);
  const filesDir = path.join(root, 'files');
  await fs.mkdir(filesDir, { recursive: true });

  const backedUp: string[] = [];
  const created: string[] = [];

  for (const rel of mergeRelPaths) {
    if (isProtectedApplyResidualPath(rel, includeNodeModules)) continue;
    const abs = path.join(workspaceRoot, rel);
    if (fsSync.existsSync(abs) && fsSync.statSync(abs).isFile()) {
      const dest = path.join(filesDir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(abs, dest);
      backedUp.push(rel);
    } else {
      created.push(rel);
    }
  }

  let nextDir: string | null = null;
  if (includeNext) {
    const nextAbs = path.join(workspaceRoot, '.next');
    if (fsSync.existsSync(nextAbs)) {
      nextDir = path.join(root, 'next');
      await copyDirRecursive(nextAbs, nextDir);
    }
  }

  return {
    root,
    filesDir,
    backedUp,
    created,
    nextDir,
    nodeModulesDir: null,
  };
}

async function snapshotNodeModulesInto(
  snapshot: ApplyRollbackSnapshot,
  workspaceRoot: string
): Promise<void> {
  const nmAbs = path.join(workspaceRoot, 'node_modules');
  if (!fsSync.existsSync(nmAbs)) return;
  const dest = path.join(snapshot.root, 'node_modules');
  await copyDirRecursive(nmAbs, dest);
  snapshot.nodeModulesDir = dest;
}

async function restoreApplyRollbackSnapshot(params: {
  snapshot: ApplyRollbackSnapshot;
  workspaceRoot: string;
  includeNodeModules: boolean;
}): Promise<{ ok: boolean; detail: string }> {
  const { snapshot, workspaceRoot, includeNodeModules } = params;
  const errors: string[] = [];

  for (const rel of snapshot.backedUp) {
    try {
      const src = path.join(snapshot.filesDir, rel);
      const dst = path.join(workspaceRoot, rel);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
    } catch (e) {
      errors.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const rel of snapshot.created) {
    if (isProtectedApplyResidualPath(rel, includeNodeModules)) continue;
    try {
      const abs = path.join(workspaceRoot, rel);
      if (fsSync.existsSync(abs)) await fs.rm(abs, { force: true });
    } catch (e) {
      errors.push(`삭제 ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const nextAbs = path.join(workspaceRoot, '.next');
  try {
    if (snapshot.nextDir && fsSync.existsSync(snapshot.nextDir)) {
      await fs.rm(nextAbs, { recursive: true, force: true }).catch(() => {});
      await copyDirRecursive(snapshot.nextDir, nextAbs);
    }
  } catch (e) {
    errors.push(`.next: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (snapshot.nodeModulesDir && fsSync.existsSync(snapshot.nodeModulesDir)) {
    try {
      const nmAbs = path.join(workspaceRoot, 'node_modules');
      await fs.rm(nmAbs, { recursive: true, force: true }).catch(() => {});
      await copyDirRecursive(snapshot.nodeModulesDir, nmAbs);
    } catch (e) {
      errors.push(`node_modules: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length === 0) {
    return { ok: true, detail: '롤백 완료' };
  }
  return {
    ok: false,
    detail: `롤백 실패(${errors.length}건): ${errors.slice(0, 3).join('; ')}`,
  };
}

async function removeApplyRollbackSnapshot(snapshot: ApplyRollbackSnapshot | null): Promise<void> {
  if (!snapshot) return;
  await fs.rm(snapshot.root, { recursive: true, force: true }).catch(() => {});
}

async function cleanupOrphanManagedFiles(params: {
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

  /** 루트 단일 파일 */
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

export type GnmsClientConfig = {
  gnmsBaseUrl: string;
  latestUrl: string;
  listUrl: string;
  downloadUrlFallback: string;
  cancelUrl: string;
  bearer: string;
};

/** 브라우저가 GNMS에 직접 요청할 때 쓸 URL·토큰 (폐쇄망 중계, CORS 허용 전제) */
export function getGnmsClientConfig(): GnmsClientConfig {
  const gnmsBaseUrl =
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BASE_URL?.trim() ||
    process.env.GNMS_SOURCE_BASE_URL?.trim() ||
    'http://192.168.126.1:3000/api/source/version';
  const latestPath = process.env.GNMS_SOURCE_LATEST_PATH?.trim() ?? '/latest';
  const listPath = process.env.GNMS_SOURCE_LIST_PATH?.trim() ?? '/list';
  const downloadPath = process.env.GNMS_SOURCE_DOWNLOAD_PATH?.trim() ?? '/download/latest';
  const cancelPath = process.env.GNMS_SOURCE_CANCEL_PATH?.trim() ?? '/cancel';
  const bearer =
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BEARER?.trim() ||
    process.env.GNMS_SOURCE_BEARER?.trim() ||
    '';
  return {
    gnmsBaseUrl,
    latestUrl: resolveGnmsApiUrl(gnmsBaseUrl, latestPath),
    listUrl: resolveGnmsApiUrl(gnmsBaseUrl, listPath),
    downloadUrlFallback: resolveGnmsApiUrl(gnmsBaseUrl, downloadPath),
    cancelUrl: resolveGnmsApiUrl(gnmsBaseUrl, cancelPath),
    bearer,
  };
}

/** 적용 중 UI 단계 보고 */
export type ApplySourceProgressPhase =
  | 'geoserver-stop'
  | 'merge-apply'
  | 'geoserver-start'
  | 'npm-install'
  | 'build'
  | 'app-stop';

export type ApplySourceProgressEvent = {
  phase: ApplySourceProgressPhase;
  message: string;
  /** UI 실시간 로그에 남길 한 줄 (서버 [SourceCodeUpload] 와 동기) */
  logLine?: string;
  /** 병합 복사 진행 */
  appliedFiles?: number;
  skippedFiles?: number;
  totalFiles?: number;
};

export type ApplySourceZipOptions = {
  zipPath: string;
  version: string;
  fileName: string;
  requestedBy: string;
  /** 브라우저·요청에서 확정한 클라이언트 IPv4 (이력 mvh_ip) */
  clientIp?: string;
  restart: boolean;
  restartMode: RestartMode;
  /** false=개방망(node_modules 제외), true=폐쇄망(포함) */
  includeNodeModules?: boolean;
  /** 단계별 진행 콜백 (중지·병합·기동 분리) */
  onProgress?: (event: ApplySourceProgressEvent) => void | Promise<void>;
};

export type ApplySourceZipResult = Omit<
  ApplyLatestSourceResult,
  'gnmsBaseUrl' | 'latestUrl' | 'downloadUrl'
>;

/** ZIP 파일 경로 기준 워크스페이스 적용 (GNMS fetch 없음) */
export async function applySourceZipFile(options: ApplySourceZipOptions): Promise<ApplySourceZipResult> {
  const {
    zipPath,
    version,
    fileName,
    requestedBy,
    clientIp,
    restart,
    restartMode: restartModeRaw,
    includeNodeModules = true,
    onProgress,
  } = options;

  const restartMode = normalizeRestartMode(restart ? restartModeRaw : 'none');
  const doRestart = restartMode !== 'none';

  if (doRestart && restartMode === 'launcher' && !isRestartCommandConfigured()) {
    throw new Error(LAUNCHER_MISSING_MSG);
  }

  const workspaceRoot = process.cwd();
  const stat = await fs.stat(zipPath);
  const tmpBase = path.join(os.tmpdir(), 'ggnr_source_update', `${Date.now()}`);
  const extractDir = path.join(tmpBase, 'extracted');
  const bootCommand = resolveAppStartCommand() || resolveRestartCommand();

  let geoStartedOnSuccessPath = false;
  let rollback: ApplyRollbackSnapshot | null = null;
  let mergeRelPaths: string[] = [];

  const emit = async (
    phase: ApplySourceProgressPhase,
    message: string,
    extra?: Partial<ApplySourceProgressEvent>
  ) => {
    const logLine = extra?.logLine ?? `[SourceCodeUpload] ${message}`;
    console.log(logLine);
    await onProgress?.({ phase, message, logLine, ...extra });
  };

  const runRollback = async (reason: string): Promise<string> => {
    if (!rollback) return `${reason} (롤백 스냅샷 없음)`;
    await emit('merge-apply', '적용 실패 — 직전 소스로 롤백 중...');
    const result = await restoreApplyRollbackSnapshot({
      snapshot: rollback,
      workspaceRoot,
      includeNodeModules,
    });
    await removeApplyRollbackSnapshot(rollback);
    rollback = null;
    return `${reason} / ${result.detail}`;
  };

  await emit(
    'geoserver-stop',
    `적용 시작 version=${version} mode=${restartMode} net=${includeNodeModules ? '폐쇄망' : '개방망'}`
  );

  try {
    await onProgress?.({ phase: 'geoserver-stop', message: 'GeoServer 중지 중...' });
    const stopResult = await stopGeoServerAndVerify({ settleMs: GEOSERVER_STOP_SETTLE_MS });
    await emit('geoserver-stop', `GeoServer ${stopResult.message}`);

    await onProgress?.({ phase: 'merge-apply', message: '소스 병합·적용 중...' });
    await emit('merge-apply', 'ZIP 압축 해제 시작');
    await extractZip(zipPath, extractDir);
    const extractedRoot = await pickExtractedRoot(extractDir);
    await emit('merge-apply', 'ZIP 압축 해제 완료');

    const excludePrefixes = parseExcludePrefixes(includeNodeModules);
    await emit('merge-apply', '병합 대상 파일 수 집계 중...');
    mergeRelPaths = await listMergeRelFiles(extractedRoot, excludePrefixes);
    const { totalFiles, skippedFiles: preSkipped } = await countCopyTargets(
      extractedRoot,
      excludePrefixes
    );
    await emit('merge-apply', `병합 대상 ${totalFiles}건 (제외 예정 ${preSkipped}건)`, {
      totalFiles,
      skippedFiles: preSkipped,
      appliedFiles: 0,
    });

    await emit('merge-apply', '적용 직전 소스 백업 중...');
    rollback = await createSourceRollbackSnapshot({
      workspaceRoot,
      mergeRelPaths,
      includeNodeModules,
      includeNext: !doRestart,
    });
    const nextLabel = doRestart
      ? '생략(재시작·빌드)'
      : rollback.nextDir
        ? '포함'
        : '없음';
    await emit(
      'merge-apply',
      `백업 완료 (파일 ${rollback.backedUp.length}건, 신규 ${rollback.created.length}건, .next ${nextLabel})`
    );

    const copyResult = await copyRecursive({
      srcRoot: extractedRoot,
      dstRoot: workspaceRoot,
      excludePrefixes,
      totalFiles,
      onProgress: (p) => {
        const pct =
          p.totalFiles > 0 ? Math.min(100, Math.round((p.appliedFiles / p.totalFiles) * 100)) : 0;
        const msg = `병합 진행 ${p.appliedFiles}/${p.totalFiles} (${pct}%) · 제외 ${p.skippedFiles}`;
        void emit('merge-apply', msg, {
          appliedFiles: p.appliedFiles,
          skippedFiles: p.skippedFiles,
          totalFiles: p.totalFiles,
        });
      },
    });
    await emit(
      'merge-apply',
      `파일 복사 완료 applied=${copyResult.appliedFiles} skipped=${copyResult.skippedFiles}`,
      {
        appliedFiles: copyResult.appliedFiles,
        skippedFiles: copyResult.skippedFiles,
        totalFiles,
      }
    );

    const signalFile = path.join(workspaceRoot, '.cursor-runtime', 'restart-request.json');

    const stopMessage = stopResult.message;
    let startMessage: string | undefined;
    let started = false;
    /** 병합 후 재시작 여부와 관계없이 기동. run.ts ensure는 이중 안전망 */
    await onProgress?.({ phase: 'geoserver-start', message: 'GeoServer 기동 중...' });
    let startResult = await ensureGeoServerRunning({ forceRestart: false });
    if (!startResult.success) {
      await sleep(2000);
      startResult = await ensureGeoServerRunning({ forceRestart: true });
    }
    geoStartedOnSuccessPath = startResult.success;
    started = startResult.success;
    startMessage = startResult.success
      ? startResult.action === 'already-ready'
        ? '기동 OK(이미 응답)'
        : startResult.action === 'restarted'
          ? '기동 OK(재기동·응답)'
          : '기동 OK(응답)'
      : `기동 실패: ${startResult.error ?? 'unknown'}`;
    await emit('geoserver-start', `GeoServer ${startMessage}`);

    const geoserver: GeoServerApplyStep = {
      stopped: stopResult.success,
      started,
      deferredStart: false,
      message: `${stopMessage} / ${startMessage}`,
      stopMessage,
      startMessage,
    };

    const netLabel = includeNodeModules ? '폐쇄망' : '개방망';
    const ipTrim = clientIp?.trim() || undefined;
    const historyOption = applyLatestHistoryOptions(includeNodeModules, restartMode);
    const successMessage = buildApplySuccessHistoryMessage({
      version,
      mode: restartMode,
      command: bootCommand,
      appliedFiles: copyResult.appliedFiles,
      skippedFiles: copyResult.skippedFiles,
      netLabel,
      geoserverMsg: `${stopMessage}; ${startMessage}`,
    });

    /** exit·launcher: 서버 가동 중 사전 install(개방망)·빌드. 실패 시 롤백 후 종료하지 않음 */
    if (doRestart && (restartMode === 'exit' || restartMode === 'launcher')) {
      try {
        if (!includeNodeModules && rollback) {
          await emit('npm-install', 'node_modules 백업 중...');
          await snapshotNodeModulesInto(rollback, workspaceRoot);
          await emit('npm-install', 'npm install (개방망) 시작');
          await runNpmInstallAsyncInProcess();
          await emit('npm-install', 'npm install 완료');
        }
        await emit('build', '사전 빌드 시작');
        await runNpmBuildAsyncInProcess();
        await emit('build', '사전 빌드 완료');
      } catch (buildErr: unknown) {
        const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
        throw new Error(`사전 빌드 실패 (version=${version}): ${msg}`);
      }
    }

    /** 사전 빌드 완료분 — 재기동 후행 install/build 없음. GeoServer는 위에서 기동·run.ts ensure */
    const runNpmInstallBefore = false;
    const runBuildAfterExit = false;

    await writeRestartSignal(signalFile, {
      at: new Date().toISOString(),
      requestedBy,
      version,
      fileName,
      clientIp: ipTrim ?? null,
      restartRequested: doRestart,
      restartMode,
      includeNodeModules,
      runNpmInstallBefore,
      runBuild: runBuildAfterExit,
      /** 재기동 시 run.ts ensure 이중 확인(적용 경로에서 이미 기동해도 OK) */
      startGeoServerAfter: doRestart,
      historyPending: doRestart,
      historyPayload: doRestart
        ? {
            mode: restartMode,
            command: bootCommand,
            version,
            appliedFiles: copyResult.appliedFiles,
            skippedFiles: copyResult.skippedFiles,
            netLabel,
            geoserverMsg: geoserver.message,
            message: successMessage,
            option: historyOption,
          }
        : null,
      /** 이전 재기동이 남긴 소비 플래그 — 매 적용마다 초기화해야 2회차부터 스킵되지 않음 */
      launcherConsumed: false,
      launcherConsumedAt: null,
      source: 'versionManagerClientRelay',
    });

    /** 재시작 없음: 즉시 INSERT. 재시작 있음: 부팅 시 flush (exit 직전 INSERT 유실 방지) */
    if (!doRestart) {
      await recordVersionHistory({
        historyType: 'apply_latest',
        status: 'success',
        message: successMessage,
        option: historyOption,
        version,
        ip: ipTrim,
      });
    }

    /** 성공 확정 후 잔여 정리 — 실패해도 롤백하지 않음(적용 직전 파일 보존 위해) */
    try {
      await emit('merge-apply', '잔여 소스 정리 중...');
      const orphanRemoved = await cleanupOrphanManagedFiles({
        workspaceRoot,
        mergeRelSet: new Set(mergeRelPaths),
        includeNodeModules,
        onLog: (m) => {
          void emit('merge-apply', m);
        },
      });
      await emit('merge-apply', `잔여 소스 정리 완료 (${orphanRemoved}건)`);
    } catch (orphanErr: unknown) {
      const om = orphanErr instanceof Error ? orphanErr.message : String(orphanErr);
      await emit('merge-apply', `잔여 소스 정리 경고: ${om}`);
    }

    await removeApplyRollbackSnapshot(rollback);
    rollback = null;

    /** 앱 종료 단계는 응답 flush 전에 완료로 보고 (이후 process.exit·런처 종료) */
    if (doRestart) {
      await emit(
        'app-stop',
        restartMode === 'exit'
          ? '앱 종료 단계 완료 · process.exit 예약'
          : '앱 종료 단계 완료 · 런처가 Next 종료 예정'
      );
    }

    const restartResult = scheduleRestart(restartMode);
    await emit('app-stop', `적용 완료 restart=${restartResult.message}`);

    return {
      version,
      fileName,
      downloadedBytes: stat.size,
      extractedRoot: normalizeSlashes(path.relative(workspaceRoot, extractedRoot) || '.'),
      appliedFiles: copyResult.appliedFiles,
      skippedFiles: copyResult.skippedFiles,
      skippedSamples: copyResult.skippedSamples,
      geoserver,
      restart: {
        requested: doRestart,
        mode: restartMode,
        commandConfigured: restartResult.commandConfigured,
        scheduled: restartResult.scheduled,
        signalFile: normalizeSlashes(path.relative(workspaceRoot, signalFile)),
        message: restartResult.message,
      },
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[SourceCodeUpload] 적용 실패:`, raw);

    let failMessage = raw;
    if (rollback) {
      try {
        failMessage = await runRollback(raw);
      } catch (rollbackErr: unknown) {
        failMessage = `${raw} / 롤백 실패: ${
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        }`;
        await removeApplyRollbackSnapshot(rollback).catch(() => {});
        rollback = null;
      }
      console.error(`[SourceCodeUpload] ${failMessage}`);
      await recordVersionHistory({
        historyType: 'apply_latest',
        status: 'fail',
        message: failMessage,
        option: applyLatestHistoryOptions(includeNodeModules, restartMode),
        version,
        ip: clientIp?.trim() || undefined,
      }).catch(() => {});
    }

    /** 복사 등 실패 시에도 GeoServer가 꺼진 채로 남지 않도록 ensure */
    if (!geoStartedOnSuccessPath) {
      await ensureGeoServerRunning({ forceRestart: false }).catch(() => {});
    }
    throw new Error(failMessage);
  } finally {
    await removeApplyRollbackSnapshot(rollback);
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }
}

function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await spawnAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ]);
    return;
  }
  await spawnAsync('unzip', ['-oq', zipPath, '-d', destDir]);
}

async function pickExtractedRoot(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const dirs = entries.filter((e) => e.isDirectory());
  if (files.length === 0 && dirs.length === 1) return path.join(extractDir, dirs[0]!.name);
  return extractDir;
}

function isBusyLockError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

const COPY_BUSY_RETRY_DELAYS_MS = [500, 1500, 3000];

async function copyFileWithRetry(srcPath: string, dstPath: string, relPath: string): Promise<void> {
  const maxAttempts = COPY_BUSY_RETRY_DELAYS_MS.length + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.copyFile(srcPath, dstPath);
      return;
    } catch (err) {
      lastErr = err;
      if (!isBusyLockError(err) || attempt >= maxAttempts) break;
      await sleep(COPY_BUSY_RETRY_DELAYS_MS[attempt - 1] ?? 3000);
    }
  }
  const code =
    lastErr && typeof lastErr === 'object' && 'code' in lastErr
      ? String((lastErr as NodeJS.ErrnoException).code)
      : 'unknown';
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `파일 복사 실패(${code}): ${relPath}. 대상 파일이 다른 프로세스(GeoServer/Java 등)에 잠겨 있을 수 있습니다. GeoServer를 종료한 뒤 다시 적용하세요. (${detail})`
  );
}

async function countCopyTargets(
  srcRoot: string,
  excludePrefixes: string[]
): Promise<{ totalFiles: number; skippedFiles: number }> {
  let totalFiles = 0;
  let skippedFiles = 0;
  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(srcRoot, relDir) : srcRoot;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (shouldSkipRelPath(relPath, excludePrefixes)) {
        skippedFiles += 1;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(relPath);
        continue;
      }
      if (entry.isFile()) totalFiles += 1;
    }
  }
  await walk('');
  return { totalFiles, skippedFiles };
}

async function copyRecursive(params: {
  srcRoot: string;
  dstRoot: string;
  excludePrefixes: string[];
  totalFiles?: number;
  onProgress?: (p: {
    appliedFiles: number;
    skippedFiles: number;
    totalFiles: number;
  }) => void;
}): Promise<{ appliedFiles: number; skippedFiles: number; skippedSamples: string[] }> {
  const { srcRoot, dstRoot, excludePrefixes, onProgress } = params;
  let appliedFiles = 0;
  let skippedFiles = 0;
  const skippedSamples: string[] = [];
  const totalFiles = params.totalFiles ?? 0;
  const REPORT_EVERY = 50;
  let lastReported = 0;

  const report = (force = false) => {
    if (!onProgress) return;
    if (!force && appliedFiles - lastReported < REPORT_EVERY && appliedFiles !== totalFiles) return;
    lastReported = appliedFiles;
    onProgress({ appliedFiles, skippedFiles, totalFiles });
  };

  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(srcRoot, relDir) : srcRoot;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = normalizeSlashes(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (shouldSkipRelPath(relPath, excludePrefixes)) {
        skippedFiles += 1;
        if (skippedSamples.length < 20) skippedSamples.push(relPath);
        continue;
      }

      const srcPath = path.join(srcRoot, relPath);
      const dstPath = path.join(dstRoot, relPath);
      if (entry.isDirectory()) {
        await fs.mkdir(dstPath, { recursive: true });
        await walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await copyFileWithRetry(srcPath, dstPath, relPath);
      appliedFiles += 1;
      report(false);
    }
  }

  await walk('');
  report(true);
  return { appliedFiles, skippedFiles, skippedSamples };
}

async function writeRestartSignal(signalFile: string, payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(signalFile), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    if (fsSync.existsSync(signalFile)) {
      existing = JSON.parse(fsSync.readFileSync(signalFile, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  const merged: Record<string, unknown> = {
    ...existing,
    ...payload,
    ...pickBootForSignalMerge(existing),
  };
  /** payload에 명시되지 않아도 새 요청이면 이전 소비 플래그는 제거 */
  if (!('launcherConsumed' in payload)) {
    delete merged.launcherConsumed;
    delete merged.launcherConsumedAt;
  } else if (payload.launcherConsumed === false || payload.launcherConsumed == null) {
    delete merged.launcherConsumed;
    delete merged.launcherConsumedAt;
  }
  await fs.writeFile(signalFile, JSON.stringify(merged, null, 2), 'utf-8');
}

/** Next listen port (PORT env or 3000). Same value used by parent and child restart. */
export function getAppListenPort(): number {
  const n = Number(process.env.PORT ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

function hasRunSupervisor(): boolean {
  return process.env.GGNR_RUN_SUPERVISOR === '1';
}

function scheduleRestart(mode: RestartMode): {
  scheduled: boolean;
  commandConfigured: boolean;
  message: string;
} {
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  /** HTTP 응답 flush 전 process.exit 방지 — 최소 2초 */
  const MIN_EXIT_DELAY_MS = 2000;
  const rawDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;
  const safeDelay = Math.max(MIN_EXIT_DELAY_MS, rawDelay);
  const port = getAppListenPort();

  if (mode === 'none') {
    return {
      scheduled: false,
      commandConfigured: isRestartCommandConfigured(),
      message: '재시작 요청 안 함',
    };
  }

  /** Node 런처: process.exit 없음. 사전 빌드 완료 후 run.ts가 Next만 재기동 */
  if (mode === 'launcher') {
    if (!isRestartCommandConfigured()) {
      throw new Error(LAUNCHER_MISSING_MSG);
    }
    console.log(`[SourceCodeUpload] exit 예약 없음 mode=launcher port=${port}`);
    return {
      scheduled: true,
      commandConfigured: true,
      message: `Node 런처 재시작 요청: Next 종료 후 재기동 (포트 ${port})`,
    };
  }

  /**
   * exit(nssm): 사전 빌드는 적용 경로에서 이미 완료.
   * process.exit(0) → nssm/외부 감시 또는 run 슈퍼바이저가 재기동.
   * GeoServer는 적용 경로에서 기동·run.ts ensure로 재확인.
   */
  const exitDelayMs = Math.max(MIN_EXIT_DELAY_MS, safeDelay);
  const exitHint = hasRunSupervisor()
    ? 'process.exit → 런처가 Next 재기동'
    : 'process.exit → nssm/감시기가 재기동';
  console.log(`[SourceCodeUpload] exit port=${port} delay=${exitDelayMs}ms`);
  setTimeout(() => {
    console.log(`[SourceCodeUpload] process.exit(0)`);
    process.exit(0);
  }, exitDelayMs).unref();
  return {
    scheduled: true,
    commandConfigured: isRestartCommandConfigured(),
    message: `프로세스 종료(nssm) 재시작 예약: ${exitHint} (포트 ${port})`,
  };
}

export async function applyLatestSourceFromGnms(options: ApplyLatestSourceOptions): Promise<ApplyLatestSourceResult> {
  const { requestedBy, clientIp, restart, restartMode } = options;
  const cfg = getGnmsClientConfig();
  const headers: Record<string, string> = cfg.bearer ? { Authorization: `Bearer ${cfg.bearer}` } : {};

  const latestRes = await fetch(cfg.latestUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const latestJson = (await latestRes.json().catch(() => ({}))) as GnmsLatestPayload;
  if (!latestRes.ok) {
    throw new Error(`GNMS latest 조회 실패 (${latestRes.status})`);
  }

  const version = String(latestJson.version ?? '').trim() || new Date().toISOString();
  const fileName = String(latestJson.fileName ?? '').trim() || `source_latest_${Date.now()}.zip`;
  const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || cfg.downloadUrlFallback;
  const downloadUrl = resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw);

  const downloadRes = await fetch(downloadUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!downloadRes.ok) {
    throw new Error(`GNMS 소스 다운로드 실패 (${downloadRes.status})`);
  }
  const zipBuffer = Buffer.from(await downloadRes.arrayBuffer());

  const tmpBase = path.join(os.tmpdir(), 'ggnr_source_update', `${Date.now()}`);
  const zipPath = path.join(tmpBase, fileName);
  await fs.mkdir(tmpBase, { recursive: true });
  await fs.writeFile(zipPath, zipBuffer);

  const applied = await applySourceZipFile({
    zipPath,
    version,
    fileName,
    requestedBy,
    clientIp,
    restart,
    restartMode,
  });
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});

  return {
    gnmsBaseUrl: cfg.gnmsBaseUrl,
    latestUrl: cfg.latestUrl,
    downloadUrl,
    ...applied,
  };
}
