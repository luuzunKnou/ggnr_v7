'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/shadcnComponents/ui/table';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LasFileUploaderContent } from './LasFileUploaderContent';
import { OrthophotoManagerContent } from './OrthophotoManagerContent';
import { OcrMigrationTab } from './fileConverter/OcrMigrationTab';

type ConverterTabId = 'pdfToJpg' | 'tifToJpg' | 'objToB3dm' | 'lasToPnts' | 'ocr';

/** pdfToJpgService.listPdfToJpgJobs 응답 행 (클라이언트용 복제 타입) */
type PdfToJpgJobRow = {
  jobName: string;
  pdfCount: number;
  convertedPdfCount: number;
  pendingPdfCount: number;
  totalJpgCount: number;
  modified?: string;
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
    id: 'tifToJpg',
    label: 'TIF to JPG',
    description: 'GeoTIFF 그룹 업로드 후 기존 정사영상 타일 변환을 이어서 사용합니다.',
  },
  {
    id: 'objToB3dm',
    label: 'OBJ to B3DM',
    description: '3dtiles_obj 하위 폴더를 골라 3dtiles_b3dm 으로 변환합니다.',
  },
  {
    id: 'lasToPnts',
    label: 'LAS to PNTS',
    description: '기존 LAS 업로드/변환 이력을 그대로 사용합니다.',
  },
  {
    id: 'pdfToJpg',
    label: 'PDF to JPG',
    description: 'PDFToJPG/{작업명}/PDF → JPG/{파일명}/page-001.jpg 로 변환합니다.',
  },
  {
    id: 'ocr',
    label: 'OCR',
    description:
      'OCR/{작업명} 이미지를 PaddleOCR → GPT-4o Vision으로 분석해 DB·file_data에 적재합니다.',
  },
];

function formatModified(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
  return (
    <div className="flex flex-col gap-3">
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
  const [crsModalOpen, setCrsModalOpen] = useState(false);
  const [pendingDatasetName, setPendingDatasetName] = useState<string | null>(null);
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

  const runConversion = useCallback(async (datasetName: string, sourceCrs: string) => {
    setConvertingDataset(datasetName);
    setError(null);
    setMessage(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileConverterService',
        action: 'runObjToB3dmConversion',
        params: {
          datasetName,
          sourceCrs,
        },
      });
      const data = res?.data ?? res;
      setMessage(
        typeof data?.message === 'string'
          ? data.message
          : `${datasetName} 변환이 완료되었습니다.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConvertingDataset(null);
    }
  }, [refresh]);

  const handleConvert = useCallback(async () => {
    if (!selectedDatasetName || !selectedRow) {
      setError('변환할 폴더를 선택하세요.');
      return;
    }
    if (selectedRow.detectedSourceCrs) {
      await runConversion(selectedDatasetName, selectedRow.detectedSourceCrs);
      return;
    }
    setPendingDatasetName(selectedDatasetName);
    setSelectedSourceCrs(OBJ_SOURCE_CRS_OPTIONS[0].value);
    setCrsModalOpen(true);
  }, [runConversion, selectedDatasetName, selectedRow]);

  const isBusy = loading || convertingDataset != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">3dtiles_obj 하위 폴더</CardTitle>
              <CardDescription>
                바로 아래 하위 폴더만 선택할 수 있습니다.
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
                setCrsModalOpen(false);
                setPendingDatasetName(null);
                void runConversion(target, selectedSourceCrs);
              }}
            >
              변환 시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function PdfToJpgTab() {
  const [selectedName, setSelectedName] = useState('');
  const [rows, setRows] = useState<PdfToJpgJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convertingJob, setConvertingJob] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'pdfToJpgService',
        action: 'listPdfToJpgJobs',
        params: { limit: 200 },
      });
      const data = res?.data ?? res;
      setRows(Array.isArray(data?.rows) ? (data.rows as PdfToJpgJobRow[]) : []);
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
      setSelectedName('');
      return;
    }
    if (rows.some((row) => row.jobName === selectedName)) return;
    setSelectedName(rows[0]?.jobName ?? '');
  }, [rows, selectedName]);

  const selectedRow = rows.find((row) => row.jobName === selectedName) ?? null;

  const handleConvert = useCallback(async () => {
    if (!selectedName || !selectedRow) {
      setError('변환할 작업을 선택하세요.');
      return;
    }
    if (selectedRow.pdfCount === 0) {
      setError('선택한 작업의 PDF 폴더에 PDF 파일이 없습니다.');
      return;
    }
    setConvertingJob(selectedName);
    setError(null);
    setMessage(null);
    try {
      const res = await call('', 'POST', {
        service: 'pdfToJpgService',
        action: 'runPdfToJpgConversion',
        params: { jobName: selectedName },
      });
      const data = res?.data ?? res;
      setMessage(
        typeof data?.message === 'string'
          ? data.message
          : `${selectedName} 변환이 완료되었습니다.`
      );
      await refresh();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'error' in err && typeof (err as { error?: unknown }).error === 'string'
          ? (err as { error: string }).error
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setConvertingJob(null);
    }
  }, [refresh, selectedName, selectedRow]);

  const isBusy = loading || convertingJob != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">PDFToJPG 폴더</CardTitle>
              <CardDescription>
                PDFToJPG/작업명/PDF 에 PDF를 넣으면 JPG/파일명/ 에 페이지별 JPG가 생성됩니다.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={isBusy}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                새로고침
              </Button>
              <Button type="button" size="sm" onClick={() => void handleConvert()} disabled={!selectedName || isBusy}>
                {convertingJob ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    변환 중...
                  </>
                ) : (
                  '변환 시작'
                )}
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
                  <TableHead>작업명</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                  <TableHead className="text-right">변환 완료</TableHead>
                  <TableHead className="text-right">미변환</TableHead>
                  <TableHead className="text-right">JPG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {loading ? '목록 불러오는 중...' : 'PDFToJPG 폴더에 작업 폴더가 없습니다.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const selected = selectedName === row.jobName;
                    return (
                      <TableRow
                        key={row.jobName}
                        className={cn('cursor-pointer', selected && 'bg-muted/40')}
                        onClick={() => setSelectedName(row.jobName)}
                      >
                        <TableCell>
                          <input
                            type="radio"
                            checked={selected}
                            onChange={() => setSelectedName(row.jobName)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{row.jobName}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.pdfCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.convertedPdfCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.pendingPdfCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.totalJpgCount}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


export function FileConverterContent() {
  const [activeTab, setActiveTab] = useState<ConverterTabId>('tifToJpg');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
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
        {activeTab === 'tifToJpg' ? (
          <TifToJpgUploadPanel />
        ) : activeTab === 'objToB3dm' ? (
          <ObjToB3dmTab />
        ) : activeTab === 'lasToPnts' ? (
          <LasFileUploaderContent />
        ) : activeTab === 'ocr' ? (
          <OcrMigrationTab />
        ) : (
          <PdfToJpgTab />
        )}
      </div>
    </div>
  );
}
