'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Folder, File as FileIcon, ChevronUp, RefreshCw, Check, X, Loader2, ArrowRight, Minus, AlertTriangle, Upload } from 'lucide-react';
import { useChunkedUpload, folderUploadOverallPercent } from '../useChunkedUpload';
import { SyncDetailModal } from './SyncDetailModal';
import { ShpWizardModal } from './ShpWizardModal';

type DirEntry = { name: string; isDirectory: boolean; size: number; mtime: string };
type DirListResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

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

type Props = {
  relativePath: string;
  onPathChange: (p: string) => void;
  onGoHistory?: () => void;
  onFinished?: () => void;
};

const SHP_EXTENSIONS = new Set(['.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx', '.fbn', '.fbx', '.ain', '.aih', '.ixs', '.mxs', '.atx', '.xml', '.qix']);
function isShpRelated(name: string) {
  const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return SHP_EXTENSIONS.has(ext);
}

export function ShpUploadTab({
  relativePath,
  onPathChange,
  onGoHistory,
  onFinished,
}: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const [folderUploading, setFolderUploading] = useState(false);
  const [folderProgress, setFolderProgress] = useState({ current: 0, total: 0 });
  const [folderUploadFileName, setFolderUploadFileName] = useState('');
  const folderAbortRef = useRef(false);

  const [postProcessing, setPostProcessing] = useState(false);
  const [fileLogs, _setFileLogs] = useState<FileLogEntry[]>([]);
  const fileLogsRef = useRef<FileLogEntry[]>(fileLogs);
  const setFileLogs = useCallback((v: FileLogEntry[] | ((prev: FileLogEntry[]) => FileLogEntry[])) => {
    _setFileLogs((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      fileLogsRef.current = next;
      return next;
    });
  }, []);
  const [postProgress, setPostProgress] = useState<{ current: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalTable, setSyncModalTable] = useState<{ tableName: string; logIndex: number; shpPath?: string } | null>(null);

  const { upload, cancel, reset, state: uploadState } = useChunkedUpload();

  const updateFileLog = useCallback((index: number, patch: Partial<FileLogEntry>) => {
    setFileLogs((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, [setFileLogs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fileLogs]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listDirectory',
        params: { relativePath },
      });
      const data: DirListResult = res?.data ?? res;
      const merged: DirEntry[] = [
        ...(data?.directories ?? []).map((name: string) => ({ name, isDirectory: true, size: 0, mtime: '' })),
        ...(data?.files ?? []).map((f: { name: string; size: number; modified?: string }) => ({
          name: f.name,
          isDirectory: false,
          size: f.size,
          mtime: f.modified ?? '',
        })),
      ];
      setEntries(merged);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const goUp = useCallback(() => {
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    onPathChange(parts.join('/'));
  }, [relativePath, onPathChange]);

  const goInto = useCallback(
    (name: string) => onPathChange(relativePath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + name),
    [relativePath, onPathChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const shpFiles = files.filter((f) => isShpRelated(f.name));
      if (shpFiles.length === 0) {
        alert('shapefile 관련 파일이 없습니다.\n폴더를 업로드하려면 "폴더 업로드" 버튼을 이용하세요.');
        return;
      }
      if (shpFiles.length === 1) {
        alert('SHP 파일은 폴더 단위로 업로드해야 합니다.\n"폴더 업로드" 버튼을 이용하세요.');
        return;
      }
      runBatchUpload(shpFiles, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleFolderUploadCancel = useCallback(() => {
    folderAbortRef.current = true;
    cancel();
  }, [cancel]);

  type PreStatus = { table: boolean; layer: boolean; style: boolean; define: boolean; geometryType?: string };

  /**
   * 폴더명에서 group, memo를 추출.
   * 양식: YYYYMMDD_EPSG_그룹명_메모  →  3번째=그룹, 4번째~=메모
   * 예: 20260310_5187_도로대장_케이맵 → { group: "도로대장", memo: "케이맵" }
   */
  function extractFolderParts(shpPath: string): { group?: string; memo?: string } {
    const parts = shpPath.replace(/\\/g, '/').split('/');
    const shpDataIdx = parts.indexOf('shp_data');
    if (shpDataIdx >= 0 && shpDataIdx + 1 < parts.length - 1) {
      const folderName = parts[shpDataIdx + 1];
      const segs = folderName.split('_');
      return {
        group: segs.length >= 3 ? segs[2] : undefined,
        memo: segs.length >= 4 ? segs.slice(3).join('_') : undefined,
      };
    }
    return {};
  }

  async function getTableRowCount(tableName: string): Promise<number> {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getLayerTableRowCount',
        params: { tableName },
      });
      const d = res?.data ?? res;
      return d?.count ?? 0;
    } catch { return 0; }
  }

  async function postProcessOneFile(pathOrResult: string, fileName: string, logIndex: number, pre?: PreStatus, group?: string): Promise<FileLogEntry> {
    const entry: FileLogEntry = { file: fileName, shpPath: pathOrResult, table: 'pending', layer: 'pending', style: 'pending', define: 'pending' };
    const baseName = fileName.replace(/\.shp$/i, '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');

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

    // --- Table step ---
    if (!pre?.table) {
      entry.table = 'running';
      updateFileLog(logIndex, { table: 'running' });
      try {
        const res = await call('', 'POST', { service: 'shpUploadService', action: 'createTableFromShp', params: { pathOrResult } });
        const d = res?.data ?? res;
        if (d?.success) {
          entry.table = 'created';
          entry.newData = await getTableRowCount(baseName);
          updateFileLog(logIndex, { table: 'created' });
          if (!geometryType) {
            try {
              const gtRes = await call('', 'POST', { service: 'devTestService', action: 'getLayerTableGeometryTypes', params: {} });
              const gtd = gtRes?.data ?? gtRes;
              if (gtd?.types?.[baseName]) geometryType = gtd.types[baseName];
            } catch { /* ignore */ }
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
        const cmpRes = await call('', 'POST', { service: 'shpUploadService', action: 'compareShpWithTable', params: { pathOrResult } });
        const cmp = cmpRes?.data ?? cmpRes;
        if (cmp?.success) {
          entry.appendCount = cmp.appendCount ?? 0;
          entry.conflictCount = cmp.conflictCount ?? 0;
          entry.removeCount = cmp.removeCount ?? 0;

          if (cmp.conflictCount === 0 && cmp.removeCount === 0) {
            if (cmp.appendCount > 0) {
              // sync_log에 미결로 저장됨 → 전부 자동 반영
              const logsRes = await call('', 'POST', { service: 'shpUploadService', action: 'getSyncLogs', params: { tableName: baseName } });
              const ld = logsRes?.data ?? logsRes;
              const pendingKeys = (ld?.rows ?? []).filter((r: Record<string, unknown>) => !r.sl_operation).map((r: Record<string, unknown>) => r.sl_key as number);
              if (pendingKeys.length > 0) {
                const applyRes = await call('', 'POST', { service: 'shpUploadService', action: 'applySyncEntries', params: { slKeys: pendingKeys } });
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

    // --- Layer / Style / Define steps ---
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

        const res = await call('', 'POST', { service: 'shpUploadService', action: step.action, params: { pathOrResult, ...extra } });
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
  }

  async function saveHistory(results: FileLogEntry[], folderMemo?: string) {
    try {
      const successCount = results.filter((r) => r.table !== 'fail' && r.layer !== 'fail' && r.style !== 'fail' && r.define !== 'fail').length;
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
          const allOk = r.table !== 'fail' && r.table !== 'sync' && r.layer !== 'fail' && r.style !== 'fail' && r.define !== 'fail';
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
            contents: allOk ? '업데이트 완료' : (r.table === 'sync' ? '정합성 검증 대기' : (r.error ?? '실패')),
            result: allOk ? '성공' : (r.table === 'sync' ? '대기' : '실패'),
            shpPath: r.shpPath ?? '',
          };
        });
        await call('', 'POST', {
          service: 'layerHistoryService',
          action: 'createLayerDetailHistoryBatch',
          params: { lhKey: hd.lhKey, details },
        });
      }
    } catch { /* ignore */ }
  }

  async function saveLogFile(results: FileLogEntry[], rp: string) {
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
    } catch { /* ignore */ }
  }

  const handleSyncDone = useCallback(async () => {
    if (!syncModalTable) return;
    const { tableName, logIndex } = syncModalTable;
    const newCount = await getTableRowCount(tableName);
    setFileLogs((prev) => prev.map((e, i) => {
      if (i !== logIndex) return e;
      return { ...e, table: 'created', newData: newCount, syncData: undefined };
    }));
    setSyncModalOpen(false);
    setSyncModalTable(null);
  }, [syncModalTable]);

  const runBatchUpload = useCallback(
    async (fileList: File[], fromDrop = false) => {
      const shpRelated = fileList.filter((f) => isShpRelated(f.name));
      if (shpRelated.length === 0) {
        alert('shapefile 관련 파일이 없습니다.');
        return;
      }

      setFileLogs([]);
      setPostProgress(null);
      setFinished(false);

      // Phase 1: Upload
      setFolderUploading(true);
      setFolderProgress({ current: 0, total: shpRelated.length });
      setFolderUploadFileName('');
      folderAbortRef.current = false;

      const uploadedShpPaths: { path: string; name: string }[] = [];

      for (let i = 0; i < shpRelated.length; i++) {
        if (folderAbortRef.current) break;
        const file = shpRelated[i];
        setFolderUploadFileName(file.name);
        setFolderProgress({ current: i, total: shpRelated.length });

        let shpSavePath = file.name;
        if (!fromDrop && (file as File & { webkitRelativePath?: string }).webkitRelativePath) {
          shpSavePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath!;
        }

        try {
          await upload(file, 'shp', { shpSavePath });
          if (file.name.toLowerCase().endsWith('.shp')) {
            const slashPath = shpSavePath.replace(/\\/g, '/');
            const parts = slashPath.split('/');
            let fullPath: string;
            if (parts.length > 1) {
              fullPath = 'shp_data/' + slashPath;
            } else {
              const rp = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
              fullPath = rp + '/' + slashPath;
            }
            uploadedShpPaths.push({ path: fullPath, name: file.name });
          }
        } catch { /* individual file fail */ }
      }

      setFolderUploading(false);
      setFolderProgress({ current: 0, total: 0 });
      setFolderUploadFileName('');
      folderAbortRef.current = false;
      fetchList();
      reset();

      if (uploadedShpPaths.length === 0) return;

      // Phase 2: Get current status for each file, then post-process
      setPostProcessing(true);

      type ShpRow = { pathOrResult: string; table: boolean; layer: boolean; style: boolean; define: boolean; geometryType?: string };
      const statusMap = new Map<string, ShpRow>();
      try {
        const uniqueDirs = new Set<string>();
        for (const s of uploadedShpPaths) {
          const dir = s.path.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || 'shp_data';
          uniqueDirs.add(dir);
        }
        for (const dir of uniqueDirs) {
          const res = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'getShpStatusList',
            params: { relativePath: dir },
          });
          const d = res?.data ?? res;
          for (const row of (d?.rows ?? [])) {
            statusMap.set(row.pathOrResult?.replace(/\\/g, '/'), row);
          }
        }
      } catch { /* ignore, will treat as all-new */ }

      const initialLogs: FileLogEntry[] = uploadedShpPaths.map((s) => ({
        file: s.name,
        table: 'pending',
        layer: 'pending',
        style: 'pending',
        define: 'pending',
      }));
      setFileLogs(initialLogs);

      const results: FileLogEntry[] = [...initialLogs];

      for (let i = 0; i < uploadedShpPaths.length; i++) {
        const { path: shpPath, name: shpName } = uploadedShpPaths[i];
        setPostProgress({ current: i + 1, total: uploadedShpPaths.length });
        const row = statusMap.get(shpPath.replace(/\\/g, '/'));
        const pre: PreStatus | undefined = row
          ? { table: row.table, layer: row.layer, style: row.style, define: row.define, geometryType: row.geometryType }
          : undefined;
        const { group } = extractFolderParts(shpPath);
        const result = await postProcessOneFile(shpPath, shpName, i, pre, group);
        result.group = group;
        results[i] = result;
      }

      setPostProgress(null);
      setPostProcessing(false);
      setFinished(true);

      const firstPath = uploadedShpPaths[0]?.path ?? '';
      const { memo: folderMemo } = extractFolderParts(firstPath);
      await saveHistory(results, folderMemo);

      const uploadDirs = new Set(uploadedShpPaths.map((s) => s.path.replace(/\\/g, '/').replace(/\/[^/]+$/, '')));
      const logDir = uploadDirs.size === 1 ? [...uploadDirs][0] : relativePath;
      await saveLogFile(results, logDir);
      fetchList();
      onFinished?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upload, reset, fetchList, relativePath, cancel]
  );

  const pathParts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const canGoUp = pathParts.length > 1;
  const isBusy = folderUploading || postProcessing;
  const syncNeedCount = fileLogs.filter((s) => s.table === 'sync').length;
  const successCount = fileLogs.filter((s) => s.table !== 'fail' && s.table !== 'pending' && s.table !== 'sync' && s.layer !== 'fail' && s.layer !== 'pending' && s.style !== 'fail' && s.style !== 'pending' && s.define !== 'fail' && s.define !== 'pending').length;
  const failCount = fileLogs.filter((s) => s.table === 'fail' || s.layer === 'fail' || s.style === 'fail' || s.define === 'fail').length;
  const folderUploadOverall =
    folderUploading && folderProgress.total > 0
      ? folderUploadOverallPercent(folderProgress.current, folderProgress.total, uploadState.progress)
      : 0;

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!canGoUp || isBusy} onClick={goUp} className="gap-1">
          <ChevronUp className="w-3.5 h-3.5" /> 상위로
        </Button>
        <span className="text-xs text-muted-foreground truncate flex-1">{relativePath}</span>
        <Button variant="outline" size="sm" onClick={fetchList} className="gap-1" disabled={isBusy}>
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
        <Button size="sm" onClick={() => setWizardOpen(true)} disabled={isBusy}>
          <Upload className="w-3.5 h-3.5" />
          폴더 업로드
        </Button>
      </div>

      {!isBusy && fileLogs.length === 0 && (
        <section
          className="flex-1 min-h-0 overflow-auto border rounded"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
          ) : listError ? (
            <div className="flex items-center justify-center h-full text-xs text-red-500">{listError}</div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              파일 없음 (폴더를 드래그하거나 &quot;폴더 업로드&quot; 버튼을 사용하세요)
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 px-2 w-6" />
                  <th className="py-1 px-2">이름</th>
                  <th className="py-1 px-2 w-20 text-right">크기</th>
                  <th className="py-1 px-2 w-44">수정일</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.name}
                    className={cn('border-t hover:bg-muted/40', e.isDirectory && 'cursor-pointer')}
                    onClick={e.isDirectory ? () => goInto(e.name) : undefined}
                  >
                    <td className="py-1 px-2">
                      {e.isDirectory ? <Folder className="w-4 h-4 text-yellow-500" /> : <FileIcon className="w-4 h-4 text-muted-foreground" />}
                    </td>
                    <td className="py-1 px-2 truncate max-w-[16rem]" title={e.name}>{e.name}</td>
                    <td className="py-1 px-2 text-right whitespace-nowrap">{e.isDirectory ? '—' : formatSize(e.size)}</td>
                    <td className="py-1 px-2 whitespace-nowrap">{e.mtime ? new Date(e.mtime).toLocaleString('ko-KR') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* upload progress */}
      {folderUploading && (
        <div className="shrink-0 px-3 py-2 border rounded bg-muted/20">
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <div className="min-w-0 flex-1">
              <span className="font-medium">
                업로드{' '}
                {folderProgress.total > 0
                  ? `${Math.min(folderProgress.current + 1, folderProgress.total)}/${folderProgress.total}`
                  : ''}{' '}
                · 전체 {folderUploadOverall}%
              </span>
              {folderUploadFileName ? (
                <p className="truncate text-muted-foreground mt-0.5" title={folderUploadFileName}>
                  {folderUploadFileName}
                  {uploadState.totalChunks > 0
                    ? ` · 청크 ${uploadState.currentChunk}/${uploadState.totalChunks} (${uploadState.progress}%)`
                    : ''}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" className="h-5 shrink-0 text-xs" onClick={handleFolderUploadCancel}>
              취소
            </Button>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${folderUploadOverall}%` }}
            />
          </div>
        </div>
      )}

      {/* post-processing progress bar */}
      {postProcessing && postProgress && (
        <div className="shrink-0 px-3 py-2 border rounded bg-blue-50 dark:bg-blue-950/30">
          <div className="flex items-center text-xs gap-1">
            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
            <span className="text-blue-700 dark:text-blue-300">
              후처리 진행: {postProgress.current}/{postProgress.total}
            </span>
          </div>
          <div className="h-2 bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden mt-1">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((postProgress.current / postProgress.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* real-time table log */}
      {(postProcessing || fileLogs.length > 0) && (
        <section className="flex-1 min-h-0 overflow-auto border rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-center text-muted-foreground">
                <th className="py-1 px-2 text-left">파일</th>
                <th className="py-1 px-2 w-20">Table</th>
                <th className="py-1 px-2 w-20">Layer</th>
                <th className="py-1 px-2 w-20">Style</th>
                <th className="py-1 px-2 w-20">Define</th>
                <th className="py-1 px-2 w-14 text-right" title="처리 후 DB 행 수(정합성 검증 대기 시 검증 전 DB)">현재</th>
                <th className="py-1 px-2 w-12 text-right" title="속성 충돌(변경 필요) 건수">변경</th>
                <th className="py-1 px-2 w-12 text-right" title="SHP 기준 신규 행(추가) 건수">추가</th>
                <th className="py-1 px-2 text-left min-w-[8rem]">비고</th>
              </tr>
            </thead>
            <tbody>
              {fileLogs.map((log, i) => (
                <tr key={i} className={cn('border-t', log.error ? 'bg-red-50 dark:bg-red-950/20' : '')}>
                  <td className="py-1 px-2 truncate max-w-[10rem]" title={log.file}>{log.file}</td>
                  <td className="py-1 px-2"><StepBadge status={log.table} /></td>
                  <td className="py-1 px-2"><StepBadge status={log.layer} /></td>
                  <td className="py-1 px-2"><StepBadge status={log.style} /></td>
                  <td className="py-1 px-2"><StepBadge status={log.define} /></td>
                  <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                    {formatCountCell(
                      log.newData !== undefined
                        ? log.newData
                        : (log.table === 'sync' && log.oldData !== undefined ? log.oldData : undefined)
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
                        className="inline-flex max-w-full items-center gap-1 truncate text-xs font-normal text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                        onClick={() => { setSyncModalTable({ tableName: log.syncData!.tableName, logIndex: i, shpPath: fileLogs[i]?.shpPath }); setSyncModalOpen(true); }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="whitespace-nowrap">충돌 {log.syncData.conflictCount}</span>
                        <span className="text-amber-600/70 dark:text-amber-400/70">·</span>
                        <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">삭제 {log.syncData.removeCount}</span>
                        <span className="text-amber-600/70 dark:text-amber-400/70">·</span>
                        <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">신규 {log.syncData.appendCount}</span>
                      </button>
                    ) : (
                      <span className="text-red-500" title={log.error ?? ''}>{log.error ?? ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={logEndRef} />
        </section>
      )}

      {/* completion summary */}
      {finished && !isBusy && fileLogs.length > 0 && (
        <div className="shrink-0 px-3 py-2 border rounded bg-muted/20 flex items-center justify-between">
          <span className="text-xs">
            후처리 완료:
            <strong className="text-green-600 ml-1">{successCount}건 성공</strong>
            {failCount > 0 && <strong className="text-red-500 ml-1">, {failCount}건 실패</strong>}
            {syncNeedCount > 0 && <strong className="text-orange-600 ml-1">, {syncNeedCount}건 정합성 검증 대기</strong>}
          </span>
          <div className="flex items-center gap-2">
            {onGoHistory && (
              <button type="button" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5" onClick={onGoHistory}>
                이력 조회 <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { setFileLogs([]); setFinished(false); }}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* sync detail modal */}
      {syncModalOpen && syncModalTable && (
        <SyncDetailModal
          dhKey={0}
          tableName={syncModalTable.tableName}
          shpPath={syncModalTable.shpPath ?? null}
          pendingOnly
          onClose={() => { setSyncModalOpen(false); setSyncModalTable(null); }}
          onRollbackDone={handleSyncDone}
        />
      )}

      <ShpWizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        relativePath={relativePath}
        onSuccess={() => {
          fetchList();
          onGoHistory?.();
          onFinished?.();
        }}
      />
    </div>
  );
}

function StepBadge({ status }: { status: StepStatus }) {
  switch (status) {
    case 'pending':
      return <Minus className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 mx-auto" />;
    case 'created':
      return <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-green-700 dark:text-green-400">생성</span>;
    case 'existed':
      return <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-blue-600 dark:text-blue-400">기존</span>;
    case 'sync':
      return <span className="inline-flex items-center justify-center w-full text-[10px] font-medium text-orange-600 dark:text-orange-400">정합성 검증</span>;
    case 'fail':
      return <X className="w-3.5 h-3.5 text-red-500 mx-auto" />;
    default:
      return null;
  }
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatCountCell(n: number | undefined) {
  return n === undefined ? '—' : String(n);
}
