'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { useChunkedUpload, folderUploadOverallPercent } from '../useChunkedUpload';
import { Check, Loader2, X, ChevronLeft, ChevronRight, Minus, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseShpFolderName } from './parseShpFolderMeta';
import { type FolderPickFile } from './pickShpFolderFiles';
import { SyncDetailModal } from './SyncDetailModal';
import { isShpSyncDetailModalTarget } from './shpModalLayers';

type LayerRow = {
  name: string;
  size?: number;
  modified?: string;
  schemaStatus?: 'pending' | 'checking' | 'new' | 'ok' | 'mismatch' | 'error';
  schemaDetail?: string;
};

type ShpStatusRow = {
  sourceFile: string;
  pathOrResult: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
};

type LocalSource = { type: 'local'; files: FolderPickFile[]; folderName: string };
type ServerSource = { type: 'server'; relativePath: string; folderName: string };
type Source = LocalSource | ServerSource;

const TOTAL_STEPS = 4;
const WIZARD_FOOTER_BTN_CLASS = 'min-w-[7rem]';
const STEP_LABELS: Record<number, string> = {
  1: '폴더 선택',
  2: '레이어 구성요소 검사',
  3: '정합성 검증',
  4: '결과',
};

type ConsistencyRow = {
  sourceFile: string;
  pathOrResult: string;
  tableName: string;
  isNew: boolean;
  appendCount: number;
  conflictCount: number;
  removeCount: number;
  unchangedCount: number;
  error?: string;
};

function tableNameFromShpPath(pathOrResult: string, sourceFile: string): string {
  const base = pathOrResult.split(/[/\\]/).pop() ?? sourceFile;
  return base.replace(/\.shp$/i, '');
}

function consistencyNeedsReview(row: ConsistencyRow): boolean {
  return !row.error && !row.isNew && row.appendCount + row.conflictCount + row.removeCount > 0;
}

type ReportRow = {
  sourceFile: string;
  tableName: string;
  pathOrResult: string;
  layerType: '신규' | '기존';
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
  rowCount: number | null;
  syncAppend: number;
  syncUpdated: number;
  syncKept: number;
  syncRemoved: number;
  syncSummary: string;
  result: '성공' | '실패';
  remark: string;
};

async function fetchTableRowCount(tableName: string): Promise<number> {
  try {
    const res = await call('', 'POST', {
      service: 'devTestService',
      action: 'getLayerTableRowCount',
      params: { tableName },
    });
    const d = res?.data ?? res;
    return typeof d?.count === 'number' ? d.count : 0;
  } catch {
    return 0;
  }
}

function buildSyncSummary(append: number, updated: number, kept: number, removed: number): string {
  const parts: string[] = [];
  if (append > 0) parts.push(`추가 ${append}`);
  if (updated > 0) parts.push(`변경반영 ${updated}`);
  if (kept > 0) parts.push(`DB유지 ${kept}`);
  if (removed > 0) parts.push(`삭제 ${removed}`);
  return parts.length > 0 ? parts.join(' · ') : '변경 없음';
}

function syncLogAppliedInSession(log: Record<string, unknown>, sessionStartedAt: number): boolean {
  if (log.sl_rolled_back === true) return false;
  const op = log.sl_operation;
  if (!op || typeof op !== 'string') return false;
  const appliedRaw = log.sl_applied_at;
  if (!appliedRaw) return false;
  const appliedAt = new Date(String(appliedRaw)).getTime();
  if (Number.isNaN(appliedAt)) return false;
  return appliedAt >= sessionStartedAt - 60_000;
}

const SHP_EXTENSIONS = new Set([
  '.shp',
  '.shx',
  '.dbf',
  '.prj',
  '.cpg',
  '.sbn',
  '.sbx',
  '.fbn',
  '.fbx',
  '.ain',
  '.aih',
  '.ixs',
  '.mxs',
  '.atx',
  '.xml',
  '.qix',
]);

function isShpRelated(name: string) {
  const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return SHP_EXTENSIONS.has(ext);
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function folderNameFromLocalFiles(files: FolderPickFile[]): string {
  const rel = files[0]?.webkitRelativePath?.replace(/\\/g, '/');
  if (rel) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length >= 2) return parts[0];
  }
  return 'uploaded_folder';
}

function StatusCell({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="mx-auto h-3.5 w-3.5 text-green-600" aria-label="존재" />
  ) : (
    <X className="mx-auto h-3.5 w-3.5 text-red-400" aria-label="없음" />
  );
}

function SchemaIconCell({ status }: { status?: LayerRow['schemaStatus'] }) {
  if (!status || status === 'pending') {
    return <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/40" aria-label="대기" />;
  }
  if (status === 'checking') {
    return <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-blue-500" aria-label="검증 중" />;
  }
  if (status === 'ok' || status === 'new') {
    return <Check className="mx-auto h-3.5 w-3.5 text-green-600" aria-label="일치" />;
  }
  return <X className="mx-auto h-3.5 w-3.5 text-red-500" aria-label="불일치" />;
}

function schemaRemark(status?: LayerRow['schemaStatus'], detail?: string): string {
  if (status === 'mismatch') return detail ?? 'SHP 파일과 DB 테이블 구조가 일치하지 않습니다.';
  if (status === 'error') return detail ?? '구조 검증 중 오류가 발생했습니다.';
  return '';
}

function isSchemaFailed(status?: LayerRow['schemaStatus']) {
  return status === 'mismatch' || status === 'error';
}

function filterStatusRowsForLayers(rows: ShpStatusRow[], layerList: LayerRow[]) {
  const failedNames = new Set(
    layerList.filter((l) => isSchemaFailed(l.schemaStatus)).map((l) => l.name.toLowerCase())
  );
  if (failedNames.size === 0) return rows;
  return rows.filter((r) => !failedNames.has(r.sourceFile.toLowerCase()));
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relativePath?: string;
  showServerPickButton?: boolean;
  onPickFromServer?: () => void;
  serverFolderSelection?: { relativePath: string; folderName: string } | null;
  onClearServerFolderSelection?: () => void;
  configureVisible?: boolean;
  onSuccess?: () => void;
};

export function ShpWizardModal({
  open,
  onOpenChange,
  relativePath = 'shp_data',
  showServerPickButton,
  onPickFromServer,
  serverFolderSelection,
  onClearServerFolderSelection,
  configureVisible = true,
  onSuccess,
}: Props) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const workNameRef = useRef('');
  const consistencyStartedRef = useRef(false);
  const step1NextClickRef = useRef(0);
  const step3NextClickRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());
  const { upload, reset, state: uploadState } = useChunkedUpload();

  const [step, setStep] = useState(1);
  const [source, setSource] = useState<Source | null>(null);
  const [workName, setWorkName] = useState('');
  const [epsg, setEpsg] = useState('');
  const [layers, setLayers] = useState<LayerRow[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploadFileName, setUploadFileName] = useState('');
  const [schemaChecking, setSchemaChecking] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);

  const [readyPath, setReadyPath] = useState<string | null>(null);
  const [statusRows, setStatusRows] = useState<ShpStatusRow[]>([]);
  const [consistencyRows, setConsistencyRows] = useState<ConsistencyRow[]>([]);
  const [consistencyChecking, setConsistencyChecking] = useState(false);
  const [consistencyDone, setConsistencyDone] = useState(false);
  const [componentSetupRunning, setComponentSetupRunning] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalTarget, setSyncModalTarget] = useState<{ tableName: string; shpPath: string } | null>(null);
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportLoaded, setReportLoaded] = useState(false);

  const folderInputId = 'shp-wizard-folder-input';

  useEffect(() => {
    if (open) sessionStartedAtRef.current = Date.now();
  }, [open]);

  useEffect(() => {
    workNameRef.current = workName;
  }, [workName]);

  const applyFolderMeta = useCallback((folderName: string) => {
    const meta = parseShpFolderName(folderName);
    const name = meta.workName ?? '';
    workNameRef.current = name;
    setWorkName(name);
    setEpsg(meta.epsg ?? '');
    return name;
  }, []);

  const resetForm = useCallback(() => {
    setStep(1);
    setSource(null);
    setWorkName('');
    workNameRef.current = '';
    setEpsg('');
    setLayers([]);
    setLayersLoading(false);
    setLayersError(null);
    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    setUploadFileName('');
    setSchemaChecking(false);
    setStepBusy(false);
    setReadyPath(null);
    setStatusRows([]);
    setConsistencyRows([]);
    setConsistencyChecking(false);
    setConsistencyDone(false);
    setComponentSetupRunning(false);
    consistencyStartedRef.current = false;
    step1NextClickRef.current = 0;
    step3NextClickRef.current = 0;
    setSyncModalOpen(false);
    setSyncModalTarget(null);
    setReportRows([]);
    setReportLoading(false);
    setReportLoaded(false);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const uploadLocalFolder = useCallback(
    async (local: LocalSource): Promise<string> => {
      const shpRelated = local.files.filter((f) => isShpRelated(f.name));
      if (shpRelated.length === 0) throw new Error('shapefile 관련 파일이 없습니다.');

      setUploading(true);
      setUploadProgress({ current: 0, total: shpRelated.length });
      setUploadFileName('');

      try {
        for (let i = 0; i < shpRelated.length; i++) {
          const file = shpRelated[i];
          setUploadFileName(file.name);
          setUploadProgress({ current: i, total: shpRelated.length });
          let shpSavePath = file.name;
          const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          if (rel) shpSavePath = rel.replace(/\\/g, '/');

          const uploadResult = await upload(file, 'shp', { shpSavePath });
          if (uploadResult?.error) throw new Error(uploadResult.error);
        }

        const slashPath = shpRelated[0]
          ? ((shpRelated[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.replace(/\\/g, '/') ??
            shpRelated[0].name)
          : '';
        const parts = slashPath.split('/');
        if (parts.length > 1) {
          return `shp_data/${parts.slice(0, -1).join('/')}`;
        }
        const rp = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
        return `${rp}/${local.folderName}`;
      } finally {
        setUploading(false);
        setUploadFileName('');
        setUploadProgress({ current: 0, total: 0 });
        reset();
      }
    },
    [upload, reset, relativePath]
  );

  const fetchStatusList = useCallback(async (path: string) => {
    const res = await call('', 'POST', {
      service: 'shpUploadService',
      action: 'getShpStatusList',
      params: { relativePath: path },
    });
    const data = res?.data ?? res;
    return (data?.rows ?? []) as ShpStatusRow[];
  }, []);

  const runConsistencyCheck = useCallback(async () => {
    if (statusRows.length === 0) return;
    setLayersError(null);
    setConsistencyChecking(true);
    setConsistencyDone(false);
    setConsistencyRows([]);
    try {
      const results: ConsistencyRow[] = [];
      for (const row of statusRows) {
        const tableName = tableNameFromShpPath(row.pathOrResult, row.sourceFile);
        if (!row.table) {
          results.push({
            sourceFile: row.sourceFile,
            pathOrResult: row.pathOrResult,
            tableName,
            isNew: true,
            appendCount: 0,
            conflictCount: 0,
            removeCount: 0,
            unchangedCount: 0,
            error: '테이블 없음 — 2단계에서 구성요소를 먼저 생성하세요.',
          });
          continue;
        }
        const res = await call('', 'POST', {
          service: 'shpUploadService',
          action: 'compareShpWithTable',
          params: { pathOrResult: row.pathOrResult },
        });
        const d = res?.data ?? res;
        const resolvedTableName =
          typeof d?.tableName === 'string' && d.tableName ? d.tableName : tableName;
        if (!d?.success) {
          results.push({
            sourceFile: row.sourceFile,
            pathOrResult: row.pathOrResult,
            tableName: resolvedTableName,
            isNew: false,
            appendCount: 0,
            conflictCount: 0,
            removeCount: 0,
            unchangedCount: 0,
            error: typeof d?.error === 'string' ? d.error : '정합성 검증 실패',
          });
        } else {
          results.push({
            sourceFile: row.sourceFile,
            pathOrResult: row.pathOrResult,
            tableName: resolvedTableName,
            isNew: false,
            appendCount: d.appendCount ?? 0,
            conflictCount: d.conflictCount ?? 0,
            removeCount: d.removeCount ?? 0,
            unchangedCount: d.unchangedCount ?? 0,
          });
        }
      }
      setConsistencyRows(results);
      setConsistencyDone(true);
    } catch (e: unknown) {
      setLayersError(e instanceof Error ? e.message : String(e));
    } finally {
      setConsistencyChecking(false);
    }
  }, [statusRows]);

  const handleSyncModalDone = useCallback(() => {
    setSyncModalOpen(false);
    setSyncModalTarget(null);
    consistencyStartedRef.current = false;
    setConsistencyDone(false);
    void runConsistencyCheck();
  }, [runConsistencyCheck]);

  const openSyncReview = useCallback((row: ConsistencyRow) => {
    setSyncModalTarget({ tableName: row.tableName, shpPath: row.pathOrResult });
    setSyncModalOpen(true);
  }, []);

  const loadReport = useCallback(async () => {
    if (statusRows.length === 0) {
      setReportRows([]);
      setReportLoaded(true);
      return;
    }
    setReportLoading(true);
    setLayersError(null);
    const sessionStartedAt = sessionStartedAtRef.current;
    try {
      const rows: ReportRow[] = [];
      for (const status of statusRows) {
        const tableName = tableNameFromShpPath(status.pathOrResult, status.sourceFile);
        const consistency = consistencyRows.find((r) => r.pathOrResult === status.pathOrResult);
        const layerMeta = layers.find((l) => l.name.toLowerCase() === status.sourceFile.toLowerCase());
        const isNewLayer = layerMeta?.schemaStatus === 'new';
        const componentsOk = status.table && status.layer && status.style && status.define;

        let syncAppend = 0;
        let syncUpdated = 0;
        let syncKept = 0;
        let syncRemoved = 0;
        if (!isNewLayer && status.table) {
          const syncRes = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'getSyncLogs',
            params: { tableName },
          });
          const syncData = syncRes?.data ?? syncRes;
          const logs: Array<Record<string, unknown>> = syncData?.success ? (syncData.rows ?? []) : [];
          for (const log of logs) {
            if (!syncLogAppliedInSession(log, sessionStartedAt)) continue;
            const op = String(log.sl_operation ?? '');
            if (op === 'append') syncAppend++;
            else if (op === 'conflict') syncUpdated++;
            else if (op === 'kept') syncKept++;
            else if (op === 'remove') syncRemoved++;
          }
        }

        const rowCount = componentsOk ? await fetchTableRowCount(tableName) : null;
        const syncSummary = isNewLayer
          ? '신규 레이어 import'
          : buildSyncSummary(syncAppend, syncUpdated, syncKept, syncRemoved);
        const hasError = !!consistency?.error || !componentsOk;
        const remark = consistency?.error
          ?? (!componentsOk ? 'Table·Layer·Style·Define 구성 미완료' : '');

        rows.push({
          sourceFile: status.sourceFile,
          tableName,
          pathOrResult: status.pathOrResult,
          layerType: isNewLayer ? '신규' : '기존',
          table: status.table,
          layer: status.layer,
          style: status.style,
          define: status.define,
          rowCount,
          syncAppend,
          syncUpdated,
          syncKept,
          syncRemoved,
          syncSummary,
          result: hasError ? '실패' : '성공',
          remark,
        });
      }
      setReportRows(rows);
      setReportLoaded(true);
    } catch (e: unknown) {
      setLayersError(e instanceof Error ? e.message : String(e));
      setReportRows([]);
      setReportLoaded(false);
    } finally {
      setReportLoading(false);
    }
  }, [statusRows, consistencyRows, layers]);

  const runSchemaValidation = useCallback(async (relPath: string) => {
    setSchemaChecking(true);
    setLayers((prev) =>
      prev.map((l) => ({ ...l, schemaStatus: 'checking' as const, schemaDetail: undefined }))
    );
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'compareShpFolderSchema',
        params: { relativePath: relPath },
      });
      const d = res?.data ?? res;
      const results: Array<{
        sourceFile: string;
        ok: boolean;
        isNew: boolean;
        message?: string;
        error?: string;
        success?: boolean;
      }> = d?.results ?? [];

      const byFile = new Map(results.map((r) => [r.sourceFile.toLowerCase(), r]));
      let hasMismatch = false;

      setLayers((prev) =>
        prev.map((l) => {
          const r = byFile.get(l.name.toLowerCase());
          if (!r) {
            return { ...l, schemaStatus: 'error' as const, schemaDetail: '검증 결과 없음' };
          }
          if (!r.success && r.error) {
            hasMismatch = true;
            return { ...l, schemaStatus: 'error' as const, schemaDetail: r.error };
          }
          if (r.isNew) {
            return { ...l, schemaStatus: 'new' as const, schemaDetail: '신규' };
          }
          if (r.ok) {
            return { ...l, schemaStatus: 'ok' as const, schemaDetail: '구조 일치' };
          }
          hasMismatch = true;
          return { ...l, schemaStatus: 'mismatch' as const, schemaDetail: r.message ?? '구조 불일치' };
        })
      );

      if (hasMismatch) {
        setLayersError('일부 레이어의 SHP 파일과 DB 테이블 구조가 맞지 않습니다. 비고 열을 확인한 뒤 SHP 또는 DB를 수정하고 다시 선택하세요.');
      } else {
        setLayersError((prev) =>
          prev ===
          '일부 레이어의 SHP 파일과 DB 테이블 구조가 맞지 않습니다. 비고 열을 확인한 뒤 SHP 또는 DB를 수정하고 다시 선택하세요.'
            ? null
            : prev
        );
      }
    } catch (e: unknown) {
      setLayersError(e instanceof Error ? e.message : String(e));
      setLayers((prev) =>
        prev.map((l) => ({ ...l, schemaStatus: 'error' as const, schemaDetail: '검증 실패' }))
      );
    } finally {
      setSchemaChecking(false);
    }
  }, []);

  const runComponentSetup = useCallback(async () => {
    if (!readyPath) return;
    setLayersError(null);
    setComponentSetupRunning(true);
    try {
      const shpPaths = statusRows.map((r) => r.pathOrResult);
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'processShpBatch',
        params: shpPaths.length > 0 ? { relativePath: readyPath, shpPaths } : { relativePath: readyPath },
      });
      const d = res?.data ?? res;
      const batchResults: Array<{
        file: string;
        table: { success: boolean };
        layer: { success: boolean };
        style: { success: boolean };
        define: { success: boolean };
      }> = d?.results ?? [];

      const pathSet = new Set(statusRows.map((r) => r.pathOrResult.replace(/\\/g, '/')));
      const rows = (await fetchStatusList(readyPath)).filter((r) =>
        pathSet.has(r.pathOrResult.replace(/\\/g, '/'))
      );
      if (rows.length === 0) {
        throw new Error('상태를 확인할 SHP 파일이 없습니다.');
      }
      setStatusRows(rows);

      const failCount = batchResults.filter(
        (r) => !r.table.success || !r.layer.success || !r.style.success || !r.define.success
      ).length;
      if (failCount > 0) {
        setLayersError(`${failCount}개 파일의 Table·Layer·Style·Define 생성에 실패했습니다.`);
      } else if (d?.error) {
        setLayersError(String(d.error));
      }
    } catch (e: unknown) {
      setLayersError(e instanceof Error ? e.message : String(e));
    } finally {
      setComponentSetupRunning(false);
    }
  }, [readyPath, fetchStatusList, statusRows]);

  const loadServerFolder = useCallback(
    async (relPath: string, folderName: string) => {
      setLayersLoading(true);
      setLayersError(null);
      step1NextClickRef.current = 0;
      try {
        const res = await call('', 'POST', {
          service: 'fileManagerService',
          action: 'listDirectory',
          params: { relativePath: relPath },
        });
        const data = res?.data ?? res;
        const shpFiles: LayerRow[] = (data?.files ?? [])
          .filter((f: { name: string }) => /\.shp$/i.test(f.name))
          .map((f: { name: string; size: number; modified?: string }) => ({
            name: f.name,
            size: f.size,
            modified: f.modified,
          }));

        if (shpFiles.length === 0) {
          setLayersError('선택한 폴더에 SHP 파일이 없습니다.');
          setSource({ type: 'server', relativePath: relPath, folderName });
          applyFolderMeta(folderName);
          setLayers([]);
          setReadyPath(null);
          return;
        }

        setSource({ type: 'server', relativePath: relPath, folderName });
        applyFolderMeta(folderName);
        setLayers(shpFiles.map((f) => ({ name: f.name, size: f.size, modified: f.modified, schemaStatus: 'pending' as const })));
        setReadyPath(relPath);
        void runSchemaValidation(relPath);
      } catch (e: unknown) {
        setLayersError(e instanceof Error ? e.message : String(e));
        setLayers([]);
        setReadyPath(null);
      } finally {
        setLayersLoading(false);
      }
    },
    [applyFolderMeta, runSchemaValidation]
  );

  useEffect(() => {
    if (!open || !serverFolderSelection) return;
    void loadServerFolder(serverFolderSelection.relativePath, serverFolderSelection.folderName);
    onClearServerFolderSelection?.();
  }, [open, serverFolderSelection, loadServerFolder, onClearServerFolderSelection]);

  const applyLocalFolderFiles = useCallback(
    (files: FolderPickFile[]) => {
      const shpFiles = files.filter((f) => f.name.toLowerCase().endsWith('.shp'));
      if (shpFiles.length === 0) {
        setLayersError('선택한 폴더에 SHP 파일이 없습니다.');
        setSource(null);
        setLayers([]);
        setReadyPath(null);
        setStatusRows([]);
        return;
      }

      const folderName = folderNameFromLocalFiles(files);
      const localSource: LocalSource = { type: 'local', files, folderName };
      setSource(localSource);
      applyFolderMeta(folderName);
      setLayers(shpFiles.map((f) => ({ name: f.name, size: f.size, schemaStatus: 'pending' as const })));
      setLayersError(null);
      setReadyPath(null);
      setStatusRows([]);
      setConsistencyRows([]);
      setConsistencyDone(false);
      setConsistencyChecking(false);
      consistencyStartedRef.current = false;
      step1NextClickRef.current = 0;
      setStep(1);

      void (async () => {
        try {
          const path = await uploadLocalFolder(localSource);
          setReadyPath(path);
          await runSchemaValidation(path);
        } catch (e: unknown) {
          setLayersError(e instanceof Error ? e.message : String(e));
          setReadyPath(null);
        }
      })();
    },
    [applyFolderMeta, uploadLocalFolder, runSchemaValidation]
  );

  const handleLocalFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList?.length) {
      e.target.value = '';
      return;
    }
    const files = Array.from(fileList) as FolderPickFile[];
    e.target.value = '';
    applyLocalFolderFiles(files);
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!source || layers.length === 0 || !readyPath || uploading || stepBusy || schemaChecking) return;

      const schemaDone =
        layers.length > 0 &&
        layers.every((l) => l.schemaStatus && l.schemaStatus !== 'pending' && l.schemaStatus !== 'checking');
      if (!schemaDone) return;

      const proceedableLayers = layers.filter((l) => l.schemaStatus === 'ok' || l.schemaStatus === 'new');
      const allSchemaOk =
        layers.length > 0 &&
        layers.every((l) => l.schemaStatus === 'ok' || l.schemaStatus === 'new');

      if (!allSchemaOk) {
        if (proceedableLayers.length === 0) return;
        step1NextClickRef.current += 1;
        if (step1NextClickRef.current < 5) return;
        step1NextClickRef.current = 0;
      } else {
        step1NextClickRef.current = 0;
      }

      setLayersError(null);
      setStepBusy(true);
      try {
        const rows = await fetchStatusList(readyPath);
        const filtered = filterStatusRowsForLayers(rows, layers);
        if (filtered.length === 0) {
          throw new Error('상태를 확인할 SHP 파일이 없습니다.');
        }
        if (!allSchemaOk) {
          setLayers((prev) => prev.filter((l) => l.schemaStatus === 'ok' || l.schemaStatus === 'new'));
        }
        setStatusRows(filtered);
        setConsistencyRows([]);
        setConsistencyDone(false);
        setConsistencyChecking(false);
        consistencyStartedRef.current = false;
        setStep(2);
      } catch (e: unknown) {
        setLayersError(e instanceof Error ? e.message : String(e));
      } finally {
        setStepBusy(false);
      }
      return;
    }

    if (step === 2) {
      if (!allComponentsReady) return;
      setLayersError(null);
      setConsistencyRows([]);
      setConsistencyDone(false);
      consistencyStartedRef.current = false;
      step3NextClickRef.current = 0;
      setStep(3);
      return;
    }

    if (step === 3) {
      if (!consistencyDone || consistencyChecking || syncModalOpen) return;

      const unresolved = consistencyRows.filter(consistencyNeedsReview);
      const hasErrors = consistencyRows.some((r) => !!r.error);
      const allConsistencyOk = unresolved.length === 0 && !hasErrors;

      if (!allConsistencyOk) {
        step3NextClickRef.current += 1;
        if (step3NextClickRef.current < 5) return;
        step3NextClickRef.current = 0;
      } else {
        step3NextClickRef.current = 0;
      }

      setLayersError(null);
      setReportLoaded(false);
      setReportRows([]);
      setStep(4);
    }
  };

  useEffect(() => {
    if (step === 3 && !consistencyStartedRef.current && statusRows.length > 0 && !consistencyDone && !consistencyChecking) {
      consistencyStartedRef.current = true;
      void runConsistencyCheck();
    }
  }, [step, statusRows.length, consistencyDone, consistencyChecking, runConsistencyCheck]);

  useEffect(() => {
    if (step === 4 && !reportLoaded && !reportLoading) {
      void loadReport();
    }
  }, [step, reportLoaded, reportLoading, loadReport]);

  const handlePrev = () => {
    if (step === 4) {
      setStep(3);
      setReportLoaded(false);
      setReportRows([]);
      setLayersError(null);
      return;
    }
    if (step === 3) {
      setStep(2);
      setConsistencyRows([]);
      setConsistencyDone(false);
      setConsistencyChecking(false);
      consistencyStartedRef.current = false;
      step3NextClickRef.current = 0;
      setLayersError(null);
      return;
    }
    if (step === 2) {
      setStep(1);
      setReadyPath(null);
      setStatusRows([]);
      setConsistencyRows([]);
      setConsistencyDone(false);
      setConsistencyChecking(false);
      consistencyStartedRef.current = false;
      setLayersError(null);
    }
  };

  const handleClose = () => {
    if (syncModalOpen) return;
    if (uploading || stepBusy || componentSetupRunning || consistencyChecking || schemaChecking) return;
    resetForm();
    onOpenChange(false);
  };

  const handleConfigureOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    if (syncModalOpen) return;
    if (uploading || stepBusy || componentSetupRunning || consistencyChecking || schemaChecking) return;
    handleClose();
  };

  const blockWizardDismiss = useCallback((event: Event) => {
    if (isShpSyncDetailModalTarget(event.target)) return;
    event.preventDefault();
  }, []);

  const wizardOpen = open && configureVisible;
  const isBusy = uploading || layersLoading || stepBusy || consistencyChecking || componentSetupRunning || schemaChecking;
  const wizardDismissBlocked = isBusy || syncModalOpen;

  const selectedLabel =
    source?.type === 'local'
      ? `로컬 · ${source.folderName} · ${layers.length}개 SHP`
      : source?.type === 'server'
        ? `서버 · ${source.folderName} · ${layers.length}개 SHP`
        : null;

  const schemaValidationDone =
    layers.length > 0 &&
    layers.every((l) => l.schemaStatus && l.schemaStatus !== 'pending' && l.schemaStatus !== 'checking');
  const allSchemaOk =
    schemaValidationDone &&
    layers.every((l) => l.schemaStatus === 'ok' || l.schemaStatus === 'new');
  const step1BasicReady =
    !!source &&
    layers.length > 0 &&
    !!readyPath &&
    !uploading &&
    !stepBusy &&
    !schemaChecking &&
    schemaValidationDone;
  const allComponentsReady =
    statusRows.length > 0 && statusRows.every((r) => r.table && r.layer && r.style && r.define);
  const needComponentSetup = statusRows.filter((r) => !r.table || !r.layer || !r.style || !r.define);
  const unresolvedConsistencyRows = consistencyRows.filter(consistencyNeedsReview);
  const hasConsistencyErrors = consistencyRows.some((r) => !!r.error);
  const canCompleteStep3 =
    consistencyDone &&
    !consistencyChecking &&
    !syncModalOpen &&
    unresolvedConsistencyRows.length === 0 &&
    !hasConsistencyErrors;
  const step3BasicReady = consistencyDone && !consistencyChecking && !syncModalOpen;

  const handleComplete = () => {
    if (step !== 4 || !reportLoaded || reportLoading) return;
    resetForm();
    onOpenChange(false);
    onSuccess?.();
  };

  const folderUploadOverall =
    uploading && uploadProgress.total > 0
      ? folderUploadOverallPercent(uploadProgress.current, uploadProgress.total, uploadState.progress)
      : 0;
  const folderUploadFileLabel =
    uploadProgress.total > 0
      ? `${Math.min(uploadProgress.current + 1, uploadProgress.total)}/${uploadProgress.total}`
      : '';

  const reportSuccessCount = reportRows.filter((r) => r.result === '성공').length;
  const reportFailCount = reportRows.length - reportSuccessCount;
  const reportSyncTotals = reportRows.reduce(
    (acc, r) => ({
      append: acc.append + r.syncAppend,
      updated: acc.updated + r.syncUpdated,
      kept: acc.kept + r.syncKept,
      removed: acc.removed + r.syncRemoved,
    }),
    { append: 0, updated: 0, kept: 0, removed: 0 }
  );

  return (
    <>
      <Dialog open={wizardOpen} onOpenChange={handleConfigureOpenChange} modal={!syncModalOpen}>
        <DialogContent
          className="flex h-[700px] max-h-[90vh] w-[1200px] min-w-[1200px] max-w-[95vw] flex-col gap-y-2 overflow-hidden p-4"
          showCloseButton={!wizardDismissBlocked}
          onInteractOutside={blockWizardDismiss}
          onPointerDownOutside={blockWizardDismiss}
          onFocusOutside={blockWizardDismiss}
          onEscapeKeyDown={blockWizardDismiss}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isBusy ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
              ) : null}
              SHP 폴더 업로드 — {STEP_LABELS[step] ?? step} ({step}/{TOTAL_STEPS})
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {step === 1 && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    폴더 선택
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={folderInputRef}
                      id={folderInputId}
                      type="file"
                      tabIndex={-1}
                      className="sr-only"
                      {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                      onChange={handleLocalFolderInputChange}
                    />
                    <label
                      htmlFor={isBusy ? undefined : folderInputId}
                      className={cn('inline-flex', isBusy && 'pointer-events-none opacity-50')}
                    >
                      <Button type="button" variant="outline" size="sm" disabled={isBusy} asChild>
                        <span>폴더 선택</span>
                      </Button>
                    </label>
                    {showServerPickButton && onPickFromServer ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onPickFromServer}
                        disabled={isBusy}
                      >
                        서버에서 선택
                      </Button>
                    ) : null}
                    {selectedLabel && !uploading && (
                      <span className="text-sm text-muted-foreground">{selectedLabel}</span>
                    )}
                  </div>
                  {uploading && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate" title={uploadFileName}>
                          {uploadFileName || '업로드 준비 중…'}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          파일 {folderUploadFileLabel} · 전체 {folderUploadOverall}%
                          {uploadState.totalChunks > 0
                            ? ` · 청크 ${uploadState.currentChunk}/${uploadState.totalChunks}`
                            : ''}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-150"
                          style={{ width: `${folderUploadOverall}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {!uploading && readyPath && source?.type === 'local' && (
                    <p className="text-xs text-green-600 dark:text-green-400">업로드 완료</p>
                  )}
                </div>

                <div className="space-y-3 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    작업명 · 좌표계
                  </p>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">작업명</span>
                      <Input
                        value={workName}
                        onChange={(e) => setWorkName(e.target.value)}
                        className="h-8 w-72 text-sm"
                        placeholder="작업 메모"
                        disabled={!source || isBusy}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">좌표계 (EPSG)</span>
                      <Input
                        value={epsg}
                        onChange={(e) => setEpsg(e.target.value.replace(/[^\d]/g, ''))}
                        className="h-8 w-36 font-mono text-sm"
                        placeholder="5181"
                        disabled={!source || isBusy}
                      />
                    </div>
                    {epsg.trim() ? (
                      <span className="pb-2 text-xs text-muted-foreground">EPSG:{epsg.trim()}</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-[200px] flex-col gap-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    레이어 목록
                    {layers.length > 0 ? (
                      <span className="text-xs font-normal text-muted-foreground">({layers.length}개)</span>
                    ) : null}
                  </p>
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-background/40">
                    {layersLoading ? (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        목록 불러오는 중…
                      </div>
                    ) : !source ? (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        폴더를 선택하면 SHP 레이어 목록이 표시됩니다.
                      </div>
                    ) : layers.length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        SHP 파일이 없습니다.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-muted">
                          <tr className="text-left text-muted-foreground">
                            <th className="w-10 px-2 py-1.5">#</th>
                            <th className="px-2 py-1.5">레이어 (SHP)</th>
                            <th className="w-20 px-2 py-1.5 text-center">정합성 검증</th>
                            <th className="min-w-[10rem] px-2 py-1.5">비고</th>
                            <th className="w-24 px-2 py-1.5 text-right">크기</th>
                            {source.type === 'server' ? (
                              <th className="w-44 px-2 py-1.5">수정일</th>
                            ) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {layers.map((row, i) => (
                            <tr key={row.name} className="border-t">
                              <td className="px-2 py-1 tabular-nums text-muted-foreground">{i + 1}</td>
                              <td className="max-w-[16rem] truncate px-2 py-1" title={row.name}>
                                {row.name.replace(/\.shp$/i, '')}
                              </td>
                              <td className="px-2 py-1">
                                <SchemaIconCell status={row.schemaStatus} />
                              </td>
                              <td
                                className={cn(
                                  'max-w-[18rem] truncate px-2 py-1',
                                  schemaRemark(row.schemaStatus, row.schemaDetail)
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-muted-foreground'
                                )}
                                title={schemaRemark(row.schemaStatus, row.schemaDetail)}
                              >
                                {schemaRemark(row.schemaStatus, row.schemaDetail) || '—'}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right">
                                {row.size != null ? formatSize(row.size) : '—'}
                              </td>
                              {source.type === 'server' ? (
                                <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                                  {row.modified ? new Date(row.modified).toLocaleString('ko-KR') : '—'}
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    DB · GeoServer · 레이어 정의 상태
                  </p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    각 SHP에 대해 Table(layer 스키마), GeoServer Layer, Style, 레이어 정의 존재 여부입니다.
                    누락된 항목이 있으면 「시작」으로 생성합니다. 모두 존재하면 「다음」으로 정합성 검증으로 이동합니다.
                  </p>
                  <div className="text-xs text-muted-foreground">
                    전체 <strong>{statusRows.length}</strong>개
                    {needComponentSetup.length > 0 ? (
                      <>
                        {' '}
                        · 생성·구성 필요{' '}
                        <strong className="text-orange-600 dark:text-orange-400">{needComponentSetup.length}</strong>개
                      </>
                    ) : (
                      <span className="ml-1 text-green-600 dark:text-green-400">· 구성요소 모두 존재</span>
                    )}
                  </div>
                </div>

                <div className="min-h-[280px] overflow-auto rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="text-center text-muted-foreground">
                        <th className="px-2 py-1.5 text-left">파일</th>
                        <th className="w-16 px-2 py-1.5">Table</th>
                        <th className="w-16 px-2 py-1.5">Layer</th>
                        <th className="w-16 px-2 py-1.5">Style</th>
                        <th className="w-16 px-2 py-1.5">Define</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusRows.map((row) => (
                        <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                          <td className="max-w-[14rem] truncate px-2 py-1" title={row.sourceFile}>
                            {row.sourceFile}
                          </td>
                          <td className="px-2 py-1">
                            <StatusCell ok={row.table} />
                          </td>
                          <td className="px-2 py-1">
                            <StatusCell ok={row.layer} />
                          </td>
                          <td className="px-2 py-1">
                            <StatusCell ok={row.style} />
                          </td>
                          <td className="px-2 py-1">
                            <StatusCell ok={row.define} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    SHP · DB 데이터 정합성
                  </p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    {consistencyChecking
                      ? '기존 layer 테이블과 SHP 데이터를 비교하는 중입니다…'
                      : '기존 layer 테이블과 SHP 데이터를 Key 기준으로 비교한 결과입니다. 비고에서 검토·반영할 수 있습니다.'}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {consistencyChecking ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        정합성 검증 중… ({statusRows.length}개 파일)
                      </span>
                    ) : (
                      <>
                        전체 <strong>{consistencyRows.length}</strong>개
                        {unresolvedConsistencyRows.length > 0 ? (
                          <>
                            {' '}
                            · 반영·검토 필요{' '}
                            <strong className="text-orange-600 dark:text-orange-400">{unresolvedConsistencyRows.length}</strong>개
                            <span className="ml-1 text-orange-600 dark:text-orange-400">· 미해결 시 완료 불가</span>
                          </>
                        ) : hasConsistencyErrors ? (
                          <span className="ml-1 text-red-600 dark:text-red-400">· 오류 해결 후 완료 가능</span>
                        ) : (
                          <span className="ml-1 text-green-600 dark:text-green-400">· 처리 완료 · 다음 단계 가능</span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="min-h-[280px] overflow-auto rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="text-center text-muted-foreground">
                        <th className="px-2 py-1.5 text-left">파일</th>
                        <th className="w-16 px-2 py-1.5">구분</th>
                        <th className="w-12 px-2 py-1.5">추가</th>
                        <th className="w-12 px-2 py-1.5">변경</th>
                        <th className="w-12 px-2 py-1.5">삭제</th>
                        <th className="w-12 px-2 py-1.5">동일</th>
                        <th className="min-w-[8rem] px-2 py-1.5 text-left">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consistencyChecking && consistencyRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">
                            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                            정합성 검증 중…
                          </td>
                        </tr>
                      ) : (
                        consistencyRows.map((row) => (
                        <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                          <td className="max-w-[14rem] truncate px-2 py-1" title={row.sourceFile}>
                            {row.sourceFile}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {row.isNew ? '신규' : '기존'}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-emerald-700 dark:text-emerald-400">
                            {row.isNew ? '—' : row.appendCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-orange-600">
                            {row.isNew ? '—' : row.conflictCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-red-500">
                            {row.isNew ? '—' : row.removeCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-muted-foreground">
                            {row.isNew ? '—' : row.unchangedCount}
                          </td>
                          <td className="max-w-[14rem] px-2 py-1">
                            {row.error ? (
                              <span className="truncate text-red-600 dark:text-red-400" title={row.error}>
                                {row.error}
                              </span>
                            ) : consistencyNeedsReview(row) ? (
                              <button
                                type="button"
                                className="inline-flex max-w-full items-center gap-0.5 truncate text-[10px] text-orange-600 hover:underline dark:text-orange-400"
                                onClick={() => openSyncReview(row)}
                              >
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                충돌 {row.conflictCount} / 삭제 {row.removeCount} / 신규 {row.appendCount}
                              </button>
                            ) : row.isNew ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="text-green-600 dark:text-green-400">변경 없음</span>
                            )}
                          </td>
                        </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    업로드 · 정합성 검증 결과
                  </p>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>
                      <span className="text-foreground/70">작업명</span> {workName || '—'}
                    </p>
                    <p>
                      <span className="text-foreground/70">좌표계</span> {epsg ? `EPSG:${epsg}` : '—'}
                    </p>
                    <p className="sm:col-span-2">
                      <span className="text-foreground/70">경로</span> {readyPath ?? '—'}
                    </p>
                  </div>
                  {reportLoading ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      결과를 집계하는 중…
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>
                        레이어 <strong>{reportRows.length}</strong>개
                      </span>
                      <span className="text-green-600 dark:text-green-400">
                        성공 <strong>{reportSuccessCount}</strong>
                      </span>
                      {reportFailCount > 0 ? (
                        <span className="text-red-600 dark:text-red-400">
                          실패 <strong>{reportFailCount}</strong>
                        </span>
                      ) : null}
                      <span>
                        정합성 — 추가 <strong className="text-emerald-700 dark:text-emerald-400">{reportSyncTotals.append}</strong>
                        · 변경반영{' '}
                        <strong className="text-orange-600">{reportSyncTotals.updated}</strong>
                        · DB유지 <strong className="text-blue-600">{reportSyncTotals.kept}</strong>
                        · 삭제 <strong className="text-red-500">{reportSyncTotals.removed}</strong>
                      </span>
                    </div>
                  )}
                </div>

                <div className="min-h-[320px] overflow-auto rounded-md border border-border/60">
                  {reportLoading ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      결과서 생성 중…
                    </div>
                  ) : reportRows.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      표시할 결과가 없습니다.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="text-center text-muted-foreground">
                          <th className="px-2 py-1.5 text-left">레이어</th>
                          <th className="w-12 px-2 py-1.5">구분</th>
                          <th className="w-12 px-2 py-1.5">Table</th>
                          <th className="w-12 px-2 py-1.5">Layer</th>
                          <th className="w-12 px-2 py-1.5">Style</th>
                          <th className="w-12 px-2 py-1.5">Define</th>
                          <th className="w-14 px-2 py-1.5">DB행</th>
                          <th className="min-w-[10rem] px-2 py-1.5 text-left">정합성 처리</th>
                          <th className="w-14 px-2 py-1.5">결과</th>
                          <th className="min-w-[8rem] px-2 py-1.5 text-left">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map((row) => (
                          <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                            <td className="max-w-[12rem] truncate px-2 py-1" title={row.sourceFile}>
                              {row.sourceFile.replace(/\.shp$/i, '')}
                            </td>
                            <td className="px-2 py-1 text-muted-foreground">{row.layerType}</td>
                            <td className="px-2 py-1">
                              <StatusCell ok={row.table} />
                            </td>
                            <td className="px-2 py-1">
                              <StatusCell ok={row.layer} />
                            </td>
                            <td className="px-2 py-1">
                              <StatusCell ok={row.style} />
                            </td>
                            <td className="px-2 py-1">
                              <StatusCell ok={row.define} />
                            </td>
                            <td className="px-2 py-1 tabular-nums text-muted-foreground">
                              {row.rowCount ?? '—'}
                            </td>
                            <td className="max-w-[14rem] truncate px-2 py-1" title={row.syncSummary}>
                              {row.syncSummary}
                            </td>
                            <td className="px-2 py-1">
                              {row.result === '성공' ? (
                                <span className="font-medium text-green-600 dark:text-green-400">성공</span>
                              ) : (
                                <span className="font-medium text-red-600 dark:text-red-400">실패</span>
                              )}
                            </td>
                            <td className="max-w-[10rem] truncate px-2 py-1 text-muted-foreground" title={row.remark}>
                              {row.remark || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {layersError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{layersError}</p>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 sm:gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className={WIZARD_FOOTER_BTN_CLASS}
              onClick={handleClose}
              disabled={wizardDismissBlocked}
            >
              취소
            </Button>
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                className={WIZARD_FOOTER_BTN_CLASS}
                onClick={handlePrev}
                disabled={uploading || stepBusy || componentSetupRunning || consistencyChecking || schemaChecking}
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </Button>
            )}
            {step === 1 && (
              <Button
                type="button"
                className={cn(WIZARD_FOOTER_BTN_CLASS, step1BasicReady && !allSchemaOk && 'opacity-50')}
                onClick={() => void handleNext()}
                disabled={!step1BasicReady || stepBusy}
              >
                {stepBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    확인 중…
                  </>
                ) : (
                  <>
                    다음
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
            {step === 2 &&
              (allComponentsReady ? (
                <Button
                  type="button"
                  className={WIZARD_FOOTER_BTN_CLASS}
                  onClick={() => void handleNext()}
                  disabled={isBusy}
                >
                  다음
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className={WIZARD_FOOTER_BTN_CLASS}
                  onClick={() => void runComponentSetup()}
                  disabled={isBusy || !readyPath || statusRows.length === 0}
                >
                  {componentSetupRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      생성 중…
                    </>
                  ) : (
                    '시작'
                  )}
                </Button>
              ))}
            {step === 3 && (
              <Button
                type="button"
                className={cn(WIZARD_FOOTER_BTN_CLASS, step3BasicReady && !canCompleteStep3 && 'opacity-50')}
                onClick={() => void handleNext()}
                disabled={!step3BasicReady}
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 4 && (
              <Button
                type="button"
                className={WIZARD_FOOTER_BTN_CLASS}
                onClick={handleComplete}
                disabled={!reportLoaded || reportLoading}
              >
                완료
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {syncModalOpen && syncModalTarget && (
        <SyncDetailModal
          dhKey={0}
          tableName={syncModalTarget.tableName}
          shpPath={syncModalTarget.shpPath}
          pendingOnly
          onClose={() => {
            setSyncModalOpen(false);
            setSyncModalTarget(null);
          }}
          onRollbackDone={handleSyncModalDone}
        />
      )}
    </>
  );
}
