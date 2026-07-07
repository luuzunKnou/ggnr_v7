'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import type { MockParcelAnalysisResult, ResultSectionDef } from './useParcelAnalysisResultSections';
import { formatParcelAnalysisHeader } from './buildParcelAnalysisResult';
import { ParcelAnalysisMapCapture } from './ParcelAnalysisMapCapture';
import { PARCEL_ANALYSIS_ANALYZING_SPINNER } from './parcelAnalysisSpinner';
import { BASIC_MAP_TOC_TITLE, basicMapCompositeTitle } from './parcelAnalysisBasicMapConfig';

type ResultModalProps = {
  open: boolean;
  onClose: () => void;
  sections: ResultSectionDef[];
  result: MockParcelAnalysisResult;
  analyzeError?: string | null;
  enriching?: boolean;
  scopeAreaSqm?: number;
  itemCount?: number;
  mapCaptureConfig?: { geoserverUrl: string; workspace: string };
};

type TocGroup = {
  title: string;
  items: ResultSectionDef[];
};

function groupSectionsForToc(sections: ResultSectionDef[]): TocGroup[] {
  const groups: TocGroup[] = [];
  const indexByTitle = new Map<string, number>();

  for (const section of sections) {
    const existing = indexByTitle.get(section.groupTitle);
    if (existing === undefined) {
      indexByTitle.set(section.groupTitle, groups.length);
      groups.push({ title: section.groupTitle, items: [section] });
    } else {
      groups[existing].items.push(section);
    }
  }
  return groups;
}

const SCROLL_ANCHOR_OFFSET = 8;
const ACTIVE_SECTION_THRESHOLD = 12;

const RESULT_MODAL_WIDTH = 'min(1100px, calc(100vw - 2rem))';
const RESULT_MODAL_HEIGHT = 'min(720px, 85vh)';
/** 우측 본문 최소 폭 — 모달이 좁아지면 패널 전체 가로 스크롤 */
const RESULT_CONTENT_MIN_WIDTH_PX = 720;
/** 건축물대장·토지현황 표 공통 최대 높이 — 초과 시 표 영역 내부 세로 스크롤 */
const RESULT_SCROLL_TABLE_MAX_HEIGHT_PX = 460;

const TH_CELL = 'border border-slate-200 px-2 py-1.5 whitespace-nowrap';
const TH_CELL_STICKY = cn(TH_CELL, 'sticky top-0 z-10 bg-slate-100');
const TD_CELL = 'border border-slate-200 px-2 py-1.5 whitespace-nowrap';

function resolveSectionHeading(section: ResultSectionDef, landSectionTitle: string): string {
  if (section.kind === 'land') return landSectionTitle;
  return section.itemTitle;
}

function resolveTocItemLabel(section: ResultSectionDef): string {
  if (section.kind === 'basicMap') return BASIC_MAP_TOC_TITLE;
  return section.itemTitle;
}

const SCROLL_CHAIN_EPSILON = 1;

/** 내부 스크롤이 세로 끝에 닿으면 바깥 스크롤 컨테이너로 휠 전달 */
function chainVerticalWheelScroll(inner: HTMLElement, outer: HTMLElement, event: WheelEvent) {
  const { scrollTop, scrollHeight, clientHeight } = inner;
  if (scrollHeight - clientHeight <= SCROLL_CHAIN_EPSILON) return;

  const { deltaY } = event;
  if (deltaY === 0) return;

  const atTop = scrollTop <= SCROLL_CHAIN_EPSILON;
  const atBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_CHAIN_EPSILON;

  if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
    event.preventDefault();
    outer.scrollTop += deltaY;
  }
}

function ResultTable({
  children,
  fullWidth = false,
  maxHeight,
  outerScrollRef,
  footer,
}: {
  children: ReactNode;
  fullWidth?: boolean;
  /** px — 지정 시 표 래퍼에 세로·가로 스크롤 (건축물대장·토지현황) */
  maxHeight?: number;
  /** 세로 끝에서 휠을 바깥 본문 스크롤로 넘길 대상 */
  outerScrollRef?: RefObject<HTMLElement | null>;
  /** 표 하단 고정 진행 푸터 (스크롤 영역 밖) */
  footer?: ReactNode;
}) {
  const scrollable = maxHeight != null;
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = innerRef.current;
    const outer = outerScrollRef?.current;
    if (!scrollable || !inner || !outer) return;

    const onWheel = (event: WheelEvent) => {
      chainVerticalWheelScroll(inner, outer, event);
    };

    inner.addEventListener('wheel', onWheel, { passive: false });
    return () => inner.removeEventListener('wheel', onWheel);
  }, [scrollable, outerScrollRef]);

  const table = (
    <table
      className={cn(
        'border-collapse text-xs',
        fullWidth ? 'w-max min-w-full' : 'w-full'
      )}
    >
      {children}
    </table>
  );

  if (!scrollable) {
    return (
      <div className="w-full max-w-full overflow-x-auto">
        {table}
      </div>
    );
  }

  return (
    <div
      className="flex w-full max-w-full flex-col overflow-hidden"
      style={{ maxHeight: `${maxHeight}px` }}
    >
      <div ref={innerRef} className="min-h-0 flex-1 overflow-auto">
        {table}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-slate-200 bg-blue-50/60 px-3 py-2.5 text-center">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function DataCell({ value }: { value?: string | null }) {
  const text = value?.trim() ? value : '-';
  return <td className={TD_CELL}>{text}</td>;
}

type SectionAnchor = { id: string; top: number };

function getSectionAnchors(root: HTMLElement, sections: ResultSectionDef[]): SectionAnchor[] {
  const rootRect = root.getBoundingClientRect();
  const scrollTop = root.scrollTop;

  return sections
    .map((section) => {
      const el = root.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`);
      if (!el) return null;
      return {
        id: section.id,
        top: el.getBoundingClientRect().top - rootRect.top + scrollTop,
      };
    })
    .filter((entry): entry is SectionAnchor => entry != null);
}

function getSectionIndexAtScroll(root: HTMLElement, sections: ResultSectionDef[]): number {
  const anchors = getSectionAnchors(root, sections);
  if (anchors.length === 0) return 0;

  const scrollAnchor = root.scrollTop + SCROLL_ANCHOR_OFFSET;
  let index = 0;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].top <= scrollAnchor + ACTIVE_SECTION_THRESHOLD) {
      index = i;
    }
  }
  return index;
}

function scrollRootToSection(
  root: HTMLElement,
  sectionId: string,
  sections: ResultSectionDef[],
  behavior: ScrollBehavior = 'smooth'
) {
  const anchor = getSectionAnchors(root, sections).find((entry) => entry.id === sectionId);
  if (!anchor) return;
  root.scrollTo({ top: Math.max(0, anchor.top - SCROLL_ANCHOR_OFFSET), behavior });
}

function resolveActiveSectionId(root: HTMLElement, sections: ResultSectionDef[]): string {
  const anchors = getSectionAnchors(root, sections);
  if (anchors.length === 0) return sections[0]?.id ?? '';

  const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
  if (atBottom) {
    return anchors[anchors.length - 1].id;
  }

  const index = getSectionIndexAtScroll(root, sections);
  return anchors[index]?.id ?? sections[0]?.id ?? '';
}

export function ParcelAnalysisResultModal({
  open,
  onClose,
  sections,
  result,
  analyzeError,
  enriching = false,
  scopeAreaSqm = 0,
  itemCount = 0,
  mapCaptureConfig = { geoserverUrl: 'http://localhost:8080/geoserver', workspace: 'build_yy' },
}: ResultModalProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  const activeNavButtonRef = useRef<HTMLButtonElement>(null);
  const tocGroups = useMemo(() => groupSectionsForToc(sections), [sections]);
  const activeGroupTitle = useMemo(
    () => sections.find((section) => section.id === activeSectionId)?.groupTitle ?? null,
    [sections, activeSectionId]
  );

  const headerBracket = useMemo(
    () =>
      formatParcelAnalysisHeader({
        parcelCount: result.parcelCount,
        firstAddr: result.landRows[0]?.addr,
        scopeAreaSqm,
      }),
    [result.parcelCount, result.landRows, scopeAreaSqm]
  );

  const landSectionTitle = useMemo(() => {
    const areaText = `${result.totalAreaSqm.toLocaleString('ko-KR')}㎡`;
    return `토지현황 [ ${result.parcelCount}개 필지, 총면적 ${areaText} ]`;
  }, [result.parcelCount, result.totalAreaSqm]);

  sectionsRef.current = sections;

  const syncActiveSectionFromScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const nextId = resolveActiveSectionId(root, sectionsRef.current);
    if (!nextId) return;
    setActiveSectionId((prev) => (prev === nextId ? prev : nextId));
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    scrollRootToSection(root, id, sectionsRef.current, 'smooth');
    setActiveSectionId(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (sections.length > 0 && !sections.some((s) => s.id === activeSectionId)) {
      setActiveSectionId(sections[0].id);
    }
  }, [open, sections, activeSectionId]);

  useLayoutEffect(() => {
    if (!open) return;
    syncActiveSectionFromScroll();
    const raf = window.requestAnimationFrame(syncActiveSectionFromScroll);
    return () => window.cancelAnimationFrame(raf);
  }, [open, sections, syncActiveSectionFromScroll]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let root: HTMLDivElement | null = null;

    // 네이티브 스크롤 + CSS 근접 스냅에 맡기고, 스크롤 위치에 따라 활성 목차만 갱신한다.
    const handleScroll = () => {
      if (!root || cancelled) return;
      syncActiveSectionFromScroll();
    };

    const attach = () => {
      if (cancelled) return;
      root = scrollRef.current;
      if (!root) {
        window.requestAnimationFrame(attach);
        return;
      }
      root.addEventListener('scroll', handleScroll, { passive: true });
    };

    attach();

    return () => {
      cancelled = true;
      if (root) {
        root.removeEventListener('scroll', handleScroll);
      }
    };
  }, [open, syncActiveSectionFromScroll]);

  useEffect(() => {
    if (!open) return;
    activeNavButtonRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, activeSectionId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          '!flex min-h-0 flex-col gap-0 overflow-hidden',
          'rounded-[5px] border-slate-200/80 p-0 shadow-xl sm:!max-w-none'
        )}
        style={{
          width: RESULT_MODAL_WIDTH,
          maxWidth: RESULT_MODAL_WIDTH,
          height: RESULT_MODAL_HEIGHT,
          maxHeight: RESULT_MODAL_HEIGHT,
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-900">○ 공간분석 결과</DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-xs text-slate-500">
              [ {headerBracket} ] · 항목 {itemCount}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>

        {analyzeError ? (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            {analyzeError}
          </div>
        ) : null}

        {enriching ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-800">
            <div className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            데이터를 보강하는 중입니다…
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav className="min-h-0 w-[200px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-3 py-3">
            <p className="mb-2 text-xs font-semibold text-slate-800">목차</p>
            <div className="space-y-3">
              {tocGroups.map((group) => {
                const groupActive = activeGroupTitle === group.title;
                return (
                <div key={group.title}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(group.items[0].id)}
                    className={cn(
                      'text-left text-xs font-semibold transition-colors',
                      groupActive ? 'text-blue-700' : 'text-slate-800 hover:text-blue-700'
                    )}
                  >
                    · {group.title}
                  </button>
                  <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                    {group.items.map((s) => {
                      const active = activeSectionId === s.id;
                      return (
                        <li key={s.id}>
                          <button
                            ref={active ? activeNavButtonRef : undefined}
                            type="button"
                            onClick={() => scrollToSection(s.id)}
                            className={cn(
                              'block w-full rounded-sm py-1 pr-1 text-left text-xs leading-snug transition-colors whitespace-nowrap',
                              active
                                ? 'bg-blue-50 font-semibold text-blue-700'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            )}
                          >
                            {resolveTocItemLabel(s)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
              })}
            </div>
          </nav>

          <div
            ref={scrollRef}
            className="min-h-0 min-w-0 flex-1 snap-y snap-proximity overflow-auto overscroll-contain scroll-pt-3 scroll-pb-3 sm:scroll-pt-4 sm:scroll-pb-4"
          >
            <div
              className="w-full min-w-0"
              style={{ minWidth: `max(100%, ${RESULT_CONTENT_MIN_WIDTH_PX}px)` }}
            >
            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                data-section-id={s.id}
                className="px-3 pb-6 last:pb-3 sm:px-4"
              >
                <div className="mb-2 snap-start border-b border-slate-200 pb-1.5">
                  <h3 className="text-sm font-bold text-slate-900">
                    {resolveSectionHeading(s, landSectionTitle)}
                  </h3>
                  {s.kind === 'basicMap' && s.basicMapLayerIds?.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {basicMapCompositeTitle(s.basicMapLayerIds)}
                    </p>
                  ) : null}
                </div>
                {renderSectionBody(s, result, {
                  landEnriching: enriching && s.kind === 'land',
                  mapCaptureConfig,
                  outerScrollRef: scrollRef,
                })}
              </section>
            ))}
            {sections.length === 0 && (
              <p className="text-sm text-slate-500">선택된 분석 항목이 없습니다.</p>
            )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AnalyzingModalProps = {
  open: boolean;
  onCancel?: () => void;
};

export function ParcelAnalysisAnalyzingModal({ open, onCancel }: AnalyzingModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel?.();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[min(380px,calc(100vw-2rem))] flex-col items-center gap-3 border-slate-200/80 px-6 py-8 sm:max-w-[min(380px,calc(100vw-2rem))]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onCancel?.()}
      >
        <DialogTitle className="sr-only">분석 중</DialogTitle>
        <DialogDescription className="sr-only">분석 결과를 불러오는 중입니다.</DialogDescription>
        <div className={PARCEL_ANALYSIS_ANALYZING_SPINNER} />
        <p className="text-sm font-medium text-slate-800">분석 중…</p>
        <p className="w-full break-keep text-center text-xs leading-relaxed text-slate-500">
          필지가 많으면 수 분 이상 걸릴 수 있습니다.
          <br />
          토지현황·토지이용계획은 100건씩 순차 표시됩니다.
          <br />
          그만두려면 취소를 누르세요.
        </p>
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" className="mt-1" onClick={onCancel}>
            취소
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatParcelLoadProgress(
  progress?: MockParcelAnalysisResult['landRowsProgress'],
  kind: 'land' | 'landUse' = 'land'
): { text: string; loading: boolean } | null {
  if (!progress || progress.total <= 0) return null;
  if (!progress.loading && progress.loaded >= progress.total) return null;
  const loaded = progress.loaded.toLocaleString('ko-KR');
  const total = progress.total.toLocaleString('ko-KR');
  if (progress.loading) {
    const verb = kind === 'landUse' ? '집계' : '조회';
    return { text: `필지 ${loaded} / ${total}건 ${verb}`, loading: true };
  }
  return null;
}

function formatLoadedTotalLabel(loaded: number, total: number): string {
  return `${loaded.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}건`;
}

function formatBuildingLedgerProgress(
  progress: MockParcelAnalysisResult['landRowsProgress'] | undefined,
  found: number
): { text: string; loading: boolean } {
  const total = progress?.total ?? 0;
  const queried = progress?.loaded ?? 0;
  const foundStr = found.toLocaleString('ko-KR');
  if (progress?.loading && total > 0) {
    return {
      text: `필지 ${formatLoadedTotalLabel(queried, total)} 조회 · 건축물 발견 ${foundStr}건`,
      loading: true,
    };
  }
  if (total > 0) {
    return {
      text: `필지 ${total.toLocaleString('ko-KR')}건 조회 완료 · 건축물 발견 ${foundStr}건`,
      loading: false,
    };
  }
  return { text: `건축물 발견 ${foundStr}건`, loading: false };
}

function SectionProgressLine({ text, loading }: { text: string; loading: boolean }) {
  return (
    <p className={cn('mb-2 text-[11px]', loading ? 'text-blue-700' : 'text-slate-600')}>
      {text}
      {loading ? ' · 불러오는 중…' : ''}
    </p>
  );
}

function LoadingProgressBlock({
  label,
  loaded,
  total,
  loading = true,
}: {
  label: string;
  loaded?: number;
  total?: number;
  loading?: boolean;
}) {
  const countSuffix =
    loading && loaded != null && total != null && total > 0
      ? ` (${formatLoadedTotalLabel(loaded, total)})`
      : '';

  return (
    <span className="inline-flex items-center justify-center gap-2 text-[11px] text-blue-700">
      <span
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
        aria-hidden
      />
      {label}
      {countSuffix}
    </span>
  );
}

function TableProgressFooter({
  label,
  loaded,
  total,
  loading = true,
}: {
  label: string;
  loaded?: number;
  total?: number;
  loading?: boolean;
}) {
  return (
    <LoadingProgressBlock label={label} loaded={loaded} total={total} loading={loading} />
  );
}

function TableLoadingMoreRow({
  colSpan,
  label = '불러오는 중',
  loaded,
  total,
  loading = true,
}: {
  colSpan: number;
  label?: string;
  loaded?: number;
  total?: number;
  loading?: boolean;
}) {
  return (
    <tr className="bg-blue-50/60">
      <td colSpan={colSpan} className="border border-slate-200 px-3 py-2.5 text-center">
        <LoadingProgressBlock label={label} loaded={loaded} total={total} loading={loading} />
      </td>
    </tr>
  );
}

function renderSectionBody(
  section: ResultSectionDef,
  result: MockParcelAnalysisResult,
  opts: {
    landEnriching?: boolean;
    mapCaptureConfig: { geoserverUrl: string; workspace: string };
    outerScrollRef?: RefObject<HTMLElement | null>;
  } = {
    mapCaptureConfig: { geoserverUrl: 'http://localhost:8080/geoserver', workspace: 'build_yy' },
  }
) {
  const landEnriching = opts.landEnriching ?? false;

  if (section.kind === 'basicMap' && result.wkt5181 && section.basicMapLayerIds?.length) {
    return (
      <ParcelAnalysisMapCapture
        wkt5181={result.wkt5181}
        layerIds={section.basicMapLayerIds}
        geoserverUrl={opts.mapCaptureConfig.geoserverUrl}
        workspace={opts.mapCaptureConfig.workspace}
      />
    );
  }

  if (section.kind === 'building') {
    const progress = result.landRowsProgress;
    const loading = progress?.loading ?? false;
    const found = result.buildingRows.length;
    const ledgerProgress = formatBuildingLedgerProgress(progress, found);

    if (!loading && found === 0) {
      return (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          분석 영역 필지에서 건축물대장을 찾지 못했습니다.
        </div>
      );
    }

    return (
      <>
        <SectionProgressLine text={ledgerProgress.text} loading={ledgerProgress.loading} />
        <ResultTable
          fullWidth
          maxHeight={RESULT_SCROLL_TABLE_MAX_HEIGHT_PX}
          outerScrollRef={opts.outerScrollRef}
          footer={
            loading ? <TableProgressFooter label="불러오는 중…" /> : undefined
          }
        >
          <thead>
            <tr className="text-left">
              <th className={TH_CELL_STICKY}>순번</th>
              <th className={TH_CELL_STICKY}>명칭</th>
              <th className={TH_CELL_STICKY}>대지위치</th>
              <th className={TH_CELL_STICKY}>지번</th>
              <th className={TH_CELL_STICKY}>도로명</th>
              <th className={TH_CELL_STICKY}>건폐율</th>
              <th className={TH_CELL_STICKY}>용적률</th>
              <th className={TH_CELL_STICKY}>대지면적</th>
              <th className={TH_CELL_STICKY}>연면적</th>
            </tr>
          </thead>
          <tbody>
            {found === 0 && loading ? (
              <tr>
                <td colSpan={9} className="border border-slate-200 px-2 py-6 text-center text-[11px] text-slate-500">
                  표에 건축물이 있으면 여기에 표시됩니다.
                </td>
              </tr>
            ) : (
              <>
                {result.buildingRows.map((row, index) => (
                  <tr key={`${row.pnu}-${index}`}>
                    <td className={TD_CELL}>{index + 1}</td>
                    <DataCell value={row.bldNm} />
                    <DataCell value={row.platLoc} />
                    <DataCell value={row.jibun} />
                    <DataCell value={row.roadAddr} />
                    <td className={TD_CELL}>{row.bcRat}</td>
                    <td className={TD_CELL}>{row.vlRat}</td>
                    <td className={TD_CELL}>{row.platArea}</td>
                    <td className={TD_CELL}>{row.totArea}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </ResultTable>
      </>
    );
  }

  if (section.kind === 'facility') {
    const rows = result.facilityStats[section.id] ?? [];
    if (!rows.length) {
      return (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          분석 영역에서 해당 시설을 찾지 못했습니다.
        </div>
      );
    }
    const pointRows = rows.filter((r) => r.geomType === 'POINT');
    const lineRows = rows.filter((r) => r.geomType === 'LINE');
    const polyRows = rows.filter((r) => r.geomType === 'POLYGON');
    const tables = [
      { title: '시설 수', unit: '개', data: pointRows },
      { title: '연장', unit: 'm', data: lineRows },
      { title: '면적', unit: '㎡', data: polyRows },
    ].filter((t) => t.data.length > 0);

    return (
      <div className="space-y-3">
        {tables.map((table) => (
          <ResultTable key={table.title}>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className={TH_CELL}>구분</th>
                <th className={TH_CELL}>{table.title}</th>
              </tr>
            </thead>
            <tbody>
              {table.data.map((row) => (
                <tr key={`${row.layerKey}-${table.title}`}>
                  <td className={TD_CELL}>{row.layerKorName}</td>
                  <td className={cn(TD_CELL, 'whitespace-nowrap')}>
                    {row.stats}
                    {row.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResultTable>
        ))}
      </div>
    );
  }

  if (section.kind === 'landUse') {
    const parcelProgress = formatParcelLoadProgress(result.landUseProgress, 'landUse');
    if (result.landUseStats.length === 0) {
      if (result.landUseProgress?.loading) {
        return (
          <div className="rounded-md border border-dashed border-blue-200 bg-blue-50 px-3 py-6 text-center text-xs text-blue-800">
            토지이용계획을 순차 집계하는 중입니다…
            {parcelProgress ? (
              <p className="mt-1 text-[11px]">
                {parcelProgress.text}
                {parcelProgress.loading ? ' · 불러오는 중…' : ''}
              </p>
            ) : null}
          </div>
        );
      }
      return (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          분석 영역에서 토지이용계획 정보를 찾지 못했습니다.
        </div>
      );
    }
    return (
      <>
        {parcelProgress ? (
          <SectionProgressLine text={parcelProgress.text} loading={parcelProgress.loading} />
        ) : null}
        <ResultTable>
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className={TH_CELL}>용도지역</th>
              <th className={TH_CELL}>필지수</th>
              <th className={TH_CELL}>면적</th>
              <th className={TH_CELL}>비율</th>
            </tr>
          </thead>
          <tbody>
            {result.landUseStats.map((row) => (
              <tr key={row.zone}>
                <td className={TD_CELL}>{row.zone}</td>
                <td className={TD_CELL}>{row.count}</td>
                <td className={TD_CELL}>{row.area}</td>
                <td className={TD_CELL}>{row.ratio}</td>
              </tr>
            ))}
            {result.landUseProgress?.loading ? (
              <TableLoadingMoreRow colSpan={4} label="집계 중…" />
            ) : null}
          </tbody>
        </ResultTable>
      </>
    );
  }

  if (section.kind === 'land') {
    const parcelProgress = formatParcelLoadProgress(result.landRowsProgress, 'land');
    if (result.landRows.length === 0) {
      if (result.landRowsProgress?.loading) {
        const landProgress = result.landRowsProgress;
        return (
          <div className="rounded-md border border-dashed border-blue-200 bg-blue-50 px-3 py-6 text-center text-xs text-blue-800">
            <LoadingProgressBlock
              label="토지현황 불러오는 중"
              loaded={landProgress.loaded}
              total={landProgress.total}
              loading={landProgress.loading}
            />
          </div>
        );
      }
    } else {
      const showOwner = result.landRows.some((r) => r.ownerName && r.ownerName !== '-');
      const showOwnerType = result.landRows.some((r) => r.ownerType);
      const showPrice = result.landRows.some((r) => r.publicPrice && r.publicPrice !== '-');
      const landProgress = result.landRowsProgress;
      const landLoading = landProgress?.loading ?? false;
      return (
        <>
          {parcelProgress ? (
            <SectionProgressLine text={parcelProgress.text} loading={parcelProgress.loading} />
          ) : null}
          {landEnriching ? (
            <SectionProgressLine
              text="소유·공시지가 등 연계 정보를 불러오는 중"
              loading
            />
          ) : null}
          <ResultTable
            maxHeight={RESULT_SCROLL_TABLE_MAX_HEIGHT_PX}
            outerScrollRef={opts.outerScrollRef}
            footer={
              landLoading ? (
                <TableProgressFooter
                  label="불러오는 중…"
                  loaded={landProgress?.loaded}
                  total={landProgress?.total}
                />
              ) : landEnriching ? (
                <TableProgressFooter label="연계 정보 반영 중…" />
              ) : undefined
            }
          >
            <thead>
              <tr className="text-left text-slate-700">
                <th className={TH_CELL_STICKY}>순번</th>
                <th className={TH_CELL_STICKY}>PNU</th>
                <th className={TH_CELL_STICKY}>지번</th>
                <th className={TH_CELL_STICKY}>지목</th>
                <th className={TH_CELL_STICKY}>면적</th>
                {showOwnerType ? <th className={TH_CELL_STICKY}>소유구분</th> : null}
                {showOwner ? <th className={TH_CELL_STICKY}>소유자</th> : null}
                {showPrice ? <th className={TH_CELL_STICKY}>공시지가</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.landRows.map((row, index) => (
                <tr key={row.pnu}>
                  <td className={TD_CELL}>{index + 1}</td>
                  <td className={cn(TD_CELL, 'font-mono text-[10px]')}>{row.pnu}</td>
                  <DataCell value={row.addr} />
                  <td className={TD_CELL}>{row.jimok}</td>
                  <td className={TD_CELL}>{row.area}</td>
                  {showOwnerType ? <td className={TD_CELL}>{row.ownerType ?? '-'}</td> : null}
                  {showOwner ? <DataCell value={row.ownerName ?? '-'} /> : null}
                  {showPrice ? <td className={TD_CELL}>{row.publicPrice ?? '-'}</td> : null}
                </tr>
              ))}
            </tbody>
          </ResultTable>
        </>
      );
    }
  }

  if (section.kind === 'owner' && result.ownerStats.length > 0) {
    return (
      <ResultTable>
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className={TH_CELL}>소유구분</th>
            <th className={TH_CELL}>필지수</th>
            <th className={TH_CELL}>면적</th>
            <th className={TH_CELL}>비율</th>
          </tr>
        </thead>
        <tbody>
          {result.ownerStats.map((row) => (
            <tr key={row.label}>
              <td className={TD_CELL}>{row.label}</td>
              <td className={TD_CELL}>{row.count}</td>
              <td className={TD_CELL}>{row.area}</td>
              <td className={TD_CELL}>{row.ratio}</td>
            </tr>
          ))}
        </tbody>
      </ResultTable>
    );
  }

  if (section.kind === 'jimok' && result.jimokStats.length > 0) {
    return (
      <ResultTable>
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className={TH_CELL}>지목</th>
            <th className={TH_CELL}>필지수</th>
            <th className={TH_CELL}>면적</th>
            <th className={TH_CELL}>비율</th>
          </tr>
        </thead>
        <tbody>
          {result.jimokStats.map((row) => (
            <tr key={row.jimok}>
              <td className={TD_CELL}>{row.jimok}</td>
              <td className={TD_CELL}>{row.count}</td>
              <td className={TD_CELL}>{row.area}</td>
              <td className={TD_CELL}>{row.ratio}</td>
            </tr>
          ))}
        </tbody>
      </ResultTable>
    );
  }

  if (
    section.kind === 'land' ||
    section.kind === 'owner' ||
    section.kind === 'jimok' ||
    section.kind === 'landUse' ||
    section.kind === 'building' ||
    section.kind === 'facility' ||
    section.kind === 'basicMap'
  ) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
        분석 영역에서 해당 필지를 찾지 못했습니다.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
      {section.groupTitle} · {section.itemTitle}
      <br />
      <span className="text-[10px] text-slate-400">(4차 외부 연계에서 제공됩니다)</span>
    </div>
  );
}
