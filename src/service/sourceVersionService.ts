import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { buildGnmsVersionApiBase, resolveGnmsApiUrl, DEFAULT_GNMS_URL } from '@/lib/gnmsSourceUrl';
import { getGnmsUrl } from '@/service/configService';
import { resolveAppStartCommand, pickBootForSignalMerge, resolveAppliedVersionLabel } from '@/lib/ggnrBootCommand';
import { applyLatestHistoryOptions } from '@/lib/versionHistoryMessage';
import { stopGeoServerAndVerify } from '@/service/geoserverProcessService';
import {
  releaseSourceApplyLock,
  tryAcquireSourceApplyLock,
} from '@/service/sourceApplyLock';
import { runStagingTypeCheck } from '@/service/sourceApplyStagingService';
import {
  disableMaintenanceForApply,
  enableMaintenanceForApply,
} from '@/lib/maintenanceMode';
import { recordVersionHistory } from '@/service/mngVersionHistoryService';
import {
  APPLY_ORPHAN_WALK_ROOTS,
  isManagedApplyOrphanCandidate,
  isProtectedApplyResidualPath,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { decodeChildOutput } from '@/lib/decodeChildOutput';
import {
  isPrebuildTsxAvailable,
  NPM_INSTALL_DEV_ARGS,
  resolveNpmInstallEnv,
} from '@/lib/npmApplyEnv';

const GEOSERVER_STOP_SETTLE_MS = 2000;

/** env 재로드 + GeoServer 기동 + REST 저장소 갱신 (적용·중단·실패 복구 공용) */
async function ensureGeoServerRecoveredAfterApply(params?: {
  geoAlreadyStopped?: boolean;
  onProgressMessage?: (message: string) => Promise<void>;
}): Promise<{ success: boolean; message: string }> {
  const logPrefix = '[SourceCodeUpload]';
  const project = process.env.GGNR_PROJECT?.trim();
  const envType = process.env.GGNR_ENV?.trim();
  if (project && envType) {
    const { reloadProjectRuntimeEnv } = await import('@/lib/projectEnvReload');
    reloadProjectRuntimeEnv(project, envType);
  }
  await params?.onProgressMessage?.('GeoServer·저장소 복구 중...');
  const onLog = (message: string) => console.log(`${logPrefix} GeoServer: ${message}`);
  console.log(`${logPrefix} GeoServer·저장소 복구 시작...`);
  const { ensureGeoServerWithDbSetup } = await import('@/service/geoServerBootstrapService');
  const r = await ensureGeoServerWithDbSetup({
    geoAlreadyStopped: params?.geoAlreadyStopped ?? true,
    retryOnceOnFail: true,
    onLog,
  });
  const message = r.success
    ? r.ensure.action === 'already-ready'
      ? '복구 OK(이미 응답·저장소)'
      : '복구 OK(기동·저장소)'
    : `복구 경고: ${r.ensure.error ?? 'unknown'}`;
  if (r.success) {
    console.log(`${logPrefix} GeoServer·저장소 ${message}`);
  } else {
    console.warn(`${logPrefix} GeoServer·저장소 ${message}`);
  }
  await params?.onProgressMessage?.(`GeoServer ${message}`);
  return { success: r.success, message };
}

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

function tailTextLines(text: string, maxLines = 20, maxChars = 3500): string {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  let tail = lines.slice(-maxLines).join('\n');
  if (tail.length > maxChars) tail = `…\n${tail.slice(-maxChars)}`;
  return tail;
}

function npmFailureDetail(output: string, code: number | null, label: string): string {
  const moduleHint =
    output.match(/Cannot find module[^\n]*/)?.[0] ??
    output.match(/Cannot find package[^\n]*/)?.[0] ??
    output.match(/MODULE_NOT_FOUND[^\n]*/)?.[0] ??
    output.match(/npm ERR![^\n]*/)?.[0];
  const tail = tailTextLines(output);
  const parts = [`${label} 실패 (exit code ${code ?? '?'})`];
  if (moduleHint) parts.push(moduleHint);
  if (tail) parts.push(tail);
  return parts.join('\n');
}

/** npm stdout/stderr → UI 로그·실패 원인 (stdio inherit 대신 캡처) */
async function spawnNpmWithApplyLog(
  args: string[],
  onLine: (line: string) => void | Promise<void>,
  envOverride?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const usedCmdShell = process.platform === 'win32';
    const child = spawn('npm', args, {
      cwd: process.cwd(),
      shell: true,
      windowsHide: true,
      env: envOverride ?? process.env,
    });
    let combined = '';
    const handleData = (buf: Buffer) => {
      const chunk = decodeChildOutput(buf, usedCmdShell);
      combined += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed) void Promise.resolve(onLine(trimmed)).catch(() => {});
      }
    };
    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);
    child.on('error', reject);
    child.on('close', (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(npmFailureDetail(combined, code, `npm ${args.join(' ')}`)));
    });
  });
}

/** prebuild(tsx) 누락 시 devDependencies 포함 install (개방·폐쇄망 공통) */
async function ensurePrebuildDevDeps(
  onLine: (line: string) => void | Promise<void>
): Promise<void> {
  if (isPrebuildTsxAvailable()) return;
  await spawnNpmWithApplyLog([...NPM_INSTALL_DEV_ARGS], onLine, resolveNpmInstallEnv());
}

async function runApplyNpmInstallDev(
  onLine: (line: string) => void | Promise<void>
): Promise<void> {
  await spawnNpmWithApplyLog([...NPM_INSTALL_DEV_ARGS], onLine, resolveNpmInstallEnv());
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
  /** 스키마 모달 확인 전 — 재기동·스냅샷 삭제 보류 */
  pendingSchemaConfirm?: boolean;
  pendingId?: string;
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
  'nssm/',
  '.cursor-runtime/',
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

const PENDING_SCHEMA_TTL_MS = 30 * 60 * 1000;

/** prepare 단계 산출물 — live 병합 전 스키마 모달 대기용 */
type ApplyPrepareBundle = {
  tmpBase: string;
  extractedRoot: string;
  excludePrefixes: string[];
  totalFiles: number;
  preSkipped: number;
  lockOwner: string;
};

type PendingSchemaConfirmSession = {
  id: string;
  createdAt: number;
  requestedBy: string;
  /** prepareOnly=false(레거시) 일 때만 사용 */
  snapshot: ApplyRollbackSnapshot | null;
  /** true: live 미변경, [진행] 시 commit */
  prepareOnly?: boolean;
  prepareBundle?: ApplyPrepareBundle;
  workspaceRoot: string;
  includeNodeModules: boolean;
  doRestart: boolean;
  restartMode: RestartMode;
  signalFile: string;
  mergeRelPaths: string[];
  version: string;
  fileName: string;
  clientIp?: string;
  historyVersion: string;
  historyOption: string[];
  successMessage: string;
  bootCommand: string | null;
  appliedFiles: number;
  skippedFiles: number;
  geoserverMessage: string;
  netLabel: string;
  timer: ReturnType<typeof setTimeout>;
};

type PendingSchemaConfirmStored = Omit<PendingSchemaConfirmSession, 'timer'>;

const pendingSchemaSessions = new globalThis.Map<string, PendingSchemaConfirmSession>();

function pendingSchemaStoreDir(): string {
  return path.join(process.cwd(), '.cursor-runtime', 'pending-schema-confirm');
}

async function writePendingSchemaFile(stored: PendingSchemaConfirmStored): Promise<void> {
  const dir = pendingSchemaStoreDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${stored.id}.json`), JSON.stringify(stored), 'utf-8');
}

async function deletePendingSchemaFile(id: string): Promise<void> {
  await fs.rm(path.join(pendingSchemaStoreDir(), `${id}.json`), { force: true }).catch(() => {});
}

async function readPendingSchemaFile(id: string): Promise<PendingSchemaConfirmStored | null> {
  try {
    const raw = await fs.readFile(path.join(pendingSchemaStoreDir(), `${id}.json`), 'utf-8');
    return JSON.parse(raw) as PendingSchemaConfirmStored;
  } catch {
    return null;
  }
}

function armPendingSchemaTimer(session: PendingSchemaConfirmSession): void {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    void (async () => {
      const s = pendingSchemaSessions.get(session.id);
      if (!s) return;
      console.warn(`[SourceCodeUpload] pending schema confirm timeout — 자동 롤백 id=${session.id}`);
      try {
        await discardPendingSession(s, true);
        await recordVersionHistory({
          historyType: 'apply_latest',
          status: 'cancel',
          message: s.prepareOnly
            ? `스키마 안내 대기 시간 초과 — prepare 취소 (${s.version})`
            : `스키마 안내 대기 시간 초과 — 적용 직전 소스로 롤백 (${s.version})`,
          option: s.historyOption,
          version: s.historyVersion,
          ip: s.clientIp,
        }).catch((histErr) => {
          console.error('[SourceCodeUpload] pending timeout 이력 기록 실패', histErr);
        });
        if (!s.prepareOnly) {
          await ensureGeoServerRecoveredAfterApply({ geoAlreadyStopped: true }).catch((geoErr) => {
            console.error('[SourceCodeUpload] pending timeout 후 GeoServer 복구 실패', geoErr);
          });
        }
      } catch (e) {
        console.error('[SourceCodeUpload] pending timeout 롤백 실패', e);
      }
    })();
  }, PENDING_SCHEMA_TTL_MS);
  session.timer.unref?.();
}

function clearPendingTimer(session: PendingSchemaConfirmSession): void {
  clearTimeout(session.timer);
}

async function discardPendingSession(session: PendingSchemaConfirmSession, restore: boolean): Promise<string> {
  clearPendingTimer(session);
  pendingSchemaSessions.delete(session.id);
  await deletePendingSchemaFile(session.id);

  if (session.prepareOnly) {
    if (session.prepareBundle) {
      await fs.rm(session.prepareBundle.tmpBase, { recursive: true, force: true }).catch(() => {});
      releaseSourceApplyLock(session.prepareBundle.lockOwner);
    }
    return restore ? 'prepare 취소 — live 변경 없음' : 'prepare 세션 삭제';
  }

  let detail = '';
  if (restore && session.snapshot) {
    const result = await restoreApplyRollbackSnapshot({
      snapshot: session.snapshot,
      workspaceRoot: session.workspaceRoot,
      includeNodeModules: session.includeNodeModules,
    });
    detail = result.detail;
  }
  if (session.snapshot) {
    await removeApplyRollbackSnapshot(session.snapshot);
  }
  return detail;
}

async function resolvePendingSession(pendingId: string): Promise<PendingSchemaConfirmSession | null> {
  const cached = pendingSchemaSessions.get(pendingId);
  if (cached) return cached;
  const stored = await readPendingSchemaFile(pendingId);
  if (!stored) return null;
  const remaining = PENDING_SCHEMA_TTL_MS - (Date.now() - stored.createdAt);
  if (remaining <= 0) {
    console.warn(`[SourceCodeUpload] pending schema 파일 만료 — 자동 롤백 id=${pendingId}`);
    try {
      const expired: PendingSchemaConfirmSession = {
        ...stored,
        timer: setTimeout(() => {}, 0),
      };
      clearTimeout(expired.timer);
      await discardPendingSession(expired, true);
      await recordVersionHistory({
        historyType: 'apply_latest',
        status: 'cancel',
        message: `스키마 안내 대기 시간 초과 — 적용 직전 소스로 롤백 (${stored.version})`,
        option: stored.historyOption,
        version: stored.historyVersion,
        ip: stored.clientIp,
      }).catch((histErr) => {
        console.error('[SourceCodeUpload] pending 만료 이력 기록 실패', histErr);
      });
    } catch (e) {
      console.error('[SourceCodeUpload] pending 만료 롤백 실패', e);
    }
    return null;
  }
  const session: PendingSchemaConfirmSession = {
    ...stored,
    timer: setTimeout(() => {}, 0),
  };
  clearTimeout(session.timer);
  armPendingSchemaTimer(session);
  pendingSchemaSessions.set(session.id, session);
  console.log(`[SourceCodeUpload] pending schema 세션 디스크에서 복구 id=${pendingId}`);
  return session;
}

async function registerPendingSchemaConfirm(
  partial: Omit<PendingSchemaConfirmSession, 'id' | 'createdAt' | 'timer'>
): Promise<string> {
  const id = `psc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const stored: PendingSchemaConfirmStored = {
    ...partial,
    id,
    createdAt: Date.now(),
  };
  await writePendingSchemaFile(stored);
  const session: PendingSchemaConfirmSession = {
    ...stored,
    timer: setTimeout(() => {}, 0),
  };
  clearTimeout(session.timer);
  armPendingSchemaTimer(session);
  pendingSchemaSessions.set(id, session);
  console.log(`[SourceCodeUpload] pending schema 등록 id=${id} (디스크+메모리)`);
  return id;
}

export type SchemaConfirmResult = {
  ok: boolean;
  error?: string;
  restart?: ApplyLatestSourceResult['restart'];
  rollbackDetail?: string;
};

type PreparedCommitResult = {
  appliedFiles: number;
  skippedFiles: number;
  skippedSamples: string[];
  geoserver: GeoServerApplyStep;
  rollback: ApplyRollbackSnapshot | null;
};

/** [진행] — prepare 세션을 live commit (Geo stop → 병합 → 빌드) */
async function executePreparedSourceApplyCommit(
  session: PendingSchemaConfirmSession
): Promise<PreparedCommitResult> {
  const bundle = session.prepareBundle;
  if (!bundle) {
    throw new Error('prepare 세션에 bundle 이 없습니다.');
  }

  const {
    workspaceRoot,
    includeNodeModules,
    doRestart,
    restartMode,
  } = session;
  const { extractedRoot, excludePrefixes, totalFiles, tmpBase, lockOwner } = bundle;

  let rollback: ApplyRollbackSnapshot | null = null;
  let geoStartedOnSuccessPath = false;

  const log = (message: string) => console.log(`[SourceCodeUpload] commit: ${message}`);

  try {
    await enableMaintenanceForApply(`최신소스 적용 commit version=${session.version}`);

    log('GeoServer 중지...');
    const stopResult = await stopGeoServerAndVerify({ settleMs: GEOSERVER_STOP_SETTLE_MS });
    if (!stopResult.success) {
      throw new Error(
        `GeoServer 중지 실패 — commit 중단: ${stopResult.message}. GeoServer·8080 확인 후 다시 시도하세요.`
      );
    }

    log('적용 직전 백업...');
    const mergeRelPaths = await listMergeRelFiles(extractedRoot, excludePrefixes);
    rollback = await createSourceRollbackSnapshot({
      workspaceRoot,
      mergeRelPaths,
      includeNodeModules,
      includeNext: !doRestart,
    });

    log('live 병합...');
    const copyResult = await copyRecursive({
      srcRoot: extractedRoot,
      dstRoot: workspaceRoot,
      excludePrefixes,
      totalFiles,
    });

    const stopMessage = stopResult.message;
    let startMessage: string | undefined;
    let started = false;
    let deferredStart = false;

    if (!doRestart) {
      const recover = await ensureGeoServerRecoveredAfterApply({ geoAlreadyStopped: true });
      geoStartedOnSuccessPath = recover.success;
      started = recover.success;
      startMessage = recover.success ? recover.message : `기동 경고: ${recover.message}`;
    } else {
      deferredStart = true;
      startMessage = '재기동 파이프라인(run.ts)에서 기동 예정';
    }

    const geoserver: GeoServerApplyStep = {
      stopped: stopResult.success,
      started,
      deferredStart,
      message: `${stopMessage} / ${startMessage}`,
      stopMessage,
      startMessage,
    };

    if (doRestart && (restartMode === 'exit' || restartMode === 'launcher')) {
      if (!includeNodeModules && rollback) {
        await snapshotNodeModulesInto(rollback, workspaceRoot);
        await runApplyNpmInstallDev(async (line) => {
          log(`npm: ${line}`);
        });
      }
      if (!isPrebuildTsxAvailable()) {
        await runApplyNpmInstallDev(async (line) => {
          log(`npm(tsx): ${line}`);
        });
      }
      log('사전 빌드...');
      await spawnNpmWithApplyLog(['run', 'build'], async (line) => {
        log(`build: ${line}`);
      });
    }

    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    releaseSourceApplyLock(lockOwner);

    return {
      appliedFiles: copyResult.appliedFiles,
      skippedFiles: copyResult.skippedFiles,
      skippedSamples: copyResult.skippedSamples,
      geoserver,
      rollback,
    };
  } catch (err) {
    await disableMaintenanceForApply().catch(() => {});
    if (rollback) {
      try {
        await restoreApplyRollbackSnapshot({
          snapshot: rollback,
          workspaceRoot,
          includeNodeModules,
        });
      } catch (restoreErr) {
        console.error('[SourceCodeUpload] commit 실패 후 롤백 실패', restoreErr);
      }
      await removeApplyRollbackSnapshot(rollback).catch(() => {});
    }
    if (!geoStartedOnSuccessPath) {
      await ensureGeoServerRecoveredAfterApply({ geoAlreadyStopped: true }).catch((e) => {
        console.error('[SourceCodeUpload] commit 실패 후 GeoServer 복구 실패', e);
      });
    }
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    releaseSourceApplyLock(lockOwner);
    throw err;
  } finally {
    await disableMaintenanceForApply().catch(() => {});
  }
}

/** 스키마 모달 [진행] — commit 또는 레거시 잔여 정리·재기동 */
export async function confirmPendingSchemaApply(params: {
  pendingId: string;
  requestedBy: string;
}): Promise<SchemaConfirmResult> {
  const session = await resolvePendingSession(params.pendingId);
  if (!session) {
    console.error(`[SourceCodeUpload] schema confirm 실패 — 세션 없음 id=${params.pendingId}`);
    return { ok: false, error: '대기 중인 적용 세션이 없습니다. (만료·이미 처리됨)' };
  }
  if (session.requestedBy !== params.requestedBy) {
    console.error(
      `[SourceCodeUpload] schema confirm 거부 — 사용자 불일치 id=${params.pendingId} by=${params.requestedBy}`
    );
    return { ok: false, error: '적용을 시작한 사용자만 확인할 수 있습니다.' };
  }

  clearPendingTimer(session);
  pendingSchemaSessions.delete(session.id);
  await deletePendingSchemaFile(session.id);

  const {
    snapshot,
    workspaceRoot,
    includeNodeModules,
    doRestart,
    restartMode,
    signalFile,
    mergeRelPaths,
    requestedBy,
    version,
    fileName,
    clientIp,
    historyVersion,
    historyOption,
    successMessage: prepareSuccessMessage,
    bootCommand,
    appliedFiles: prepareAppliedFiles,
    skippedFiles: prepareSkippedFiles,
    geoserverMessage: prepareGeoserverMessage,
    netLabel,
    prepareOnly,
  } = session;

  try {
    let appliedFiles = prepareAppliedFiles;
    let skippedFiles = prepareSkippedFiles;
    let geoserverMessage = prepareGeoserverMessage;
    let successMessage = prepareSuccessMessage;
    let commitRollback: ApplyRollbackSnapshot | null = snapshot;

    if (prepareOnly) {
      const commit = await executePreparedSourceApplyCommit(session);
      appliedFiles = commit.appliedFiles;
      skippedFiles = commit.skippedFiles;
      geoserverMessage = commit.geoserver.message;
      commitRollback = commit.rollback;
      successMessage = buildApplySuccessHistoryMessage({
        version,
        mode: restartMode,
        command: bootCommand ?? '',
        appliedFiles,
        skippedFiles,
        netLabel,
        geoserverMsg: geoserverMessage,
      });
    }

    try {
      const orphanRemoved = await cleanupOrphanManagedFiles({
        workspaceRoot,
        mergeRelSet: new Set(mergeRelPaths),
        includeNodeModules,
      });
      console.log(`[SourceCodeUpload] 잔여 소스 정리 완료 (${orphanRemoved}건)`);
    } catch (orphanErr: unknown) {
      const om = orphanErr instanceof Error ? orphanErr.message : String(orphanErr);
      console.warn(`[SourceCodeUpload] 잔여 소스 정리 경고: ${om}`);
    }

    const runNpmInstallBefore = false;
    const runBuildAfterExit = false;
    const ipTrim = clientIp?.trim() || undefined;

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
      startGeoServerAfter: doRestart,
      historyPending: doRestart,
      historyPayload: doRestart
        ? {
            mode: restartMode,
            command: bootCommand ?? '',
            version: historyVersion,
            appliedFiles,
            skippedFiles,
            netLabel,
            geoserverMsg: geoserverMessage,
            message: successMessage,
            option: historyOption,
          }
        : null,
      launcherConsumed: false,
      launcherConsumedAt: null,
      source: 'versionManagerClientRelay',
    });

    if (!doRestart) {
      await recordVersionHistory({
        historyType: 'apply_latest',
        status: 'success',
        message: successMessage,
        option: historyOption,
        version: historyVersion,
        ip: ipTrim,
      });
    }

    if (commitRollback) {
      await removeApplyRollbackSnapshot(commitRollback);
    }

    const restartResult = scheduleRestart(restartMode);
    console.log(`[SourceCodeUpload] 스키마 안내 확인 후 commit·재기동: ${restartResult.message}`);

    return {
      ok: true,
      restart: {
        requested: doRestart,
        mode: restartMode,
        commandConfigured: restartResult.commandConfigured,
        scheduled: restartResult.scheduled,
        signalFile: normalizeSlashes(path.relative(workspaceRoot, signalFile)),
        message: restartResult.message,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[SourceCodeUpload] schema confirm 처리 실패 id=${params.pendingId}:`, msg);
    if (!prepareOnly && snapshot) {
      try {
        await restoreApplyRollbackSnapshot({
          snapshot,
          workspaceRoot,
          includeNodeModules,
        });
      } catch (restoreErr) {
        console.error('[SourceCodeUpload] schema confirm 실패 후 롤백도 실패', restoreErr);
      }
      await removeApplyRollbackSnapshot(snapshot).catch(() => {});
    }
    return { ok: false, error: msg };
  }
}

/** 스키마 모달 [중단] — 적용 직전 백업 복원 */
export async function abortPendingSchemaApply(params: {
  pendingId: string;
  requestedBy: string;
}): Promise<SchemaConfirmResult> {
  const session = await resolvePendingSession(params.pendingId);
  if (!session) {
    console.error(`[SourceCodeUpload] schema abort 실패 — 세션 없음 id=${params.pendingId}`);
    return { ok: false, error: '대기 중인 적용 세션이 없습니다. (만료·이미 처리됨)' };
  }
  if (session.requestedBy !== params.requestedBy) {
    console.error(
      `[SourceCodeUpload] schema abort 거부 — 사용자 불일치 id=${params.pendingId} by=${params.requestedBy}`
    );
    return { ok: false, error: '적용을 시작한 사용자만 중단할 수 있습니다.' };
  }

  try {
    const detail = await discardPendingSession(session, true);
    await recordVersionHistory({
      historyType: 'apply_latest',
      status: 'cancel',
      message: `사용자가 스키마 안내에서 중단 — ${detail} (version=${session.version})`,
      option: session.historyOption,
      version: session.historyVersion,
      ip: session.clientIp,
    }).catch((histErr) => {
      console.error('[SourceCodeUpload] schema abort 이력 기록 실패', histErr);
    });
    if (!session.prepareOnly) {
      await ensureGeoServerRecoveredAfterApply({ geoAlreadyStopped: true }).catch((geoErr) => {
        console.error('[SourceCodeUpload] schema abort 후 GeoServer 복구 실패', geoErr);
      });
    }
    console.log(`[SourceCodeUpload] 스키마 안내 중단: ${detail}`);
    return { ok: true, rollbackDetail: detail };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[SourceCodeUpload] schema abort 처리 실패 id=${params.pendingId}:`, msg);
    return { ok: false, error: msg };
  }
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
  installLatestUrl: string;
  installDownloadUrl: string;
  bearer: string;
};

/** 로컬 서버가 GNMS API를 호출할 때 쓸 URL·토큰 */
export function getGnmsClientConfig(): GnmsClientConfig {
  /** 최신소스 적용·설치파일(GNMS) 공통 — common.runtime.env GNMS_URL 우선 */
  const fromRuntime = buildGnmsVersionApiBase(getGnmsUrl());
  const gnmsBaseUrl =
    fromRuntime ||
    process.env.NEXT_PUBLIC_GNMS_SOURCE_BASE_URL?.trim() ||
    process.env.GNMS_SOURCE_BASE_URL?.trim() ||
    buildGnmsVersionApiBase(DEFAULT_GNMS_URL);
  const latestPath = process.env.GNMS_SOURCE_LATEST_PATH?.trim() ?? '/latest';
  const listPath = process.env.GNMS_SOURCE_LIST_PATH?.trim() ?? '/list';
  const downloadPath = process.env.GNMS_SOURCE_DOWNLOAD_PATH?.trim() ?? '/download/latest';
  const cancelPath = process.env.GNMS_SOURCE_CANCEL_PATH?.trim() ?? '/cancel';
  const installLatestPath =
    process.env.GNMS_SOURCE_INSTALL_LATEST_PATH?.trim() ?? '/install/latest';
  const installDownloadPath =
    process.env.GNMS_SOURCE_INSTALL_DOWNLOAD_PATH?.trim() ?? '/install/download/latest';
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
    installLatestUrl: resolveGnmsApiUrl(gnmsBaseUrl, installLatestPath),
    installDownloadUrl: resolveGnmsApiUrl(gnmsBaseUrl, installDownloadPath),
    bearer,
  };
}

/** 적용 중 UI 단계 보고 */
export type ApplySourceProgressPhase =
  | 'type-check'
  | 'geoserver-stop'
  | 'merge-apply'
  | 'geoserver-start'
  | 'npm-install'
  | 'build'
  | 'schema-wait'
  | 'app-stop';

/** 병합·적용 내부 단계 — ETA·진행률용 (ZIP 해제·백업은 복사 건수에 안 잡힘) */
export type MergeApplyStep = 'extract' | 'count' | 'backup' | 'copy' | 'cleanup';

export type ApplySourceProgressEvent = {
  phase: ApplySourceProgressPhase;
  message: string;
  /** UI 실시간 로그에 남길 한 줄 (서버 [SourceCodeUpload] 와 동기) */
  logLine?: string;
  /** 병합 복사 진행 */
  appliedFiles?: number;
  skippedFiles?: number;
  totalFiles?: number;
  /** merge-apply 내부 단계 */
  mergeStep?: MergeApplyStep;
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

  const lockOwner = `${requestedBy}:${version}:${Date.now()}`;
  if (!tryAcquireSourceApplyLock(lockOwner)) {
    throw new Error('다른 최신소스 적용이 진행 중입니다. 완료 후 다시 시도하세요.');
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
    if (!rollback) {
      console.error(`[SourceCodeUpload] 적용 실패 (롤백 스냅샷 없음): ${reason}`);
      return `${reason} (롤백 스냅샷 없음)`;
    }
    console.error(`[SourceCodeUpload] 적용 실패 — 직전 소스로 롤백 중: ${reason}`);
    await emit(
      'merge-apply',
      `적용 실패 — 직전 소스로 롤백 중... (${reason})`,
      { logLine: `[SourceCodeUpload] 적용 실패 — 직전 소스로 롤백 중... (${reason})` }
    );
    const result = await restoreApplyRollbackSnapshot({
      snapshot: rollback,
      workspaceRoot,
      includeNodeModules,
    });
    await removeApplyRollbackSnapshot(rollback);
    rollback = null;
    console.error(`[SourceCodeUpload] 롤백 완료: ${reason} / ${result.detail}`);
    return `${reason} / ${result.detail}`;
  };

  await emit(
    'merge-apply',
    `적용 시작 version=${version} mode=${restartMode} net=${includeNodeModules ? '폐쇄망' : '개방망'}`
  );

  let pendingRegistered = false;

  try {
    await onProgress?.({
      phase: 'merge-apply',
      message: '소스 prepare 중...',
      mergeStep: 'extract',
    });
    await emit('merge-apply', 'ZIP 압축 해제 시작', { mergeStep: 'extract' });
    await extractZip(zipPath, extractDir);
    const extractedRoot = await pickExtractedRoot(extractDir);
    await emit('merge-apply', 'ZIP 압축 해제 완료', { mergeStep: 'extract' });

    const excludePrefixes = parseExcludePrefixes(includeNodeModules);
    await emit('merge-apply', '병합 대상 파일 수 집계 중...', { mergeStep: 'count' });
    mergeRelPaths = await listMergeRelFiles(extractedRoot, excludePrefixes);
    const { totalFiles, skippedFiles: preSkipped } = await countCopyTargets(
      extractedRoot,
      excludePrefixes
    );
    await emit('merge-apply', `병합 대상 ${totalFiles}건 (제외 예정 ${preSkipped}건)`, {
      mergeStep: 'count',
      totalFiles,
      skippedFiles: preSkipped,
      appliedFiles: 0,
    });

    const stagingRoot = path.join(tmpBase, 'typecheck-staging');
    await onProgress?.({ phase: 'type-check', message: '타입 검사 준비 중...' });
    await emit('type-check', '스테이징 병합 후 타입 검사 시작');
    const typeCheck = await runStagingTypeCheck({
      workspaceRoot,
      extractRoot: extractedRoot,
      stagingRoot,
      excludePrefixes,
      onLine: (line) => {
        const logLine = `[SourceCodeUpload] ${line}`;
        console.log(logLine);
        void onProgress?.({
          phase: 'type-check',
          message: line.startsWith('staging:') ? line : `타입 검사: ${line}`,
          logLine,
        });
      },
    });
    if (!typeCheck.ok) {
      await emit('type-check', '타입 검사 실패 — 적용 중단', {
        logLine: `[SourceCodeUpload] 타입 검사 실패:\n${typeCheck.message}`,
      });
      throw new Error(`타입 검사 실패 (version=${version}):\n${typeCheck.message}`);
    }
    await emit('type-check', '타입 검사 통과');

    const signalFile = path.join(workspaceRoot, '.cursor-runtime', 'restart-request.json');
    const netLabel = includeNodeModules ? '폐쇄망' : '개방망';
    const ipTrim = clientIp?.trim() || undefined;
    const historyOption = applyLatestHistoryOptions(includeNodeModules, restartMode);
    const historyVersion = resolveAppliedVersionLabel(version);
    const prepareBundle: ApplyPrepareBundle = {
      tmpBase,
      extractedRoot,
      excludePrefixes,
      totalFiles,
      preSkipped,
      lockOwner,
    };
    const geoserver: GeoServerApplyStep = {
      stopped: false,
      started: false,
      deferredStart: doRestart,
      message: 'prepare 완료 — 스키마 확인 후 commit',
      stopMessage: 'commit 대기(Geo 미중지)',
      startMessage: doRestart ? 'commit 후 재기동 예정' : 'commit 후 Geo·저장소 갱신',
    };
    const successMessage = buildApplySuccessHistoryMessage({
      version,
      mode: restartMode,
      command: bootCommand,
      appliedFiles: totalFiles,
      skippedFiles: preSkipped,
      netLabel,
      geoserverMsg: geoserver.message,
    });

    const pendingId = await registerPendingSchemaConfirm({
      requestedBy,
      snapshot: null,
      prepareOnly: true,
      prepareBundle,
      workspaceRoot,
      includeNodeModules,
      doRestart,
      restartMode,
      signalFile,
      mergeRelPaths,
      version,
      fileName,
      clientIp: ipTrim,
      historyVersion,
      historyOption,
      successMessage,
      bootCommand,
      appliedFiles: totalFiles,
      skippedFiles: preSkipped,
      geoserverMessage: geoserver.message,
      netLabel,
    });
    pendingRegistered = true;

    await emit(
      'schema-wait',
      doRestart
        ? 'prepare 완료 — 스키마 확인 후 commit·재기동'
        : 'prepare 완료 — 스키마 확인 후 commit'
    );

    return {
      version,
      fileName,
      downloadedBytes: stat.size,
      extractedRoot: normalizeSlashes(path.relative(workspaceRoot, extractedRoot) || '.'),
      appliedFiles: totalFiles,
      skippedFiles: preSkipped,
      skippedSamples: [],
      geoserver,
      restart: {
        requested: doRestart,
        mode: restartMode,
        commandConfigured: isRestartCommandConfigured(),
        scheduled: false,
        signalFile: normalizeSlashes(path.relative(workspaceRoot, signalFile)),
        message: '스키마 안내 확인 후 commit',
      },
      pendingSchemaConfirm: true,
      pendingId,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[SourceCodeUpload] 적용 실패:`, raw);
    await Promise.resolve(
      onProgress?.({
        phase: 'build',
        message: raw.split('\n')[0]?.trim() || '적용 실패',
        logLine: `[SourceCodeUpload] 적용 실패:\n${raw}`,
      })
    ).catch(() => {});

    let failMessage = raw;
    let historyRecorded = false;
    if (rollback) {
      try {
        failMessage = await runRollback(raw);
      } catch (rollbackErr: unknown) {
        failMessage = `${raw} / 롤백 실패: ${
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        }`;
        console.error(`[SourceCodeUpload] 롤백 자체 실패:`, failMessage);
        await removeApplyRollbackSnapshot(rollback).catch(() => {});
        rollback = null;
      }
      console.error(`[SourceCodeUpload] ${failMessage}`);
      const hist = await recordVersionHistory({
        historyType: 'apply_latest',
        status: 'fail',
        message: failMessage,
        option: applyLatestHistoryOptions(includeNodeModules, restartMode),
        version,
        ip: clientIp?.trim() || undefined,
      }).catch((histErr) => {
        console.error('[SourceCodeUpload] 실패 이력 기록 실패', histErr);
        return { ok: false as const };
      });
      historyRecorded = hist?.ok === true;
    } else {
      console.error(`[SourceCodeUpload] 적용 실패 (롤백 없음): ${failMessage}`);
    }

    /** prepare 실패: Geo 미중지 — 복구 불필요 */
    if (!pendingRegistered && !geoStartedOnSuccessPath) {
      await ensureGeoServerRecoveredAfterApply({ geoAlreadyStopped: false }).catch((e) => {
        console.error('[SourceCodeUpload] 실패 후 GeoServer 복구 실패', e);
      });
    }
    const outErr = new Error(failMessage) as Error & { historyRecorded?: boolean };
    outErr.historyRecorded = historyRecorded;
    throw outErr;
  } finally {
    if (!pendingRegistered) {
      releaseSourceApplyLock(lockOwner);
      await removeApplyRollbackSnapshot(rollback);
      await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
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
   * GeoServer는 run.ts ensure에서 기동(적용 경로에서는 재기동 시 생략).
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
