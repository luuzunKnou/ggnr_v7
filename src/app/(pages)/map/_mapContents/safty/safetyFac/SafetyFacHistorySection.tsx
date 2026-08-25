'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { LayerRowPanelButton } from '@/app/(pages)/map/_mapComponents/layerRowEdit';

export type SafetyFacHistoryItem = {
  id: string;
  author: string;
  createdAt: string;
  content: string;
};

type Props = {
  /** 시설물 종류 — 레이어(테이블)명 → his_gubun */
  hisGubun: string;
  /** 관리번호 — 레이어 PK 값 → ftr_idn */
  ftrIdn: string;
};

function mapApiItem(raw: Record<string, unknown>): SafetyFacHistoryItem | null {
  const id = raw.id ?? raw.historyKey;
  if (id == null || String(id).trim() === '') return null;
  return {
    id: String(id),
    author: String(raw.author ?? raw.createdBy ?? '').trim() || '—',
    createdAt: String(raw.createdAt ?? '').trim(),
    content: String(raw.content ?? raw.hisContents ?? '').trim(),
  };
}

export function SafetyFacHistorySection({ hisGubun, ftrIdn }: Props) {
  const { data: session } = useSession();
  const [items, setItems] = useState<SafetyFacHistoryItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = editingId != null;

  /** 시설 전환·저장 완료 시 — 입력·편집 선택 모두 해제 */
  const clearEditor = useCallback(() => {
    setDraft('');
    setEditingId(null);
  }, []);

  /** 초기화 — 입력란 내용만 비움 (편집 선택 유지) */
  const clearDraftOnly = useCallback(() => {
    setDraft('');
  }, []);

  const loadList = useCallback(
    async (search: string) => {
      const gubun = hisGubun.trim();
      const idn = ftrIdn.trim();
      if (!gubun || !idn) {
        setItems([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'listByFacility',
          params: {
            hisGubun: gubun,
            ftrIdn: idn,
            search: search.trim() || undefined,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '이력을 불러오지 못했습니다.'));
          setItems([]);
          return;
        }
        const list = Array.isArray(data?.data) ? data.data : [];
        setItems(
          list
            .map((row: Record<string, unknown>) => mapApiItem(row))
            .filter((x: SafetyFacHistoryItem | null): x is SafetyFacHistoryItem => x != null)
        );
      } catch {
        setError('이력을 불러오지 못했습니다.');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [hisGubun, ftrIdn]
  );

  useEffect(() => {
    setSearchText('');
    setAppliedQuery('');
    clearEditor();
    setSectionOpen(true);
    setError(null);
    void loadList('');
  }, [hisGubun, ftrIdn, loadList, clearEditor]);

  const handleSearch = () => {
    const q = searchText.trim();
    setAppliedQuery(q);
    void loadList(q);
  };

  const beginEdit = (it: SafetyFacHistoryItem) => {
    setEditingId(it.id);
    setDraft(it.content);
    setError(null);
  };

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    const gubun = hisGubun.trim();
    const idn = ftrIdn.trim();
    if (!gubun || !idn) return;

    setSaving(true);
    setError(null);
    try {
      if (isEditMode && editingId) {
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'update',
          params: { id: Number(editingId), contents: content },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '수정에 실패했습니다.'));
          return;
        }
      } else {
        const createdBy =
          String(session?.user?.name ?? '').trim() ||
          String(session?.user?.id ?? '').trim() ||
          undefined;
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'create',
          params: {
            hisGubun: gubun,
            ftrIdn: idn,
            contents: content,
            createdBy,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '저장에 실패했습니다.'));
          return;
        }
      }
      clearEditor();
      await loadList(appliedQuery);
    } catch {
      setError(isEditMode ? '수정에 실패했습니다.' : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (it: SafetyFacHistoryItem) => {
    if (!window.confirm('이 이력을 삭제할까요?')) return;
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'safedataHistoryService',
        action: 'remove',
        params: { id: Number(it.id) },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setError(String(data?.error ?? '삭제에 실패했습니다.'));
        return;
      }
      if (editingId === it.id) clearEditor();
      await loadList(appliedQuery);
    } catch {
      setError('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="mt-1 flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
          onClick={() => setSectionOpen((v) => !v)}
          title={sectionOpen ? '이력 접기' : '이력 펼치기'}
        >
          {sectionOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-[12px] font-semibold text-muted-foreground">이력</span>
        </button>
      </div>

      {sectionOpen ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="작성자·내용 검색"
              title="작성자·내용 검색"
              className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary"
            />
            <LayerRowPanelButton
              onClick={handleSearch}
              title="검색"
              className="h-7 shrink-0"
              disabled={loading}
            >
              검색
            </LayerRowPanelButton>
          </div>

          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            {error ? (
              <p className="mb-1.5 shrink-0 px-0.5 text-[11px] text-destructive">{error}</p>
            ) : null}
            <div className="mb-1 flex shrink-0 items-center justify-end">
              <span className="text-[11px] text-muted-foreground">총 {items.length}건</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-background">
              {loading && items.length === 0 ? (
                <p className="px-1.5 py-1.5 text-[11px] text-muted-foreground">불러오는 중…</p>
              ) : items.length === 0 ? (
                <p className="px-1.5 py-1.5 text-[11px] text-muted-foreground">이력이 없습니다.</p>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <table className="w-full table-fixed border-collapse text-left text-[11px] text-foreground">
                    <colgroup>
                      <col className="w-auto" />
                      <col className="w-[7rem]" />
                      <col className="w-[5.75rem]" />
                      <col className="w-[2rem]" />
                    </colgroup>
                    <thead className="sticky top-0 z-[1]">
                      <tr className="border-b border-border bg-muted">
                        <th
                          scope="col"
                          className="bg-muted px-1.5 py-1.5 text-center text-[12px] font-medium text-foreground/90"
                        >
                          내용
                        </th>
                        <th
                          scope="col"
                          className="bg-muted px-1.5 py-1.5 text-center text-[12px] font-medium text-foreground/90"
                        >
                          작성자
                        </th>
                        <th
                          scope="col"
                          className="bg-muted px-1.5 py-1.5 text-center text-[12px] font-medium text-foreground/90"
                        >
                          작성일시
                        </th>
                        <th
                          scope="col"
                          className="bg-muted px-1 py-1.5 text-center text-[12px] font-medium text-foreground/90"
                        >
                          <span className="sr-only">삭제</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const selected = editingId === it.id;
                        return (
                          <tr
                            key={it.id}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              'cursor-pointer border-b border-border last:border-b-0',
                              selected
                                ? 'border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]'
                                : 'border-l-[3px] border-l-transparent hover:bg-muted/40'
                            )}
                            onClick={() => beginEdit(it)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                beginEdit(it);
                              }
                            }}
                          >
                            <td className="min-w-0 truncate px-1.5 py-1.5 text-center align-middle" title={it.content}>
                              {it.content}
                            </td>
                            <td className="truncate px-1.5 py-1.5 text-center align-middle" title={it.author}>
                              {it.author}
                            </td>
                            <td
                              className="truncate px-1.5 py-1.5 text-center align-middle text-[10px] text-muted-foreground"
                              title={it.createdAt}
                            >
                              {it.createdAt}
                            </td>
                            <td className="px-0.5 py-1 align-middle">
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                  title="삭제"
                                  aria-label="삭제"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(it);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex shrink-0 flex-col border-t border-border pt-2">
            <div className="flex h-[4.5rem] items-stretch gap-1.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={isEditMode ? '수정할 내용을 입력하세요' : '이력 내용을 입력하세요'}
                title="이력 내용"
                disabled={saving}
                className="box-border h-full min-h-0 min-w-0 flex-1 resize-none rounded-2xl border border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-foreground outline-none focus:border-primary disabled:opacity-60"
              />
              <div className="flex h-full shrink-0 flex-col gap-1">
                <LayerRowPanelButton
                  onClick={() => void handleSubmit()}
                  disabled={!draft.trim() || saving}
                  loading={saving}
                  title={isEditMode ? '수정' : '저장'}
                  className="min-h-0 min-w-[3.25rem] flex-1 justify-center"
                >
                  {isEditMode ? '수정' : '저장'}
                </LayerRowPanelButton>
                <LayerRowPanelButton
                  onClick={clearDraftOnly}
                  disabled={saving || !draft.trim()}
                  title="초기화"
                  className="min-h-0 min-w-[3.25rem] flex-1 justify-center"
                >
                  초기화
                </LayerRowPanelButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
