/**
 * GCP — layer.gcp (SHP 업로드) 목록·상세·등록·수정
 */
import { pool } from '@/database/db';
import {
  insertTableRow,
  updateTableRowByKey,
} from '@/service/layerRowService';

type Params = Record<string, unknown>;

export type GcpListItem = {
  id: string;
  gcpnum: string;
  x: number;
  y: number;
  z: number;
  geom5181: [number, number];
  placeNote: string;
  txt1: string;
  txt2: string;
};

const TABLE = 'gcp';
const SCHEMA = 'layer';

function tx(v: unknown): string {
  return String(v ?? '').trim();
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseId(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function joinPlaceNote(txt1: string, txt2: string): string {
  const a = tx(txt1);
  const b = tx(txt2);
  if (a && b) return `${a} / ${b}`;
  return a || b || '';
}

export function splitPlaceNote(note: string): { txt1: string; txt2: string } {
  const s = tx(note);
  const i = s.indexOf(' / ');
  if (i >= 0) {
    return { txt1: s.slice(0, i).trim(), txt2: s.slice(i + 3).trim() };
  }
  return { txt1: s, txt2: '' };
}

function mapRow(row: Record<string, unknown>): GcpListItem | null {
  const ogcFid = parseId(row.ogc_fid ?? row.ogcFid);
  if (ogcFid == null) return null;
  const gx = toNum(row.gx ?? row.geom_x);
  const gy = toNum(row.gy ?? row.geom_y);
  const x = toNum(row.x) ?? gx ?? 0;
  const y = toNum(row.y) ?? gy ?? 0;
  const z = toNum(row.z) ?? 0;
  const txt1 = tx(row.txt1);
  const txt2 = tx(row.txt2);
  const geom5181: [number, number] =
    gx != null && gy != null ? [gx, gy] : [x, y];
  return {
    id: String(ogcFid),
    gcpnum: tx(row.gcpnum) || String(ogcFid),
    x,
    y,
    z,
    geom5181,
    txt1,
    txt2,
    placeNote: joinPlaceNote(txt1, txt2),
  };
}

const LIST_SQL = `
  SELECT
    g.ogc_fid,
    g.gcpnum,
    g.x,
    g.y,
    g.z,
    g.txt1,
    g.txt2,
    CASE
      WHEN g.geom IS NOT NULL THEN ST_X(ST_GeometryN(ST_CollectionExtract(g.geom, 1), 1))
      ELSE NULL
    END AS gx,
    CASE
      WHEN g.geom IS NOT NULL THEN ST_Y(ST_GeometryN(ST_CollectionExtract(g.geom, 1), 1))
      ELSE NULL
    END AS gy
  FROM ${SCHEMA}.${TABLE} g
`;

export async function list(
  p: Params = {}
): Promise<{ items: GcpListItem[]; total: number }> {
  const keyword = tx(p.keyword);
  const limit = Math.min(10000, Math.max(1, Number(p.limit ?? 5000)));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    whereParts.push(
      `(g.gcpnum ILIKE $${i} OR COALESCE(g.txt1,'') ILIKE $${i} OR COALESCE(g.txt2,'') ILIKE $${i})`
    );
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${SCHEMA}.${TABLE} g ${whereClause}`,
    params
  );
  const total = Number(countRes.rows[0]?.c ?? 0);

  const dataRes = await pool.query<Record<string, unknown>>(
    `${LIST_SQL} ${whereClause} ORDER BY g.ogc_fid ASC LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  const items = dataRes.rows
    .map((r) => mapRow(r))
    .filter((v): v is GcpListItem => v != null);
  return { items, total };
}

export async function get(
  p: Params
): Promise<{ item: GcpListItem | null }> {
  const id = parseId(p.id);
  if (id == null) return { item: null };
  const dataRes = await pool.query<Record<string, unknown>>(
    `${LIST_SQL} WHERE g.ogc_fid = $1 LIMIT 1`,
    [id]
  );
  const row = dataRes.rows[0];
  if (!row) return { item: null };
  return { item: mapRow(row) };
}

function buildAttrValues(input: {
  gcpnum: string;
  x: number;
  y: number;
  z: number;
  placeNote?: string;
  txt1?: string;
  txt2?: string;
}): Record<string, unknown> {
  const split = input.placeNote != null
    ? splitPlaceNote(input.placeNote)
    : { txt1: tx(input.txt1), txt2: tx(input.txt2) };
  return {
    gcpnum: input.gcpnum,
    x: input.x,
    y: input.y,
    z: input.z,
    txt1: split.txt1,
    txt2: split.txt2,
  };
}

function pointWkt5181(x: number, y: number): string {
  // SHP 업로드 결과가 MULTIPOINT인 경우가 있어 동일 타입으로 맞춤
  return `MULTIPOINT((${x} ${y}))`;
}

export async function create(
  p: Params
): Promise<{ success: boolean; id?: string; item?: GcpListItem; error?: string }> {
  const gcpnum = tx(p.gcpnum);
  const x = toNum(p.x);
  const y = toNum(p.y);
  const z = toNum(p.z) ?? 0;
  if (!gcpnum) return { success: false, error: 'GCP번호는 비워 둘 수 없습니다.' };
  if (x == null || y == null) {
    return { success: false, error: '지도에서 위치를 지정하거나 좌표를 입력하세요.' };
  }

  const values = buildAttrValues({
    gcpnum,
    x,
    y,
    z,
    placeNote: tx(p.placeNote ?? p.place_note),
    txt1: tx(p.txt1),
    txt2: tx(p.txt2),
  });

  const inserted = await insertTableRow({
    table: TABLE,
    schema: SCHEMA,
    keyField: 'ogc_fid',
    values,
    allowPhysicalColumns: true,
    geomWkt5181: pointWkt5181(x, y),
  });
  if (!inserted.success) {
    return { success: false, error: inserted.error ?? '등록에 실패했습니다.' };
  }
  const id = String(inserted.keyValue ?? '').trim();
  if (!id) return { success: false, error: '등록 후 식별자를 확인하지 못했습니다.' };
  const got = await get({ id });
  return { success: true, id, item: got.item ?? undefined };
}

export async function update(
  p: Params
): Promise<{ success: boolean; item?: GcpListItem; error?: string }> {
  const id = parseId(p.id);
  if (id == null) return { success: false, error: '대상이 없습니다.' };

  const existing = await get({ id });
  if (!existing.item) return { success: false, error: '기준점을 찾을 수 없습니다.' };

  const gcpnum = tx(p.gcpnum) || existing.item.gcpnum;
  const x = toNum(p.x) ?? existing.item.x;
  const y = toNum(p.y) ?? existing.item.y;
  const z = toNum(p.z) ?? existing.item.z;
  const placeNote =
    p.placeNote != null || p.place_note != null
      ? tx(p.placeNote ?? p.place_note)
      : existing.item.placeNote;

  const changes = buildAttrValues({ gcpnum, x, y, z, placeNote });
  const nextX = toNum(p.x);
  const nextY = toNum(p.y);
  const shouldMoveGeom =
    p.updateGeom === true ||
    (nextX != null &&
      nextY != null &&
      (Math.abs(nextX - existing.item.geom5181[0]) > 1e-6 ||
        Math.abs(nextY - existing.item.geom5181[1]) > 1e-6));

  const updated = await updateTableRowByKey({
    table: TABLE,
    schema: SCHEMA,
    keyField: 'ogc_fid',
    keyValue: id,
    changes,
    allowPhysicalColumns: true,
    geomWkt5181: shouldMoveGeom ? pointWkt5181(x, y) : undefined,
  });
  if (!updated.success) {
    if (updated.error === '변경할 항목이 없습니다.') {
      return { success: true, item: existing.item };
    }
    return { success: false, error: updated.error ?? '수정에 실패했습니다.' };
  }
  const got = await get({ id });
  return { success: true, item: got.item ?? undefined };
}
