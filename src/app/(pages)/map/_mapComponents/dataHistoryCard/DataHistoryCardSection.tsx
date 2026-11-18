'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MapSideDetailScroll } from '../MapSideDetailScroll'
import {
  LayerRowAddButton,
  LayerRowPanelButton,
} from '../layerRowEdit'
import { DataHistoryCardModal } from './DataHistoryCardModal'
import type {
  DataHistoryCardItem,
  DataHistoryCardModalMode,
} from './dataHistoryCardTypes'

export type { DataHistoryCardItem } from './dataHistoryCardTypes'

type Props = {
  /** 시설물 종류 — 레이어(테이블)명 → his_gubun */
  hisGubun: string
  /** 관리번호 — 레이어 PK 값 → ftr_idn */
  ftrIdn: string
  /** 업체(agency) 컬럼 화면 공개 */
  showAgency?: boolean
  /**
   * section: 접기 헤더(재난시설 등)
   * panel: 상세 하단 탭 본문(설비관리 이력 카드)
   */
  variant?: 'section' | 'panel'
  /** section 헤더 라벨. 기본 «이력» */
  sectionTitle?: string
}

const TABLE_TH_CLASS =
  'border-b border-border bg-slate-100 px-1.5 py-1.5 align-middle text-[11px] font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground'

function mapApiItem(raw: Record<string, unknown>): DataHistoryCardItem | null {
  const id = raw.id ?? raw.historyKey
  if (id == null || String(id).trim() === '') return null
  const extraRaw = raw.extra ?? raw.hisExtra
  const extra =
    extraRaw && typeof extraRaw === 'object' && !Array.isArray(extraRaw)
      ? (extraRaw as Record<string, unknown>)
      : null
  return {
    id: String(id),
    author: String(raw.author ?? raw.createdBy ?? '').trim() || '—',
    createdAt: String(raw.createdAt ?? '').trim(),
    content: String(raw.content ?? raw.hisContents ?? '').trim(),
    agency: String(raw.agency ?? '').trim(),
    extra,
  }
}

export function DataHistoryCardSection({
  hisGubun,
  ftrIdn,
  showAgency = false,
  variant = 'section',
  sectionTitle = '이력',
}: Props) {
  const [items, setItems] = useState<DataHistoryCardItem[]>([])
  const [searchText, setSearchText] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [modalMode, setModalMode] = useState<DataHistoryCardModalMode | null>(null)
  const [modalItem, setModalItem] = useState<DataHistoryCardItem | null>(null)
  const [sectionOpen, setSectionOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const colCount = showAgency ? 5 : 4
  const isPanel = variant === 'panel'
  const tableClass = isPanel
    ? 'standard-detail-tab-table'
    : 'standard-list-table text-[11px] text-foreground'
  const thClass = isPanel
    ? 'standard-detail-table-th standard-table-th-left'
    : TABLE_TH_CLASS
  const theadClass = isPanel
    ? 'standard-detail-table-thead'
    : 'standard-table-thead bg-slate-100 dark:bg-muted'

  const loadList = useCallback(
    async (search: string) => {
      const gubun = hisGubun.trim()
      const idn = ftrIdn.trim()
      if (!gubun || !idn) {
        setItems([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await call('', 'POST', {
          service: 'safedataHistoryService',
          action: 'listByFacility',
          params: {
            hisGubun: gubun,
            ftrIdn: idn,
            search: search.trim() || undefined,
          },
        })
        const data = res?.data ?? res
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? '이력을 불러오지 못했습니다.'))
          setItems([])
          return
        }
        const list = Array.isArray(data?.data) ? data.data : []
        const nextItems = list
          .map((row: Record<string, unknown>) => mapApiItem(row))
          .filter((x: DataHistoryCardItem | null): x is DataHistoryCardItem => x != null)
        setItems(nextItems)
      } catch {
        setError('이력을 불러오지 못했습니다.')
        setItems([])
      } finally {
        setLoading(false)
      }
    },
    [hisGubun, ftrIdn]
  )

  useEffect(() => {
    setSearchText('')
    setAppliedQuery('')
    setSectionOpen(true)
    setError(null)
    setModalMode(null)
    setModalItem(null)
    void loadList('')
  }, [hisGubun, ftrIdn, loadList])

  const handleSearch = () => {
    const q = searchText.trim()
    setAppliedQuery(q)
    void loadList(q)
  }

  const handleClearSearch = () => {
    setSearchText('')
    setAppliedQuery('')
    void loadList('')
  }

  const showSearchClear = Boolean(searchText.trim() || appliedQuery)

  const handleAdd = () => {
    setModalMode('add')
    setModalItem(null)
    setError(null)
  }

  const openEditModal = (it: DataHistoryCardItem) => {
    setModalMode('edit')
    setModalItem(it)
    setError(null)
  }

  const closeModal = () => {
    setModalMode(null)
    setModalItem(null)
  }

  const handleSaved = () => {
    void loadList(appliedQuery)
  }

  const searchBar = (
    <div className={cn('flex shrink-0 items-center gap-1.5', isPanel ? 'mb-2 px-0' : '')}>
      <div className="standard-search-wrap min-w-0 flex-1">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSearch()
            }
          }}
          placeholder={showAgency ? '작성자·업체·내용 검색' : '작성자·내용 검색'}
          title={showAgency ? '작성자·업체·내용 검색' : '작성자·내용 검색'}
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
  )

  const tableBody = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        !isPanel && 'rounded border border-border bg-background'
      )}
    >
      <MapSideDetailScroll className={cn('min-h-0 flex-1', isPanel && 'standard-list-scroll')}>
        <table className={tableClass}>
          <colgroup>
            <col className="w-8" />
            <col />
            {showAgency ? <col className="w-20" /> : null}
            <col className="w-16" />
            <col className="w-[5.75rem]" />
          </colgroup>
          <thead className={theadClass}>
            <tr>
              <th
                scope="col"
                className={cn(thClass, !isPanel && 'text-center')}
                title="No"
              >
                No
              </th>
              <th scope="col" className={cn(thClass, 'text-left')} title="내용">
                내용
              </th>
              {showAgency ? (
                <th scope="col" className={cn(thClass, 'text-left')} title="업체">
                  업체
                </th>
              ) : null}
              <th scope="col" className={cn(thClass, 'text-left')} title="작성자">
                작성자
              </th>
              <th scope="col" className={cn(thClass, 'text-left')} title="작성일시">
                작성일시
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="standard-table-empty">
                  불러오는 중…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="standard-table-empty">
                  이력이 없습니다.
                </td>
              </tr>
            ) : (
              items.map((it, index) => {
                const selected = modalMode === 'edit' && modalItem?.id === it.id
                return (
                  <tr
                    key={it.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'standard-list-row cursor-pointer border-b border-border last:border-b-0',
                      selected && 'standard-list-row-selected'
                    )}
                    onClick={() => openEditModal(it)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openEditModal(it)
                      }
                    }}
                  >
                    <td
                      className={cn(
                        isPanel ? 'standard-detail-tab-td' : 'standard-table-td-compact',
                        'text-center tabular-nums text-muted-foreground'
                      )}
                    >
                      {index + 1}
                    </td>
                    <td
                      className={cn(
                        isPanel ? 'standard-detail-tab-td' : 'standard-table-td-text',
                        'min-w-0 truncate'
                      )}
                      title={it.content}
                    >
                      {it.content}
                    </td>
                    {showAgency ? (
                      <td
                        className={cn(
                          isPanel ? 'standard-detail-tab-td' : 'standard-table-td-text',
                          'truncate'
                        )}
                        title={it.agency || undefined}
                      >
                        {it.agency || '—'}
                      </td>
                    ) : null}
                    <td
                      className={cn(
                        isPanel ? 'standard-detail-tab-td' : 'standard-table-td-text',
                        'truncate'
                      )}
                      title={it.author}
                    >
                      {it.author}
                    </td>
                    <td
                      className={cn(
                        isPanel
                          ? 'standard-detail-tab-td'
                          : 'standard-table-td-date max-w-none overflow-visible text-[10px]',
                        'whitespace-nowrap'
                      )}
                      title={it.createdAt}
                    >
                      {it.createdAt}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </MapSideDetailScroll>
      {isPanel ? (
        <div className="standard-list-footer">
          {loading ? '조회 중…' : `총 ${items.length}건`}
        </div>
      ) : null}
    </div>
  )

  const modal = modalMode ? (
    <DataHistoryCardModal
      mode={modalMode}
      hisGubun={hisGubun}
      ftrIdn={ftrIdn}
      item={modalItem ?? undefined}
      showAgency={showAgency}
      onClose={closeModal}
      onSaved={handleSaved}
    />
  ) : null

  if (isPanel) {
    if (!hisGubun.trim() || !ftrIdn.trim()) {
      return (
        <p className="standard-table-empty px-3 py-3">
          관리번호를 찾을 수 없어 이력을 표시하지 않습니다.
        </p>
      )
    }
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 pt-2">
        {searchBar}
        {error ? <p className="standard-detail-error-spaced shrink-0">{error}</p> : null}
        {tableBody}
        {modal}
      </div>
    )
  }

  return (
    <section className="standard-detail-section flex min-h-0 min-w-0 flex-1 flex-col !border-b-0">
      <div className="standard-detail-section-header shrink-0">
        <button
          type="button"
          className="standard-detail-section-toggle"
          onClick={() => setSectionOpen((v) => !v)}
          title={sectionOpen ? `${sectionTitle} 접기` : `${sectionTitle} 펼치기`}
        >
          {sectionOpen ? (
            <ChevronDown className="standard-detail-section-chevron" />
          ) : (
            <ChevronRight className="standard-detail-section-chevron" />
          )}
          <span className="standard-detail-section-toggle-label">{sectionTitle}</span>
        </button>
        <span className="standard-detail-hit-count">총 {items.length}건</span>
      </div>

      {sectionOpen ? (
        <div className="standard-detail-scroll flex min-h-0 flex-1 flex-col">
          {searchBar}
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            {error ? <p className="standard-detail-error-spaced shrink-0">{error}</p> : null}
            {tableBody}
          </div>
        </div>
      ) : null}

      {modal}
    </section>
  )
}
