'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, Medal } from 'lucide-react';
import {
  DashboardAccessRateLineChart,
} from '@/app/(pages)/(index)/dashboard-access-chart';
import {
  SafetyWaterStatsChartOnly,
  type StatsKindBlock,
} from '@/app/(pages)/map/_mapContents/safty/safetyWater/SafetyWaterStatsPanel';
import type { SafetyWaterStatPoint } from '@/app/(pages)/map/_mapContents/safty/safetyWater/safetyWaterTypes';
import { call } from '@/lib/api';
import { YONHAP_NEWS_HOME_URL } from '@/lib/yonhapNews';
import { INDEX_SITE_FOOTER_ID } from '@/app/(pages)/(index)/dev-mode-footer-trigger';

const DASHBOARD_STATS_VISIBLE_LS_KEY = 'ggnr_index_dashboard_stats_visible';
/** 푸터 측정 전 임시값 (기존 max-h 근처) */
const FOOTER_H_FALLBACK_PX = 88;

type ChartPoint = { label: string; count: number };

type FloodStation = {
  code: string;
  name: string;
  kind: 'water' | 'rain';
};

type YonhapRow = Record<string, unknown>;

type IndexDashboardStatsProps = {
  charts: string[];
  systemColors?: Record<string, string>;
};

const INDEX_CHART_KEYS = ['river', 'water', 'road', 'news', 'login'] as const;
type IndexChartKey = (typeof INDEX_CHART_KEYS)[number];

function isIndexChartKey(key: string): key is IndexChartKey {
  return (INDEX_CHART_KEYS as readonly string[]).includes(key);
}

/** 시스템 목록을 가리지 않도록 차트 영역 높이 */
const PANEL_H = 265;
const DASHBOARD_CELL_HEADER_H = 34;
const DASHBOARD_CELL_CONTENT_PAD_Y = 15;
/** 카드 헤더·세로 패딩 제외 본문 높이 */
const DASHBOARD_CELL_BODY_H = PANEL_H - DASHBOARD_CELL_HEADER_H - DASHBOARD_CELL_CONTENT_PAD_Y * 2;
/** 수위·강수 범례(약 12px) + 범례 위 여백(8px) 제외 차트 높이 */
const DASHBOARD_FLOOD_LEGEND_TOP_GAP = 8;
const DASHBOARD_FLOOD_CHART_H = DASHBOARD_CELL_BODY_H - 12 - DASHBOARD_FLOOD_LEGEND_TOP_GAP;
/** 사용자 접속률 — 선 주변 4px, 랭킹 행 사이 6px */
const DASHBOARD_LOGIN_GAP = 4;
const DASHBOARD_LOGIN_RANK_ROW_GAP = 6;
const DASHBOARD_LOGIN_ROW_H = 12;
const DASHBOARD_LOGIN_FOOTER_H =
  DASHBOARD_LOGIN_GAP * 2 + 1 + DASHBOARD_LOGIN_ROW_H * 3 + DASHBOARD_LOGIN_RANK_ROW_GAP * 2;
const DASHBOARD_LOGIN_CHART_H = DASHBOARD_CELL_BODY_H - DASHBOARD_LOGIN_FOOTER_H;
const ENTRANCE_SLIDE_MS = 380;
const BAR_ANIM_MS = 750;
const BAR_STAGGER_MS = 60;
const YEONGYANG_BBOX = { minX: 128.9, maxX: 129.22, minY: 36.58, maxY: 36.8 };

function formatYmdToken(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function pickRowValue(row: Record<string, unknown>, nameEn: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, nameEn)) return row[nameEn];
  const want = nameEn.replace(/_/g, '').toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.replace(/_/g, '').toLowerCase() === want) return v;
  }
  return undefined;
}

function formatFieldValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatNewsDateTime(raw: unknown): string {
  const s = formatFieldValue(raw).trim();
  if (!s) return '—';
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 12) {
    return `${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  if (digits.length >= 8) return `${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return s;
}

function shortLabel(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

function DashboardCell({
  title,
  subtitle,
  children,
  contentClassName,
  accentColor,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  contentClassName?: string;
  accentColor?: string;
}) {
  const barColor = accentColor?.trim() || 'var(--primary)';

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center gap-1.5 px-[5px]">
        <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: barColor }} aria-hidden />
        <h3 className="min-w-0 truncate text-sm font-semibold leading-none text-foreground">{title}</h3>
        {subtitle ? (
          <span className="ml-auto shrink-0 truncate text-xs tabular-nums leading-none text-muted-foreground">{subtitle}</span>
        ) : null}
      </div>
      <article className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-border bg-card">
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden p-[15px] ${contentClassName ?? ''}`}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      </article>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-xs leading-snug text-muted-foreground">{message}</p>;
}

function AnimatedMiniBar({
  widthPct,
  animKey,
  index,
}: {
  widthPct: number;
  animKey: string;
  index: number;
}) {
  const target = Math.max(6, widthPct);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setWidth(0);
    const delay = index * BAR_STAGGER_MS;
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => setWidth(target));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [target, animKey, index]);

  return (
    <div
      className="h-full rounded-full bg-primary/80"
      style={{
        width: `${width}%`,
        transition: `width ${BAR_ANIM_MS}ms ease-out`,
      }}
    />
  );
}

function MiniBarList({
  data,
  maxItems = 4,
  valueSuffix = 'm',
  animate = false,
}: {
  data: ChartPoint[];
  maxItems?: number;
  valueSuffix?: string;
  animate?: boolean;
}) {
  const items = data.slice(0, maxItems);
  const maxVal = Math.max(1, ...items.map((d) => d.count));
  const animKey = items.map((d) => `${d.label}:${d.count}`).join('|');
  if (items.length === 0) return <EmptyState message="데이터 없음" />;
  return (
    <ul className="flex h-full min-h-0 flex-1 flex-col">
      {items.map((item, index) => (
        <li key={item.label} className="flex min-h-0 flex-1 flex-col justify-center gap-[5px]">
          <div className="flex items-center justify-between gap-1 text-[11px] leading-none">
            <span className="truncate text-foreground" title={item.label}>
              {shortLabel(item.label, 14)}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.count.toLocaleString()}
              {valueSuffix}
            </span>
          </div>
          <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted">
            {animate ? (
              <AnimatedMiniBar
                widthPct={(item.count / maxVal) * 100}
                animKey={animKey}
                index={index}
              />
            ) : (
              <div
                className="h-full rounded-full bg-primary/80"
                style={{ width: `${Math.max(6, (item.count / maxVal) * 100)}%` }}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

type LoginRankRow = {
  loginUser: string;
  usrName: string | null;
  ugName: string | null;
  count: number;
};

function loginRankLabel(row: LoginRankRow): string {
  const name = String(row.usrName ?? '').trim() || row.loginUser;
  const dept = String(row.ugName ?? '').trim();
  return dept ? `${name} · ${dept}` : name;
}

const LOGIN_RANK_MEDAL_STYLES = [
  { color: '#D4AF37', fill: '#D4AF3740' },
  { color: '#9CA3AF', fill: '#9CA3AF40' },
  { color: '#B87333', fill: '#B8733340' },
] as const;

function LoginRankMedal({ rank }: { rank: number }) {
  const style = LOGIN_RANK_MEDAL_STYLES[rank - 1];
  if (!style) return null;
  return (
    <Medal
      className="h-3 w-3 shrink-0"
      style={{ color: style.color, fill: style.fill }}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

function LoginAccessTopRanking({ rows }: { rows: LoginRankRow[] }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) {
    return (
      <p className="shrink-0 text-xs leading-none text-muted-foreground">접속 랭킹 없음</p>
    );
  }
  return (
    <div className="flex shrink-0 flex-col" style={{ gap: DASHBOARD_LOGIN_RANK_ROW_GAP }}>
      {top3.map((row, idx) => {
        const label = loginRankLabel(row);
        return (
          <div
            key={`${row.loginUser}-${idx}`}
            className="flex shrink-0 items-center gap-1.5 text-xs leading-none"
            style={{ height: DASHBOARD_LOGIN_ROW_H }}
          >
            <LoginRankMedal rank={idx + 1} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={label}>
              {label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{row.count.toLocaleString()}회</span>
          </div>
        );
      })}
    </div>
  );
}

function MiniNewsList({ items }: { items: YonhapRow[] }) {
  const rows = items.slice(0, 4);
  if (rows.length === 0) return <EmptyState message="뉴스 없음" />;
  return (
    <ul className="flex h-full min-h-0 flex-col gap-[5px]">
      {rows.map((row, idx) => {
        const title = formatFieldValue(pickRowValue(row, 'YNA_TTL')).trim() || '—';
        const dateTime = formatNewsDateTime(pickRowValue(row, 'YNA_YMD'));
        const key = String(pickRowValue(row, 'YNA_NO') ?? idx);
        return (
          <li key={key} className="min-h-0 flex-1">
            <a
              href={YONHAP_NEWS_HOME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-full min-h-0 flex-col justify-center rounded border border-border/60 bg-muted/15 px-1.5 py-1 transition-colors hover:bg-muted/30"
              title={title}
            >
              <p className="truncate text-xs leading-tight text-muted-foreground">{title}</p>
              <p className="mt-0.5 text-[10px] leading-none tabular-nums text-muted-foreground/80">{dateTime}</p>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function IndexDashboardStats({ charts, systemColors = {} }: IndexDashboardStatsProps) {
  const showRoad = charts.includes('road');
  const showRiver = charts.includes('river');
  const showWater = charts.includes('water');
  const showNews = charts.includes('news');
  const showLogin = charts.includes('login');
  const colorOf = (sysKey: string) => {
    const c = systemColors[sysKey]?.trim();
    return c || undefined;
  };

  /** 카드 영역 전체 표시 — 개별 카드가 아닌 섹션 단위. 진입 시 숨김에서 시작 */
  const [panelsVisible, setPanelsVisible] = useState(false);
  /** 뷰포트 하단 ~ 푸터(어두운 바) 상단까지의 높이 */
  const [footerBottomPx, setFooterBottomPx] = useState(FOOTER_H_FALLBACK_PX);

  useEffect(() => {
    let preferOpen = true;
    try {
      const stored = localStorage.getItem(DASHBOARD_STATS_VISIBLE_LS_KEY);
      if (stored === '0') preferOpen = false;
    } catch {
      /* ignore */
    }
    if (!preferOpen) return;

    // 첫 페인트는 숨김 → 다음 프레임에 열어 아래에서 올라오도록
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPanelsVisible(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  useEffect(() => {
    const el = document.getElementById(INDEX_SITE_FOOTER_ID);
    if (!el) return;

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const h = Math.max(0, Math.round(window.innerHeight - top));
      if (h > 0) setFooterBottomPx(h);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const togglePanelsVisible = useCallback(() => {
    setPanelsVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DASHBOARD_STATS_VISIBLE_LS_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [roadData, setRoadData] = useState<{ totalCount: number; totalLengthM: number; items: ChartPoint[] } | null>(
    null
  );
  const [riverData, setRiverData] = useState<{
    totalRiverCount: number;
    totalLengthKm: number;
    items: ChartPoint[];
  } | null>(null);
  const [loginData, setLoginData] = useState<{
    chartData: ChartPoint[];
    total: number;
    topUsers: LoginRankRow[];
  } | null>(null);
  const [waterSeries, setWaterSeries] = useState<SafetyWaterStatPoint[]>([]);
  const [rainSeries, setRainSeries] = useState<SafetyWaterStatPoint[]>([]);
  const [newsItems, setNewsItems] = useState<YonhapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const loadFloodStats = useCallback(async () => {
    if (!showWater) return;
    const qs = new URLSearchParams({
      minX: String(YEONGYANG_BBOX.minX),
      maxX: String(YEONGYANG_BBOX.maxX),
      minY: String(YEONGYANG_BBOX.minY),
      maxY: String(YEONGYANG_BBOX.maxY),
    });
    const stRes = await fetch(`/api/flood/stations?${qs.toString()}`);
    const stJson = (await stRes.json().catch(() => ({}))) as { items?: FloodStation[] };
    const stations = Array.isArray(stJson.items) ? stJson.items : [];
    const waterStations = stations.filter((s) => s.kind === 'water');
    const rainStations = stations.filter((s) => s.kind === 'rain');

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const sdt = formatYmdToken(start);
    const edt = formatYmdToken(end);

    const fetchKindAverage = async (kind: 'water' | 'rain', list: FloodStation[]) => {
      if (list.length === 0) return [] as SafetyWaterStatPoint[];
      const res = await fetch('/api/flood/observations/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          time: '1D',
          sdt,
          edt,
          stations: list.map((s) => ({ code: s.code })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { items?: SafetyWaterStatPoint[] };
      return Array.isArray(json.items) ? json.items : [];
    };

    const [water, rain] = await Promise.all([
      fetchKindAverage('water', waterStations),
      fetchKindAverage('rain', rainStations),
    ]);
    setWaterSeries(water);
    setRainSeries(rain);
  }, [showWater]);

  const loadAll = useCallback(async () => {
    const nextErrors: string[] = [];
    const tasks: Promise<void>[] = [];

    if (showRoad) {
      tasks.push(
        call('', 'POST', { service: 'dashboardStatsService', action: 'getRoadLedgerStatusSummary', params: {} })
          .then((res) => setRoadData((res.data ?? null) as typeof roadData))
          .catch((e) => {
            nextErrors.push(e instanceof Error ? e.message : '도로대장 실패');
            setRoadData(null);
          })
      );
    }

    if (showRiver) {
      tasks.push(
        call('', 'POST', { service: 'dashboardStatsService', action: 'getRiverBasicPlanStatusSummary', params: {} })
          .then((res) => setRiverData((res.data ?? null) as typeof riverData))
          .catch(() => {
            setRiverData({ totalRiverCount: 0, totalLengthKm: 0, items: [] });
          })
      );
    }

    if (showLogin) {
      tasks.push(
        call('', 'POST', { service: 'dashboardStatsService', action: 'getLoginLogChartSummary', params: {} })
          .then((res) => setLoginData((res.data ?? null) as typeof loginData))
          .catch((e) => {
            nextErrors.push(e instanceof Error ? e.message : '사용자 접속률 실패');
            setLoginData(null);
          })
      );
    }

    if (showWater) {
      tasks.push(
        loadFloodStats().catch((e) => {
          nextErrors.push(e instanceof Error ? e.message : '수위·강수 실패');
          setWaterSeries([]);
          setRainSeries([]);
        })
      );
    }

    if (showNews) {
      tasks.push(
        call('', 'POST', {
          service: 'integrationService',
          action: 'fetchSafetydataRealtimeFeed',
          params: { datasetId: 'sd-46', limit: 4 },
        })
          .then((res) => {
            const data = (res.data ?? {}) as { items?: YonhapRow[] };
            setNewsItems(Array.isArray(data.items) ? data.items.slice(0, 4) : []);
          })
          .catch((e) => {
            nextErrors.push(e instanceof Error ? e.message : '연합뉴스 실패');
            setNewsItems([]);
          })
      );
    }

    await Promise.all(tasks);
    setErrors(nextErrors);
    setLoading(false);
  }, [loadFloodStats, showLogin, showNews, showRoad, showRiver, showWater]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const floodChartBlocks = useMemo<StatsKindBlock[]>(
    () => [
      { kind: 'water', kindLabel: '수위', items: waterSeries, loading: loading && showWater },
      { kind: 'rain', kindLabel: '강수량', items: rainSeries, loading: loading && showWater },
    ],
    [loading, rainSeries, showWater, waterSeries]
  );

  const panelByKey: Partial<Record<IndexChartKey, ReactElement>> = {
    river: (
      <DashboardCell
        title="하천기본계획"
        accentColor={colorOf('river')}
        subtitle={
          loading ? '…' : `연장 ${(riverData?.totalLengthKm ?? 0).toLocaleString()}km`
        }
      >
        {loading ? (
          <EmptyState message="불러오는 중…" />
        ) : (
          <MiniBarList data={riverData?.items ?? []} maxItems={6} valueSuffix="km" animate />
        )}
      </DashboardCell>
    ),
    water: (
      <DashboardCell title="수위·강수" accentColor={colorOf('safety')}>
        {loading ? (
          <EmptyState message="불러오는 중…" />
        ) : (
          <SafetyWaterStatsChartOnly
            blocks={floodChartBlocks}
            timeType="1D"
            chartHeight={DASHBOARD_FLOOD_CHART_H}
            axisLabelOuterGap={0}
            axisLabelPlotGap={5}
            hideAxisYear
            legendTopGap={DASHBOARD_FLOOD_LEGEND_TOP_GAP}
          />
        )}
      </DashboardCell>
    ),
    road: (
      <DashboardCell
        title="도로대장"
        accentColor={colorOf('road')}
        subtitle={
          loading ? '…' : `연장 ${(roadData?.totalLengthM ?? 0).toLocaleString()}m`
        }
      >
        {loading ? (
          <EmptyState message="불러오는 중…" />
        ) : (
          <MiniBarList data={roadData?.items ?? []} maxItems={9} animate />
        )}
      </DashboardCell>
    ),
    news: (
      <DashboardCell title="연합뉴스" subtitle="재난·안전" accentColor={colorOf('safety')}>
        {loading ? <EmptyState message="불러오는 중…" /> : <MiniNewsList items={newsItems} />}
      </DashboardCell>
    ),
    login: (
      <DashboardCell
        title="사용자 접속률"
        accentColor={colorOf('index')}
        subtitle={loading ? '…' : `7일 ${loginData?.total?.toLocaleString() ?? 0}회`}
      >
        {loading ? (
          <EmptyState message="불러오는 중…" />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 overflow-hidden" style={{ height: DASHBOARD_LOGIN_CHART_H }}>
              <DashboardAccessRateLineChart
                data={loginData?.chartData ?? []}
                height={DASHBOARD_LOGIN_CHART_H}
              />
            </div>
            <div
              className="shrink-0 border-t border-border/60"
              style={{
                marginTop: DASHBOARD_LOGIN_GAP,
                marginBottom: DASHBOARD_LOGIN_GAP,
              }}
            />
            <LoginAccessTopRanking rows={loginData?.topUsers ?? []} />
          </div>
        )}
      </DashboardCell>
    ),
  };

  const panels = charts
    .filter(isIndexChartKey)
    .map((key) => ({ key, node: panelByKey[key] }))
    .filter((p): p is { key: IndexChartKey; node: ReactElement } => p.node != null);

  const sheetRef = useRef<HTMLDivElement>(null);

  const toggleBtnClass =
    'pointer-events-auto relative inline-flex items-center justify-center gap-1 rounded-t-[5px] border border-b-0 border-[#64748B] bg-[#64748B] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#526077]';

  if (panels.length === 0) return null;

  return (
    <>
      {/* 푸터 위만 보이게 잘라, 접히면 차트는 푸터 뒤로·버튼만 위에 남김 */}
      <div
        className="pointer-events-none fixed inset-x-0 z-20 overflow-hidden"
        style={{ top: 0, bottom: footerBottomPx }}
      >
        <div
          className="absolute inset-x-0 bottom-0 will-change-transform"
          style={{
            transform: panelsVisible ? 'translateY(0)' : 'translateY(100%)',
            transition: `transform ${ENTRANCE_SLIDE_MS}ms ease-out`,
          }}
        >
          <div className="absolute bottom-full right-[45px] z-[12]">
            <button
              type="button"
              onClick={togglePanelsVisible}
              className={toggleBtnClass}
              aria-expanded={panelsVisible}
              aria-controls="index-dashboard-stats-panel"
              aria-label={panelsVisible ? '통계 숨기기' : '통계 보기'}
              title={panelsVisible ? '통계 숨기기' : '통계 보기'}
            >
              <span className="invisible select-none" aria-hidden>
                통계 보기
              </span>
              <ChevronUp className="invisible h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              {panelsVisible ? (
                <ChevronDown className="absolute h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronUp className="absolute h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>

          <div
            ref={sheetRef}
            className="overflow-hidden rounded-none border-x-0 border border-b-0 border-[#64748B] bg-muted"
            aria-label="현황 통계"
            aria-hidden={!panelsVisible}
          >
            <div id="index-dashboard-stats-panel" className="p-[15px]">
              {errors.length > 0 ? (
                <p className="mb-1.5 truncate text-xs text-amber-700 dark:text-amber-300">{errors.join(' · ')}</p>
              ) : null}

              <div className="overflow-hidden" style={{ height: PANEL_H }}>
                <div
                  className="grid h-full gap-[15px]"
                  style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}
                >
                  {panels.map((p) => (
                    <div key={p.key} className="h-full min-w-0">
                      {p.node}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
