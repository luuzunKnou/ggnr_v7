'use client'

import { Loader2 } from 'lucide-react'

type Props = {
  colSpan: number
  label?: string
}

/** thead는 그대로 두고 tbody에 넣는 목록 로딩 행 */
export function WtlFacilityTableLoadingRow({
  colSpan,
  label = '불러오는 중…',
}: Props) {
  const span = Math.max(1, colSpan)
  return (
    <tr>
      <td colSpan={span} className="standard-table-loading-cell">
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {label}
        </span>
      </td>
    </tr>
  )
}
