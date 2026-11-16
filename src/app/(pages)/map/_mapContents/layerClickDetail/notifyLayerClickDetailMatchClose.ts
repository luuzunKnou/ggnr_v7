'use client'

import {
  extractDefineRowKeyValue,
  findDefineKeyFieldName,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils'
import {
  isLayerClickDetailCloseOnMatchOpened,
  requestCloseLayerClickDetailIfMatch,
} from './layerClickDetailMatchClose'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
} from '../wtlAdmin/networkMap/wtlNetworkDefineDisplayCache'

function readOpenedTokens(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const q = new URLSearchParams(window.location.search).get('opened') ?? ''
    return q.split(',').map((t) => t.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function applyMatchClose(opts: {
  tableNames: string[]
  record: Record<string, unknown>
  fields: DefineFieldLike[]
  ogcFid?: number | null
}) {
  const keyFieldName = findDefineKeyFieldName(opts.fields)
  let rowKey = extractDefineRowKeyValue(opts.record, keyFieldName)
  if (
    rowKey == null &&
    opts.ogcFid != null &&
    Number.isFinite(opts.ogcFid)
  ) {
    rowKey = String(opts.ogcFid)
  }
  if (!rowKey) return
  requestCloseLayerClickDetailIfMatch({
    tableNames: opts.tableNames,
    rowKey,
    keyFieldName,
  })
}

/** 관망·시설·설비 상세 오픈 시 — opened가 일치 닫기 목록이면 전역 클릭 상세 닫기 */
export function notifyLayerClickDetailMatchClose(opts: {
  tableNames: Array<string | null | undefined>
  fieldsTable?: string | null
  fieldsTableFallback?: string | null
  record?: Record<string, unknown> | null
  ogcFid?: number | null
}): void {
  if (!isLayerClickDetailCloseOnMatchOpened(readOpenedTokens())) return
  const tableNames = opts.tableNames
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
  const record =
    opts.record && typeof opts.record === 'object' ? opts.record : {}
  const fieldsTable = String(opts.fieldsTable ?? '').trim()
  const fallback = String(opts.fieldsTableFallback ?? '').trim() || null

  const run = (fields: DefineFieldLike[]) => {
    applyMatchClose({
      tableNames,
      record,
      fields,
      ogcFid: opts.ogcFid,
    })
  }

  if (!fieldsTable) {
    run([])
    return
  }
  const peeked = peekWtlDefineDisplayBundle(fieldsTable, fallback)
  if (peeked) {
    run(peeked.fields as DefineFieldLike[])
    return
  }
  void loadWtlDefineDisplayBundle(fieldsTable, fallback).then((b) => {
    run((b?.fields ?? []) as DefineFieldLike[])
  })
}
