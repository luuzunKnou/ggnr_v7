'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { BoardAttachmentsPanel } from './BoardAttachmentsPanel';

function readApiError(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error.trim()) return o.error;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
  }
  return fallback;
}

export type BoardKind = 'notice' | 'library';

type ListRow = {
  noticeKey?: number;
  boardKey?: number;
  noticeTitle?: string;
  boardTitle?: string;
  noticeIsActive?: boolean;
  noticeStartDate?: string | null;
  noticeEndDate?: string | null;
  periodLabel?: string;
  noticeViewCnt?: number;
  boardViewCnt?: number;
  noticeCreateUser?: string | null;
  boardCreateUser?: string | null;
  dateLabel: string;
};

type DetailRow = {
  noticeKey?: number;
  boardKey?: number;
  noticeTitle?: string;
  boardTitle?: string;
  noticeContents?: string | null;
  boardContents?: string | null;
  noticeIsActive?: boolean;
  noticeStartDate?: string | null;
  noticeEndDate?: string | null;
  periodLabel?: string;
  noticeViewCnt?: number;
  boardViewCnt?: number;
  noticeCreateUser?: string | null;
  boardCreateUser?: string | null;
  dateLabel: string;
  updateDateLabel?: string;
};

const PAGE_SIZE = 15;

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

const BOARD_META: Record<
  BoardKind,
  { title: string; service: string; listPath: string; keyField: string; titleField: string }
> = {
  notice: {
    title: '공지사항',
    service: 'noticeService',
    listPath: '/notice',
    keyField: 'noticeKey',
    titleField: 'noticeTitle',
  },
  library: {
    title: '자료실',
    service: 'boardService',
    listPath: '/library',
    keyField: 'boardKey',
    titleField: 'boardTitle',
  },
};

function rowKey(row: ListRow, kind: BoardKind): number {
  return kind === 'notice' ? Number(row.noticeKey) : Number(row.boardKey);
}

function rowTitle(row: ListRow | DetailRow, kind: BoardKind): string {
  return kind === 'notice'
    ? String(row.noticeTitle ?? '')
    : String(row.boardTitle ?? '');
}

function rowViews(row: ListRow | DetailRow, kind: BoardKind): number {
  return kind === 'notice' ? Number(row.noticeViewCnt ?? 0) : Number(row.boardViewCnt ?? 0);
}

function rowAuthor(row: ListRow | DetailRow, kind: BoardKind): string {
  const u = kind === 'notice' ? row.noticeCreateUser : row.boardCreateUser;
  return (u ?? '').trim() || '-';
}

export function BoardScreen(props: { kind: BoardKind; postId?: number }) {
  const { kind, postId } = props;
  const meta = BOARD_META[kind];
  const router = useRouter();
  const { data: session } = useSession();
  const loggedIn = !!session?.user;

  const [view, setView] = useState<'list' | 'detail' | 'write' | 'edit'>(postId ? 'detail' : 'list');
  const [rows, setRows] = useState<ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailRow | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContents, setFormContents] = useState('');
  const [formNoticeActive, setFormNoticeActive] = useState(false);
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [writeAttachKey, setWriteAttachKey] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: meta.service,
        action: 'list',
        params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, keyword: keyword || undefined },
      });
      const data = (res.data ?? {}) as { rows?: ListRow[]; total?: number };
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (e: unknown) {
      setError(readApiError(e, '목록 조회 실패'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [meta.service, page, keyword]);

  const loadDetail = useCallback(
    async (id: number) => {
      setLoading(true);
      setError(null);
      try {
        const paramKey = kind === 'notice' ? { noticeKey: id } : { boardKey: id };
        const res = await call('', 'POST', {
          service: meta.service,
          action: 'get',
          params: paramKey,
        });
        const row = (res.data ?? null) as DetailRow | null;
        if (!row) {
          setError('게시글을 찾을 수 없습니다.');
          setDetail(null);
          return;
        }
        setDetail(row);
      } catch (e: unknown) {
        setError(readApiError(e, '조회 실패'));
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    [kind, meta.service]
  );

  useEffect(() => {
    if (view === 'list') void loadList();
  }, [view, loadList]);

  useEffect(() => {
    if (postId && postId > 0) {
      setView('detail');
      void loadDetail(postId);
    } else if (!postId) {
      setView('list');
      setDetail(null);
    }
  }, [postId, loadDetail]);

  const openDetail = (id: number) => {
    router.push(`${meta.listPath}/${id}`);
  };

  const abandonWriteDraft = useCallback(async () => {
    const draftKey = writeAttachKey;
    setWriteAttachKey(null);
    if (!draftKey) return;
    try {
      await call('', 'POST', {
        service: meta.service,
        action: 'discardAttachmentDraft',
        params: { draftKey },
      });
    } catch {
      /* 임시 첨부 정리 실패는 목록 복귀를 막지 않음 */
    }
  }, [writeAttachKey, meta.service]);

  const backToList = useCallback(() => {
    if (postId) {
      router.push(meta.listPath);
      return;
    }
    setView('list');
    setError(null);
  }, [postId, meta.listPath, router]);

  const cancelForm = useCallback(() => {
    if (view === 'edit' && detail) {
      setView('detail');
      return;
    }
    if (view === 'write') {
      void abandonWriteDraft();
    }
    backToList();
  }, [view, detail, abandonWriteDraft, backToList]);

  const startWrite = () => {
    if (!loggedIn) {
      setError('글쓰기는 로그인 후 이용할 수 있습니다.');
      return;
    }
    setFormTitle('');
    setFormContents('');
    setFormNoticeActive(false);
    setFormStartDate('');
    setFormEndDate('');
    setError(null);
    setWriteAttachKey(crypto.randomUUID());
    setView('write');
  };

  const startEdit = () => {
    if (!detail) return;
    setFormTitle(rowTitle(detail, kind));
    setFormContents(
      kind === 'notice'
        ? String(detail.noticeContents ?? '')
        : String(detail.boardContents ?? '')
    );
    if (kind === 'notice') {
      setFormNoticeActive(!!detail.noticeIsActive);
      setFormStartDate(toDateInput(detail.noticeStartDate));
      setFormEndDate(toDateInput(detail.noticeEndDate));
    }
    setError(null);
    setView('edit');
  };

  const submitForm = async () => {
    setSaving(true);
    setError(null);
    try {
      if (view === 'write') {
        const draftKey = writeAttachKey;
        const params =
          kind === 'notice'
            ? {
                noticeTitle: formTitle,
                noticeContents: formContents,
                noticeIsActive: formNoticeActive,
                noticeStartDate: formStartDate || null,
                noticeEndDate: formEndDate || null,
                attachmentDraftKey: draftKey,
              }
            : {
                boardTitle: formTitle,
                boardContents: formContents,
                attachmentDraftKey: draftKey,
              };
        const res = await call('', 'POST', {
          service: meta.service,
          action: 'create',
          params,
        });
        if (res?.success === false) {
          throw new Error(String(res.error ?? '등록 실패'));
        }
        const created = res.data;
        const newKey =
          kind === 'notice'
            ? Number((created as { noticeKey?: number })?.noticeKey)
            : Number((created as { boardKey?: number })?.boardKey);
        if (!newKey) throw new Error('등록 실패');
        setWriteAttachKey(null);
        router.push(`${meta.listPath}/${newKey}`);
        return;
      }

      if (view === 'edit' && detail) {
        const id = kind === 'notice' ? detail.noticeKey : detail.boardKey;
        const params =
          kind === 'notice'
            ? {
                noticeKey: id,
                noticeTitle: formTitle,
                noticeContents: formContents,
                noticeIsActive: formNoticeActive,
                noticeStartDate: formStartDate || null,
                noticeEndDate: formEndDate || null,
              }
            : { boardKey: id, boardTitle: formTitle, boardContents: formContents };
        await call('', 'POST', { service: meta.service, action: 'update', params });
        if (id) {
          setView('detail');
          void loadDetail(id);
        }
      }
    } catch (e: unknown) {
      setError(readApiError(e, '저장 실패'));
    } finally {
      setSaving(false);
    }
  };

  const removePost = async () => {
    if (!detail) return;
    if (!window.confirm('이 게시글을 삭제할까요?')) return;
    const id = kind === 'notice' ? detail.noticeKey : detail.boardKey;
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const params = kind === 'notice' ? { noticeKey: id } : { boardKey: id };
      await call('', 'POST', { service: meta.service, action: 'remove', params });
      backToList();
    } catch (e: unknown) {
      setError(readApiError(e, '삭제 실패'));
    } finally {
      setSaving(false);
    }
  };

  const listNo = useMemo(
    () => (idx: number) => total - page * PAGE_SIZE - idx,
    [total, page]
  );

  const detailPostKey =
    detail != null
      ? kind === 'notice'
        ? detail.noticeKey ?? null
        : detail.boardKey ?? null
      : null;

  return (
    <div className="flex flex-col bg-card border border-border rounded-[5px] overflow-visible">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {view !== 'list' ? (
            <button
              type="button"
              onClick={() => {
                if (view === 'detail') backToList();
                else cancelForm();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="목록으로"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link
              href="/"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="메인으로"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <h2 className="text-lg font-bold text-foreground truncate">{meta.title}</h2>
        </div>
        {view === 'list' && loggedIn ? (
          <Button type="button" size="sm" onClick={startWrite} className="shrink-0">
            글쓰기
          </Button>
        ) : null}
        {view === 'detail' && loggedIn ? (
          <div className="flex gap-2 shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={startEdit}>
              수정
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void removePost()} disabled={saving}>
              삭제
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="shrink-0 px-5 py-2 text-sm text-red-600 border-b border-red-100 bg-red-50/50">{error}</p>
      ) : null}

      {view === 'list' ? (
        <>
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border/60 shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(0);
                    setKeyword(searchInput.trim());
                  }
                }}
                placeholder="제목·내용 검색"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPage(0);
                setKeyword(searchInput.trim());
              }}
            >
              검색
            </Button>
          </div>

          <div className="overflow-visible">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b z-10">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="w-14 p-2.5 font-semibold text-center">번호</th>
                  <th className="p-2.5 font-semibold">제목</th>
                  {kind === 'notice' ? (
                    <>
                      <th className="w-36 p-2.5 font-semibold text-center hidden lg:table-cell">공지기간</th>
                      <th className="w-16 p-2.5 font-semibold text-center hidden md:table-cell">공지</th>
                    </>
                  ) : null}
                  <th className="w-24 p-2.5 font-semibold text-center hidden sm:table-cell">작성자</th>
                  <th className="w-24 p-2.5 font-semibold text-center">등록일</th>
                  <th className="w-16 p-2.5 font-semibold text-center hidden md:table-cell">조회</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={kind === 'notice' ? 7 : 5} className="p-8 text-center text-muted-foreground">
                      불러오는 중…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={kind === 'notice' ? 7 : 5} className="p-8 text-center text-muted-foreground">
                      등록된 게시글이 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const id = rowKey(row, kind);
                    return (
                      <tr
                        key={id}
                        className="border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => openDetail(id)}
                      >
                        <td className="p-2.5 text-center text-muted-foreground">{listNo(idx)}</td>
                        <td className="p-2.5 min-w-0">
                          <span className="truncate text-foreground block">{rowTitle(row, kind)}</span>
                        </td>
                        {kind === 'notice' ? (
                          <>
                            <td className="p-2.5 text-center text-muted-foreground text-xs whitespace-nowrap hidden lg:table-cell">
                              {row.periodLabel ?? '-'}
                            </td>
                            <td className="p-2.5 text-center hidden md:table-cell">
                              {row.noticeIsActive ? (
                                <span className="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                  Y
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">-</span>
                              )}
                            </td>
                          </>
                        ) : null}
                        <td className="p-2.5 text-center text-muted-foreground hidden sm:table-cell">
                          {rowAuthor(row, kind)}
                        </td>
                        <td className="p-2.5 text-center text-muted-foreground whitespace-nowrap">
                          {row.dateLabel}
                        </td>
                        <td className="p-2.5 text-center text-muted-foreground hidden md:table-cell">
                          {rowViews(row, kind)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center gap-3 px-5 py-3 border-t border-border shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : null}

      {view === 'detail' && detail ? (
        <div className="px-5 py-5">
          <div className="border-b border-border pb-4 mb-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {kind === 'notice' && detail.noticeIsActive ? (
                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  공지
                </span>
              ) : null}
              <h3 className="text-xl font-bold text-foreground">{rowTitle(detail, kind)}</h3>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {kind === 'notice' && detail.periodLabel ? (
                <span>공지기간 {detail.periodLabel}</span>
              ) : null}
              <span>작성자 {rowAuthor(detail, kind)}</span>
              <span>등록일 {detail.dateLabel}</span>
              {detail.updateDateLabel && detail.updateDateLabel !== detail.dateLabel ? (
                <span>수정일 {detail.updateDateLabel}</span>
              ) : null}
              <span>조회 {rowViews(detail, kind)}</span>
            </div>
          </div>
          <div
            className={cn(
              'prose prose-sm max-w-none text-foreground whitespace-pre-wrap break-words min-h-[200px]',
              'dark:prose-invert'
            )}
          >
            {(kind === 'notice' ? detail.noticeContents : detail.boardContents)?.trim() || (
              <span className="text-muted-foreground">내용 없음</span>
            )}
          </div>
          <BoardAttachmentsPanel kind={kind} postKey={detailPostKey} canEdit={loggedIn} />
        </div>
      ) : null}

      {view === 'detail' && loading && !detail ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">불러오는 중…</div>
      ) : null}

      {(view === 'write' || view === 'edit') && (
        <div className="px-5 py-5 flex flex-col gap-4 overflow-visible">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">제목</label>
            <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="h-9" />
          </div>
          {kind === 'notice' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">공지 시작일</label>
                <Input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">공지 종료일</label>
                <Input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
                <input
                  type="checkbox"
                  checked={formNoticeActive}
                  onChange={(e) => setFormNoticeActive(e.target.checked)}
                  className="rounded border-border"
                />
                공지여부 (기간 내 접속 시 팝업)
              </label>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">내용</label>
            <textarea
              value={formContents}
              onChange={(e) => setFormContents(e.target.value)}
              rows={10}
              className="w-full min-h-[10rem] rounded-md border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {view === 'write' ? (
            <BoardAttachmentsPanel kind={kind} postKey={writeAttachKey} canEdit={loggedIn} />
          ) : (
            <BoardAttachmentsPanel
              kind={kind}
              postKey={
                kind === 'notice' ? (detail?.noticeKey ?? null) : (detail?.boardKey ?? null)
              }
              canEdit={loggedIn}
            />
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={cancelForm}
              disabled={saving}
            >
              취소
            </Button>
            <Button type="button" onClick={() => void submitForm()} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
