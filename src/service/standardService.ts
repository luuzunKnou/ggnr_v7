/**
 * StandardList용 서비스 (레이어 목록/테이블 데이터)
 * - 레이어 데이터는 항상 layer 스키마에서 조회
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';

const LAYER_SCHEMA = 'layer';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * 테이블 이름만으로 layer 스키마의 테이블에서 행 조회.
 * information_schema.columns로 컬럼 목록을 가져온 뒤 SELECT 쿼리 구성.
 */
export async function getTableData(params: { table: string; limit?: number; offset?: number } = { table: '' }) {
  const table = String(params?.table ?? '').trim();
  if (!table) return { rows: [], total: 0 };

  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;

  const safeSchema = LAYER_SCHEMA.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');

  try {
    const colRes = await db.execute(
      sql.raw(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = '${LAYER_SCHEMA.replace(/'/g, "''")}' AND table_name = '${table.replace(/'/g, "''")}'
         ORDER BY ordinal_position`
      )
    );
    const columns = (colRes.rows as { name: string }[]).map((r) => String(r?.name ?? '').trim()).filter(Boolean);
    if (columns.length === 0) return { rows: [], total: 0 };

    let geomCol: string | null = null;
    try {
      const gcRes = await db.execute(
        sql.raw(
          `SELECT f_geometry_column AS name FROM geometry_columns
           WHERE f_table_schema = '${LAYER_SCHEMA.replace(/'/g, "''")}' AND f_table_name = '${table.replace(/'/g, "''")}'
           LIMIT 1`
        )
      );
      const gcRow = gcRes.rows?.[0] as { name?: string } | undefined;
      if (gcRow?.name) geomCol = String(gcRow.name).trim();
    } catch {
      // no geometry column
    }

    const safeGeomCol = geomCol ? geomCol.replace(/"/g, '""') : '';
    const selectList = columns
      .map((c) => {
        if (geomCol && c === geomCol) {
          return `ST_AsGeoJSON(ST_Transform("${safeGeomCol}", 4326))::json AS "${safeGeomCol}"`;
        }
        return `"${c.replace(/"/g, '""')}"`;
      })
      .join(', ');

    const [countRes, dataRes] = await Promise.all([
      db.execute(
        sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"`)
      ),
      db.execute(
        sql.raw(
          `SELECT ${selectList} FROM "${safeSchema}"."${safeTable}" LIMIT ${limit} OFFSET ${offset}`
        )
      ),
    ]);

    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    const rows = (dataRes.rows ?? []) as Record<string, unknown>[];
    return { rows, total };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], total: 0, error: msg };
  }
}

/**
 * 테이블 전체 건수만 조회 (레이어 펼치기 전 배지 표시용)
 */
export async function getTableCount(params: { table: string } = { table: '' }) {
  const table = String(params?.table ?? '').trim();
  if (!table) return { total: 0 };

  const safeSchema = LAYER_SCHEMA.replace(/"/g, '""');
  const safeTable = table.replace(/"/g, '""');

  try {
    const countRes = await db.execute(
      sql.raw(`SELECT COUNT(*) AS total FROM "${safeSchema}"."${safeTable}"`)
    );
    const totalRow = countRes.rows?.[0] as { total?: string | number } | undefined;
    const total =
      totalRow?.total != null ? Math.max(0, parseInt(String(totalRow.total), 10) || 0) : 0;
    return { total };
  } catch (e: unknown) {
    return { total: 0 };
  }
}
