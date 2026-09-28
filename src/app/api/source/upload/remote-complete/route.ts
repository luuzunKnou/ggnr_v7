import { NextRequest, NextResponse } from 'next/server';
import { getSessionUsrId } from '@/lib/auth/guard';
import { buildSourceUploadSuccessBody, formatDbSchemaMismatchWarning } from '@/lib/sourceUploadHistoryMessage';
import {
  clearPreparedSourceZip,
  getPreparedSourceZip,
} from '@/service/sourceUploadPreparedZip';
import { completeUploadProgress, failUploadProgress } from '@/service/sourceUploadProgress';
import { recordUploadFlowHistory } from '@/service/sourceUploadHistoryService';

export const dynamic = 'force-dynamic';

type UploadItem = {
  file: string;
  category: 'core' | 'runtime' | 'data';
  status: 'ok' | 'skipped' | 'fail' | 'warn';
  error?: string;
  errorTitle?: string;
};

/** 브라우저가 GNMS 원격 전송을 끝낸 뒤 이력·정리 */
export async function POST(req: NextRequest) {
  try {
    if (!(await getSessionUsrId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const progressId = typeof body.progressId === 'string' ? body.progressId.trim() : '';
    if (!progressId) {
      return NextResponse.json({ error: 'progressId required' }, { status: 400 });
    }
    const meta = getPreparedSourceZip(progressId);
    if (!meta) {
      return NextResponse.json({ error: '준비된 ZIP이 없습니다' }, { status: 404 });
    }

    const ok = body.ok === true;
    const remoteResult = body.remoteResult as Record<string, unknown> | undefined;
    const remoteStages = Array.isArray(body.remoteStages) ? body.remoteStages : [];
    const errorMessage = typeof body.error === 'string' ? body.error.trim() : '';

    if (!ok) {
      failUploadProgress(progressId, 'chunk', errorMessage || '원격 전송 실패');
      const historyRecorded = await recordUploadFlowHistory({
        includeNodeModules: meta.includeNodeModules,
        changeNote: meta.changeNote,
        status: 'fail',
        body: errorMessage || '브라우저→GNMS 원격 전송 실패',
        version: meta.bundleRoot || undefined,
        ip: meta.clientIp,
      });
      await clearPreparedSourceZip(progressId);
      return NextResponse.json({
        ok: false,
        error: errorMessage || '원격 전송 실패',
        remoteStages,
        historyRecorded,
      });
    }

    const items = (Array.isArray(meta.items) ? meta.items : []) as UploadItem[];
    const npmInstall = remoteResult?.complete
      ? ((remoteResult.complete as Record<string, unknown>).npmInstall as
          | { ok?: boolean; message?: string; skipped?: boolean }
          | undefined)
      : undefined;
    const npmMsg = meta.includeNodeModules
      ? 'npm install 생략'
      : npmInstall?.message ?? 'npm install 완료';

    const localStages = [
      ...(Array.isArray(meta.localStages) ? meta.localStages : []),
      {
        id: 'finalize',
        ok: true,
        detail: `성공 ${items.filter((x) => x.status === 'ok').length}, 제외 ${items.filter((x) => x.status === 'skipped').length}, ${npmMsg}`,
      },
    ];

    completeUploadProgress(progressId, '업로드 완료');

    const okCount = items.filter((x) => x.status === 'ok').length;
    const skippedCount = items.filter((x) => x.status === 'skipped').length;
    const failCount = items.filter((x) => x.status === 'fail').length;
    const historyWarnings: string[] = [];
    if (meta.schemaMismatch) {
      const dbCompare = meta.dbCompare as { diffCount?: number; items?: unknown[] } | null;
      historyWarnings.push(formatDbSchemaMismatchWarning(dbCompare?.diffCount ?? 0));
    }
    const historyRecorded = await recordUploadFlowHistory({
      includeNodeModules: meta.includeNodeModules,
      changeNote: meta.changeNote,
      status: 'success',
      body: buildSourceUploadSuccessBody(
        okCount,
        skippedCount,
        failCount,
        meta.includeNodeModules
          ? 'npm install 생략(node_modules 포함)'
          : npmInstall?.skipped
            ? 'npm install 생략'
            : npmInstall?.ok === false
              ? `npm install 실패: ${npmInstall.message ?? ''}`
              : 'npm install 완료',
        historyWarnings
      ),
      version: meta.bundleRoot,
      ip: meta.clientIp,
    });

    const response = {
      progressId,
      zipName: meta.zipName,
      zipSize: meta.zipSize,
      bundleRoot: meta.bundleRoot,
      includeNodeModules: meta.includeNodeModules,
      scanSummary: meta.scanSummary,
      dbCompare: meta.dbCompare,
      warnings: historyWarnings,
      total: items.length,
      ok: okCount,
      skipped: skippedCount,
      fail: failCount,
      warn: items.filter((x) => x.status === 'warn').length,
      remoteResult,
      localStages,
      remoteStages,
      items,
      historyRecorded,
      workspaceRoot: meta.workspaceRoot,
    };

    await clearPreparedSourceZip(progressId);
    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'remote-complete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
