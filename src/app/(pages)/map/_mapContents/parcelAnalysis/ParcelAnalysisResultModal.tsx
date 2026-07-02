'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import type { MockParcelAnalysisResult, ResultSectionDef } from './useParcelAnalysisResultSections';

type ResultModalProps = {
  open: boolean;
  onClose: () => void;
  sections: ResultSectionDef[];
  mockResult: MockParcelAnalysisResult;
  areaSummary?: string;
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
const WHEEL_DELTA_THRESHOLD = 72;
const WHEEL_STEP_COOLDOWN_MS = 320;
const SCROLL_END_DEBOUNCE_MS = 80;
const SNAP_TOLERANCE_PX = 6;
const ACTIVE_SECTION_THRESHOLD = 12;

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

function correctScrollToNearestSection(root: HTMLElement, sections: ResultSectionDef[]): string | null {
  const anchors = getSectionAnchors(root, sections);
  if (anchors.length === 0) return null;

  const scrollTop = root.scrollTop;
  let nearestIdx = 0;
  let minDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < anchors.length; i++) {
    const targetTop = Math.max(0, anchors[i].top - SCROLL_ANCHOR_OFFSET);
    const dist = Math.abs(scrollTop - targetTop);
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }

  const nearest = anchors[nearestIdx];
  const targetTop = Math.max(0, nearest.top - SCROLL_ANCHOR_OFFSET);

  if (minDist > SNAP_TOLERANCE_PX) {
    root.scrollTo({ top: targetTop, behavior: 'smooth' });
  }

  return nearest.id;
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
  mockResult,
  areaSummary,
}: ResultModalProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  const activeNavButtonRef = useRef<HTMLButtonElement>(null);
  const wheelAccumRef = useRef(0);
  const lastWheelStepAtRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tocGroups = useMemo(() => groupSectionsForToc(sections), [sections]);
  const activeGroupTitle = useMemo(
    () => sections.find((section) => section.id === activeSectionId)?.groupTitle ?? null,
    [sections, activeSectionId]
  );

  sectionsRef.current = sections;

  const syncActiveSectionFromScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const nextId = resolveActiveSectionId(root, sectionsRef.current);
    if (!nextId) return;
    setActiveSectionId((prev) => (prev === nextId ? prev : nextId));
  }, []);

  const markProgrammaticScroll = useCallback((durationMs = WHEEL_STEP_COOLDOWN_MS) => {
    programmaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
    }, durationMs);
  }, []);

  const scrollToSection = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;

      markProgrammaticScroll();
      wheelAccumRef.current = 0;
      scrollRootToSection(root, id, sectionsRef.current, 'smooth');
      setActiveSectionId(id);
    },
    [markProgrammaticScroll]
  );

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
    let scrollEndTimer: ReturnType<typeof setTimeout> | undefined;
    let root: HTMLDivElement | null = null;

    const handleScrollEnd = () => {
      if (!root || cancelled) return;

      if (programmaticScrollRef.current) {
        syncActiveSectionFromScroll();
        return;
      }

      const nearestId = correctScrollToNearestSection(root, sectionsRef.current);
      if (nearestId) {
        setActiveSectionId((prev) => (prev === nearestId ? prev : nearestId));
      } else {
        syncActiveSectionFromScroll();
      }
    };

    const handleScroll = () => {
      syncActiveSectionFromScroll();
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(handleScrollEnd, SCROLL_END_DEBOUNCE_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!root || cancelled || programmaticScrollRef.current) return;
      if (sectionsRef.current.length <= 1) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const now = Date.now();
      if (now - lastWheelStepAtRef.current < WHEEL_STEP_COOLDOWN_MS) {
        wheelAccumRef.current = 0;
        event.preventDefault();
        return;
      }

      if (
        wheelAccumRef.current !== 0 &&
        Math.sign(event.deltaY) !== Math.sign(wheelAccumRef.current)
      ) {
        wheelAccumRef.current = event.deltaY;
      } else {
        wheelAccumRef.current += event.deltaY;
      }

      if (Math.abs(wheelAccumRef.current) < WHEEL_DELTA_THRESHOLD) {
        event.preventDefault();
        return;
      }

      const direction = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      lastWheelStepAtRef.current = now;

      const anchors = getSectionAnchors(root, sectionsRef.current);
      if (anchors.length === 0) return;

      const currentIdx = getSectionIndexAtScroll(root, sectionsRef.current);
      const nextIdx = Math.min(anchors.length - 1, Math.max(0, currentIdx + direction));
      if (nextIdx === currentIdx) return;

      event.preventDefault();

      const nextId = anchors[nextIdx].id;
      markProgrammaticScroll();
      scrollRootToSection(root, nextId, sectionsRef.current, 'smooth');
      setActiveSectionId(nextId);
    };

    const attach = () => {
      if (cancelled) return;
      root = scrollRef.current;
      if (!root) {
        window.requestAnimationFrame(attach);
        return;
      }
      root.addEventListener('scroll', handleScroll, { passive: true });
      root.addEventListener('scrollend', handleScrollEnd);
      root.addEventListener('wheel', handleWheel, { passive: false });
    };

    attach();

    return () => {
      cancelled = true;
      if (root) {
        root.removeEventListener('scroll', handleScroll);
        root.removeEventListener('scrollend', handleScrollEnd);
        root.removeEventListener('wheel', handleWheel);
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
      programmaticScrollRef.current = false;
      wheelAccumRef.current = 0;
    };
  }, [open, markProgrammaticScroll, syncActiveSectionFromScroll]);

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
          '!flex h-[min(680px,82vh)] max-h-[min(680px,82vh)] min-h-0 w-[min(920px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden',
          'rounded-[10px] border-slate-200/80 p-0 shadow-xl sm:max-w-[min(920px,calc(100vw-2rem))]'
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-900">분석 결과</DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-xs text-slate-500">
              교차 필지 {mockResult.parcelCount} · 합계 {mockResult.totalAreaHa} ha · 항목{' '}
              {mockResult.itemCount}
              {areaSummary ? ` · ${areaSummary}` : ''}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled title="4차 CSV">
              CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav className="min-h-0 w-[168px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-3 py-3">
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
                              'block w-full rounded-sm py-1 pr-1 text-left text-xs leading-snug transition-colors',
                              active
                                ? 'bg-blue-50 font-semibold text-blue-700'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            )}
                          >
                            {s.itemTitle}
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
            className="min-h-0 min-w-0 flex-1 scroll-smooth overflow-y-auto overscroll-contain scroll-pt-3 scroll-pb-3 sm:scroll-pt-4 sm:scroll-pb-4"
          >
            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                data-section-id={s.id}
                className="px-3 pb-6 last:pb-3 sm:px-4"
              >
                <h3 className="mb-2 border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                  {s.itemTitle}
                </h3>
                {renderSectionBody(s, mockResult)}
              </section>
            ))}
            {sections.length === 0 && (
              <p className="text-sm text-slate-500">선택된 분석 항목이 없습니다.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AnalyzingModalProps = {
  open: boolean;
};

export function ParcelAnalysisAnalyzingModal({ open }: AnalyzingModalProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[min(320px,calc(100vw-2rem))] flex-col items-center gap-3 border-slate-200/80 py-8 sm:max-w-[320px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">분석 중</DialogTitle>
        <div className="size-9 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
        <p className="text-sm font-medium text-slate-800">분석 중…</p>
        <p className="text-xs text-slate-500">잠시만 기다려 주세요.</p>
      </DialogContent>
    </Dialog>
  );
}

function renderSectionBody(section: ResultSectionDef, result: MockParcelAnalysisResult) {
  if (section.kind === 'land' && result.landRows.length > 0) {
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 text-left text-slate-700">
            <th className="border border-slate-200 px-2 py-1.5">PNU</th>
            <th className="border border-slate-200 px-2 py-1.5">지번</th>
            <th className="border border-slate-200 px-2 py-1.5">지목</th>
            <th className="border border-slate-200 px-2 py-1.5">면적</th>
          </tr>
        </thead>
        <tbody>
          {result.landRows.map((row) => (
            <tr key={row.pnu}>
              <td className="border border-slate-200 px-2 py-1.5 font-mono text-[10px]">{row.pnu}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.addr}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.jimok}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.area}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (section.kind === 'owner' && result.ownerStats.length > 0) {
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className="border border-slate-200 px-2 py-1.5">소유구분</th>
            <th className="border border-slate-200 px-2 py-1.5">필지수</th>
            <th className="border border-slate-200 px-2 py-1.5">면적</th>
            <th className="border border-slate-200 px-2 py-1.5">비율</th>
          </tr>
        </thead>
        <tbody>
          {result.ownerStats.map((row) => (
            <tr key={row.label}>
              <td className="border border-slate-200 px-2 py-1.5">{row.label}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.count}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.area}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.ratio}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (section.kind === 'jimok' && result.jimokStats.length > 0) {
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className="border border-slate-200 px-2 py-1.5">지목</th>
            <th className="border border-slate-200 px-2 py-1.5">필지수</th>
            <th className="border border-slate-200 px-2 py-1.5">면적</th>
            <th className="border border-slate-200 px-2 py-1.5">비율</th>
          </tr>
        </thead>
        <tbody>
          {result.jimokStats.map((row) => (
            <tr key={row.jimok}>
              <td className="border border-slate-200 px-2 py-1.5">{row.jimok}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.count}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.area}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.ratio}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
      {section.groupTitle} · {section.itemTitle} — 1차 mock placeholder
      <br />
      <span className="text-[10px] text-slate-400">(3차 DB / 4차 연계에서 실데이터)</span>
    </div>
  );
}
