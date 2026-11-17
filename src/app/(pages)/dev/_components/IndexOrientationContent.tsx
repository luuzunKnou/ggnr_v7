'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import { ServiceFilePdfThumb } from '@/app/(pages)/map/_mapComponents/standard/ServiceFilePdfThumb';
import type { IndexSheetGuide } from '@/app/(pages)/map/_mapComponents/standard/inferPdfPageUprightRotation';
import type {
  RiverIndexOrientationBatchStatus,
  RiverIndexOrientationListRow,
  RiverShapeLayerTrial,
} from '@/service/riverIndexOrientationService';
import { RIVER_INDEX_CONFIDENCE_MIN, RIVER_INDEX_ROTATIONS } from '@/lib/riverIndexOrientationEngine';

type Tab = 'river' | 'smallRiver';
type Filter = 'all' | 'review' | 'manual' | 'missing' | 'error';

const PAGE_SIZE = 20;

const METHOD_LABEL: Record<string, string> = {
  north: '방위표 N',
  shape: '모양 비교',
  weak: '모양 비교(애매)',
  pdf: '파일 회전값',
  none: '판정 불가',
};

/** 검토가 필요한 장 — 판정 안 됨·애매·오류, 방위표와 하천 모양이 엇갈림. 사람 확정은 제외 */
function needsReview(r: RiverIndexOrientationListRow): boolean {
  const rec = r.record;
  if (!rec) return false;
  if (rec.manualRotation != null) return false;
  if (rec.error) return true;
  if (rec.method === 'north') return Boolean(rec.northShapeConflict);
  return rec.method !== 'shape' || rec.confidence < RIVER_INDEX_CONFIDENCE_MIN;
}

/** 목록 순서 — 검토 필요(확신도 낮은 순) → 미판정 → 나머지 */
function sortRank(r: RiverIndexOrientationListRow): number {
  if (!r.record) return 1;
  if (needsReview(r)) return r.record.method === 'north' ? 0.99 : r.record.confidence;
  return 2 + (r.record.manualRotation != null ? 1 : 0);
}

type PreviewState = {
  ref: string | null;
  water: string | null;
  overlay: string | null;
  refLayer: string | null;
  refTrials: RiverShapeLayerTrial[];
  error?: string;
};

const TRIAL_STATUS_LABEL: Record<RiverShapeLayerTrial['status'], string> = {
  used: '사용',
  noTable: '레이어 없음',
  empty: '칸 안에 없음',
  small: '너무 작음',
  error: '오류',
  skipped: '건너뜀',
};

function trialText(t: RiverShapeLayerTrial): string {
  const pct = t.percent != null && t.percent > 0 ? ` ${t.percent}%` : '';
  return `${t.label}: ${TRIAL_STATUS_LABEL[t.status]}${pct}`;
}

/** 기준 레이어 후보별 결과 — 지도 하천 모양이 비었을 때 원인 확인용 */
function TrialList({ trials, className }: { trials: RiverShapeLayerTrial[]; className?: string }) {
  if (trials.length === 0) return null;
  return (
    <ul className={cn('space-y-0.5 text-[11px] text-muted-foreground', className)}>
      {trials.map((t) => (
        <li
          key={t.label}
          className={cn(t.status === 'used' && 'font-medium text-foreground', t.status === 'error' && 'text-destructive')}
          title={t.message}
        >
          {trialText(t)}
        </li>
      ))}
    </ul>
  );
}

/** 지도 하천 모양·도면 수면·겹침 그림 (서버에서 판정 방향으로 그림) */
function usePreview(tab: Tab, rowKey: string, rotation: number | null, version: string): PreviewState | null {
  const [state, setState] = useState<{ id: string; value: PreviewState } | null>(null);
  const id = `${tab}|${rowKey}|${rotation}|${version}`;
  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'riverIndexOrientationService',
      action: 'getRiverIndexOrientationPreview',
      params: { tab, key: rowKey, rotation: rotation ?? undefined },
    })
      .then((res) => {
        if (cancelled) return;
        const d = res?.data ?? res;
        setState({
          id,
          value: {
            ref: d?.refPng ?? null,
            water: d?.waterPng ?? null,
            overlay: d?.overlayPng ?? null,
            refLayer: d?.refLayer ?? null,
            refTrials: Array.isArray(d?.refTrials) ? d.refTrials : [],
            error: d?.error,
          },
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            id,
            value: {
              ref: null,
              water: null,
              overlay: null,
              refLayer: null,
              refTrials: [],
              error: e instanceof Error ? e.message : '불러오기 실패',
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, rowKey, rotation, version, id]);
  return state?.id === id ? state.value : null;
}

function ReferencePreview({
  tab,
  rowKey,
  rotation,
  version,
  onZoom,
}: {
  tab: Tab;
  rowKey: string;
  rotation: number | null;
  version: string;
  onZoom: () => void;
}) {
  const state = usePreview(tab, rowKey, rotation, version);
  if (!state) {
    return (
      <div className="flex h-20 w-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (!state.ref) return <p className="text-[11px] text-destructive">{state.error ?? '그림 없음'}</p>;
  if (!state.refLayer) {
    return (
      <button type="button" onClick={onZoom} className="text-left text-[11px] text-amber-700 underline-offset-2 hover:underline">
        칸 안 하천 레이어 없음 · 원인 보기
      </button>
    );
  }
  return (
    <button type="button" onClick={onZoom} className="flex cursor-zoom-in gap-1" title="크게 보기">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={state.ref} alt="지도 하천 모양" className="h-20 w-auto rounded border border-border" />
      {state.overlay ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={state.overlay} alt="겹침" className="h-20 w-auto rounded border border-border" />
      ) : null}
    </button>
  );
}

function SheetThumb({
  layer,
  row,
  rotation,
  maxPx = 320,
  className,
}: {
  layer: string;
  row: RiverIndexOrientationListRow;
  rotation: number;
  maxPx?: number;
  className?: string;
}) {
  const guide = useMemo<IndexSheetGuide>(() => ({ fixedRotation: rotation }), [rotation]);
  const fileName = row.record?.fileName;
  if (!fileName) return <span className="text-[11px] text-muted-foreground">PDF 없음</span>;
  return (
    <div className={cn('relative overflow-hidden rounded border border-border bg-white', className ?? 'h-24 w-36')}>
      <ServiceFilePdfThumb
        serEng={SER_FILE_ENG.riverBasicPlan}
        layerSegment={layer}
        keyValue={row.key}
        fileName={fileName}
        thumbMaxPx={maxPx}
        unboxed
        objectFit="contain"
        indexSheetGuide={guide}
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}

/** 크게 보기 — 방향을 바꿔 가며 지도 하천 모양·겹침·도면을 비교하고 바로 확정 */
function ZoomDialog({
  tab,
  layer,
  row,
  version,
  busy,
  onConfirm,
  onClose,
}: {
  tab: Tab;
  layer: string;
  row: RiverIndexOrientationListRow;
  version: string;
  busy: boolean;
  onConfirm: (rotation: number) => void;
  onClose: () => void;
}) {
  const [viewRot, setViewRot] = useState<number>(row.rotation ?? 0);
  const state = usePreview(tab, row.key, viewRot, version);
  const panel = 'flex min-w-0 flex-1 flex-col gap-1';
  const imgBox = 'flex h-[min(56vh,520px)] items-center justify-center rounded border border-border bg-white p-1';
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1400px)] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-base">
            {row.riverName || '—'} · {row.record?.fileName || row.key}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              기준 레이어: {state?.refLayer ?? row.record?.refLayer ?? '—'}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">미리보기 방향</span>
          {RIVER_INDEX_ROTATIONS.map((deg) => {
            const score = row.record?.scores.find((s) => s.rotation === deg)?.score;
            return (
              <button
                key={deg}
                type="button"
                onClick={() => setViewRot(deg)}
                className={cn(
                  'rounded border px-2.5 py-1 text-xs',
                  viewRot === deg ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted'
                )}
              >
                {deg}°{score != null ? ` (${score < 0 ? '–' : score.toFixed(2)})` : ''}
              </button>
            );
          })}
          <span className="ml-2 text-xs text-muted-foreground">
            지도 하천 <span className="text-blue-500">■</span> · 도면 수면 <span className="text-red-500">■</span> · 겹침{' '}
            <span className="text-purple-700">■</span>
          </span>
          <Button size="sm" className="ml-auto" disabled={busy} onClick={() => onConfirm(viewRot)}>
            {viewRot}°로 확정
          </Button>
        </div>
        <div className="flex min-h-0 gap-3">
          <div className={panel}>
            <p className="text-xs font-medium text-muted-foreground">지도 하천 모양</p>
            <div className={cn(imgBox, 'relative')}>
              {!state ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : state.ref && state.refLayer ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={state.ref} alt="" className="max-h-full max-w-full [image-rendering:pixelated]" />
              ) : (
                <div className="space-y-2 px-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    {state.error ?? '이 칸 안에서 하천 레이어를 찾지 못했습니다.'}
                  </p>
                  <TrialList trials={state.refTrials} className="text-left" />
                </div>
              )}
            </div>
            {state?.refLayer ? <TrialList trials={state.refTrials} /> : null}
          </div>
          <div className={panel}>
            <p className="text-xs font-medium text-muted-foreground">겹침 ({viewRot}°)</p>
            <div className={imgBox}>
              {state?.overlay ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={state.overlay} alt="" className="max-h-full max-w-full [image-rendering:pixelated]" />
              ) : (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
          <div className={cn(panel, 'flex-[1.4]')}>
            <p className="text-xs font-medium text-muted-foreground">도면 ({viewRot}°)</p>
            <SheetThumb layer={layer} row={row} rotation={viewRot} maxPx={1400} className="h-[min(56vh,520px)] w-full" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 개발 콘솔 — 하천기본계획 색인도 방향 판정·검토 */
export function IndexOrientationContent() {
  const [tab, setTab] = useState<Tab>('river');
  const [rows, setRows] = useState<RiverIndexOrientationListRow[]>([]);
  const [layer, setLayer] = useState('');
  const [status, setStatus] = useState<RiverIndexOrientationBatchStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('review');
  const [rejudgeAskOpen, setRejudgeAskOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  /** 크게 보기로 연 색인도 키 */
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'riverIndexOrientationService',
        action: 'listRiverIndexOrientations',
        params: { tab },
      });
      const d = res?.data ?? res;
      setRows(Array.isArray(d?.rows) ? d.rows : []);
      setLayer(String(d?.layer ?? ''));
      setStatus(d?.status ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 판정 중이면 진행 상황을 주기적으로 갱신, 끝나면 목록 다시 불러옴 */
  useEffect(() => {
    if (!status?.running) return;
    pollRef.current = window.setInterval(() => {
      void call('', 'POST', {
        service: 'riverIndexOrientationService',
        action: 'getRiverIndexOrientationBatchStatus',
        params: { tab },
      }).then((res) => {
        const st = (res?.data ?? res)?.status as RiverIndexOrientationBatchStatus | undefined;
        if (!st) return;
        setStatus(st);
        if (!st.running) void load();
      });
    }, 2000);
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [status?.running, tab, load]);

  const startBatch = async (mode: 'missing' | 'all' | 'allWithManual') => {
    setRejudgeAskOpen(false);
    const res = await call('', 'POST', {
      service: 'riverIndexOrientationService',
      action: 'startRiverIndexOrientationBatch',
      params: { tab, mode },
    });
    setStatus((res?.data ?? res)?.status ?? null);
  };

  const applyRecord = (key: string, record: RiverIndexOrientationListRow['record']) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, record, rotation: record ? (record.manualRotation ?? record.autoRotation) : null }
          : r
      )
    );
    setVersions((v) => ({ ...v, [key]: (v[key] ?? 0) + 1 }));
  };

  const setManual = async (key: string, rotation: number | null) => {
    setBusyKey(key);
    try {
      const res = await call('', 'POST', {
        service: 'riverIndexOrientationService',
        action: 'setRiverIndexOrientationManual',
        params: { tab, key, rotation },
      });
      applyRecord(key, (res?.data ?? res)?.record ?? null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusyKey(null);
    }
  };

  const rejudge = async (key: string) => {
    setBusyKey(key);
    try {
      const res = await call('', 'POST', {
        service: 'riverIndexOrientationService',
        action: 'judgeRiverIndexOrientation',
        params: { tab, key },
      });
      applyRecord(key, (res?.data ?? res)?.record ?? null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '판정하지 못했습니다.');
    } finally {
      setBusyKey(null);
    }
  };

  const counts = useMemo(() => {
    let judged = 0;
    let review = 0;
    let manual = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.record) judged++;
      if (needsReview(r)) review++;
      if (r.record?.manualRotation != null) manual++;
      if (r.record?.error) failed++;
    }
    return { judged, review, manual, failed };
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === 'review' && !needsReview(r)) return false;
        if (filter === 'manual' && r.record?.manualRotation == null) return false;
        if (filter === 'missing' && r.record) return false;
        if (filter === 'error' && !r.record?.error) return false;
        if (!kw) return true;
        return `${r.riverName} ${r.record?.fileName ?? ''} ${r.key}`.toLowerCase().includes(kw);
      })
      .sort((a, b) => sortRank(a) - sortRank(b) || a.riverName.localeCompare(b.riverName, 'ko') || a.ogcFid - b.ogcFid);
  }, [rows, filter, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(
            [
              { id: 'river', label: '지방하천' },
              { id: 'smallRiver', label: '소하천' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setPage(0);
              }}
              className={cn(
                'rounded px-3 py-1 text-sm',
                tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          판정 {counts.judged}/{rows.length} · 검토 필요 {counts.review} · 사람 확정 {counts.manual}
          {counts.failed ? ` · 오류 ${counts.failed}` : ''}
        </span>
        {status?.running ? (
          <span className="inline-flex items-center gap-1 text-sm text-primary">
            <Loader2 className="size-3.5 animate-spin" />
            판정 중 {status.done}/{status.total}
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            새로고침
          </Button>
          <Button size="sm" onClick={() => void startBatch('missing')} disabled={Boolean(status?.running)}>
            <Play className="size-3.5" />
            미판정·오류만 판정
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejudgeAskOpen(true)} disabled={Boolean(status?.running)}>
            <RotateCcw className="size-3.5" />
            전체 다시 판정
          </Button>
        </div>
      </div>

      <Dialog open={rejudgeAskOpen} onOpenChange={setRejudgeAskOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">전체 다시 판정</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tab === 'river' ? '지방하천' : '소하천'} 색인도 {rows.length}장을 다시 판정합니다. 사람이 확정한 {counts.manual}
            장은 어떻게 할까요?
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void startBatch('all')}>사람 확정은 빼고 다시 판정</Button>
            <Button variant="outline" onClick={() => void startBatch('allWithManual')} disabled={counts.manual === 0}>
              사람 확정도 해제하고 모두 다시 판정
            </Button>
            <Button variant="ghost" onClick={() => setRejudgeAskOpen(false)}>
              취소
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(0);
          }}
        >
          <option value="review">검토 필요</option>
          <option value="all">전체</option>
          <option value="manual">사람 확정</option>
          <option value="missing">미판정</option>
          <option value="error">오류</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(0);
            }}
            placeholder="하천명·파일명"
            className="h-8 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length}건</span>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">하천 · 파일</th>
              <th className="px-2 py-2 font-medium">지도 하천 모양 / 도면 수면</th>
              <th className="px-2 py-2 font-medium">도면(판정 방향)</th>
              <th className="px-2 py-2 font-medium">판정</th>
              <th className="px-2 py-2 font-medium">방향 확정</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const rec = r.record;
              const rot = r.rotation;
              const busy = busyKey === r.key;
              return (
                <tr key={r.key} className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <p className="font-medium text-foreground">{r.riverName || '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {rec?.fileName || r.key}
                      {r.rivpCode ? ` · ${r.rivpCode}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-2">
                    {rec && !rec.error ? (
                      <ReferencePreview
                        tab={tab}
                        rowKey={r.key}
                        rotation={rot}
                        version={`${versions[r.key] ?? 0}`}
                        onZoom={() => setZoomKey(r.key)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {rec && rot != null ? (
                      <button type="button" onClick={() => setZoomKey(r.key)} className="cursor-zoom-in" title="크게 보기">
                        <SheetThumb layer={layer} row={r} rotation={rot} />
                      </button>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {!rec ? (
                      <span className="text-muted-foreground">미판정</span>
                    ) : rec.error ? (
                      <span className="text-destructive">{rec.error}</span>
                    ) : (
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground">
                          {rot}°{rec.manualRotation != null ? ' · 사람 확정' : ''}
                        </p>
                        <p className={cn(needsReview(r) ? 'text-amber-700' : 'text-muted-foreground')}>
                          {rec.method === 'north'
                            ? '방위표 N 기준'
                            : `${METHOD_LABEL[rec.method] ?? rec.method} · 확신 ${rec.confidence.toFixed(2)}`}
                        </p>
                        {rec.northShapeConflict ? (
                          <p className="text-amber-700">하천 모양 비교와 방향이 다름</p>
                        ) : null}
                        <p className="text-muted-foreground">
                          {rec.scores.map((s) => `${s.rotation}°:${s.score < 0 ? '–' : s.score.toFixed(2)}`).join(' ')}
                        </p>
                        <p className="text-muted-foreground">파일 회전값 {rec.pageRotate}°</p>
                        {rec.refLayer ? (
                          <p className="text-muted-foreground">기준: {rec.refLayer}</p>
                        ) : (
                          <p className="text-amber-700" title={(rec.refTrials ?? []).map(trialText).join('\n')}>
                            기준: 하천 레이어 없음
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {RIVER_INDEX_ROTATIONS.map((deg) => (
                        <button
                          key={deg}
                          type="button"
                          disabled={busy}
                          onClick={() => void setManual(r.key, deg)}
                          className={cn(
                            'rounded border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
                            rot === deg
                              ? 'border-primary bg-primary/10 font-semibold text-primary'
                              : 'border-border hover:bg-muted'
                          )}
                        >
                          {deg}°
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 flex gap-2 text-xs">
                      {rec?.manualRotation != null ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setManual(r.key, null)}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          확정 해제
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void rejudge(r.key)}
                        className="text-muted-foreground hover:text-foreground hover:underline"
                      >
                        다시 판정
                      </button>
                      {busy ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {loading ? '불러오는 중…' : rows.length === 0 ? '색인도가 없습니다.' : '조건에 맞는 색인도가 없습니다.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {zoomKey
        ? (() => {
            const zr = rows.find((r) => r.key === zoomKey);
            if (!zr) return null;
            return (
              <ZoomDialog
                key={zoomKey}
                tab={tab}
                layer={layer}
                row={zr}
                version={`${versions[zoomKey] ?? 0}`}
                busy={busyKey === zoomKey}
                onConfirm={(deg) => void setManual(zoomKey, deg)}
                onClose={() => setZoomKey(null)}
              />
            );
          })()
        : null}

      <div className="flex items-center justify-center gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
          이전
        </Button>
        <span className="text-muted-foreground">
          {curPage + 1} / {pageCount}
        </span>
        <Button size="sm" variant="outline" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>
          다음
        </Button>
      </div>
    </div>
  );
}
