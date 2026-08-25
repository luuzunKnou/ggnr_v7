'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import {
  formatParcelAnalysisHeader,
  type MockParcelAnalysisResult,
  type ResultSectionDef,
} from './parcelAnalysis.result';
import {
  PARCEL_LAND_LINKAGE_FAIL_LABEL,
  PARCEL_LAND_LINKAGE_FAIL_TITLE,
  parcelLandLinkageSourceCellClass,
  parcelLandLinkageSourceLabel,
  parcelLandLinkageSourceTitle,
} from '@/lib/parcelLandNormalize';
import {
  BuildingDataSourceLine,
  BuildingLinkageLegend as SharedBuildingLinkageLegend,
  LandLinkageLegend as SharedLandLinkageLegend,
  ParcelLandLinkageFailReasonHidden,
} from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
import { ParcelAnalysisMapCapture } from './ParcelAnalysis.mapCapture';
import {
  FacilityLayerLegendIcon,
  ParcelAnalysisThemeMap,
  PARCEL_ANALYSIS_ANALYZING_SPINNER,
} from './ParcelAnalysis.themeMap';
import type { LayerDbGeometryKind } from '@/lib/mapLayerGeometryOrder';
import {
  PARCEL_THEME_MAP_FULL_COLOR_LIMIT,
  PARCEL_THEME_MAP_TOP_CATEGORY_COUNT,
} from '@/lib/parcelAnalysisTheme';
import { BASIC_MAP_TOC_TITLE, basicMapCompositeTitle } from './parcelAnalysis.mapStyle';

export type ParcelAnalysisTocGroup = {
  title: string;
  items: ResultSectionDef[];
};

type TocNavProps = {
  groups: ParcelAnalysisTocGroup[];
  activeSectionId: string | null;
  activeGroupTitle: string | null;
  activeNavButtonRef: RefObject<HTMLButtonElement | null>;
  onScrollToSection: (id: string) => void;
  resolveItemLabel: (section: ResultSectionDef) => string;
};

type TocIndicator = {
  top: number;
  height: number;
  visible: boolean;
};

const HIDDEN_INDICATOR: TocIndicator = { top: 0, height: 0, visible: false };

/** 목차 선택 — 앱 primary(#0F91B2) 기준, 도로대장 목록 패널과 동일 톤 */
const TOC_ITEM_ACTIVE =
  'rounded-r-sm bg-primary/[0.11] pl-2.5 font-medium text-foreground';
const TOC_ITEM_IDLE = 'rounded-sm pl-2.5 text-muted-foreground font-medium hover:bg-primary/5 hover:text-foreground';
const TOC_GROUP_ACTIVE = 'text-primary';
const TOC_GROUP_IDLE = 'text-foreground hover:text-primary';

function TocGroupHeading({
  title,
  groupActive,
  onClick,
}: {
  title: string;
  groupActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left text-xs font-semibold',
        groupActive ? TOC_GROUP_ACTIVE : TOC_GROUP_IDLE
      )}
    >
      · {title}
    </button>
  );
}

function TocItemButton({
  label,
  active,
  onClick,
  setButtonRef,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  setButtonRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={setButtonRef}
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full py-1 pr-1 text-left text-xs leading-snug whitespace-nowrap',
        active ? TOC_ITEM_ACTIVE : TOC_ITEM_IDLE
      )}
    >
      {label}
    </button>
  );
}

function TocGroupItemList({
  group,
  activeSectionId,
  activeNavButtonRef,
  onScrollToSection,
  resolveItemLabel,
}: {
  group: ParcelAnalysisTocGroup;
  activeSectionId: string | null;
  activeNavButtonRef: RefObject<HTMLButtonElement | null>;
  onScrollToSection: (id: string) => void;
  resolveItemLabel: (section: ResultSectionDef) => string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<TocIndicator>(HIDDEN_INDICATOR);

  const updateIndicator = useCallback(() => {
    const listEl = listRef.current;
    if (!listEl || !activeSectionId) {
      setIndicator(HIDDEN_INDICATOR);
      return;
    }

    const activeInGroup = group.items.some((item) => item.id === activeSectionId);
    if (!activeInGroup) {
      setIndicator(HIDDEN_INDICATOR);
      return;
    }

    const buttonEl = itemRefs.current.get(activeSectionId);
    if (!buttonEl) {
      setIndicator(HIDDEN_INDICATOR);
      return;
    }

    const listTop = listEl.getBoundingClientRect().top;
    const buttonRect = buttonEl.getBoundingClientRect();
    setIndicator({
      top: buttonRect.top - listTop + listEl.scrollTop,
      height: buttonRect.height,
      visible: true,
    });
  }, [activeSectionId, group.items]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useLayoutEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    const navEl = listEl.closest('nav');
    const onScroll = () => updateIndicator();
    navEl?.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(listEl);
    for (const buttonEl of itemRefs.current.values()) {
      observer.observe(buttonEl);
    }

    return () => {
      navEl?.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [updateIndicator, group.items]);

  return (
    <ul ref={listRef} className="relative ml-1.5 mt-1 space-y-0.5 border-l border-border">
      {indicator.visible ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 z-10 w-px -translate-x-1/2 bg-primary transition-[top,height] duration-200 ease-out"
          style={{ top: indicator.top, height: indicator.height }}
        />
      ) : null}
      {group.items.map((section) => {
        const active = activeSectionId === section.id;
        return (
          <li key={section.id}>
            <TocItemButton
              label={resolveItemLabel(section)}
              active={active}
              onClick={() => onScrollToSection(section.id)}
              setButtonRef={(el) => {
                if (el) {
                  itemRefs.current.set(section.id, el);
                  if (active) {
                    activeNavButtonRef.current = el;
                  }
                } else {
                  itemRefs.current.delete(section.id);
                }
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function ParcelAnalysisResultTocNav({
  groups,
  activeSectionId,
  activeGroupTitle,
  activeNavButtonRef,
  onScrollToSection,
  resolveItemLabel,
}: TocNavProps) {
  return (
    <nav className="min-h-0 w-[200px] shrink-0 overflow-y-auto border-r border-border bg-background px-3 py-3">
      <p className="mb-2 text-xs font-semibold text-foreground">목차</p>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.title}>
            <TocGroupHeading
              title={group.title}
              groupActive={activeGroupTitle === group.title}
              onClick={() => onScrollToSection(group.items[0].id)}
            />
            <TocGroupItemList
              group={group}
              activeSectionId={activeSectionId}
              activeNavButtonRef={activeNavButtonRef}
              onScrollToSection={onScrollToSection}
              resolveItemLabel={resolveItemLabel}
            />
          </div>
        ))}
      </div>
    </nav>
  );
}

type ResultModalProps = {
  open: boolean;
  onClose: () => void;
  onForceClose: () => void;
  sections: ResultSectionDef[];
  result: MockParcelAnalysisResult;
  analyzeError?: string | null;
  enriching?: boolean;
  scopeAreaSqm?: number;
  itemCount?: number;
  mapCaptureConfig?: {
    geoserverUrl: string;
    workspace: string;
    publishedLayerKeys?: string[];
  };
};

type TocGroup = ParcelAnalysisTocGroup;

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
/** 모달 바깥 «클릭»과 캡쳐 «드래그» 구분 (px) */
const OUTSIDE_CLICK_MOVE_THRESHOLD_PX = 5;

const RESULT_MODAL_WIDTH = 'min(1100px, calc(100vw - 2rem))';
const RESULT_MODAL_HEIGHT = 'min(720px, 85vh)';
/** 지도 패널·사이드바 위 — body portal 대신 레이아웃 트리에 렌더 (캡쳐 시 유지) */
const RESULT_MODAL_Z = 'z-[1300]';
/** 우측 본문 최소 폭 — 모달이 좁아지면 패널 전체 가로 스크롤 */
const RESULT_CONTENT_MIN_WIDTH_PX = 720;
/** 건축물대장·토지현황 표 공통 최대 높이 — 초과 시 표 영역 내부 세로 스크롤 */
const RESULT_SCROLL_TABLE_MAX_HEIGHT_PX = 460;

const TH_CELL = 'border border-border px-2 py-1.5 whitespace-nowrap';
const TH_CELL_STICKY = cn(TH_CELL, 'sticky top-0 z-10 bg-muted');
const TD_CELL = 'border border-border px-2 py-1.5 whitespace-nowrap';
/** 구분 열에 레이어 범례 아이콘이 들어가는 시설 현황 표 — 행 높이 압축 */
const TH_CELL_COMPACT = 'border border-border px-2 py-1 whitespace-nowrap';
const TD_CELL_COMPACT = 'border border-border px-2 py-1 whitespace-nowrap';

const FACILITY_STAT_EMPTY = '—';

function facilityStatCell(
  row: { geomType: string; stats: string; unit: string },
  target: 'POINT' | 'LINE' | 'POLYGON'
): string {
  if (row.geomType !== target) return FACILITY_STAT_EMPTY;
  return `${row.stats}${row.unit}`;
}

function sortFacilityStatRows<T extends { layerKorName: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.layerKorName.localeCompare(b.layerKorName, 'ko'));
}

function resolveSectionHeading(section: ResultSectionDef, landSectionTitle: string): string {
  if (section.kind === 'land') return landSectionTitle;
  if (section.kind === 'facility') {
    const base = section.itemTitle.replace(/\s*\(\d+개\)\s*$/, '');
    return `${base} 현황`;
  }
  return section.itemTitle;
}

function resolveTocItemLabel(section: ResultSectionDef): string {
  if (section.kind === 'basicMap') return BASIC_MAP_TOC_TITLE;
  if (section.kind === 'facility') {
    const base = section.itemTitle.replace(/\s*\(\d+개\)\s*$/, '');
    return `${base} 현황`;
  }
  return section.itemTitle;
}

/** 소유자·지목 테마 지도 — 2,000건 초과 시에만 제목 아래 «그 외» 안내 */
function themeMapGroupingHint(parcelCount: number, kind: 'owner' | 'jimok'): string | null {
  const n = Number.isFinite(parcelCount) ? Math.max(0, Math.floor(parcelCount)) : 0;
  if (n <= PARCEL_THEME_MAP_FULL_COLOR_LIMIT) return null;
  const categoryWord = kind === 'owner' ? '소유구분' : '지목';
  return `필지 ${PARCEL_THEME_MAP_FULL_COLOR_LIMIT.toLocaleString('ko-KR')}건 초과 · 지도·범례는 면적 상위 ${PARCEL_THEME_MAP_TOP_CATEGORY_COUNT}개 ${categoryWord}만 개별 표시, 나머지는 «그 외»로 묶음 (표는 전부)`;
}

const SCROLL_CHAIN_EPSILON = 2;

/** 내부 스크롤이 세로 끝(또는 스크롤 불가)일 때 바깥 스크롤 컨테이너로 휠 전달 */
function chainVerticalWheelScroll(inner: HTMLElement, outer: HTMLElement, event: WheelEvent) {
  const { deltaY } = event;
  if (deltaY === 0) return;

  const { scrollTop, scrollHeight, clientHeight } = inner;
  const canScrollInner = scrollHeight - clientHeight > SCROLL_CHAIN_EPSILON;
  const atTop = scrollTop <= SCROLL_CHAIN_EPSILON;
  const atBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_CHAIN_EPSILON;

  const scrollUpAtTop = deltaY < 0 && (!canScrollInner || atTop);
  const scrollDownAtBottom = deltaY > 0 && (!canScrollInner || atBottom);

  if (scrollUpAtTop || scrollDownAtBottom) {
    // 내부가 끝점이면 기본 동작을 막고 바깥(본문) 스크롤로 직접 넘긴다.
    event.preventDefault();
    outer.scrollBy({ top: deltaY });
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
    // 가로 스크롤 시 푸터가 표와 함께 움직이도록 같은 overflow 안에 둠
    return (
      <div className="w-full max-w-full overflow-x-auto">
        <div className={cn(fullWidth ? 'w-max min-w-full' : 'w-full')}>
          {table}
          {footer ? (
            <div className="shrink-0 border-t border-border bg-primary/5 px-3 py-2.5 text-center">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex w-full max-w-full flex-col overflow-hidden"
      style={{ maxHeight: `${maxHeight}px` }}
    >
      <div ref={innerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {table}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-border bg-primary/5 px-3 py-2.5 text-center">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function DataCell({
  value,
  title,
}: {
  value?: string | null;
  /** 마우스 오버 시 표시 (PNU 등) */
  title?: string | null;
}) {
  const text = value?.trim() ? value : '-';
  const tip = title?.trim() || undefined;
  return (
    <td className={TD_CELL} title={tip}>
      {text}
    </td>
  );
}

/** 토지현황 — 연계 출처 색·텍스트·연계실패(주황) */
function LandLinkageValueCell({
  value,
  linkageSource,
  showSourceText = false,
  title: titleOverride,
  failReason,
}: {
  value?: string | null;
  linkageSource?: string;
  /** true면 값 아래에 출처 텍스트(브이월드 등) */
  showSourceText?: boolean;
  /** 지정 시 연계 출처 title 대신 사용 (PNU 등) */
  title?: string | null;
  /** 연계실패 상세원인 — 화면 숨김 */
  failReason?: string | null;
}) {
  const text = value?.trim() ? value : '-';
  const isFail = text === PARCEL_LAND_LINKAGE_FAIL_LABEL;
  const hasValue = text !== '-' && !isFail;
  const srcClass = hasValue ? parcelLandLinkageSourceCellClass(linkageSource) : undefined;
  const srcLabel = hasValue ? parcelLandLinkageSourceLabel(linkageSource) : undefined;
  const linkageTitle = hasValue
    ? parcelLandLinkageSourceTitle(linkageSource)
    : isFail
      ? PARCEL_LAND_LINKAGE_FAIL_TITLE
      : undefined;
  const tip = titleOverride?.trim() || linkageTitle;
  return (
    <td
      className={cn(TD_CELL, isFail && 'font-medium text-amber-800 dark:text-amber-300')}
      title={tip}
    >
      <span className={cn(hasValue && srcClass)}>{text}</span>
      {isFail ? (
        <ParcelLandLinkageFailReasonHidden reason={failReason || PARCEL_LAND_LINKAGE_FAIL_TITLE} />
      ) : null}
      {showSourceText && hasValue && srcLabel ? (
        <div className={cn('mt-0.5 text-[10px] leading-tight font-medium', srcClass)}>{srcLabel}</div>
      ) : null}
      {showSourceText && isFail ? (
        <div className="mt-0.5 text-[10px] leading-tight font-medium text-amber-800 dark:text-amber-300">
          {PARCEL_LAND_LINKAGE_FAIL_LABEL}
        </div>
      ) : null}
    </td>
  );
}

function BuildingLinkageLegend({ rows }: { rows: MockParcelAnalysisResult['buildingRows'] }) {
  return <SharedBuildingLinkageLegend sources={rows.map((r) => r.linkageSource)} />;
}

function LandLinkageLegend({ rows }: { rows: MockParcelAnalysisResult['landRows'] }) {
  return (
    <SharedLandLinkageLegend
      sources={rows.map((r) => r.linkageSource)}
      showFail={rows.some((r) => r.linkageFailed)}
      showJijukHint
    />
  );
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
  onForceClose,
  sections,
  result,
  analyzeError,
  enriching = false,
  scopeAreaSqm = 0,
  itemCount = 0,
  mapCaptureConfig = { geoserverUrl: 'http://localhost:8080/geoserver', workspace: 'ggnr' },
}: ResultModalProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  const activeNavButtonRef = useRef<HTMLButtonElement>(null);
  const pendingTocScrollTargetRef = useRef<string | null>(null);
  const skipTocScrollIntoViewRef = useRef(false);
  const tocScrollUnlockTimerRef = useRef<number | null>(null);
  const backdropPointerSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
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

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  const syncActiveSectionFromScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const lockedId = pendingTocScrollTargetRef.current;
    if (lockedId) {
      setActiveSectionId((prev) => (prev === lockedId ? prev : lockedId));
      return;
    }
    const nextId = resolveActiveSectionId(root, sectionsRef.current);
    if (!nextId) return;
    setActiveSectionId((prev) => (prev === nextId ? prev : nextId));
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    if (tocScrollUnlockTimerRef.current != null) {
      window.clearTimeout(tocScrollUnlockTimerRef.current);
      tocScrollUnlockTimerRef.current = null;
    }
    pendingTocScrollTargetRef.current = id;
    skipTocScrollIntoViewRef.current = true;
    setActiveSectionId(id);
    scrollRootToSection(root, id, sectionsRef.current, 'smooth');
  }, []);

  useEffect(() => {
    if (!open) return;
    if (sections.length > 0 && !sections.some((s) => s.id === activeSectionId)) {
      const firstId = sections[0].id;
      queueMicrotask(() => setActiveSectionId(firstId));
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
      if (pendingTocScrollTargetRef.current) {
        const lockedId = pendingTocScrollTargetRef.current;
        setActiveSectionId((prev) => (prev === lockedId ? prev : lockedId));
        if (tocScrollUnlockTimerRef.current != null) {
          window.clearTimeout(tocScrollUnlockTimerRef.current);
        }
        tocScrollUnlockTimerRef.current = window.setTimeout(() => {
          pendingTocScrollTargetRef.current = null;
          tocScrollUnlockTimerRef.current = null;
          syncActiveSectionFromScroll();
        }, 150);
        return;
      }
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
      if (tocScrollUnlockTimerRef.current != null) {
        window.clearTimeout(tocScrollUnlockTimerRef.current);
        tocScrollUnlockTimerRef.current = null;
      }
      if (root) {
        root.removeEventListener('scroll', handleScroll);
      }
    };
  }, [open, syncActiveSectionFromScroll]);

  useEffect(() => {
    if (!open) return;
    if (skipTocScrollIntoViewRef.current) {
      skipTocScrollIntoViewRef.current = false;
      return;
    }
    activeNavButtonRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, activeSectionId]);

  /** 배경(어두운 영역) 짧은 클릭 → guarded onClose (캡쳐 중에는 context에서 차단) */
  const handleBackdropPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;

      backdropPointerSessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };

      const onPointerUp = (up: PointerEvent) => {
        const session = backdropPointerSessionRef.current;
        if (!session || up.pointerId !== session.pointerId) return;
        backdropPointerSessionRef.current = null;
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);

        const dx = Math.abs(up.clientX - session.startX);
        const dy = Math.abs(up.clientY - session.startY);
        if (
          dx <= OUTSIDE_CLICK_MOVE_THRESHOLD_PX &&
          dy <= OUTSIDE_CLICK_MOVE_THRESHOLD_PX
        ) {
          onClose();
        }
      };

      const onPointerCancel = (up: PointerEvent) => {
        if (backdropPointerSessionRef.current?.pointerId === up.pointerId) {
          backdropPointerSessionRef.current = null;
        }
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
      };

      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
    },
    [onClose]
  );

  useEffect(() => {
    if (open) return;
    backdropPointerSessionRef.current = null;
  }, [open]);

  /** 결과 모달 동안 body 세로 스크롤 잠금 — 캡처·콘텐츠 높이 변화로 바깥 스크롤 깜빡임 방지 */
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={cn('pointer-events-none fixed inset-0', RESULT_MODAL_Z)}>
      <div
        className="pointer-events-auto absolute inset-0 bg-black/50"
        aria-hidden
        onPointerDown={handleBackdropPointerDown}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="parcel-analysis-result-title"
        className={cn(
          'bg-background pointer-events-auto fixed top-[50%] left-[50%] flex min-h-0 -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden',
          'rounded-[5px] border border-border p-0 shadow-xl outline-none'
        )}
        style={{
          width: RESULT_MODAL_WIDTH,
          maxWidth: RESULT_MODAL_WIDTH,
          height: RESULT_MODAL_HEIGHT,
          maxHeight: RESULT_MODAL_HEIGHT,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="parcel-analysis-result-title" className="text-base font-semibold text-foreground">
              ○ 공간분석 결과
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              [ {headerBracket} ] · 항목 {itemCount}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onForceClose}>
              닫기
            </Button>
          </div>
        </div>

        {analyzeError ? (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {analyzeError}
          </div>
        ) : null}

        {enriching ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs text-primary">
            <div className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
            데이터를 보강하는 중입니다…
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ParcelAnalysisResultTocNav
            groups={tocGroups}
            activeSectionId={activeSectionId}
            activeGroupTitle={activeGroupTitle}
            activeNavButtonRef={activeNavButtonRef}
            onScrollToSection={scrollToSection}
            resolveItemLabel={resolveTocItemLabel}
          />

          <div
            ref={scrollRef}
            className="min-h-0 min-w-0 flex-1 snap-y snap-proximity overflow-auto overscroll-contain scroll-pt-3 scroll-pb-3 sm:scroll-pt-4 sm:scroll-pb-4"
          >
            <div
              className="w-full min-w-0"
              style={{ minWidth: `max(100%, ${RESULT_CONTENT_MIN_WIDTH_PX}px)` }}
            >
            {sections.map((s) => {
              const themeHint =
                s.kind === 'owner' || s.kind === 'jimok'
                  ? themeMapGroupingHint(result.parcelCount, s.kind)
                  : null;
              return (
              <section
                key={s.id}
                id={s.id}
                data-section-id={s.id}
                className="px-3 pt-3 pb-6 last:pb-3 sm:px-4"
              >
                <div className="mb-2 snap-start border-b border-border pb-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {resolveSectionHeading(s, landSectionTitle)}
                    </h3>
                    {s.kind === 'building' ? (
                      <BuildingDataSourceLine
                        className="shrink-0"
                        sources={result.buildingRows.map((r) => r.linkageSource)}
                      />
                    ) : null}
                    {s.kind === 'land' ? (
                      <BuildingDataSourceLine
                        className="shrink-0"
                        sources={result.landRows.map((r) => r.linkageSource)}
                      />
                    ) : null}
                  </div>
                  {s.kind === 'basicMap' && s.basicMapLayerIds?.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {basicMapCompositeTitle(s.basicMapLayerIds)}
                    </p>
                  ) : null}
                  {themeHint ? (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{themeHint}</p>
                  ) : null}
                </div>
                {renderSectionBody(s, result, {
                  landEnriching: enriching && s.kind === 'land',
                  mapCaptureConfig,
                  outerScrollRef: scrollRef,
                })}
              </section>
              );
            })}
            {sections.length === 0 && (
              <p className="text-sm text-muted-foreground">선택된 분석 항목이 없습니다.</p>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
        className="flex w-[min(380px,calc(100vw-2rem))] flex-col items-center gap-3 border-border px-6 py-8 sm:max-w-[min(380px,calc(100vw-2rem))]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onCancel?.()}
      >
        <DialogTitle className="sr-only">분석 중</DialogTitle>
        <DialogDescription className="sr-only">분석 결과를 불러오는 중입니다.</DialogDescription>
        <div className={PARCEL_ANALYSIS_ANALYZING_SPINNER} />
        <p className="text-sm font-medium text-foreground">분석 중…</p>
        <p className="w-full break-keep text-center text-xs leading-relaxed text-muted-foreground">
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

/** 토지현황 진행 한 줄 — 조회·연계를 합쳐 스피너 1개 */
function formatLandSectionProgress(
  progress: MockParcelAnalysisResult['landRowsProgress'] | undefined,
  landEnriching: boolean
): { text: string; loading: boolean } | null {
  const parcel = formatParcelLoadProgress(progress, 'land');
  if (parcel?.loading) {
    return {
      text: landEnriching ? `${parcel.text} · 소유·공시 연계` : parcel.text,
      loading: true,
    };
  }
  if (landEnriching) {
    return { text: '소유·공시지가 등 연계 정보', loading: true };
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
      text: `필지 ${formatLoadedTotalLabel(queried, total)} · 건축물 ${foundStr}건`,
      loading: true,
    };
  }
  if (total > 0) {
    return {
      text: `필지 ${total.toLocaleString('ko-KR')}건 · 건축물 ${foundStr}건`,
      loading: false,
    };
  }
  return { text: `건축물 ${foundStr}건`, loading: false };
}

function SectionProgressLine({ text, loading }: { text: string; loading: boolean }) {
  return (
    <p
      className={cn(
        'mb-2 inline-flex items-center gap-1.5 text-[11px]',
        loading ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {loading ? (
        <span
          className="size-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
          aria-hidden
          title="불러오는 중"
        />
      ) : null}
      <span>{text}</span>
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
    <span className="inline-flex items-center justify-center gap-2 text-[11px] text-primary">
      <span
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
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
    <tr className="bg-primary/5">
      <td colSpan={colSpan} className="border border-border px-3 py-2.5 text-center">
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
    mapCaptureConfig: {
      geoserverUrl: string;
      workspace: string;
      publishedLayerKeys?: string[];
    };
    outerScrollRef?: RefObject<HTMLElement | null>;
  } = {
    mapCaptureConfig: { geoserverUrl: 'http://localhost:8080/geoserver', workspace: 'ggnr' },
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
        publishedLayerKeys={opts.mapCaptureConfig.publishedLayerKeys}
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
        <div className="space-y-2">
          {result.buildingLedgerNotice ? (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {result.buildingLedgerNotice}
            </p>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
              분석 영역 필지에서 건축물대장을 찾지 못했습니다.
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        {result.buildingLedgerNotice ? (
          <p className="mb-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {result.buildingLedgerNotice}
          </p>
        ) : null}
        <SectionProgressLine text={ledgerProgress.text} loading={ledgerProgress.loading} />
        <BuildingLinkageLegend rows={result.buildingRows} />
        <ResultTable
          fullWidth
          maxHeight={RESULT_SCROLL_TABLE_MAX_HEIGHT_PX}
          outerScrollRef={opts.outerScrollRef}
          footer={
            loading ? (
              <TableProgressFooter
                label="건축물대장"
                loaded={progress?.loaded}
                total={progress?.total}
              />
            ) : undefined
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
                <td colSpan={9} className="border border-border px-2 py-6 text-center text-[11px] text-muted-foreground">
                  조회된 건축물이 있으면 여기에 표시됩니다.
                </td>
              </tr>
            ) : (
              <>
                {result.buildingRows.map((row, index) => (
                  <tr key={`${row.pnu}-${index}`}>
                    <td className={TD_CELL}>{index + 1}</td>
                    <LandLinkageValueCell
                      value={row.bldNm}
                      linkageSource={row.linkageSource}
                      title={row.pnu}
                    />
                    <DataCell value={row.platLoc} title={row.pnu} />
                    <DataCell value={row.jibun} title={row.pnu} />
                    <DataCell value={row.roadAddr} title={row.pnu} />
                    <LandLinkageValueCell value={row.bcRat} linkageSource={row.linkageSource} />
                    <LandLinkageValueCell value={row.vlRat} linkageSource={row.linkageSource} />
                    <LandLinkageValueCell value={row.platArea} linkageSource={row.linkageSource} />
                    <LandLinkageValueCell value={row.totArea} linkageSource={row.linkageSource} />
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
    /** 캡처 WMS는 표∩발행 목록만. 발행 목록이 비면 WMS 요청하지 않음(항공·영역만) */
    const publishedSet = new Set(
      (section.facilityWmsLayerKeys ?? []).map((k) => k.toLowerCase())
    );
    const wmsKeysForMap = publishedSet.size
      ? rows
          .map((r) => r.layerKey.trim())
          .filter((key) => key && publishedSet.has(key.toLowerCase()))
          .map((k) => k.toLowerCase())
      : [];
    const wmsGeomTypes = Object.fromEntries(
      rows
        .filter((r) => wmsKeysForMap.includes(r.layerKey.toLowerCase()))
        .map((r) => [r.layerKey.toLowerCase(), r.geomType])
    ) as Record<string, LayerDbGeometryKind>;
    const publishNotice =
      rows.length > 0 && publishedSet.size === 0
        ? '발행된 GeoServer 레이어가 없어 항공·분석영역만 표시합니다.'
        : rows.length > 0 && wmsKeysForMap.length === 0 && publishedSet.size > 0
          ? '표의 레이어가 GeoServer에 없어 항공·분석영역만 표시합니다.'
          : null;
    const mapBlock =
      result.wkt5181 && rows.length > 0 ? (
        <ParcelAnalysisMapCapture
          wkt5181={result.wkt5181}
          wmsLayerKeys={wmsKeysForMap.length ? wmsKeysForMap : undefined}
          wmsLayerGeomTypes={wmsGeomTypes}
          publishedLayerKeys={opts.mapCaptureConfig.publishedLayerKeys}
          showSatellite
          hideOnFailure={false}
          geoserverUrl={opts.mapCaptureConfig.geoserverUrl}
          workspace={opts.mapCaptureConfig.workspace}
        />
      ) : null;

    const facilityTableRows = sortFacilityStatRows(rows);

    return (
      <div className="space-y-3">
        {mapBlock}
        {publishNotice ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">{publishNotice}</p>
        ) : null}
        {!rows.length ? (
          <div className="rounded-md border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
            분석 영역에서 해당 시설을 찾지 못했습니다.
          </div>
        ) : (
          <ResultTable>
            <thead>
              <tr className="bg-muted text-left">
                <th className={TH_CELL_COMPACT}>구분</th>
                <th className={TH_CELL_COMPACT}>시설 수(개)</th>
                <th className={TH_CELL_COMPACT}>연장(m)</th>
                <th className={TH_CELL_COMPACT}>면적(㎡)</th>
              </tr>
            </thead>
            <tbody>
              {facilityTableRows.map((row) => (
                <tr key={row.layerKey}>
                  <td className={TD_CELL_COMPACT}>
                    <span className="inline-flex items-center gap-1.5">
                      <FacilityLayerLegendIcon layerKey={row.layerKey} geomType={row.geomType} />
                      {row.layerKorName}
                    </span>
                  </td>
                  <td className={cn(TD_CELL_COMPACT, 'text-right tabular-nums')}>
                    {facilityStatCell(row, 'POINT')}
                  </td>
                  <td className={cn(TD_CELL_COMPACT, 'text-right tabular-nums')}>
                    {facilityStatCell(row, 'LINE')}
                  </td>
                  <td className={cn(TD_CELL_COMPACT, 'text-right tabular-nums')}>
                    {facilityStatCell(row, 'POLYGON')}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResultTable>
        )}
      </div>
    );
  }

  if (section.kind === 'landUse') {
    const parcelProgress = formatParcelLoadProgress(result.landUseProgress, 'landUse');
    if (result.landUseStats.length === 0) {
      if (result.landUseProgress?.loading) {
        return (
          <div className="rounded-md border border-dashed border-primary/25 bg-primary/5 px-3 py-6 text-center text-xs text-primary">
            <LoadingProgressBlock
              label="토지이용계획"
              loaded={result.landUseProgress.loaded}
              total={result.landUseProgress.total}
              loading
            />
          </div>
        );
      }
      return (
        <div className="rounded-md border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
          분석 영역에서 토지이용계획 정보를 찾지 못했습니다.
        </div>
      );
    }
    return (
      <>
        {parcelProgress ? (
          <SectionProgressLine text={parcelProgress.text} loading={parcelProgress.loading} />
        ) : null}
        <ResultTable
          footer={
            parcelProgress?.loading ? (
              <TableProgressFooter
                label="토지이용계획"
                loaded={result.landUseProgress?.loaded}
                total={result.landUseProgress?.total}
              />
            ) : undefined
          }
        >
          <thead>
            <tr className="bg-muted text-left">
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
          </tbody>
        </ResultTable>
      </>
    );
  }

  if (section.kind === 'land') {
    const landSectionProgress = formatLandSectionProgress(
      result.landRowsProgress,
      landEnriching
    );
    if (result.landRows.length === 0) {
      if (result.landRowsProgress?.loading) {
        const landProgress = result.landRowsProgress;
        return (
          <div className="rounded-md border border-dashed border-primary/25 bg-primary/5 px-3 py-6 text-center text-xs text-primary">
            <LoadingProgressBlock
              label="토지현황"
              loaded={landProgress.loaded}
              total={landProgress.total}
              loading={landProgress.loading}
            />
          </div>
        );
      }
    } else {
      const showOwner = result.landRows.some(
        (r) => r.ownerName && r.ownerName !== '-' && r.ownerName !== PARCEL_LAND_LINKAGE_FAIL_LABEL
      );
      const showOwnerType = result.landRows.some(
        (r) =>
          r.ownerType &&
          r.ownerType !== '-' &&
          r.ownerType !== PARCEL_LAND_LINKAGE_FAIL_LABEL
      );
      const showPrice = result.landRows.some(
        (r) =>
          r.publicPrice &&
          r.publicPrice !== '-' &&
          r.publicPrice !== PARCEL_LAND_LINKAGE_FAIL_LABEL
      );
      return (
        <>
          {landSectionProgress ? (
            <SectionProgressLine
              text={landSectionProgress.text}
              loading={landSectionProgress.loading}
            />
          ) : null}
          {result.linkageNotice ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">{result.linkageNotice}</p>
          ) : null}
          <LandLinkageLegend rows={result.landRows} />
          <ResultTable
            maxHeight={RESULT_SCROLL_TABLE_MAX_HEIGHT_PX}
            outerScrollRef={opts.outerScrollRef}
            footer={
              landSectionProgress?.loading ? (
                <TableProgressFooter
                  label={landEnriching && !(result.landRowsProgress?.loading) ? '연계 정보' : '토지현황'}
                  loaded={result.landRowsProgress?.loaded}
                  total={result.landRowsProgress?.total}
                />
              ) : undefined
            }
          >
            <thead>
              <tr className="text-left text-foreground">
                <th className={TH_CELL_STICKY}>순번</th>
                <th className={TH_CELL_STICKY}>주소</th>
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
                  <DataCell value={row.addr} title={row.pnu} />
                  <DataCell value={row.jimok} />
                  <td className={TD_CELL}>{row.area}</td>
                  {showOwnerType ? (
                    <LandLinkageValueCell
                      value={row.ownerType}
                      linkageSource={row.linkageSource}
                      failReason={row.linkageFailReason}
                    />
                  ) : null}
                  {showOwner ? (
                    <LandLinkageValueCell
                      value={row.ownerName}
                      linkageSource={row.linkageSource}
                      failReason={row.linkageFailReason}
                    />
                  ) : null}
                  {showPrice ? (
                    <LandLinkageValueCell
                      value={row.publicPrice}
                      linkageSource={row.linkageSource}
                      failReason={row.linkageFailReason}
                    />
                  ) : null}
                </tr>
              ))}
            </tbody>
          </ResultTable>
        </>
      );
    }
  }

  if (section.kind === 'owner' && result.ownerStats.length > 0) {
    const ownerParcels = result.landRows.map((r) => ({
      pnu: r.pnu,
      category:
        r.ownerType && r.ownerType !== '-' && r.ownerType !== PARCEL_LAND_LINKAGE_FAIL_LABEL
          ? r.ownerType
          : '미상',
      areaSqm: Number(String(r.area).replace(/[^\d.]/g, '')) || 0,
    }));
    return (
      <div className="space-y-2">
        {result.wkt5181 ? (
          <ParcelAnalysisThemeMap
            wkt5181={result.wkt5181}
            theme="owner"
            parcels={ownerParcels}
            waitingForParcels={result.landRowsProgress?.loading ?? false}
          />
        ) : null}
        <ResultTable>
          <thead>
            <tr className="bg-muted text-left">
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
      </div>
    );
  }

  if (section.kind === 'jimok' && result.jimokStats.length > 0) {
    const jimokParcels = result.landRows.map((r) => ({
      pnu: r.pnu,
      category: r.jimok && r.jimok !== '-' ? r.jimok : '미상',
      areaSqm: Number(String(r.area).replace(/[^\d.]/g, '')) || 0,
    }));
    return (
      <div className="space-y-2">
        {result.wkt5181 ? (
          <ParcelAnalysisThemeMap
            wkt5181={result.wkt5181}
            theme="jimok"
            parcels={jimokParcels}
            waitingForParcels={result.landRowsProgress?.loading ?? false}
          />
        ) : null}
        <ResultTable>
          <thead>
            <tr className="bg-muted text-left">
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
      </div>
    );
  }

  if (
    section.kind === 'land' ||
    section.kind === 'owner' ||
    section.kind === 'jimok' ||
    section.kind === 'basicMap'
  ) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
        분석 영역에서 해당 필지를 찾지 못했습니다.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
      {section.groupTitle} · {section.itemTitle}
      <br />
      <span className="text-[10px] text-muted-foreground">(4차 외부 연계에서 제공됩니다)</span>
    </div>
  );
}
