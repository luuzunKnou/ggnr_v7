import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { resolveAppStartCommand, pickBootForSignalMerge } from '@/lib/ggnrBootCommand';
import { ensureGeoServerRunning, stopGeoServerAndVerify } from '@/service/geoserverProcessService';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

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
  ip?: string;
  mode: RestartMode;
  command: string;
  appliedFiles: number;
  skippedFiles: number;
  netLabel: string;
  geoserverMsg: string;
}): string {
  const ip = opts.ip?.trim() || '-';
  const command = opts.command.trim() || '-';
  return `성공 / ${ip} / mode=${opts.mode} / command=${command} / 적용 ${opts.appliedFiles}건 / 제외 ${opts.skippedFiles}건 / ${opts.netLabel} / GeoServer: ${opts.geoserverMsg}`;
}

function runNpmInstallSyncInProcess(): void {
  console.log('[SourceCodeUpload] npm install 시작 (사전·개방망)');
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  console.log('[SourceCodeUpload] npm install 완료');
}

function runNpmBuildSyncInProcess(): void {
  console.log('[SourceCodeUpload] 사전 빌드 시작');
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
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

export type GnmsClientConfig = {
  gnmsBaseUrl: string;
  latestUrl: string;
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
  const downloadPath = process.env.GNMS_SOURCE_DOWNLOAD_PATH?.trim() ?? '/download/latest';
  const cancelPath = process.env.GNMS_SOURCE_CANCEL_PATH?.trim() ?? '/cancel';
  const bearer =
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BEARER?.trim() ||
    process.env.GNMS_SOURCE_BEARER?.trim() ||
    '';
  return {
    gnmsBaseUrl,
    latestUrl: resolveGnmsApiUrl(gnmsBaseUrl, latestPath),
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
  onProgress?: (event: ApplySourceProgressEvent) => void;
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

  const emit = (
    phase: ApplySourceProgressPhase,
    message: string,
    extra?: Partial<ApplySourceProgressEvent>
  ) => {
    const logLine = extra?.logLine ?? `[SourceCodeUpload] ${message}`;
    console.log(logLine);
    onProgress?.({ phase, message, logLine, ...extra });
  };

  emit(
    'geoserver-stop',
    `적용 시작 version=${version} mode=${restartMode} net=${includeNodeModules ? '폐쇄망' : '개방망'}`
  );

  try {
    onProgress?.({ phase: 'geoserver-stop', message: 'GeoServer 중지 중...' });
    const stopResult = await stopGeoServerAndVerify({ settleMs: GEOSERVER_STOP_SETTLE_MS });
    emit('geoserver-stop', `GeoServer ${stopResult.message}`);

    onProgress?.({ phase: 'merge-apply', message: '소스 병합·적용 중...' });
    emit('merge-apply', 'ZIP 압축 해제 시작');
    await extractZip(zipPath, extractDir);
    const extractedRoot = await pickExtractedRoot(extractDir);
    emit('merge-apply', 'ZIP 압축 해제 완료');

    const excludePrefixes = parseExcludePrefixes(includeNodeModules);
    emit('merge-apply', '병합 대상 파일 수 집계 중...');
    const { totalFiles, skippedFiles: preSkipped } = await countCopyTargets(
      extractedRoot,
      excludePrefixes
    );
    emit('merge-apply', `병합 대상 ${totalFiles}건 (제외 예정 ${preSkipped}건)`, {
      totalFiles,
      skippedFiles: preSkipped,
      appliedFiles: 0,
    });

    const copyResult = await copyRecursive({
      srcRoot: extractedRoot,
      dstRoot: workspaceRoot,
      excludePrefixes,
      totalFiles,
      onProgress: (p) => {
        const pct =
          p.totalFiles > 0 ? Math.min(100, Math.round((p.appliedFiles / p.totalFiles) * 100)) : 0;
        const msg = `병합 진행 ${p.appliedFiles}/${p.totalFiles} (${pct}%) · 제외 ${p.skippedFiles}`;
        emit('merge-apply', msg, {
          appliedFiles: p.appliedFiles,
          skippedFiles: p.skippedFiles,
          totalFiles: p.totalFiles,
        });
      },
    });
    emit(
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
    /** 재시작 시 기동은 run.ts(콜드/런처 재기동)에 맡김 */
    const skipStartForRestart = doRestart;

    if (!skipStartForRestart) {
      onProgress?.({ phase: 'geoserver-start', message: 'GeoServer 기동 중...' });
      let startResult = await ensureGeoServerRunning({ forceRestart: false });
      if (!startResult.success) {
        await sleep(2000);
        startResult = await ensureGeoServerRunning({ forceRestart: false });
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
      emit('geoserver-start', `GeoServer ${startMessage}`);
    } else {
      startMessage = '기동 생략(재기동 시 run에서 처리)';
      emit('merge-apply', `GeoServer ${startMessage}`);
    }

    const geoserver: GeoServerApplyStep = {
      stopped: stopResult.success,
      started,
      deferredStart: skipStartForRestart,
      message: skipStartForRestart ? stopMessage : `${stopMessage} / ${startMessage}`,
      stopMessage,
      startMessage,
    };

    const netLabel = includeNodeModules ? '폐쇄망' : '개방망';
    const ipTrim = clientIp?.trim() || undefined;
    const successMessage = buildApplySuccessHistoryMessage({
      ip: ipTrim,
      mode: restartMode,
      command: bootCommand,
      appliedFiles: copyResult.appliedFiles,
      skippedFiles: copyResult.skippedFiles,
      netLabel,
      geoserverMsg: `${stopMessage}; ${startMessage}`,
    });

    /** exit·launcher: 서버 가동 중 사전 install(개방망)·빌드. 실패 시 종료하지 않음 */
    if (doRestart && (restartMode === 'exit' || restartMode === 'launcher')) {
      try {
        if (!includeNodeModules) {
          emit('npm-install', 'npm install (개방망) 시작');
          runNpmInstallSyncInProcess();
          emit('npm-install', 'npm install 완료');
        }
        emit('build', '사전 빌드 시작');
        runNpmBuildSyncInProcess();
        emit('build', '사전 빌드 완료');
      } catch (buildErr: unknown) {
        const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
        await recordVersionHistory({
          historyType: 'apply_latest',
          status: 'fail',
          message: `사전 빌드 실패: ${msg}`,
          ip: ipTrim,
        });
        throw new Error(`사전 빌드 실패: ${msg}`);
      }
    }

    /** 사전 빌드 완료분 — 재기동 후행 install/build 없음. 기동은 run.ts */
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
      startGeoServerAfter: false,
      historyPending: doRestart,
      historyPayload: doRestart
        ? {
            mode: restartMode,
            command: bootCommand,
            appliedFiles: copyResult.appliedFiles,
            skippedFiles: copyResult.skippedFiles,
            netLabel,
            geoserverMsg: geoserver.message,
            message: successMessage,
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
        ip: ipTrim,
      });
    }

    /** 앱 종료 단계는 응답 flush 전에 완료로 보고 (이후 process.exit·런처 종료) */
    if (doRestart) {
      emit(
        'app-stop',
        restartMode === 'exit'
          ? '앱 종료 단계 완료 · process.exit 예약'
          : '앱 종료 단계 완료 · 런처가 Next 종료 예정'
      );
    }

    const restartResult = scheduleRestart(restartMode);
    emit('app-stop', `적용 완료 restart=${restartResult.message}`);

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
    console.error(
      `[SourceCodeUpload] 적용 실패:`,
      err instanceof Error ? err.message : err
    );
    /** 복사 등 실패 시에도 GeoServer가 꺼진 채로 남지 않도록 ensure */
    if (!geoStartedOnSuccessPath) {
      await ensureGeoServerRunning({ forceRestart: false }).catch(() => {});
    }
    throw err;
  } finally {
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
   * GeoServer 기동은 run.ts 콜드 기동에 맡김.
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
