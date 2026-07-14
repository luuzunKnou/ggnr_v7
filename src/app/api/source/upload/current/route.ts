import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { getSessionUsrId } from '@/lib/auth/guard';
import { pickClientIpFromRequest } from '@/lib/requestClientMeta';
import {
  classifySourcePath,
  shouldSkipSourceDir,
  shouldUploadSourcePath,
  type SourceUploadMode,
} from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import {
  RemoteUploadError,
  SOURCE_UPLOAD_REMOTE_BASE,
  uploadZipByChunks,
  type RemoteStageReport,
} from '@/service/sourceUploadRemote';
import {
  compareSchemaWithConnectedDb,
  formatDbCompareDialogSummary,
} from '@/service/sourceUploadDbCompareService';
import {
  bumpScanSummary,
  createEmptyScanSummary,
  formatScanDetail,
} from '@/service/sourceUploadScanSummary';
import {
  buildSourceUploadFailBody,
  buildSourceUploadSuccessBody,
} from '@/lib/sourceUploadHistoryMessage';
import { recordUploadFlowHistory } from '@/service/sourceUploadHistoryService';
import {
  completeUploadProgress,
  createProgressId,
  failUploadProgress,
  getUploadProgress,
  initUploadProgress,
  setScanProgress,
  setUploadProgressPhase,
  setZipProgress,
} from '@/service/sourceUploadProgress';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

type ItemStatus = 'ok' | 'skipped' | 'fail';
type UploadItem = {
  file: string;
  category: 'core' | 'runtime' | 'data';
  status: ItemStatus;
  error?: string;
};

type IncludedFile = {
  absPath: string;
  relPath: string;
  category: 'core' | 'runtime' | 'data';
};

type LocalStageReport = {
  id: 'scan' | 'dbCompare' | 'zip' | 'finalize';
  ok: boolean;
  detail?: string;
  error?: string;
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

async function buildZipBundle(params: {
  files: IncludedFile[];
  zipPath: string;
  bundleRoot: string;
  mode: SourceUploadMode;
  date: string;
  changeNote: string;
  workspaceRoot: string;
  includeNodeModules: boolean;
  progressId?: string;
}): Promise<void> {
  const { files, zipPath, bundleRoot, mode, date, changeNote, workspaceRoot, includeNodeModules, progressId } =
    params;
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  const total = files.length + 1;

  await new Promise<void>((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    let processed = 0;

    const reportZip = () => {
      if (!progressId) return;
      setZipProgress(progressId, { processed, total, zipName: path.basename(zipPath) });
    };

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('entry', () => {
      processed += 1;
      if (processed === 1 || processed % 25 === 0 || processed >= total) {
        reportZip();
      }
    });
    archive.pipe(output);

    for (const f of files) {
      archive.file(f.absPath, { name: `${bundleRoot}/${f.relPath}` });
    }
    const metaText = [
      `date=${date}`,
      `mode=${mode}`,
      `includeNodeModules=${includeNodeModules}`,
      `changeNote=${changeNote}`,
      `workspaceRoot=${workspaceRoot}`,
      `includedFileCount=${files.length}`,
      `generatedAt=${new Date().toISOString()}`,
      '',
    ].join('\n');
    archive.append(metaText, { name: `${bundleRoot}/_upload_meta.txt` });
    reportZip();
    archive.finalize().catch(reject);
  });
}

function uploadErrorResponse(params: {
  message: string;
  failedStage?: string;
  localStages?: LocalStageReport[];
  remoteStages?: RemoteStageReport[];
  partial?: Record<string, unknown>;
  dbCompareRequired?: boolean;
  dbCompare?: Record<string, unknown>;
  historyRecorded?: boolean;
}) {
  return NextResponse.json(
    {
      error: params.message,
      failedStage: params.failedStage,
      localStages: params.localStages ?? [],
      remoteStages: params.remoteStages ?? [],
      dbCompareRequired: params.dbCompareRequired,
      dbCompare: params.dbCompare,
      historyRecorded: params.historyRecorded === true,
      ...params.partial,
    },
    { status: params.dbCompareRequired ? 409 : 500 }
  );
}

function npmInstallNote(
  includeNodeModules: boolean,
  npmInstall?: { ok?: boolean; message?: string; skipped?: boolean }
): string | undefined {
  if (includeNodeModules) return 'npm install 생략';
  if (!npmInstall) return undefined;
  return npmInstall.message ?? (npmInstall.ok !== false ? 'npm install 완료' : 'npm install 실패');
}

export async function POST(req: NextRequest) {
  const localStages: LocalStageReport[] = [];
  let remoteStages: RemoteStageReport[] = [];
  let progressId = '';
  let clientIp: string | undefined;
  let includeNodeModules = false;

  try {
    const usrId = await getSessionUsrId();
    if (!usrId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const bodyIp = typeof body.clientIp === 'string' ? body.clientIp.trim() : '';
    clientIp = pickClientIpFromRequest(req, bodyIp);
    const modeRaw = typeof body.mode === 'string' ? body.mode.trim() : 'install';
    const mode: SourceUploadMode = modeRaw === 'install' ? 'install' : 'update';
    const dateRaw = typeof body.date === 'string' ? body.date.trim() : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayYmd();
    const changeNote = typeof body.changeNote === 'string' ? body.changeNote.trim() : '';
    const skipPreflight = body.skipPreflight === true;
    const confirmDbMismatch = body.confirmDbMismatch === true;
    includeNodeModules = body.includeNodeModules === true;
    progressId =
      typeof body.progressId === 'string' && body.progressId.trim()
        ? body.progressId.trim()
        : createProgressId();
    if (!getUploadProgress(progressId)) {
      initUploadProgress(progressId);
    }
    setUploadProgressPhase(progressId, 'scan', '소스 스캔/필터링 시작...', {
      progressPct: 5,
      includeNodeModules,
    });

    const workspaceRoot = process.cwd();
    const items: UploadItem[] = [];
    const included: IncludedFile[] = [];
    const scanSummary = createEmptyScanSummary();
    const skippedPaths: string[] = [];
    const SKIPPED_PATHS_CAP = 500;
    let skippedPathsTruncated = false;
    let dirsVisited = 0;
    let scanTicks = 0;

    const rememberSkipped = (rel: string) => {
      if (skippedPaths.length < SKIPPED_PATHS_CAP) {
        skippedPaths.push(rel);
      } else {
        skippedPathsTruncated = true;
      }
    };

    const pushScanProgress = (currentPath: string) => {
      setScanProgress(progressId, {
        included: scanSummary.included,
        skipped: scanSummary.skipped,
        currentPath,
        dirsVisited,
        dbSql: scanSummary.dbSql,
        dbReview: scanSummary.dbReview,
        images: scanSummary.images,
        packages: scanSummary.packages,
        schemaDbDiffCount: scanSummary.schemaDbDiffCount,
        skippedPaths: [...skippedPaths],
        skippedTruncated: skippedPathsTruncated,
      });
    };

    async function walk(absDir: string): Promise<void> {
      const relDir = toPosixRelative(absDir, workspaceRoot);
      if (relDir && shouldSkipSourceDir(relDir, mode, includeNodeModules)) return;
      dirsVisited += 1;
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        const childAbs = path.join(absDir, entry.name);
        const childRel = toPosixRelative(childAbs, workspaceRoot);
        if (!childRel || childRel.startsWith('..')) continue;
        if (entry.isDirectory()) {
          if (shouldSkipSourceDir(childRel, mode, includeNodeModules)) {
            const dirMark = `${childRel}/`;
            const category = classifySourcePath(childRel);
            items.push({ file: dirMark, category, status: 'skipped' });
            bumpScanSummary(scanSummary, { relPath: dirMark, included: false, category, mode });
            rememberSkipped(dirMark);
          } else {
            await walk(childAbs);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const category = classifySourcePath(childRel);
        if (!shouldUploadSourcePath(childRel, mode, includeNodeModules)) {
          items.push({ file: childRel, category, status: 'skipped' });
          bumpScanSummary(scanSummary, { relPath: childRel, included: false, category, mode });
          rememberSkipped(childRel);
        } else {
          included.push({ absPath: childAbs, relPath: childRel, category });
          bumpScanSummary(scanSummary, { relPath: childRel, included: true, category, mode });
        }

        scanTicks += 1;
        if (scanTicks % 80 === 0) {
          pushScanProgress(childRel);
          await new Promise<void>((r) => setImmediate(r));
        }
      }
    }

    await walk(workspaceRoot);

    setUploadProgressPhase(progressId, 'dbCompare', '스키마 SQL ↔ DB 비교 중...', { progressPct: 11 });
    const dbCompare = await compareSchemaWithConnectedDb();
    scanSummary.schemaDbDiffCount = dbCompare.diffCount;

    pushScanProgress('(스캔 완료)');

    localStages.push({
      id: 'scan',
      ok: true,
      detail: formatScanDetail(scanSummary),
    });
    localStages.push({
      id: 'dbCompare',
      ok: dbCompare.diffCount === 0,
      detail: dbCompare.summaryText,
      error: dbCompare.diffCount > 0 ? formatDbCompareDialogSummary(dbCompare) : undefined,
    });

    if (dbCompare.diffCount > 0 && !confirmDbMismatch) {
      failUploadProgress(progressId, 'dbCompare', 'DB 스키마 불일치 — 사용자 확인 필요');
      const historyRecorded = await recordUploadFlowHistory({
        includeNodeModules,
        status: 'fail',
        body: buildSourceUploadFailBody(`DB 스키마 불일치 (${dbCompare.diffCount}건)`),
        ip: clientIp,
      });
      return uploadErrorResponse({
        message: '접속 DB와 스키마 SQL이 다릅니다.',
        failedStage: 'dbCompare',
        localStages,
        remoteStages,
        historyRecorded,
        dbCompareRequired: true,
        dbCompare: {
          diffCount: dbCompare.diffCount,
          summaryText: dbCompare.summaryText,
          dialogSummary: formatDbCompareDialogSummary(dbCompare),
          items: dbCompare.items,
        },
        partial: { progressId, scanSummary },
      });
    }

    setUploadProgressPhase(progressId, 'zip', `ZIP 압축 중... (${included.length}개 파일)`);

    if (included.length === 0) {
      localStages.push({ id: 'zip', ok: false, error: '업로드 대상 파일이 없습니다.' });
      failUploadProgress(progressId, 'scan', '업로드 대상 파일이 없습니다.');
      const historyRecorded = await recordUploadFlowHistory({
        includeNodeModules,
        status: 'fail',
        body: buildSourceUploadFailBody('업로드 대상 파일이 없습니다.'),
        ip: clientIp,
      });
      return uploadErrorResponse({
        message: '업로드 대상 파일이 없습니다.',
        failedStage: 'scan',
        localStages,
        remoteStages,
        historyRecorded,
        partial: { progressId, items, total: items.length, ok: 0, skipped: items.length, fail: 0 },
      });
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const bundleRoot = `${date}_${stamp}`;
    const zipName = `source_${mode}_${date}_${stamp}.zip`;
    const tmpDir = path.join(os.tmpdir(), 'ggnr_source_upload');
    const zipPath = path.join(tmpDir, zipName);

    setUploadProgressPhase(progressId, 'zip', `ZIP 압축 준비 (${included.length}개 파일)...`, {
      progressPct: 14,
    });

    try {
      await buildZipBundle({
        files: included,
        zipPath,
        bundleRoot,
        mode,
        date,
        changeNote,
        workspaceRoot,
        includeNodeModules,
        progressId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ZIP 압축 실패';
      localStages.push({ id: 'zip', ok: false, error: message });
      failUploadProgress(progressId, 'zip', message);
      const historyRecorded = await recordUploadFlowHistory({
        includeNodeModules,
        status: 'fail',
        body: buildSourceUploadFailBody(message),
        ip: clientIp,
      });
      return uploadErrorResponse({
        message,
        failedStage: 'zip',
        localStages,
        remoteStages,
        historyRecorded,
        partial: { progressId, items, total: items.length },
      });
    }

    const zipSize = (await fs.stat(zipPath)).size;
    localStages.push({
      id: 'zip',
      ok: true,
      detail: `${zipName} (${Math.round(zipSize / 1024 / 1024)}MB)`,
    });
    setUploadProgressPhase(progressId, 'init', `ZIP 완료 (${Math.round(zipSize / 1024 / 1024)}MB) — 원격 전송 시작`, {
      zipName,
      zipSize,
    });

    let remoteResult;
    try {
      remoteResult = await uploadZipByChunks({
        zipPath,
        zipName,
        totalSize: zipSize,
        mode,
        date,
        changeNote,
        bundleRoot,
        skipPreflight,
        progressId,
        includeNodeModules,
      });
      remoteStages = remoteResult.stages;
    } finally {
      await fs.rm(zipPath, { force: true }).catch(() => {});
    }

    for (const f of included) {
      items.push({ file: f.relPath, category: f.category, status: 'ok' });
    }

    const npmInstall = remoteResult.complete?.npmInstall as
      | { ok?: boolean; message?: string; skipped?: boolean }
      | undefined;
    const npmMsg = includeNodeModules ? 'npm install 생략' : npmInstall?.message ?? 'npm install 완료';
    localStages.push({
      id: 'finalize',
      ok: true,
      detail: `성공 ${items.filter((x) => x.status === 'ok').length}, 제외 ${items.filter((x) => x.status === 'skipped').length}, ${npmMsg}`,
    });
    completeUploadProgress(progressId, '업로드 완료');

    const okCount = items.filter((x) => x.status === 'ok').length;
    const skippedCount = items.filter((x) => x.status === 'skipped').length;
    const failCount = items.filter((x) => x.status === 'fail').length;
    const historyRecorded = await recordUploadFlowHistory({
      includeNodeModules,
      status: 'success',
      body: buildSourceUploadSuccessBody(okCount, skippedCount, failCount, npmInstallNote(includeNodeModules, npmInstall)),
      ip: clientIp,
    });

    return NextResponse.json({
      progressId,
      remoteBase: SOURCE_UPLOAD_REMOTE_BASE,
      workspaceRoot,
      zipName,
      zipSize,
      bundleRoot,
      includeNodeModules,
      scanSummary,
      dbCompare: { diffCount: dbCompare.diffCount, summaryText: dbCompare.summaryText },
      total: items.length,
      ok: items.filter((x) => x.status === 'ok').length,
      skipped: items.filter((x) => x.status === 'skipped').length,
      fail: items.filter((x) => x.status === 'fail').length,
      remoteResult,
      localStages,
      remoteStages,
      items,
      historyRecorded,
    });
  } catch (err: unknown) {
    if (err instanceof RemoteUploadError) {
      remoteStages = err.stages;
      if (progressId) {
        failUploadProgress(progressId, err.stage, err.message, {
          sentChunks: err.sentChunks,
          expectedChunks: err.expectedChunks,
          chunkIndex: err.chunkIndex,
        });
      }
      const historyRecorded = await recordUploadFlowHistory({
        includeNodeModules,
        status: 'fail',
        body: buildSourceUploadFailBody(err.message),
        ip: clientIp,
      });
      return uploadErrorResponse({
        message: err.message,
        failedStage: err.stage,
        localStages,
        remoteStages: err.stages,
        historyRecorded,
        partial: {
          progressId,
          chunkIndex: err.chunkIndex,
          sentChunks: err.sentChunks,
          expectedChunks: err.expectedChunks,
          status: err.status,
        },
      });
    }
    const message = err instanceof Error ? err.message : 'Upload failed';
    if (progressId) failUploadProgress(progressId, 'unknown', message);
    const historyRecorded = await recordUploadFlowHistory({
      includeNodeModules,
      status: 'fail',
      body: buildSourceUploadFailBody(message),
      ip: clientIp,
    });
    return uploadErrorResponse({
      message,
      failedStage: 'unknown',
      localStages,
      remoteStages,
      historyRecorded,
      partial: { progressId },
    });
  }
}
