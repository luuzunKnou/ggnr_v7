/**
 * 접도구역 표주·표지 관리대장
 */
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  roadFrontageMarker,
  roadFrontageMarkerItem,
} from '@/database/schema/road_frontage_marker';
import type {
  RoadFrontageMarkerItem,
  RoadFrontageMarkerLedger,
} from '@/app/(pages)/map/_mapContents/road/roadFrontageMarker/roadFrontageMarkerMock';
import {
  installLocationToParcelAddress,
  jimokFromJijukJibun,
  normalizeMarkerInstallLocation,
  splitInstallLocationAndJimok,
} from '@/app/(pages)/map/_mapContents/road/roadFrontageMarker/roadFrontageMarkerAddress';
import { getJijukGeomByPnu, getPnuFromAddress } from '@/service/excelUploadService';

function dbCause(e: unknown): Error {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur instanceof Error; i++) {
    const cause = (cur as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && /^Failed query:/i.test(cur.message) && cause.message.trim()) {
      cur = cause;
      continue;
    }
    break;
  }
  return cur instanceof Error ? cur : new Error(String(e));
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function tx(s: string | null | undefined): string {
  return String(s ?? '').trim();
}

function parseId(id: unknown): number | null {
  const n = Number(String(id ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function isBlankMarker(m: RoadFrontageMarkerItem): boolean {
  return (
    toNum(m.serialNo) == null &&
    !tx(m.stationDistance) &&
    !tx(m.installLocation) &&
    !tx(m.landCategory) &&
    !tx(m.ownerName) &&
    !tx(m.ownerAddress) &&
    !tx(m.sign) &&
    !tx(m.remark)
  );
}

type ResolvedPlace = {
  installLocation: string | null;
  landCategory: string | null;
  pnu: string | null;
  lon: number | null;
  lat: number | null;
  geomWkt: string | null;
};

async function resolvePlace(params: {
  installLocation?: string | null;
  landCategory?: string | null;
}): Promise<ResolvedPlace> {
  let install = normalizeMarkerInstallLocation(tx(params.installLocation));
  let jimok = tx(params.landCategory);

  if (install && !jimok) {
    const split = splitInstallLocationAndJimok(install);
    install = split.installLocation;
    jimok = split.landCategory;
  } else if (install) {
    const split = splitInstallLocationAndJimok(install);
    install = split.installLocation || install;
    if (split.landCategory && !jimok) jimok = split.landCategory;
  }

  if (!install) {
    return {
      installLocation: null,
      landCategory: emptyToNull(jimok),
      pnu: null,
      lon: null,
      lat: null,
      geomWkt: null,
    };
  }

  const addr = installLocationToParcelAddress(install);
  const pnu = addr ? await getPnuFromAddress(addr) : null;
  if (!pnu) {
    return {
      installLocation: install,
      landCategory: emptyToNull(jimok),
      pnu: null,
      lon: null,
      lat: null,
      geomWkt: null,
    };
  }

  if (!jimok) {
    try {
      const pnuDigits = String(pnu).replace(/\D/g, '');
      const candidates: string[] = [];
      if (pnuDigits.length >= 19) {
        const exact = pnuDigits.slice(0, 19);
        candidates.push(
          exact,
          `${exact.slice(0, 10)}${exact[10] === '1' ? '2' : '1'}${exact.slice(11)}`
        );
      } else if (pnuDigits.length === 18) {
        candidates.push(
          `${pnuDigits.slice(0, 10)}1${pnuDigits.slice(10)}`,
          `${pnuDigits.slice(0, 10)}2${pnuDigits.slice(10)}`
        );
      }
      for (const key of candidates) {
        const jRes = await db.execute(
          sql.raw(`
            SELECT jibun::text AS jibun
            FROM public_layer.jijuk
            WHERE REGEXP_REPLACE(pnu::text, '[^0-9]', '', 'g') = '${key.replace(/'/g, "''")}'
               OR pnu::text = '${key.replace(/'/g, "''")}'
            LIMIT 1
          `)
        );
        const jibun = String((jRes.rows?.[0] as { jibun?: string } | undefined)?.jibun ?? '');
        jimok = jimokFromJijukJibun(jibun);
        if (jimok) break;
      }
    } catch {
      /* ignore — 지목 보강 실패해도 위치는 유지 */
    }
  }

  const polyWkt = await getJijukGeomByPnu(pnu, 5181);
  if (!polyWkt) {
    return {
      installLocation: install,
      landCategory: emptyToNull(jimok),
      pnu,
      lon: null,
      lat: null,
      geomWkt: null,
    };
  }

  const esc = polyWkt.replace(/'/g, "''");
  const pt = await db.execute(
    sql.raw(`
      SELECT
        ST_AsText(ST_PointOnSurface(ST_SetSRID(ST_GeomFromText('${esc}'), 5181))) AS wkt,
        ST_X(ST_Transform(ST_PointOnSurface(ST_SetSRID(ST_GeomFromText('${esc}'), 5181)), 4326)) AS lon,
        ST_Y(ST_Transform(ST_PointOnSurface(ST_SetSRID(ST_GeomFromText('${esc}'), 5181)), 4326)) AS lat
    `)
  );
  const row = (pt.rows?.[0] ?? {}) as { wkt?: string; lon?: number; lat?: number };
  return {
    installLocation: install,
    landCategory: emptyToNull(jimok),
    pnu,
    lon: toNum(row.lon),
    lat: toNum(row.lat),
    geomWkt: String(row.wkt ?? '').trim() || null,
  };
}

async function jimokNearLonLat(
  lon: number,
  lat: number
): Promise<{ jimok: string; pnu: string | null } | null> {
  try {
    const res = await db.execute(
      sql.raw(`
        WITH pt AS (
          SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181) AS g
        )
        SELECT j.pnu::text AS pnu, j.jibun::text AS jibun
        FROM public_layer.jijuk j, pt
        WHERE j.geom IS NOT NULL
          AND (ST_Intersects(j.geom, pt.g) OR ST_DWithin(j.geom, pt.g, 50))
        ORDER BY ST_Distance(j.geom, pt.g)
        LIMIT 1
      `)
    );
    const row = (res.rows?.[0] ?? null) as { pnu?: string; jibun?: string } | null;
    if (!row) return null;
    const jimok = jimokFromJijukJibun(String(row.jibun ?? ''));
    if (!jimok) return null;
    return { jimok, pnu: emptyToNull(row.pnu) };
  } catch {
    return null;
  }
}

/**
 * 표주 모달용 — 설치위치·좌표로 지목(및 가능하면 점) 미리보기.
 * 도로명 좌표가 필지 밖이어도 주소→PNU로 지목을 채운다.
 */
export async function previewInstallPlace(params: {
  installLocation?: string | null;
  landCategory?: string | null;
  lon?: number | null;
  lat?: number | null;
} = {}) {
  const place = await resolvePlace({
    installLocation: params.installLocation,
    landCategory: params.landCategory,
  });

  let landCategory = tx(place.landCategory);
  let pnu = place.pnu;
  const lon = place.lon ?? toNum(params.lon);
  const lat = place.lat ?? toNum(params.lat);

  if (!landCategory && lon != null && lat != null) {
    const near = await jimokNearLonLat(lon, lat);
    if (near) {
      landCategory = near.jimok;
      pnu = pnu ?? near.pnu;
    }
  }

  return {
    installLocation: place.installLocation,
    landCategory: emptyToNull(landCategory),
    pnu,
    lon,
    lat,
  };
}

async function refreshParentGeom(parentId: number): Promise<void> {
  await db.execute(
    sql.raw(`
      UPDATE layer.road_frontage_marker p
      SET geom = sub.g
      FROM (
        SELECT
          ${parentId}::int AS parent_id,
          CASE
            WHEN count(i.geom) = 0 THEN NULL
            ELSE ST_Multi(ST_CollectionExtract(ST_Collect(i.geom), 1))
          END AS g
        FROM layer.road_frontage_marker_item i
        WHERE i.parent_id = ${parentId}
          AND i.geom IS NOT NULL
      ) sub
      WHERE p.id = sub.parent_id
    `)
  );
}

function toMarkerItem(row: {
  id: number;
  serialNo: number | null;
  stationDistance: string | null;
  installLocation: string | null;
  landCategory: string | null;
  ownerName: string | null;
  ownerAddress: string | null;
  sign: string | null;
  remark: string | null;
  lon?: number | null;
  lat?: number | null;
}): RoadFrontageMarkerItem {
  return {
    id: String(row.id),
    serialNo: toNum(row.serialNo),
    stationDistance: tx(row.stationDistance),
    installLocation: tx(row.installLocation),
    landCategory: tx(row.landCategory),
    ownerName: tx(row.ownerName),
    ownerAddress: tx(row.ownerAddress),
    sign: tx(row.sign),
    remark: tx(row.remark),
    lon: toNum(row.lon),
    lat: toNum(row.lat),
  };
}

function toLedger(
  row: typeof roadFrontageMarker.$inferSelect,
  markers: RoadFrontageMarkerItem[]
): RoadFrontageMarkerLedger {
  return {
    id: String(row.id),
    roadType: tx(row.roadType),
    routeName: tx(row.routeName),
    markers,
  };
}

async function loadMarkers(parentId: number): Promise<RoadFrontageMarkerItem[]> {
  const res = await db.execute(
    sql.raw(`
      SELECT
        id,
        station_distance,
        install_location,
        land_category,
        owner_name,
        owner_address,
        sign,
        remark,
        CASE
          WHEN geom IS NULL THEN NULL
          ELSE ST_X(
            ST_Transform(
              ST_SetSRID(geom, COALESCE(NULLIF(ST_SRID(geom), 0), 5181)),
              4326
            )
          )
        END AS lon,
        CASE
          WHEN geom IS NULL THEN NULL
          ELSE ST_Y(
            ST_Transform(
              ST_SetSRID(geom, COALESCE(NULLIF(ST_SRID(geom), 0), 5181)),
              4326
            )
          )
        END AS lat
      FROM layer.road_frontage_marker_item
      WHERE parent_id = ${parentId}
      ORDER BY id
    `)
  );
  return (res.rows ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return toMarkerItem({
      id: Number(row.id),
      serialNo: null,
      stationDistance: tx(row.station_distance as string),
      installLocation: tx(row.install_location as string),
      landCategory: tx(row.land_category as string),
      ownerName: tx(row.owner_name as string),
      ownerAddress: tx(row.owner_address as string),
      sign: tx(row.sign as string),
      remark: tx(row.remark as string),
      lon: toNum(row.lon),
      lat: toNum(row.lat),
    });
  });
}

type RoadFrontageMarkerListSortKey = 'roadType' | 'routeName';

type RoadFrontageMarkerListSortSpec = {
  key: RoadFrontageMarkerListSortKey;
  dir: 'asc' | 'desc';
};

const ROAD_FRONTAGE_MARKER_LIST_SORT_KEYS = new Set<string>(['roadType', 'routeName']);

function parseRoadFrontageMarkerListSortSpecs(params?: {
  sorts?: unknown;
}): RoadFrontageMarkerListSortSpec[] {
  const raw = params?.sorts;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: RoadFrontageMarkerListSortSpec[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const key = String((item as { key?: unknown }).key ?? '').trim();
    if (!ROAD_FRONTAGE_MARKER_LIST_SORT_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    const dirRaw = String((item as { dir?: unknown }).dir ?? '').trim().toLowerCase();
    out.push({
      key: key as RoadFrontageMarkerListSortKey,
      dir: dirRaw === 'asc' ? 'asc' : 'desc',
    });
  }
  return out;
}

function buildRoadFrontageMarkerListOrderBy(
  sortSpecs: RoadFrontageMarkerListSortSpec[]
): SQL[] {
  if (sortSpecs.length === 0) return [asc(roadFrontageMarker.id)];
  const order: SQL[] = sortSpecs.map((s) => {
    const col =
      s.key === 'roadType' ? roadFrontageMarker.roadType : roadFrontageMarker.routeName;
    return s.dir === 'asc' ? asc(col) : desc(col);
  });
  order.push(asc(roadFrontageMarker.id));
  return order;
}

export async function list(params: {
  keyword?: string;
  roadType?: string;
  sorts?: Array<{ key?: string; dir?: string }>;
} = {}) {
  try {
    const keyword = emptyToNull(params?.keyword);
    const roadType = emptyToNull(params?.roadType);
    const sortSpecs = parseRoadFrontageMarkerListSortSpecs(params);
    const conditions = [];
    if (roadType) {
      conditions.push(eq(roadFrontageMarker.roadType, roadType));
    }
    if (keyword) {
      const like = `%${keyword}%`;
      conditions.push(
        or(
          ilike(roadFrontageMarker.roadType, like),
          ilike(roadFrontageMarker.routeName, like),
          sql`EXISTS (
            SELECT 1 FROM layer.road_frontage_marker_item i
            WHERE i.parent_id = ${roadFrontageMarker.id}
              AND (
                i.owner_name ILIKE ${like}
                OR i.owner_address ILIKE ${like}
                OR i.install_location ILIKE ${like}
                OR i.land_category ILIKE ${like}
                OR i.station_distance ILIKE ${like}
                OR i.sign ILIKE ${like}
                OR i.remark ILIKE ${like}
              )
          )`
        )!
      );
    }
    const rows = await db
      .select()
      .from(roadFrontageMarker)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...buildRoadFrontageMarkerListOrderBy(sortSpecs));
    return Promise.all(
      rows.map(async (row) => {
        const markers = await loadMarkers(row.id);
        return toLedger(row, markers);
      })
    );
  } catch (e) {
    throw dbCause(e);
  }
}

export async function get(params: { id?: string | number }) {
  const id = parseId(params?.id);
  if (id == null) return null;
  const [row] = await db
    .select()
    .from(roadFrontageMarker)
    .where(eq(roadFrontageMarker.id, id))
    .limit(1);
  if (!row) return null;
  const markers = await loadMarkers(row.id);
  return toLedger(row, markers);
}

type SaveBody = Partial<RoadFrontageMarkerLedger> & { id?: string };

async function geomWktFromLonLat(lon: number, lat: number): Promise<string | null> {
  const res = await db.execute(
    sql.raw(`
      SELECT ST_AsText(
        ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)
      ) AS wkt
    `)
  );
  return String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim() || null;
}

async function replaceMarkers(parentId: number, body: SaveBody) {
  await db.delete(roadFrontageMarkerItem).where(eq(roadFrontageMarkerItem.parentId, parentId));

  const markers = (Array.isArray(body.markers) ? body.markers : []).filter((m) => !isBlankMarker(m));
  for (const m of markers) {
    const place = await resolvePlace({
      installLocation: m.installLocation,
      landCategory: m.landCategory,
    });
    const [ins] = await db
      .insert(roadFrontageMarkerItem)
      .values({
        parentId,
        stationDistance: emptyToNull(m.stationDistance),
        installLocation: place.installLocation,
        landCategory: place.landCategory,
        pnu: place.pnu,
        ownerName: emptyToNull(m.ownerName),
        ownerAddress: emptyToNull(m.ownerAddress),
        sign: emptyToNull(m.sign),
        remark: emptyToNull(m.remark),
      })
      .returning({ id: roadFrontageMarkerItem.id });

    const pickLon = toNum(m.lon);
    const pickLat = toNum(m.lat);
    let geomWkt = place.geomWkt;
    if (pickLon != null && pickLat != null) {
      geomWkt = (await geomWktFromLonLat(pickLon, pickLat)) ?? geomWkt;
    }

    if (geomWkt && ins?.id != null) {
      await db.execute(
        sql.raw(`
          UPDATE layer.road_frontage_marker_item
          SET geom = ST_SetSRID(ST_GeomFromText('${geomWkt.replace(/'/g, "''")}'), 5181)
          WHERE id = ${ins.id}
        `)
      );
    }
  }

  await refreshParentGeom(parentId);
}

export async function save(body: SaveBody = {}) {
  const fields = {
    roadType: emptyToNull(body.roadType),
    routeName: emptyToNull(body.routeName),
  };

  const existingId = parseId(body.id);
  let id = existingId;
  if (id != null) {
    const [found] = await db
      .select({ id: roadFrontageMarker.id })
      .from(roadFrontageMarker)
      .where(eq(roadFrontageMarker.id, id))
      .limit(1);
    if (!found) id = null;
  }

  if (id == null) {
    const [inserted] = await db
      .insert(roadFrontageMarker)
      .values(fields)
      .returning({ id: roadFrontageMarker.id });
    id = inserted.id;
  } else {
    await db.update(roadFrontageMarker).set(fields).where(eq(roadFrontageMarker.id, id));
  }

  await replaceMarkers(id, body);
  return get({ id });
}

export async function remove(params: { id?: string | number }) {
  const id = parseId(params?.id);
  if (id == null) return { ok: false };
  await db.delete(roadFrontageMarker).where(eq(roadFrontageMarker.id, id));
  return { ok: true };
}

/** 설치위치·지목 분리 + 표주 점 + 관리대장 점 모음 일괄 보강 */
export async function fillMissingInstallLocationAndGeom(params?: {
  refreshAll?: boolean;
  limit?: number;
}): Promise<{ updated: number; withGeom: number; failed: number }> {
  const limit = Math.min(Math.max(Number(params?.limit) || 10000, 1), 20000);
  const refreshAll = Boolean(params?.refreshAll);

  const res = await db.execute(
    sql.raw(`
      SELECT id, parent_id, install_location, land_category, geom
      FROM layer.road_frontage_marker_item
      ORDER BY id
      LIMIT ${limit}
    `)
  );

  let updated = 0;
  let withGeom = 0;
  let failed = 0;
  const parents = new Set<number>();

  for (const raw of res.rows ?? []) {
    const row = raw as Record<string, unknown>;
    const id = Number(row.id);
    const parentId = Number(row.parent_id);
    if (!Number.isFinite(id)) continue;

    const install = tx(row.install_location as string);
    const jimok = tx(row.land_category as string);
    const hasGeom = row.geom != null;
    if (!refreshAll && hasGeom && install && jimok) {
      if (Number.isFinite(parentId)) parents.add(parentId);
      continue;
    }

    const place = await resolvePlace({ installLocation: install, landCategory: jimok });
    if (!place.installLocation) {
      failed += 1;
      continue;
    }

    await db
      .update(roadFrontageMarkerItem)
      .set({
        installLocation: place.installLocation,
        landCategory: place.landCategory,
        pnu: place.pnu,
      })
      .where(eq(roadFrontageMarkerItem.id, id));

    if (place.geomWkt) {
      await db.execute(
        sql.raw(`
          UPDATE layer.road_frontage_marker_item
          SET geom = ST_SetSRID(ST_GeomFromText('${place.geomWkt.replace(/'/g, "''")}'), 5181)
          WHERE id = ${id}
        `)
      );
      withGeom += 1;
    } else {
      await db.execute(
        sql.raw(`UPDATE layer.road_frontage_marker_item SET geom = NULL WHERE id = ${id}`)
      );
      failed += 1;
    }
    updated += 1;
    if (Number.isFinite(parentId)) parents.add(parentId);
  }

  for (const pid of parents) {
    await refreshParentGeom(pid);
  }

  return { updated, withGeom, failed };
}
