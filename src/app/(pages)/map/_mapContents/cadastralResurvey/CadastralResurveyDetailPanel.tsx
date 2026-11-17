'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DetailAttrRow,
  DetailAttrTable,
  LayerRowEditHeader,
} from '../../_mapComponents/layerRowEdit'
import {
  fetchResurveyParcels,
  getResurveyDistrictById,
  type ResurveyParcel,
} from './cadastralResurveyMock'
import { useCadastralResurveyParcelLayer } from './useCadastralResurveyParcelLayer'
import { exportResurveyParcelExcel, type ResurveyExcelProgress } from './exportResurveyParcelExcel'

type Props = {
  districtId: string
  onClose: () => void
}

const NOOP = () => undefined

function parcelAddress(p: ResurveyParcel): string {
  return `${p.ri} ${p.jibun}`
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="standard-detail-section">
      <div className="standard-detail-section-header">
        <button
          type="button"
          className="standard-detail-section-toggle"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? `${title} 접기` : `${title} 펼치기`}
        >
          {open ? (
            <ChevronDown className="standard-detail-section-chevron" />
          ) : (
            <ChevronRight className="standard-detail-section-chevron" />
          )}
          <span className="standard-detail-section-toggle-label">{title}</span>
        </button>
      </div>
      {open ? <div className="standard-detail-section-body">{children}</div> : null}
    </section>
  )
}

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

export function CadastralResurveyDetailPanel({ districtId, onClose }: Props) {
  const district = useMemo(() => getResurveyDistrictById(districtId), [districtId])
  const [loaded, setLoaded] = useState<{ id: string; parcels: ResurveyParcel[] } | null>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(['basic']))
  const [keyword, setKeyword] = useState('')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const [exporting, setExporting] = useState<ResurveyExcelProgress | null>(null)
  const exportAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => exportAbortRef.current?.abort()
  }, [districtId])

  useEffect(() => {
    if (!district) return
    let cancelled = false
    fetchResurveyParcels(district)
      .then((ps) => {
        if (cancelled) return
        setLoaded({ id: district.id, parcels: ps })
        setFocusedId(null)
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: district.id, parcels: [] })
      })
    return () => {
      cancelled = true
    }
  }, [district])

  const parcels = useMemo(
    () => (district && loaded?.id === district.id ? loaded.parcels : []),
    [district, loaded]
  )
  const loading = Boolean(district) && loaded?.id !== district?.id

  const visibleParcels = useMemo(() => {
    const kw = keyword.trim()
    if (!kw) return parcels
    return parcels.filter((p) => `${parcelAddress(p)} ${p.jimok} ${p.ownerType}`.includes(kw))
  }, [parcels, keyword])

  const handleMapSelect = useCallback((id: string) => {
    setKeyword('')
    setFocusedId(id)
    requestAnimationFrame(() => {
      rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const { fitToParcel } = useCadastralResurveyParcelLayer({
    parcels,
    focusedId,
    onSelect: handleMapSelect,
  })

  const handleRowClick = (p: ResurveyParcel) => {
    setFocusedId(p.id)
    fitToParcel(p)
  }

  const handleExport = async () => {
    if (!district || exportAbortRef.current) return
    const ctrl = new AbortController()
    exportAbortRef.current = ctrl
    setExporting({ done: 0, total: visibleParcels.length })
    try {
      await exportResurveyParcelExcel({
        district,
        parcels: visibleParcels,
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!ctrl.signal.aborted) setExporting(p)
        },
      })
    } catch {
      if (!ctrl.signal.aborted) window.alert('엑셀 파일을 만들지 못했습니다.')
    } finally {
      if (exportAbortRef.current === ctrl) exportAbortRef.current = null
      setExporting(null)
    }
  }

  const handleCancelExport = () => {
    exportAbortRef.current?.abort()
  }

  const toggleSection = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!district) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <LayerRowEditHeader
          title="지적재조사 지구 상세"
          isEditing={false}
          saving={false}
          onEdit={NOOP}
          onSave={NOOP}
          onCancel={onClose}
          onClose={onClose}
          editable={false}
        />
        <div className="standard-detail-empty-dashed m-3">지구를 찾을 수 없습니다.</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <LayerRowEditHeader
        title={`${district.name} 상세`}
        isEditing={false}
        saving={false}
        onEdit={NOOP}
        onSave={NOOP}
        onCancel={onClose}
        onClose={onClose}
        editable={false}
      />

      <div className="shrink-0 text-xs">
        <Section title="지구 정보" open={openIds.has('basic')} onToggle={() => toggleSection('basic')}>
          <AttrTable
            rows={[
              ['사업지구명', district.name],
              ['지적소관청 전화번호', district.tel],
              ['사업위치', district.loc.split(' ').slice(2).join(' ')],
              ['면적', `${district.area.toLocaleString()}㎡`],
              ['기준년도', `${district.year}년`],
              ['진행단계', district.stageName],
              ['사업기간', district.periodStart ? `${district.periodStart} ~ ${district.periodEnd}` : ''],
              ['대행자', district.agent],
              ['소유자 동의율(%)', district.ownAgreeRto == null ? '' : String(district.ownAgreeRto)],
              ['지정상태', district.designateStatus],
            ]}
          />
        </Section>
      </div>

      <section className="flex min-h-0 flex-1 flex-col border-t border-border text-xs">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 pt-3">
          <span className="text-xs font-semibold text-foreground/90">
            필지목록
            <span className="ml-1 font-normal text-muted-foreground">
              ({parcels.length.toLocaleString()})
            </span>
          </span>
          {exporting ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="tabular-nums">
                필지정보 조회 {exporting.done.toLocaleString()} / {exporting.total.toLocaleString()}
              </span>
              <button
                type="button"
                className="standard-detail-action-btn inline-flex items-center gap-1"
                onClick={handleCancelExport}
                title="내려받기 취소"
              >
                <X className="h-3 w-3" />
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="standard-detail-action-btn inline-flex items-center gap-1"
              onClick={() => void handleExport()}
              disabled={visibleParcels.length === 0}
              title="현재 목록과 필지별 토지기본정보·소유내역·이용계획 내려받기"
            >
              <Download className="h-3 w-3" />
              엑셀
            </button>
          )}
        </div>
        <div className="shrink-0 px-3 pb-2">
          <div className="standard-search-wrap">
            <Search className="standard-search-icon" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색 (지번, 지목, 소유구분)"
              className="standard-search-input"
            />
          </div>
        </div>
        <div className="standard-list-scroll mx-3 mb-3 rounded border border-border">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th standard-table-th-center w-[11%]">번호</th>
                <th className="standard-table-th standard-table-th-left w-[29%]">지번</th>
                <th className="standard-table-th standard-table-th-center w-[11%]">지목</th>
                <th className="standard-table-th standard-table-th-center w-[17%]">면적(㎡)</th>
                <th className="standard-table-th standard-table-th-center w-[16%]">소유구분</th>
                <th className="standard-table-th standard-table-th-center w-[16%]">확정여부</th>
              </tr>
            </thead>
            <tbody>
              {visibleParcels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="standard-table-empty">
                    {loading ? '필지를 불러오는 중입니다.' : '해당 필지가 없습니다.'}
                  </td>
                </tr>
              ) : (
                visibleParcels.map((p) => {
                  const isFocused = focusedId === p.id
                  return (
                    <tr
                      key={p.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(p.id, el)
                        else rowRefs.current.delete(p.id)
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowClick(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowClick(p)
                        }
                      }}
                      className={cn('standard-list-row', isFocused && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-date text-center">{p.seq}</td>
                      <td className="standard-table-td-text tabular-nums" title={parcelAddress(p)}>
                        {parcelAddress(p)}
                      </td>
                      <td className="standard-table-td-text-muted text-center">{p.jimok}</td>
                      <td className="standard-table-td-date text-right">{p.area.toLocaleString()}</td>
                      <td className="standard-table-td-text-muted text-center">{p.ownerType}</td>
                      <td className="standard-table-td-compact text-center">
                        <span
                          className={cn(
                            'text-[11px]',
                            p.confirmed ? 'text-emerald-600' : 'text-muted-foreground'
                          )}
                        >
                          {p.confirmed ? '확정' : '미확정'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
