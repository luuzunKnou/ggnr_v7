import { sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { getAllUseFeeWmsLayerIds } from '@/lib/useFeeBinding';

function assertFeeTableName(name: string): string {
  const n = String(name ?? '').trim().toLowerCase();
  if (!getAllUseFeeWmsLayerIds().includes(n)) {
    throw new Error(`invalid fee table: ${name}`);
  }
  return n;
}

function escapeSqlLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

/**
 * 물건지주소 필지검색용 정규화.
 * «438번지 1호» → «438-1», «951번지» → «951», 빈 괄호 제거.
 */
export function normalizeUseFeeGlAddrForParcelSearch(addr: string): string {
  let s = String(addr ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(/\(\s*\)/g, '');
  s = s.replace(/(\d{1,5})\s*번지\s+(\d{1,5})\s*호/gu, '$1-$2');
  s = s.replace(/(\d{1,5})\s*번지/gu, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** 지번(본번/부번·번지)이 없으면 필지 검색 생략 — 예: «평해읍 학곡리» */
export function hasUseFeeGlAddrJibunLot(addr: string): boolean {
  const s = normalizeUseFeeGlAddrForParcelSearch(addr);
  if (!s) return false;
  if (/(?:^|\s)산\s*\d{1,5}(?:\s*-\s*\d{1,5})?(?:\s|$)/u.test(s)) return true;
  return /(?:^|\s)\d{1,5}(?:\s*-\s*\d{1,5})?(?:\s|$)/u.test(s);
}

async function resolveGeomGeoJson3857(glAddr: string): Promise<Record<string, unknown> | null> {
  const addrRaw = String(glAddr ?? '').trim();
  if (!addrRaw || !hasUseFeeGlAddrJibunLot(addrRaw)) return null;
  const addr = normalizeUseFeeGlAddrForParcelSearch(addrRaw);
  if (!addr) return null;
  const { resolveJijukParcelGeomsByAddresses } = await import('@/service/layerRowService');
  const resolved = await resolveJijukParcelGeomsByAddresses({
    items: [{ address: addr }],
  });
  const gj = resolved.parcels[0]?.geometry3857;
  if (!gj || typeof gj !== 'object') return null;
  return gj;
}

function geomUpdateExpr(geoJson: Record<string, unknown>): string {
  const json = escapeSqlLiteral(JSON.stringify(geoJson));
  return `ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(
        ST_Transform(
          ST_SetSRID(ST_GeomFromGeoJSON('${json}'), 3857),
          5181
        )
      ),
      3
    )
  )`;
}

/** 후처리·수동 적재 — id로 도형 갱신 */
export async function updateUseFeeGeomById(params: {
  tableName: string;
  id: number;
  glAddr: string;
}): Promise<boolean> {
  const tableName = assertFeeTableName(params.tableName);
  const gj = await resolveGeomGeoJson3857(params.glAddr);
  if (!gj) return false;
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return false;
  await db.execute(
    sql.raw(`
      UPDATE layer.${tableName}
      SET geom = ${geomUpdateExpr(gj)},
          updated_at = now()
      WHERE id = ${id}
    `)
  );
  return true;
}

/** 연계 저장 직후 — 부과키·수납일련으로 도형 첨부. 실패해도 호출측 속성 저장은 유지 */
export async function applyUseFeeGeomFromGlAddr(params: {
  tableName: string;
  lvyKey: string;
  rcvmtSn?: string | null;
  glAddr?: string | null;
}): Promise<void> {
  const lvyKey = String(params.lvyKey ?? '').trim();
  const glAddr = String(params.glAddr ?? '').trim();
  if (!lvyKey || !glAddr) return;
  try {
    const tableName = assertFeeTableName(params.tableName);
    const gj = await resolveGeomGeoJson3857(glAddr);
    if (!gj) return;
    const sn = escapeSqlLiteral(String(params.rcvmtSn ?? '').trim());
    const key = escapeSqlLiteral(lvyKey);
    await db.execute(
      sql.raw(`
        UPDATE layer.${tableName}
        SET geom = ${geomUpdateExpr(gj)},
            updated_at = now()
        WHERE lvy_key = '${key}'
          AND coalesce(rcvmt_sn, '') = '${sn}'
      `)
    );
  } catch {
    /* 속성 저장은 유지 */
  }
}
