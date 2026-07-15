'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2, Minus, X, AlertTriangle } from 'lucide-react';
import { SyncDetailModal } from './SyncDetailModal';
import { extractFolderPartsFromPath } from './parseShpFolderMeta';

type StepStatus = 'pending' | 'running' | 'created' | 'existed' | 'fail' | 'sync';

type SyncConflictRow = {
  key: string;
  diffFields: string[];
  dbValues: Record<string, unknown>;
  shpValues: Record<string, unknown>;
};
type SyncRemoveRow = { key: string; values: Record<string, unknown> };

type SyncData = {
  tableName: string;
  keyField: string;
  columns: string[];
  appendCount: number;
  conflictCount: number;
  removeCount: number;
  unchangedCount: number;
  conflicts: SyncConflictRow[];
  removes: SyncRemoveRow[];
  pathOrResult: string;
};

type FileLogEntry = {
  file: string;
  shpPath?: string;
  table: StepStatus;
  layer: StepStatus;
  style: StepStatus;
  define: StepStatus;
  group?: string;
  oldData?: number;
  newData?: number;
  appendCount?: number;
  conflictCount?: number;
  removeCount?: number;
  syncData?: SyncData;
  error?: string;
};

type PreStatus = { table: boolean; layer: boolean; style: boolean; define: boolean; geometryType?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  /** GGNR_DATA_DIR 기준 상대 경로 (예: shp_data/폴더명) */
  relativePath: string;
  /** 1단계에서 수정한 작업명 — 이력 contents에 사용 */
  workName?: string;
  onSuccess?: () => void;
};

async function getTableRowCount(tableName: string): Promise<number> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getLayerTableRowCount',
      params: { tableName },
    });
    const d = res?.data ?? res;
    return d?.count ?? 0;
  } catch {
    return 0;
  }
}

function StepBadge({ status }: { status: StepStatus }) {
  switch (status) {
    case 'pending':
      return <Minus className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 mx-auto" />;
    case 'created':
      return (
        <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-green-700 dark:text-green-400">
          생성
        </span>
      );
    case 'existed':
      return (
        <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-blue-600 dark:text-blue-400">
          기존
        </span>
      );
    case 'sync':
      return (
        <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-orange-600 dark:text-orange-400">
          정합성 검증
        </span>
      );
    case 'fail':
      return <X className="w-3.5 h-3.5 text-red-500 mx-auto" />;
    default:
      return null;
  }
}

function formatCountCell(n: number | undefined) {
  return n === undefined ? '—' : String(n);
}

export function ShpToDbWizardModal({ open, onOpenChange, folderName, relativePath, workName, onSuccess }: Props) {
  const [postProcessing, setPostProcessing] = useState(false);
  const [fileLogs, setFileLogs] = useState<FileLogEntry[]>([]);
  const [postProgress, setPostProgress] = useState<{ current: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [showOriginalSummaryStyle, setShowOriginalSummaryStyle] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const processStartedRef = useRef(false);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalTable, setSyncModalTable] = useState<{ tableName: string; logIndex: number; shpPath?: string } | null>(
    null
  );

  const updateFileLog = useCallback((index: number, patch: Partial<FileLogEntry>) => {
    setFileLogs((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fileLogs]);

  const postProcessOneFile = useCallback(
    async (pathOrResult: string, fileName: string, logIndex: number, pre?: PreStatus, group?: string): Promise<FileLogEntry> => {
      const entry: FileLogEntry = {
        file: fileName,
        shpPath: pathOrResult,
        table: 'pending',
        layer: 'pending',
        style: 'pending',
        define: 'pending',
      };
      const baseName = fileName
        .replace(/\.shp$/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '');

      const flushCounts = () => {
        updateFileLog(logIndex, {
          oldData: entry.oldData,
          newData: entry.newData,
          appendCount: entry.appendCount,
          conflictCount: entry.conflictCount,
          removeCount: entry.removeCount,
          syncData: entry.syncData,
          shpPath: entry.shpPath,
          error: entry.error,
        });
      };

      let geometryType: string | undefined = pre?.geometryType;

      if (pre?.table) {
        entry.oldData = await getTableRowCount(baseName);
      }

      if (!pre?.table) {
        entry.table = 'running';
        updateFileLog(logIndex, { table: 'running' });
        try {
          const res = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'createTableFromShp',
            params: { pathOrResult },
          });
          const d = res?.data ?? res;
          if (d?.success) {
            entry.table = 'created';
            entry.newData = await getTableRowCount(baseName);
            updateFileLog(logIndex, { table: 'created' });
            if (!geometryType) {
              try {
                const gtRes = await call('', 'POST', {
                  service: 'devTestService',
                  action: 'getLayerTableGeometryTypes',
                  params: {},
                });
                const gtd = gtRes?.data ?? gtRes;
                if (gtd?.types?.[baseName]) geometryType = gtd.types[baseName];
              } catch {
                /* ignore */
              }
            }
          } else {
            entry.table = 'fail';
            entry.error = d?.error ?? '실패';
            updateFileLog(logIndex, { table: 'fail', error: d?.error });
            flushCounts();
            return entry;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          entry.table = 'fail';
          entry.error = msg;
          updateFileLog(logIndex, { table: 'fail', error: msg });
          flushCounts();
          return entry;
        }
      } else {
        entry.table = 'running';
        updateFileLog(logIndex, { table: 'running' });
        try {
          const cmpRes = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'compareShpWithTable',
            params: { pathOrResult },
          });
          const cmp = cmpRes?.data ?? cmpRes;
          if (cmp?.success) {
            entry.appendCount = cmp.appendCount ?? 0;
            entry.conflictCount = cmp.conflictCount ?? 0;
            entry.removeCount = cmp.removeCount ?? 0;

            if (cmp.conflictCount === 0 && cmp.removeCount === 0) {
              if (cmp.appendCount > 0) {
                const logsRes = await call('', 'POST', {
                  service: 'shpUploadService',
                  action: 'getSyncLogs',
                  params: { tableName: baseName },
                });
                const ld = logsRes?.data ?? logsRes;
                const pendingKeys = (ld?.rows ?? [])
                  .filter((r: Record<string, unknown>) => !r.sl_operation)
                  .map((r: Record<string, unknown>) => r.sl_key as number);
                if (pendingKeys.length > 0) {
                  const applyRes = await call('', 'POST', {
                    service: 'shpUploadService',
                    action: 'applySyncEntries',
                    params: { slKeys: pendingKeys },
                  });
                  const ad = applyRes?.data ?? applyRes;
                  if (ad?.success) {
                    entry.table = 'created';
                    entry.newData = await getTableRowCount(baseName);
                    updateFileLog(logIndex, { table: 'created' });
                  } else {
                    entry.table = 'fail';
                    entry.error = ad?.error ?? '정합성 검증 적용 실패';
                    updateFileLog(logIndex, { table: 'fail', error: entry.error });
                    flushCounts();
                    return entry;
                  }
                } else {
                  entry.table = 'existed';
                  entry.newData = entry.oldData;
                  updateFileLog(logIndex, { table: 'existed' });
                }
              } else {
                entry.table = 'existed';
                entry.newData = entry.oldData;
                updateFileLog(logIndex, { table: 'existed' });
              }
            } else {
              const sd: SyncData = {
                tableName: cmp.tableName,
                keyField: cmp.keyField,
                columns: cmp.columns ?? [],
                appendCount: cmp.appendCount,
                conflictCount: cmp.conflictCount,
                removeCount: cmp.removeCount,
                unchangedCount: cmp.unchangedCount,
                conflicts: cmp.conflicts ?? [],
                removes: cmp.removes ?? [],
                pathOrResult,
              };
              entry.syncData = sd;
              entry.table = 'sync';
              updateFileLog(logIndex, { table: 'sync' as StepStatus, syncData: sd });
              flushCounts();
            }
          } else if (cmp?.error?.includes('key 필드가 설정되어 있지 않습니다')) {
            entry.table = 'existed';
            entry.newData = entry.oldData;
            updateFileLog(logIndex, { table: 'existed' });
          } else {
            entry.table = 'fail';
            entry.error = cmp?.error ?? '비교 실패';
            updateFileLog(logIndex, { table: 'fail', error: entry.error });
            flushCounts();
            return entry;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          entry.table = 'fail';
          entry.error = msg;
          updateFileLog(logIndex, { table: 'fail', error: msg });
          flushCounts();
          return entry;
        }
      }

      const restSteps: Array<{ key: 'layer' | 'style' | 'define'; action: string }> = [
        { key: 'layer', action: 'createGeoServerLayer' },
        { key: 'style', action: 'createGeoServerStyleForShp' },
        { key: 'define', action: 'createDefineTableAndFields' },
      ];

      for (const step of restSteps) {
        if (pre && pre[step.key] && step.key !== 'define') {
          entry[step.key] = 'existed';
          updateFileLog(logIndex, { [step.key]: 'existed' });
          continue;
        }

        const alreadyExisted = step.key === 'define' && pre?.define;
        entry[step.key] = 'running';
        updateFileLog(logIndex, { [step.key]: 'running' });

        try {
          const extra: Record<string, unknown> = {};
          if (geometryType) extra.geometryType = geometryType;
          if (group) extra.group = group;

          const res = await call('', 'POST', {
            service: 'shpUploadService',
            action: step.action,
            params: { pathOrResult, ...extra },
          });
          const d = res?.data ?? res;
          if (d?.success) {
            entry[step.key] = alreadyExisted ? 'existed' : 'created';
            updateFileLog(logIndex, { [step.key]: entry[step.key] });
          } else {
            entry[step.key] = 'fail';
            entry.error = d?.error ?? '실패';
            updateFileLog(logIndex, { [step.key]: 'fail', error: d?.error });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          entry[step.key] = 'fail';
          entry.error = msg;
          updateFileLog(logIndex, { [step.key]: 'fail', error: msg });
        }
      }

      flushCounts();
      return entry;
    },
    [updateFileLog]
  );

  const saveHistory = useCallback(async (results: FileLogEntry[], folderMemo?: string) => {
    try {
      const successCount = results.filter(
        (r) => r.table !== 'fail' && r.layer !== 'fail' && r.style !== 'fail' && r.define !== 'fail'
      ).length;
      const failCount = results.length - successCount;
      const contents = folderMemo ?? '';

      const histRes = await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'createLayerHistory',
        params: {
          contents: contents.length > 500 ? contents.slice(0, 497) + '…' : contents,
          successCount,
          failCount,
        },
      });
      const hd = histRes?.data ?? histRes;
      if (hd?.lhKey) {
        const details = results.map((r) => {
          const allOk =
            r.table !== 'fail' && r.table !== 'sync' && r.layer !== 'fail' && r.style !== 'fail' && r.define !== 'fail';
          let type = '신규';
          if (r.table === 'existed') type = '동일';
          else if (r.table === 'sync' || (r.appendCount || r.conflictCount || r.removeCount)) type = '정합성 검증';
          else if (r.oldData != null && r.oldData > 0) type = '업데이트';
          return {
            group: r.group ?? '',
            name: r.file.replace(/\.shp$/i, ''),
            type,
            oldData: r.oldData ?? 0,
            newData: r.newData ?? 0,
            appendCount: r.appendCount ?? 0,
            conflictCount: r.conflictCount ?? 0,
            removeCount: r.removeCount ?? 0,
            contents: allOk ? '업데이트 완료' : r.table === 'sync' ? '정합성 검증 대기' : (r.error ?? '실패'),
            result: allOk ? '성공' : r.table === 'sync' ? '대기' : '실패',
            shpPath: r.shpPath ?? '',
          };
        });
        await call('', 'POST', {
          service: 'layerHistoryService',
          action: 'createLayerDetailHistoryBatch',
          params: { lhKey: hd.lhKey, details },
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const saveLogFile = useCallback(async (results: FileLogEntry[], rp: string) => {
    try {
      await call('', 'POST', {
        service: 'shpUploadService',
        action: 'savePostProcessLog',
        params: {
          relativePath: rp,
          results: results.map((r) => ({
            file: r.file,
            table: r.table,
            layer: r.layer,
            style: r.style,
            define: r.define,
            error: r.error,
            oldData: r.oldData,
            newData: r.newData,
            appendCount: r.appendCount,
            conflictCount: r.conflictCount,
            removeCount: r.removeCount,
          })),
        },
      });
    } catch {
      /* ignore */
    }
  }, []);

  const runProcess = useCallback(async () => {
    const rp = relativePath.trim();
    if (!rp) return;

    setProcessingError(null);
    setFileLogs([]);
    setPostProgress(null);
    setFinished(false);
    setPostProcessing(true);

    try {
      const statusRes = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'getShpStatusList',
        params: { relativePath: rp },
      });
      const sd = statusRes?.data ?? statusRes;
      const shpRows: Array<{
        sourceFile: string;
        pathOrResult: string;
        table: boolean;
        layer: boolean;
        style: boolean;
        define: boolean;
        geometryType?: string;
      }> = sd?.rows ?? [];

      if (shpRows.length === 0) {
        setProcessingError('선택한 폴더에 SHP 파일이 없습니다.');
        setPostProcessing(false);
        return;
      }

      const initialLogs: FileLogEntry[] = shpRows.map((r) => ({
        file: r.sourceFile,
        shpPath: r.pathOrResult,
        table: 'pending',
        layer: 'pending',
        style: 'pending',
        define: 'pending',
      }));
      setFileLogs(initialLogs);

      const results: FileLogEntry[] = [...initialLogs];
      const { memo: parsedMemo } = extractFolderPartsFromPath(shpRows[0]?.pathOrResult ?? rp);
      const folderMemo = workName?.trim() || parsedMemo;

      for (let i = 0; i < shpRows.length; i++) {
        const row = shpRows[i];
        setPostProgress({ current: i + 1, total: shpRows.length });
        const pre: PreStatus = {
          table: row.table,
          layer: row.layer,
          style: row.style,
          define: row.define,
          geometryType: row.geometryType,
        };
        const { group } = extractFolderPartsFromPath(row.pathOrResult);
        const result = await postProcessOneFile(row.pathOrResult, row.sourceFile, i, pre, group);
        result.group = group;
        results[i] = result;
      }

      setPostProgress(null);
      setFinished(true);
      await saveHistory(results, folderMemo);
      await saveLogFile(results, rp);
      onSuccess?.();
    } catch (e: unknown) {
      setProcessingError(e instanceof Error ? e.message : String(e));
    } finally {
      setPostProcessing(false);
    }
  }, [relativePath, workName, postProcessOneFile, saveHistory, saveLogFile, onSuccess]);

  useEffect(() => {
    if (!open) {
      processStartedRef.current = false;
      return;
    }
    if (processStartedRef.current) return;
    processStartedRef.current = true;
    void runProcess();
  }, [open, runProcess]);

  const handleSyncDone = useCallback(async () => {
    if (!syncModalTable) return;
    const { tableName, logIndex } = syncModalTable;
    const newCount = await getTableRowCount(tableName);
    setFileLogs((prev) =>
      prev.map((e, i) => {
        if (i !== logIndex) return e;
        return { ...e, table: 'created', newData: newCount, syncData: undefined };
      })
    );
    setSyncModalOpen(false);
    setSyncModalTable(null);
  }, [syncModalTable]);

  const handleClose = () => {
    if (postProcessing) return;
    processStartedRef.current = false;
    setFileLogs([]);
    setPostProgress(null);
    setFinished(false);
    setProcessingError(null);
    setSyncModalOpen(false);
    setSyncModalTable(null);
    onOpenChange(false);
  };

  const syncNeedCount = fileLogs.filter((s) => s.table === 'sync').length;
  const successCount = fileLogs.filter(
    (s) =>
      s.table !== 'fail' &&
      s.table !== 'pending' &&
      s.table !== 'sync' &&
      s.layer !== 'fail' &&
      s.layer !== 'pending' &&
      s.style !== 'fail' &&
      s.style !== 'pending' &&
      s.define !== 'fail' &&
      s.define !== 'pending'
  ).length;
  const failCount = fileLogs.filter(
    (s) => s.table === 'fail' || s.layer === 'fail' || s.style === 'fail' || s.define === 'fail'
  ).length;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent
          className="w-[1200px] h-[700px] min-w-[1200px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col gap-y-2 p-4"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {postProcessing ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden /> : null}
              SHP to DB — {folderName}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowOriginalSummaryStyle((prev) => !prev)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition shadow-sm ${
                showOriginalSummaryStyle
                  ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-border/80 bg-white text-slate-700 hover:bg-slate-100 dark:border-border/70 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {showOriginalSummaryStyle ? '변경 스타일' : '기존 스타일'}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden py-1">
            {processingError && (
              <div className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {processingError}
              </div>
            )}

            {postProcessing && postProgress && (
              <div className="shrink-0 px-3 py-2 border rounded bg-blue-50 dark:bg-blue-950/30">
                <div className="flex items-center text-xs gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  <span className="text-blue-700 dark:text-blue-300">
                    후처리 진행: {postProgress.current}/{postProgress.total}
                  </span>
                </div>
                <div className="h-2 bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${Math.round((postProgress.current / postProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <section className="flex-1 min-h-0 overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr className="text-center text-muted-foreground">
                    <th className="py-1 px-2 text-left">파일</th>
                    <th className="py-1 px-2 w-20">Table</th>
                    <th className="py-1 px-2 w-20">Layer</th>
                    <th className="py-1 px-2 w-20">Style</th>
                    <th className="py-1 px-2 w-20">Define</th>
                    <th className="py-1 px-2 w-14 text-right" title="처리 후 DB 행 수">
                      현재
                    </th>
                    <th className="py-1 px-2 w-12 text-right" title="속성 충돌 건수">
                      변경
                    </th>
                    <th className="py-1 px-2 w-12 text-right" title="신규 행 건수">
                      추가
                    </th>
                    <th className="py-1 px-2 text-left min-w-[8rem]">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {fileLogs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        {postProcessing ? '처리 중…' : '대기 중'}
                      </td>
                    </tr>
                  ) : (
                    fileLogs.map((log, i) => (
                      <tr key={i} className={cn('border-t', log.error ? 'bg-red-50 dark:bg-red-950/20' : '')}>
                        <td className="py-1 px-2 truncate max-w-[10rem]" title={log.file}>
                          {log.file}
                        </td>
                        <td className="py-1 px-2">
                          <StepBadge status={log.table} />
                        </td>
                        <td className="py-1 px-2">
                          <StepBadge status={log.layer} />
                        </td>
                        <td className="py-1 px-2">
                          <StepBadge status={log.style} />
                        </td>
                        <td className="py-1 px-2">
                          <StepBadge status={log.define} />
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                          {formatCountCell(
                            log.newData !== undefined
                              ? log.newData
                              : log.table === 'sync' && log.oldData !== undefined
                                ? log.oldData
                                : undefined
                          )}
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                          {formatCountCell(log.conflictCount ?? log.syncData?.conflictCount)}
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                          {formatCountCell(log.appendCount ?? log.syncData?.appendCount)}
                        </td>
                        <td className="py-1 px-2 truncate max-w-[12rem]">
                          {log.syncData ? (
                            <button
                              type="button"
                              className={cn(
                                'truncate',
                                showOriginalSummaryStyle
                                  ? 'flex items-center gap-0.5 text-[10px] text-orange-600 hover:underline dark:text-orange-400'
                                  : 'inline-flex max-w-full items-center gap-1 text-xs font-normal text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300'
                              )}
                              onClick={() => {
                                setSyncModalTable({
                                  tableName: log.syncData!.tableName,
                                  logIndex: i,
                                  shpPath: fileLogs[i]?.shpPath,
                                });
                                setSyncModalOpen(true);
                              }}
                            >
                              {showOriginalSummaryStyle ? (
                                <>
                                  <AlertTriangle className="h-3 w-3 shrink-0 text-orange-500" />
                                  충돌 {log.syncData.conflictCount} / 삭제 {log.syncData.removeCount} / 신규 {log.syncData.appendCount}
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                  <span className="whitespace-nowrap">충돌 {log.syncData.conflictCount}</span>
                                  <span className="text-amber-600/70 dark:text-amber-400/70">·</span>
                                  <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">삭제 {log.syncData.removeCount}</span>
                                  <span className="text-amber-600/70 dark:text-amber-400/70">·</span>
                                  <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">신규 {log.syncData.appendCount}</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-red-500" title={log.error ?? ''}>
                              {log.error ?? ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div ref={logEndRef} />
            </section>

            {finished && !postProcessing && fileLogs.length > 0 && (
              <div className="shrink-0 px-3 py-2 border rounded bg-muted/20 text-xs">
                후처리 완료:
                <strong className="text-green-600 ml-1">{successCount}건 성공</strong>
                {failCount > 0 && <strong className="text-red-500 ml-1">, {failCount}건 실패</strong>}
                {syncNeedCount > 0 && (
                  <strong className="text-orange-600 ml-1">, {syncNeedCount}건 정합성 검증 대기</strong>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {syncModalOpen && syncModalTable && (
        <SyncDetailModal
          dhKey={0}
          tableName={syncModalTable.tableName}
          shpPath={syncModalTable.shpPath ?? null}
          pendingOnly
          onClose={() => {
            setSyncModalOpen(false);
            setSyncModalTable(null);
          }}
          onRollbackDone={handleSyncDone}
        />
      )}
    </>
  );
}
