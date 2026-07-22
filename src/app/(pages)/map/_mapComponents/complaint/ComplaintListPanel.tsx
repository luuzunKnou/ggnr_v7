'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from '../MapContext';
import type { CompUI } from './types';
import type { ComplaintFormValues } from './complaint-info';
import { ComplaintDetailPanel } from './complaint-detail-panel';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import {
  Search,
  MapPin,
  Calendar,
  User,
  ChevronRight,
  Plus,
  MessageSquareText,
  CheckCircle2,
  Wrench,
  CircleDot,
  ClipboardList,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { COMPLAINT_STATE_OPTIONS, getStateStyle as getStateStyleBase } from './state-options';

const EMPTY_COMP: CompUI = {
  compKey: 0,
  compDate: null,
  compCu: null,
  compCt: null,
  compCg: null,
  compAdr: null,
  compName: null,
  compTel: null,
  compContent: null,
  compExtra: null,
};

const PAGE_SIZE = 50;

/** 목록 카드 배지용: getStateStyle + 아이콘 (점검/처리중/완료만 아이콘 매핑, 나머지는 기본) */
function getStateStyle(state: string) {
  const style = getStateStyleBase(state);
  const iconMap: Record<string, React.ReactNode> = {
    접수: <ClipboardList className="h-3 w-3 text-[#1D6AE3]" />,
    점검: <CheckCircle2 className="h-3 w-3 text-emerald-600" />,
    처리중: <Wrench className="h-3 w-3 text-orange-600" />,
    완료: <CheckCircle2 className="h-3 w-3 text-green-600" />,
  };
  return { ...style, icon: iconMap[state] ?? <CircleDot className="h-3 w-3 text-muted-foreground" /> };
}

export default function ComplaintListPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const mapContext = useMapContext();
  const setComplaintDetail = mapContext?.setComplaintDetail;
  const complaintDetail = mapContext?.complaintDetail ?? null;

  const [complaints, setComplaints] = useState<CompUI[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'complaintService',
        action: 'list',
        params: { limit: PAGE_SIZE, offset: 0 },
      });
      if (res?.success && res?.data) {
        const rows = (res.data.rows ?? []) as (CompUI & { latestState?: string | null })[];
        setComplaints(rows);
        setTotal(res.data.total ?? 0);
      } else {
        setComplaints([]);
        setTotal(0);
      }
    } catch (e) {
      console.error('민원 목록 조회 실패:', e);
      setComplaints([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, refreshKey]);

  const handleSelect = useCallback(
    async (comp: CompUI) => {
      if (!setComplaintDetail) return;
      try {
        const res = await call('', 'POST', {
          service: 'complaintService',
          action: 'get',
          params: { compKey: comp.compKey },
        });
        if (res?.success && res?.data) {
          setComplaintDetail(res.data as Parameters<typeof setComplaintDetail>[0]);
        }
      } catch (e) {
        console.error('민원 상세 조회 실패:', e);
      }
    },
    [setComplaintDetail]
  );

  const selectedKey = complaintDetail?.compKey ?? null;

  const handleCreateComplaint = useCallback(
    async (values: ComplaintFormValues) => {
      if (!setComplaintDetail) return;
      setSaving(true);
      try {
        const createRes = await call('', 'POST', {
          service: 'complaintService',
          action: 'create',
          params: {
            compDate: values.compDate || null,
            compCu: values.compCu || null,
            compCt: values.compCt || null,
            compCg: values.compCg || null,
            compAdr: values.compAdr || null,
            compName: values.compName || null,
            compTel: values.compTel || null,
            compContent: values.compContent || null,
          },
        });
        const created = createRes?.data as { compKey?: number } | undefined;
        const compKey = created?.compKey;
        if (!compKey) {
          console.error('민원 생성 실패: compKey 없음');
          return;
        }
        const getRes = await call('', 'POST', {
          service: 'complaintService',
          action: 'get',
          params: { compKey },
        });
        if (getRes?.success && getRes?.data) {
          setComplaintDetail(getRes.data as Parameters<typeof setComplaintDetail>[0]);
          setAddDialogOpen(false);
          loadList();
        }
      } catch (e) {
        console.error('민원 생성 실패:', e);
      } finally {
        setSaving(false);
      }
    },
    [setComplaintDetail, loadList]
  );

  const filtered = useMemo(() => {
    return complaints.filter((c) => {
      const latestState = c.latestState ?? '접수';
      const matchesSearch =
        !searchQuery ||
        c.compName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.compAdr?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.compContent?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(c.compKey).includes(searchQuery);
      const matchesFilter = !filterState || latestState === filterState;
      return matchesSearch && matchesFilter;
    });
  }, [complaints, searchQuery, filterState]);

  if (loading) {
    return (
      <div className="h-full flex flex-col min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1 py-12 text-sm text-muted-foreground">
          로딩 중...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="flex flex-col h-full bg-background">
        <div className="flex-shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/5">
                <MessageSquareText className="h-[18px] w-[18px] text-primary/80" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground/90">민원관리</h1>
                <p className="text-xs text-muted-foreground">
                  전체 <span className="font-medium text-foreground/80">{complaints.length}</span>건
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary rounded-lg"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-3 w-3" />
              민원 추가
            </Button>
          </div>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="접수번호, 민원인, 주소 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 rounded-lg bg-muted/50 border-transparent focus:bg-background focus:border-border text-sm"
              />
            </div>
          </div>

          <div className="px-5 pb-3">
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterState(null)}
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  filterState === null ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                전체
              </button>
              {COMPLAINT_STATE_OPTIONS.map((state) => {
                const style = getStateStyle(state);
                const isActive = filterState === state;
                return (
                  <button
                    key={state}
                    onClick={() => setFilterState(isActive ? null : state)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
                      isActive ? `${style.bg} ${style.text} ${style.border}` : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    )}
                  >
                    {state}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-1.5 p-3">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/80">
                <Search className="h-10 w-10 mb-3 opacity-25" />
                <p className="text-sm font-medium text-foreground/70">검색 결과가 없습니다</p>
                <p className="text-xs mt-1">다른 검색어를 입력해보세요</p>
              </div>
            )}
            {filtered.map((comp) => {
              const latestState = comp.latestState ?? '접수';
              const stateStyle = getStateStyle(latestState);
              const isSelected = selectedKey === comp.compKey;

              return (
                <button
                  key={comp.compKey}
                  onClick={() => handleSelect(comp)}
                  className={cn(
                    'w-full text-left rounded-[10px] border px-4 pt-2.5 pb-4 transition-all',
                    isSelected
                      ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15'
                      : 'border-border/80 bg-card hover:border-border/70 hover:bg-muted/20'
                  )}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/90 min-h-[1.5rem]">
                      <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium border shrink-0',
                            stateStyle.bg,
                            stateStyle.text,
                            stateStyle.border
                          )}
                        >
                          {stateStyle.icon}
                          {latestState}
                        </span>
                        <span className="text-[12px] font-mono shrink-0">#{comp.compKey}</span>
                        <span className="inline-flex items-center gap-1 shrink-0 text-[12px]">
                          <User className="h-3 w-3" />
                          <span className="truncate max-w-[4rem]">{comp.compName || '-'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 shrink-0 text-[12px]">
                          <Calendar className="h-3 w-3" />
                          {comp.compDate ? comp.compDate.slice(0, 10) : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <ChevronRight
                          className={cn('h-4 w-4 transition-colors', isSelected ? 'text-primary/80' : 'text-muted-foreground/40')}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[12px] text-muted-foreground/90 min-w-0 overflow-hidden">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{comp.compAdr || '-'}</span>
                    </div>
                    <p className="text-[12px] text-foreground/90 line-clamp-2 leading-relaxed">
                      {comp.compContent || '-'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px] p-0 gap-0 max-h-[90vh] overflow-hidden flex flex-col" showCloseButton={false}>
          <DialogTitle className="sr-only">민원 추가</DialogTitle>
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 bg-slate-50/40">
            <span className="text-xs font-medium text-slate-600">민원 추가</span>
            <button
              type="button"
              onClick={() => setAddDialogOpen(false)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col min-h-0 overflow-auto">
            <ComplaintDetailPanel
              mode="add"
              complaint={EMPTY_COMP}
              histories={[]}
              onSave={handleCreateComplaint}
              onClose={() => setAddDialogOpen(false)}
              saving={saving}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
