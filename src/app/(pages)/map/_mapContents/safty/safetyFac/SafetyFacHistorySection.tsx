'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll';
import {
  LayerRowAddButton,
  LayerRowPanelButton,
} from '@/app/(pages)/map/_mapComponents/layerRowEdit';
import { SafetyFacHistoryModal } from './SafetyFacHistoryModal';

export type SafetyFacHistoryItem = {
  id: string;
  author: string;
  createdAt: string;
  content: string;
};

type HistoryModalMode = 'add' | 'edit';

type Props = {
  /** 시설물 종류 — 레이어(테이블)명 → his_gubun */
  hisGubun: string;
  /** 관리번호 — 레이어 PK 값 → ftr_idn */
  ftrIdn: string;
};

const HISTORY_TABLE_COL_COUNT = 4;

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
  const [items, setItems] = useState<SafetyFacHistoryItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [modalMode, setModalMode] = useState<HistoryModalMode | null>(null);
  const [modalItem, setModalItem] = useState<SafetyFacHistoryItem | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const nextItems = list
          .map((row: Record<string, unknown>) => mapApiItem(row))
          .filter((x: SafetyFacHistoryItem | null): x is SafetyFacHistoryItem => x != null);
        setItems(nextItems);
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
    setSectionOpen(true);
    setError(null);
    setModalMode(null);
    setModalItem(null);
    void loadList('');
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
    setModalMode('add');
    setModalItem(null);
    setError(null);
  };

  const openEditModal = (it: SafetyFacHistoryItem) => {
    setModalMode('edit');
    setModalItem(it);
    setError(null);
  };

  const closeModal = () => {
    setModalMode(null);
    setModalItem(null);
  };

  const handleSaved = () => {
    void loadList(appliedQuery);
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
        <div className="standard-detail-scroll flex min-h-0 flex-1 flex-col">
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
            <LayerRowAddButton onClick={handleAdd} disabled={loading} />
          </div>

          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            {error ? (
              <p className="standard-detail-error-spaced shrink-0">{error}</p>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-background">
              <MapSideDetailScroll className="min-h-0 flex-1">
                <table className="standard-list-table text-[11px] text-foreground">
                  <colgroup>
                    <col className="w-8" />
                    <col />
                    <col className="w-16" />
                    <col className="w-[4.5rem]" />
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
                        const selected =
                          modalMode === 'edit' && modalItem?.id === it.id;
                        return (
                          <tr
                            key={it.id}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              'standard-list-row border-b border-border last:border-b-0',
                              selected && 'standard-list-row-selected'
                            )}
                            onClick={() => openEditModal(it)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openEditModal(it);
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
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </MapSideDetailScroll>
            </div>
          </div>
        </div>
      ) : null}

      {modalMode ? (
        <SafetyFacHistoryModal
          mode={modalMode}
          hisGubun={hisGubun}
          ftrIdn={ftrIdn}
          item={modalItem ?? undefined}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  );
}
