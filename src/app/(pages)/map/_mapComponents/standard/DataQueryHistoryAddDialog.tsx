'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Calendar, Check, ClipboardList, FileText, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DATA_QUERY_HISTORY_TYPES,
  type DataQueryHistoryType,
} from '@/lib/dataQueryHistoryTypes';

export type DataQueryHistoryAddFormData = {
  date: string;
  type: DataQueryHistoryType;
  title: string;
  contents: string;
  author: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: DataQueryHistoryAddFormData, editId?: number) => Promise<void>;
  onDelete?: (editId: number) => Promise<void>;
  initialData?: DataQueryHistoryAddFormData | null;
  editId?: number | null;
};

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

const TYPE_STYLE: Record<
  DataQueryHistoryType,
  { bg: string; text: string; border: string }
> = {
  점검: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  보수: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  이상발생: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  준공: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

export function DataQueryHistoryAddDialog({
  open,
  onOpenChange,
  onConfirm,
  onDelete,
  initialData,
  editId,
}: Props) {
  const [type, setType] = useState<DataQueryHistoryType>('점검');
  const [date, setDate] = useState(todayStr);
  const [title, setTitle] = useState('');
  const [contents, setContents] = useState('');
  const [author, setAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editId != null && editId > 0;

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setType(initialData.type);
      setDate(initialData.date || todayStr());
      setTitle(initialData.title);
      setContents(initialData.contents);
      setAuthor(initialData.author);
    } else {
      setType('점검');
      setDate(todayStr());
      setTitle('');
      setContents('');
      setAuthor('');
    }
    setError(null);
    setSubmitting(false);
    setDeleting(false);
  }, [open, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('제목을 입력하세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(
        {
          date: date || todayStr(),
          type,
          title: title.trim(),
          contents: contents.trim(),
          author: author.trim(),
        },
        isEdit ? editId ?? undefined : undefined
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{isEdit ? '이력 수정' : '이력 추가'}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0 bg-muted/30">
          <span className="text-xs font-medium text-muted-foreground">{isEdit ? '이력 수정' : '이력 추가'}</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          <div className="flex items-start gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <ClipboardList className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 pt-1.5 text-[12px] text-muted-foreground/90">유형</span>
            <div className="flex flex-1 flex-wrap gap-1.5 min-w-0">
              {DATA_QUERY_HISTORY_TYPES.map((t) => {
                const style = TYPE_STYLE[t];
                const active = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
                      active
                        ? `${style.bg} ${style.text} ${style.border}`
                        : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <Calendar className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">일자</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 flex-1 text-[12px]"
            />
          </div>

          <div className="flex items-center gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">제목</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목"
              className="h-8 flex-1 text-[12px]"
            />
          </div>

          <div className="flex items-start gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 pt-1.5 text-[12px] text-muted-foreground/90">내용</span>
            <textarea
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              rows={3}
              placeholder="내용"
              className="min-h-[72px] flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-1.5 text-[12px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>

          <div className="flex items-center gap-2 w-full">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <User className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">담당</span>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="담당자"
              className="h-8 flex-1 text-[12px]"
            />
          </div>

          {error && <p className="text-[11px] text-red-600 px-1">{error}</p>}

          <div className="mt-1 flex items-center justify-end gap-1.5">
            {isEdit && onDelete && editId != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto h-8 gap-1 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={submitting || deleting}
                onClick={async () => {
                  if (!window.confirm('이 이력을 삭제할까요?')) return;
                  setDeleting(true);
                  setError(null);
                  try {
                    await onDelete(editId);
                    onOpenChange(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <X className="h-3 w-3" />
                {deleting ? '삭제 중…' : '삭제'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => onOpenChange(false)}
              disabled={submitting || deleting}
            >
              취소
            </Button>
            <Button type="submit" size="sm" className="h-8 gap-1 text-[11px]" disabled={submitting || deleting}>
              <Check className="h-3 w-3" />
              {submitting ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
