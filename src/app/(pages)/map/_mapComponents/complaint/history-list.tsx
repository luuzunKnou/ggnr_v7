'use client';

import { useState } from 'react';
import type { CompdUI } from './types';
import { Button } from '@/app/shadcnComponents/ui/button';
import { CheckCircle2, Wrench, CircleDot, ClipboardList, ClipboardCheck, Plus } from 'lucide-react';
import { HistoryAddDialog, type HistoryAddFormData } from './history-add-dialog';
import { cn } from '@/lib/utils';
import { getStateStyle } from './state-options';

interface HistoryListProps {
  histories: CompdUI[];
  compKey: number;
  onAddHistory: (data: HistoryAddFormData) => Promise<void>;
  onEditHistory?: (compdKey: number, data: HistoryAddFormData) => Promise<void>;
  onDeleteHistory?: (compdKey: number) => Promise<void>;
}

const stateIconMap: Record<string, React.ReactNode> = {
  접수: <ClipboardList className="h-4 w-4 text-[#1D6AE3]" />,
  점검: <ClipboardCheck className="h-4 w-4 text-violet-600" />,
  처리중: <Wrench className="h-4 w-4 text-orange-600" />,
  완료: <CheckCircle2 className="h-4 w-4 text-green-600" />,
};

function getStateIcon(state: string | null) {
  return stateIconMap[state ?? ''] ?? <CircleDot className="h-4 w-4 text-muted-foreground" />;
}

export function HistoryList({ histories, compKey, onAddHistory, onEditHistory, onDeleteHistory }: HistoryListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingHistory, setEditingHistory] = useState<CompdUI | null>(null);

  const handleConfirm = async (data: HistoryAddFormData, editCompdKey?: number) => {
    setSubmitting(true);
    try {
      if (editCompdKey != null && onEditHistory) {
        await onEditHistory(editCompdKey, data);
      } else {
        await onAddHistory(data);
      }
      setDialogOpen(false);
      setEditingHistory(null);
    } finally {
      setSubmitting(false);
    }
  };

  const openAdd = () => {
    setEditingHistory(null);
    setDialogOpen(true);
  };

  const openEdit = (h: CompdUI) => {
    const extra = h.compdExtra as { title?: string; content?: string } | null;
    setEditingHistory(h);
    setDialogOpen(true);
  };

  const toCompdUI = (h: CompdUI): CompdUI => {
    const extra = h.compdExtra as { title?: string; content?: string } | null;
    return {
      ...h,
      compdTitle: h.compdTitle ?? extra?.title ?? undefined,
      compdContent: h.compdContent ?? extra?.content ?? undefined,
    };
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="relative px-1 py-2">
          <div className="flex flex-col gap-1">
            {histories.map((history, index) => {
              const h = toCompdUI(history);
              const style = getStateStyle(h.compdState);
              const icon = getStateIcon(h.compdState);
              const isLast = index === histories.length - 1;
              return (
                <button
                  type="button"
                  key={h.compdKey}
                  onClick={() => openEdit(h)}
                  className="relative flex gap-4 py-3 px-1 rounded-lg hover:bg-muted/40 transition-colors w-full text-left"
                >
                  {/* 세로선: 아이콘(30px) 가로 중앙(15px)을 지나고, 마지막은 아이콘 아래까지만 */}
                  <div
                    className={cn(
                      'absolute left-[18px] top-[15px] w-px bg-border pointer-events-none',
                      isLast ? 'h-[15px]' : 'h-[calc(100%+0.25rem)]'
                    )}
                    aria-hidden
                  />
                  <div
                    className={cn(
                      'relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border-2',
                      style.bg,
                      style.border,
                      style.text
                    )}
                  >
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center min-w-[52px] rounded-full px-2 py-0.5 text-[12px] font-medium border shrink-0',
                            style.bg,
                            style.text,
                            style.border
                          )}
                        >
                          {h.compdState}
                        </span>
                        <span className="text-[12px] text-muted-foreground/90">
                          {[h.compdDate ? h.compdDate.slice(0, 10) : '-', h.compdCg ?? '-', h.compdCt ?? '-', h.compdCu ?? '-'].join(' | ')}
                        </span>
                      </div>
                    </div>
                    <p className="text-[12px] text-muted-foreground/90 leading-relaxed mt-2">
                      {h.compdContent ?? (h.compdExtra as { content?: string })?.content ?? '-'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/80 px-4 py-3 mt-auto">
        <span className="text-[12px] text-muted-foreground/90">
          이력 <span className="font-medium text-foreground/90">{histories.length}</span>건
        </span>
        <Button
          size="sm"
          className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
          onClick={openAdd}
          disabled={submitting}
        >
          <Plus className="h-3 w-3" />
          이력 추가
        </Button>
      </div>

      <HistoryAddDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setEditingHistory(null);
          setDialogOpen(open);
        }}
        compKey={compKey}
        onConfirm={handleConfirm}
        onDelete={onDeleteHistory}
        initialData={
          editingHistory
            ? {
                compdDate: editingHistory.compdDate?.slice(0, 10) ?? '',
                compdCu: editingHistory.compdCu ?? '',
                compdCt: editingHistory.compdCt ?? '',
                compdCg: editingHistory.compdCg ?? '',
                compdState: editingHistory.compdState ?? '',
                compdContent: editingHistory.compdContent ?? (editingHistory.compdExtra as { content?: string })?.content ?? '',
              }
            : null
        }
        editCompdKey={editingHistory?.compdKey ?? null}
      />
    </div>
  );
}
