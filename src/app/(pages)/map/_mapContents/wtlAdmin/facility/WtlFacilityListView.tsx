'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import { WtlFacilityTableLoadingRow } from './WtlFacilityTableLoadingRow'

export type WtlFacilityListRow = {
  id: string
  ogcFid: number | null
  name: string
  record: Record<string, unknown>
  geom: unknown | null
  tableName: string
  fieldsTable: string
  fieldsTableFallback: string | null
  relatedParentKey: string
  layerKey: string
}

type Props = {
  rows: WtlFacilityListRow[]
  total: number
  loading: boolean
  error: string | null
  fieldsTable: string | null
  fieldsTableFallback: string | null
  selectedId: string | null
  onSelect: (row: WtlFacilityListRow | null) => void
}

function fallbackListFields(record: Record<string, unknown> | null): DefineFieldLike[] {
  if (!record) return []
  return Object.keys(record)
    .filter((k) => {
      const lower = k.toLowerCase()
      return lower !== 'geom' && lower !== 'geometry' && lower !== 'the_geom'
    })
    .slice(0, 6)
    .map((name, idx) => ({
      define_field_name: name,
      define_field_kor_name: name,
      define_field_idx: idx,
      define_field_show_list: true,
      define_field_show_detail: true,
      define_field_type: 'TEXT',
    }))
}

export function WtlFacilityListView({
  rows,
  total,
  loading,
  error,
  fieldsTable,
  fieldsTableFallback,
  selectedId,
  onSelect,
}: Props) {
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)

  useEffect(() => {
    const table = String(fieldsTable ?? '').trim()
    if (!table) {
      setBundle(null)
      return
    }
    const peeked = peekWtlDefineDisplayBundle(table, fieldsTableFallback)
    if (peeked) {
      setBundle(peeked)
      return
    }
    let cancelled = false
    void loadWtlDefineDisplayBundle(table, fieldsTableFallback).then((b) => {
      if (!cancelled) setBundle(b)
    })
    return () => {
      cancelled = true
    }
  }, [fieldsTable, fieldsTableFallback])

  const listFields = useMemo(() => {
    const all = bundle?.fields ?? []
    const selectedFields = selectDefineLayerListFields(all)
    if (selectedFields.length > 0) return selectedFields
    if (all.length > 0) {
      return all
        .filter((f) => {
          const name = String(f.define_field_name ?? '')
            .trim()
            .toLowerCase()
          return name && name !== 'geom' && name !== 'ogc_fid'
        })
        .slice(0, 6)
    }
    return fallbackListFields(rows[0]?.record ?? null)
  }, [bundle, rows])

  const codesByField = bundle?.codesByField ?? {}
  const colCount = Math.max(1, listFields.length)
  const showTable = loading || error != null || listFields.length > 0 || rows.length > 0

  return (
    <div className="standard-list-body">
      <div className="standard-list-scroll">
        {!showTable ? (
          <p className="standard-table-empty">표시할 필드가 없습니다.</p>
        ) : (
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {listFields.length > 0 ? (
                  listFields.map((f, i) => {
                    const key = String(f.define_field_name ?? '').trim()
                    return (
                      <th
                        key={key || `h-${i}`}
                        className="standard-table-th standard-table-th-left"
                        title={getDefineFieldDisplayLabel(key, f.define_field_kor_name)}
                      >
                        {getDefineFieldDisplayLabel(key, f.define_field_kor_name)}
                      </th>
                    )
                  })
                ) : (
                  <th className="standard-table-th standard-table-th-left">—</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <WtlFacilityTableLoadingRow colSpan={colCount} />
              ) : error ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty text-destructive">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty">
                    조회된 시설이 없습니다.
                  </td>
                </tr>
              ) : listFields.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty">
                    표시할 필드가 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'standard-list-row cursor-pointer',
                      selectedId === row.id && 'standard-list-row-selected'
                    )}
                    onClick={() => onSelect(row)}
                  >
                    {listFields.map((f, fi) => {
                      const key = String(f.define_field_name ?? '').trim()
                      const raw = getRowValueByField(row.record, key)
                      const value = formatDefineFieldDisplayValue(
                        raw,
                        f.define_field_type,
                        codesByField[key.toLowerCase()],
                        '—'
                      )
                      return (
                        <td
                          key={`${row.id}-${key || fi}`}
                          className="standard-table-td-compact"
                          title={value}
                        >
                          {value}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="standard-list-footer">
        {loading ? '조회 중…' : `${total}건`}
      </div>
    </div>
  )
}
