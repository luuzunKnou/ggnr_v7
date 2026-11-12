'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SMALL_PUBLIC_FAC_TYPES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import type { SmallPublicFacility } from '../smallPublicMock'
import { SmallPublicClassBadge } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'

/**
 * 보고서 «시설 추가» — 보고서 대상에 없는 시설(위험시설 재점검 등, 제외 빼고) 중 한 곳을 고른다.
 * 고르면 보고서에 넣고 그 시설 점검 모달을 연다(호출측).
 */
export function SmallPublicInspectionTargetPickerModal({
  facilities,
  onCancel,
  onPicked,
  ...overlay
}: SmallPublicModalOverlay & {
  /** 고를 수 있는 시설(보고서 대상 밖, 제외 빼고) */
  facilities: SmallPublicFacility[]
  onCancel: () => void
  onPicked: (facility: SmallPublicFacility) => void
}) {
  const [type, setType] = useState<SmallPublicFacType | ''>('')
  const [keyword, setKeyword] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return facilities
      .filter((f) => !type || f.type === type)
      .filter((f) => !q || [f.name, f.mngNo, f.ri, f.emd].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.emd.localeCompare(b.emd, 'ko') || a.name.localeCompare(b.name, 'ko'))
  }, [facilities, type, keyword])

  const picked = rows.find((f) => f.id === pickedId) ?? null

  const choose = (f: SmallPublicFacility | null) => {
    if (f) onPicked(f)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="sm"
      title="시설 추가"
      subtitle="보고서 대상에 없는 시설(위험시설 재점검 등)을 고르세요."
      onClose={onCancel}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <>
          <button type="button" className={smallPublicBtnPrimary} disabled={!picked} onClick={() => choose(picked)}>
            선택
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[11px]"
          value={type}
          onChange={(e) => {
            setType(e.target.value as SmallPublicFacType | '')
            setPickedId(null)
          }}
          aria-label="시설 유형"
        >
          <option value="">전체 유형</option>
          {SMALL_PUBLIC_FAC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명·읍면·리명"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <ul className="max-h-[300px] min-h-[120px] overflow-auto py-1 scrollbar-thin" role="listbox" aria-label="후보지">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {keyword.trim() ? '검색 결과가 없습니다.' : '추가할 수 있는 시설이 없습니다.'}
          </li>
        ) : (
          rows.map((f) => {
            const on = f.id === pickedId
            return (
              <li key={f.id} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => setPickedId(f.id)}
                  onDoubleClick={() => choose(f)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                    on ? 'bg-primary/15 shadow-[inset_3px_0_0_0_var(--primary)]' : 'hover:bg-muted/50'
                  )}
                >
                  <span className={cn('min-w-0 flex-1 truncate', on ? 'text-primary' : 'text-foreground')}>
                    {f.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {[f.emd, f.ri].filter(Boolean).join(' ')}
                  </span>
                  <SmallPublicClassBadge candidate={f.candidate} />
                </button>
              </li>
            )
          })
        )}
      </ul>
    </SmallPublicModalShell>
  )
}
