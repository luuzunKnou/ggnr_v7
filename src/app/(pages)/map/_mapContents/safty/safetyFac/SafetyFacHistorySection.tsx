'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import {
  LayerRowAddButton,
  LayerRowPanelButton,
} from '@/app/(pages)/map/_mapComponents/layerRowEdit';

export type SafetyFacHistoryItem = {
  id: string;
  author: string;
  createdAt: string;
  content: string;
};

type HistoryComposerMode = 'closed' | 'add' | 'edit';

type Props = {
  /** 시설물 종류 — 레이어(테이블)명 → his_gubun */
  hisGubun: string;
  /** 관리번호 — 레이어 PK 값 → ftr_idn */
  ftrIdn: string;
};

const HISTORY_TABLE_COL_COUNT = 5;

/** 안전점검 상세 속성표 th 배경과 동일 */
const SAFETY_FAC_TABLE_TH_CLASS =
  'border-b border-border bg-slate-100 px-1.5 py-1.5 align-middle text-[11px] font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground';

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
  const [composerMode, setComposerMode] = useState<HistoryComposerMode>('closed');
  const [sectionOpen, setSectionOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = composerMode === 'edit' && editingId != null;
  const composerOpen = composerMode !== 'closed';

  /** 시설 전환·저장 완료 시 — 입력·편집 선택 모두 해제 */
  const clearEditor = useCallback(() => {
    setDraft('');
    setEditingId(null);
    setComposerMode('closed');
  }, []);

  /** 초기화 — 입력란 내용만 비움 (편집·추가 모드 유지) */
  const clearDraftOnly = useCallback(() => {
    setDraft('');
  }, []);

  const loadList = useCallback(
    async (search: string, options?: { openInitial?: boolean }) => {
      const gubun = hisGubun.trim();
      const idn = ftrIdn.trim();
      if (!gubun || !idn) {
        setItems([]);
        if (options?.openInitial) {
          setComposerMode('add');
          setEditingId(null);
          setDraft('');
        }
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
          if (options?.openInitial) {
            setComposerMode('add');
            setEditingId(null);
            setDraft('');
          }
          return;
        }
        const list = Array.isArray(data?.data) ? data.data : [];
        const nextItems = list
          .map((row: Record<string, unknown>) => mapApiItem(row))
          .filter((x: SafetyFacHistoryItem | null): x is SafetyFacHistoryItem => x != null);
        setItems(nextItems);
        if (options?.openInitial) {
          if (nextItems.length > 0) {
            const first = nextItems[0];
            setComposerMode('edit');
            setEditingId(first.id);
            setDraft(first.content);
          } else {
            setComposerMode('add');
            setEditingId(null);
            setDraft('');
          }
        }
      } catch {
        setError('이력을 불러오지 못했습니다.');
        setItems([]);
        if (options?.openInitial) {
          setComposerMode('add');
          setEditingId(null);
          setDraft('');
        }
      } finally {
        setLoading(false);
      }
    },
    [hisGubun, ftrIdn]
  );

  useEffect(() => {
    setSearchText('');
    setAppliedQuery('');
    setSectionOpen(true);
    setError(null);
    setComposerMode('closed');
    setEditingId(null);
    setDraft('');
    void loadList('', { openInitial: true });
  }, [hisGubun, ftrIdn, loadList]);

  const handleSearch = () => {
    const q = searchText.trim();
    setAppliedQuery(q);
    void loadList(q);
  };

  const handleClearSearch = () => {
    setSearchText('');
    setAppliedQuery('');
    void loadList('');
  };

  const showSearchClear = Boolean(searchText.trim() || appliedQuery);

  const handleAdd = () => {
    setComposerMode('add');
    setEditingId(null);
    setDraft('');
    setError(null);
  };

  const beginEdit = (it: SafetyFacHistoryItem) => {
    if (editingId === it.id && composerMode === 'edit') {
      clearEditor();
      setError(null);
      return;
    }
    setComposerMode('edit');
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
    <section className="standard-detail-section flex min-h-0 min-w-0 flex-1 flex-col !border-b-0">
      <div className="standard-detail-section-header shrink-0">
        <button
          type="button"
          className="standard-detail-section-toggle"
          onClick={() => setSectionOpen((v) => !v)}
          title={sectionOpen ? '이력 접기' : '이력 펼치기'}
        >
          {sectionOpen ? (
            <ChevronDown className="standard-detail-section-chevron" />
          ) : (
            <ChevronRight className="standard-detail-section-chevron" />
          )}
          <span className="standard-detail-section-toggle-label">이력</span>
        </button>
        <span className="standard-detail-hit-count">총 {items.length}건</span>
      </div>

      {sectionOpen ? (
        <MapSideDetailScroll className="standard-detail-scroll min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="standard-search-wrap min-w-0 flex-1">
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
                className="standard-search-input h-7 py-1 pl-2 pr-7 text-[11px]"
              />
              {showSearchClear ? (
                <button
                  type="button"
                  title="검색 초기화"
                  aria-label="검색 초기화"
                  onClick={handleClearSearch}
                  className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            <LayerRowPanelButton
              onClick={handleSearch}
              title="검색"
              className="h-7 shrink-0"
              disabled={loading}
            >
              검색
            </LayerRowPanelButton>
            <LayerRowAddButton onClick={handleAdd} disabled={loading || saving} />
          </div>

          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            {error ? (
              <p className="standard-detail-error-spaced shrink-0">{error}</p>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-background">
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <table className="standard-list-table text-[11px] text-foreground">
                  <colgroup>
                    <col className="w-8" />
                    <col />
                    <col className="w-16" />
                    <col className="w-[4.5rem]" />
                    <col className="w-8" />
                  </colgroup>
                  <thead className="standard-table-thead bg-slate-100 dark:bg-muted">
                    <tr>
                      <th scope="col" className={cn(SAFETY_FAC_TABLE_TH_CLASS, 'text-center')}>
                        No
                      </th>
                      <th scope="col" className={cn(SAFETY_FAC_TABLE_TH_CLASS, 'text-left')}>
                        내용
                      </th>
                      <th scope="col" className={cn(SAFETY_FAC_TABLE_TH_CLASS, 'text-left')}>
                        작성자
                      </th>
                      <th scope="col" className={cn(SAFETY_FAC_TABLE_TH_CLASS, 'text-left')}>
                        작성일시
                      </th>
                      <th scope="col" className={cn(SAFETY_FAC_TABLE_TH_CLASS, 'text-left')}>
                        <span className="sr-only">삭제</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && items.length === 0 ? (
                      <tr>
                        <td colSpan={HISTORY_TABLE_COL_COUNT} className="standard-table-empty">
                          불러오는 중…
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={HISTORY_TABLE_COL_COUNT} className="standard-table-empty">
                          이력이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      items.map((it, index) => {
                        const selected = editingId === it.id && composerMode === 'edit';
                        return (
                          <tr
                            key={it.id}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              'standard-list-row border-b border-border last:border-b-0',
                              selected && 'standard-list-row-selected'
                            )}
                            onClick={() => beginEdit(it)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                beginEdit(it);
                              }
                            }}
                          >
                            <td className="standard-table-td-compact text-center tabular-nums text-muted-foreground">
                              {index + 1}
                            </td>
                            <td
                              className="standard-table-td-text min-w-0 truncate"
                              title={it.content}
                            >
                              {it.content}
                            </td>
                            <td className="standard-table-td-text truncate" title={it.author}>
                              {it.author}
                            </td>
                            <td
                              className="standard-table-td-date truncate text-[10px]"
                              title={it.createdAt}
                            >
                              {it.createdAt}
                            </td>
                            <td className="px-0.5 py-1 align-middle">
                              <div className="flex items-center justify-start">
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
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {composerOpen ? (
            <div className="standard-detail-section-divider-padded flex shrink-0 flex-col">
              <div className="flex h-[4.5rem] items-stretch gap-1.5">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    isEditMode ? '수정할 내용을 입력하세요' : '이력 내용을 입력하세요'
                  }
                  title="이력 내용"
                  disabled={saving}
                  className="standard-detail-input box-border h-full min-h-0 min-w-0 flex-1 resize-none rounded-2xl px-3 py-2 leading-snug disabled:opacity-60"
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
          ) : null}
        </MapSideDetailScroll>
      ) : null}
    </section>
  );
}
