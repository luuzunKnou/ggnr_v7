import { call } from '@/lib/api';
import { applyMapServiceWmsLayerAlias } from '@/lib/mapServiceWmsAlias';

function rowOgcFid(row: Record<string, unknown>): string | null {
  const v = row.ogc_fid ?? row.OGC_FID;
  if (v == null || String(v).trim() === '') return null;
  return String(v);
}

/**
 * WMS 별칭이 있는 테이블이면 행 geom을 별칭(선형) geom으로 교체.
 * 낙석방지 등 다른 선형과 동일한 LINE 강조 스타일을 타게 한다.
 */
export async function applyMapDisplayGeomsToRows(
  sourceTable: string,
  schema: string | undefined,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const table = String(sourceTable ?? '').trim();
  if (!table || rows.length === 0) return rows;
  const alias = applyMapServiceWmsLayerAlias(table);
  if (alias.toLowerCase() === table.toLowerCase()) return rows;

  const ogcFids = rows
    .map((r) => rowOgcFid(r))
    .filter((v): v is string => v != null)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (ogcFids.length === 0) return rows;

  try {
    const res = await call('', 'POST', {
      service: 'standardService',
      action: 'getMapDisplayGeomsByOgcFids',
      params: {
        sourceTable: table,
        schema: schema ?? 'layer',
        ogcFids,
      },
    });
    const data = res?.data ?? res;
    const geomsByOgcFid =
      data && typeof data === 'object' && data.geomsByOgcFid && typeof data.geomsByOgcFid === 'object'
        ? (data.geomsByOgcFid as Record<string, unknown>)
        : {};
    if (Object.keys(geomsByOgcFid).length === 0) return rows;

    return rows.map((row) => {
      const id = rowOgcFid(row);
      if (!id) return row;
      const g = geomsByOgcFid[id];
      if (g == null) return row;
      return { ...row, geom: g };
    });
  } catch {
    return rows;
  }
}
