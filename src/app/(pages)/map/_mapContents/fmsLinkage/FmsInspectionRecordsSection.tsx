'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll';
import { FMS_EMPTY_INSPECTION_MESSAGE } from './fmsLinkageBinding';
import {
  buildFmsDetailSections,
  countHiddenFmsDetailItems,
  FMS_INSPECTION_DETAIL_GROUPS,
  type FmsDetailAttrGroup,
  type FmsDetailAttrItem,
  type FmsDetailAttrSection,
} from './fmsDetailAttrGroups';
import { getStateGradeBadgeClass } from './stateGradeBadge';

export type FmsInspectionRecordRow = {
  id: string;
  dignSeq: string;
  dignGbn: string;
  startYmd: string;
  endYmd: string;
  stateGrade: string;
  attributes: FmsDetailAttrItem[];
};

const DEFAULT_INSPECTION_PAGE_SIZE = 10;

const FMS_ATTR_GROUP_LABEL_CLASS =
  'mb-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-muted-foreground';
const FMS_ATTR_LABEL_CLASS =
  'flex h-full shrink-0 items-center whitespace-nowrap border-b border-border bg-slate-100 px-2 py-1.5 align-middle font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground';
const FMS_ATTR_VALUE_CLASS =
  'flex min-w-0 items-start break-words border-b border-border bg-background px-2 py-1.5 text-slate-900 dark:text-foreground';

function StateGradeBadge({ grade }: { grade: string }) {
  const g = String(grade ?? '').trim();
  if (!g) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
        getStateGradeBadgeClass(g)
      )}
      title={g}
    >
      {g}
    </span>
  );
}

function formatInspectionPeriod(item: Pick<FmsInspectionRecordRow, 'startYmd' | 'endYmd'>): string {
  if (!item.startYmd && !item.endYmd) return '—';
  return `${item.startYmd || '—'} ~ ${item.endYmd || '—'}`;
}

function AttrRows({ items }: { items: FmsDetailAttrItem[] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      {items.map((item, idx) => (
        <div key={item.field} className="grid grid-cols-[8.25rem_minmax(0,1fr)]">
          <dt className={cn(FMS_ATTR_LABEL_CLASS, idx === items.length - 1 && 'border-b-0')}>
            {item.label}
          </dt>
          <dd className={cn(FMS_ATTR_VALUE_CLASS, idx === items.length - 1 && 'border-b-0')}>
            {item.field === 'state_grade' ? (
              <StateGradeBadge grade={item.value} />
            ) : (
              item.value || '—'
            )}
          </dd>
        </div>
      ))}
    </div>
  );
}

function GroupedAttrList({
  sections,
  expanded,
  onToggleExpanded,
}: {
  sections: FmsDetailAttrSection[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const visible = expanded ? sections : sections.filter((s) => s.primary);
  const hiddenCount = countHiddenFmsDetailItems(sections);

  return (
    <div className="space-y-2">
      {visible.map((section) => (
        <div key={section.id}>
          {section.label ? <div className={FMS_ATTR_GROUP_LABEL_CLASS}>{section.label}</div> : null}
          <AttrRows items={section.items} />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="standard-detail-secondary-btn w-full py-1.5"
        >
          {expanded ? '접기' : `더보기 (${hiddenCount}건)`}
        </button>
      ) : null}
    </div>
  );
}

function useGroupedAttrs(
  items: FmsDetailAttrItem[],
  groups: readonly FmsDetailAttrGroup[],
  resetKey: string
) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [resetKey]);
  const sections = useMemo(() => buildFmsDetailSections(items, groups), [items, groups]);
  return {
    sections,
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
  };
}

type Props = {
  inspections: FmsInspectionRecordRow[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  /** 탭 본문 등 — 바깥 스크롤에 맡길 때 false */
  selfScroll?: boolean;
  /** 페이지당 행 수 (기본 10) */
  pageSize?: number;
  className?: string;
};

export function FmsInspectionRecordsSection({
  inspections,
  loading = false,
  error = null,
  emptyMessage = FMS_EMPTY_INSPECTION_MESSAGE,
  selfScroll = true,
  pageSize = DEFAULT_INSPECTION_PAGE_SIZE,
  className,
}: Props) {
  const inspectionPageSize = Math.max(1, Math.floor(pageSize) || DEFAULT_INSPECTION_PAGE_SIZE);
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const [inspectionPage, setInspectionPage] = useState(1);
  const inspectionDetailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedInspectionId(null);
    setInspectionPage(1);
  }, [inspections, inspectionPageSize]);

  const scrollInspectionDetailIntoView = () => {
    const el = inspectionDetailRef.current;
    if (!el) return;
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        const containerTop = node.getBoundingClientRect().top;
        const targetTop = el.getBoundingClientRect().top;
        const nextTop = Math.max(0, targetTop - containerTop + node.scrollTop);
        node.scrollTo({ top: nextTop, behavior: 'smooth' });
        break;
      }
      node = node.parentElement;
    }
  };

  useEffect(() => {
    if (!selectedInspectionId) return;
    const frame = window.requestAnimationFrame(scrollInspectionDetailIntoView);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedInspectionId]);

  const latestInspection = inspections[0] ?? null;
  const selectedInspection = useMemo(
    () => inspections.find((item) => item.id === selectedInspectionId) ?? null,
    [inspections, selectedInspectionId]
  );
  const inspectionPageCount = Math.max(1, Math.ceil(inspections.length / inspectionPageSize));
  const safeInspectionPage = Math.min(inspectionPage, inspectionPageCount);
  const pagedInspections = useMemo(() => {
    const start = (safeInspectionPage - 1) * inspectionPageSize;
    return inspections.slice(start, start + inspectionPageSize);
  }, [inspections, safeInspectionPage, inspectionPageSize]);
  const inspectionAttrs = selectedInspection?.attributes ?? [];
  const inspectionResetKey = selectedInspection?.id ?? '';
  const inspectionGroups = useGroupedAttrs(
    inspectionAttrs,
    FMS_INSPECTION_DETAIL_GROUPS,
    inspectionResetKey
  );

  useEffect(() => {
    if (!inspectionGroups.expanded || !selectedInspectionId) return;
    const frame = window.requestAnimationFrame(scrollInspectionDetailIntoView);
    return () => window.cancelAnimationFrame(frame);
  }, [inspectionGroups.expanded, selectedInspectionId]);

  const latestDateLabel = latestInspection?.endYmd || latestInspection?.startYmd || '—';

  const body = (() => {
    if (loading) {
      return <div className="py-6 text-center text-[11px] text-muted-foreground">불러오는 중…</div>;
    }
    if (error) {
      return <div className="py-6 text-center text-[11px] text-red-600">{error}</div>;
    }
    if (inspections.length === 0) {
      return <div className="standard-detail-empty-dashed-compact">{emptyMessage}</div>;
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-slate-50 px-2.5 py-2 dark:bg-muted">
          <span className="inline-flex h-5 items-center gap-1.5 text-slate-500 dark:text-muted-foreground">
            <span className="leading-none">최근 등급</span>
            <StateGradeBadge grade={latestInspection?.stateGrade ?? ''} />
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-muted-foreground">
            최근 점검일
            <span className="font-medium text-slate-900 dark:text-foreground">{latestDateLabel}</span>
          </span>
          <span className="flex items-center gap-1 text-slate-500 dark:text-muted-foreground">
            총
            <span className="font-medium text-slate-900 dark:text-foreground">
              {inspections.length.toLocaleString()}건
            </span>
          </span>
        </div>

        <div className="overflow-hidden rounded border border-border">
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[110px]" />
              <col />
              <col className="w-[3.75rem]" />
            </colgroup>
            <thead className="bg-slate-100 dark:bg-muted">
              <tr>
                <th className="border-b border-border px-2 py-1.5 align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                  구분
                </th>
                <th className="border-b border-border px-2 py-1.5 align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                  기간
                </th>
                <th className="border-b border-border px-2 py-1.5 text-center align-middle font-semibold text-slate-500 dark:text-muted-foreground">
                  등급
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedInspections.map((item) => {
                const isSelected = selectedInspectionId === item.id;
                const selectInspection = () => {
                  setSelectedInspectionId((prev) => (prev === item.id ? null : item.id));
                };
                return (
                  <tr
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={selectInspection}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectInspection();
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border last:border-b-0 transition-colors',
                      isSelected
                        ? 'bg-primary/10 dark:bg-primary/25'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <td
                      className="truncate px-2 py-1.5 align-middle font-medium text-slate-900 dark:text-foreground"
                      title={item.dignGbn || '점검'}
                    >
                      {item.dignGbn || '점검'}
                    </td>
                    <td
                      className="truncate px-2 py-1.5 align-middle tabular-nums text-slate-900 dark:text-foreground"
                      title={formatInspectionPeriod(item)}
                    >
                      {formatInspectionPeriod(item)}
                    </td>
                    <td className="px-2 py-1.5 text-center align-middle">
                      <StateGradeBadge grade={item.stateGrade} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2 px-0.5">
          <button
            type="button"
            disabled={safeInspectionPage <= 1}
            onClick={() => setInspectionPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="이전 페이지"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>
          <span className="tabular-nums text-muted-foreground">
            {safeInspectionPage} / {inspectionPageCount}
          </span>
          <button
            type="button"
            disabled={safeInspectionPage >= inspectionPageCount}
            onClick={() => setInspectionPage((p) => Math.min(inspectionPageCount, p + 1))}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="다음 페이지"
          >
            다음
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {selectedInspection ? (
          <div
            ref={inspectionDetailRef}
            className="rounded border border-border bg-muted/30 px-2.5 py-2"
          >
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
              <span className="standard-detail-section-title">점검 상세</span>
              <span className="font-normal text-black/40 dark:text-muted-foreground/50">·</span>
              <span className="font-normal text-black/50 dark:text-muted-foreground">
                {selectedInspection.dignGbn || '점검'}
                {' · '}
                {formatInspectionPeriod(selectedInspection)}
              </span>
            </div>
            <GroupedAttrList
              sections={inspectionGroups.sections}
              expanded={inspectionGroups.expanded}
              onToggleExpanded={inspectionGroups.toggleExpanded}
            />
          </div>
        ) : null}
      </div>
    );
  })();

  if (!selfScroll) {
    return <div className={cn('text-[11px]', className)}>{body}</div>;
  }

  return (
    <MapSideDetailScroll
      className={cn(
        'standard-detail-scroll scroll-smooth min-h-0 flex-1 overflow-y-auto text-[11px]',
        className
      )}
    >
      {body}
    </MapSideDetailScroll>
  );
}
