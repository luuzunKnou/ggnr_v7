'use client'

import { useMemo, type ReactNode } from 'react'
import { DetailAttrRow, DetailAttrTable, LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import { getDevelopmentChargeStatus } from './developmentChargeConfig'
import {
  formatAreaM2,
  formatChargeWon,
  getDevelopmentChargeAreaById,
} from './developmentChargeMock'

type Props = {
  areaId: string
  onClose: () => void
}

const NOOP = () => undefined

function AttrTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <DetailAttrTable>
      {rows.map(([label, value], idx) => (
        <DetailAttrRow key={label} label={label} isLast={idx === rows.length - 1}>
          {value === '' || value == null ? '—' : value}
        </DetailAttrRow>
      ))}
    </DetailAttrTable>
  )
}

export function DevelopmentChargeDetailPanel({ areaId, onClose }: Props) {
  const area = useMemo(() => getDevelopmentChargeAreaById(areaId), [areaId])

  if (!area) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="개발부담금 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="standard-detail-empty-dashed m-3">대상 지역을 찾을 수 없습니다.</div>
      </div>
    )
  }

  const st = getDevelopmentChargeStatus(area.status)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={area.name}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />
      <div className="standard-detail-scroll min-h-0 flex-1 overflow-y-auto">
        <section className="standard-detail-section">
          <div className="standard-detail-section-header">
            <span className="standard-detail-section-toggle-label px-3 py-2">기본정보</span>
          </div>
          <div className="standard-detail-section-body">
            <AttrTable
              rows={[
                ['사업명', area.name],
                ['사업유형', area.projectType],
                ['소재지', area.address],
                ['읍면동', area.emd],
                ['기준연도', `${area.year}년`],
                ['면적', formatAreaM2(area.area)],
                [
                  '상태',
                  <span
                    key="status"
                    className="standard-status-badge"
                    style={{
                      backgroundColor: `${st.color}33`,
                      color: st.color,
                      boxShadow: `inset 0 0 0 1px ${st.color}80`,
                    }}
                  >
                    {st.label}
                  </span>,
                ],
                ['부과기준일', area.baseDate || '—'],
                ['납부기한', area.dueDate || '—'],
                ['예상부담금', formatChargeWon(area.chargeWon)],
                ['납부의무자', area.obligor],
                ['비고', area.remark],
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
