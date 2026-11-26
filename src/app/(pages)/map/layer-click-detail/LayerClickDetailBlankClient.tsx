'use client'

import { Fragment, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  formatBooleanYeobu,
  shouldUseBooleanCheckbox,
} from '@/lib/defineBooleanField'
import {
  formatDefineFieldDisplayValue,
  parseDefineBooleanValue,
} from '@/lib/defineLayerCodeDisplay'
import { withBasePath } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import {
  extractDefineRowKeyValue,
  findDefineKeyFieldName,
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  type DefineFieldLike,
} from '../_mapComponents/standard/defineLayerRowUtils'
import { useDefineLayerCodes } from '../_mapComponents/standard/useDefineLayerCodes'
import { LayerClickDetailBlankMapTab } from '../_mapContents/layerClickDetail/LayerClickDetailBlankMapTab'
import { LayerClickDetailRelatedTabs } from '../_mapContents/layerClickDetail/LayerClickDetailRelatedTabs'
import {
  readLayerClickDetailBlankPayload,
  type LayerClickDetailBlankPayload,
} from '../_mapContents/layerClickDetail/openLayerClickDetailBlank'
import type { LayerClickHit } from '../_mapContents/layerClickDetail/useLayerClickDetail'

function parseFieldMaxLength(raw: unknown): number {
  const n = parseInt(String(raw ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

type AttrRow = {
  key: string
  label: string
  value: string
  useBoolCheck: boolean
  boolChecked: boolean
  maxLength: number
  title: boolean
}

function BlankBody() {
  const searchParams = useSearchParams()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sid = String(searchParams.get('sid') ?? '').trim()
  const [payload, setPayload] = useState<LayerClickDetailBlankPayload | null>(
    () => (sid ? readLayerClickDetailBlankPayload(sid) : null)
  )
  const [loadError, setLoadError] = useState<string | null>(() => {
    if (!sid) return '상세 정보가 없습니다.'
    if (typeof window === 'undefined') return null
    return readLayerClickDetailBlankPayload(sid)
      ? null
      : '상세 정보가 만료되었거나 없습니다. 지도에서 다시 열어 주세요.'
  })
  const [fields, setFields] = useState<DefineFieldLike[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)

  useEffect(() => {
    if (!sid) {
      setLoadError('상세 정보가 없습니다.')
      setPayload(null)
      return
    }
    const next = readLayerClickDetailBlankPayload(sid)
    if (!next) {
      setLoadError('상세 정보가 만료되었거나 없습니다. 지도에서 다시 열어 주세요.')
      setPayload(null)
      return
    }
    setPayload(next)
    setLoadError(null)
  }, [sid])

  const hit: LayerClickHit | null = payload?.hit ?? null
  const fieldsTableKey = hit
    ? String(hit.fieldsTable ?? hit.tableName ?? '').trim()
    : ''

  useEffect(() => {
    if (!fieldsTableKey) {
      setFields([])
      setFieldsLoading(false)
      return
    }
    let cancelled = false
    setFieldsLoading(true)
    void fetch(
      withBasePath(
        `/api/config/defineLayer/fields/${encodeURIComponent(fieldsTableKey)}`
      )
    )
      .then((r) => r.json())
      .then((body: { data?: DefineFieldLike[] }) => {
        if (cancelled) return
        setFields(Array.isArray(body?.data) ? body.data : [])
      })
      .catch(() => {
        if (!cancelled) setFields([])
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fieldsTableKey])

  const keyField = useMemo(() => {
    const fromDefine = findDefineKeyFieldName(fields)
    if (fromDefine) return fromDefine.trim().toLowerCase()
    const fromPayload = String(payload?.keyField ?? '').trim().toLowerCase()
    return fromPayload || null
  }, [payload?.keyField, fields])

  const keyValue = useMemo(() => {
    if (!hit) return null
    const fromData = extractDefineRowKeyValue(hit.data, keyField)
    if (fromData) return fromData
    const fromPayload = String(payload?.keyValue ?? '').trim()
    return fromPayload || null
  }, [hit, payload?.keyValue, keyField])

  const extent3857 = payload?.extent3857 ?? null

  const detailFields = useMemo(
    () => selectDefineLayerDetailFields(fields),
    [fields]
  )
  const displayFields =
    detailFields.length > 0
      ? detailFields
      : fields.filter((f) => {
          const name = String(f.define_field_name ?? '')
            .trim()
            .toLowerCase()
          return name && !isGeomLikeDefineFieldName(name) && name !== 'gid'
        })

  const tableName = hit ? String(hit.tableName ?? '').trim() : ''
  const codeFallback =
    tableName &&
    fieldsTableKey &&
    tableName.toLowerCase() !== fieldsTableKey.toLowerCase()
      ? tableName
      : null
  const codesByField = useDefineLayerCodes(
    fieldsTableKey || null,
    fields as Array<{ define_field_name?: string; define_field_type?: unknown }>,
    { fallbackTableName: codeFallback }
  )

  const titleLine = useMemo(() => {
    if (!hit) return '상세'
    const titleField = fields.find((f) =>
      isDefineFieldFlagTrue(f.define_field_show_title)
    )
    if (titleField) {
      const key = String(titleField.define_field_name ?? '').trim()
      if (key) {
        const raw = getRowValueByField(hit.data, key)
        const formatted = formatDefineFieldDisplayValue(
          raw,
          titleField.define_field_type,
          codesByField[key.toLowerCase()],
          ''
        )
        if (formatted.trim()) return formatted.trim()
      }
    }
    return hit.titleValue || hit.korName || '상세'
  }, [hit, fields, codesByField])

  const attrRows = useMemo((): AttrRow[] => {
    if (!hit) return []
    if (displayFields.length > 0) {
      return displayFields.map((f, i) => {
        const key = String(f.define_field_name ?? '').trim() || `f-${i}`
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(hit.data, key)
        const useBoolCheck = shouldUseBooleanCheckbox(f.define_field_type)
        const value = useBoolCheck
          ? formatBooleanYeobu(raw, '—')
          : formatDefineFieldDisplayValue(
              raw,
              f.define_field_type,
              codesByField[key.toLowerCase()],
              '—'
            )
        return {
          key,
          label,
          value,
          useBoolCheck,
          boolChecked: useBoolCheck ? parseDefineBooleanValue(raw) : false,
          maxLength: parseFieldMaxLength(f.define_field_max_length),
          title: isDefineFieldFlagTrue(f.define_field_show_title),
        }
      })
    }
    if (fieldsLoading) return []
    return Object.entries(hit.data)
      .filter(([k]) => !isGeomLikeDefineFieldName(k) && k.toLowerCase() !== 'gid')
      .map(([k, v], i) => ({
        key: k || `auto-${i}`,
        label: getDefineFieldDisplayLabel(k),
        value: formatDefineFieldDisplayValue(v, undefined, undefined, '—'),
        useBoolCheck: false,
        boolChecked: false,
        maxLength: 0,
        title: false,
      }))
  }, [hit, displayFields, codesByField, fieldsLoading])

  /** 기본 모달과 동일 — maxLength≥100 이면 1칸(th+td), 그 외 2칸 묶음 */
  const packedAttrRows = useMemo(() => {
    type Pack = { cells: AttrRow[]; fullWidth: boolean }
    const out: Pack[] = []
    let pending: AttrRow[] = []
    for (const row of attrRows) {
      if (row.maxLength >= 100) {
        if (pending.length > 0) {
          out.push({ cells: pending, fullWidth: false })
          pending = []
        }
        out.push({ cells: [row], fullWidth: true })
        continue
      }
      pending.push(row)
      if (pending.length === 2) {
        out.push({ cells: pending, fullWidth: false })
        pending = []
      }
    }
    if (pending.length > 0) out.push({ cells: pending, fullWidth: false })
    return out
  }, [attrRows])

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        {loadError}
      </div>
    )
  }

  if (!hit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        불러오는 중…
      </div>
    )
  }

  const layerLine = String(hit.korName ?? '').trim()

  return (
    <div
      ref={rootRef}
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
        {layerLine && layerLine !== titleLine ? (
          <span className="text-xs text-muted-foreground" title={layerLine}>
            {layerLine}
          </span>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={titleLine}>
          {titleLine}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs scrollbar-thin">
        {fieldsLoading ? (
          <p className="text-muted-foreground">속성 불러오는 중…</p>
        ) : attrRows.length === 0 ? (
          <p className="standard-detail-attr-empty">표시할 속성이 없습니다.</p>
        ) : (
          <table className="standard-detail-attr-table w-full">
            <tbody>
              {packedAttrRows.map((pack, packIdx) => (
                <tr key={`pack-${packIdx}`}>
                  {pack.cells.map((row) => {
                    const tdColSpan =
                      pack.fullWidth || pack.cells.length === 1 ? 3 : 1
                    return (
                      <Fragment key={row.key}>
                        <th
                          scope="row"
                          className="standard-detail-attr-label standard-detail-attr-cell-border"
                          title={row.label}
                        >
                          {row.label}
                        </th>
                        <td
                          colSpan={tdColSpan}
                          className={cn(
                            'standard-detail-attr-value standard-detail-attr-cell-border',
                            row.title
                              ? 'standard-detail-attr-value-title'
                              : 'text-foreground'
                          )}
                          title={row.value}
                        >
                          {row.useBoolCheck ? (
                            <input
                              type="checkbox"
                              className="pointer-events-none h-3.5 w-3.5 accent-primary"
                              title={row.value}
                              aria-label={row.label}
                              aria-readonly="true"
                              checked={row.boolChecked}
                              readOnly
                              tabIndex={-1}
                              onChange={() => {}}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 break-all">
                              {row.value}
                            </span>
                          )}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={cn('shrink-0 border-t border-border')}>
        <LayerClickDetailRelatedTabs
          hit={hit}
          fields={fields}
          bodyHeightPx={300}
          relatedChildAsModal
          relatedModalAnchorHostRef={rootRef}
          mapTabContent={
            <LayerClickDetailBlankMapTab
              hit={hit}
              keyField={keyField}
              keyValue={keyValue}
              extent3857={extent3857}
            />
          }
        />
      </div>
    </div>
  )
}

export default function LayerClickDetailBlankClient() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          불러오는 중…
        </div>
      }
    >
      <BlankBody />
    </Suspense>
  )
}
