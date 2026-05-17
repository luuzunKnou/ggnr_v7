import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export type RestartMode = 'none' | 'exit' | 'command';

export type ApplyLatestSourceOptions = {
  requestedBy: string;
  restart: boolean;
  restartMode: RestartMode;
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
  'upload_data/',
  'service_data/',
  'coverage/',
  'out/',
  'build/',
];

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function parseExcludePrefixes(): string[] {
  const raw = process.env.GGNR_SOURCE_UPDATE_EXCLUDE_PREFIXES?.trim();
  if (!raw) return DEFAULT_EXCLUDE_PREFIXES;
  return raw
    .split(',')
    .map((x) => normalizeSlashes(x.trim()))
    .filter(Boolean)
    .map((x) => (x.endsWith('/') ? x : `${x}/`));
}

function shouldSkipRelPath(relPath: string, excludePrefixes: string[]): boolean {
  const posixRel = normalizeSlashes(relPath);
  return excludePrefixes.some((prefix) => posixRel === prefix.slice(0, -1) || posixRel.startsWith(prefix));
}

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative).toString();
  } catch {
    return new URL(maybeRelative.replace(/^\//, ''), `${base.replace(/\/+$/, '')}/`).toString();
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
      await fs.copyFile(srcPath, dstPath);
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

function scheduleRestart(mode: RestartMode): {
  scheduled: boolean;
  commandConfigured: boolean;
  message: string;
} {
  const restartCommand = process.env.GGNR_RESTART_COMMAND?.trim() ?? '';
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  const safeDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;

  if (mode === 'none') {
    return { scheduled: false, commandConfigured: Boolean(restartCommand), message: '재시작 요청 안 함' };
  }

  if (mode === 'command') {
    if (!restartCommand) {
      return {
        scheduled: false,
        commandConfigured: false,
        message: 'GGNR_RESTART_COMMAND 미설정으로 command 재시작을 실행하지 못했습니다.',
      };
    }
    const child = spawn(restartCommand, {
      cwd: process.cwd(),
      detached: true,
      shell: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return {
      scheduled: true,
      commandConfigured: true,
      message: `재시작 명령 실행 예약 완료 (${restartCommand})`,
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
  const gnmsBaseUrl =
    process.env.GNMS_SOURCE_BASE_URL?.trim() ?? 'http://192.168.126.1:3000/api/source/version';
  const latestPath = process.env.GNMS_SOURCE_LATEST_PATH?.trim() ?? '/latest';
  const fallbackDownloadPath = process.env.GNMS_SOURCE_DOWNLOAD_PATH?.trim() ?? '/download/latest';
  const bearer = process.env.GNMS_SOURCE_BEARER?.trim() ?? '';
  const latestUrl = absoluteUrl(gnmsBaseUrl, latestPath);
  const headers: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : {};

  const latestRes = await fetch(latestUrl, {
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
  const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || fallbackDownloadPath;
  const downloadUrl = absoluteUrl(gnmsBaseUrl, downloadUrlRaw);

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
  const extractDir = path.join(tmpBase, 'extracted');
  const workspaceRoot = process.cwd();
  await fs.mkdir(tmpBase, { recursive: true });
  await fs.writeFile(zipPath, zipBuffer);
  await extractZip(zipPath, extractDir);
  const extractedRoot = await pickExtractedRoot(extractDir);

  const excludePrefixes = parseExcludePrefixes();
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
    restartRequested: restart,
    restartMode,
    source: 'versionManager',
  });

  const restartResult = scheduleRestart(restart ? restartMode : 'none');
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});

  return {
    gnmsBaseUrl,
    latestUrl,
    downloadUrl,
    version,
    fileName,
    downloadedBytes: zipBuffer.byteLength,
    extractedRoot: normalizeSlashes(path.relative(workspaceRoot, extractedRoot) || '.'),
    appliedFiles: copyResult.appliedFiles,
    skippedFiles: copyResult.skippedFiles,
    skippedSamples: copyResult.skippedSamples,
    restart: {
      requested: restart,
      mode: restart ? restartMode : 'none',
      commandConfigured: restartResult.commandConfigured,
      scheduled: restartResult.scheduled,
      signalFile: normalizeSlashes(path.relative(workspaceRoot, signalFile)),
      message: restartResult.message,
    },
  };
}
