'use client'

import { NetworkLayerMark } from '@/app/(pages)/map/_mapComponents/NetworkLayerMark'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'
import {
  getWtlNetPhysicalTable,
  wtlNetKorNameForTable,
} from './wtlNetworkMapSources'
import tablesJson from '@/config/defineLayer/tables.json'

type TablesShpRow = {
  define_table_name?: string
  define_table_shp_type?: string
}

const SHP_BY_TABLE = (() => {
  const map = new Map<string, string>()
  const rows = (Array.isArray(tablesJson) ? tablesJson : []) as TablesShpRow[]
  for (const row of rows) {
    const name = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    const shp = String(row.define_table_shp_type ?? '')
      .trim()
      .toUpperCase()
    if (!name || !shp || map.has(name)) continue
    map.set(name, shp)
  }
  return map
})()

function geomKindFromShp(shp: string | null | undefined): 'line' | 'area' | 'point' | null {
  const s = String(shp ?? '')
    .trim()
    .toUpperCase()
  if (s === 'POINT' || s === 'MULTIPOINT') return 'point'
  if (s === 'LINE' || s === 'LINESTRING' || s === 'MULTILINESTRING') return 'line'
  if (s === 'POLYGON' || s === 'MULTIPOLYGON') return 'area'
  return null
}

function wtlLegendGeomKind(name: string): 'line' | 'area' | 'point' {
  const fromShp = geomKindFromShp(SHP_BY_TABLE.get(name.toLowerCase()))
  if (fromShp) return fromShp
  const def = getWtlNetLayerDef(name)
  if (def?.geomKind) return def.geomKind
  if (name.includes('관로') || name.includes('심도')) return 'line'
  if (name.includes('구역') || name.includes('분구') || name.includes('블록') || name.includes('제한')) {
    return 'area'
  }
  return 'point'
}

function wtlLegendStyleName(name: string): string {
  return /^[a-z][a-z0-9_]*$/i.test(name) ? name.toLowerCase() : ''
}

type Props = {
  layerKey: string
  /** 선택 출처 id — 한글명·DB 실데이터 기준 물리 테이블 범례 */
  sourceId?: string | null
  /** 서버 resolve 물리 테이블 (있으면 우선) */
  physicalTable?: string | null
}

/** 상수 관망조회 분류 버튼 범례 — 공용 NetworkLayerMark */
export function WtlLayerMark({ layerKey, sourceId, physicalTable }: Props) {
  const resolved =
    String(physicalTable ?? '').trim().toLowerCase() ||
    getWtlNetPhysicalTable(layerKey, sourceId) ||
    layerKey
  const styleName = wtlLegendStyleName(resolved)
  const geomKind = wtlLegendGeomKind(resolved)
  // 디버그 title — 한글명·물리 테이블
  const kor = wtlNetKorNameForTable(resolved) || wtlNetKorNameForTable(layerKey)
  const title =
    kor && resolved !== layerKey
      ? `${kor} (${resolved})`
      : kor || resolved

  return (
    <span title={title} className="inline-flex shrink-0">
      <NetworkLayerMark styleName={styleName} geomKind={geomKind} />
    </span>
  )
}
