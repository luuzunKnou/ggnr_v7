import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { startGeoServer, stopGeoServer } from '@/service/geoserverProcessService';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

const GEOSERVER_STOP_SETTLE_MS = 2000;
/** 중지 실패 시에도 DLL 잠금 완화를 위해 동일 대기 */
const GEOSERVER_STOP_FAIL_SETTLE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RestartMode = 'none' | 'exit' | 'command';

export type ApplyLatestSourceOptions = {
  requestedBy: string;
  restart: boolean;
  restartMode: RestartMode;
};

export type GeoServerApplyStep = {
  stopped: boolean;
  started: boolean;
  message: string;
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
  const bearer =
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BEARER?.trim() ||
    process.env.GNMS_SOURCE_BEARER?.trim() ||
    '';
  return {
    gnmsBaseUrl,
    latestUrl: resolveGnmsApiUrl(gnmsBaseUrl, latestPath),
    downloadUrlFallback: resolveGnmsApiUrl(gnmsBaseUrl, downloadPath),
    bearer,
  };
}

export type ApplySourceZipOptions = {
  zipPath: string;
  version: string;
  fileName: string;
  requestedBy: string;
  restart: boolean;
  restartMode: RestartMode;
  /** false=개방망(node_modules 제외), true=폐쇄망(포함) */
  includeNodeModules?: boolean;
};

export type ApplySourceZipResult = Omit<
  ApplyLatestSourceResult,
  'gnmsBaseUrl' | 'latestUrl' | 'downloadUrl'
>;

/** ZIP 파일 경로 기준 워크스페이스 적용 (GNMS fetch 없음) */
export async function applySourceZipFile(options: ApplySourceZipOptions): Promise<ApplySourceZipResult> {
  const { zipPath, version, fileName, requestedBy, restart, restartMode, includeNodeModules = true } = options;

  if (restart && restartMode === 'command') {
    const restartCommand = process.env.GGNR_RESTART_COMMAND?.trim() ?? '';
    if (!restartCommand) {
      throw new Error(
        'GGNR_RESTART_COMMAND가 설정되지 않았습니다. 명령 실행 재시작을 쓸 수 없어 적용을 중단합니다.'
      );
    }
  }

  const workspaceRoot = process.cwd();
  const stat = await fs.stat(zipPath);
  const tmpBase = path.join(os.tmpdir(), 'ggnr_source_update', `${Date.now()}`);
  const extractDir = path.join(tmpBase, 'extracted');

  let geoStartedOnSuccessPath = false;

  try {
    const stopResult = await stopGeoServer();
    await sleep(stopResult.success ? GEOSERVER_STOP_SETTLE_MS : GEOSERVER_STOP_FAIL_SETTLE_MS);

    await extractZip(zipPath, extractDir);
    const extractedRoot = await pickExtractedRoot(extractDir);

    const excludePrefixes = parseExcludePrefixes(includeNodeModules);
    const copyResult = await copyRecursive({
      srcRoot: extractedRoot,
      dstRoot: workspaceRoot,
      excludePrefixes,
    });

    const signalFile = path.join(workspaceRoot, '.cursor-runtime', 'restart-request.json');
    await writeRestartSignal(signalFile, {
      at: new Date().toISOString(),
      requestedBy,
      version,
      fileName,
      restartRequested: restart,
      restartMode,
      includeNodeModules,
      runNpmInstallBefore: restart && restartMode === 'command' && includeNodeModules === false,
      source: 'versionManagerClientRelay',
    });

    const startResult = await startGeoServer();
    geoStartedOnSuccessPath = true;

    const stopPart = stopResult.success
      ? '중지 성공'
      : `중지 실패(잠금 가능·대기 후 계속): ${stopResult.error ?? 'unknown'}`;
    const startPart = startResult.success
      ? '기동 성공'
      : `기동 실패: ${startResult.error ?? 'unknown'}`;
    const geoserver: GeoServerApplyStep = {
      stopped: stopResult.success,
      started: startResult.success,
      message: `${stopPart} → ${startPart}`,
    };

    /** 재시작(process.exit) 전에 이력 INSERT — 클라이언트 후기록은 서버 종료로 실패할 수 있음 */
    await recordVersionHistory({
      historyType: 'apply_latest',
      status: 'success',
      message: `적용 ${copyResult.appliedFiles}건 · 제외 ${copyResult.skippedFiles}건 · ${
        includeNodeModules ? '폐쇄망' : '개방망'
      } · GeoServer: ${geoserver.message}`,
      clientHost: requestedBy || undefined,
    });

    /** 개방망(node_modules 미포함) + 명령 실행: 재기동 전 npm install */
    const runNpmInstallBefore =
      restart && restartMode === 'command' && includeNodeModules === false;
    const restartResult = scheduleRestart(restart ? restartMode : 'none', {
      runNpmInstallBefore,
    });

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
        requested: restart,
        mode: restart ? restartMode : 'none',
        commandConfigured: restartResult.commandConfigured,
        scheduled: restartResult.scheduled,
        signalFile: normalizeSlashes(path.relative(workspaceRoot, signalFile)),
        message: restartResult.message,
      },
    };
  } catch (err) {
    /** 복사 등 실패 시에도 GeoServer가 꺼진 채로 남지 않도록 기동 시도 */
    if (!geoStartedOnSuccessPath) {
      await startGeoServer().catch(() => {});
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

async function copyRecursive(params: {
  srcRoot: string;
  dstRoot: string;
  excludePrefixes: string[];
}): Promise<{ appliedFiles: number; skippedFiles: number; skippedSamples: string[] }> {
  const { srcRoot, dstRoot, excludePrefixes } = params;
  let appliedFiles = 0;
  let skippedFiles = 0;
  const skippedSamples: string[] = [];

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
    }
  }

  await walk('');
  return { appliedFiles, skippedFiles, skippedSamples };
}

async function writeRestartSignal(signalFile: string, payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(signalFile), { recursive: true });
  await fs.writeFile(signalFile, JSON.stringify(payload, null, 2), 'utf-8');
}

const NPM_INSTALL_CMD = 'npm install --no-audit --no-fund';

/**
 * 조상 프로세스 중 cmd/PowerShell PID.
 * Windows Terminal 자체는 건드리지 않음(셸만 종료하면 해당 탭이 닫힘).
 */
function tryGetWindowsShellAncestorPid(fromPid: number): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const ps = `
$cur = ${Math.floor(fromPid)}
$shells = @('cmd.exe','powershell.exe','pwsh.exe')
for ($i = 0; $i -lt 24; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
  if (-not $p) { break }
  if ($shells -contains $p.Name) { Write-Output $p.ProcessId; exit 0 }
  if (-not $p.ParentProcessId -or $p.ParentProcessId -eq 0 -or $p.ParentProcessId -eq $cur) { break }
  $cur = $p.ParentProcessId
}
`;
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    ).trim();
    const pid = Number(out.split(/\r?\n/).filter(Boolean).pop());
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return null;
    return pid;
  } catch {
    return null;
  }
}

/**
 * 명령 실행 재시작: process.exit 후에도 남는 기존 콘솔 창을 닫음.
 * /T 없이 셸 PID만 종료해, 이미 띄운 새 재시작 창은 유지.
 */
function scheduleClosePreviousConsoleWindow(exitDelayMs: number): void {
  if (process.platform !== 'win32') return;
  const shellPid = tryGetWindowsShellAncestorPid(process.pid);
  if (shellPid == null) return;
  const killDelaySec = Math.max(1, Math.ceil((exitDelayMs + 1000) / 1000));
  spawn(
    'cmd.exe',
    ['/c', `timeout /t ${killDelaySec} /nobreak >nul & taskkill /PID ${shellPid} /F`],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ).unref();
}

/** 부모 프로세스 종료 후에도 대기·(선택) npm install·실행이 이어지도록 detached 자식으로 예약 */
function spawnDelayedRestartCommand(
  restartCommand: string,
  cwd: string,
  delayMs: number,
  runNpmInstallBefore: boolean
): void {
  const delaySec = Math.max(1, Math.ceil(delayMs / 1000));
  const afterWait = runNpmInstallBefore
    ? `${NPM_INSTALL_CMD} && ${restartCommand}`
    : restartCommand;
  if (process.platform === 'win32') {
    // 따옴표는 start/cmd 중첩 파싱을 깨뜨리므로 제거
    const safeAfter = afterWait.replace(/"/g, '');
    const script = `timeout /t ${delaySec} /nobreak >nul && ${safeAfter}`;
    // start "제목" → 기존 콘솔과 분리된 새 창. 런처 cmd는 숨김.
    const launcher = `start "ggnr-restart" cmd /c "${script}"`;
    spawn('cmd.exe', ['/c', launcher], {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    }).unref();
    return;
  }
  const delaySecFloat = Math.max(0.5, delayMs / 1000);
  spawn('sh', ['-c', `sleep ${delaySecFloat} && ${afterWait}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  }).unref();
}

function scheduleRestart(
  mode: RestartMode,
  options?: { runNpmInstallBefore?: boolean }
): {
  scheduled: boolean;
  commandConfigured: boolean;
  message: string;
} {
  const restartCommand = process.env.GGNR_RESTART_COMMAND?.trim() ?? '';
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  const safeDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;
  const runNpmInstallBefore = options?.runNpmInstallBefore === true;

  if (mode === 'none') {
    return { scheduled: false, commandConfigured: Boolean(restartCommand), message: '재시작 요청 안 함' };
  }

  if (mode === 'command') {
    if (!restartCommand) {
      throw new Error(
        'GGNR_RESTART_COMMAND가 설정되지 않았습니다. 명령 실행 재시작을 쓸 수 없어 적용을 중단합니다.'
      );
    }
    const exitDelayMs = 2000;
    spawnDelayedRestartCommand(restartCommand, process.cwd(), safeDelay, runNpmInstallBefore);
    scheduleClosePreviousConsoleWindow(exitDelayMs);
    setTimeout(() => {
      process.exit(0);
    }, exitDelayMs).unref();
    const npmStep = runNpmInstallBefore ? ' → npm install' : '';
    return {
      scheduled: true,
      commandConfigured: true,
      message: `재시작 예약: 프로세스 종료·기존 콘솔 종료 후 ${safeDelay}ms 대기${npmStep} → 새 창에서 명령 실행 (${restartCommand})`,
    };
  }

  setTimeout(() => {
    process.exit(0);
  }, safeDelay).unref();
  return {
    scheduled: true,
    commandConfigured: Boolean(restartCommand),
    message: `프로세스 종료 재시작 예약 완료 (${safeDelay}ms 후 process.exit)`,
  };
}

export async function applyLatestSourceFromGnms(options: ApplyLatestSourceOptions): Promise<ApplyLatestSourceResult> {
  const { requestedBy, restart, restartMode } = options;
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
