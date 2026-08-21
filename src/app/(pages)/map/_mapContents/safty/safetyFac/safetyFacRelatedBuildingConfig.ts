import { BUILDING_ROAD_LAYER_DEFS } from '../../../_mapComponents/layerFactory/buildingRoadLayerConfig';
import type { SafetyFacRelatedBuildingResult } from '@/service/standardService';

export type SafetyFacRelatedLayerKey =
  | 'bldgGroup'
  | 'bldgGroupEntrance'
  | 'building'
  | 'buildingEntrance';

export type SafetyFacRelatedLayerDef = {
  key: SafetyFacRelatedLayerKey;
  tableName: string;
  label: string;
};

const LABEL_BY_TABLE = Object.fromEntries(
  BUILDING_ROAD_LAYER_DEFS.map((d) => [d.tableName, d.layerName])
) as Record<string, string>;

export const SAFETY_FAC_RELATED_LAYER_DEFS: SafetyFacRelatedLayerDef[] = [
  {
    key: 'bldgGroup',
    tableName: 'tl_sgco_rnadr_mst',
    label: LABEL_BY_TABLE.tl_sgco_rnadr_mst ?? '건물군',
  },
  {
    key: 'bldgGroupEntrance',
    tableName: 'tl_spbd_entrc',
    label: LABEL_BY_TABLE.tl_spbd_entrc ?? '건물군 출입구',
  },
  {
    key: 'building',
    tableName: 'tl_sgco_rnadr_dong',
    label: LABEL_BY_TABLE.tl_sgco_rnadr_dong ?? '건물',
  },
  {
    key: 'buildingEntrance',
    tableName: 'tl_spbd_entrc_dong',
    label: LABEL_BY_TABLE.tl_spbd_entrc_dong ?? '건물 출입구',
  },
];

export const SAFETY_FAC_RELATED_TABLE_NAMES = SAFETY_FAC_RELATED_LAYER_DEFS.map((d) => d.tableName);

function escCql(v: string): string {
  return v.replace(/'/g, "''");
}

function isEqbManSnZero(v: string | null | undefined): boolean {
  if (v == null || v === '') return false;
  const s = String(v).trim();
  if (s === '0') return true;
  const n = Number(s);
  return Number.isFinite(n) && n === 0;
}

/** WMS CQL — 조회 건수와 동일 조건 */
export function buildSafetyFacRelatedLayerCql(
  tableName: string,
  result: SafetyFacRelatedBuildingResult
): string | null {
  const eqb = result.eqbManSn?.trim();
  const bul = result.bulManNo?.trim();
  const useBulFk = isEqbManSnZero(eqb);

  if (useBulFk) {
    if (!bul) return null;
    const bulCql = `"bul_man_no"='${escCql(bul)}'`;
    switch (tableName) {
      case 'tl_sgco_rnadr_mst':
      case 'tl_spbd_entrc':
      case 'tl_sgco_rnadr_dong':
        return bulCql;
      case 'tl_spbd_entrc_dong': {
        const ids = result.bulManNos.filter(Boolean);
        if (ids.length === 0) return bulCql;
        if (ids.length === 1) return `"bul_man_no"='${escCql(ids[0]!)}'`;
        return `"bul_man_no" IN (${ids.map((id) => `'${escCql(id)}'`).join(',')})`;
      }
      default:
        return null;
    }
  }

  if (!eqb) return null;

  const eqCql = `"eqb_man_sn"='${escCql(eqb)}'`;

  switch (tableName) {
    case 'tl_sgco_rnadr_mst':
    case 'tl_spbd_entrc':
    case 'tl_sgco_rnadr_dong':
      return eqCql;
    case 'tl_spbd_entrc_dong': {
      const ids = result.bulManNos.filter(Boolean);
      if (ids.length === 0) return '1=0';
      if (ids.length === 1) return `"bul_man_no"='${escCql(ids[0]!)}'`;
      return `"bul_man_no" IN (${ids.map((id) => `'${escCql(id)}'`).join(',')})`;
    }
    default:
      return null;
  }
}

export function buildSafetyFacRelatedLayerCqlMap(
  result: SafetyFacRelatedBuildingResult,
  activeTableNames: Iterable<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tableName of activeTableNames) {
    const cql = buildSafetyFacRelatedLayerCql(tableName, result);
    if (cql) out[tableName] = cql;
  }
  return out;
}
