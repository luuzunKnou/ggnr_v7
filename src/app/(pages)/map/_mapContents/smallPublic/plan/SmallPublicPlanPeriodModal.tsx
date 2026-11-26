'use client'

import { useState } from 'react'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { smallPublicFieldClass } from '../smallPublicConfig'
import {
  SmallPublicModalShell,
  type SmallPublicModalOverlay,
} from '../inspection/SmallPublicInspectionModal'

type Props = SmallPublicModalOverlay & {
  defaultStartYear: number
  onClose: () => void
  onRegister: (period: { startYear: number; endYear: number }) => void
}

/**
 * 중기 정비계획 연도구간 등록 — 시작·종료 연도.
 */
export function SmallPublicPlanPeriodModal({
  defaultStartYear,
  onClose,
  onRegister,
  ...overlay
}: Props) {
  const [startYear, setStartYear] = useState(String(defaultStartYear))
  const [endYear, setEndYear] = useState(String(defaultStartYear + 4))
  const [error, setError] = useState('')

  const submit = () => {
    const start = Number(startYear)
    const end = Number(endYear)
    if (!Number.isFinite(start) || start < 2000 || start > 2100) {
      setError('시작연도를 올바르게 입력하세요.')
      return
    }
    if (!Number.isFinite(end) || end < start) {
      setError('종료연도를 올바르게 입력하세요.')
      return
    }
    onRegister({ startYear: start, endYear: end })
    onClose()
  }

  const yearInput = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="text"
        inputMode="numeric"
        className={smallPublicFieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        aria-label={label}
      />
    </label>
  )

  return (
    <SmallPublicModalShell
      {...overlay}
      size="sm"
      title="중기 연도구간 등록"
      subtitle="시작연도와 종료연도를 넣고 등록하세요."
      showHeaderClose
      onClose={onClose}
      footer={
        <div className="ml-auto flex items-center gap-1.5">
          <LayerRowPanelButton onClick={onClose}>취소</LayerRowPanelButton>
          <LayerRowPanelButton onClick={submit}>등록</LayerRowPanelButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {yearInput(startYear, setStartYear, '시작연도')}
        {yearInput(endYear, setEndYear, '종료연도')}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    </SmallPublicModalShell>
  )
}
