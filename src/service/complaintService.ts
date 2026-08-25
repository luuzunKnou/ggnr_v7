/**
 * 민원(comp) / 민원 처리내역(compd) API
 */
import { db } from '@/database/db';
import { comp, compd } from '@/database/schema';
import { fetchCoordFromAddress } from '@/lib/vworldAddressServer';
import { eq, desc, asc, sql, inArray } from 'drizzle-orm';
import {
  applyDefaultStyleToLayer,
  createOrUpdateGeoServerLayer,
  getGeoServerLayerList,
  getGeoServerStyleList,
  getLayerGeometryType,
  setLayerDefaultStyle,
} from '@/service/devTestService';
import {
  deleteTableRowByKey,
  insertTableRow,
  updateTableRowByKey,
} from '@/service/layerRowService';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const COMP_LAYER_ID = 'comp';
/** PostGIS·raw SQL 용 정규 테이블 (layer 스키마, 뷰 아님) */
const COMP_TABLE_SQL = 'layer."comp"';

/**
 * 민원관리 WMS: GeoServer 레이어·스타일 확보.
 * geom 컬럼 추가 후 구 FeatureType(도형 없음·POLYGON 오인)이 남으면 재생성한다.
 * 스타일이 이미 있으면 덮어쓰지 않는다.
 */
export async function ensureWmsLayer(): Promise<{
  success: boolean;
  layerCreated?: boolean;
  styleCreated?: boolean;
  error?: string;
}> {
  let layerCreated = false;
  let styleCreated = false;

  try {
    const listRes = await getGeoServerLayerList();
    const layerNames = (listRes.layers ?? []).map((n) => String(n).toLowerCase());
    const layerExists = layerNames.includes(COMP_LAYER_ID);

    let needsPublish = !layerExists;
    if (layerExists) {
      const geomType = await getLayerGeometryType({ layerName: COMP_LAYER_ID });
      // POINT가 아니면 geom 반영 전 FeatureType이거나 메타 오류 → 재발행
      needsPublish = !geomType.success || geomType.geometryType !== 'POINT';
    }

    if (needsPublish) {
      const layerRes = await createOrUpdateGeoServerLayer({ layerName: COMP_LAYER_ID });
      if (!layerRes.success) {
        return {
          success: false,
          error: layerRes.error ?? 'GeoServer 레이어 생성 실패',
        };
      }
      layerCreated = true;
    }

    const styleList = await getGeoServerStyleList();
    const hasStyle = (styleList.styles ?? []).some(
      (s) => String(s?.name ?? '').toLowerCase() === COMP_LAYER_ID
    );
    if (!hasStyle) {
      const styleRes = await applyDefaultStyleToLayer({ layerName: COMP_LAYER_ID });
      if (!styleRes.success) {
        return {
          success: false,
          layerCreated,
          error: styleRes.error ?? 'GeoServer 스타일 생성 실패',
        };
      }
      styleCreated = true;
    } else if (layerCreated) {
      await setLayerDefaultStyle({
        layerName: COMP_LAYER_ID,
        styleName: COMP_LAYER_ID,
      });
    }

    return { success: true, layerCreated, styleCreated };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, layerCreated, styleCreated, error: msg };
  }
}

export type CompRow = typeof comp.$inferSelect;
export type CompdRow = typeof compd.$inferSelect;

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

async function wkt5181FromLonLat4326(lon: number, lat: number): Promise<string | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)) AS wkt`
      )
    );
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

async function resolveCompGeomWkt5181(params: {
  compAdr?: string | null;
  lon?: number | string | null;
  lat?: number | string | null;
}): Promise<{ geomWkt5181: string | null; geomClear: boolean }> {
  const adr = emptyToNull(params.compAdr);
  let lonLat = parseLonLat(params.lon, params.lat);
  if (!lonLat && adr) {
    lonLat = await fetchCoordFromAddress(adr);
  }
  if (!lonLat) return { geomWkt5181: null, geomClear: true };
  const wkt = await wkt5181FromLonLat4326(lonLat.lon, lonLat.lat);
  if (!wkt) return { geomWkt5181: null, geomClear: true };
  return { geomWkt5181: wkt, geomClear: false };
}

function parseLonLat(
  lon?: number | string | null,
  lat?: number | string | null
): { lon: number; lat: number } | null {
  // Number(null)===0 이라 null/빈값은 좌표 없음으로 처리 (0,0 오인 방지)
  if (lon == null || lat == null) return null;
  if (typeof lon === 'string' && lon.trim() === '') return null;
  if (typeof lat === 'string' && lat.trim() === '') return null;
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < -180 || x > 180 || y < -90 || y > 90) return null;
  return { lon: x, lat: y };
}

/** 주소(및 선택 좌표)로 comp.geom(Point,5181) 갱신. 주소 없으면 NULL */
async function syncCompGeomFromAddress(params: {
  compKey: number;
  compAdr?: string | null;
  lon?: number | string | null;
  lat?: number | string | null;
}): Promise<void> {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return;

  const adr = emptyToNull(params.compAdr);
  let lonLat = parseLonLat(params.lon, params.lat);
  if (!lonLat && adr) {
    lonLat = await fetchCoordFromAddress(adr);
  }

  try {
    if (!lonLat) {
      await db.execute(sql.raw(`UPDATE ${COMP_TABLE_SQL} SET "geom" = NULL WHERE "comp_key" = ${key}`));
      return;
    }
    const { lon, lat } = lonLat;
    await db.execute(
      sql.raw(
        `UPDATE ${COMP_TABLE_SQL}
         SET "geom" = ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)
         WHERE "comp_key" = ${key}`
      )
    );
  } catch (e: unknown) {
    const err = e as { cause?: { message?: string; code?: string }; message?: string };
    const msg = [err.message, err.cause?.message, String(e)].filter(Boolean).join(' ');
    // 컬럼 미적용·권한·투영 실패 등이어도 접수 저장은 유지
    if (
      /column .*geom.* does not exist/i.test(msg) ||
      /geom.*존재하지/i.test(msg) ||
      /Failed query:[\s\S]*["']?geom["']?/i.test(msg)
    ) {
      console.warn(
        '[complaintService] layer.comp.geom 갱신 실패(접수는 저장됨):',
        msg.slice(0, 300)
      );
      return;
    }
    throw e;
  }
}

/** 목록 조회 (페이징, 각 행에 latestState 포함) */
export async function list(params: {
  limit?: number;
  offset?: number;
  compKey?: number;
} = {}) {
  let limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = typeof params?.offset === 'number' && params.offset >= 0 ? params.offset : 0;

  const where = params?.compKey != null ? eq(comp.compKey, params.compKey) : undefined;
  const rows = await db
    .select()
    .from(comp)
    .where(where)
    .orderBy(desc(comp.compKey))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comp)
    .where(where);
  const total = countResult[0]?.count ?? 0;

  if (rows.length === 0) return { rows: [], total };
  const compKeys = rows.map((r) => r.compKey);
  const allCompd = await db
    .select({ compKey: compd.compKey, compdState: compd.compdState, compdKey: compd.compdKey })
    .from(compd)
    .where(inArray(compd.compKey, compKeys))
    .orderBy(desc(compd.compdKey));
  const latestByKey = new Map<number, string | null>();
  for (const r of allCompd) {
    if (!latestByKey.has(r.compKey)) latestByKey.set(r.compKey, r.compdState);
  }
  const rowsWithState = rows.map((r) => ({ ...r, latestState: latestByKey.get(r.compKey) ?? null }));

  return { rows: rowsWithState, total };
}

/** 단건 조회 + 처리내역(compd) 목록 + 지도 이동용 extent3857 + 하이라이트용 geom(EPSG:4326) */
export async function get(params: { compKey: number }) {
  const key = Number(params?.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [row] = await db.select().from(comp).where(eq(comp.compKey, key)).limit(1);
  if (!row) return null;

  const compdList = await db
    .select()
    .from(compd)
    .where(eq(compd.compKey, key))
    .orderBy(asc(compd.compdKey));

  let extent3857 = await getCompExtent3857(key);
  // geom 없으면 주소로 좌표 보강 후 이동용 extent 재조회
  if (!extent3857 && row.compAdr) {
    await syncCompGeomFromAddress({ compKey: key, compAdr: row.compAdr });
    extent3857 = await getCompExtent3857(key);
  }

  const geomGeoJson4326 = await getCompGeomGeoJson4326(key);

  return { ...row, compdList, extent3857, geomGeoJson4326 };
}

/** comp.geom → GeoJSON (EPSG:4326). 하이라이트용 */
async function getCompGeomGeoJson4326(compKey: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS g
         FROM ${COMP_TABLE_SQL}
         WHERE "comp_key" = ${compKey} AND geom IS NOT NULL
         LIMIT 1`
      )
    );
    const raw = (res.rows?.[0] as { g?: unknown } | undefined)?.g;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** comp.geom → EPSG:3857 점 extent (없으면 null) */
async function getCompExtent3857(
  compKey: number
): Promise<[number, number, number, number] | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_X(ST_Transform(geom, 3857))::float8 AS x,
                ST_Y(ST_Transform(geom, 3857))::float8 AS y
         FROM ${COMP_TABLE_SQL}
         WHERE "comp_key" = ${compKey} AND geom IS NOT NULL
         LIMIT 1`
      )
    );
    const r = res.rows?.[0] as { x?: unknown; y?: unknown } | undefined;
    const x = Number(r?.x);
    const y = Number(r?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y, x, y];
  } catch {
    return null;
  }
}

/** 민원 신규 접수 시 초기 처리이력(상태 «접수») — 민원관리·도형편집기 공통 */
export async function ensureInitialReceiptHistory(params: {
  compKey: number;
  compCu?: string | null;
  compCt?: string | null;
  compCg?: string | null;
}) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const existing = await db
    .select({ compdKey: compd.compdKey })
    .from(compd)
    .where(eq(compd.compKey, key))
    .limit(1);
  if (existing.length > 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  return compdCreate({
    compKey: key,
    compdDate: today,
    compdState: '접수',
    compdCu: emptyToNull(params.compCu),
    compdCt: emptyToNull(params.compCt),
    compdCg: emptyToNull(params.compCg),
    compdContents: '민원접수',
    compdExtra: null,
  });
}

/** 민원 접수 생성 (생성 시 상태 '접수' 이력 1건 자동 추가) */
export async function create(params: {
  compDate?: string | null;
  compCu?: string | null;
  compCt?: string | null;
  compCg?: string | null;
  compAdr?: string | null;
  compName?: string | null;
  compTel?: string | null;
  compContent?: string | null;
  compExtra?: Record<string, unknown> | null;
  /** 주소검색 선택 시 전달 — 있으면 geocode 생략 */
  lon?: number | string | null;
  lat?: number | string | null;
}) {
  try {
    const geom = await resolveCompGeomWkt5181({
      compAdr: params.compAdr,
      lon: params.lon,
      lat: params.lat,
    });
    const inserted = await insertTableRow({
      table: 'comp',
      schema: 'layer',
      keyField: 'comp_key',
      values: {
        comp_date: emptyToNull(params.compDate),
        comp_cu: emptyToNull(params.compCu),
        comp_ct: emptyToNull(params.compCt),
        comp_cg: emptyToNull(params.compCg),
        comp_adr: emptyToNull(params.compAdr),
        comp_name: emptyToNull(params.compName),
        comp_tel: emptyToNull(params.compTel),
        comp_content: emptyToNull(params.compContent),
        comp_extra: params.compExtra ?? null,
      },
      allowPhysicalColumns: true,
      geomWkt5181: geom.geomWkt5181,
    });
    if (!inserted.success) {
      throw Object.assign(new Error(inserted.error ?? '등록에 실패했습니다.'), {
        detail: inserted.error,
      });
    }
    const compKey = Number(inserted.keyValue);
    if (!Number.isInteger(compKey) || compKey < 1) return null;

    await ensureInitialReceiptHistory({
      compKey,
      compCu: params.compCu,
      compCt: params.compCt,
      compCg: params.compCg,
    });

    return (await get({ compKey })) ?? null;
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string; message?: string };
    const msg = err.detail || err.message || String(e);
    throw Object.assign(new Error(msg), { code: err.code, detail: err.detail });
  }
}

/** 민원 접수 수정 */
export async function update(params: {
  compKey: number;
  compDate?: string | null;
  compCu?: string | null;
  compCt?: string | null;
  compCg?: string | null;
  compAdr?: string | null;
  compName?: string | null;
  compTel?: string | null;
  compContent?: string | null;
  compExtra?: Record<string, unknown> | null;
  lon?: number | string | null;
  lat?: number | string | null;
}) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const changes: Record<string, unknown> = {};
  if (params.compDate !== undefined) changes.comp_date = emptyToNull(params.compDate);
  if (params.compCu !== undefined) changes.comp_cu = emptyToNull(params.compCu);
  if (params.compCt !== undefined) changes.comp_ct = emptyToNull(params.compCt);
  if (params.compCg !== undefined) changes.comp_cg = emptyToNull(params.compCg);
  if (params.compAdr !== undefined) changes.comp_adr = emptyToNull(params.compAdr);
  if (params.compName !== undefined) changes.comp_name = emptyToNull(params.compName);
  if (params.compTel !== undefined) changes.comp_tel = emptyToNull(params.compTel);
  if (params.compContent !== undefined) changes.comp_content = emptyToNull(params.compContent);
  if (params.compExtra !== undefined) changes.comp_extra = params.compExtra;

  const shouldSyncGeom =
    params.compAdr !== undefined || params.lon !== undefined || params.lat !== undefined;

  if (Object.keys(changes).length === 0 && !shouldSyncGeom) {
    return (await get({ compKey: key })) ?? null;
  }

  let geomWkt5181: string | null = null;
  let geomClear = false;
  if (shouldSyncGeom) {
    let adr = params.compAdr;
    if (adr === undefined) {
      const [cur] = await db
        .select({ compAdr: comp.compAdr })
        .from(comp)
        .where(eq(comp.compKey, key))
        .limit(1);
      adr = cur?.compAdr ?? null;
    }
    const geom = await resolveCompGeomWkt5181({
      compAdr: adr,
      lon: params.lon,
      lat: params.lat,
    });
    geomWkt5181 = geom.geomWkt5181;
    geomClear = geom.geomClear;
  }

  const updated = await updateTableRowByKey({
    table: 'comp',
    schema: 'layer',
    keyField: 'comp_key',
    keyValue: key,
    changes,
    allowPhysicalColumns: true,
    geomWkt5181,
    geomClear,
  });
  if (!updated.success) {
    throw Object.assign(new Error(updated.error ?? '수정에 실패했습니다.'), {
      detail: updated.error,
    });
  }

  return (await get({ compKey: key })) ?? null;
}

/** 민원 처리내역(compd) 추가 */
export async function compdCreate(params: {
  compKey: number;
  compdDate?: string | null;
  compdCu?: string | null;
  compdCt?: string | null;
  compdCg?: string | null;
  compdState?: string | null;
  compdContents?: string | null;
  compdExtra?: Record<string, unknown> | null;
}) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [inserted] = await db
    .insert(compd)
    .values({
      compKey: key,
      compdDate: params.compdDate ?? null,
      compdCu: params.compdCu ?? null,
      compdCt: params.compdCt ?? null,
      compdCg: params.compdCg ?? null,
      compdState: params.compdState ?? null,
      compdContents: params.compdContents ?? null,
      compdExtra: params.compdExtra ?? null,
    })
    .returning();
  return inserted ?? null;
}

/** 민원 처리내역(compd) 수정 */
export async function compdUpdate(params: {
  compdKey: number;
  compdDate?: string | null;
  compdCu?: string | null;
  compdCt?: string | null;
  compdCg?: string | null;
  compdState?: string | null;
  compdContents?: string | null;
  compdExtra?: Record<string, unknown> | null;
}) {
  const key = Number(params.compdKey);
  if (!Number.isInteger(key) || key < 1) return null;

  const [updated] = await db
    .update(compd)
    .set({
      compdDate: params.compdDate ?? null,
      compdCu: params.compdCu ?? null,
      compdCt: params.compdCt ?? null,
      compdCg: params.compdCg ?? null,
      compdState: params.compdState ?? null,
      compdContents: params.compdContents ?? null,
      compdExtra: params.compdExtra ?? null,
    })
    .where(eq(compd.compdKey, key))
    .returning();
  return updated ?? null;
}

/** 민원 처리내역(compd) 삭제 */
export async function compdRemove(params: { compdKey: number }) {
  const key = Number(params.compdKey);
  if (!Number.isInteger(key) || key < 1) return { deleted: false };

  await db.delete(compd).where(eq(compd.compdKey, key));
  return { deleted: true };
}

/** 민원 접수 삭제 (compd는 FK cascade로 함께 삭제) */
export async function remove(params: { compKey: number }) {
  const key = Number(params.compKey);
  if (!Number.isInteger(key) || key < 1) return { deleted: false };

  const result = await deleteTableRowByKey({
    table: 'comp',
    schema: 'layer',
    keyField: 'comp_key',
    keyValue: key,
    childTableNames: ['compd'],
    childParentField: 'comp_key',
  });
  return { deleted: result.success === true };
}

/** 민원관리 메뉴 진입 시 전체 위치(comp.geom) extent — EPSG:3857 */
export async function getLayerExtent3857(): Promise<{
  extent3857: [number, number, number, number] | null;
  error?: string;
}> {
  // 레이어·스타일 없으면 생성 (실패해도 extent 조회는 시도)
  await ensureWmsLayer().catch(() => null);

  try {
    const res = await db.execute(
      sql.raw(`
        SELECT ST_XMin(ext)::float8 AS xmin, ST_YMin(ext)::float8 AS ymin,
               ST_XMax(ext)::float8 AS xmax, ST_YMax(ext)::float8 AS ymax
        FROM (
          SELECT ST_Extent(ST_Transform(geom, 3857))::box2d AS ext
          FROM ${COMP_TABLE_SQL}
          WHERE geom IS NOT NULL
        ) s
        WHERE ext IS NOT NULL`)
    );
    const row = res.rows?.[0] as {
      xmin?: unknown;
      ymin?: unknown;
      xmax?: unknown;
      ymax?: unknown;
    } | undefined;
    const coords = [Number(row?.xmin), Number(row?.ymin), Number(row?.xmax), Number(row?.ymax)];
    if (!coords.every((v) => Number.isFinite(v))) {
      return { extent3857: null };
    }
    return {
      extent3857: coords as [number, number, number, number],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/column .*geom.* does not exist/i.test(msg) || /geom.*존재하지/i.test(msg)) {
      return { extent3857: null, error: 'geom 컬럼이 없습니다.' };
    }
    return { extent3857: null, error: msg };
  }
}
