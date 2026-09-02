'use client';

import { useEffect, useState } from 'react';
import { Calendar, Check, FileText, Loader2, Trash2, User, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { call } from '@/lib/api';
import { formatToYmdOrText } from '@/lib/formatDateYmd';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel';
import type { SafetyFacHistoryItem } from './SafetyFacHistorySection';

type Props = {
  mode: 'add' | 'edit';
  hisGubun: string;
  ftrIdn: string;
  item?: SafetyFacHistoryItem;
  onClose: () => void;
  onSaved: () => void;
};

export function SafetyFacHistoryModal({
  mode,
  hisGubun,
  ftrIdn,
  item,
  onClose,
  onSaved,
}: Props) {
  const mapContext = useMapContext();
  const { data: session } = useSession();
  const isCreateMode = mode === 'add';
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20;

  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreateMode) {
      setContent('');
      setCreatedAt(formatToYmdOrText(new Date()));
      setAuthor(
        String(session?.user?.name ?? '').trim() ||
          String(session?.user?.id ?? '').trim() ||
          ''
      );
      setError(null);
      void call('', 'POST', {
        service: 'usrService',
        action: 'getMyProfile',
        params: {},
      }).then((res) => {
        const profile = res?.data?.data ?? res?.data ?? res;
        const name = String(profile?.name ?? session?.user?.name ?? '').trim();
        if (name) setAuthor(name);
      });
      return;
    }
    setContent(item?.content ?? '');
    setAuthor(item?.author === '—' ? '' : (item?.author ?? ''));
    setCreatedAt(formatToYmdOrText(item?.createdAt ?? ''));
    setError(null);
  }, [isCreateMode, item, session?.user?.id, session?.user?.name]);

  const handleDelete = async () => {
    if (isCreateMode || !item?.id || deleting || saving) return;
    if (!window.confirm('이 이력을 삭제할까요?')) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'safedataHistoryService',
        action: 'remove',
        params: { id: Number(item.id) },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setError(String(data?.error ?? '삭제에 실패했습니다.'));
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    const trimmed = content.trim();
    const trimmedAuthor = author.trim();
    const trimmedCreatedAt = createdAt.trim();
    if (!trimmed || !trimmedAuthor || !trimmedCreatedAt || saving) return;
    const gubun = hisGubun.trim();
    const idn = ftrIdn.trim();
    if (!gubun || !idn) return;

    setSaving(true);
    setError(null);
    try {
      if (isCreateMode) {
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'create',
          params: {
            hisGubun: gubun,
            ftrIdn: idn,
            contents: trimmed,
            createdBy: trimmedAuthor,
            createdAt: trimmedCreatedAt,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '저장에 실패했습니다.'));
          return;
        }
      } else if (item?.id) {
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'update',
          params: {
            id: Number(item.id),
            contents: trimmed,
            createdBy: trimmedAuthor,
            createdAt: trimmedCreatedAt,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '수정에 실패했습니다.'));
          return;
        }
      }
      onSaved();
      onClose();
    } catch {
      setError(isCreateMode ? '저장에 실패했습니다.' : '수정에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const form = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto p-4 text-xs">
        {error ? (
          <div className="mb-3 rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <div className="rounded-xl border border-border bg-card px-3 pt-3 pb-[15px]">
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 shrink-0 items-center text-muted-foreground/70">
                  <User className="h-3.5 w-3.5" />
                </span>
                <span className="w-14 shrink-0 text-[12px] text-muted-foreground/80">작성자</span>
                <Input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="작성자"
                  title="작성자"
                  disabled={saving}
                  style={{ fontSize: '12px' }}
                  className="h-8 flex-1 min-w-0 border-border bg-background placeholder:text-[12px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 shrink-0 items-center text-muted-foreground/70">
                  <Calendar className="h-3.5 w-3.5" />
                </span>
                <span className="w-14 shrink-0 text-[12px] text-muted-foreground/80">작성일시</span>
                <Input
                  type="date"
                  value={createdAt}
                  onChange={(e) => setCreatedAt(e.target.value)}
                  title="작성일시"
                  disabled={saving}
                  style={{ fontSize: '12px' }}
                  className="h-8 flex-1 min-w-0 border-border bg-background"
                />
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
                <FileText className="h-3.5 w-3.5" />
              </span>
              <span className="flex h-5 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">
                내용
              </span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="이력 내용을 입력하세요"
                rows={6}
                disabled={saving}
                style={{ fontSize: '12px' }}
                className="min-h-[5.5rem] flex-1 min-w-0 resize-none rounded-md border border-border bg-background px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-0 disabled:opacity-60"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            {!isCreateMode && item?.id ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleDelete()}
                disabled={saving || deleting}
                title="삭제"
                className="mr-auto h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed dark:hover:bg-red-950/30"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    삭제 중…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3 w-3" />
                    삭제
                  </>
                )}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || deleting || !content.trim() || !author.trim() || !createdAt.trim()}
              title="저장"
              className="h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  저장 중…
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  저장
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              disabled={saving || deleting}
              title="닫기"
              className="h-[26px] min-h-[26px] cursor-pointer gap-1 border border-border bg-muted/50 px-2.5 text-[12px] font-light text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
            >
              <X className="h-3 w-3" />
              닫기
            </Button>
          </div>
        </div>
      </MapSideDetailScroll>
    </div>
  );

  return (
    <MapFloatingPanel
      viewport
      width="480px"
      maxHeight="70vh"
      defaultPosition={{ top: 80, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">
            {isCreateMode ? '이력 추가' : '이력 상세'}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      {form}
    </MapFloatingPanel>
  );
}
