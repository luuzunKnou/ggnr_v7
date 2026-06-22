'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/shadcnComponents/ui/card';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/shadcnComponents/ui/table';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

type MigrationTabId = 'ocr';

type OcrJobRow = {
  jobName: string;
  imageCount: number;
  modified?: string;
};

const TAB_ITEMS: { id: MigrationTabId; label: string; description: string }[] = [
  {
    id: 'ocr',
    label: 'OCR',
    description:
      'OCR/{작업명} 이미지를 PaddleOCR → GPT-4o Vision(이미지+Paddle)으로 분석해 DB·file_data에 적재합니다. PDF별 하위 폴더 단위로 첨부를 묶습니다.',
  },
];

function BracketInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      <span className="text-muted-foreground">[</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[\[\]]/g, ''))}
        className={cn(
          'h-7 min-w-[6rem] max-w-[14rem] rounded border border-input bg-background px-1.5 text-sm',
          className
        )}
      />
      <span className="text-muted-foreground">]</span>
    </span>
  );
}

function MigrationTabButton({
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

function OcrTab() {
  const [selectedName, setSelectedName] = useState('');
  const [rows, setRows] = useState<OcrJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);

  const [tableName, setTableName] = useState('');
  const [documentType, setDocumentType] = useState('토지사용승낙서');
  const [extractFields, setExtractFields] = useState('공사명, 성명, 토지소재지');
  const [jijukFields, setJijukFields] = useState('토지소재지');
  const [jijukSuffix, setJijukSuffix] = useState('_jijuk');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'ocrMigrationService',
        action: 'listOcrJobs',
        params: { limit: 200 },
      });
      const data = res?.data ?? res;
      setRows(Array.isArray(data?.rows) ? (data.rows as OcrJobRow[]) : []);
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

  const handleRun = useCallback(async () => {
    if (!selectedName || !selectedRow) {
      setError('OCR 작업 폴더를 선택하세요.');
      return;
    }
    if (!tableName.trim()) {
      setError('OCR 작업 결과 테이블명을 입력하세요.');
      return;
    }
    if (selectedRow.imageCount === 0) {
      setError('선택한 작업 폴더에 이미지가 없습니다.');
      return;
    }
    setRunningJob(selectedName);
    setError(null);
    setMessage(null);
    try {
      const res = await call('', 'POST', {
        service: 'ocrMigrationService',
        action: 'runOcrMigration',
        params: {
          jobName: selectedName,
          tableName: tableName.trim(),
          documentType,
          extractFields,
          jijukFields,
          jijukSuffix,
        },
      });
      const data = res?.data ?? res;
      setMessage(
        typeof data?.message === 'string'
          ? data.message
          : `${selectedName} OCR 작업이 완료되었습니다.`
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
      setRunningJob(null);
    }
  }, [documentType, extractFields, jijukFields, jijukSuffix, refresh, selectedName, selectedRow, tableName]);

  const isBusy = loading || runningJob != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">OCR 추출 설정</CardTitle>
          <CardDescription>
            대괄호 안의 값만 수정할 수 있습니다. 본문 문서가 아닌 페이지는 직전 본문 행의 key 폴더에 첨부됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 max-w-xl">
            <label htmlFor="ocr-table-name" className="text-sm font-medium">
              OCR 작업 결과 테이블명
            </label>
            <Input
              id="ocr-table-name"
              value={tableName}
              onChange={(e) => setTableName(e.target.value.replace(/[\[\]]/g, ''))}
              placeholder="예: land_use_consent_20260620"
              disabled={isBusy}
            />
          </div>
          <p className="text-sm leading-relaxed">
            각 이미지중 <BracketInput value={documentType} onChange={setDocumentType} placeholder="문서유형" />
            에서 <BracketInput value={extractFields} onChange={setExtractFields} placeholder="필드1, 필드2" className="max-w-[18rem]" />
            항목을 추출해 테이블을 생성합니다.{' '}
            <BracketInput value={jijukFields} onChange={setJijukFields} placeholder="분리필드" />
            항목은{' '}
            <BracketInput value={jijukSuffix} onChange={setJijukSuffix} placeholder="_jijuk" />
            테이블로 분리합니다.
          </p>
          <p className="text-xs text-muted-foreground">
            분리 테이블명: <code className="text-xs">{tableName.trim() || '{테이블명}'}{jijukSuffix || '_jijuk'}</code>
            · 파일 저장: file_data/{tableName.trim() || '{테이블명}'}/{'{key}'}/{'{GPT제목}'}.jpg
          </p>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">OCR 작업 폴더</CardTitle>
              <CardDescription>OCR/작업명/ 에 이미지를 넣고 작업을 선택하세요.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={isBusy}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                새로고침
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRun()}
                disabled={!selectedName || !tableName.trim() || isBusy}
              >
                {runningJob ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    OCR 실행 중...
                  </>
                ) : (
                  'OCR 시작'
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
                  <TableHead className="text-right">이미지</TableHead>
                  <TableHead>수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {loading ? '목록 불러오는 중...' : 'OCR 폴더에 작업 폴더가 없습니다.'}
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
                          <input type="radio" checked={selected} readOnly aria-label={`${row.jobName} 선택`} />
                        </TableCell>
                        <TableCell className="font-medium">{row.jobName}</TableCell>
                        <TableCell className="text-right">{row.imageCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.modified ? new Date(row.modified).toLocaleString() : '—'}
                        </TableCell>
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

export function DataMigrationContent() {
  const [activeTab, setActiveTab] = useState<MigrationTabId>('ocr');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {TAB_ITEMS.map((tab) => (
          <MigrationTabButton
            key={tab.id}
            active={activeTab === tab.id}
            label={tab.label}
            description={tab.description}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {activeTab === 'ocr' && <OcrTab />}
      </div>
    </div>
  );
}
