'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { call } from '@/lib/api'
import { DetailAttrRow, DetailAttrTable, LayerRowEditHeader } from '../../_mapComponents/layerRowEdit'
import { getCadastralControlPointType } from './cadastralControlPointConfig'
import { formatCoord, mapApiItem, type CadastralControlPoint } from './cadastralControlPointTypes'

type Props = {
  pointId: string
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

export function CadastralControlPointDetailPanel({ pointId, onClose }: Props) {
  const [point, setPoint] = useState<CadastralControlPoint | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'cadastralControlPointService',
          action: 'get',
          params: { id: pointId },
        })
        if (cancelled) return
        if (!res?.success) {
          setError(String((res as { error?: string })?.error ?? '조회 실패'))
          setPoint(null)
          return
        }
        const data = (res.data ?? res) as { item?: Parameters<typeof mapApiItem>[0] | null }
        const mapped = data.item ? mapApiItem(data.item) : null
        setPoint(mapped)
        if (!mapped) setError('기준점을 찾을 수 없습니다.')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '조회 실패')
          setPoint(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pointId])

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지적기준점 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="standard-detail-empty-dashed m-3">불러오는 중…</div>
      </div>
    )
  }

  if (!point) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지적기준점 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="standard-detail-empty-dashed m-3">
          {error || '기준점을 찾을 수 없습니다.'}
        </div>
      </div>
    )
  }

  const t = getCadastralControlPointType(point.type)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={`${t.label} · ${point.name || point.pointNo || '지적기준점 상세'}`}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />
      <div className="standard-detail-scroll min-h-0 flex-1 overflow-y-auto py-1">
        <section className="standard-detail-section">
          <div className="standard-detail-section-header py-1">
            <span className="standard-detail-section-toggle-label">기본정보</span>
          </div>
          <div className="standard-detail-section-body px-0 pb-1.5">
            <AttrTable
              rows={[
                ['점번호', point.pointNo],
                ['기준점명', point.name],
                [
                  '종류',
                  <span
                    key="type"
                    className="standard-status-badge"
                    style={{
                      backgroundColor: `${t.color}33`,
                      color: t.color,
                      boxShadow: `inset 0 0 0 1px ${t.color}80`,
                    }}
                  >
                    {t.label}
                  </span>,
                ],
                ['주소', point.address],
                ['토지소재', point.landLoc],
                ['읍면동', point.emd],
                ['좌표계', point.crsSrc],
                ['X좌표', formatCoord(point.x)],
                ['Y좌표', formatCoord(point.y)],
                ['표지재질', point.marker],
                ['도선등급', point.grade],
                ['도선명', point.route],
                ['도호', point.doho],
                ['교차구분', point.crossK],
                ['설치구분', point.install],
                ['설치일', point.installedAt || '—'],
                ['최종조사', point.survey],
                ['조사일', point.surveyedAt || '—'],
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
