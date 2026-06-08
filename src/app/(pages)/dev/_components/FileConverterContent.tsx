'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FolderUp, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/shadcnComponents/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/shadcnComponents/ui/table';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LasFileUploaderContent } from './LasFileUploaderContent';
import { OrthophotoManagerContent } from './OrthophotoManagerContent';
import { useChunkedUpload } from './useChunkedUpload';

type ConverterTabId = 'lasToPnts' | 'objToB3dm' | 'tifToJpg';

type UploadBatchState = {
  running: boolean;
  total: number;
  current: number;
  success: number;
  fail: number;
  currentFile: string;
  message: string | null;
};

type ObjDatasetRow = {
  datasetName: string;
  sourceRelativeDir: string;
  outputRelativeDir: string;
  objFileName: string | null;
  objFileCount: number;
  fileCount: number;
  hasTileset: boolean;
  hasB3dm: boolean;
  detectedSourceCrs: string | null;
  detectedSourceCrsLabel: string | null;
  modified?: string;
};

const OBJ_SOURCE_CRS_OPTIONS = [
  { value: 'EPSG:5187', label: 'EPSG:5187 - KGD2002 / East Belt 2010' },
  { value: 'EPSG:5186', label: 'EPSG:5186 - KGD2002 / Central Belt 2010' },
  { value: 'EPSG:5185', label: 'EPSG:5185 - KGD2002 / West Belt 2010' },
  { value: 'EPSG:5188', label: 'EPSG:5188 - KGD2002 / Ulleung Belt 2010' },
  { value: 'EPSG:5181', label: 'EPSG:5181 - KGD2002 / Central Belt' },
  { value: 'EPSG:5179', label: 'EPSG:5179 - KGD2002 / Unified' },
] as const;

const TAB_ITEMS: { id: ConverterTabId; label: string; description: string }[] = [
  {
    id: 'lasToPnts',
    label: 'LAS to PNTS',
    description: '기존 LAS 업로드/변환 이력을 그대로 사용합니다.',
  },
  {
    id: 'objToB3dm',
    label: 'OBJ to B3DM',
    description: '3dtiles_obj 하위 폴더를 골라 3dtiles_b3dm 으로 변환합니다.',
  },
  {
    id: 'tifToJpg',
    label: 'TIF to JPG',
    description: 'GeoTIFF 그룹 업로드 후 기존 정사영상 타일 변환을 이어서 사용합니다.',
  },
];

const EMPTY_UPLOAD_BATCH: UploadBatchState = {
  running: false,
  total: 0,
  current: 0,
  success: 0,
  fail: 0,
  currentFile: '',
  message: null,
};

function formatModified(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getWebkitRelativePath(file: File): string {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/');
}

function isTifFile(file: File): boolean {
  return /\.(tif|tiff)$/i.test(file.name);
}

function FileConverterTabButton({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5 text-foreground'
          : 'border-border bg-background hover:bg-muted/50'
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

function TifToJpgUploadPanel() {
  const [groupName, setGroupName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [batch, setBatch] = useState<UploadBatchState>(EMPTY_UPLOAD_BATCH);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { state: uploadState, upload, cancel, reset } = useChunkedUpload();

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const runUpload = useCallback(
    async (fileList: FileList | null, mode: 'files' | 'folder') => {
      const trimmedGroup = groupName.trim();
      if (!trimmedGroup) {
        setMessage('업로드할 그룹명을 먼저 입력하세요.');
        return;
      }
      const files = Array.from(fileList ?? []).filter(isTifFile);
      if (!files.length) {
        setMessage('업로드할 tif/tiff 파일이 없습니다.');
        return;
      }
      setMessage(null);
      setBatch({
        running: true,
        total: files.length,
        current: 0,
        success: 0,
        fail: 0,
        currentFile: '',
        message: null,
      });
      let success = 0;
      let fail = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const relative = mode === 'folder' ? getWebkitRelativePath(file) : file.name;
        setBatch((prev) => ({
          ...prev,
          current: index + 1,
          currentFile: relative,
        }));
        const result = await upload(file, 'satelliteTif', {
          satelliteTifSavePath: `${trimmedGroup}/${relative}`,
        });
        if (result?.error === '취소됨') {
          fail += 1;
          break;
        }
        if (result?.error) fail += 1;
        else success += 1;
      }
      setBatch({
        running: false,
        total: files.length,
        current: files.length,
        success,
        fail,
        currentFile: '',
        message: `업로드 완료: 성공 ${success}, 실패 ${fail}`,
      });
      setMessage(`tiles_tif/${trimmedGroup} 업로드가 완료되었습니다.`);
      reset();
    },
    [groupName, reset, upload]
  );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">GeoTIFF 업로드</CardTitle>
          <CardDescription>
            그룹 폴더명은 보통 `satellite_YYYY_CRS_레이어명` 형식을 권장합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">그룹명</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="satellite_2025_5181_building"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={batch.running}
            >
              <Upload className="mr-2 h-4 w-4" />
              파일 업로드
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => folderInputRef.current?.click()}
              disabled={batch.running}
            >
              <FolderUp className="mr-2 h-4 w-4" />
              폴더 업로드
            </Button>
          </div>

          <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
            <div>입력 경로: `tiles_tif/{groupName || '{groupName}'}/.../*.tif`</div>
            <div>출력 경로: `tiles_jpg/{groupName || '{groupName}'}/z/x/y.jpg`</div>
          </div>

          {batch.running && (
            <div className="rounded border border-border bg-muted/30 px-3 py-2 text-xs">
              업로드 진행 {batch.current}/{batch.total}
              {batch.currentFile ? ` · ${batch.currentFile}` : ''}
              {uploadState.status === 'uploading' ? ` · ${uploadState.progress}%` : ''}
            </div>
          )}
          {batch.message && (
            <div className="rounded border border-green-600/40 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              {batch.message}
            </div>
          )}
          {message && (
            <div className="rounded border border-border px-3 py-2 text-xs text-muted-foreground">
              {message}
            </div>
          )}
          {uploadState.error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {uploadState.error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {batch.running && (
              <Button type="button" variant="outline" size="sm" onClick={cancel}>
                업로드 취소
              </Button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".tif,.tiff"
            multiple
            className="hidden"
            onChange={(e) => {
              void runUpload(e.target.files, 'files');
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept=".tif,.tiff"
            multiple
            className="hidden"
            onChange={(e) => {
              void runUpload(e.target.files, 'folder');
              e.target.value = '';
            }}
          />
        </CardContent>
      </Card>

      <div className="min-h-0 overflow-hidden rounded-lg border border-border">
        <OrthophotoManagerContent />
      </div>
    </div>
  );
}

function StatusMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center justify-center rounded-full bg-green-500/15 p-1 text-green-600 dark:text-green-400">
      <Check className="h-3.5 w-3.5" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center rounded-full bg-muted p-1 text-muted-foreground">
      <X className="h-3.5 w-3.5" />
    </span>
  );
}

function ObjToB3dmTab() {
  const [selectedDatasetName, setSelectedDatasetName] = useState('');
  const [rows, setRows] = useState<ObjDatasetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convertingDataset, setConvertingDataset] = useState<string | null>(null);
  const [convertingChunkDataset, setConvertingChunkDataset] = useState<string | null>(null);
  const [crsModalOpen, setCrsModalOpen] = useState(false);
  const [pendingDatasetName, setPendingDatasetName] = useState<string | null>(null);
  const [pendingChunkConversion, setPendingChunkConversion] = useState(false);
  const [selectedSourceCrs, setSelectedSourceCrs] = useState<string>(OBJ_SOURCE_CRS_OPTIONS[0].value);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileConverterService',
        action: 'listObjB3dmDatasets',
        params: { limit: 100 },
      });
      const data = res?.data ?? res;
      setRows(Array.isArray(data?.rows) ? (data.rows as ObjDatasetRow[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedDatasetName('');
      return;
    }
    if (rows.some((row) => row.datasetName === selectedDatasetName)) return;
    setSelectedDatasetName(rows[0]?.datasetName ?? '');
  }, [rows, selectedDatasetName]);

  const selectedRow = rows.find((row) => row.datasetName === selectedDatasetName) ?? null;

  const runConversion = useCallback(async (datasetName: string, sourceCrs: string, chunkSize?: 128) => {
    const useChunk = chunkSize === 128;
    if (useChunk) {
      setConvertingChunkDataset(datasetName);
    } else {
      setConvertingDataset(datasetName);
    }
    setError(null);
    setMessage(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileConverterService',
        action: 'runObjToB3dmConversion',
        params: {
          datasetName,
          sourceCrs,
          ...(useChunk ? { chunkSize: 128 } : {}),
        },
      });
      const data = res?.data ?? res;
      setMessage(
        typeof data?.message === 'string'
          ? data.message
          : `${datasetName}${useChunk ? '_128' : ''} 변환이 완료되었습니다.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (useChunk) {
        setConvertingChunkDataset(null);
      } else {
        setConvertingDataset(null);
      }
    }
  }, [refresh]);

  const handleConvert = useCallback(async (chunkSize?: 128) => {
    if (!selectedDatasetName || !selectedRow) {
      setError('변환할 폴더를 선택하세요.');
      return;
    }
    if (selectedRow.detectedSourceCrs) {
      await runConversion(selectedDatasetName, selectedRow.detectedSourceCrs, chunkSize);
      return;
    }
    setPendingDatasetName(selectedDatasetName);
    setPendingChunkConversion(chunkSize === 128);
    setSelectedSourceCrs(OBJ_SOURCE_CRS_OPTIONS[0].value);
    setCrsModalOpen(true);
  }, [runConversion, selectedDatasetName, selectedRow]);

  const isBusy = loading || convertingDataset != null || convertingChunkDataset != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">3dtiles_obj 하위 폴더</CardTitle>
              <CardDescription>
                바로 아래 하위 폴더만 선택할 수 있습니다. 변환 시작(128)은 OBJ 128개씩 묶어 3dtiles_b3dm/{'{dataset}_128'} 으로 출력합니다.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={isBusy}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                새로고침
              </Button>
              <Button type="button" size="sm" onClick={() => void handleConvert()} disabled={!selectedDatasetName || isBusy}>
                {convertingDataset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                변환 시작
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleConvert(128)}
                disabled={!selectedDatasetName || isBusy}
              >
                {convertingChunkDataset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                변환 시작(128)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {message && (
            <div className="rounded border border-green-600/40 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>선택</TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>좌표계</TableHead>
                  <TableHead>OBJ</TableHead>
                  <TableHead>파일 수</TableHead>
                  <TableHead>B3DM</TableHead>
                  <TableHead>Tileset</TableHead>
                  <TableHead>수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      {loading ? '목록 불러오는 중...' : '3dtiles_obj 아래 폴더가 없습니다.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const selected = selectedDatasetName === row.datasetName;
                    const objLabel =
                      row.objFileCount === 0
                        ? '없음'
                        : row.objFileCount === 1
                          ? row.objFileName ?? '1개'
                          : `${row.objFileCount}개`;
                    return (
                      <TableRow
                        key={row.datasetName}
                        className={cn(
                          'cursor-pointer',
                          selected && 'bg-muted/40'
                        )}
                        onClick={() => {
                          setSelectedDatasetName(row.datasetName);
                        }}
                      >
                        <TableCell>
                          <input
                            type="radio"
                            checked={selected}
                            onChange={() => setSelectedDatasetName(row.datasetName)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{row.datasetName}</div>
                          <div className="text-[11px] text-muted-foreground">{row.sourceRelativeDir}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.detectedSourceCrs ? (
                            <div>
                              <div className="font-mono">{row.detectedSourceCrs}</div>
                              <div className="text-[11px] text-muted-foreground">{row.detectedSourceCrsLabel}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">선택 필요</span>
                          )}
                        </TableCell>
                        <TableCell>{objLabel}</TableCell>
                        <TableCell>{row.fileCount}</TableCell>
                        <TableCell><StatusMark ok={row.hasB3dm} /></TableCell>
                        <TableCell><StatusMark ok={row.hasTileset} /></TableCell>
                        <TableCell>{formatModified(row.modified)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={crsModalOpen}
        onOpenChange={(open) => {
          setCrsModalOpen(open);
          if (!open) {
            setPendingDatasetName(null);
            setPendingChunkConversion(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>좌표계 선택</DialogTitle>
            <DialogDescription>
              폴더명에서 좌표계를 읽지 못했습니다. 작업 시작 전에 원본 OBJ 좌표계를 선택하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              대상 폴더: {pendingDatasetName ?? '-'}
            </p>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedSourceCrs}
              onChange={(e) => setSelectedSourceCrs(e.target.value)}
            >
              {OBJ_SOURCE_CRS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCrsModalOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              onClick={() => {
                const target = pendingDatasetName;
                if (!target) return;
                const useChunk = pendingChunkConversion;
                setCrsModalOpen(false);
                setPendingDatasetName(null);
                setPendingChunkConversion(false);
                void runConversion(target, selectedSourceCrs, useChunk ? 128 : undefined);
              }}
            >
              {pendingChunkConversion ? '변환 시작(128)' : '변환 시작'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function FileConverterContent() {
  const [activeTab, setActiveTab] = useState<ConverterTabId>('lasToPnts');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <div className="grid gap-2 md:grid-cols-3">
        {TAB_ITEMS.map((item) => (
          <FileConverterTabButton
            key={item.id}
            active={activeTab === item.id}
            label={item.label}
            description={item.description}
            onClick={() => setActiveTab(item.id)}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'lasToPnts' ? (
          <LasFileUploaderContent />
        ) : activeTab === 'objToB3dm' ? (
          <ObjToB3dmTab />
        ) : (
          <TifToJpgUploadPanel />
        )}
      </div>
    </div>
  );
}
