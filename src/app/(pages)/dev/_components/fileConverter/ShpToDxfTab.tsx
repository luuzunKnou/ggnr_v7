'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/shadcnComponents/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/shadcnComponents/ui/table';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

type ShpToDxfJobRow = {
  jobName: string;
  shpCount: number;
  dxfCount: number;
  pendingCount: number;
  incompleteCount: number;
  modified?: string;
};

function formatModified(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ShpToDxfTab() {
  const [selectedName, setSelectedName] = useState('');
  const [rows, setRows] = useState<ShpToDxfJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convertingJob, setConvertingJob] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'shpToDxfService',
        action: 'listShpToDxfJobs',
        params: { limit: 200 },
      });
      const data = res?.data ?? res;
      setRows(Array.isArray(data?.rows) ? (data.rows as ShpToDxfJobRow[]) : []);
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
    if (selectedRow.shpCount === 0) {
      setError('선택한 작업의 SHP 폴더에 형상파일이 없습니다.');
      return;
    }
    setConvertingJob(selectedName);
    setError(null);
    setMessage(null);
    try {
      const res = await call('', 'POST', {
        service: 'shpToDxfService',
        action: 'runShpToDxfConversion',
        params: { jobName: selectedName },
      });
      const data = res?.data ?? res;
      setMessage(
        typeof data?.message === 'string' ? data.message : `${selectedName} 변환이 완료되었습니다.`
      );
      if (Array.isArray(data?.failures) && data.failures.length > 0) {
        const failLines = (data.failures as { file: string; error: string }[])
          .map((f) => `${f.file}: ${f.error}`)
          .join('\n');
        setError(failLines);
      }
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
              <CardTitle className="text-base">SHPToDXF 폴더</CardTitle>
              <CardDescription>
                SHPToDXF/작업명/SHP 에 형상파일(.shp·.shx·.dbf)을 넣으면 DXF/파일명.dxf 로 변환합니다. 좌표는 그대로
                둡니다.
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
                  <TableHead className="text-right">형상파일</TableHead>
                  <TableHead className="text-right">도면</TableHead>
                  <TableHead className="text-right">미변환</TableHead>
                  <TableHead className="text-right">짝 파일 없음</TableHead>
                  <TableHead>수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      {loading ? '목록 불러오는 중...' : 'SHPToDXF 폴더에 작업 폴더가 없습니다.'}
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
                        <TableCell className="text-right tabular-nums">{row.shpCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.dxfCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.pendingCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.incompleteCount}</TableCell>
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
    </div>
  );
}
