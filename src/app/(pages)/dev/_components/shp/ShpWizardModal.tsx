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
import { Check, Loader2, X, ChevronLeft, ChevronRight, Minus, AlertTriangle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseShpFolderName } from './parseShpFolderMeta';
import { type FolderPickFile } from './pickShpFolderFiles';
import { SyncDetailModal } from './SyncDetailModal';
import { isShpSyncDetailModalTarget } from './shpModalLayers';
import { ShpCrsCandidateModal, type ShpCrsCandidate } from './ShpCrsCandidateModal';
import { COORDINATE_SYSTEM_OPTIONS } from '@/app/(pages)/map/_mapComponents/landInfo/shared';
import * as XLSX from 'xlsx';

type EpsgSource = 'prj' | 'folder' | 'candidate' | 'manual' | null;

type LayerRow = {
  name: string;
  size?: number;
  modified?: string;
  schemaStatus?: 'pending' | 'checking' | 'new' | 'ok' | 'mismatch' | 'error';
  schemaDetail?: string;
  epsg?: number | null;
  epsgSource?: EpsgSource;
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
  oldRowCount: number | null;
  group: string;
  korName: string;
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

function epsgSummaryText(layers: LayerRow[]): string {
  const withEpsg = layers.filter((l): l is LayerRow & { epsg: number } => l.epsg != null);
  if (withEpsg.length === 0) return '-';
  const uniq = Array.from(new Set(withEpsg.map((l) => l.epsg)));
  if (uniq.length === 1) return `EPSG:${uniq[0]}`;
  return `혼재 (${uniq.map((e) => `EPSG:${e}`).join(', ')})`;
}

function parseGeomTypeForReport(g: unknown): string | null {
  let obj: Record<string, unknown> | null = null;
  if (g == null) return null;
  if (typeof g === 'string') {
    try { obj = JSON.parse(g) as Record<string, unknown>; } catch { return null; }
  } else if (typeof g === 'object') {
    obj = g as Record<string, unknown>;
  }
  const t = obj?.type;
  return typeof t === 'string' ? t.toUpperCase() : null;
}

function stringifyRowSummary(data: Record<string, unknown> | null): string {
  if (!data) return '-';
  const parts = Object.entries(data)
    .filter(([k]) => k !== 'ogc_fid' && k !== 'geom')
    .map(([k, v]) => `${k}=${v == null ? '' : String(v)}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}

type SyncDiffRow = { op: string; keyField: string; keyValue: string; field: string; oldVal: string; newVal: string };

function buildSyncDiffRowsForReport(log: Record<string, unknown>): SyncDiffRow[] {
  const op = String(log.sl_operation ?? '');
  const keyField = String(log.sl_key_field ?? '');
  const keyValue = String(log.sl_key_value ?? '');
  const old = (log.sl_old_data as Record<string, unknown> | null) ?? null;
  const nw = (log.sl_new_data as Record<string, unknown> | null) ?? null;

  if (op === 'append') {
    return [{ op: '추가', keyField, keyValue, field: '(신규 행)', oldVal: '-', newVal: stringifyRowSummary(nw) }];
  }
  if (op === 'remove') {
    return [{ op: '삭제', keyField, keyValue, field: '(삭제 행)', oldVal: stringifyRowSummary(old), newVal: '-' }];
  }

  const opLabel = op === 'kept' ? 'DB유지' : '변경반영';
  const oldData = old ?? {};
  const newData = nw ?? {};
  const changed = Object.keys(oldData).filter(
    (k) => k !== 'ogc_fid' && k !== 'geom' && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])
  );
  const rows: SyncDiffRow[] = changed.map((f) => ({
    op: opLabel,
    keyField,
    keyValue,
    field: f,
    oldVal: oldData[f] == null ? '' : String(oldData[f]),
    newVal: newData[f] == null ? '' : String(newData[f]),
  }));
  if (JSON.stringify(oldData.geom) !== JSON.stringify(newData.geom)) {
    const oldGeomType = parseGeomTypeForReport(oldData.geom);
    const newGeomType = parseGeomTypeForReport(newData.geom);
    if (oldGeomType && newGeomType && oldGeomType !== newGeomType) {
      rows.push({ op: opLabel, keyField, keyValue, field: 'geom', oldVal: oldGeomType, newVal: newGeomType });
    } else {
      rows.push({ op: opLabel, keyField, keyValue, field: 'geom', oldVal: '좌표 변경', newVal: '좌표 변경' });
    }
  }
  if (rows.length === 0) {
    rows.push({ op: opLabel, keyField, keyValue, field: '-', oldVal: '-', newVal: '-' });
  }
  return rows;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/*?:[\]]/g, '_').slice(0, 31) || 'Sheet';
  let candidate = base;
  let i = 1;
  while (used.has(candidate)) {
    const suffix = `_${i}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  used.add(candidate);
  return candidate;
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
  const oldRowCountsRef = useRef<Record<string, number>>({});
  const syncLogsByTableRef = useRef<Record<string, Array<Record<string, unknown>>>>({});
  const { upload, reset, state: uploadState } = useChunkedUpload();

  const [step, setStep] = useState(1);
  const [source, setSource] = useState<Source | null>(null);
  const [workName, setWorkName] = useState('');
  const [folderEpsg, setFolderEpsg] = useState<string | null>(null);
  type CrsDetectionResult = { candidates: ShpCrsCandidate[]; reference5181?: ShpCrsCandidate };
  const [crsCandidatesByFile, setCrsCandidatesByFile] = useState<Record<string, CrsDetectionResult>>({});
  const [crsModalOpen, setCrsModalOpen] = useState(false);
  const [crsModalTarget, setCrsModalTarget] = useState<string | null>(null);
  const [crsModalCurrentEpsg, setCrsModalCurrentEpsg] = useState<number | null>(null);
  const [crsCandidates, setCrsCandidates] = useState<ShpCrsCandidate[]>([]);
  const [crsReference5181, setCrsReference5181] = useState<ShpCrsCandidate | undefined>(undefined);
  const [crsCandidateGeojson, setCrsCandidateGeojson] = useState<Record<string, unknown> | null>(null);
  const crsDetectStartedRef = useRef(false);
  const [layers, setLayers] = useState<LayerRow[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploadFileName, setUploadFileName] = useState('');
  const [schemaChecking, setSchemaChecking] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 1000);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

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
  const [completing, setCompleting] = useState(false);

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
    setFolderEpsg(meta.epsg ?? null);
    setCrsCandidatesByFile({});
    setCrsModalOpen(false);
    setCrsModalTarget(null);
    setCrsModalCurrentEpsg(null);
    setCrsCandidates([]);
    setCrsReference5181(undefined);
    setCrsCandidateGeojson(null);
    crsDetectStartedRef.current = false;
    return name;
  }, []);

  const resetForm = useCallback(() => {
    setStep(1);
    setSource(null);
    setWorkName('');
    workNameRef.current = '';
    setFolderEpsg(null);
    setCrsCandidatesByFile({});
    setCrsModalOpen(false);
    setCrsModalTarget(null);
    setCrsModalCurrentEpsg(null);
    setCrsCandidates([]);
    setCrsReference5181(undefined);
    setCrsCandidateGeojson(null);
    crsDetectStartedRef.current = false;
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
    oldRowCountsRef.current = {};
    syncLogsByTableRef.current = {};
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
        if (!(row.pathOrResult in oldRowCountsRef.current)) {
          oldRowCountsRef.current[row.pathOrResult] = await fetchTableRowCount(tableName);
        }
        const layerRow = layers.find((l) => l.name.toLowerCase() === row.sourceFile.toLowerCase());
        const res = await call('', 'POST', {
          service: 'shpUploadService',
          action: 'compareShpWithTable',
          params: {
            pathOrResult: row.pathOrResult,
            sourceSrsOverride: layerRow?.epsg != null ? `EPSG:${layerRow.epsg}` : undefined,
          },
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
  }, [statusRows, layers]);

  const openSyncReview = useCallback((row: ConsistencyRow) => {
    setSyncModalTarget({ tableName: row.tableName, shpPath: row.pathOrResult });
    setSyncModalOpen(true);
  }, []);

  const copyRemark = useCallback((text: string, key: string) => {
    if (!text) return;
    try {
      void navigator.clipboard.writeText(text);
      setToastMsg('복사됨');
    } catch {
      // ignore
    }
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
      const defineMap = new Map<string, { group: string; korName: string }>();
      try {
        const defineRes = await call('', 'POST', {
          service: 'devTestService',
          action: 'getDefineLayerTables',
          params: {},
        });
        const dd = defineRes?.data ?? defineRes;
        if (dd?.success && Array.isArray(dd.tables)) {
          for (const t of dd.tables as Array<Record<string, unknown>>) {
            const name = String(t.define_table_name ?? '').trim();
            if (!name) continue;
            defineMap.set(name.toLowerCase(), {
              group: String(t.define_table_group ?? '').trim(),
              korName: String(t.define_table_kor_name ?? '').trim(),
            });
          }
        }
      } catch { /* ignore */ }

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
          const appliedLogs = logs.filter((log) => syncLogAppliedInSession(log, sessionStartedAt));
          syncLogsByTableRef.current[tableName] = appliedLogs;
          for (const log of appliedLogs) {
            const op = String(log.sl_operation ?? '');
            if (op === 'append') syncAppend++;
            else if (op === 'conflict') syncUpdated++;
            else if (op === 'kept') syncKept++;
            else if (op === 'remove') syncRemoved++;
          }
        }

        const rowCount = componentsOk ? await fetchTableRowCount(tableName) : null;
        const oldRowCount = oldRowCountsRef.current[status.pathOrResult] ?? (isNewLayer ? 0 : null);
        const defineMeta = defineMap.get(tableName.toLowerCase());
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
          oldRowCount,
          group: defineMeta?.group ?? '',
          korName: defineMeta?.korName ?? '',
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
      const sourceSrsByPath: Record<string, string> = {};
      for (const r of statusRows) {
        const layerRow = layers.find((l) => l.name.toLowerCase() === r.sourceFile.toLowerCase());
        if (layerRow?.epsg != null) sourceSrsByPath[r.pathOrResult.replace(/\\/g, '/')] = `EPSG:${layerRow.epsg}`;
      }
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'processShpBatch',
        params: shpPaths.length > 0
          ? { relativePath: readyPath, shpPaths, sourceSrsByPath }
          : { relativePath: readyPath, sourceSrsByPath },
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
  }, [readyPath, fetchStatusList, statusRows, layers]);

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

  const fileNameOfPath = (pathOrResult: string) => pathOrResult.split(/[\\/]/).pop() ?? pathOrResult;

  const setLayerEpsg = useCallback((fileName: string, epsg: number | null, epsgSource: EpsgSource) => {
    setLayers((prev) => prev.map((l) => (l.name === fileName ? { ...l, epsg, epsgSource } : l)));
  }, []);

  const handleManualEpsgChange = useCallback((fileName: string, value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    const num = digits ? parseInt(digits, 10) : null;
    setLayerEpsg(fileName, num != null && Number.isFinite(num) ? num : null, digits ? 'manual' : null);
  }, [setLayerEpsg]);

  // 좌표계 자동 탐지: 파일마다 개별로 .prj(1순위) → 폴더명(2순위) → 경계 겹침 추정(3순위, 일치율 1순위 후보로 자동 입력).
  // 3순위로 채워진 값은 추정치이므로 행의 "확인" 버튼으로 지도에서 검증 후 확정할 수 있다.
  // schemaChecking(2단계 스키마 검증)도 GDAL(conda run ogrinfo/ogr2ogr)을 호출하므로, 동시에 돌리면
  // Windows의 conda run 임시파일 충돌이 나서 둘 다 멈춘다. 스키마 검증이 끝난 뒤에만 시작한다.
  useEffect(() => {
    if (!readyPath || layers.length === 0 || schemaChecking || crsDetectStartedRef.current) return;
    crsDetectStartedRef.current = true;
    let cancelled = false;

    void (async () => {
      for (const layer of layers) {
        const pathOrResult = `${readyPath.replace(/\/$/, '')}/${layer.name}`;
        try {
          const res = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'getShpPrjEpsg',
            params: { pathOrResult },
          });
          if (cancelled) return;
          const d = res?.data ?? res;
          if (d?.success && d.epsg != null) {
            setLayerEpsg(layer.name, Number(d.epsg), 'prj');
            continue;
          }
          if (folderEpsg) {
            setLayerEpsg(layer.name, Number(folderEpsg), 'folder');
            continue;
          }
        } catch {
          if (cancelled) return;
          if (folderEpsg) {
            setLayerEpsg(layer.name, Number(folderEpsg), 'folder');
            continue;
          }
        }

        // 3순위: 후보 탐지만 먼저 실행(지도 미리보기는 확인 버튼 클릭 시에만 불러옴), 일치율 1순위로 자동 입력
        // conda run(Windows GDAL 실행 방식)이 임시 파일을 공유해서 동시 호출 시 충돌하므로 순차 실행
        try {
          const candRes = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'detectShpCrsCandidates',
            params: { pathOrResult },
          });
          if (cancelled) return;
          const cd = candRes?.data ?? candRes;
          const candidates: ShpCrsCandidate[] = cd?.success && Array.isArray(cd.candidates) ? cd.candidates : [];
          const reference5181: ShpCrsCandidate | undefined = cd?.reference5181;
          setCrsCandidatesByFile((prev) => ({ ...prev, [pathOrResult]: { candidates, reference5181 } }));
          if (candidates.length > 0) {
            setLayerEpsg(layer.name, candidates[0].epsg, 'candidate');
          } else {
            setLayersError((prev) => prev ?? `좌표계 자동 탐지 (${layer.name}): 대한민국 경계와 겹치는 후보를 찾지 못했습니다. 직접 입력해주세요.`);
          }
        } catch (e: unknown) {
          if (cancelled) return;
          setLayersError((prev) => prev ?? `좌표계 자동 탐지 중 오류 (${layer.name}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [readyPath, layers.length, folderEpsg, schemaChecking, setLayerEpsg]);

  // 행의 "확인" 버튼: 캐시된 후보(없으면 재조회) + 미리보기 도형을 불러와 모달로 확인
  const openCrsModalForFile = useCallback(async (pathOrResult: string, currentEpsg: number | null) => {
    setCrsModalTarget(pathOrResult);
    setCrsModalCurrentEpsg(currentEpsg);
    try {
      let result = crsCandidatesByFile[pathOrResult];
      if (!result) {
        const candRes = await call('', 'POST', {
          service: 'shpUploadService',
          action: 'detectShpCrsCandidates',
          params: { pathOrResult },
        });
        const cd = candRes?.data ?? candRes;
        result = {
          candidates: cd?.success && Array.isArray(cd.candidates) ? cd.candidates : [],
          reference5181: cd?.reference5181,
        };
        setCrsCandidatesByFile((prev) => ({ ...prev, [pathOrResult]: result }));
      }
      const geoRes = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'getShpRawGeojson',
        params: { pathOrResult },
      });
      const gd = geoRes?.data ?? geoRes;
      const geojson = gd?.success && gd.geojson ? (gd.geojson as Record<string, unknown>) : null;
      if (!geojson) {
        setLayersError(`좌표계 확인 (${fileNameOfPath(pathOrResult)}): 미리보기 도형 변환 실패 - ${gd?.error ?? '알 수 없는 오류'}`);
      }
      setCrsCandidates(result.candidates);
      setCrsReference5181(result.reference5181);
      setCrsCandidateGeojson(geojson);
      setCrsModalOpen(true);
    } catch (e: unknown) {
      setLayersError(`좌표계 확인 중 오류 (${fileNameOfPath(pathOrResult)}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [crsCandidatesByFile]);

  const handleCrsConfirm = useCallback((epsg: number) => {
    if (crsModalTarget) setLayerEpsg(fileNameOfPath(crsModalTarget), epsg, 'candidate');
    setCrsModalOpen(false);
  }, [crsModalTarget, setLayerEpsg]);

  const handleCrsCancel = useCallback(() => {
    setCrsModalOpen(false);
  }, []);

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
  const crsDetectionDone = layers.length > 0 && layers.every((l) => l.epsg != null);
  const step1BasicReady =
    !!source &&
    layers.length > 0 &&
    !!readyPath &&
    !uploading &&
    !stepBusy &&
    !schemaChecking &&
    schemaValidationDone &&
    crsDetectionDone;
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

  const saveHistory = useCallback(async () => {
    if (reportRows.length === 0) return;
    try {
      const successCount = reportRows.filter((r) => r.result === '성공').length;
      const failCount = reportRows.length - successCount;
      const contents = workNameRef.current || '';

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
        const details = reportRows.map((r) => ({
          group: r.group || undefined,
          name: r.tableName,
          korName: r.korName || undefined,
          type: r.layerType === '신규' ? '신규' : (r.syncAppend || r.syncUpdated || r.syncKept || r.syncRemoved) ? '정합성 검증' : '기존',
          oldData: r.oldRowCount ?? 0,
          newData: r.rowCount ?? 0,
          appendCount: r.syncAppend,
          conflictCount: r.syncUpdated,
          removeCount: r.syncRemoved,
          contents: r.result === '성공' ? (r.syncSummary || '업데이트 완료') : (r.remark || '실패'),
          result: r.result,
          shpPath: r.pathOrResult,
        }));
        await call('', 'POST', {
          service: 'layerHistoryService',
          action: 'createLayerDetailHistoryBatch',
          params: { lhKey: hd.lhKey, details },
        });
      }
    } catch {
      /* ignore */
    }
  }, [reportRows]);

  const handleComplete = async () => {
    if (step !== 4 || !reportLoaded || reportLoading || completing) return;
    setCompleting(true);
    try {
      await saveHistory();
    } finally {
      setCompleting(false);
    }
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

  const handleDownloadReport = useCallback(() => {
    if (reportRows.length === 0) return;
    const now = new Date();
    const savedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const aoa: (string | number)[][] = [
      ['SHP 폴더 업로드 결과'],
      ['작업명', workName || '-'],
      ['좌표계', epsgSummaryText(layers)],
      ['경로', readyPath ?? '-'],
      ['저장 일시', savedAt],
      ['레이어 개수', reportRows.length, '성공', reportSuccessCount, '실패', reportFailCount],
      ['추가', reportSyncTotals.append, '변경반영', reportSyncTotals.updated, 'DB유지', reportSyncTotals.kept, '삭제', reportSyncTotals.removed],
      [],
      ['레이어', '구분', '좌표계', 'Table', 'Layer', 'Style', 'Define', 'DB행', '정합성 처리', '결과', '비고'],
      ...reportRows.map((r) => {
        const layerRow = layers.find((l) => l.name.replace(/\.shp$/i, '') === r.sourceFile.replace(/\.shp$/i, ''));
        return [
          r.sourceFile.replace(/\.shp$/i, ''),
          r.layerType,
          layerRow?.epsg != null ? `EPSG:${layerRow.epsg}` : '-',
          r.table ? '완료' : '누락',
          r.layer ? '완료' : '누락',
          r.style ? '완료' : '누락',
          r.define ? '완료' : '누락',
          r.rowCount ?? '',
          r.syncSummary,
          r.result,
          r.remark || '',
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 24 }, { wch: 24 }, { wch: 8 }, { wch: 24 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '요약');

    const usedSheetNames = new Set<string>(['요약']);
    const opOrder: Record<string, number> = { '추가': 0, '변경반영': 1, 'DB유지': 2, '삭제': 3 };
    for (const r of reportRows) {
      const logs = syncLogsByTableRef.current[r.tableName] ?? [];
      if (logs.length === 0) continue;
      const diffRows = logs.flatMap((log) => buildSyncDiffRowsForReport(log));
      if (diffRows.length === 0) continue;
      diffRows.sort(
        (a, b) => (opOrder[a.op] ?? 9) - (opOrder[b.op] ?? 9) || a.keyValue.localeCompare(b.keyValue)
      );
      const layerAoa: (string | number)[][] = [
        ['구분', 'Key필드', 'Key값', '변경 필드', '변경 전', '변경 후'],
        ...diffRows.map((d) => [d.op, d.keyField, d.keyValue, d.field, d.oldVal, d.newVal]),
      ];
      const layerWs = XLSX.utils.aoa_to_sheet(layerAoa);
      layerWs['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 30 }, { wch: 30 }];
      const sheetName = sanitizeSheetName(r.sourceFile.replace(/\.shp$/i, ''), usedSheetNames);
      XLSX.utils.book_append_sheet(wb, layerWs, sheetName);
    }

    const safeName = (workName || 'shp_upload_result').replace(/[\\/:*?"<>|]/g, '_');
    XLSX.writeFile(wb, `${safeName}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`);
  }, [reportRows, workName, layers, readyPath, reportSuccessCount, reportFailCount, reportSyncTotals]);

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
          {/* Changed-style is default; toggle removed */}

          <div className="min-h-0 flex-1 overflow-y-auto py-2 flex flex-col">
            {step === 1 && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    폴더 선택
                    {!uploading && readyPath && source?.type === 'local' && (
                      <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">업로드 완료</span>
                    )}
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
                </div>

                <div className="space-y-3 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                    <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    작업명 · 현황
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
                    <div className="flex flex-col px-4">
                      <span className="text-xs text-muted-foreground">좌표계 탐지 진행 현황</span>
                      <div className="flex h-8 items-center gap-1.5 px-2">
                        {layers.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <>
                            {!crsDetectionDone ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                            ) : (
                              <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                            )}
                            <span
                              className={cn(
                                'text-sm font-medium',
                                crsDetectionDone ? 'text-green-600 dark:text-green-400' : 'text-foreground'
                              )}
                            >
                              {layers.filter((l) => l.epsg != null).length}/{layers.length}개 완료
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-[340px] flex-1 flex-col gap-2 rounded-md border border-gray-200 bg-muted/30 p-3">
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
                            <th className="w-42 px-2 py-1.5 text-center">좌표계(EPSG)</th>
                            <th className="w-20 px-2 py-1.5 text-center">정합성 검증</th>
                            <th className="min-w-[9rem] px-2 py-1.5">비고</th>
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
                              <td className="px-2 py-1 text-center">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={row.epsg != null ? `EPSG:${row.epsg}` : ''}
                                    onChange={(e) => handleManualEpsgChange(row.name, e.target.value)}
                                    className="h-6 rounded border border-input bg-background px-1 font-mono text-[12px]"
                                    disabled={isBusy}
                                  >
                                    <option value="" disabled hidden>좌표계 탐색중…</option>
                                    {COORDINATE_SYSTEM_OPTIONS.map((o) => (
                                      <option key={o.code} value={o.code}>
                                        {o.shortLabel}
                                      </option>
                                    ))}
                                  </select>
                                  {readyPath ? (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => void openCrsModalForFile(`${readyPath.replace(/\/$/, '')}/${row.name}`, row.epsg ?? null)}
                                      className="text-[11px] text-blue-600 hover:underline disabled:pointer-events-none disabled:opacity-40 dark:text-blue-400"
                                    >
                                      확인
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 py-1">
                                <SchemaIconCell status={row.schemaStatus} />
                              </td>
                              <td
                                className={cn(
                                  'max-w-[18rem] px-2 py-1',
                                  schemaRemark(row.schemaStatus, row.schemaDetail)
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-muted-foreground'
                                )}
                                title={schemaRemark(row.schemaStatus, row.schemaDetail)}
                              >
                                {schemaRemark(row.schemaStatus, row.schemaDetail) ? (
                                  <button
                                    type="button"
                                    onClick={() => copyRemark(schemaRemark(row.schemaStatus, row.schemaDetail), `layers-${i}`)}
                                    className="w-full text-left truncate hover:underline hover:cursor-pointer"
                                  >
                                    {schemaRemark(row.schemaStatus, row.schemaDetail)}
                                  </button>
                                ) : (
                                  '—'
                                )}
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

                <div className="min-h-[470px] flex-1 overflow-auto rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="text-center text-muted-foreground">
                        <th className="px-2 py-1.5 text-left">파일</th>
                        <th className="w-16 px-2 py-1.5 text-center">Table</th>
                        <th className="w-16 px-2 py-1.5 text-center">Layer</th>
                        <th className="w-16 px-2 py-1.5 text-center">Style</th>
                        <th className="w-16 px-2 py-1.5 text-center">Define</th>
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
              <div className="space-y-3 flex h-full flex-col">
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

                <div className="min-h-[280px] flex-1 overflow-auto rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="text-muted-foreground">
                        <th className="px-2 py-1.5 text-left">파일</th>
                        <th className="w-16 px-2 py-1.5 text-center">구분</th>
                        <th className="w-12 px-2 py-1.5 text-right">추가</th>
                        <th className="w-12 px-2 py-1.5 text-right">변경</th>
                        <th className="w-12 px-2 py-1.5 text-right">삭제</th>
                        <th className="w-12 px-2 py-1.5 text-right">동일</th>
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
                        consistencyRows.map((row, idx) => (
                        <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                          <td className="max-w-[14rem] truncate px-2 py-1" title={row.sourceFile}>
                            {row.sourceFile}
                          </td>
                          <td className="px-2 py-1 text-center text-muted-foreground">
                            {row.isNew ? '신규' : '기존'}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                            {row.isNew ? '—' : row.appendCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-right text-orange-600">
                            {row.isNew ? '—' : row.conflictCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-right text-red-500">
                            {row.isNew ? '—' : row.removeCount}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-right text-muted-foreground">
                            {row.isNew ? '—' : row.unchangedCount}
                          </td>
                          <td className="max-w-[14rem] px-2 py-1">
                            <div className="min-h-[1.5rem] flex items-center">
                              {row.error ? (
                                <button
                                  type="button"
                                  onClick={() => copyRemark(row.error, `cons-${idx}`)}
                                  title={row.error}
                                  className="w-full text-left truncate text-red-600 dark:text-red-400 hover:underline hover:cursor-pointer"
                                >
                                  {row.error}
                                </button>
                              ) : consistencyNeedsReview(row) ? (
                                <button
                                  type="button"
                                  className={cn(
                                    'truncate inline-flex h-6 items-center group cursor-pointer max-w-full items-center gap-1 truncate text-xs font-normal text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-slate-100'
                                  )}
                                  onClick={() => openSyncReview(row)}
                                >
                                  <>
                                    <AlertTriangle className="h-[14px] w-[14px] shrink-0 text-orange-600 dark:text-orange-300" />
                                    <span className="ml-0.5 whitespace-nowrap text-orange-600 dark:text-orange-300 group-hover:underline">
                                      충돌 {row.conflictCount} · 삭제 {row.removeCount} · 신규 {row.appendCount}
                                    </span>
                                  </>
                                </button>
                              ) : row.isNew ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className="text-green-600 dark:text-green-400">변경 없음</span>
                              )}
                            </div>
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
                <div className="flex items-end justify-between gap-3 rounded-md border border-gray-200 bg-muted/30 p-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="flex items-center gap-2 text-sm font-medium text-black dark:text-zinc-100">
                      <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                      업로드 · 정합성 검증 결과
                    </p>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground pl-2">
                      <p className="flex items-center gap-2">
                        <span className="text-foreground/70">작업명</span>
                        <span className="min-w-0 truncate">{workName || '—'}</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <span className="text-foreground/70">좌표계</span>
                        <span className="min-w-0">{epsgSummaryText(layers)}</span>
                      </p>
                      <p className="w-full">
                        <span className="text-foreground/70">경로</span> <span className="break-all">{readyPath ?? '—'}</span>
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
                          {' '} · 변경반영{' '}
                          <strong className="text-orange-600">{reportSyncTotals.updated}</strong>
                          {' '} · DB유지 <strong className="text-blue-600">{reportSyncTotals.kept}</strong>
                          {' '} · 삭제 <strong className="text-red-500">{reportSyncTotals.removed}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs hover:cursor-pointer"
                    onClick={handleDownloadReport}
                    disabled={reportLoading || reportRows.length === 0}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    결과 다운로드
                  </Button>
                </div>

                <div className="min-h-[450px] overflow-auto rounded-md border border-border/60">
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
                          <th className="w-12 px-2 py-1.5 text-center">구분</th>
                          <th className="w-12 px-2 py-1.5 text-center">Table</th>
                          <th className="w-12 px-2 py-1.5 text-center">Layer</th>
                          <th className="w-12 px-2 py-1.5 text-center">Style</th>
                          <th className="w-12 px-2 py-1.5 text-center">Define</th>
                          <th className="w-14 px-2 py-1.5 text-right">DB행</th>
                          <th className="min-w-[10rem] px-2 py-1.5 text-left">정합성 처리</th>
                          <th className="w-14 px-2 py-1.5 text-center">결과</th>
                          <th className="min-w-[8rem] px-2 py-1.5 text-left">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map((row, ridx) => (
                          <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                            <td className="max-w-[12rem] truncate px-2 py-1" title={row.sourceFile}>
                              {row.sourceFile.replace(/\.shp$/i, '')}
                            </td>
                            <td className="px-2 py-1 text-center text-muted-foreground">{row.layerType}</td>
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
                            <td className="px-2 py-1 tabular-nums text-right text-muted-foreground">
                              {row.rowCount ?? '—'}
                            </td>
                            <td className="max-w-[14rem] truncate px-2 py-1" title={row.syncSummary}>
                              {row.syncSummary}
                            </td>
                            <td className="px-2 py-1 text-center">
                              {row.result === '성공' ? (
                                <span className="font-normal text-green-600 dark:text-green-400">성공</span>
                              ) : (
                                <span className="font-normal text-red-600 dark:text-red-400">실패</span>
                              )}
                            </td>
                            <td className="max-w-[10rem] truncate px-2 py-1 text-muted-foreground" title={row.remark}>
                              {row.remark ? (
                                <button
                                  type="button"
                                  onClick={() => copyRemark(row.remark, `report-${ridx}`)}
                                  className="w-full text-left truncate hover:underline hover:cursor-pointer"
                                >
                                  {row.remark}
                                </button>
                              ) : (
                                '—'
                              )}
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

          {toastMsg ? (
            <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
              <div
                className="pointer-events-auto inline-block text-white px-4 py-2 text-sm"
                style={{ backgroundColor: '#5191e4', borderRadius: '3px', boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)' }}
              >
                {toastMsg}
              </div>
            </div>
          ) : null}

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
                onClick={() => void handleComplete()}
                disabled={!reportLoaded || reportLoading || completing}
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : '완료'}
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
            consistencyStartedRef.current = false;
            setConsistencyDone(false);
            void runConsistencyCheck();
          }}
        />
      )}

      <ShpCrsCandidateModal
        open={crsModalOpen}
        fileName={crsModalTarget ? fileNameOfPath(crsModalTarget) : null}
        candidates={crsCandidates}
        reference5181={crsReference5181}
        currentEpsg={crsModalCurrentEpsg}
        geojson={crsCandidateGeojson}
        onConfirm={handleCrsConfirm}
        onCancel={handleCrsCancel}
      />
    </>
  );
}
