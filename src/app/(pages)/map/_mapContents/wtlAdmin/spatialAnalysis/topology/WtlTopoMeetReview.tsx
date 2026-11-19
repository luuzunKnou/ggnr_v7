'use client'

import { cn } from '@/lib/utils'
import type { WtlTopoMeetPipeLine } from './wtlTopologySample'
import {
  WTL_TOPO_PIPE_DEFAULT_COLOR,
  wtlTopoPipeKey,
  wtlTopoPipeName,
} from './wtlTopologySample'

type Props = {
  heading?: string
  countLabel?: string
  subtypeLabel?: string
  pipes: WtlTopoMeetPipeLine[]
  checkedKeys: Set<string>
  loading: boolean
  busy: boolean
  applyLabel: string
  onToggle: (key: string) => void
  /** 목록 항목에 마우스를 올리거나 포커스하면 그 관로 키, 벗어나면 null — 지도 강조용 */
  onHover?: (key: string | null) => void
  /** 관로가 없을 때 안내 문구 */
  emptyText?: string
  hoverKey?: string | null
  onSave: () => void
  onCancel: () => void
}

export function WtlTopoMeetReview({
  heading = '접합점 검토',
  countLabel,
  subtypeLabel,
  pipes,
  checkedKeys,
  loading,
  busy,
  applyLabel,
  onToggle,
  onHover,
  hoverKey,
  emptyText = '유입 관로가 없습니다.',
  onSave,
  onCancel,
}: Props) {
  const checkedCount = checkedKeys.size
  return (
    <div className="shrink-0 border-b border-border bg-orange-50/40 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
          {heading}
          {subtypeLabel ? (
            <span className="ml-1 font-normal text-muted-foreground">· {subtypeLabel}</span>
          ) : null}
          <span className="ml-1 font-normal tabular-nums text-muted-foreground">
            · {countLabel ?? `유입 ${pipes.length}개`}
          </span>
        </p>
        <button
          type="button"
          className="h-7 shrink-0 rounded-md bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-40"
          disabled={busy || loading || checkedCount === 0}
          title={`선택 관로 반전 · ${applyLabel}`}
          onClick={onSave}
        >
          저장
        </button>
        <button
          type="button"
          className="h-7 shrink-0 rounded-md border border-border bg-background px-2 text-[10px] font-medium hover:bg-muted"
          disabled={busy}
          onClick={onCancel}
        >
          닫기
        </button>
      </div>

      {loading ? (
        <p className="py-2 text-center text-[10px] text-muted-foreground">관로를 불러오는 중…</p>
      ) : pipes.length === 0 ? (
        <p className="py-2 text-center text-[10px] text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="max-h-36 space-y-0.5 overflow-auto rounded-md border border-border bg-background/80 p-1">
          {pipes.map((p) => {
            const key = wtlTopoPipeKey(p.table, p.ogcFid)
            const checked = checkedKeys.has(key)
            return (
              <li
                key={key}
                onMouseEnter={() => onHover?.(key)}
                onMouseLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(key)}
                onBlur={() => onHover?.(null)}
              >
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-primary/5',
                    // 마우스를 올린 항목도 체크(선택)한 항목과 같은 배경색
                    (checked || hoverKey === key) && 'bg-primary/5'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={checked}
                    disabled={busy}
                    onChange={() => onToggle(key)}
                  />
                  <span
                    aria-hidden="true"
                    className="h-1 w-5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color || WTL_TOPO_PIPE_DEFAULT_COLOR }}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {wtlTopoPipeName(p.table, p.ogcFid)}
                  </span>
                  {p.recommended ? (
                    <span className="shrink-0 text-[10px] font-medium text-orange-700">추천 반전</span>
                  ) : null}
                  {checked ? (
                    <span className="shrink-0 text-[10px] text-primary">반전 보기</span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        체크한 관로는 지도에 반전된 방향으로 보입니다. 저장해야 실제로 반영됩니다.
      </p>
    </div>
  )
}
