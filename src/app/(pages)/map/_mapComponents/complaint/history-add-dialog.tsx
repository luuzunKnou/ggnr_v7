'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { User, Building2, FileText, X, Calendar, ClipboardList, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COMPLAINT_STATE_OPTIONS, getStateStyle } from './state-options';

export type HistoryAddFormData = {
  compdDate: string;
  compdCu: string;
  compdCt: string;
  compdCg: string;
  compdState: string;
  compdContent: string;
};

interface HistoryAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compKey: number;
  /** 추가 시 onConfirm(data), 수정 시 onConfirm(data, compdKey) */
  onConfirm: (data: HistoryAddFormData, editCompdKey?: number) => Promise<void>;
  /** 수정 시 이력 삭제 (compdKey 전달) */
  onDelete?: (compdKey: number) => Promise<void>;
  /** 수정 시 기존 데이터 (있으면 수정 모드) */
  initialData?: HistoryAddFormData | null;
  editCompdKey?: number | null;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const DEFAULT_STATE = '처리중';

export function HistoryAddDialog({ open, onOpenChange, compKey, onConfirm, onDelete, initialData, editCompdKey }: HistoryAddDialogProps) {
  const [state, setState] = useState(DEFAULT_STATE);
  const [compdDate, setCompdDate] = useState(todayStr);
  const [content, setContent] = useState('');
  const [handler, setHandler] = useState('');
  const [dept, setDept] = useState('');
  const [team, setTeam] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit = editCompdKey != null && editCompdKey > 0;
  const filterStates = COMPLAINT_STATE_OPTIONS;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setState(initialData.compdState || DEFAULT_STATE);
        setCompdDate(initialData.compdDate || todayStr());
        setContent(initialData.compdContent || '');
        setHandler(initialData.compdCu || '');
        setDept(initialData.compdCg || '');
        setTeam(initialData.compdCt || '');
      } else {
        setState(DEFAULT_STATE);
        setCompdDate(todayStr());
        setContent('');
        setHandler('');
        setDept('');
        setTeam('');
      }
    }
  }, [open, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSubmitting(true);
    try {
      await onConfirm(
        {
          compdDate: compdDate || todayStr(),
          compdCu: handler,
          compdCt: team,
          compdCg: dept,
          compdState: state,
          compdContent: content,
        },
        isEdit ? editCompdKey ?? undefined : undefined
      );
      setState(DEFAULT_STATE);
      setCompdDate(todayStr());
      setContent('');
      setHandler('');
      setDept('');
      setTeam('');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{isEdit ? '이력 수정' : '이력 추가'}</DialogTitle>
        {/* 헤더: 민원상세보기와 동일 (접수번호 대신 설명) */}
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 bg-slate-50/40">
          <span className="text-xs font-medium text-slate-600">처리내역</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col px-4 pb-4 pt-3">
          {/* 1행: 상태 (한 줄 꽉) */}
          <div className="flex items-center gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <ClipboardList className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">상태</span>
            <div className="flex gap-[10px] flex-wrap flex-1 min-w-0">
              {filterStates.map((s) => {
                const style = getStateStyle(s);
                const isActive = state === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setState(s)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
                      isActive ? `${style.bg} ${style.text} ${style.border}` : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2행: 담당부서 | 담당팀 */}
          <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4 mt-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                <Building2 className="h-3.5 w-3.5" />
              </span>
              <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">담당부서</span>
              <Input
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                placeholder="-"
                style={{ fontSize: '12px' }}
                className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                <Building2 className="h-3.5 w-3.5" />
              </span>
              <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">담당팀</span>
              <Input
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="-"
                style={{ fontSize: '12px' }}
                className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
              />
            </div>
          </div>

          {/* 3행: 담당자 | 처리일 */}
          <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4 mt-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">담당자</span>
              <Input
                value={handler}
                onChange={(e) => setHandler(e.target.value)}
                placeholder="-"
                style={{ fontSize: '12px' }}
                className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                <Calendar className="h-3.5 w-3.5" />
              </span>
              <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">처리일</span>
              <Input
                type="date"
                value={compdDate}
                onChange={(e) => setCompdDate(e.target.value)}
                style={{ fontSize: '12px' }}
                className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 accent-primary input-date-primary"
              />
            </div>
          </div>

          {/* 내용: 민원내용 디자인 그대로 (맨 아래) */}
          <div className="flex items-start gap-2 mt-3">
            <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="flex h-5 shrink-0 items-center w-14 text-[12px] text-muted-foreground/90">내용</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="-"
              rows={4}
              style={{ fontSize: '12px' }}
              className="min-h-[4.5rem] flex-1 min-w-0 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus:border-primary"
            />
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="submit"
              disabled={!state || submitting}
              className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
            >
              <Check className="h-3 w-3" />
              {submitting ? '저장 중…' : '저장'}
            </Button>
            {isEdit && onDelete && editCompdKey != null && (
              <Button
                type="button"
                variant="outline"
                disabled={deleting}
                onClick={async () => {
                  if (!confirm('이 처리내역을 삭제하시겠습니까?')) return;
                  setDeleting(true);
                  try {
                    await onDelete(editCompdKey);
                    onOpenChange(false);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="h-[26px] min-h-[26px] gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                {deleting ? '삭제 중…' : '삭제'}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
