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
import { RefreshCw, Search, X } from 'lucide-react';
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
  'border-t border-border hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0';

/** 이력 상세 모달 시안 (개발용 · 내용/상세만 · 확정 후 제거) */
type DetailUiVariant = 0 | 1 | 2 | 3;
const DETAIL_UI_OPTIONS: { value: DetailUiVariant; label: string }[] = [
  { value: 0, label: '시안0 · 기존' },
  { value: 1, label: '시안1 · 여백' },
  { value: 2, label: '시안2 · 구분선' },
  { value: 3, label: '시안3 · 박스' },
];

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

/** 분류가 «수정»일 때만 상세 보기 */
function isModifyType(ulType: string | null | undefined): boolean {
  return String(ulType ?? '').trim() === '수정';
}

/** 시안별 톤만 다름 — 표시 필드는 내용·상세만 */
function HistoryDetailBody({
  detail,
  variant,
}: {
  detail: HistoryRow;
  variant: DetailUiVariant;
}) {
  const contents = detail.ulContents?.trim() || '—';
  const detailText = detail.ulDetail?.trim() || '—';

  if (variant === 1) {
    return (
      <div className="space-y-4 text-sm">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">내용</div>
          <div>{contents}</div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">상세</div>
          <div className="whitespace-pre-wrap break-words text-muted-foreground">{detailText}</div>
        </div>
      </div>
    );
  }

  if (variant === 2) {
    return (
      <div className="text-sm">
        <div className="pb-3">
          <span className="text-muted-foreground">내용 </span>
          {contents}
        </div>
        <div className="border-t border-border pt-3">
          <span className="text-muted-foreground">상세 </span>
          <span className="whitespace-pre-wrap break-words">{detailText}</span>
        </div>
      </div>
    );
  }

  if (variant === 3) {
    return (
      <div className="space-y-2 text-sm">
        <div className="rounded-sm border border-border bg-muted/20 px-2.5 py-2">
          <span className="text-muted-foreground">내용 </span>
          {contents}
        </div>
        <div className="rounded-sm border border-border px-2.5 py-2">
          <span className="text-muted-foreground">상세 </span>
          <span className="whitespace-pre-wrap break-words">{detailText}</span>
        </div>
      </div>
    );
  }

  // 시안0 기존
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted-foreground">내용 </span>
        {contents}
      </p>
      <p className="whitespace-pre-wrap break-words">
        <span className="text-muted-foreground">상세 </span>
        {detailText}
      </p>
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
  const [detailUi, setDetailUi] = useState<DetailUiVariant>(0);

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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">이력상세</span>
            <select
              className="h-8 rounded-none border border-border bg-background px-1.5 text-xs text-foreground"
              value={detailUi}
              onChange={(e) => setDetailUi(Number(e.target.value) as DetailUiVariant)}
              title="이력 상세 모달 시안"
            >
              {DETAIL_UI_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('h-8 shrink-0 rounded-none text-xs', uiStyle.secondaryButton)}
            title="시안 미리보기 (샘플 데이터)"
            onClick={() =>
              setDetail({
                ulKey: -1,
                ulContents: '사용자 정보 수정',
                ulDetail: '부서: 건설과 → 도시과',
                ulType: '수정',
                ulUser: 'hong',
                ulGroup: '도시과',
                ulWorkUser: 'admin',
                ulDate: '2026-08-12 09:00:00',
                usrName: '홍길동',
              })
            }
          >
            시안 미리보기
          </Button>
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
                const showDetail = isModifyType(r.ulType);
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn('h-6 rounded-none px-2 text-[11px]', uiStyle.secondaryButton)}
                          onClick={() => setDetail(r)}
                          title="상세 보기"
                        >
                          보기
                        </Button>
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
          className="max-w-md gap-0 overflow-hidden rounded-sm border-border p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>이력 상세</DialogTitle>
          </DialogHeader>
          <div className={cn('flex shrink-0 items-center justify-between gap-2', uiStyle.dialogHeader)}>
            <span className="text-xs font-medium text-slate-600">이력 상세</span>
            <div className="flex items-center gap-2">
              <select
                className="h-7 max-w-[11rem] rounded-none border border-border bg-background px-1 text-[11px] text-foreground"
                value={detailUi}
                onChange={(e) => setDetailUi(Number(e.target.value) as DetailUiVariant)}
                title="이력 상세 모달 시안"
              >
                {DETAIL_UI_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="닫기"
                title="닫기"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className={cn('overflow-auto p-3', detailUi === 0 && 'pt-2')}>
            {detail ? <HistoryDetailBody detail={detail} variant={detailUi} /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
