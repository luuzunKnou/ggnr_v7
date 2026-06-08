'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Folder, File as FileIcon, ChevronUp, RefreshCw, Upload, Check, X, Loader2 } from 'lucide-react';
import { useChunkedUpload } from './useChunkedUpload';

type DirListResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

type AggregatedRow = {
  at: string;
  sourceFile: string;
  pathOrResult: string;
  steps: {
    upload?: '완료' | '실패' | '변환 중' | undefined;
    ecef?: '완료' | '실패' | '변환 중' | undefined;
    pnts?: '완료' | '실패' | '변환 중' | undefined;
  };
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModified(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** 경로 키 통일(백슬래시 → 슬래시) so SSE path matches row.pathOrResult */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function StepCell({ status }: { status?: '완료' | '실패' | '변환 중' }) {
  if (status === '완료') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400" title="완료">
        <Check className="w-2.5 h-2.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === '실패') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500/30 text-red-600 dark:text-red-400 border border-red-400/50" title="실패">
        <X className="w-2.5 h-2.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === '변환 중') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground" title="진행 중">
        <Loader2 className="w-2.5 h-2.5 animate-spin" strokeWidth={2.5} />
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export function LasFileUploaderContent() {
  const [relativePath, setRelativePath] = useState('3dtiles_las');
  const [list, setList] = useState<DirListResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<AggregatedRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [envSetupLoading, setEnvSetupLoading] = useState(false);
  const [envSetupResult, setEnvSetupResult] = useState<{ success: boolean; message: string; log: string } | null>(null);
  const [retryingPath, setRetryingPath] = useState<string | null>(null);
  const [retryingStep, setRetryingStep] = useState<{ path: string; step: 'ecef' | 'pnts' } | null>(null);
  const [runningSteps, setRunningSteps] = useState<Record<string, { ecef?: 'start' | 'ok' | 'fail'; pnts?: 'start' | 'ok' | 'fail' }>>({});
  /** 업로드 직후 파이프라인 진행 중인 행(이력에 아직 없을 때 표시) */
  const [pendingRows, setPendingRows] = useState<AggregatedRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 같은 파일에 대해 전체 재실행 또는 단계 실행 중이면 true */
  const isPathRunning = useCallback(
    (path: string) => {
      const np = normPath(path);
      if (normPath(retryingPath ?? '') === np) return true;
      if (retryingStep && normPath(retryingStep.path) === np) return true;
      const run = runningSteps[np];
      return Boolean(run && (run.ecef === 'start' || run.pnts === 'start'));
    },
    [retryingPath, retryingStep, runningSteps]
  );
  const { state: uploadState, upload, cancel, reset } = useChunkedUpload();

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listDirectory',
        params: { relativePath: relativePath || undefined },
      });
      const data = res?.data ?? res;
      setList({
        directories: Array.isArray(data?.directories) ? data.directories : [],
        files: Array.isArray(data?.files) ? data.files : [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setListError(msg);
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'getUploadConvertHistoryAggregated',
        params: { limit: 100 },
      });
      const data = res?.data ?? res;
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setHistoryRows(rows);
      setHistoryPath(typeof data?.path === 'string' ? data.path : null);
      setPendingRows((prev) => prev.filter((p) => !rows.some((r: AggregatedRow) => r.pathOrResult === p.pathOrResult)));
    } catch (err: unknown) {
      const msg =
        (err as { error?: string })?.error ??
        (err instanceof Error ? err.message : null) ??
        String(err);
      setHistoryError(msg);
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // 파이프라인 단계 이벤트 구독 (SSE)
  useEffect(() => {
    const es = new EventSource('/api/pipeline-events');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { path: string; step: 'ecef' | 'pnts'; status: 'start' | 'ok' | 'fail' };
        const pathKey = normPath(ev.path);
        setRunningSteps((prev) => ({
          ...prev,
          [pathKey]: { ...prev[pathKey], [ev.step]: ev.status },
        }));
        if (ev.status === 'ok' || ev.status === 'fail') {
          setRetryingStep((cur) => (cur && normPath(cur.path) === pathKey && cur.step === ev.step ? null : cur));
          fetchHistory();
        }
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [fetchHistory]);

  /** 이력 + 업로드 직후 대기 행 병합(같은 path는 이력 우선), 일시 내림차순 */
  const displayRows = (() => {
    const byPath = new Map<string, AggregatedRow>();
    for (const r of historyRows) byPath.set(r.pathOrResult, r);
    for (const p of pendingRows) if (!byPath.has(p.pathOrResult)) byPath.set(p.pathOrResult, p);
    return Array.from(byPath.values()).sort((a, b) => (b.at > a.at ? 1 : -1));
  })();

  const goUp = () => {
    if (!relativePath) return;
    const parts = relativePath.replace(/\/$/, '').split(/[/\\]/).filter(Boolean);
    parts.pop();
    setRelativePath(parts.length ? parts.join('/') : '');
  };

  const goInto = (dirName: string) => {
    const base = relativePath ? `${relativePath.replace(/\/$/, '')}/` : '';
    setRelativePath(`${base}${dirName}`);
  };

  const goToResult = (path: string) => {
    setRelativePath(path);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const file = files[0];
    upload(file, 'las').then((result) => {
      if (result?.savedPath != null) {
        const savedPath = result.savedPath;
        const sourceFile = savedPath.split(/[/\\]/).pop() ?? savedPath;
        setPendingRows((prev) => [
          ...prev,
          { at: new Date().toISOString(), sourceFile, pathOrResult: savedPath, steps: { upload: '완료' } },
        ]);
        setRunningSteps((prev) => ({ ...prev, [normPath(savedPath)]: { ecef: 'start' } }));
        fetchList();
        fetchHistory();
      }
    });
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files?.length) return;
    const file = files[0];
    upload(file, 'las').then((result) => {
      if (result?.savedPath != null) {
        const savedPath = result.savedPath;
        const sourceFile = savedPath.split(/[/\\]/).pop() ?? savedPath;
        setPendingRows((prev) => [
          ...prev,
          { at: new Date().toISOString(), sourceFile, pathOrResult: savedPath, steps: { upload: '완료' } },
        ]);
        setRunningSteps((prev) => ({ ...prev, [normPath(savedPath)]: { ecef: 'start' } }));
        fetchList();
        fetchHistory();
      }
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRetry = useCallback(
    async (pathOrResult: string) => {
      if (isPathRunning(pathOrResult)) {
        alert('해당 파일에 대한 작업이 이미 진행 중입니다. 완료 후 다시 시도해주세요.');
        return;
      }
      setRetryingPath(pathOrResult);
      try {
        await call('', 'POST', {
          service: 'pipelineService',
          action: 'runLasPipeline',
          params: { lasRelativePath: pathOrResult },
        });
        fetchHistory();
      } catch (err) {
        console.error('runLasPipeline failed:', err);
      } finally {
        setRetryingPath(null);
      }
    },
    [fetchHistory, isPathRunning]
  );

  const handleStepClick = useCallback(
    (pathOrResult: string, step: 'ecef' | 'pnts', row: AggregatedRow) => {
      if (isPathRunning(pathOrResult)) {
        alert('해당 파일에 대한 작업이 이미 진행 중입니다. 완료 후 다시 시도해주세요.');
        return;
      }
      if (retryingStep?.path === pathOrResult && retryingStep?.step === step) return;
      if (step === 'pnts' && row.steps.ecef !== '완료') {
        alert('이전 단계가 완료되지 않았습니다. 이전 단계를 먼저 진행해주세요.');
        return;
      }
      setRetryingStep({ path: pathOrResult, step });
      call('', 'POST', {
        service: 'pipelineService',
        action: 'runLasPipeline',
        params: { lasRelativePath: pathOrResult, only: step },
      }).catch((err) => {
        console.error('runLasPipeline step failed:', err);
        setRetryingStep(null);
      });
    },
    [retryingStep, isPathRunning]
  );

  const runPipelineEnvSetup = async () => {
    setEnvSetupLoading(true);
    setEnvSetupResult(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    try {
      const res = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'pipelineService',
          action: 'runPipelineEnvSetup',
          params: {},
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const json = await res.json();
      const data = json?.data;
      if (data && typeof data.success === 'boolean' && typeof data.message === 'string') {
        setEnvSetupResult({
          success: data.success,
          message: data.message,
          log: typeof data.log === 'string' ? data.log : '',
        });
      } else {
        setEnvSetupResult({
          success: false,
          message: json?.error || '응답 형식 오류',
          log: '',
        });
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      setEnvSetupResult({
        success: false,
        message: msg.includes('abort') ? '요청 시간이 초과되었습니다 (10분).' : msg,
        log: '',
      });
    } finally {
      setEnvSetupLoading(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden gap-3">
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden gap-3">
        <section className="flex flex-col flex-1 min-h-0 border rounded border-border overflow-hidden">
          <div className="shrink-0 flex items-center gap-2 p-2 border-b bg-muted/30">
            {relativePath ? (
              <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={goUp}>
                <ChevronUp className="w-4 h-4 mr-1" />
                상위로
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground truncate flex-1" title={relativePath || '(루트)'}>
              {relativePath || '(루트)'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none shrink-0"
              onClick={() => fetchList()}
              disabled={loading}
            >
              <RefreshCw className={cn('w-4 h-4 mr-1', loading && 'animate-spin')} />
              새로고침
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {loading && !list ? (
              <p className="p-4 text-sm text-muted-foreground">목록 불러오는 중...</p>
            ) : listError ? (
              <p className="p-4 text-sm text-red-600 dark:text-red-400">목록을 불러올 수 없습니다: {listError}</p>
            ) : list && list.directories.length === 0 && list.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">폴더가 비어 있습니다.</p>
            ) : list ? (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted/80 border-b">
                  <tr>
                    <th className="text-left py-2 px-3 w-8" />
                    <th className="text-left py-2 px-3 min-w-0">이름</th>
                    <th className="text-right py-2 px-3 w-24">크기</th>
                    <th className="text-left py-2 px-3 w-[260px]">수정일</th>
                  </tr>
                </thead>
                <tbody>
                  {list.directories.map((name) => (
                    <tr
                      key={`dir-${name}`}
                      className="border-b border-border/50 hover:bg-muted/50 cursor-pointer"
                      onClick={() => goInto(name)}
                    >
                      <td className="py-1.5 px-3">
                        <Folder className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      </td>
                      <td className="py-1.5 px-3 font-medium min-w-0 truncate" title={name}>{name}</td>
                      <td className="py-1.5 px-3 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 px-3 text-muted-foreground">—</td>
                    </tr>
                  ))}
                  {list.files.map((f) => (
                    <tr key={`file-${f.name}`} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-3">
                        <FileIcon className="w-4 h-4 text-muted-foreground" />
                      </td>
                      <td className="py-1.5 px-3 min-w-0 truncate" title={f.name}>{f.name}</td>
                      <td className="py-1.5 px-3 text-right text-muted-foreground">{formatSize(f.size)}</td>
                      <td className="py-1.5 px-3 text-muted-foreground text-xs">{formatModified(f.modified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>

        <section className="shrink-0 flex flex-col gap-2 rounded border border-border p-3 bg-muted/20">
          <input ref={fileInputRef} type="file" className="hidden" accept=".las,.laz" onChange={handleFileSelect} />
          <div className="text-xs text-muted-foreground">1) 업로드 → 2) 변환 자동 실행 → 3) 이력에서 확인</div>
          <div className="text-sm font-medium">저장 위치: 3dtiles_las/&lt;dataset&gt;/원본파일.las</div>
          <div
            role="button"
            tabIndex={0}
            onClick={handleUploadClick}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className={cn(
              'border-2 border-dashed rounded p-4 text-center text-sm text-muted-foreground transition-colors',
              uploadState.status === 'uploading'
                ? 'border-primary/50 bg-primary/5 cursor-wait'
                : 'border-border hover:border-primary/50 hover:bg-muted/30 cursor-pointer'
            )}
            onKeyDown={(e) => e.key === 'Enter' && handleUploadClick()}
          >
            {uploadState.status === 'uploading' ? (
              <span>업로드 중…</span>
            ) : (
              <>
                <Upload className="w-6 h-6 mx-auto mb-1 opacity-70" />
                <p>파일을 놓거나 클릭 (LAS/LAZ)</p>
              </>
            )}
          </div>
          {(uploadState.status === 'uploading' || uploadState.progress > 0) && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {uploadState.status === 'uploading' && uploadState.totalChunks > 0
                    ? `청크 ${uploadState.currentChunk} / ${uploadState.totalChunks}`
                    : null}
                </span>
                <span>{uploadState.progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>
              {uploadState.status === 'uploading' && (
                <Button type="button" variant="outline" size="sm" className="rounded-none mt-1" onClick={cancel}>
                  취소
                </Button>
              )}
              {uploadState.status === 'success' && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  업로드 완료. 변환이 자동 실행됩니다. 이력에서 확인하세요.
                  <button
                    type="button"
                    className="underline ml-1"
                    onClick={() => {
                      fetchList();
                      fetchHistory();
                      reset();
                    }}
                  >
                    새로고침
                  </button>
                </p>
              )}
              {uploadState.status === 'error' && (
                <p className="text-sm text-red-600 dark:text-red-400">{uploadState.error}</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => goToResult('3dtiles_las')}>
              업로드 결과 보기
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => goToResult('3dtiles_pnts')}>
              PNTS 결과 보기
            </Button>
          </div>
        </section>
      </div>

      <div className="flex flex-col w-[50%] min-w-[320px] min-h-0 border rounded border-border overflow-hidden bg-muted/10">
        <section className="shrink-0 p-2 border-b border-border bg-muted/20">
          <div className="font-medium text-sm mb-1">파이프라인 환경 (python/env)</div>
          <p className="text-[10px] text-muted-foreground mb-2">Conda가 PATH에 있어야 합니다. 최초 1회 실행 시 수 분 소요될 수 있습니다.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-none"
            onClick={runPipelineEnvSetup}
            disabled={envSetupLoading}
          >
            {envSetupLoading ? '실행 중… (최대 약 10분)' : '환경 생성 및 패키지 설치'}
          </Button>
          {envSetupResult && (
            <div className="mt-2 space-y-1">
              <p
                className={cn(
                  'text-xs',
                  envSetupResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                )}
              >
                {envSetupResult.message}
              </p>
              {envSetupResult.log ? (
                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer hover:underline">실행 로그 보기</summary>
                  <pre className="mt-1 p-2 bg-muted/50 rounded overflow-auto max-h-32 whitespace-pre-wrap break-all">
                    {envSetupResult.log}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
        </section>
        <div className="shrink-0 p-2 border-b bg-muted/30 font-medium text-sm flex items-center flex-wrap gap-1">
          <span>업로드·변환 이력</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-none h-7 ml-1"
            onClick={fetchHistory}
            disabled={historyLoading}
            title="이력 다시 불러오기"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', historyLoading && 'animate-spin')} />
          </Button>
          {historyPath && (
            <span className="text-xs font-normal text-muted-foreground ml-1" title={historyPath}>
              (서버 저장)
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {historyError && (
            <p className="p-3 text-xs text-red-600 dark:text-red-400" title={historyError}>
              이력 불러오기 실패: {historyError.length > 80 ? historyError.slice(0, 80) + '…' : historyError}
            </p>
          )}
          {historyLoading && displayRows.length === 0 && !historyError ? (
            <p className="p-3 text-xs text-muted-foreground">이력 불러오는 중...</p>
          ) : displayRows.length === 0 && !historyError ? (
            <p className="p-3 text-xs text-muted-foreground">이력이 없습니다. LAS 업로드·변환 시 자동으로 기록됩니다.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted/90 border-b">
                <tr>
                  <th className="text-left py-1.5 px-2 w-20">일시</th>
                  <th className="text-left py-1.5 px-2 min-w-[100px]">원본 파일</th>
                  <th className="text-center py-1.5 px-1 w-14">업로드</th>
                  <th className="text-center py-1.5 px-1 w-14">ECEF</th>
                  <th className="text-center py-1.5 px-1 w-14">PNTS</th>
                  <th className="text-left py-1.5 px-2 w-20">재실행</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const pathRunning = isPathRunning(row.pathOrResult);
                  const run = runningSteps[normPath(row.pathOrResult)];
                  const ecefStatus: AggregatedRow['steps']['ecef'] =
                    run?.ecef === 'start' ? '변환 중' : run?.ecef === 'ok' ? '완료' : run?.ecef === 'fail' ? '실패' : row.steps.ecef;
                  const pntsStatus: AggregatedRow['steps']['pnts'] =
                    run?.pnts === 'start' ? '변환 중' : run?.pnts === 'ok' ? '완료' : run?.pnts === 'fail' ? '실패' : row.steps.pnts;
                  return (
                  <tr key={`${row.sourceFile}-${row.at}-${i}`} className="border-b border-border/50">
                    <td className="py-1 px-2 text-muted-foreground whitespace-nowrap" title={row.at}>
                      {formatModified(row.at).split(' ')[0]}
                    </td>
                    <td className="py-1 px-2 truncate" title={row.sourceFile}>
                      {row.sourceFile}
                    </td>
                    <td className="py-1 px-1 text-center">
                      <StepCell status={row.steps.upload} />
                    </td>
                    <td className="py-1 px-1 text-center">
                      <span
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'inline-block rounded',
                          pathRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'
                        )}
                        onClick={() => handleStepClick(row.pathOrResult, 'ecef', row)}
                        onKeyDown={(e) => e.key === 'Enter' && handleStepClick(row.pathOrResult, 'ecef', row)}
                        title={pathRunning ? '해당 파일 작업 진행 중' : '클릭 시 ECEF만 재실행'}
                      >
                        <StepCell status={ecefStatus} />
                      </span>
                    </td>
                    <td className="py-1 px-1 text-center">
                      <span
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'inline-block rounded',
                          pathRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'
                        )}
                        onClick={() => handleStepClick(row.pathOrResult, 'pnts', row)}
                        onKeyDown={(e) => e.key === 'Enter' && handleStepClick(row.pathOrResult, 'pnts', row)}
                        title={pathRunning ? '해당 파일 작업 진행 중' : '클릭 시 PNTS만 재실행 (ECEF 완료 후 가능)'}
                      >
                        <StepCell status={pntsStatus} />
                      </span>
                    </td>
                    <td className="py-1 px-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-none h-7 text-[10px]"
                        onClick={() => handleRetry(row.pathOrResult)}
                        disabled={isPathRunning(row.pathOrResult)}
                      >
                        {isPathRunning(row.pathOrResult) ? '실행 중…' : '후처리 재실행'}
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
