'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { formatTimestampWallClock } from '@/lib/formatTimestampWallClock';
import { normalizeClientIp } from '@/lib/normalizeClientIp';
import { RefreshCw, Search, X } from 'lucide-react';
import { USER_MANAGER_UI_STYLE } from './userManagerUiVariants';

type DateType = 'month' | 'week' | 'day';

type AccessRow = {
  llKey: number;
  loginUser: string | null;
  loginIp: string | null;
  loginTime: string | null;
  usrName: string | null;
  ugName: string | null;
  utName: string | null;
};

type ChartPoint = { label: string; count: number };
type PivotRow = {
  loginUser: string;
  ugName: string | null;
  usrName: string | null;
  counts: Record<string, number>;
};

const uiStyle = USER_MANAGER_UI_STYLE;
const tableRowClass =
  'border-b border-border hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0';
/** 집계 표 — 가로줄만 (세로 테두리 없음), 셀 위아래 여백 축소 */
const pivotRowClass = 'border-t border-border hover:bg-muted/50 transition-colors';
const pivotCellClass = cn(uiStyle.tableCell, 'border-r-0 !py-1');

const DATE_TYPE_LABEL: Record<DateType, string> = {
  month: '월별',
  week: '주별',
  day: '일별',
};

function seoulYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

/** V6: 종료일 기준 월 −5 / 주 −5 / 일 −6 */
function rangeForDateType(endYmd: string, dateType: DateType): { startDate: string; endDate: string } {
  const [y, m, d] = endYmd.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const start = new Date(end);
  if (dateType === 'month') start.setMonth(start.getMonth() - 5);
  else if (dateType === 'week') start.setDate(start.getDate() - 7 * 5);
  else start.setDate(start.getDate() - 6);
  return { startDate: seoulYmd(start), endDate: endYmd };
}

function defaultRange() {
  const end = seoulYmd(new Date());
  return { ...rangeForDateType(end, 'month'), dateType: 'month' as DateType };
}

function formatTime(v: string | null | undefined): string {
  if (!v) return '—';
  return formatTimestampWallClock(v) || '—';
}

function formatDept(ug: string | null | undefined, ut: string | null | undefined): string {
  const a = String(ug ?? '').trim();
  const b = String(ut ?? '').trim();
  if (a && b && a !== b) return `${a} · ${b}`;
  return a || b || '—';
}

function niceMax(n: number): number {
  if (n <= 0) return 5;
  const exp = Math.floor(Math.log10(n));
  const f = n / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

/** 기간별 접속 합계 — SVG 막대 (수위 현황 SVG 축 패턴 참고, 의존성 없음) */
function LoginBarChartSvg({ data }: { data: ChartPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hover, setHover] = useState<number | null>(null);
  const height = 280;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxVal = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.count))), [data]);
  const padL = 36;
  const padR = 12;
  const padT = 28;
  const padB = 36;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);
  const n = data.length;
  const gap = n > 12 ? 2 : n > 6 ? 4 : 8;
  const barSlot = n > 0 ? plotW / n : plotW;
  const barW = Math.max(4, Math.min(40, barSlot - gap));

  const yTicks = useMemo(() => {
    const steps = 4;
    const raw = Array.from({ length: steps + 1 }, (_, i) => Math.round((maxVal * i) / steps));
    // maxVal이 작으면 round로 0·1 등이 반복 → React key 중복(y-0 등) 방지
    return [...new Set(raw)];
  }, [maxVal]);

  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
        표시할 집계가 없습니다.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full text-foreground"
        role="img"
        aria-label="기간별 접속 합계 막대 그래프"
      >
        {yTicks.map((t) => {
          const y = padT + plotH - (t / maxVal) * plotH;
          return (
            <g key={`y-${t}`}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {t}
              </text>
            </g>
          );
        })}
        <line
          x1={padL}
          x2={padL}
          y1={padT}
          y2={padT + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        <line
          x1={padL}
          x2={width - padR}
          y1={padT + plotH}
          y2={padT + plotH}
          className="stroke-border"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const cx = padL + barSlot * i + barSlot / 2;
          const h = maxVal > 0 ? (d.count / maxVal) * plotH : 0;
          const x = cx - barW / 2;
          const y = padT + plotH - h;
          const active = hover === i;
          return (
            <g
              key={d.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(0, h)}
                rx={2}
                className={active ? 'fill-sky-600 dark:fill-sky-400' : 'fill-[#00627A] dark:fill-sky-500/80'}
              />
              {d.count > 0 ? (
                <text
                  x={cx}
                  y={y - 6}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={10}
                  fontWeight={500}
                >
                  {d.count}
                </text>
              ) : null}
              <text
                x={cx}
                y={padT + plotH + 14}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={n > 14 ? 8 : 10}
              >
                {d.label}
              </text>
              <rect
                x={padL + barSlot * i}
                y={padT}
                width={barSlot}
                height={plotH}
                fill="transparent"
              >
                <title>{`${d.label}: ${d.count}건`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function UserAccessStats() {
  const initial = defaultRange();
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [dateType, setDateType] = useState<DateType>(initial.dateType);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateList, setDateList] = useState<string[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [tableRows, setTableRows] = useState<PivotRow[]>([]);
  const [truncated, setTruncated] = useState(false);

  const loadStats = useCallback(
    async (override?: { startDate?: string; endDate?: string; dateType?: DateType }) => {
      setStatsLoading(true);
      const sd = override?.startDate ?? startDate;
      const ed = override?.endDate ?? endDate;
      const dt = override?.dateType ?? dateType;
      try {
        const res = await call('', 'POST', {
          service: 'loginLogService',
          action: 'listLoginLogStats',
          params: {
            startDate: sd.replace(/-/g, ''),
            endDate: ed.replace(/-/g, ''),
            dateType: dt,
          },
        });
        if (!res?.success) throw new Error(res?.error ?? '집계 조회 실패');
        const data = (res.data ?? {}) as {
          dateList?: string[];
          chartData?: ChartPoint[];
          tableRows?: PivotRow[];
          truncated?: boolean;
        };
        setDateList(Array.isArray(data.dateList) ? data.dateList : []);
        setChartData(Array.isArray(data.chartData) ? data.chartData : []);
        setTableRows(Array.isArray(data.tableRows) ? data.tableRows : []);
        setTruncated(Boolean(data.truncated));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '집계 조회 실패');
        setDateList([]);
        setChartData([]);
        setTableRows([]);
      } finally {
        setStatsLoading(false);
      }
    },
    [startDate, endDate, dateType]
  );

  const loadList = useCallback(
    async (
      pageNum: number,
      keywordOverride?: string,
      rangeOverride?: { startDate?: string; endDate?: string }
    ) => {
      setLoading(true);
      setError(null);
      const kw =
        keywordOverride !== undefined ? keywordOverride.trim() : keyword.trim();
      const sd = rangeOverride?.startDate ?? startDate;
      const ed = rangeOverride?.endDate ?? endDate;
      try {
        const res = await call('', 'POST', {
          service: 'loginLogService',
          action: 'listLoginLog',
          params: {
            startDate: sd.replace(/-/g, ''),
            endDate: ed.replace(/-/g, ''),
            keyword: kw || undefined,
            page: pageNum,
            pageSize: 20,
          },
        });
        if (!res?.success) throw new Error(res?.error ?? '조회 실패');
        const data = (res.data ?? {}) as {
          rows?: AccessRow[];
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

  const loadAll = useCallback(
    async (
      pageNum = 1,
      keywordOverride?: string,
      override?: { startDate?: string; endDate?: string; dateType?: DateType }
    ) => {
      await Promise.all([
        loadStats(override),
        loadList(pageNum, keywordOverride, override),
      ]);
    },
    [loadStats, loadList]
  );

  useEffect(() => {
    void loadAll(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 최초 1회

  const onChangeDateType = (next: DateType) => {
    const nextRange = rangeForDateType(endDate, next);
    setDateType(next);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
    void loadAll(1, undefined, { ...nextRange, dateType: next });
  };

  const sumByDate = useMemo(() => {
    const m = new Map(chartData.map((c) => [c.label, c.count]));
    return dateList.map((d) => m.get(d) ?? 0);
  }, [chartData, dateList]);

  const busy = loading || statsLoading;

  return (
    <div className={cn(uiStyle.page, 'gap-3')}>
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
        <div className="flex items-center gap-1">
          {(['month', 'week', 'day'] as const).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={dateType === t ? 'default' : 'outline'}
              className={cn(
                'h-8 rounded-none px-2.5 text-xs',
                dateType === t ? undefined : uiStyle.secondaryButton
              )}
              onClick={() => onChangeDateType(t)}
              title={`${DATE_TYPE_LABEL[t]} 집계`}
            >
              {DATE_TYPE_LABEL[t]}
            </Button>
          ))}
        </div>
        <div className="relative h-8 max-w-xs min-w-[12rem] flex-1">
          <Input
            className={cn(
              'h-8 w-full rounded-none text-xs',
              keyword.trim() ? 'pr-8' : undefined
            )}
            placeholder="상세 목록: 아이디·이름·부서·IP"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadAll(1);
            }}
            title="상세 목록 검색어"
          />
          {keyword.trim() ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setKeyword('');
                void loadAll(1, '');
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
          onClick={() => void loadAll(1)}
          disabled={busy}
          title="검색"
        >
          <Search className="h-3.5 w-3.5" />
          검색
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">상세 {total}건</span>
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
            onClick={() => void loadAll(page)}
            disabled={busy}
            title="새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            새로고침
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 shrink-0 gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-medium text-foreground">기간별 접속통계 그래프</h3>
          {statsLoading ? (
            <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
              집계 중…
            </div>
          ) : (
            <LoginBarChartSvg data={chartData} />
          )}
        </section>
        <section className="flex min-h-0 flex-col rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-medium text-foreground">기간별 접속통계 집계표</h3>
          {truncated ? (
            <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-400">
              구간이 많아 일부만 표시합니다. 기간을 줄이거나 월·주 단위를 사용하세요.
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className={cn(uiStyle.table, 'min-w-max text-[11px] [&_th]:border-r-0 [&_td]:border-r-0')}>
              <thead className={cn('sticky top-0', uiStyle.tableHead)}>
                <tr>
                  <th className={cn('whitespace-nowrap text-left', pivotCellClass)}>ID</th>
                  <th className={cn('whitespace-nowrap text-left', pivotCellClass)}>소속</th>
                  <th className={cn('whitespace-nowrap text-left', pivotCellClass)}>이름</th>
                  {dateList.map((d) => (
                    <th key={d} className={cn('whitespace-nowrap text-center', pivotCellClass)}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className={cn(pivotRowClass, 'bg-muted/40 font-medium')}>
                  <td className={pivotCellClass}>합계</td>
                  <td className={pivotCellClass} />
                  <td className={pivotCellClass} />
                  {sumByDate.map((n, i) => (
                    <td key={dateList[i]} className={cn('text-center tabular-nums', pivotCellClass)}>
                      {n}
                    </td>
                  ))}
                </tr>
                {statsLoading ? (
                  <tr className={pivotRowClass}>
                    <td className={cn('text-muted-foreground', pivotCellClass)} colSpan={3 + dateList.length}>
                      집계 중…
                    </td>
                  </tr>
                ) : tableRows.length === 0 ? (
                  <tr className={pivotRowClass}>
                    <td className={cn('text-muted-foreground', pivotCellClass)} colSpan={3 + Math.max(dateList.length, 1)}>
                      집계 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((r) => {
                    const name =
                      r.loginUser === 'su'
                        ? r.usrName?.trim() || '슈퍼관리자'
                        : r.usrName?.trim() || '—';
                    return (
                      <tr key={r.loginUser} className={pivotRowClass}>
                        <td className={cn('font-mono', pivotCellClass)}>{r.loginUser}</td>
                        <td className={cn('truncate max-w-[6rem]', pivotCellClass)} title={r.ugName ?? undefined}>
                          {r.ugName?.trim() || '—'}
                        </td>
                        <td className={cn('truncate max-w-[5rem]', pivotCellClass)} title={name}>
                          {name}
                        </td>
                        {dateList.map((d) => (
                          <td key={d} className={cn('text-center tabular-nums', pivotCellClass)}>
                            {r.counts[d] ?? 0}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <h3 className="shrink-0 text-sm font-medium text-foreground">접속 상세 목록</h3>

      <div className={uiStyle.tableWrap}>
        <div className={uiStyle.tableScroll}>
        <table className={cn(uiStyle.table, 'min-w-[48rem] table-fixed')}>
          <thead className={cn('sticky top-0', uiStyle.tableHead)}>
            <tr>
              <th className={cn('w-14 text-left', uiStyle.tableCell)}>순번</th>
              <th className={cn('w-40 text-left', uiStyle.tableCell)}>일시</th>
              <th className={cn('w-28 text-left', uiStyle.tableCell)}>아이디</th>
              <th className={cn('w-28 text-left', uiStyle.tableCell)}>이름</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>부서</th>
              <th className={cn('w-36 text-left', uiStyle.tableCell)}>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={6}>
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className={tableRowClass}>
                <td className={cn('text-muted-foreground', uiStyle.tableCell)} colSpan={6}>
                  조회된 접속 이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const seq = (page - 1) * 20 + idx + 1;
                const dept = formatDept(r.ugName, r.utName);
                const name =
                  r.loginUser === 'su'
                    ? r.usrName?.trim() || '슈퍼관리자'
                    : r.usrName?.trim() || '—';
                return (
                  <tr key={r.llKey} className={tableRowClass}>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>{seq}</td>
                    <td className={cn('whitespace-nowrap', uiStyle.tableCell)}>
                      {formatTime(r.loginTime)}
                    </td>
                    <td
                      className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)}
                      title={r.loginUser ?? undefined}
                    >
                      {r.loginUser ?? '—'}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={name}>
                      {name}
                    </td>
                    <td className={cn('truncate', uiStyle.tableCell)} title={dept}>
                      {dept}
                    </td>
                    <td
                      className={cn('truncate font-mono text-[11px]', uiStyle.tableCell)}
                      title={normalizeClientIp(r.loginIp) ?? r.loginIp ?? undefined}
                    >
                      {normalizeClientIp(r.loginIp) || r.loginIp?.trim() || '—'}
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
          disabled={busy || page <= 1}
          onClick={() => void loadList(page - 1)}
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
          disabled={busy || page >= totalPages}
          onClick={() => void loadList(page + 1)}
          title="다음 페이지"
        >
          다음
        </Button>
      </div>
    </div>
  );
}
