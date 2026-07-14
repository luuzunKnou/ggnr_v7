import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { resolveAppStartCommand, resolveGgnrNpmScript, pickBootForSignalMerge } from '@/lib/ggnrBootCommand';
import { startGeoServer, stopGeoServer } from '@/service/geoserverProcessService';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';

const GEOSERVER_STOP_SETTLE_MS = 2000;
/** 중지 실패 시에도 DLL 잠금 완화를 위해 동일 대기 */
const GEOSERVER_STOP_FAIL_SETTLE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RestartMode = 'none' | 'exit' | 'command' | 'startB' | 'launcher';

/**
 * 기동 시 기록된 명령(restart-request.json boot / GGNR_RUN_SCRIPT)을 재사용.
 * .env의 GGNR_RESTART_COMMAND는 사용하지 않음.
 */
export function resolveRestartCommand(mode: 'command' | 'startB' = 'command'): string {
  const project = process.env.GGNR_PROJECT?.trim() ?? '';
  const type = process.env.GGNR_ENV?.trim() ?? '';
  if (!project || !type) return '';
  const appCmd = resolveAppStartCommand(project, type);
  if (mode === 'startB') {
    return appCmd;
  }
  if (process.platform === 'win32') {
    const npmScript = resolveGgnrNpmScript();
    return `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\restart-watch.ps1 -Project ${project} -Type ${type} -NpmScript ${npmScript}`;
  }
  return appCmd;
}

export function isRestartCommandConfigured(): boolean {
  const project = process.env.GGNR_PROJECT?.trim() ?? '';
  const type = process.env.GGNR_ENV?.trim() ?? '';
  return Boolean(project && type);
}

const RESTART_COMMAND_MISSING_MSG =
  '구동 프로젝트/타입이 없어 명령 실행 재시작을 쓸 수 없습니다. npm run dev|start -- <project> <type> 또는 restart-watch로 기동하세요.';

const START_B_MISSING_MSG =
  '구동 프로젝트/타입이 없어 start/b 재시작을 쓸 수 없습니다. npm run dev|start -- <project> <type> 으로 기동하세요.';

const LAUNCHER_MISSING_MSG =
  '구동 프로젝트/타입이 없어 Node 런처 재시작을 쓸 수 없습니다. npm run dev|start -- <project> <type> 으로 기동하세요.';
/** 새 콘솔을 띄우는 방식(명령 실행)만 true */
function needsSpawnedRestartCommand(mode: RestartMode): mode is 'command' {
  return mode === 'command';
}

function needsProjectEnvRestart(mode: RestartMode): boolean {
  return mode === 'command' || mode === 'startB' || mode === 'launcher';
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
  /** 레거시: 재시작 파이프라인으로 기동 미룸(현재는 항상 적용 직후 기동) */
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
  /** 브라우저·요청에서 확정한 클라이언트 IPv4 (이력 mvh_ip) */
  clientIp?: string;
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
  const { zipPath, version, fileName, requestedBy, clientIp, restart, restartMode, includeNodeModules = true } = options;

  if (restart && restartMode === 'command' && !resolveRestartCommand('command')) {
    throw new Error(RESTART_COMMAND_MISSING_MSG);
  }
  if (restart && restartMode === 'startB' && !resolveRestartCommand('startB')) {
    throw new Error(START_B_MISSING_MSG);
  }
  if (restart && restartMode === 'launcher' && !isRestartCommandConfigured()) {
    throw new Error(LAUNCHER_MISSING_MSG);
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
      runNpmInstallBefore:
        restart && needsProjectEnvRestart(restartMode) && includeNodeModules === false,
      runBuild: restart,
      /** 앱 재기동(run.ts/npm)에 GeoServer 기동이 포함됨 — 파이프라인 끝에서 중복 기동하지 않음 */
      startGeoServerAfter: false,
      source: 'versionManagerClientRelay',
    });

    /** 적용 직후 GeoServer 기동. 재시작 파이프라인 끝에서는 중복 기동하지 않음(앱 재기동 경로에 포함) */
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
      deferredStart: false,
      message: `${stopPart} -> ${startPart}`,
      stopMessage: stopPart,
      startMessage: startPart,
    };

    /** 재시작(process.exit) 전에 이력 INSERT — 클라이언트 후기록은 서버 종료로 실패할 수 있음 */
    const netLabel = includeNodeModules ? '폐쇄망' : '개방망';
    await recordVersionHistory({
      historyType: 'apply_latest',
      status: 'success',
      message: `적용 ${copyResult.appliedFiles}건 / 제외 ${copyResult.skippedFiles}건 / ${netLabel} / GeoServer: ${geoserver.message}`,
      ip: clientIp?.trim() || undefined,
    });

    /** 개방망: 재기동 파이프라인에서 npm install. 빌드는 재시작 시 항상 */
    const runNpmInstallBefore =
      restart && needsProjectEnvRestart(restartMode) && includeNodeModules === false;
    const restartResult = scheduleRestart(restart ? restartMode : 'none', {
      runNpmInstallBefore,
      runBuild: restart,
      startGeoServerAfter: false,
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
  let existing: Record<string, unknown> = {};
  try {
    if (fsSync.existsSync(signalFile)) {
      existing = JSON.parse(fsSync.readFileSync(signalFile, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  const merged = {
    ...existing,
    ...payload,
    ...pickBootForSignalMerge(existing),
  };
  await fs.writeFile(signalFile, JSON.stringify(merged, null, 2), 'utf-8');
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
  console.log(
    `[restart] scheduled close of previous console pid=${shellPid} in ${killDelaySec}s`
  );
  spawn(
    'cmd.exe',
    ['/c', `timeout /t ${killDelaySec} /nobreak >nul & taskkill /PID ${shellPid} /F`],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ).unref();
}

/** Next listen port (PORT env or 3000). Same value used by parent and child restart. */
export function getAppListenPort(): number {
  const n = Number(process.env.PORT ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

/**
 * 앱 종료(포트 해제) 후 공통 후처리: (선택) npm install → build → GeoServer 기동.
 * PowerShell 런처용 줄 조각.
 */
function buildPostApplyPipelinePsLines(options: {
  runNpmInstallBefore: boolean;
  runBuild: boolean;
  startGeoServerAfter: boolean;
}): string[] {
  const lines: string[] = [];
  if (options.runNpmInstallBefore) {
    lines.push(
      'Write-Host "[restart] running npm install --no-audit --no-fund"',
      'npm install --no-audit --no-fund',
      'if ($LASTEXITCODE -ne 0) { Write-Host "[restart] npm install FAILED exit=$LASTEXITCODE"; exit $LASTEXITCODE }'
    );
  }
  if (options.runBuild) {
    lines.push(
      'Write-Host "[restart] running npm run build (app must be stopped)"',
      'npm run build',
      'if ($LASTEXITCODE -ne 0) { Write-Host "[restart] npm run build FAILED exit=$LASTEXITCODE"; exit $LASTEXITCODE }',
      'Write-Host "[restart] npm run build OK"'
    );
  }
  if (options.startGeoServerAfter) {
    lines.push(
      // forward slash: PS Join-Path 이중 백슬래시로 \\ 경로 오류 나는 것 방지
      "$geoBat = Join-Path (Get-Location) 'geoserver_modules/scripts/start-geoserver.bat'",
      'if (Test-Path -LiteralPath $geoBat) {',
      '  Write-Host "[restart] starting GeoServer: $geoBat"',
      // cmd /c ""path"" 는 Windows에서 '\\' 경로 못찾음 팝업을 낼 수 있음
      '  $geoCode = (Start-Process -FilePath $geoBat -WorkingDirectory (Split-Path -Parent $geoBat) -Wait -PassThru -NoNewWindow).ExitCode',
      '  Write-Host "[restart] GeoServer start script exit=$geoCode"',
      '} else {',
      '  Write-Host "[restart] WARN: GeoServer start script missing: $geoBat"',
      '}'
    );
  }
  return lines;
}

/** PowerShell 단일 인용 문자열용 경로 이스케이프 */
function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 부모 종료 후 포트가 비었는지 확인·로그한 뒤 재시작 명령을 실행하는 런처 스크립트 작성·기동.
 * sameConsole=true: 새 창 없이 기존 콘솔에서 백그라운드 기동 (start /b).
 */
function spawnDelayedRestartCommand(
  restartCommand: string,
  cwd: string,
  delayMs: number,
  options: {
    runNpmInstallBefore?: boolean;
    runBuild?: boolean;
    startGeoServerAfter?: boolean;
    sameConsole?: boolean;
  } = {}
): void {
  const delaySec = Math.max(1, Math.ceil(delayMs / 1000));
  const port = getAppListenPort();
  const runtimeDir = path.join(cwd, '.cursor-runtime');
  const sameConsole = options.sameConsole === true;
  const runNpmInstallBefore = options.runNpmInstallBefore === true;
  const runBuild = options.runBuild === true;
  const startGeoServerAfter = options.startGeoServerAfter === true;
  fsSync.mkdirSync(runtimeDir, { recursive: true });

  if (process.platform === 'win32') {
    const safeCmd = restartCommand.replace(/"/g, '');
    const launcherPath = path.join(
      runtimeDir,
      sameConsole ? 'restart-same-console.ps1' : 'restart-launch.ps1'
    );
    // cmd -File 인자·팝업 이슈 완화 (공백 없는 경로도 / 권장)
    const launcherPathForCmd = launcherPath.replace(/\\/g, '/');
    const lines: string[] = [
      '$ErrorActionPreference = "Continue"',
      `Set-Location -LiteralPath ${psSingleQuoted(cwd)}`,
      `$port = ${port}`,
      `$delaySec = ${delaySec}`,
      sameConsole
        ? 'Write-Host "[restart] same-console launcher started"'
        : 'Write-Host "[restart] child console started"',
      `Write-Host "[restart] cwd=$(Get-Location)"`,
      'Write-Host "[restart] target port=$port (must match previous process)"',
      'Write-Host "[restart] initial delay $delaySec s..."',
      'Start-Sleep -Seconds $delaySec',
      'Write-Host "[restart] waiting until port $port is FREE (LISTENING gone)..."',
      '$deadline = (Get-Date).AddSeconds(90)',
      '$freed = $false',
      'while ((Get-Date) -lt $deadline) {',
      '  $hit = netstat -ano 2>$null | Select-String -Pattern (":" + $port + "\\s") | Select-String "LISTENING"',
      '  if (-not $hit) {',
      '    Write-Host "[restart] port $port is FREE"',
      '    $freed = $true',
      '    break',
      '  }',
      '  Write-Host "[restart] port $port still LISTENING - wait 1s"',
      '  Start-Sleep -Seconds 1',
      '}',
      'if (-not $freed) {',
      '  Write-Host "[restart] WARN: port $port still busy after 90s - starting anyway (may bind another port)"',
      '}',
      ...buildPostApplyPipelinePsLines({ runNpmInstallBefore, runBuild, startGeoServerAfter }),
      `Write-Host "[restart] exec: ${safeCmd}"`,
      'Write-Host "[restart] starting app on expected port=$port"',
      safeCmd,
      'Write-Host "[restart] command finished exit=$LASTEXITCODE"',
    ];
    fsSync.writeFileSync(launcherPath, lines.join('\r\n') + '\r\n', 'utf8');
    console.log(`[restart] wrote launcher ${launcherPath}`);
    console.log(
      `[restart] child will wait for port ${port} free then pipeline(build=${runBuild}, geo=${startGeoServerAfter}) then run${sameConsole ? ' (same console)' : ''}: ${restartCommand}`
    );
    // sameConsole: start /b "" (빈 제목) → Windows «'\\' 경로를 찾을 수 없음» 팝업 유발
    const startCmd = sameConsole
      ? `start /b powershell -NoProfile -ExecutionPolicy Bypass -File "${launcherPathForCmd}"`
      : `start "ggnr-restart" powershell -NoProfile -ExecutionPolicy Bypass -File "${launcherPathForCmd}"`;
    spawn('cmd.exe', ['/c', startCmd], {
      cwd,
      detached: true,
      stdio: sameConsole ? 'inherit' : 'ignore',
      env: process.env,
      windowsHide: !sameConsole,
    }).unref();
    return;
  }

  const delaySecFloat = Math.max(0.5, delayMs / 1000);
  const steps: string[] = [];
  if (runNpmInstallBefore) steps.push(NPM_INSTALL_CMD);
  if (runBuild) steps.push('npm run build');
  if (startGeoServerAfter) {
    steps.push(
      'if [ -f geoserver_modules/scripts/start-geoserver.bat ]; then cmd.exe /c geoserver_modules/scripts/start-geoserver.bat || true; fi'
    );
  }
  steps.push(restartCommand);
  const afterWait = steps.join(' && ');
  const sh = [
    `echo "[restart] child started target port=${port}"`,
    `sleep ${delaySecFloat}`,
    `echo "[restart] waiting for port ${port} free..."`,
    `for i in $(seq 1 90); do`,
    `  if ! (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":${port} "; then`,
    `    echo "[restart] port ${port} is FREE"; break;`,
    `  fi`,
    `  echo "[restart] port ${port} still busy — wait 1s"; sleep 1;`,
    `done`,
    `echo "[restart] exec: ${afterWait}"`,
    afterWait,
  ].join('\n');
  spawn('sh', ['-c', sh], {
    cwd,
    detached: true,
    stdio: sameConsole ? 'inherit' : 'ignore',
    env: process.env,
  }).unref();
}

function hasRunSupervisor(): boolean {
  return process.env.GGNR_RUN_SUPERVISOR === '1';
}

function scheduleRestart(
  mode: RestartMode,
  options?: {
    runNpmInstallBefore?: boolean;
    runBuild?: boolean;
    startGeoServerAfter?: boolean;
  }
): {
  scheduled: boolean;
  commandConfigured: boolean;
  message: string;
} {
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  const safeDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;
  const runNpmInstallBefore = options?.runNpmInstallBefore === true;
  const runBuild = options?.runBuild === true;
  const startGeoServerAfter = options?.startGeoServerAfter === true;
  const port = getAppListenPort();
  const commandRestart = resolveRestartCommand('command');
  const startBRestart = resolveRestartCommand('startB');
  const pipelineHint = [
    runNpmInstallBefore ? 'npm install' : null,
    runBuild ? 'npm run build' : null,
    startGeoServerAfter ? 'GeoServer 기동' : null,
    '앱 기동',
  ]
    .filter(Boolean)
    .join(' → ');

  if (mode === 'none') {
    return {
      scheduled: false,
      commandConfigured: isRestartCommandConfigured(),
      message: '재시작 요청 안 함',
    };
  }

  /** 새 창에서 명령 실행 + 기존 콘솔 종료 — 빌드는 새 창 런처가 담당 */
  if (needsSpawnedRestartCommand(mode)) {
    if (!commandRestart) {
      throw new Error(RESTART_COMMAND_MISSING_MSG);
    }
    const exitDelayMs = 2000;
    console.log(
      `[restart] mode=command port=${port} — spawn child console for pipeline, exit in ${exitDelayMs}ms: ${pipelineHint}`
    );
    spawnDelayedRestartCommand(commandRestart, process.cwd(), safeDelay, {
      runNpmInstallBefore,
      runBuild,
      startGeoServerAfter,
    });
    scheduleClosePreviousConsoleWindow(exitDelayMs);
    setTimeout(() => {
      console.log(`[restart] process.exit(0) — releasing port ${port}`);
      process.exit(0);
    }, exitDelayMs).unref();
    return {
      scheduled: true,
      commandConfigured: true,
      message: `재시작 예약: 앱 종료 후 새 창에서 ${pipelineHint} (${commandRestart})`,
    };
  }

  /**
   * start/b: Next만 종료. npm run build는 살아 있는 기동 런처(run.ts)가 수행.
   * (예전처럼 Next 종료 직후 외부 PS에만 맡기면 빌드 주체가 사라질 수 있음)
   */
  if (mode === 'startB') {
    if (!isRestartCommandConfigured()) {
      throw new Error(START_B_MISSING_MSG);
    }
    const exitDelayMs = 2000;
    if (hasRunSupervisor()) {
      console.log(
        `[restart] mode=startB port=${port} — Next exit in ${exitDelayMs}ms; Node supervisor runs: ${pipelineHint}`
      );
      setTimeout(() => {
        console.log(
          `[restart] process.exit(0) — Next releasing port ${port}; Node supervisor continues build`
        );
        process.exit(0);
      }, exitDelayMs).unref();
      return {
        scheduled: true,
        commandConfigured: true,
        message: `start/b 재시작 예약: 앱(Next) 종료 후 기동 런처가 ${pipelineHint}`,
      };
    }
    console.log(
      `[restart] mode=startB port=${port} — no run supervisor; fallback same-console PS, exit in ${exitDelayMs}ms, pipeline: ${pipelineHint}`
    );
    spawnDelayedRestartCommand(startBRestart, process.cwd(), safeDelay, {
      runNpmInstallBefore,
      runBuild,
      startGeoServerAfter,
      sameConsole: true,
    });
    setTimeout(() => {
      console.log(`[restart] process.exit(0) — releasing port ${port}; start /b relaunch continues`);
      process.exit(0);
    }, exitDelayMs).unref();
    return {
      scheduled: true,
      commandConfigured: true,
      message: `start/b 재시작 예약(런처 없음·외부 스크립트): 앱 종료 후 ${pipelineHint} (${startBRestart})`,
    };
  }

  /** Node 런처: process.exit 없음. run.ts가 신호를 보고 Next 종료→빌드→Geo→Next */
  if (mode === 'launcher') {
    if (!isRestartCommandConfigured()) {
      throw new Error(LAUNCHER_MISSING_MSG);
    }
    console.log(
      `[restart] mode=launcher port=${port} — signal only; pipeline: ${pipelineHint}`
    );
    return {
      scheduled: true,
      commandConfigured: true,
      message: `Node 런처 재시작 요청: Node 유지, Next 종료 후 ${pipelineHint} (포트 ${port})`,
    };
  }

  /** exit: 기동 런처가 있으면 Next 종료 후 빌드. 없으면 restart-watch 등 외부 감시기에 의존 */
  if (hasRunSupervisor()) {
    console.log(
      `[restart] mode=exit port=${port} — Next exit in ${safeDelay}ms; Node supervisor runs: ${pipelineHint}`
    );
    setTimeout(() => {
      console.log(
        `[restart] process.exit(0) — Next releasing port ${port}; Node supervisor continues build`
      );
      process.exit(0);
    }, safeDelay).unref();
    return {
      scheduled: true,
      commandConfigured: isRestartCommandConfigured(),
      message: `프로세스 종료 재시작 예약: 앱(Next) 종료 후 기동 런처가 ${pipelineHint}`,
    };
  }

  console.log(
    `[restart] mode=exit port=${port} — process.exit in ${safeDelay}ms (watcher pipeline: ${pipelineHint})`
  );
  setTimeout(() => {
    console.log(`[restart] process.exit(0) — releasing port ${port}`);
    process.exit(0);
  }, safeDelay).unref();
  return {
    scheduled: true,
    commandConfigured: isRestartCommandConfigured(),
    message: `프로세스 종료 재시작 예약: 종료 후 watcher가 ${pipelineHint} (포트 ${port})`,
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
