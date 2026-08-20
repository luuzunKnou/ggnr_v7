'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { formatTimestampWallClock } from '@/lib/formatTimestampWallClock';
import { HelpCircle, RefreshCw, Search, X } from 'lucide-react';
import { USER_MANAGER_UI_STYLE } from './userManagerUiVariants';

type HistoryRow = {
  ulKey: number;
  ulContents: string | null;
  ulDetail: string | null;
  ulType: string | null;
  ulUser: string | null;
  ulGroup: string | null;
  ulWorkUser: string | null;
  ulDate: string | null;
  usrName: string | null;
};

const uiStyle = USER_MANAGER_UI_STYLE;
const tableRowClass =
  'border-b border-border hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0';

/** 한 줄 파싱: "항목: 전 → 후" / "항목: 전 -> 후" / "전 → 후" / "전 -> 후" */
type DetailLine = { field: string; before: string; after: string } | { raw: string };

function parseDetailLines(text: string): DetailLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const arrowMatch = line.match(/→|->/);
      if (arrowMatch?.index !== undefined) {
        const ai = arrowMatch.index;
        const left = line.slice(0, ai).trim();
        const right = line.slice(ai + arrowMatch[0].length).trim();
        // "항목: 전" 형태면 분리, 아니면 field 빈 칸
        const colonIdx = left.lastIndexOf(':');
        if (colonIdx > 0) {
          return {
            field: left.slice(0, colonIdx).trim(),
            before: left.slice(colonIdx + 1).trim(),
            after: right,
          };
        }
        return { field: '', before: left, after: right };
      }
      return { raw: line };
    });
}

function defaultRange() {
  const now = new Date();
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 1);
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(startDate);
  return { startDate: start, endDate: end };
}

/** 목록 API가 이미 서울 벽시계 문자열로 내려줌 */
function formatTime(v: string | null | undefined): string {
  if (!v) return '—';
  return formatTimestampWallClock(v) || '—';
}

/** 수정 타입이고 상세 내용이 있을 때만 보기 버튼 표시 */
function hasDetail(ulType: string | null | undefined, ulDetail: string | null | undefined): boolean {
  return String(ulType ?? '').trim() === '수정' && !!ulDetail?.trim();
}

/** 이력 상세 본문 — 항목/변경전/변경후 테이블 */
function HistoryDetailBody({ detail }: { detail: HistoryRow }) {
  const contents = detail.ulContents?.trim() || '—';
  const detailText = detail.ulDetail?.trim() || '';
  const lines = detailText ? parseDetailLines(detailText) : [];

  return (
    <div className="space-y-3 text-sm">
      {/* 내용 */}
      <div className="text-sm font-medium text-foreground">{contents}</div>

      {/* 변경 상세 테이블 */}
      {lines.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/70 dark:bg-muted/50">
              <th className="w-24 px-2 py-1.5 text-left font-medium text-muted-foreground">항목</th>
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">변경 전</th>
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">변경 후</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) =>
              'raw' in line ? (
                <tr key={i} className="border-b border-border/50">
                  <td colSpan={3} className="px-2 py-1.5 text-muted-foreground">
                    {line.raw}
                  </td>
                </tr>
              ) : (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-2 py-1.5 text-muted-foreground">{line.field || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                      {line.before || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700 dark:bg-green-950/40 dark:text-green-400">
                      {line.after || '—'}
                    </span>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function UserMgmtHistory() {
  const initial = defaultRange();
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryRow | null>(null);

  const load = useCallback(
    async (pageNum: number, keywordOverride?: string) => {
      setLoading(true);
      setError(null);
      const kw =
        keywordOverride !== undefined ? keywordOverride.trim() : keyword.trim();
      try {
        const res = await call('', 'POST', {
          service: 'userLogService',
          action: 'listUserMgmtHistory',
          params: {
            startDate: startDate.replace(/-/g, ''),
            endDate: endDate.replace(/-/g, ''),
            keyword: kw || undefined,
            page: pageNum,
            pageSize: 20,
          },
        });
        if (!res?.success) throw new Error(res?.error ?? '조회 실패');
        const data = (res.data ?? {}) as {
          rows?: HistoryRow[];
          total?: number;
          totalPages?: number;
          page?: number;
        };
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setTotal(Number(data.total ?? 0));
        setTotalPages(Math.max(1, Number(data.totalPages ?? 1)));
        setPage(Number(data.page ?? pageNum));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '목록 조회 실패');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, keyword]
  );

  useEffect(() => {
    void load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 최초 1회

  return (
    <div className={uiStyle.page}>
      <div className={cn(uiStyle.toolbar, 'flex-wrap')}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>시작</span>
          <Input
            type="date"
            className="h-8 w-[10.5rem] rounded-none text-xs"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="조회 시작일"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>종료</span>
          <Input
            type="date"
            className="h-8 w-[10.5rem] rounded-none text-xs"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            title="조회 종료일"
          />
        </label>
        <div className="relative h-8 max-w-xs min-w-[12rem] flex-1">
          <Input
            className={cn(
              'h-8 w-full rounded-none text-xs',
              keyword.trim() ? 'pr-8' : undefined
            )}
            placeholder="작업자·사용자·내용·부서 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(1);
            }}
            title="검색어"
          />
          {keyword.trim() ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setKeyword('');
                void load(1, '');
              }}
              title="검색어 지우기"
              aria-label="검색어 지우기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
          onClick={() => void load(1)}
          disabled={loading}
          title="검색"
        >
          <Search className="h-3.5 w-3.5" />
          검색
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">총 {total}건</span>
          {error ? (
            <span className="max-w-[14rem] truncate text-xs text-destructive" title={error}>
              {error}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
            onClick={() => void load(page)}
            disabled={loading}
            title="새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            새로고침
          </Button>
        </div>
      </div>

      <div className={uiStyle.tableWrap}>
        <div className={uiStyle.tableScroll}>
        <table className={cn(uiStyle.table, 'min-w-[56rem] table-fixed')}>
          <thead className={cn('sticky top-0', uiStyle.tableHead)}>
            <tr>
              <th className={cn('w-14 text-left', uiStyle.tableCell)}>순번</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>일시</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>작업자</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>사용자</th>
              <th className={cn('w-24 text-left', uiStyle.tableCell)}>이름</th>
              <th className={cn('w-28 text-left', uiStyle.tableCell)}>부서</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>내용</th>
              <th className={cn('w-20 text-left', uiStyle.tableCell)}>분류</th>
              <th className={cn('w-20 text-left', uiStyle.tableCell)}>상세</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={9}>
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={9}>
                  조회된 이력이 없습니다. (테이블 미생성 시 SQL 적용이 필요합니다)
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const seq = (page - 1) * 20 + idx + 1;
                const showDetail = hasDetail(r.ulType, r.ulDetail);
                return (
                  <tr key={r.ulKey} className={tableRowClass}>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>{seq}</td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {formatTime(r.ulDate)}
                    </td>
                    <td className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)} title={r.ulWorkUser ?? undefined}>
                      {r.ulWorkUser ?? '—'}
                    </td>
                    <td className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)} title={r.ulUser ?? undefined}>
                      {r.ulUser ?? '—'}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={r.usrName ?? undefined}>
                      {r.usrName ?? '—'}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={r.ulGroup ?? undefined}>
                      {r.ulGroup ?? '—'}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={r.ulContents ?? undefined}>
                      {r.ulContents ?? '—'}
                    </td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>{r.ulType ?? '—'}</td>
                    <td className={uiStyle.tableCell}>
                      {showDetail ? (
                        <button
                          type="button"
                          className="inline-flex text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          onClick={() => setDetail(r)}
                          title="상세보기"
                        >
                          <HelpCircle className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-center gap-2 text-xs">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || page <= 1}
          onClick={() => void load(page - 1)}
          title="이전 페이지"
        >
          이전
        </Button>
        <span className="text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || page >= totalPages}
          onClick={() => void load(page + 1)}
          title="다음 페이지"
        >
          다음
        </Button>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent
          className="flex w-full min-w-xl max-w-4xl flex-col gap-0 overflow-hidden rounded-sm border-border bg-card p-0 text-card-foreground"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>이력 상세</DialogTitle>
          </DialogHeader>
          <div className={cn('flex shrink-0 items-center justify-between gap-2', uiStyle.dialogHeader)}>
            <span className="text-xs font-medium text-foreground">이력 상세</span>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="닫기"
              title="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="overflow-auto bg-card p-4">
            {detail ? <HistoryDetailBody detail={detail} /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
