'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChevronUp, RefreshCw, Play, Folder, Check, X, Loader2 } from 'lucide-react';

type ShpStatusRow = {
  sourceFile: string;
  pathOrResult: string;
  at: string;
  epsg: string | null;
  geometryType: 'POINT' | 'LINE' | 'POLYGON' | null;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
};

type StepResult = { success: boolean; skipped?: boolean; error?: string };
type BatchResultItem = {
  file: string;
  table: StepResult;
  layer: StepResult;
  style: StepResult;
  define: StepResult;
};

type Props = {
  relativePath: string;
  onComplete?: () => void;
};

export function ShpProcessTab({ relativePath, onComplete }: Props) {
  const [rows, setRows] = useState<ShpStatusRow[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(relativePath);

  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<BatchResultItem[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    setCurrentPath(relativePath);
  }, [relativePath]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, listRes] = await Promise.all([
        call('', 'POST', {
          service: 'shpUploadService',
          action: 'getShpStatusList',
          params: { relativePath: currentPath },
        }),
        call('', 'POST', {
          service: 'fileManagerService',
          action: 'listDirectory',
          params: { relativePath: currentPath },
        }),
      ]);
      const sd = statusRes?.data ?? statusRes;
      setRows(sd?.rows ?? []);
      const ld = listRes?.data ?? listRes;
      setFolders(ld?.directories ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const goUp = useCallback(() => {
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return;
    parts.pop();
    setCurrentPath(parts.join('/'));
  }, [currentPath]);

  const goInto = useCallback(
    (name: string) => setCurrentPath(currentPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + name),
    [currentPath]
  );

  const pathParts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const canGoUp = pathParts.length > 2;

  const needProcessing = rows.filter((r) => !r.table || !r.layer || !r.style || !r.define);

  const runBatch = useCallback(async () => {
    if (processing) return;
    setProcessing(true);
    setResults([]);
    setProgress(`후처리 시작… (${rows.length}개 SHP)`);
    abortRef.current = false;

    try {
      const batchRes = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'processShpBatch',
        params: { relativePath: currentPath },
      });
      const bd = batchRes?.data ?? batchRes;
      const items: BatchResultItem[] = bd?.results ?? [];
      setResults(items);
      const failCount = items.filter(
        (r) => !r.table.success || !r.layer.success || !r.style.success || !r.define.success
      ).length;
      if (failCount > 0) {
        setProgress(`후처리 완료 (${items.length}건 중 ${failCount}건 실패)`);
      } else {
        setProgress(`후처리 완료 (${items.length}건 모두 성공)`);
      }
    } catch (err: unknown) {
      setProgress(`후처리 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessing(false);
      fetchData();
      if (onComplete) onComplete();
    }
  }, [processing, rows, currentPath, fetchData, onComplete]);

  function stepIcon(s: StepResult) {
    if (s.skipped) return <Check className="w-3.5 h-3.5 text-blue-500 mx-auto" />;
    if (s.success) return <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />;
    return <X className="w-3.5 h-3.5 text-red-500 mx-auto" />;
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      {/* toolbar */}
      <div className="shrink-0 flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!canGoUp} onClick={goUp} className="gap-1">
          <ChevronUp className="w-3.5 h-3.5" /> 상위로
        </Button>
        <span className="text-xs text-muted-foreground truncate flex-1">{currentPath}</span>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-1" disabled={processing}>
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          disabled={processing || rows.length === 0}
          onClick={runBatch}
        >
          {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          일괄 후처리 실행
        </Button>
      </div>

      {/* subfolder shortcuts */}
      {folders.length > 0 && !processing && (
        <div className="shrink-0 flex flex-wrap gap-1">
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => goInto(f)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs hover:bg-muted"
            >
              <Folder className="w-3 h-3 text-yellow-500" /> {f}
            </button>
          ))}
        </div>
      )}

      {/* progress */}
      {progress && (
        <div className="shrink-0 px-2 py-1 border rounded bg-muted/20">
          <p
            className={cn(
              'text-xs',
              processing
                ? 'text-blue-600 dark:text-blue-400 animate-pulse'
                : progress.includes('실패') || progress.includes('오류')
                ? 'text-red-600 dark:text-red-400'
                : 'text-green-600 dark:text-green-400'
            )}
          >
            {processing && '⏳ '}
            {progress}
          </p>
        </div>
      )}

      {/* summary - before processing */}
      {!processing && results.length === 0 && (
        <div className="shrink-0 text-xs text-muted-foreground px-1">
          전체 SHP: <strong>{rows.length}</strong>개
          {needProcessing.length > 0 && (
            <>, 미완료: <strong className="text-orange-600">{needProcessing.length}</strong>개</>
          )}
          {needProcessing.length === 0 && rows.length > 0 && (
            <span className="text-green-600 ml-2">모든 레이어 처리 완료</span>
          )}
        </div>
      )}

      {/* results table */}
      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
        ) : results.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-center text-muted-foreground">
                <th className="py-1 px-1 text-left">파일</th>
                <th className="py-1 px-1 w-16">Table</th>
                <th className="py-1 px-1 w-16">Layer</th>
                <th className="py-1 px-1 w-16">Style</th>
                <th className="py-1 px-1 w-16">Define</th>
                <th className="py-1 px-1 text-left">비고</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, i) => {
                const errors: string[] = [];
                if (!item.table.success) errors.push(item.table.error ?? 'Table 실패');
                if (!item.layer.success) errors.push(item.layer.error ?? 'Layer 실패');
                if (!item.style.success) errors.push(item.style.error ?? 'Style 실패');
                if (!item.define.success) errors.push(item.define.error ?? 'Define 실패');
                return (
                  <tr key={i} className="border-t hover:bg-muted/40">
                    <td className="py-1 px-1 truncate max-w-[10rem]" title={item.file}>{item.file}</td>
                    <td className="py-1 px-1">{stepIcon(item.table)}</td>
                    <td className="py-1 px-1">{stepIcon(item.layer)}</td>
                    <td className="py-1 px-1">{stepIcon(item.style)}</td>
                    <td className="py-1 px-1">{stepIcon(item.define)}</td>
                    <td className="py-1 px-1 text-red-500 truncate max-w-[14rem]" title={errors.join('; ')}>
                      {errors.join('; ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            목록이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-center text-muted-foreground">
                <th className="py-1 px-1 text-left">파일</th>
                <th className="py-1 px-1 w-16">Table</th>
                <th className="py-1 px-1 w-16">Layer</th>
                <th className="py-1 px-1 w-16">Style</th>
                <th className="py-1 px-1 w-16">Define</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.pathOrResult} className="border-t hover:bg-muted/40">
                  <td className="py-1 px-1 truncate max-w-[10rem]" title={row.sourceFile}>{row.sourceFile}</td>
                  <td className="py-1 px-1 text-center">
                    {row.table ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                  </td>
                  <td className="py-1 px-1 text-center">
                    {row.layer ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                  </td>
                  <td className="py-1 px-1 text-center">
                    {row.style ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                  </td>
                  <td className="py-1 px-1 text-center">
                    {row.define ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
