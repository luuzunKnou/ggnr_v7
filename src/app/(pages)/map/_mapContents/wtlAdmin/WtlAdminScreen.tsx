'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toneOf, type WtlNav, type WtlScreen } from './wtlAdminMenu'

const btnSecondary =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground/90 hover:bg-muted/50'
const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90'

function statusClass(text: string): string {
  const tone = toneOf(text)
  if (tone === 'bad') return 'standard-status-badge standard-status-badge-ended'
  if (tone === 'ok' || tone === 'warn' || tone === 'info') return 'standard-status-badge standard-status-badge-primary'
  return ''
}

function Cell({ text }: { text: string }) {
  const cls = statusClass(text)
  if (!cls) return <span>{text}</span>
  return <span className={cls}>{text}</span>
}

type ListProps = {
  title: string
  menus: WtlNav[]
  menuId: string
  onMenu: (id: string) => void
  screen: WtlScreen
  tab: string | null
  onTab: (id: string) => void
  selectedIndex: number | null
  onSelect: (index: number) => void
  onAdd: () => void
  onClose: () => void
}

export function WtlAdminListPanel({
  title,
  menus,
  menuId,
  onMenu,
  screen,
  tab,
  onTab,
  selectedIndex,
  onSelect,
  onAdd,
  onClose,
}: ListProps) {
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => {
    const q = keyword.trim()
    return screen.rows
      .map((cells, index) => ({ cells, index }))
      .filter(({ cells }) => !q || cells.some((c) => c.includes(q)))
  }, [keyword, screen.rows])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">{title}</span>
        <div className="flex items-center gap-1">
          <button type="button" className={btnSecondary} onClick={onAdd}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            등록
          </button>
          <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section">
        <select
          className="w-full cursor-pointer rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none"
          value={menuId}
          onChange={(e) => onMenu(e.target.value)}
        >
          {menus.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.label}
            </option>
          ))}
        </select>
        {screen.tabs && screen.tabs.length > 0 && (
          <div className="standard-filter-chips">
            {screen.tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn('standard-filter-chip', (tab ?? screen.tabs?.[0]?.id) === item.id && 'standard-filter-chip-active')}
                onClick={() => onTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {screen.filters && screen.filters.length > 0 && (
          <div className="standard-filter-chips">
            {screen.filters.map((name) => (
              <span key={name} className="standard-filter-chip">
                {name}
              </span>
            ))}
          </div>
        )}
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색"
            className="standard-search-input"
          />
        </div>
        {screen.kind === 'map' && (
          <p className="standard-detail-hint">현재 지도 화면에 들어온 항목만 보여 주는 예시입니다.</p>
        )}
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table min-w-[520px]">
            <thead className="standard-table-thead">
              <tr>
                {screen.columns.map((col) => (
                  <th key={col} className="standard-table-th standard-table-th-left">
                    <span className="truncate">{col}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="standard-table-empty" colSpan={screen.columns.length}>
                    조회된 항목이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map(({ cells, index }) => (
                  <tr
                    key={`${index}-${cells[0]}`}
                    className={cn('standard-list-row', selectedIndex === index && 'standard-list-row-selected')}
                    onClick={() => onSelect(index)}
                  >
                    {cells.map((cell, i) => (
                      <td key={`${colKey(i)}`} className="standard-table-td-text">
                        <Cell text={cell} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">{rows.length.toLocaleString()}건</div>
      </div>
    </div>
  )
}

function colKey(i: number) {
  return String(i)
}

type DetailProps = {
  title: string
  screen: WtlScreen
  tab: string | null
  row: string[] | null
  editing: boolean
  notice: string | null
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onClose: () => void
}

export function WtlAdminDetailPanel({
  title,
  screen,
  tab,
  row,
  editing,
  notice,
  onEdit,
  onCancel,
  onSave,
  onClose,
}: DetailProps) {
  const tabDef = screen.tabs?.find((item) => item.id === tab) ?? screen.tabs?.[0]
  const fields = tabDef?.fields ?? screen.fields ?? screen.columns

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title truncate">{title} 상세</span>
        <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="standard-detail-scroll">
        <p className="standard-detail-hint mb-2">{screen.blurb}</p>
        {notice && <p className="standard-detail-hint mb-2">{notice}</p>}
        {screen.kpis && screen.kpis.length > 0 && (
          <div className="standard-detail-attr-table mb-2">
            {screen.kpis.map((item) => (
              <div key={item.label} className="contents">
                <div className="standard-detail-attr-label standard-detail-attr-cell-border">{item.label}</div>
                <div className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground">
                  {item.value}
                  <span className="ml-1 text-muted-foreground">{item.hint}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {screen.steps && screen.steps.length > 0 && (
          <ol className="mb-2 divide-y divide-border overflow-hidden rounded border border-border">
            {screen.steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] bg-background px-2.5 py-1.5">
                <span className="text-[11px] text-muted-foreground">{index + 1}</span>
                <span className="text-[11px] text-foreground">
                  {step.title}
                  <span className="ml-1 text-muted-foreground">{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="standard-detail-attr-table">
          {fields.map((label, index) => (
            <div key={label} className="contents">
              <div className="standard-detail-attr-label standard-detail-attr-cell-border">{label}</div>
              <div className="standard-detail-attr-value standard-detail-attr-cell-border">
                {editing ? (
                  <input className="standard-detail-input w-full" defaultValue={row?.[index] ?? ''} />
                ) : (
                  <span className="text-foreground">
                    {row?.[index] ? <Cell text={row[index]} /> : '—'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="standard-detail-edit-footer">
        {editing ? (
          <>
            <button type="button" className={btnSecondary} onClick={onCancel}>
              취소
            </button>
            <button type="button" className={btnPrimary} onClick={onSave}>
              저장
            </button>
          </>
        ) : (
          <button type="button" className={btnSecondary} onClick={onEdit}>
            수정
          </button>
        )}
      </div>
    </div>
  )
}
