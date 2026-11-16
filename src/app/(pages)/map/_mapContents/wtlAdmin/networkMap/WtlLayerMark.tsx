'use client'

import { NetworkLayerMark } from '@/app/(pages)/map/_mapComponents/NetworkLayerMark'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'
import {
  getWtlNetPhysicalTable,
  listWtlNetSameKorTables,
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

/**
 * 범례·스타일 키.
 * - 기본: 논리키(define_table_name)
 * - 한글명 동일 remap(저수조 wtl_rsrv_ps→wtl_tank_ps): 물리 테이블
 * - 관로 분할→부모 물리 테이블은 한글명이 달라 논리키 유지
 */
function resolveLegendStyleKey(layerKey: string, physicalTable: string): string {
  const key = String(layerKey ?? '')
    .trim()
    .toLowerCase()
  const phys = String(physicalTable ?? '')
    .trim()
    .toLowerCase()
  if (!key) return phys
  if (!phys || phys === key) return key
  if (listWtlNetSameKorTables(key).includes(phys)) return phys
  return key
}

type Props = {
  layerKey: string
  /** 선택 출처 id — title용 물리 테이블 조회 */
  sourceId?: string | null
  /** 서버 resolve 물리 테이블 — 한글명 remap 시 범례·스타일 키로 사용 */
  physicalTable?: string | null
}

/** 상수 관망조회 분류 버튼 범례 — 공용 NetworkLayerMark */
export function WtlLayerMark({ layerKey, sourceId, physicalTable }: Props) {
  const phys =
    String(physicalTable ?? '').trim().toLowerCase() ||
    getWtlNetPhysicalTable(layerKey, sourceId) ||
    ''
  const legendKey = resolveLegendStyleKey(layerKey, phys)
  const styleName = wtlLegendStyleName(legendKey)
  // 논리키 geom(저수조 POINT) 유지 — 물리 tank는 POLYGON이어도 점 심볼 스타일
  const geomKind = wtlLegendGeomKind(layerKey)
  const kor = wtlNetKorNameForTable(layerKey) || wtlNetKorNameForTable(phys)
  const title =
    kor && phys && phys !== layerKey.toLowerCase()
      ? `${kor} (${layerKey}→${phys})`
      : kor || layerKey

  return (
    <span title={title} className="inline-flex shrink-0">
      <NetworkLayerMark styleName={styleName} geomKind={geomKind} />
    </span>
  )
}
