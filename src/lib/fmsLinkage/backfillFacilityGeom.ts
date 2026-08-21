/**
 * FMS 시설 geom 적재
 * - 일반: 주소→필지, 실패 시 시설명 명칭검색→점→필지
 * - 교량(BR): 교량 레이어 명칭 매칭 → 시군구 제한 명칭검색 (애매한 주소 필지 조회 제외)
 */
import { pool } from '@/database/db';
import { fetchCoordFromAddress, fetchParcelJibunFromCoord } from '@/lib/vworldAddressServer';
import { getMapConfig } from '@/service/configService';
import {
  FMS_FACILITY_TABLE_NAMES,
  FMS_PREFIXES,
  getFmsLayerTableName,
  type FmsPrefix,
} from '@/lib/fmsLinkage/fmsBinding';

const LOG = '[fms-facility-geom]';
const VWORLD_SEARCH = 'https://api.vworld.kr/req/search';
const BRIDGE_LAYER_TABLE = 'rdl_brdg_as';

export type FmsFacilityGeomBackfillResult = {
  scanned: number;
  updated: number;
  skippedNoLocation: number;
  skippedNotFound: number;
  error?: string;
};

function assertFacilityTable(name: string): string {
  const n = String(name ?? '').trim().toLowerCase();
  if (!(FMS_FACILITY_TABLE_NAMES as readonly string[]).includes(n)) {
    throw new Error(`invalid fms facility table: ${name}`);
  }
  return n;
}

function buildAddrFull(row: {
  addr_full?: string | null;
  addr_sido?: string | null;
  addr_gugun?: string | null;
  addr_dong?: string | null;
  addr_detail?: string | null;
}): string {
  const full = String(row.addr_full ?? '').trim();
  if (full) return full.replace(/\s+/g, ' ');
  return [row.addr_sido, row.addr_gugun, row.addr_dong, row.addr_detail]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBridgeFacility(facilNo: string | null | undefined): boolean {
  return /^BR/i.test(String(facilNo ?? '').trim());
}

function isSewageFacility(row: {
  facil_no?: string | null;
  facil_nm?: string | null;
  facil_kind?: string | null;
}): boolean {
  if (/^ST/i.test(String(row.facil_no ?? '').trim())) return true;
  const kind = String(row.facil_kind ?? '');
  const nm = String(row.facil_nm ?? '');
  return /하수/.test(kind) || /하수처리|하수종말/.test(nm);
}

function normalizeBridgeName(name: string): string {
  return String(name ?? '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/** 도로명·번지 힌트 — 예: 봉화길 104, 삼덕로99 */
function extractRoadHints(addr: string): string[] {
  const text = String(addr ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const hints: string[] = [];
  const re = /([가-힣A-Za-z0-9]+(?:로|길))\s*(\d+(?:-\d+)?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const road = m[1];
    const no = m[2] ? `${road} ${m[2]}` : road;
    hints.push(no.replace(/\s+/g, ''));
    hints.push(road);
  }
  return [...new Set(hints.filter(Boolean))];
}

/** 죽변 하수처리장 → 죽변공공하수처리시설 등 검색어 후보 */
function buildSewagePlaceQueries(facilNm: string, regionTokens: string[]): string[] {
  const name = facilNm.trim();
  if (!name) return [];
  const compact = name.replace(/\s+/g, '');
  const variants = new Set<string>();

  const push = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (t) variants.add(t);
  };

  push(name);
  push(compact);

  const aliasPairs: Array<[string, string]> = [
    ['하수처리장', '공공하수처리시설'],
    ['하수종말처리장', '공공하수처리시설'],
    ['하수처리시설', '공공하수처리시설'],
    ['하수처리장', '하수종말처리장'],
  ];
  for (const [from, to] of aliasPairs) {
    if (name.includes(from)) push(name.split(from).join(to));
    if (compact.includes(from)) push(compact.split(from).join(to));
  }

  // 앞쪽 지명 토큰 + 공공하수처리시설 (죽변, 후포, 북면 …)
  const placeToken = compact
    .replace(/공공?하수(종말)?처리(장|시설)?/g, '')
    .replace(/하수(종말)?처리(장|시설)?/g, '')
    .trim();
  if (placeToken && placeToken.length >= 2 && placeToken.length <= 12) {
    push(`${placeToken}공공하수처리시설`);
    push(`${placeToken} 공공하수처리시설`);
    push(`${placeToken}하수종말처리장`);
  }

  const withRegion: string[] = [];
  for (const q of variants) {
    withRegion.push(q);
    for (const tok of regionTokens) {
      if (tok && !q.includes(tok)) withRegion.push(`${tok} ${q}`);
    }
  }
  return [...new Set(withRegion)];
}

function regionTokens(row: {
  addr_sido?: string | null;
  addr_gugun?: string | null;
}): string[] {
  return [...new Set(
    [row.addr_gugun, row.addr_sido]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
  )];
}

function textIncludesAnyRegion(text: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = String(text ?? '');
  return tokens.some((t) => t && hay.includes(t));
}

function approxDistM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111000;
}

async function ensureFacilityGeomColumns(): Promise<void> {
  for (const prefix of FMS_PREFIXES) {
    const t = assertFacilityTable(getFmsLayerTableName(prefix, 'facility'));
    await pool.query(`
      ALTER TABLE layer.${t}
        ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 5181);
      CREATE INDEX IF NOT EXISTS ${t}_geom_gix
        ON layer.${t} USING GIST (geom);
    `);
  }
}

async function bridgeLayerTableExists(): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('layer.${BRIDGE_LAYER_TABLE}') IS NOT NULL AS exists`
  );
  return r.rows[0]?.exists === true;
}

async function resolveGeometryFromBridgeLayer(params: {
  facilNm: string;
  hint?: { lon: number; lat: number } | null;
}): Promise<Record<string, unknown> | null> {
  const key = normalizeBridgeName(params.facilNm);
  if (!key) return null;
  if (!(await bridgeLayerTableExists())) return null;

  const r = await pool.query<{
    geometry3857: Record<string, unknown> | null;
    lat: number | null;
    lon: number | null;
  }>(
    `SELECT ST_AsGeoJSON(ST_Transform(geom, 3857))::json AS geometry3857,
            ST_Y(ST_Centroid(ST_Transform(geom, 4326))) AS lat,
            ST_X(ST_Centroid(ST_Transform(geom, 4326))) AS lon
     FROM layer.${BRIDGE_LAYER_TABLE}
     WHERE geom IS NOT NULL
       AND replace(lower(coalesce(kor_bri_nm, '')), ' ', '') = $1`,
    [key]
  );
  if (!r.rows.length) return null;

  let chosen = r.rows[0];
  if (r.rows.length > 1 && params.hint) {
    let best = Number.POSITIVE_INFINITY;
    for (const row of r.rows) {
      if (row.lat == null || row.lon == null) continue;
      const d = approxDistM(params.hint, { lat: Number(row.lat), lon: Number(row.lon) });
      if (d < best) {
        best = d;
        chosen = row;
      }
    }
  }

  const gj = chosen?.geometry3857;
  return gj && typeof gj === 'object' ? gj : null;
}

type PlaceItem = {
  title?: string;
  point?: { x?: string; y?: string };
  address?: { parcel?: string; road?: string };
};

async function searchPlacePoint(
  query: string,
  apiKey: string,
  options?: { regionTokens?: string[] }
): Promise<{ lon: number; lat: number } | null> {
  const q = query.trim();
  if (!q || !apiKey) return null;
  const params = new URLSearchParams({
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    query: q,
    type: 'place',
    format: 'json',
    errorformat: 'json',
    key: apiKey,
  });
  try {
    const res = await fetch(`${VWORLD_SEARCH}?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: {
        status?: string;
        result?: { items?: PlaceItem[] };
      };
    };
    if (data?.response?.status !== 'OK') return null;
    const items = data.response?.result?.items ?? [];
    const tokens = options?.regionTokens ?? [];

    for (const item of items) {
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      if (tokens.length) {
        const addrText = [item?.address?.parcel, item?.address?.road, item?.title]
          .map((v) => String(v ?? ''))
          .join(' ');
        if (!textIncludesAnyRegion(addrText, tokens)) continue;
      }
      return { lon, lat };
    }
    return null;
  } catch {
    return null;
  }
}

async function searchBridgePlacePoint(
  facilNm: string,
  tokens: string[],
  apiKey: string
): Promise<{ lon: number; lat: number } | null> {
  const name = facilNm.trim();
  if (!name || !apiKey) return null;

  const queries = [
    [...tokens, name].filter(Boolean).join(' '),
    name,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  for (const query of queries) {
    const params = new URLSearchParams({
      service: 'search',
      request: 'search',
      version: '2.0',
      crs: 'EPSG:4326',
      size: '10',
      page: '1',
      query,
      type: 'place',
      format: 'json',
      errorformat: 'json',
      key: apiKey,
    });
    try {
      const res = await fetch(`${VWORLD_SEARCH}?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        response?: { status?: string; result?: { items?: PlaceItem[] } };
      };
      if (data?.response?.status !== 'OK') continue;
      const items = data.response?.result?.items ?? [];
      const nameKey = normalizeBridgeName(name);

      for (const item of items) {
        const lon = Number(item?.point?.x);
        const lat = Number(item?.point?.y);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

        const title = String(item?.title ?? '');
        const addrText = [item?.address?.parcel, item?.address?.road, title].join(' ');
        if (tokens.length && !textIncludesAnyRegion(addrText, tokens)) continue;

        if (/버스정류장/.test(title)) continue;

        const titleKey = normalizeBridgeName(title.replace(/\(.*?\)/g, ''));
        if (titleKey && nameKey && !titleKey.includes(nameKey) && !nameKey.includes(titleKey)) {
          continue;
        }

        return { lon, lat };
      }
    } catch {
      /* try next query */
    }
  }
  return null;
}

/** 하수처리 — 시설명 변형 + 도로명 일치 우선 */
async function searchSewagePlacePoint(params: {
  facilNm: string;
  addr: string;
  regionTokens: string[];
  apiKey: string;
}): Promise<{ lon: number; lat: number } | null> {
  const { facilNm, addr, regionTokens, apiKey } = params;
  if (!facilNm.trim() || !apiKey) return null;

  const queries = buildSewagePlaceQueries(facilNm, regionTokens);
  const roadHints = extractRoadHints(addr);
  type Cand = { lon: number; lat: number; roadScore: number; title: string };
  const cands: Cand[] = [];

  for (const query of queries) {
    const qs = new URLSearchParams({
      service: 'search',
      request: 'search',
      version: '2.0',
      crs: 'EPSG:4326',
      size: '10',
      page: '1',
      query,
      type: 'place',
      format: 'json',
      errorformat: 'json',
      key: apiKey,
    });
    try {
      const res = await fetch(`${VWORLD_SEARCH}?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        response?: { status?: string; result?: { items?: PlaceItem[] } };
      };
      if (data?.response?.status !== 'OK') continue;

      for (const item of data.response?.result?.items ?? []) {
        const lon = Number(item?.point?.x);
        const lat = Number(item?.point?.y);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

        const title = String(item?.title ?? '');
        if (/버스정류장/.test(title)) continue;

        const addrText = [item?.address?.parcel, item?.address?.road, title].join(' ');
        if (regionTokens.length && !textIncludesAnyRegion(addrText, regionTokens)) continue;

        // 하수/처리 계열 명칭만 허용
        if (!/하수|처리/.test(title) && !/하수|처리/.test(addrText)) continue;

        const roadCompact = addrText.replace(/\s+/g, '');
        let roadScore = 0;
        for (const hint of roadHints) {
          if (hint && roadCompact.includes(hint.replace(/\s+/g, ''))) {
            roadScore = Math.max(roadScore, hint.length >= 4 ? 2 : 1);
          }
        }
        cands.push({ lon, lat, roadScore, title });
      }
    } catch {
      /* next query */
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.roadScore - a.roadScore);
  const best =
    roadHints.length > 0
      ? cands.find((c) => c.roadScore > 0) ?? cands[0]
      : cands[0];
  return best ? { lon: best.lon, lat: best.lat } : null;
}

async function updateFacilityGeom(
  tableName: string,
  id: number,
  geometry3857: Record<string, unknown>
): Promise<boolean> {
  const json = JSON.stringify(geometry3857).replace(/'/g, "''");
  try {
    await pool.query(`
      UPDATE layer.${tableName}
      SET geom = ST_Multi(
            ST_CollectionExtract(
              ST_MakeValid(
                ST_Transform(
                  ST_SetSRID(ST_GeomFromGeoJSON('${json}'), 3857),
                  5181
                )
              ),
              3
            )
          ),
          updated_at = now()
      WHERE id = ${id}
    `);
    return true;
  } catch (e) {
    console.warn(
      `${LOG} update fail table=${tableName} id=${id}:`,
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

async function geometryFromPoint(
  resolveJijukParcelGeomsByAddresses: (params: {
    items: Array<{ address: string; lon?: number; lat?: number; pnu?: string }>;
  }) => Promise<{
    parcels: Array<{ geometry3857: Record<string, unknown> | null }>;
  }>,
  address: string,
  point: { lon: number; lat: number }
): Promise<Record<string, unknown> | null> {
  try {
    const resolved = await resolveJijukParcelGeomsByAddresses({
      items: [{ address, lon: point.lon, lat: point.lat }],
    });
    const gj = resolved.parcels[0]?.geometry3857;
    return gj && typeof gj === 'object' ? gj : null;
  } catch {
    return null;
  }
}

/**
 * geom 없는 시설 행에 주소→필지, 실패 시 시설명 명칭점→필지 폴리곤 적재.
 * 교량(BR)은 교량 레이어·시군구 제한 명칭검색을 우선한다.
 * 하수처리(ST 등)는 시설명 변형·도로명 일치 명칭검색을 보강한다.
 */
export async function backfillFmsFacilityGeom(params?: {
  force?: boolean;
  limit?: number;
  prefix?: FmsPrefix;
}): Promise<FmsFacilityGeomBackfillResult> {
  const force = params?.force === true;
  const limit = Math.min(Math.max(Number(params?.limit) || 2000, 1), 10000);
  const prefixes: FmsPrefix[] = params?.prefix
    ? [params.prefix]
    : [...FMS_PREFIXES];

  try {
    await ensureFacilityGeomColumns();
  } catch (e) {
    return {
      scanned: 0,
      updated: 0,
      skippedNoLocation: 0,
      skippedNotFound: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const apiKey = getMapConfig().VWORLD_API_KEY?.trim() ?? '';
  const { resolveJijukParcelGeomsByAddresses } = await import('@/service/layerRowService');

  const resolveGeometryFromAddress = async (address: string): Promise<Record<string, unknown> | null> => {
    const trimmed = address.trim();
    if (!trimmed) return null;

    try {
      const direct = await resolveJijukParcelGeomsByAddresses({
        items: [{ address: trimmed }],
      });
      const directGeom = direct.parcels[0]?.geometry3857;
      if (directGeom && typeof directGeom === 'object') return directGeom;
    } catch {
      /* continue with road-address fallback */
    }

    const coord = await fetchCoordFromAddress(trimmed);
    if (!coord) return null;

    try {
      const parcelJibun = await fetchParcelJibunFromCoord(coord.lon, coord.lat);
      if (parcelJibun) {
        const viaJibun = await resolveJijukParcelGeomsByAddresses({
          items: [{ address: parcelJibun }],
        });
        const jibunGeom = viaJibun.parcels[0]?.geometry3857;
        if (jibunGeom && typeof jibunGeom === 'object') return jibunGeom;
      }
    } catch {
      /* fall through to point-in-parcel lookup */
    }

    try {
      const byPoint = await resolveJijukParcelGeomsByAddresses({
        items: [{ address: trimmed, lon: coord.lon, lat: coord.lat }],
      });
      const pointGeom = byPoint.parcels[0]?.geometry3857;
      if (pointGeom && typeof pointGeom === 'object') return pointGeom;
    } catch {
      /* not found */
    }

    return null;
  };

  let scanned = 0;
  let updated = 0;
  let skippedNoLocation = 0;
  let skippedNotFound = 0;
  let remaining = limit;

  for (const prefix of prefixes) {
    if (remaining <= 0) break;
    const tableName = assertFacilityTable(getFmsLayerTableName(prefix, 'facility'));
    const whereGeom = force ? 'TRUE' : 'geom IS NULL';
    const r = await pool.query<{
      id: number;
      facil_no: string | null;
      facil_nm: string | null;
      facil_kind: string | null;
      addr_full: string | null;
      addr_sido: string | null;
      addr_gugun: string | null;
      addr_dong: string | null;
      addr_detail: string | null;
    }>(
      `SELECT id, facil_no, facil_nm, facil_kind, addr_full, addr_sido, addr_gugun, addr_dong, addr_detail
       FROM layer.${tableName}
       WHERE ${whereGeom}
       ORDER BY id DESC
       LIMIT $1`,
      [remaining]
    );

    for (const row of r.rows) {
      scanned += 1;
      remaining -= 1;
      const addr = buildAddrFull(row);
      const facilNm = String(row.facil_nm ?? '').trim();
      const bridge = isBridgeFacility(row.facil_no);
      const sewage = !bridge && isSewageFacility(row);
      const tokens = regionTokens(row);

      let geometry3857: Record<string, unknown> | null = null;

      if (bridge) {
        const hint = addr ? await fetchCoordFromAddress(addr) : null;
        geometry3857 = await resolveGeometryFromBridgeLayer({
          facilNm,
          hint,
        });

        if (!geometry3857 && facilNm && apiKey) {
          const point = await searchBridgePlacePoint(facilNm, tokens, apiKey);
          if (point) {
            geometry3857 = await geometryFromPoint(
              resolveJijukParcelGeomsByAddresses,
              addr || facilNm,
              point
            );
          }
        }

        // 명칭검색 실패 시 — 주소 지오코딩점→필지, 그다음 주소 문자열 매칭 (기존 일반 시설과 동일)
        const addrCandidates = [addr];
        if (addr.includes(',')) {
          const head = addr.split(',')[0]?.trim();
          if (head && head !== addr) addrCandidates.push(head);
        }
        const regionBase = [row.addr_sido, row.addr_gugun, row.addr_dong]
          .map((v) => String(v ?? '').trim())
          .filter(Boolean)
          .join(' ');
        if (regionBase && !addrCandidates.includes(regionBase)) {
          addrCandidates.push(regionBase);
        }
        // 기포새마을교 → …청기면 기포리 처럼 시설명에서 리 추정
        const nameStem = facilNm.match(/^(.+?)(?:새마을)?교$/)?.[1]?.trim();
        if (regionBase && nameStem && nameStem.length >= 2) {
          const riGuess = `${regionBase} ${nameStem}리`;
          if (!addrCandidates.includes(riGuess)) addrCandidates.push(riGuess);
        }
        for (const candidate of addrCandidates) {
          if (geometry3857) break;
          const candidateHint =
            candidate === addr ? hint : await fetchCoordFromAddress(candidate);
          if (candidateHint) {
            geometry3857 = await geometryFromPoint(
              resolveJijukParcelGeomsByAddresses,
              candidate || facilNm,
              candidateHint
            );
          }
          if (!geometry3857 && candidate) {
            geometry3857 = await resolveGeometryFromAddress(candidate);
          }
        }
      } else if (sewage) {
        // 하수처리: 인접 지번 오적재 방지 — 명칭검색을 주소 필지보다 우선
        if (facilNm && apiKey) {
          const point = await searchSewagePlacePoint({
            facilNm,
            addr,
            regionTokens: tokens,
            apiKey,
          });
          if (point) {
            geometry3857 = await geometryFromPoint(
              resolveJijukParcelGeomsByAddresses,
              addr || facilNm,
              point
            );
          }
        }

        if (!geometry3857 && addr) {
          geometry3857 = await resolveGeometryFromAddress(addr);
        }

        if (!geometry3857 && facilNm && apiKey) {
          const point = await searchPlacePoint(facilNm, apiKey, {
            regionTokens: tokens,
          });
          if (point) {
            geometry3857 = await geometryFromPoint(
              resolveJijukParcelGeomsByAddresses,
              addr || facilNm,
              point
            );
          }
        }
      } else {
        if (addr) {
          geometry3857 = await resolveGeometryFromAddress(addr);
        }

        if (!geometry3857 && facilNm && apiKey) {
          const point = await searchPlacePoint(facilNm, apiKey, {
            regionTokens: tokens,
          });
          if (point) {
            geometry3857 = await geometryFromPoint(
              resolveJijukParcelGeomsByAddresses,
              addr || facilNm,
              point
            );
          }
        }
      }

      if (!addr && !facilNm) {
        skippedNoLocation += 1;
        continue;
      }
      if (!geometry3857) {
        // 강제 재적재 시 교량 오적재 잔존 방지
        if (force && bridge) {
          try {
            await pool.query(
              `UPDATE layer.${tableName} SET geom = NULL, updated_at = now() WHERE id = $1`,
              [Number(row.id)]
            );
          } catch {
            /* ignore */
          }
        }
        skippedNotFound += 1;
        continue;
      }

      const ok = await updateFacilityGeom(tableName, Number(row.id), geometry3857);
      if (ok) updated += 1;
      else skippedNotFound += 1;
    }
  }

  console.info(
    `${LOG} scanned=${scanned} updated=${updated} noLoc=${skippedNoLocation} notFound=${skippedNotFound}`
  );

  return { scanned, updated, skippedNoLocation, skippedNotFound };
}
