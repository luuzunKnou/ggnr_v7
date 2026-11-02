/**
 * 관망조회 — layer.wtl_* 조회 전용 (목록·상세·필터 옵션)
 */
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import {
  getWtlNetLayerDef,
  isWtlSupplyZoneOrSubzoneLayerDef,
  wtlNetSaaSql,
  type WtlNetGeomKind,
  type WtlNetLayerDef,
} from '@/app/(pages)/map/_mapContents/wtlAdmin/networkMap/wtlNetworkLayerCatalog';
import {
  buildWtlNetMapSourcesFromRows,
  type WtlNetMapSourceDef,
  type WtlNetMapSourceId,
  type WtlNetMapSourcePayload,
} from '@/app/(pages)/map/_mapContents/wtlAdmin/networkMap/wtlNetworkMapSources';
import type {
  WtlNetworkAxisMode,
  WtlNetworkDipFilterOptions,
  WtlNetworkDipMatrix,
  WtlNetworkDipMatrixParams,
  WtlNetworkDipMatrixRow,
  WtlNetworkFilterMeta,
  WtlNetworkRow,
  WtlNetworkSaaMatrix,
  WtlNetworkSaaMatrixParams,
  WtlNetworkSaaMatrixRow,
  WtlNetworkStatusListFilter,
  WtlNetworkStatusStats,
  WtlNetworkYearMatrixParams,
} from '@/app/(pages)/map/_mapContents/wtlAdmin/networkMap/wtlNetworkTypes';
import { isWtlNetMapGroup } from '@/app/(pages)/map/_mapContents/wtlAdmin/networkMap/wtlNetworkMapSources';
import { exportLayerTableToShp } from '@/service/shpUploadService';

export type {
  WtlNetworkAxisMode,
  WtlNetworkDipFilterOptions,
  WtlNetworkDipMatrix,
  WtlNetworkDipMatrixParams,
  WtlNetworkDipMatrixRow,
  WtlNetworkFilterMeta,
  WtlNetworkRow,
  WtlNetworkSaaMatrix,
  WtlNetworkSaaMatrixParams,
  WtlNetworkSaaMatrixRow,
  WtlNetworkStatusListFilter,
  WtlNetworkStatusStats,
  WtlNetworkYearMatrixParams,
};

/** 현황 «상수시설» 개수 — Shell DISPLAY_GROUPS와 동일 */
const STATUS_FACILITY_LAYERS: readonly { key: string; label: string }[] = [
  { key: 'wtl_gain_ps', label: '취수장' },
  { key: 'wtl_puri_as', label: '정수장' },
  { key: 'wtl_serv_ps', label: '배수지' },
  { key: 'wtl_pres_ps', label: '가압장' },
  { key: 'wtl_rsrv_ps', label: '저수조' },
  { key: 'wtl_fire_ps', label: '소방시설' },
  { key: 'wtl_flow_ps', label: '유량계' },
  { key: 'wtl_prga_ps', label: '수압계' },
];

const TABLES_JSON_PATH = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'tables.json'
);

/** 요청마다 tables.json을 읽어 그룹 후보 생성 */
function loadWtlNetMapSourcesFromTablesJson(): WtlNetMapSourceDef[] {
  try {
    const raw = fs.readFileSync(TABLES_JSON_PATH, 'utf8');
    const rows = JSON.parse(raw) as Array<{
      define_table_group?: string;
      define_table_name?: string;
    }>;
    return buildWtlNetMapSourcesFromRows(rows);
  } catch {
    return [];
  }
}

function resolveWtlNetMapSource(id: string): WtlNetMapSourceDef | undefined {
  const key = String(id ?? '').trim();
  if (!key) return undefined;
  return loadWtlNetMapSourcesFromTablesJson().find((s) => s.id === key);
}

function parseMapSourceIds(raw: unknown): WtlNetMapSourceId[] {
  const all = loadWtlNetMapSourcesFromTablesJson();
  const byId = new Map(all.map((s) => [s.id, s]));
  const fallback = byId.has('상수')
    ? (['상수'] as WtlNetMapSourceId[])
    : all[0]
      ? [all[0].id]
      : [];
  if (!Array.isArray(raw)) return fallback;
  const out: WtlNetMapSourceId[] = [];
  for (const v of raw) {
    const id = String(v ?? '').trim();
    if (byId.has(id) && !out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : fallback;
}

/** tables.json에 나온 테이블명 중 layer 스키마에 실제 존재하는 것 */
async function existingLayerTables(tableNames: readonly string[]): Promise<Set<string>> {
  const names = [
    ...new Set(
      tableNames.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
    ),
  ];
  if (names.length === 0) return new Set();
  const inList = names.map((n) => `'${esc(n)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT lower(table_name) AS t
       FROM information_schema.tables
       WHERE table_schema = 'layer'
         AND lower(table_name) IN (${inList})`
    )
  );
  return new Set((res.rows ?? []).map((r) => String((r as { t?: string }).t ?? '')));
}

type ListParams = {
  layerKeys?: string[];
  /** 관망도 출처(define_table_group) */
  mapSources?: string[];
  /** EPSG:3857 [minX,minY,maxX,maxY] */
  bbox?: number[] | null;
  keyword?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  diameterFrom?: number | null;
  diameterTo?: number | null;
  materials?: string[];
  /** 읍면동 코드(hjd 접두) — areaWkts5181 있으면 공간필터 우선 */
  emdCode?: string | null;
  /** 리 코드(hjd 접두, 우선) */
  riCode?: string | null;
  /** 급수블록 이름 — areaWkts5181 있으면 공간필터 우선 */
  supplyBlock?: string | null;
  /** EPSG:5181 위치 도형(읍면동·리·급수블록). 있으면 ST_Intersects */
  areaWkts5181?: string[] | null;
  limit?: number;
  page?: number;
  pageSize?: number;
};

const FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

function loadDefineFieldRows(tableName: string): Record<string, unknown>[] {
  const safe = String(tableName ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  if (!safe) return [];
  const filePath = path.join(FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** defineLayer 필드 JSON 조회 키 (물리 remap 전 기준 테이블) */
function resolveFieldsTableKeys(
  def: WtlNetLayerDef,
  physicalTable: string
): { fieldsTable: string; fieldsTableFallback: string | null } {
  const base = String(def.table ?? '').trim();
  const defineTable = String(def.defineTable ?? '').trim();
  const physical = String(physicalTable ?? '').trim();
  const primary =
    (base && loadDefineFieldRows(base).length > 0 && base) ||
    (defineTable && loadDefineFieldRows(defineTable).length > 0 && defineTable) ||
    (physical && loadDefineFieldRows(physical).length > 0 && physical) ||
    base ||
    physical;
  const fallbacks = [base, defineTable, physical].filter(
    (t) => t && t.toLowerCase() !== primary.toLowerCase()
  );
  return { fieldsTable: primary, fieldsTableFallback: fallbacks[0] ?? null };
}

function parseJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function yearOf(ymd: unknown): string {
  const s = asStr(ymd).replace(/\D/g, '');
  if (s.length >= 4) return s.slice(0, 4);
  return '';
}

function lengthLabel(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return asStr(v) || '—';
  return `${n} m`;
}

let mopLabelCache: Map<string, string> | null = null;
let mofLabelCache: Map<string, string> | null = null;
let saaLabelCache: Map<string, string> | null = null;

function loadCodeMap(fileName: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const p = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'codes', fileName);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Array<{
      define_code_name?: string;
      define_code_kor_name?: string;
    }>;
    for (const row of raw) {
      const k = String(row.define_code_name ?? '').trim();
      const v = String(row.define_code_kor_name ?? '').trim();
      if (k) map.set(k, v || k);
    }
  } catch {
    /* ignore */
  }
  return map;
}

function mopLabel(code: string): string {
  if (!mopLabelCache) mopLabelCache = loadCodeMap('field_wtl_pipe_lm__mop_cde.json');
  if (!code) return '—';
  return mopLabelCache.get(code) ?? code;
}

function mofLabel(code: string): string {
  if (!mofLabelCache) {
    mofLabelCache = loadCodeMap('field_wtl_fire_ps__MOF_CDE.json');
  }
  if (!code) return '—';
  return mofLabelCache.get(code) ?? code;
}

function saaLabel(code: string): string {
  if (!saaLabelCache) saaLabelCache = loadCodeMap('field_wtl_pipe_lm__saa_cde.json');
  if (!code) return '—';
  return saaLabelCache.get(code) ?? code;
}

const MATERIAL_OTHER = '기타';
const MATERIAL_TOP_N = 5;
/** 상위 재질 집계에서 제외(미분류·기타 코드) */
const MATERIAL_RANK_SKIP = new Set(['MOP000', 'MOP999', '미분류', '기타']);

type MaterialTopBundle = {
  /** UI에 보일 라벨 (빈도순, 기타 제외) */
  labels: string[];
  /** 상위 라벨 → 코드들 */
  labelToCodes: Map<string, string[]>;
  /** 상위 코드 전체 */
  topCodes: Set<string>;
};

let materialTopBundle: MaterialTopBundle | null = null;

function materialLabel(col: string | null | undefined, code: string): string {
  if (!code) return '—';
  if (col === 'mof_cde') return mofLabel(code);
  return mopLabel(code);
}

/** 목록·상세 표시용 — 상위 재질만 이름, 나머지는 기타 */
function materialDisplayLabel(col: string | null | undefined, code: string): string {
  if (!code) return MATERIAL_OTHER;
  if (col === 'mof_cde') return mofLabel(code);
  const full = mopLabel(code);
  if (!materialTopBundle) return full;
  if (materialTopBundle.topCodes.has(code)) return full;
  return MATERIAL_OTHER;
}

function isSkippedMaterialRank(code: string, label: string): boolean {
  return MATERIAL_RANK_SKIP.has(code) || MATERIAL_RANK_SKIP.has(label);
}

/**
 * 관로·급수관·변류시설 mop_cde 빈도 기준 상위 N개 (+ UI용 기타)
 */
async function ensureMaterialTopBundle(): Promise<MaterialTopBundle> {
  if (materialTopBundle) return materialTopBundle;
  if (!mopLabelCache) mopLabelCache = loadCodeMap('field_wtl_pipe_lm__mop_cde.json');

  const tables = ['wtl_pipe_lm', 'wtl_sply_ls', 'wtl_valv_ps'];
  const existing: string[] = [];
  for (const t of tables) {
    if (await tableExists(t)) existing.push(t);
  }

  const countByCode = new Map<string, number>();
  if (existing.length > 0) {
    const unions = existing
      .map(
        (t) =>
          `SELECT mop_cde::text AS code FROM layer."${t.replace(/"/g, '""')}"
           WHERE mop_cde IS NOT NULL AND trim(mop_cde::text) <> ''`
      )
      .join('\nUNION ALL\n');
    const res = await db.execute(
      sql.raw(
        `SELECT code, COUNT(*)::int AS n FROM (${unions}) u GROUP BY code ORDER BY n DESC`
      )
    );
    for (const row of res.rows ?? []) {
      const code = asStr((row as { code?: string }).code);
      const n = Number((row as { n?: number }).n) || 0;
      if (code) countByCode.set(code, n);
    }
  }

  const ranked = [...countByCode.entries()]
    .map(([code, n]) => ({ code, n, label: mopLabel(code) }))
    .filter((r) => !isSkippedMaterialRank(r.code, r.label))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'ko'));

  const top = ranked.slice(0, MATERIAL_TOP_N);
  const labelToCodes = new Map<string, string[]>();
  const topCodes = new Set<string>();
  const labels: string[] = [];
  for (const row of top) {
    topCodes.add(row.code);
    const list = labelToCodes.get(row.label) ?? [];
    list.push(row.code);
    labelToCodes.set(row.label, list);
    if (!labels.includes(row.label)) labels.push(row.label);
  }

  materialTopBundle = { labels, labelToCodes, topCodes };
  return materialTopBundle;
}

/** 재질 필터 선택 → SQL용 (상위 코드 IN / 기타 = 상위 제외) */
function buildMaterialWhere(
  mopCol: string,
  selected: string[] | undefined,
  bundle: MaterialTopBundle
): string | null {
  if (!selected?.length) return null;
  const parts: string[] = [];
  let wantOther = false;
  const codes = new Set<string>();

  for (const raw of selected) {
    const m = raw.trim();
    if (!m) continue;
    if (m === MATERIAL_OTHER) {
      wantOther = true;
      continue;
    }
    const mapped = bundle.labelToCodes.get(m);
    if (mapped?.length) {
      for (const c of mapped) codes.add(c);
    } else {
      codes.add(m);
      for (const [label, cs] of bundle.labelToCodes) {
        if (label === m) for (const c of cs) codes.add(c);
      }
    }
  }

  if (codes.size > 0) {
    const inList = [...codes].map((c) => `'${esc(c)}'`).join(',');
    parts.push(`COALESCE(t."${mopCol}"::text,'') IN (${inList})`);
  }
  if (wantOther) {
    if (bundle.topCodes.size > 0) {
      const topList = [...bundle.topCodes].map((c) => `'${esc(c)}'`).join(',');
      parts.push(
        `(t."${mopCol}" IS NULL OR trim(COALESCE(t."${mopCol}"::text,'')) = '' OR COALESCE(t."${mopCol}"::text,'') NOT IN (${topList}))`
      );
    } else {
      parts.push(`TRUE`);
    }
  }
  if (parts.length === 0) return null;
  return `(${parts.join(' OR ')})`;
}

function parseGeom(raw: unknown): GeoJSON.Geometry | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as GeoJSON.Geometry;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as GeoJSON.Geometry;
    } catch {
      return null;
    }
  }
  return null;
}

const tableExistsCache = new Map<string, boolean>();

async function tableExists(table: string): Promise<boolean> {
  const key = table.toLowerCase();
  if (tableExistsCache.has(key)) return tableExistsCache.get(key)!;
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(key)}' LIMIT 1`
    )
  );
  const ok = (res.rows?.length ?? 0) > 0;
  tableExistsCache.set(key, ok);
  return ok;
}

type ListFilterOpts = {
  bbox?: number[] | null;
  keyword?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  diameterFrom?: number | null;
  diameterTo?: number | null;
  materials?: string[];
  materialBundle?: MaterialTopBundle | null;
  emdCode?: string | null;
  riCode?: string | null;
  supplyBlock?: string | null;
  areaWkts5181?: string[] | null;
};

/** 목록·SHP 내보내기 공통 WHERE (alias t) */
function collectListWheres(def: WtlNetLayerDef, opts: ListFilterOpts): string[] {
  const nameExpr = def.nameExpr ?? `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`;
  const dipCol = def.diameterCol;
  const mopCol = def.materialCol;
  const yearCol = def.yearCol;

  const wheres: string[] = ['t.geom IS NOT NULL'];
  const saa = wtlNetSaaSql(def);
  // alias t 기준 — 목록·통계 공통 (WMS CQL용 saa 절은 테이블 접두 없음)
  if (saa) {
    wheres.push(saa.includes('t.saa_cde') ? saa : saa.split('saa_cde').join('t.saa_cde'));
  }

  if (opts.bbox && opts.bbox.length === 4) {
    const [minX, minY, maxX, maxY] = opts.bbox;
    wheres.push(
      `ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope(${minX},${minY},${maxX},${maxY},3857), ST_SRID(t.geom)))`
    );
  }

  if (dipCol && opts.diameterFrom != null && opts.diameterTo != null) {
    // 빈값·비숫자는 제외하지 않고 통과(필터는 유효 숫자만 비교)
    wheres.push(
      `(
        NULLIF(regexp_replace(COALESCE(t."${dipCol}"::text,''), '[^0-9.]', '', 'g'),'') IS NULL
        OR (
          NULLIF(regexp_replace(COALESCE(t."${dipCol}"::text,''), '[^0-9.]', '', 'g'),'') ~ '^[0-9]+(\\.[0-9]+)?$'
          AND NULLIF(regexp_replace(COALESCE(t."${dipCol}"::text,''), '[^0-9.]', '', 'g'),'')::numeric
            BETWEEN ${Number(opts.diameterFrom)} AND ${Number(opts.diameterTo)}
        )
      )`
    );
  }

  if (yearCol && opts.yearFrom != null && opts.yearTo != null) {
    wheres.push(
      `(
        NULLIF(left(regexp_replace(COALESCE(t."${yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'') IS NULL
        OR (
          NULLIF(left(regexp_replace(COALESCE(t."${yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'') ~ '^[0-9]{4}$'
          AND NULLIF(left(regexp_replace(COALESCE(t."${yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'')::int
            BETWEEN ${Number(opts.yearFrom)} AND ${Number(opts.yearTo)}
        )
      )`
    );
  }

  if (mopCol && opts.materials && opts.materials.length > 0 && opts.materialBundle) {
    const mw = buildMaterialWhere(mopCol, opts.materials, opts.materialBundle);
    if (mw) wheres.push(mw);
  }

  const areaWkts = (opts.areaWkts5181 ?? [])
    .map((w) => String(w ?? '').trim())
    .filter(Boolean);
  const supplyBlockName = String(opts.supplyBlock ?? '').trim();
  const isSupplyBlockTable =
    String(def.table ?? '')
      .trim()
      .toLowerCase() === 'wtl_wtsba_as' ||
    String(def.defineTable ?? '')
      .trim()
      .toLowerCase() === 'wtl_wtsba_as' ||
    String(def.key ?? '')
      .trim()
      .toLowerCase() === 'wtl_wtsba_as';
  if (supplyBlockName && isSupplyBlockTable) {
    // 급수블록 레이어: wbb_nam 속성필터 (경계 접침 ST_Intersects 오탐·공간연산 부하 회피)
    wheres.push(`NULLIF(trim(t.wbb_nam::text),'') = '${esc(supplyBlockName)}'`);
  } else if (areaWkts.length > 0 && isWtlSupplyZoneOrSubzoneLayerDef(def)) {
    // 급수구역·분구: 블록보다 큼 → ST_Within(구역, 블록) 불가.
    // Shell 적재 순서 [행정?][블록?] — 블록 선택 시 마지막 WKT가 블록.
    const geomOf = (wkt: string) =>
      `ST_Transform(ST_GeomFromText('${esc(wkt)}', 5181), ST_SRID(t.geom))`;
    if (supplyBlockName) {
      for (const wkt of areaWkts.slice(0, -1)) {
        wheres.push(`ST_Intersects(t.geom, ${geomOf(wkt)})`);
      }
      const blockWkt = areaWkts[areaWkts.length - 1]!;
      wheres.push(`ST_Contains(t.geom, ${geomOf(blockWkt)})`);
    } else {
      for (const wkt of areaWkts) {
        wheres.push(`ST_Intersects(t.geom, ${geomOf(wkt)})`);
      }
    }
  } else if (areaWkts.length > 0) {
    for (const wkt of areaWkts) {
      // ST_Within: 경계만 맞닿은 도형 제외
      wheres.push(
        `ST_Within(t.geom, ST_Transform(ST_GeomFromText('${esc(wkt)}', 5181), ST_SRID(t.geom)))`
      );
    }
  } else {
    if (def.hasHjd !== false) {
      const hjdPrefix = String(opts.riCode ?? opts.emdCode ?? '')
        .trim()
        .replace(/[^0-9]/g, '');
      if (hjdPrefix) {
        wheres.push(`COALESCE(t.hjd_cde::text,'') LIKE '${esc(hjdPrefix)}%'`);
      }
    }

    const block = String(opts.supplyBlock ?? '').trim();
    if (block) {
      const like = `%${esc(block)}%`;
      wheres.push(
        `(${nameExpr} ILIKE '${like}' OR COALESCE(t.ftr_idn::text,'') ILIKE '${like}')`
      );
    }
  }

  const kw = String(opts.keyword ?? '').trim();
  if (kw) {
    const like = `%${esc(kw)}%`;
    const parts = [
      `${nameExpr} ILIKE '${like}'`,
      `COALESCE(t.ftr_idn::text,'') ILIKE '${like}'`,
    ];
    if (dipCol) parts.push(`COALESCE(t."${dipCol}"::text,'') ILIKE '${like}'`);
    if (mopCol) parts.push(`COALESCE(t."${mopCol}"::text,'') ILIKE '${like}'`);
    wheres.push(`(${parts.join(' OR ')})`);
  }

  return wheres;
}

function buildSelect(
  def: WtlNetLayerDef,
  opts: {
    physicalTable: string;
    sourceId: WtlNetMapSourceId;
    bbox?: number[] | null;
    keyword?: string;
    yearFrom?: number | null;
    yearTo?: number | null;
    diameterFrom?: number | null;
    diameterTo?: number | null;
    materials?: string[];
    materialBundle?: MaterialTopBundle | null;
    emdCode?: string | null;
    riCode?: string | null;
    supplyBlock?: string | null;
    areaWkts5181?: string[] | null;
    withGeom: boolean;
    /** null이면 내부 LIMIT 생략(바깥 페이지 처리) */
    limit?: number | null;
  }
): string | null {
  const tbl = opts.physicalTable.replace(/"/g, '""');
  const nameExpr = def.nameExpr ?? `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`;
  const dipCol = def.diameterCol;
  const mopCol = def.materialCol;
  const lenCol = def.lengthCol;
  const yearCol = def.yearCol;
  const { fieldsTable, fieldsTableFallback } = resolveFieldsTableKeys(def, opts.physicalTable);
  const wheres = collectListWheres(def, opts);

  const diamSel = dipCol ? `t."${dipCol}"::text` : `NULL`;
  const matSel = mopCol ? `t."${mopCol}"::text` : `NULL`;
  const lenSel = lenCol ? `t."${lenCol}"::text` : `NULL`;
  const yearSel = yearCol ? `t."${yearCol}"::text` : `NULL`;
  const hjdSel = def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`;
  const geomSel = opts.withGeom
    ? `ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json`
    : `NULL`;
  const recordSel = `(to_jsonb(t) - 'geom')`;
  const fieldsTableSel = `'${esc(fieldsTable)}'`;
  const fieldsFallbackSel = fieldsTableFallback
    ? `'${esc(fieldsTableFallback)}'`
    : `NULL`;
  const limitSql =
    opts.limit == null
      ? ''
      : `LIMIT ${Math.max(1, Math.min(Number(opts.limit) || 1, 3000))}`;

  return `
    SELECT
      '${esc(opts.sourceId)}' AS "sourceId",
      '${esc(def.key)}' AS "layerKey",
      '${esc(def.geomKind)}' AS "geomKind",
      t.ogc_fid AS "ogcFid",
      (${nameExpr}) AS name,
      ${diamSel} AS diameter,
      ${matSel} AS material,
      ${lenSel} AS length,
      ${yearSel} AS year,
      ${hjdSel} AS hjd,
      ${geomSel} AS geom,
      ${recordSel} AS record,
      ${fieldsTableSel} AS "fieldsTable",
      ${fieldsFallbackSel} AS "fieldsTableFallback"
    FROM layer."${tbl}" t
    WHERE ${wheres.join(' AND ')}
    ${limitSql}
  `;
}

/** SHP용 — 동일 필터로 원본 행 SELECT */
function buildShpExportSql(def: WtlNetLayerDef, physicalTable: string, opts: ListFilterOpts): string {
  const tbl = physicalTable.replace(/"/g, '""');
  const wheres = collectListWheres(def, opts);
  return `SELECT t.* FROM layer."${tbl}" t WHERE ${wheres.join(' AND ')}`;
}

function mapRow(row: Record<string, unknown>, collapseMaterial = true): WtlNetworkRow {
  const layerKey = asStr(row.layerKey);
  const sourceId = asStr(row.sourceId);
  const sourceLabel = sourceId ? resolveWtlNetMapSource(sourceId)?.label ?? sourceId : '';
  const def = getWtlNetLayerDef(layerKey);
  const matRaw = asStr(row.material);
  const materialFull = materialLabel(def?.materialCol, matRaw);
  const material = collapseMaterial
    ? materialDisplayLabel(def?.materialCol, matRaw)
    : materialFull || '—';
  const diameter = asStr(row.diameter) || '—';
  const length = lengthLabel(row.length);
  const year = yearOf(row.year) || '—';
  const name = asStr(row.name) || String(row.ogcFid ?? '');
  const ogcFid = Number(row.ogcFid);
  const id = sourceId ? `${sourceId}:${layerKey}:${ogcFid}` : `${layerKey}:${ogcFid}`;
  const attrs: Array<{ label: string; value: string }> = [];
  if (sourceLabel) attrs.push({ label: '관망도', value: sourceLabel });
  attrs.push(
    { label: '구분', value: layerKey },
    { label: '관리번호', value: name },
    { label: '구경', value: diameter },
    { label: '재질', value: materialFull || '—' },
    { label: '연장', value: length || '—' },
    { label: '설치연도', value: year },
    { label: '행정동코드', value: asStr(row.hjd) || '—' }
  );
  const fieldsTable = asStr(row.fieldsTable) || def?.table || null;
  const fieldsTableFallback = asStr(row.fieldsTableFallback) || null;
  return {
    id,
    layerKey,
    geomKind: (asStr(row.geomKind) as WtlNetGeomKind) || 'point',
    name,
    diameter,
    material: material || '—',
    length: length || '—',
    year,
    status: '—',
    hjd: asStr(row.hjd),
    attrs,
    geom: parseGeom(row.geom),
    record: parseJsonRecord(row.record),
    fieldsTable,
    fieldsTableFallback: fieldsTableFallback || null,
  };
}

function parseNetworkRowId(id: string): {
  sourceId?: WtlNetMapSourceId;
  layerKey: string;
  ogcFid: number;
} | null {
  const raw = String(id ?? '').trim();
  if (!raw.includes(':')) return null;
  const parts = raw.split(':');
  if (parts.length >= 3 && resolveWtlNetMapSource(parts[0]!)) {
    const ogcFid = Number(parts[parts.length - 1]);
    if (!Number.isFinite(ogcFid)) return null;
    return {
      sourceId: parts[0] as WtlNetMapSourceId,
      layerKey: parts.slice(1, -1).join(':'),
      ogcFid,
    };
  }
  const idx = raw.lastIndexOf(':');
  const layerKey = raw.slice(0, idx);
  const ogcFid = Number(raw.slice(idx + 1));
  if (!layerKey || !Number.isFinite(ogcFid)) return null;
  return { layerKey, ogcFid };
}

/**
 * 화면 범위·필터 기준 관망 목록 (조회 전용)
 */
export async function getWtlNetworkList(params: ListParams = {}): Promise<{
  rows: WtlNetworkRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  const empty = { rows: [] as WtlNetworkRow[], total: 0, page: 1, pageSize: 7 };
  if (keys.length === 0) return empty;
  const sources = parseMapSourceIds(params.mapSources)
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  if (sources.length === 0) return empty;

  const usePaging = params.pageSize != null || params.page != null;
  const pageSize = usePaging
    ? Math.max(1, Math.min(Math.floor(params.pageSize ?? 7), 100))
    : Math.max(1, Math.min(Math.floor(params.limit ?? 1500), 5000));
  const page = usePaging ? Math.max(1, Math.floor(params.page ?? 1)) : 1;
  const offset = usePaging ? (page - 1) * pageSize : 0;

  const slotCount = Math.max(keys.length * sources.length, 1);
  const limitPer = usePaging
    ? null
    : Math.max(30, Math.floor((params.limit ?? 1500) / slotCount));
  const materialBundle = await ensureMaterialTopBundle();
  const parts: string[] = [];

  for (const source of sources) {
    for (const key of keys) {
      const def = getWtlNetLayerDef(key);
      if (!def?.table) continue;
      const physicalTable = source.remapTable(def.table);
      if (!(await tableExists(physicalTable))) continue;
      const sel = buildSelect(def, {
        physicalTable,
        sourceId: source.id,
        bbox: params.bbox,
        keyword: params.keyword,
        yearFrom: params.yearFrom,
        yearTo: params.yearTo,
        diameterFrom: params.diameterFrom,
        diameterTo: params.diameterTo,
        materials: params.materials,
        materialBundle,
        emdCode: params.emdCode,
        riCode: params.riCode,
        supplyBlock: params.supplyBlock,
        areaWkts5181: params.areaWkts5181,
        withGeom: false,
        limit: limitPer,
      });
      if (sel) parts.push(sel);
    }
  }

  if (parts.length === 0) return { ...empty, page, pageSize };

  const unionBody = parts.map((p) => `(${p})`).join('\nUNION ALL\n');

  const countRes = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS cnt FROM (${unionBody}) c`)
  );
  const total = Number((countRes.rows?.[0] as { cnt?: number } | undefined)?.cnt ?? 0);

  const res = await db.execute(
    sql.raw(
      usePaging
        ? `SELECT * FROM (${unionBody}) u
           LIMIT ${pageSize} OFFSET ${offset}`
        : `SELECT * FROM (${unionBody}) u
           LIMIT ${pageSize}`
    )
  );

  const rows = (res.rows ?? []).map((r) => mapRow(r as Record<string, unknown>, true));
  return { rows, total, page, pageSize };
}

function materialChoicesFromBundle(bundle: MaterialTopBundle): string[] {
  return [...bundle.labels, MATERIAL_OTHER];
}

/**
 * 1건 상세 (+ geom WGS84)
 */
export async function getWtlNetworkDetail(params: {
  id?: string;
  layerKey?: string;
  ogcFid?: number;
  mapSource?: string;
}): Promise<{ row: WtlNetworkRow | null }> {
  let layerKey = String(params.layerKey ?? '').trim();
  let ogcFid = Number(params.ogcFid);
  let sourceId = String(params.mapSource ?? '').trim() as WtlNetMapSourceId | '';
  const id = String(params.id ?? '').trim();
  if (id) {
    const parsed = parseNetworkRowId(id);
    if (parsed) {
      layerKey = parsed.layerKey;
      ogcFid = parsed.ogcFid;
      if (parsed.sourceId) sourceId = parsed.sourceId;
    }
  }
  if (!layerKey || !Number.isFinite(ogcFid)) return { row: null };

  const def = getWtlNetLayerDef(layerKey);
  if (!def?.table) return { row: null };
  const source =
    resolveWtlNetMapSource(sourceId) ??
    resolveWtlNetMapSource('상수') ??
    loadWtlNetMapSourcesFromTablesJson()[0];
  if (!source) return { row: null };
  const physicalTable = source.remapTable(def.table);
  if (!(await tableExists(physicalTable))) return { row: null };

  const tbl = physicalTable.replace(/"/g, '""');
  const nameExpr = def.nameExpr ?? `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`;
  const dipCol = def.diameterCol;
  const mopCol = def.materialCol;
  const lenCol = def.lengthCol;
  const yearCol = def.yearCol;
  const diamSel = dipCol ? `t."${dipCol}"::text` : `NULL`;
  const matSel = mopCol ? `t."${mopCol}"::text` : `NULL`;
  const lenSel = lenCol ? `t."${lenCol}"::text` : `NULL`;
  const yearSel = yearCol ? `t."${yearCol}"::text` : `NULL`;
  const hjdSel = def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`;
  const { fieldsTable, fieldsTableFallback } = resolveFieldsTableKeys(def, physicalTable);
  const fieldsFallbackSel = fieldsTableFallback
    ? `'${esc(fieldsTableFallback)}'`
    : `NULL`;

  const res = await db.execute(
    sql.raw(
      `SELECT
        '${esc(source.id)}' AS "sourceId",
        '${esc(def.key)}' AS "layerKey",
        '${esc(def.geomKind)}' AS "geomKind",
        t.ogc_fid AS "ogcFid",
        (${nameExpr}) AS name,
        ${diamSel} AS diameter,
        ${matSel} AS material,
        ${lenSel} AS length,
        ${yearSel} AS year,
        ${hjdSel} AS hjd,
        ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geom,
        (to_jsonb(t) - 'geom') AS record,
        '${esc(fieldsTable)}' AS "fieldsTable",
        ${fieldsFallbackSel} AS "fieldsTableFallback"
      FROM layer."${tbl}" t
      WHERE t.ogc_fid = ${ogcFid}
      LIMIT 1`
    )
  );
  const raw = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!raw) return { row: null };
  return { row: mapRow(raw, true) };
}

/**
 * 지도 클릭(3857) 근처 1건
 */
/** 클릭 우선순위 — 점(ps) > 선 > 면. 작을수록 우선 */
function atPointGeomRank(kind: WtlNetGeomKind | string | undefined): number {
  const k = String(kind ?? '').trim().toLowerCase();
  if (k === 'point') return 0;
  if (k === 'line') return 1;
  if (k === 'area' || k === 'polygon') return 2;
  return 1;
}

export async function getWtlNetworkAtPoint(params: {
  x: number;
  y: number;
  layerKeys?: string[];
  mapSources?: string[];
  /** 미터 단위 대략 버퍼 (3857) */
  tolerance?: number;
}): Promise<{ row: WtlNetworkRow | null }> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  const sources = parseMapSourceIds(params.mapSources)
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || keys.length === 0 || sources.length === 0) {
    return { row: null };
  }
  const tol = Math.max(1, Number(params.tolerance) || 8);

  type Hit = { row: WtlNetworkRow; rank: number; dist: number };
  const hits: Hit[] = [];

  for (const source of sources) {
    for (const key of keys) {
      const def = getWtlNetLayerDef(key);
      if (!def?.table) continue;
      const physicalTable = source.remapTable(def.table);
      if (!(await tableExists(physicalTable))) continue;
      const tbl = physicalTable.replace(/"/g, '""');
      const saa = wtlNetSaaSql(def);
      const saaClause = saa ? `AND ${saa}` : '';
      const nameExpr = def.nameExpr ?? `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`;
      const dipCol = def.diameterCol;
      const mopCol = def.materialCol;
      const lenCol = def.lengthCol;
      const yearCol = def.yearCol;
      const diamSel = dipCol ? `t."${dipCol}"::text` : `NULL`;
      const matSel = mopCol ? `t."${mopCol}"::text` : `NULL`;
      const lenSel = lenCol ? `t."${lenCol}"::text` : `NULL`;
      const yearSel = yearCol ? `t."${yearCol}"::text` : `NULL`;
      const hjdSel = def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`;
      const { fieldsTable, fieldsTableFallback } = resolveFieldsTableKeys(def, physicalTable);
      const fieldsFallbackSel = fieldsTableFallback
        ? `'${esc(fieldsTableFallback)}'`
        : `NULL`;

      const res = await db.execute(
        sql.raw(
          `SELECT
            '${esc(source.id)}' AS "sourceId",
            '${esc(def.key)}' AS "layerKey",
            '${esc(def.geomKind)}' AS "geomKind",
            t.ogc_fid AS "ogcFid",
            (${nameExpr}) AS name,
            ${diamSel} AS diameter,
            ${matSel} AS material,
            ${lenSel} AS length,
            ${yearSel} AS year,
            ${hjdSel} AS hjd,
            ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geom,
            (to_jsonb(t) - 'geom') AS record,
            '${esc(fieldsTable)}' AS "fieldsTable",
            ${fieldsFallbackSel} AS "fieldsTableFallback",
            ST_Distance(
              ST_Transform(t.geom, 3857),
              ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857)
            ) AS dist
          FROM layer."${tbl}" t
          WHERE t.geom IS NOT NULL
            ${saaClause}
            AND ST_DWithin(
              ST_Transform(t.geom, 3857),
              ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857),
              ${tol}
            )
          ORDER BY dist
          LIMIT 1`
        )
      );
      const raw = res.rows?.[0] as Record<string, unknown> | undefined;
      if (!raw) continue;
      const dist = Number(raw.dist);
      hits.push({
        row: mapRow(raw, true),
        rank: atPointGeomRank(def.geomKind),
        dist: Number.isFinite(dist) ? dist : Number.POSITIVE_INFINITY,
      });
    }
  }

  if (hits.length === 0) return { row: null };
  hits.sort((a, b) => a.rank - b.rank || a.dist - b.dist);
  return { row: hits[0]!.row };
}

/** layer 스키마에서 wtl_wtsba_as 계열 테이블명 */
async function discoverWtlWtsbaTables(): Promise<string[]> {
  const disco = await db.execute(
    sql.raw(
      `SELECT lower(table_name) AS t
       FROM information_schema.tables
       WHERE table_schema = 'layer'
         AND lower(table_name) LIKE '%wtl_wtsba_as'`
    )
  );
  return [
    ...new Set(
      (disco.rows ?? [])
        .map((r) => String((r as { t?: string }).t ?? '').trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * 급수블록 도형 WKT(EPSG:5181) — 동일 이름/부호 면 합침
 */
export async function getWtlSupplyBlockGeometry(params: {
  block?: string;
} = {}): Promise<{ wkt: string | null; error?: string }> {
  const block = String(params.block ?? '').trim();
  if (!block) return { wkt: null, error: 'block required' };
  const tables = await discoverWtlWtsbaTables();
  if (tables.length === 0) return { wkt: null, error: 'wtl_wtsba_as not found' };

  const safeBlock = esc(block);
  for (const tbl of tables) {
    const hasNam = await tableHasColumn(tbl, 'wbb_nam');
    const hasCde = await tableHasColumn(tbl, 'wbb_cde');
    if (!hasNam && !hasCde) continue;
    const whereParts: string[] = [];
    if (hasNam) whereParts.push(`NULLIF(trim(wbb_nam::text),'') = '${safeBlock}'`);
    if (hasCde) whereParts.push(`NULLIF(trim(wbb_cde::text),'') = '${safeBlock}'`);
    const safe = tbl.replace(/"/g, '""');
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT ST_AsText(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 5181)) AS wkt
           FROM layer."${safe}"
           WHERE geom IS NOT NULL AND (${whereParts.join(' OR ')})`
        )
      );
      const wkt = asStr((res.rows?.[0] as { wkt?: unknown } | undefined)?.wkt);
      if (wkt) return { wkt };
    } catch {
      /* try next table */
    }
  }
  return { wkt: null, error: 'supply block geometry not found' };
}

/**
 * 급수블록 검색 옵션 — layer.wtl_wtsba_as(및 *_wtl_wtsba_as) 블록명 목록
 */
export async function listWtlSupplyBlockOptions(): Promise<{
  options: { value: string; label: string }[];
}> {
  const tables = await discoverWtlWtsbaTables();
  if (tables.length === 0) return { options: [] };

  const unions: string[] = [];
  for (const tbl of tables) {
    const hasNam = await tableHasColumn(tbl, 'wbb_nam');
    const hasCde = await tableHasColumn(tbl, 'wbb_cde');
    if (!hasNam && !hasCde) continue;
    const labelExpr = hasNam
      ? hasCde
        ? `COALESCE(NULLIF(trim(wbb_nam::text),''), NULLIF(trim(wbb_cde::text),''))`
        : `NULLIF(trim(wbb_nam::text),'')`
      : `NULLIF(trim(wbb_cde::text),'')`;
    const safe = tbl.replace(/"/g, '""');
    unions.push(
      `SELECT ${labelExpr} AS label FROM layer."${safe}" WHERE ${labelExpr} IS NOT NULL`
    );
  }
  if (unions.length === 0) return { options: [] };

  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT label FROM (${unions.join(' UNION ALL ')}) u
       WHERE label IS NOT NULL AND trim(label) <> ''
       ORDER BY label`
    )
  );
  const options: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const row of res.rows ?? []) {
    const label = asStr((row as { label?: unknown }).label);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push({ value: label, label });
  }
  return { options };
}

/**
 * tables.json 그룹 후보를 읽고, define_table_name이 layer에 실제로 있는 그룹만 반환
 */
export async function listWtlNetMapSources(): Promise<{
  sources: WtlNetMapSourcePayload[];
}> {
  const candidates = loadWtlNetMapSourcesFromTablesJson();
  const allNames = candidates.flatMap((s) => [...s.tables]);
  const existing = await existingLayerTables(allNames);

  const sources: WtlNetMapSourcePayload[] = [];
  for (const source of candidates) {
    const liveTables = source.tables.filter((t) => existing.has(t.toLowerCase()));
    if (liveTables.length === 0) continue;
    sources.push({
      id: source.id,
      label: source.label,
      tables: liveTables,
    });
  }
  return { sources };
}

type TablesJsonMetaRow = {
  define_table_name?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
};

function loadTablesJsonMetaByName(): Map<
  string,
  { schema: 'layer' | 'public_layer'; parentsLayer: string | null }
> {
  const map = new Map<
    string,
    { schema: 'layer' | 'public_layer'; parentsLayer: string | null }
  >();
  try {
    const raw = fs.readFileSync(TABLES_JSON_PATH, 'utf8');
    const rows = JSON.parse(raw) as TablesJsonMetaRow[];
    for (const row of rows) {
      const name = String(row.define_table_name ?? '')
        .trim()
        .toLowerCase();
      if (!name) continue;
      const schema =
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() === 'public_layer'
          ? ('public_layer' as const)
          : ('layer' as const);
      const parents = String(row.define_table_parents_layer ?? '')
        .trim()
        .toLowerCase();
      map.set(name, { schema, parentsLayer: parents || null });
    }
  } catch {
    /* empty */
  }
  return map;
}

/** layer·public_layer 실테이블 존재 여부 (소문자 테이블명 Set) */
async function existingTablesInSchema(
  schema: 'layer' | 'public_layer',
  tableNames: readonly string[]
): Promise<Set<string>> {
  const names = [
    ...new Set(
      tableNames.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
    ),
  ];
  if (names.length === 0) return new Set();
  const inList = names.map((n) => `'${esc(n)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT lower(table_name) AS t
       FROM information_schema.tables
       WHERE table_schema = '${schema}'
         AND lower(table_name) IN (${inList})`
    )
  );
  return new Set((res.rows ?? []).map((r) => String((r as { t?: string }).t ?? '')));
}

/**
 * 관망조회 탭 레이어 — 선택 출처 기준 DB에 실제 있는 키만.
 * (saa 분할 키는 부모 물리 테이블 존재 시 가능)
 */
export async function listWtlNetworkAvailableLayerKeys(params: {
  mapSources?: string[];
  layerKeys?: string[];
} = {}): Promise<{ availableKeys: string[] }> {
  const keys = (params.layerKeys ?? [])
    .map((k) => String(k ?? '').trim())
    .filter(Boolean);
  if (keys.length === 0) return { availableKeys: [] };

  const sourceIds = parseMapSourceIds(params.mapSources);
  const sources = sourceIds
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  const metaByName = loadTablesJsonMetaByName();

  const layerCandidates = new Set<string>();
  const publicCandidates = new Set<string>();

  type KeyPlan = {
    key: string;
    layerNames: string[];
    publicNames: string[];
  };
  const plans: KeyPlan[] = [];

  for (const key of keys) {
    const def = getWtlNetLayerDef(key);
    const meta = metaByName.get(key.toLowerCase());
    const layerNames = new Set<string>();
    const publicNames = new Set<string>();

    const add = (name: string | null | undefined, schemaHint?: 'layer' | 'public_layer') => {
      const n = String(name ?? '')
        .trim()
        .toLowerCase();
      if (!n) return;
      const schema = schemaHint ?? metaByName.get(n)?.schema ?? 'layer';
      if (schema === 'public_layer') publicNames.add(n);
      else layerNames.add(n);
    };

    if (def?.table && sources.length > 0) {
      for (const source of sources) {
        add(source.remapTable(def.table), 'layer');
        if (def.defineTable) add(source.remapTable(def.defineTable), 'layer');
        add(source.remapTable(key), 'layer');
      }
    }

    add(def?.table);
    add(def?.defineTable);
    add(key);
    if (meta?.parentsLayer) add(meta.parentsLayer, meta.schema);
    if (meta) add(key, meta.schema);

    for (const n of layerNames) layerCandidates.add(n);
    for (const n of publicNames) publicCandidates.add(n);
    plans.push({ key, layerNames: [...layerNames], publicNames: [...publicNames] });
  }

  const [layerExist, publicExist] = await Promise.all([
    existingTablesInSchema('layer', [...layerCandidates]),
    existingTablesInSchema('public_layer', [...publicCandidates]),
  ]);

  const availableKeys: string[] = [];
  for (const plan of plans) {
    const ok =
      plan.layerNames.some((n) => layerExist.has(n)) ||
      plan.publicNames.some((n) => publicExist.has(n));
    if (ok) availableKeys.push(plan.key);
  }
  return { availableKeys };
}

/** 가압장·정수장 상세 하단 연관 탭 후보 */
export type WtlNetworkRelatedChildTab = {
  /** WMS·조회용 물리 테이블명 */
  table: string;
  /** defineLayer 필드용 논리 테이블명 */
  defineTable: string;
  label: string;
};

const RELATED_CHILD_BY_PARENT: Record<
  string,
  Array<{ defineTable: string; label: string }>
> = {
  wtl_pres_ps: [
    { defineTable: 'wtl_pres_pm_ps', label: '펌프현황' },
    { defineTable: 'wtl_pres_hj_ps', label: '흡수정 현황' },
  ],
  wtl_puri_as: [{ defineTable: 'wtl_puri_dt_ps', label: '펌프 현황' }],
};

/** layer 스키마 — 본명 또는 `*_본명` 접두 테이블 */
async function resolveRelatedChildPhysicalTable(
  baseTable: string
): Promise<string | null> {
  const key = String(baseTable ?? '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (await tableExists(key)) return key;
  const res = await db.execute(
    sql.raw(
      `SELECT lower(table_name) AS t
       FROM information_schema.tables
       WHERE table_schema = 'layer'
         AND (
           lower(table_name) = '${esc(key)}'
           OR right(lower(table_name), ${key.length + 1}) = '_${esc(key)}'
         )
       ORDER BY length(table_name) ASC
       LIMIT 1`
    )
  );
  const t = String((res.rows?.[0] as { t?: string } | undefined)?.t ?? '').trim();
  return t || null;
}

async function resolveRelatedFtrIdnColumn(
  physicalTable: string
): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name AS c
       FROM information_schema.columns
       WHERE table_schema = 'layer'
         AND lower(table_name) = '${esc(physicalTable.toLowerCase())}'
         AND lower(column_name) = 'ftr_idn'
       LIMIT 1`
    )
  );
  const c = String((res.rows?.[0] as { c?: string } | undefined)?.c ?? '').trim();
  return c || null;
}

/**
 * 부모 시설 상세 — DB에 실제 있는 자식 테이블만 탭으로.
 * table 은 WMS·조회용 물리 테이블명.
 */
export async function listWtlNetworkRelatedChildTables(params: {
  parentLayerKey?: string;
} = {}): Promise<{ tabs: WtlNetworkRelatedChildTab[] }> {
  const key = String(params.parentLayerKey ?? '')
    .trim()
    .toLowerCase();
  const candidates = RELATED_CHILD_BY_PARENT[key] ?? [];
  if (candidates.length === 0) return { tabs: [] };
  const tabs: WtlNetworkRelatedChildTab[] = [];
  for (const c of candidates) {
    const physical = await resolveRelatedChildPhysicalTable(c.defineTable);
    if (physical) {
      tabs.push({
        table: physical,
        defineTable: c.defineTable,
        label: c.label,
      });
    }
  }
  return { tabs };
}

export type WtlNetworkRelatedChildRow = {
  ogcFid: number | null;
  record: Record<string, unknown>;
  /** EPSG:4326 GeoJSON geometry (목록 클릭·지도 이동용) */
  geom: unknown | null;
};

/**
 * 부모 ftr_idn 과 같은 값의 자식 현황 행 목록.
 */
export async function listWtlNetworkRelatedChildRows(params: {
  table?: string;
  defineTable?: string;
  ftrIdn?: string;
  limit?: number;
} = {}): Promise<{
  rows: WtlNetworkRelatedChildRow[];
  total: number;
  table: string;
  defineTable: string;
}> {
  const physical = String(params.table ?? '')
    .trim()
    .toLowerCase();
  const defineTable =
    String(params.defineTable ?? '').trim().toLowerCase() || physical;
  const ftrIdn = String(params.ftrIdn ?? '').trim();
  const limit = Math.max(1, Math.min(Number(params.limit) || 200, 500));
  if (!physical || !ftrIdn) {
    return { rows: [], total: 0, table: physical, defineTable };
  }
  const resolved =
    (await resolveRelatedChildPhysicalTable(physical)) ??
    (await resolveRelatedChildPhysicalTable(defineTable));
  if (!resolved) {
    return { rows: [], total: 0, table: physical, defineTable };
  }
  const ftrCol = await resolveRelatedFtrIdnColumn(resolved);
  if (!ftrCol) {
    return { rows: [], total: 0, table: resolved, defineTable };
  }
  const tbl = resolved.replace(/"/g, '""');
  const col = ftrCol.replace(/"/g, '""');
  const hasOgc = await tableHasColumn(resolved, 'ogc_fid');
  const hasGeom = await tableHasColumn(resolved, 'geom');
  const countRes = await db.execute(
    sql.raw(
      `SELECT count(*)::int AS c
       FROM layer."${tbl}" t
       WHERE lower(trim(t."${col}"::text)) = lower(trim('${esc(ftrIdn)}'))`
    )
  );
  const total = Number((countRes.rows?.[0] as { c?: number } | undefined)?.c ?? 0);
  const ogcSel = hasOgc ? `t.ogc_fid` : `NULL`;
  const geomSel = hasGeom
    ? `ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json`
    : `NULL`;
  const res = await db.execute(
    sql.raw(
      `SELECT
         ${ogcSel} AS "ogcFid",
         (to_jsonb(t) - 'geom') AS record,
         ${geomSel} AS geom
       FROM layer."${tbl}" t
       WHERE lower(trim(t."${col}"::text)) = lower(trim('${esc(ftrIdn)}'))
       ORDER BY ${hasOgc ? 't.ogc_fid' : '1'}
       LIMIT ${limit}`
    )
  );
  const rows: WtlNetworkRelatedChildRow[] = (res.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const ogc = Number(r.ogcFid);
    return {
      ogcFid: Number.isFinite(ogc) ? ogc : null,
      record: parseJsonRecord(r.record) ?? {},
      geom: parseGeom(r.geom),
    };
  });
  return { rows, total, table: resolved, defineTable };
}

function diameterStatLabel(raw: unknown): string {
  const s = asStr(raw);
  if (!s) return '미상';
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  if (Number.isFinite(n) && n > 0) return `${n}㎜`;
  return s;
}

const MATERIAL_SORT_LAST = 1e9;

/** mop_cde 숫자 순 (MOP000·미분류·기타는 뒤) */
function mopCdeSortKey(code: string, label: string): number {
  if (!code || label === '기타' || label === '미상' || code === 'MOP999') {
    return MATERIAL_SORT_LAST;
  }
  if (label === '미분류' || code === 'MOP000') return MATERIAL_SORT_LAST - 1;
  const n = Number(code.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : MATERIAL_SORT_LAST - 1;
}

async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const t = table.toLowerCase().replace(/"/g, '""');
  const c = column.toLowerCase().replace(/"/g, '""');
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'layer'
         AND lower(table_name) = '${esc(t)}'
         AND lower(column_name) = '${esc(c)}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

/** MapStatisticsController — byc_len 없으면 pip_len */
async function resolvePipeLengthCol(table: string): Promise<string> {
  if (await tableHasColumn(table, 'byc_len')) return 'byc_len';
  if (await tableHasColumn(table, 'pip_len')) return 'pip_len';
  return 'byc_len';
}

async function resolvePipeDiameterCol(table: string): Promise<string> {
  if (await tableHasColumn(table, 'std_dip')) return 'std_dip';
  if (await tableHasColumn(table, 'pip_dip')) return 'pip_dip';
  return 'std_dip';
}

type StatusPipeSource = {
  physicalTable: string;
  def: WtlNetLayerDef;
};

/**
 * 켜진 레이어 키 → 관로(연장) 집계 소스.
 * 상수관로(기타)·배수·송수 등은 동일 물리 테이블이라도 saa WHERE 가 다름.
 * pipeTablesModal: 모달 «관로 종류»(wtl_pipe_lm|wtl_sply_ls). null=제한 없음, []=없음.
 */
async function resolveStatusPipeSources(
  mapSources: string[] | undefined,
  layerKeys: string[] | null | undefined,
  pipeTablesModal?: string[] | null
): Promise<StatusPipeSource[]> {
  if (layerKeys !== null && layerKeys !== undefined && layerKeys.length === 0) {
    return [];
  }
  if (pipeTablesModal !== null && pipeTablesModal !== undefined && pipeTablesModal.length === 0) {
    return [];
  }

  const sourceIds = parseMapSourceIds(mapSources);
  const sourceDefs = sourceIds
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  if (sourceDefs.length === 0) return [];

  const modalLogical =
    pipeTablesModal == null
      ? null
      : new Set(
          pipeTablesModal
            .map((t) => String(t ?? '').trim().toLowerCase())
            .filter(Boolean)
        );

  /** 미전달 시 관로 분할 키 전부(기타·배수·송수·급수) */
  const fallbackPipeKeys = [
    'wtl_pipe_lm_etc',
    'wtl_pipe_lm_saa004',
    'wtl_pipe_lm_saa003',
    'wtl_sply_ls',
  ];
  const keys =
    layerKeys == null
      ? fallbackPipeKeys
      : layerKeys.map((k) => String(k ?? '').trim()).filter(Boolean);

  const out: StatusPipeSource[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const def = getWtlNetLayerDef(key);
    if (!def?.table) continue;
    // 연장 통계는 관로(선)만. 급수관·상수관로 분할 포함
    if (def.geomKind !== 'line' || !def.lengthCol) continue;

    const logicalTable = String(def.table).trim().toLowerCase();
    if (modalLogical && !modalLogical.has(logicalTable)) continue;

    for (const src of sourceDefs) {
      const phys = String(src.remapTable(def.table) ?? def.table)
        .trim()
        .toLowerCase();
      if (!phys) continue;
      if (!(await tableExists(phys))) continue;
      const dedupe = `${phys}\0${def.key}\0${String(def.saa ?? '')}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        physicalTable: phys,
        def: {
          ...def,
          table: phys,
          // 물리 컬럼명 확정(std_dip|pip_dip 등). saa 분할 조건은 def.saa 유지
          diameterCol: await resolvePipeDiameterCol(phys),
          lengthCol: await resolvePipeLengthCol(phys),
          materialCol: def.materialCol
            ? (await tableHasColumn(phys, def.materialCol))
              ? def.materialCol
              : null
            : null,
          yearCol: def.yearCol
            ? (await tableHasColumn(phys, def.yearCol))
              ? def.yearCol
              : null
            : null,
          hasHjd: await tableHasColumn(phys, 'hjd_cde'),
        },
      });
    }
  }
  return out;
}

function parseStatusListFilter(raw: unknown): ListFilterOpts & {
  layerKeys: string[] | null;
} {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as WtlNetworkStatusListFilter)
      : ({} as WtlNetworkStatusListFilter);
  const bbox = Array.isArray(src.bbox) && src.bbox.length === 4
    ? src.bbox.map(Number)
    : null;
  const materials = Array.isArray(src.materials)
    ? src.materials.map((m) => String(m ?? '').trim()).filter(Boolean)
    : [];
  const areaWkts5181 = Array.isArray(src.areaWkts5181)
    ? src.areaWkts5181.map((w) => String(w ?? '').trim()).filter(Boolean)
    : [];
  const layerKeys = Array.isArray(src.layerKeys)
    ? src.layerKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
    : null;
  return {
    layerKeys,
    bbox: bbox && bbox.every((n) => Number.isFinite(n)) ? bbox : null,
    keyword: String(src.keyword ?? '').trim(),
    yearFrom: src.yearFrom != null && Number.isFinite(Number(src.yearFrom)) ? Number(src.yearFrom) : null,
    yearTo: src.yearTo != null && Number.isFinite(Number(src.yearTo)) ? Number(src.yearTo) : null,
    diameterFrom:
      src.diameterFrom != null && Number.isFinite(Number(src.diameterFrom))
        ? Number(src.diameterFrom)
        : null,
    diameterTo:
      src.diameterTo != null && Number.isFinite(Number(src.diameterTo))
        ? Number(src.diameterTo)
        : null,
    materials,
    emdCode: String(src.emdCode ?? '').trim() || null,
    riCode: String(src.riCode ?? '').trim() || null,
    supplyBlock: String(src.supplyBlock ?? '').trim() || null,
    areaWkts5181: areaWkts5181.length > 0 ? areaWkts5181 : null,
  };
}

async function resolveListFilterOpts(
  listFilter: unknown
): Promise<ListFilterOpts & { layerKeys: string[] | null }> {
  const opts = parseStatusListFilter(listFilter);
  if (opts.materials && opts.materials.length > 0) {
    opts.materialBundle = await ensureMaterialTopBundle();
  }
  return opts;
}

function emptyStatusStats(): WtlNetworkStatusStats {
  return {
    byDiameter: [],
    byMaterial: [],
    byYear: [],
    bySaa: [],
    facilityCounts: [],
  };
}

/**
 * 현황 집계 — 켜진 레이어(상수관로 기타 등 saa 조건) + 리스트 검색·화면 범위.
 */
export async function getWtlNetworkStatusStats(params: {
  mapSources?: string[];
  listFilter?: WtlNetworkStatusListFilter | null;
} = {}): Promise<WtlNetworkStatusStats> {
  const selectedSourceIds = parseMapSourceIds(params.mapSources);
  const selectedSources = selectedSourceIds
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));

  const listOpts = await resolveListFilterOpts(params.listFilter);
  /** «화면에 보이는 시설만» 인데 bbox 미수신 → 목록과 동일하게 bbox 조건 없이 두지 않고 대기(빈 결과) */
  if (params.listFilter?.onlyInView === true && listOpts.bbox == null) {
    // 클라이언트에서 bbox 도착 전 호출. 항목은 UI가 유지하고 값은 비움
    const enabledKeySet =
      listOpts.layerKeys == null
        ? null
        : new Set(listOpts.layerKeys.map((k) => k.toLowerCase()));
    return {
      ...emptyStatusStats(),
      facilityCounts: STATUS_FACILITY_LAYERS.filter(
        (fac) => !enabledKeySet || enabledKeySet.has(fac.key.toLowerCase())
      ).map((fac) => ({ label: fac.label, count: 0 })),
    };
  }

  const pipeSources = await resolveStatusPipeSources(
    params.mapSources,
    listOpts.layerKeys,
    null
  );
  const dipMap = new Map<string, number>();
  const mopMap = new Map<string, { label: string; meters: number }>();
  const yearMap = new Map<string, number>();
  const saaMap = new Map<string, { label: string; meters: number }>();

  for (const { physicalTable: base, def } of pipeSources) {
    const lenCol = String(def.lengthCol ?? (await resolvePipeLengthCol(base))).replace(
      /"/g,
      '""'
    );
    const dipCol = String(
      def.diameterCol ?? (await resolvePipeDiameterCol(base))
    ).replace(/"/g, '""');
    const tbl = base.replace(/"/g, '""');
    const sumExpr = `SUM(COALESCE(NULLIF(TRIM(t."${lenCol}"::text), '')::numeric, 0))`;
    const hasSaa = await tableHasColumn(base, 'saa_cde');
    const whereSql = collectListWheres(def, listOpts).join(' AND ');

    try {
      const dipRes = await db.execute(
        sql.raw(
          `SELECT ${sumExpr} AS byc_len, t."${dipCol}" AS code
           FROM layer."${tbl}" t
           WHERE ${whereSql} AND t."${dipCol}" IS NOT NULL
           GROUP BY t."${dipCol}"`
        )
      );
      for (const row of dipRes.rows ?? []) {
        const r = row as { code?: unknown; byc_len?: number };
        const meters = Number(r.byc_len) || 0;
        const label = diameterStatLabel(r.code);
        dipMap.set(label, (dipMap.get(label) ?? 0) + meters);
      }
    } catch (e) {
      console.error('[getWtlNetworkStatusStats] diameter', def.key, base, e);
    }

    try {
      const mopRes = await db.execute(
        sql.raw(
          `SELECT ${sumExpr} AS byc_len, t.mop_cde AS code
           FROM layer."${tbl}" t
           WHERE ${whereSql} AND t.mop_cde IS NOT NULL
           GROUP BY t.mop_cde
           ORDER BY t.mop_cde`
        )
      );
      for (const row of mopRes.rows ?? []) {
        const r = row as { code?: unknown; byc_len?: number };
        const meters = Number(r.byc_len) || 0;
        const code = asStr(r.code);
        if (!code) continue;
        const label = mopLabel(code);
        const display = label === '—' ? code : label;
        const prev = mopMap.get(code);
        mopMap.set(code, {
          label: display,
          meters: (prev?.meters ?? 0) + meters,
        });
      }
    } catch (e) {
      console.error('[getWtlNetworkStatusStats] material', def.key, base, e);
    }

    try {
      // MapStatisticsController: SUBSTRING(ist_ymd,0,5)::INTEGER
      const yearRes = await db.execute(
        sql.raw(
          `SELECT ${sumExpr} AS byc_len,
                  NULLIF(SUBSTRING(TRIM(t.ist_ymd::text), 1, 4), '') AS code
           FROM layer."${tbl}" t
           WHERE ${whereSql} AND t.ist_ymd IS NOT NULL AND TRIM(t.ist_ymd::text) <> ''
           GROUP BY 2`
        )
      );
      for (const row of yearRes.rows ?? []) {
        const r = row as { code?: unknown; byc_len?: number };
        const meters = Number(r.byc_len) || 0;
        const y = asStr(r.code);
        if (!y || !/^\d{4}$/.test(y)) continue;
        yearMap.set(y, (yearMap.get(y) ?? 0) + meters);
      }
    } catch (e) {
      console.error('[getWtlNetworkStatusStats] year', def.key, base, e);
    }

    if (hasSaa) {
      try {
        const saaRes = await db.execute(
          sql.raw(
            `SELECT ${sumExpr} AS byc_len,
                    CASE WHEN t.saa_cde IS NULL OR TRIM(t.saa_cde::text) = '' THEN '미분류'
                         ELSE TRIM(t.saa_cde::text) END AS code
             FROM layer."${tbl}" t
             WHERE ${whereSql}
             GROUP BY 2`
          )
        );
        for (const row of saaRes.rows ?? []) {
          const r = row as { code?: unknown; byc_len?: number };
          const meters = Number(r.byc_len) || 0;
          const code = asStr(r.code) || '미분류';
          const kor = code === '미분류' ? '미분류' : saaLabel(code);
          const display = kor === '—' ? code : kor;
          const prev = saaMap.get(code);
          saaMap.set(code, {
            label: display,
            meters: (prev?.meters ?? 0) + meters,
          });
        }
      } catch (e) {
        console.error('[getWtlNetworkStatusStats] saa', def.key, base, e);
      }
    }
  }

  const byDiameter = [...dipMap.entries()].map(([label, meters]) => {
    const n = Number(String(label).replace(/[^\d.]/g, ''));
    return {
      label,
      meters,
      sort: Number.isFinite(n) ? n : MATERIAL_SORT_LAST,
    };
  });
  const byMaterial = [...mopMap.entries()].map(([code, row]) => ({
    label: row.label,
    meters: row.meters,
    sort: mopCdeSortKey(code, row.label),
  }));
  const byYear = [...yearMap.entries()].map(([label, meters]) => ({
    label,
    meters,
    sort: Number(label) || 0,
  }));
  const bySaa = [...saaMap.entries()].map(([code, row]) => ({
    label: row.label,
    meters: row.meters,
    code,
  }));

  const enabledKeySet =
    listOpts.layerKeys == null ? null : new Set(listOpts.layerKeys.map((k) => k.toLowerCase()));
  const facilityCounts: WtlNetworkStatusStats['facilityCounts'] = [];
  for (const fac of STATUS_FACILITY_LAYERS) {
    if (enabledKeySet && !enabledKeySet.has(fac.key.toLowerCase())) continue;
    const def = getWtlNetLayerDef(fac.key);
    let count = 0;
    if (def?.table) {
      const seen = new Set<string>();
      for (const source of selectedSources) {
        const physicalTable = source.remapTable(def.table).toLowerCase();
        if (seen.has(physicalTable)) continue;
        seen.add(physicalTable);
        if (!(await tableExists(physicalTable))) continue;
        const tbl = physicalTable.replace(/"/g, '""');
        const whereSql = collectListWheres(def, listOpts).join(' AND ');
        try {
          const res = await db.execute(
            sql.raw(
              `SELECT COUNT(*)::int AS n FROM layer."${tbl}" t WHERE ${whereSql}`
            )
          );
          count += Number((res.rows?.[0] as { n?: number } | undefined)?.n) || 0;
        } catch {
          /* ignore */
        }
      }
    }
    facilityCounts.push({ label: fac.label, count });
  }

  const roundMeters = (m: number) => Math.round(m * 1000) / 1000;

  return {
    byDiameter: byDiameter
      .map((r) => ({ label: r.label, meters: roundMeters(r.meters) }))
      .sort((a, b) => {
        const na = Number(a.label.replace(/[^\d.]/g, ''));
        const nb = Number(b.label.replace(/[^\d.]/g, ''));
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return a.label.localeCompare(b.label, 'ko');
      }),
    byMaterial: byMaterial
      .map((r) => ({
        label: r.label,
        meters: roundMeters(r.meters),
        sort: r.sort,
      }))
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'ko'))
      .map(({ label, meters }) => ({ label, meters })),
    byYear: byYear
      .map((r) => ({ label: r.label, meters: roundMeters(r.meters), sort: r.sort }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ label, meters }) => ({ label, meters })),
    bySaa: bySaa
      .map((r) => ({
        label: r.label,
        meters: roundMeters(r.meters),
        code: r.code,
      }))
      .sort((a, b) => compareSaaCde(a.code, b.code))
      .map(({ label, meters }) => ({ label, meters })),
    facilityCounts,
  };
}

/** 관재질 그룹 → 내용년수 (경년관 판정) */
const MOP_USEFUL_LIFE: Record<string, number> = {
  '에나멜코팅 도복장강관': 30,
  '액상에폭시 도복장강관': 30,
  주철관: 30,
  덕타일주철관: 30,
  PVC관: 20,
  내충격수도관: 20,
  PE관: 20,
  흄관: 30,
  기타: 30,
};

const CAST_IRON_MOPS = new Set(['MOP010', 'MOP015', 'MOP027', 'MOP100', 'MOP898']);

function categoryOfMop(mopKey: string): string {
  if (!mopKey || mopKey === '미분류') return '기타';
  const m = mopKey.trim().toUpperCase();
  const inMops = (...codes: string[]) => codes.some((c) => c === m);
  if (inMops('MOP031', 'MOP831')) return '액상에폭시 도복장강관';
  if (
    inMops(
      'MOP002',
      'MOP014',
      'MOP019',
      'MOP030',
      'MOP039',
      'MOP042',
      'MOP802',
      'MOP803',
      'MOP804',
      'MOP805',
      'MOP806',
      'MOP815',
      'MOP839',
      'MOP844',
      'MOP868',
      'MOP869',
      'MOP879',
      'MOP893',
      'MOP896',
      'MOP897'
    )
  ) {
    return '에나멜코팅 도복장강관';
  }
  if (inMops('MOP010', 'MOP015', 'MOP027', 'MOP100', 'MOP898')) return '주철관';
  if (inMops('MOP001')) return '덕타일주철관';
  if (
    inMops(
      'MOP004',
      'MOP016',
      'MOP049',
      'MOP809',
      'MOP810',
      'MOP829',
      'MOP830',
      'MOP928',
      'MOP929',
      'MOP930',
      'MOP968'
    )
  ) {
    return 'PVC관';
  }
  if (
    inMops(
      'MOP032',
      'MOP046',
      'MOP808',
      'MOP816',
      'MOP817',
      'MOP818',
      'MOP819',
      'MOP909',
      'MOP910',
      'MOP940'
    )
  ) {
    return '내충격수도관';
  }
  if (
    inMops(
      'MOP005',
      'MOP026',
      'MOP028',
      'MOP800',
      'MOP801',
      'MOP811',
      'MOP812',
      'MOP880',
      'MOP881',
      'MOP882',
      'MOP883',
      'MOP884',
      'MOP885',
      'MOP919',
      'MOP920',
      'MOP938'
    )
  ) {
    return 'PE관';
  }
  if (inMops('MOP012', 'MOP020', 'MOP040', 'MOP849', 'MOP952', 'MOP953')) return '흄관';
  return '기타';
}

function usefulLifeForMop(mopKey: string): number {
  return MOP_USEFUL_LIFE[categoryOfMop(mopKey)] ?? 30;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function serviceYearOf(col: string, statYear: number): number | null {
  if (!col || col === '연도미상') return null;
  const y = Number(col);
  if (!Number.isFinite(y)) return null;
  return Math.max(0, statYear - y + 1);
}

function calcAgedLength(
  byYear: Map<string, number>,
  usefulLife: number | null,
  statYear: number
): number {
  if (usefulLife == null) return 0;
  let aged = 0;
  for (const [col, len] of byYear) {
    const age = serviceYearOf(col, statYear);
    if (age != null && age > usefulLife) aged += len;
  }
  return aged;
}

/** 연장가중 평균연령 = Σ(연장×사용연수) / Σ(연장). 연도미상 제외 */
function calcAvgAge(byYear: Map<string, number>, statYear: number): number {
  let weighted = 0;
  let total = 0;
  for (const [col, len] of byYear) {
    const age = serviceYearOf(col, statYear);
    if (age == null || len <= 0) continue;
    weighted += len * age;
    total += len;
  }
  return total > 0 ? round2(weighted / total) : 0;
}

function sortYearColumns(years: string[]): string[] {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const y of years) {
    if (/^\d{4}$/.test(y)) known.push(y);
    else unknown.push(y);
  }
  known.sort((a, b) => Number(a) - Number(b));
  unknown.sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  return [...known, ...unknown];
}

function sortDipColumns(dips: string[]): string[] {
  const numeric: string[] = [];
  const other: string[] = [];
  for (const d of dips) {
    if (d == null) continue;
    if (Number.isFinite(Number(String(d).trim()))) {
      if (!numeric.includes(d)) numeric.push(d);
    } else if (!other.includes(d)) {
      other.push(d);
    }
  }
  numeric.sort((a, b) => Number(a.trim()) - Number(b.trim()));
  other.sort((a, b) => a.localeCompare(b, 'ko'));
  return [...numeric, ...other];
}

function sortMopKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aMop = /^MOP\d+$/i.test(a);
    const bMop = /^MOP\d+$/i.test(b);
    if (aMop && bMop) return a.localeCompare(b, undefined, { sensitivity: 'base' });
    if (aMop) return -1;
    if (bMop) return 1;
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    return String(a).localeCompare(String(b), 'ko');
  });
}

/**
 * 교차표 관재질(행) — 검색·화면 조건과 무관하게 전체 관로 테이블 mop group by.
 * pipeTables: 모달 관로 종류(null=상수·급수 전체).
 */
async function listAllMopKeysForMatrix(
  mapSources?: string[],
  pipeTables?: string[] | null
): Promise<string[]> {
  const bases = await resolvePipePhysicalTables(mapSources, pipeTables);
  if (bases.length === 0) return [];
  const keys = new Set<string>();
  for (const base of bases) {
    if (!(await tableHasColumn(base, 'mop_cde'))) continue;
    const tbl = base.replace(/"/g, '""');
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT DISTINCT (${MOP_KEY_SQL}) AS mop_key
           FROM layer."${tbl}"`
        )
      );
      for (const row of res.rows ?? []) {
        const k = asStr((row as { mop_key?: unknown }).mop_key) || '미분류';
        keys.add(k);
      }
    } catch (e) {
      console.error('[listAllMopKeysForMatrix]', base, e);
    }
  }
  return sortMopKeys([...keys]);
}

/** saa_cde 코드순 (SAA000·미분류는 뒤) */
function compareSaaCde(a: string, b: string): number {
  const aLast = a === '미분류' || /^SAA000$/i.test(a);
  const bLast = b === '미분류' || /^SAA000$/i.test(b);
  if (aLast !== bLast) return aLast ? 1 : -1;
  const aSaa = /^SAA\d+$/i.test(a);
  const bSaa = /^SAA\d+$/i.test(b);
  if (aSaa && bSaa) {
    const na = Number(a.replace(/\D/g, ''));
    const nb = Number(b.replace(/\D/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }
  if (aSaa) return -1;
  if (bSaa) return 1;
  return String(a).localeCompare(String(b), 'ko');
}

function sortSaaKeys(keys: string[]): string[] {
  return [...keys].sort(compareSaaCde);
}

const DIP_KEY_SQL = `CASE
  WHEN std_dip IS NULL THEN '관경미상'
  WHEN NULLIF(TRIM(BOTH FROM std_dip::text), '') IS NULL THEN '관경미상'
  WHEN LOWER(TRIM(BOTH FROM std_dip::text)) IN ('null','none','nan','-') THEN '관경미상'
  ELSE TRIM(BOTH FROM std_dip::text)
END`;

const YEAR_KEY_SQL = `CASE
  WHEN ist_ymd IS NULL OR TRIM(ist_ymd::text) = ''
    OR LENGTH(TRIM(ist_ymd::text)) < 4
    OR SUBSTRING(TRIM(ist_ymd::text), 1, 4) !~ '^[0-9]{4}$'
  THEN '연도미상'
  ELSE SUBSTRING(TRIM(ist_ymd::text), 1, 4)
END`;

const MOP_KEY_SQL = `CASE
  WHEN mop_cde IS NULL OR TRIM(mop_cde::text) = '' THEN '미분류'
  ELSE mop_cde::text
END`;

const SAA_KEY_SQL = `CASE
  WHEN saa_cde IS NULL OR TRIM(saa_cde::text) = '' THEN '미분류'
  ELSE TRIM(saa_cde::text)
END`;

/** 관로 종류 논리 키 — UI·필터용. 물리 테이블은 mapSources remap */
const PIPE_KIND_LOGICAL = [
  { value: 'wtl_pipe_lm', label: '상수관로' },
  { value: 'wtl_sply_ls', label: '급수관로' },
] as const;

function listPipeKindOptionsFromTablesJson(): Array<{ value: string; label: string }> {
  try {
    const raw = JSON.parse(fs.readFileSync(TABLES_JSON_PATH, 'utf8')) as Array<{
      define_table_name?: string;
      define_table_kor_name?: string;
      define_table_group?: string;
    }>;
    const byExact = new Map<string, string>();
    for (const row of raw) {
      const name = String(row.define_table_name ?? '').trim().toLowerCase();
      const kor = String(row.define_table_kor_name ?? '').trim();
      const group = String(row.define_table_group ?? '').trim();
      if (!name || !kor) continue;
      if (group && !isWtlNetMapGroup(group)) continue;
      if (name === 'wtl_pipe_lm' || name === 'wtl_sply_ls') {
        byExact.set(name, kor);
      }
    }
    return PIPE_KIND_LOGICAL.map((d) => ({
      value: d.value,
      label: byExact.get(d.value) || d.label,
    }));
  } catch {
    return PIPE_KIND_LOGICAL.map((d) => ({ value: d.value, label: d.label }));
  }
}

/**
 * 선택 레이어 그룹(mapSources) × 관로 종류(논리 키) → 물리 테이블.
 * 예: 상수(대진) + wtl_pipe_lm → d_wtl_pipe_lm
 */
async function resolvePipePhysicalTables(
  mapSources: string[] | undefined,
  logicalKinds: string[] | null | undefined
): Promise<string[]> {
  if (logicalKinds !== null && logicalKinds !== undefined && logicalKinds.length === 0) {
    return [];
  }
  const kinds = listPipeKindOptionsFromTablesJson();
  const allowed = new Set(kinds.map((k) => k.value.toLowerCase()));
  const requested = (logicalKinds ?? kinds.map((k) => k.value))
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t && allowed.has(t));
  if (requested.length === 0) return [];

  const sourceIds = parseMapSourceIds(mapSources);
  const sourceDefs = sourceIds
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  if (sourceDefs.length === 0) return [];

  const physical = new Set<string>();
  for (const src of sourceDefs) {
    for (const logical of requested) {
      const phys = String(src.remapTable(logical) ?? logical)
        .trim()
        .toLowerCase();
      if (!phys) continue;
      if (await tableExists(phys)) physical.add(phys);
    }
  }
  return [...physical];
}

/**
 * 교차표용 UNION.
 * - layerKeys(listFilter): 켜진 관로 분할(기타·배수 등) + saa WHERE
 * - tableNames: 모달 관로 종류(wtl_pipe_lm|wtl_sply_ls). null=전체, []=없음
 */
async function buildPipeUnionSql(
  tableNames?: string[] | null,
  mapSources?: string[],
  listFilter?: WtlNetworkStatusListFilter | null
): Promise<string | null> {
  const listOpts = await resolveListFilterOpts(listFilter);
  /** 화면 범위 대기 중이면 UNION 없음(교차표 빈 결과) */
  if (listFilter?.onlyInView === true && listOpts.bbox == null) return null;

  const sources = await resolveStatusPipeSources(
    mapSources,
    listOpts.layerKeys,
    tableNames
  );
  if (sources.length === 0) return null;

  const parts: string[] = [];
  for (const { physicalTable: base, def } of sources) {
    const lenCol = String(def.lengthCol ?? (await resolvePipeLengthCol(base))).replace(
      /"/g,
      '""'
    );
    const dipCol = String(
      def.diameterCol ?? (await resolvePipeDiameterCol(base))
    ).replace(/"/g, '""');
    const tbl = base.replace(/"/g, '""');
    const hasMop = await tableHasColumn(base, 'mop_cde');
    const hasIst = await tableHasColumn(base, 'ist_ymd');
    const hasHjd = await tableHasColumn(base, 'hjd_cde');
    const hasSaa = await tableHasColumn(base, 'saa_cde');
    // 테이블마다 numeric/varchar 혼재 → UNION 시 전부 text로 맞춤
    const mopSel = hasMop ? 't.mop_cde::text AS mop_cde' : 'NULL::text AS mop_cde';
    const istSel = hasIst ? 't.ist_ymd::text AS ist_ymd' : 'NULL::text AS ist_ymd';
    const hjdSel = hasHjd ? 't.hjd_cde::text AS hjd_cde' : 'NULL::text AS hjd_cde';
    const saaSel = hasSaa ? 't.saa_cde::text AS saa_cde' : 'NULL::text AS saa_cde';
    const whereSql = collectListWheres(def, listOpts).join(' AND ');
    parts.push(
      `SELECT ${mopSel}, ${istSel}, ${hjdSel}, ${saaSel}, t."${dipCol}"::text AS std_dip, t."${lenCol}"::text AS byc_len FROM layer."${tbl}" t WHERE ${whereSql}`
    );
  }
  if (parts.length === 0) return null;
  return parts.join(' UNION ALL ');
}

/** null/omit = 전체, [] = 결과 없음(1=0), 값 = IN 필터 */
function buildDipFilterSql(params: WtlNetworkDipMatrixParams): string {
  const parts: string[] = [];

  const applyList = (
    raw: string[] | null | undefined,
    build: (values: string[]) => string
  ) => {
    if (raw === null || raw === undefined) return;
    if (raw.length === 0) {
      parts.push(' AND 1=0');
      return;
    }
    parts.push(build(raw));
  };

  applyList(params.emdCodes, (emds) => {
    const codes = emds.map((c) => String(c).trim()).filter((c) => /^[0-9]+$/.test(c));
    if (codes.length === 0) return ' AND 1=0';
    const ors = codes.map((c) => `COALESCE(hjd_cde::text,'') LIKE '${esc(c)}%'`);
    return ` AND (${ors.join(' OR ')})`;
  });

  applyList(params.years, (years) => {
    const list = years
      .map((y) => String(y).trim())
      .filter((y) => /^\d{4}$/.test(y) || y === '연도미상');
    if (list.length === 0) return ' AND 1=0';
    return ` AND (${YEAR_KEY_SQL}) IN (${list.map((y) => `'${esc(y)}'`).join(',')})`;
  });

  applyList(params.saaCodes, (saas) => {
    const list = saas.map((s) => String(s).trim()).filter(Boolean);
    if (list.length === 0) return ' AND 1=0';
    return ` AND (${SAA_KEY_SQL}) IN (${list.map((s) => `'${esc(s)}'`).join(',')})`;
  });

  return parts.join('');
}

/** 관용도 모달 — 읍면동·연도·관경 구간 */
function buildSaaMatrixFilterSql(params: WtlNetworkSaaMatrixParams): string {
  const base = buildDipFilterSql({
    emdCodes: params.emdCodes,
    years: params.years,
    saaCodes: null,
  });
  const parts: string[] = [base];
  const from =
    params.diameterFrom != null && Number.isFinite(Number(params.diameterFrom))
      ? Number(params.diameterFrom)
      : null;
  const to =
    params.diameterTo != null && Number.isFinite(Number(params.diameterTo))
      ? Number(params.diameterTo)
      : null;
  if (from != null && to != null) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    parts.push(
      ` AND (
        NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'),'') IS NULL
        OR (
          NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'),'') ~ '^[0-9]+(\\.[0-9]+)?$'
          AND NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'),'')::numeric
            BETWEEN ${lo} AND ${hi}
        )
      )`
    );
  } else if (from != null || to != null) {
    const v = from != null ? from : to!;
    parts.push(
      ` AND (
        NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'),'') ~ '^[0-9]+(\\.[0-9]+)?$'
        AND NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'),'')::numeric = ${v}
      )`
    );
  }
  return parts.join('');
}

/**
 * 관경별 확대 모달 — 검색 옵션 (관로종류·읍면동·매설년도·관용도)
 */
export async function getWtlNetworkStatusDipFilterOptions(params: {
  mapSources?: string[];
  listFilter?: WtlNetworkStatusListFilter | null;
} = {}): Promise<WtlNetworkDipFilterOptions> {
  const pipeKinds = listPipeKindOptionsFromTablesJson();
  /** 읍면동은 클라이언트에서 getEmdRiOptions와 동일 소스 사용 */
  const emds: WtlNetworkDipFilterOptions['emds'] = [];
  const years: WtlNetworkDipFilterOptions['years'] = [];
  const saas: WtlNetworkDipFilterOptions['saas'] = [];
  const union = await buildPipeUnionSql(null, params.mapSources, params.listFilter);
  if (union) {
    try {
      const yearRes = await db.execute(
        sql.raw(
          `SELECT DISTINCT (${YEAR_KEY_SQL}) AS y
           FROM (${union}) src
           ORDER BY 1`
        )
      );
      for (const row of yearRes.rows ?? []) {
        const y = asStr((row as { y?: unknown }).y);
        if (!y) continue;
        years.push({ value: y, label: y });
      }
    } catch (e) {
      console.error('[getWtlNetworkStatusDipFilterOptions] years', e);
    }
    try {
      const saaRes = await db.execute(
        sql.raw(
          `SELECT DISTINCT
             CASE WHEN saa_cde IS NULL OR TRIM(saa_cde::text) = '' THEN '미분류'
                  ELSE TRIM(saa_cde::text) END AS code
           FROM (${union}) src
           ORDER BY 1`
        )
      );
      for (const row of saaRes.rows ?? []) {
        const code = asStr((row as { code?: unknown }).code);
        if (!code) continue;
        const kor = code === '미분류' ? '미분류' : saaLabel(code);
        saas.push({ value: code, label: kor === '—' ? code : kor });
      }
      saas.sort((a, b) => compareSaaCde(a.value, b.value));
    } catch (e) {
      console.error('[getWtlNetworkStatusDipFilterOptions] saas', e);
    }
  }

  return { pipeKinds, emds, years, saas };
}

function emptyAxisMatrix(axis: WtlNetworkAxisMode, statYear: number): WtlNetworkDipMatrix {
  return {
    axis,
    statYear,
    columns: [],
    serviceYears: [],
    rows: [
      {
        mopCode: '',
        label: '총계',
        isTotal: true,
        total: 0,
        lengths: {},
        agedLength: 0,
        agedRatio: 0,
        nonCorrosionRatio: 0,
        usefulLife: null,
        avgAge: axis === 'year' ? 0 : null,
      },
    ],
  };
}

/**
 * mop × (관경|연도) 교차표 + 경년관·비내식·(연도축)연장가중 평균연령
 * (ggnr WtlPipeStatisticsController axisMode=dip|year 와 동일 규칙)
 */
async function buildWtlNetworkStatusAxisMatrix(
  axis: WtlNetworkAxisMode,
  params: WtlNetworkDipMatrixParams = {}
): Promise<WtlNetworkDipMatrix> {
  const statYear = new Date().getFullYear();
  const empty = emptyAxisMatrix(axis, statYear);
  const logTag =
    axis === 'year' ? 'getWtlNetworkStatusYearMatrix' : 'getWtlNetworkStatusDipMatrix';

  /** 연도축에서는 매설년도 필터를 쓰지 않음(열이 연도) */
  const filterParams: WtlNetworkDipMatrixParams =
    axis === 'year' ? { ...params, years: null } : params;

  const union = await buildPipeUnionSql(
    filterParams.pipeTables,
    filterParams.mapSources,
    filterParams.listFilter
  );
  if (!union) return empty;
  const filterSql = buildDipFilterSql(filterParams);

  const lenExpr = `SUM(COALESCE(NULLIF(TRIM(byc_len::text), '')::numeric, 0))`;
  const axisKeySql = axis === 'year' ? YEAR_KEY_SQL : DIP_KEY_SQL;

  let axisRaw: Array<{ mop_key?: unknown; col_key?: unknown; byc_len?: number }> = [];
  let yearRaw: Array<{ mop_key?: unknown; col_key?: unknown; byc_len?: number }> = [];
  try {
    const axisRes = await db.execute(
      sql.raw(
        `SELECT mop_key, col_key, ${lenExpr} AS byc_len
         FROM (
           SELECT ${MOP_KEY_SQL} AS mop_key, ${axisKeySql} AS col_key, byc_len, hjd_cde, saa_cde, ist_ymd
           FROM (${union}) src
         ) t
         WHERE 1=1 ${filterSql}
         GROUP BY mop_key, col_key`
      )
    );
    axisRaw = (axisRes.rows ?? []) as typeof axisRaw;
  } catch (e) {
    console.error(`[${logTag}] mop×${axis}`, e);
    return empty;
  }

  if (axis === 'dip') {
    try {
      const yearRes = await db.execute(
        sql.raw(
          `SELECT mop_key, col_key, ${lenExpr} AS byc_len
           FROM (
             SELECT ${MOP_KEY_SQL} AS mop_key, ${YEAR_KEY_SQL} AS col_key, byc_len, hjd_cde, saa_cde, ist_ymd
             FROM (${union}) src
           ) t
           WHERE 1=1 ${filterSql}
           GROUP BY mop_key, col_key`
        )
      );
      yearRaw = (yearRes.rows ?? []) as typeof yearRaw;
    } catch (e) {
      console.error(`[${logTag}] mop×year(경년)`, e);
    }
  } else {
    yearRaw = axisRaw;
  }

  const axisCols =
    axis === 'year'
      ? sortYearColumns([...new Set(axisRaw.map((r) => asStr(r.col_key)).filter(Boolean))])
      : sortDipColumns([...new Set(axisRaw.map((r) => asStr(r.col_key)).filter(Boolean))]);

  const axisMatrix = new Map<string, Map<string, number>>();
  for (const row of axisRaw) {
    const mop = asStr(row.mop_key) || '미분류';
    const col = asStr(row.col_key);
    if (!col || !axisCols.includes(col)) continue;
    const len = Number(row.byc_len) || 0;
    if (!axisMatrix.has(mop)) axisMatrix.set(mop, new Map());
    const m = axisMatrix.get(mop)!;
    m.set(col, (m.get(col) ?? 0) + len);
  }

  const yearMatrix = new Map<string, Map<string, number>>();
  for (const row of yearRaw) {
    const mop = asStr(row.mop_key) || '미분류';
    const col = asStr(row.col_key);
    if (!col) continue;
    const len = Number(row.byc_len) || 0;
    if (!yearMatrix.has(mop)) yearMatrix.set(mop, new Map());
    const m = yearMatrix.get(mop)!;
    m.set(col, (m.get(col) ?? 0) + len);
  }

  /** 관재질 행 = 전체 관로 테이블 mop (검색 조건과 무관). 셀 값만 현재 조건 */
  const allMops = await listAllMopKeysForMatrix(
    filterParams.mapSources,
    filterParams.pipeTables
  );
  const mopOrder = sortMopKeys([
    ...new Set([...allMops, ...axisMatrix.keys(), ...yearMatrix.keys()]),
  ]);

  const totalByCol = new Map<string, number>();
  for (const col of axisCols) totalByCol.set(col, 0);
  for (const mop of mopOrder) {
    const cols = axisMatrix.get(mop);
    if (!cols) continue;
    for (const col of axisCols) {
      totalByCol.set(col, (totalByCol.get(col) ?? 0) + (cols.get(col) ?? 0));
    }
  }

  const buildLengths = (src: Map<string, number> | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const col of axisCols) out[col] = round2(src?.get(col) ?? 0);
    return out;
  };

  const sumMap = (src: Map<string, number> | undefined) => {
    let s = 0;
    if (!src) return 0;
    for (const v of src.values()) s += v;
    return s;
  };

  const bodyRows: WtlNetworkDipMatrixRow[] = mopOrder.map((mop) => {
    const lengthsMap = axisMatrix.get(mop);
    const total = sumMap(lengthsMap);
    const life = usefulLifeForMop(mop);
    const byYear = yearMatrix.get(mop) ?? new Map();
    const aged = calcAgedLength(byYear, life, statYear);
    const kor = mop === '미분류' ? '미분류' : mopLabel(mop);
    return {
      mopCode: mop,
      label: kor === '—' ? mop : kor,
      isTotal: false,
      total: round2(total),
      lengths: buildLengths(lengthsMap),
      agedLength: round2(aged),
      agedRatio: total > 0 ? round2((aged / total) * 100) : 0,
      nonCorrosionRatio: null,
      usefulLife: life,
      avgAge: axis === 'year' ? calcAvgAge(byYear, statYear) : null,
    };
  });

  let castIron = 0;
  let agedSum = 0;
  const totalYearMap = new Map<string, number>();
  for (const mop of mopOrder) {
    const rowTotal = sumMap(axisMatrix.get(mop));
    if (CAST_IRON_MOPS.has(mop.trim().toUpperCase()) || categoryOfMop(mop) === '주철관') {
      castIron += rowTotal;
    }
    for (const [y, len] of yearMatrix.get(mop) ?? []) {
      totalYearMap.set(y, (totalYearMap.get(y) ?? 0) + len);
    }
  }
  for (const row of bodyRows) agedSum += row.agedLength;

  const grand = sumMap(totalByCol);
  const totalRow: WtlNetworkDipMatrixRow = {
    mopCode: '',
    label: '총계',
    isTotal: true,
    total: round2(grand),
    lengths: buildLengths(totalByCol),
    agedLength: round2(agedSum),
    agedRatio: grand > 0 ? round2((agedSum / grand) * 100) : 0,
    nonCorrosionRatio: grand > 0 ? round2((castIron / grand) * 100) : 0,
    usefulLife: null,
    avgAge: axis === 'year' ? calcAvgAge(totalYearMap, statYear) : null,
  };

  const serviceYears =
    axis === 'year' ? axisCols.map((col) => serviceYearOf(col, statYear)) : [];

  return {
    axis,
    statYear,
    columns: axisCols,
    serviceYears,
    rows: [totalRow, ...bodyRows],
  };
}

/** 관경별 확대 모달 — mop × std_dip */
export async function getWtlNetworkStatusDipMatrix(
  params: WtlNetworkDipMatrixParams = {}
): Promise<WtlNetworkDipMatrix> {
  return buildWtlNetworkStatusAxisMatrix('dip', params);
}

/** 연도별 확대 모달 — mop × 매설년도 (+사용연수·연장가중 평균연령) */
export async function getWtlNetworkStatusYearMatrix(
  params: WtlNetworkYearMatrixParams = {}
): Promise<WtlNetworkDipMatrix> {
  return buildWtlNetworkStatusAxisMatrix('year', params);
}

function emptySaaMatrix(): WtlNetworkSaaMatrix {
  return {
    columns: [],
    columnLabels: {},
    rows: [
      {
        mopCode: '',
        label: '총계',
        isTotal: true,
        total: 0,
        lengths: {},
      },
    ],
  };
}

/** 관용도별 확대 — mop_cde × saa_cde, 셀=연장 합 */
export async function getWtlNetworkStatusSaaMatrix(
  params: WtlNetworkSaaMatrixParams = {}
): Promise<WtlNetworkSaaMatrix> {
  const empty = emptySaaMatrix();
  const union = await buildPipeUnionSql(
    params.pipeTables,
    params.mapSources,
    params.listFilter
  );
  if (!union) return empty;
  const filterSql = buildSaaMatrixFilterSql(params);
  const lenExpr = `SUM(COALESCE(NULLIF(TRIM(byc_len::text), '')::numeric, 0))`;

  let raw: Array<{ mop_key?: unknown; saa_key?: unknown; byc_len?: number }> = [];
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT mop_key, saa_key, ${lenExpr} AS byc_len
         FROM (
           SELECT ${MOP_KEY_SQL} AS mop_key, ${SAA_KEY_SQL} AS saa_key, byc_len, hjd_cde, ist_ymd, std_dip
           FROM (${union}) src
         ) t
         WHERE 1=1 ${filterSql}
         GROUP BY mop_key, saa_key`
      )
    );
    raw = (res.rows ?? []) as typeof raw;
  } catch (e) {
    console.error('[getWtlNetworkStatusSaaMatrix]', e);
    return empty;
  }

  const matrix = new Map<string, Map<string, number>>();
  const saaCodes = new Set<string>();
  for (const row of raw) {
    const mop = asStr(row.mop_key) || '미분류';
    const saa = asStr(row.saa_key) || '미분류';
    const len = Number(row.byc_len) || 0;
    saaCodes.add(saa);
    if (!matrix.has(mop)) matrix.set(mop, new Map());
    const m = matrix.get(mop)!;
    m.set(saa, (m.get(saa) ?? 0) + len);
  }

  const columns = sortSaaKeys([...saaCodes]);
  const columnLabels: Record<string, string> = {};
  for (const c of columns) {
    if (c === '미분류') columnLabels[c] = '미분류';
    else {
      const kor = saaLabel(c);
      columnLabels[c] = kor === '—' ? c : kor;
    }
  }

  /** 관재질 행 = 전체 관로 테이블 mop (검색 조건과 무관). 셀 값만 현재 조건 */
  const allMops = await listAllMopKeysForMatrix(params.mapSources, params.pipeTables);
  const mopOrder = sortMopKeys([...new Set([...allMops, ...matrix.keys()])]);

  const buildLengths = (src: Map<string, number> | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const col of columns) out[col] = round2(src?.get(col) ?? 0);
    return out;
  };
  const sumMap = (src: Map<string, number> | undefined) => {
    let s = 0;
    if (!src) return 0;
    for (const v of src.values()) s += v;
    return s;
  };

  const bodyRows: WtlNetworkSaaMatrixRow[] = mopOrder.map((mop) => {
    const lengthsMap = matrix.get(mop);
    const total = sumMap(lengthsMap);
    const kor = mop === '미분류' ? '미분류' : mopLabel(mop);
    return {
      mopCode: mop,
      label: kor === '—' ? mop : kor,
      isTotal: false,
      total: round2(total),
      lengths: buildLengths(lengthsMap),
    };
  });

  const totalByCol = new Map<string, number>();
  for (const col of columns) totalByCol.set(col, 0);
  for (const mop of mopOrder) {
    const cols = matrix.get(mop);
    if (!cols) continue;
    for (const col of columns) {
      totalByCol.set(col, (totalByCol.get(col) ?? 0) + (cols.get(col) ?? 0));
    }
  }
  const grand = sumMap(totalByCol);
  const totalRow: WtlNetworkSaaMatrixRow = {
    mopCode: '',
    label: '총계',
    isTotal: true,
    total: round2(grand),
    lengths: buildLengths(totalByCol),
  };

  return { columns, columnLabels, rows: [totalRow, ...bodyRows] };
}

/**
 * 연도·관경 범위·재질 목록 (필터 UI)
 */
export async function getWtlNetworkFilterMeta(params: {
  layerKeys?: string[];
} = {}): Promise<WtlNetworkFilterMeta> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  const defs = (keys.length
    ? keys.map((k) => getWtlNetLayerDef(k)).filter(Boolean)
    : [
        getWtlNetLayerDef('배수관로'),
        getWtlNetLayerDef('송수관로'),
        getWtlNetLayerDef('급수관로'),
        getWtlNetLayerDef('상수관로(기타)'),
      ]
  ) as WtlNetLayerDef[];

  let yearMin: number | null = null;
  let yearMax: number | null = null;
  let diameterMin: number | null = null;
  let diameterMax: number | null = null;

  for (const def of defs) {
    if (!def?.table || !(await tableExists(def.table))) continue;
    const tbl = def.table.replace(/"/g, '""');
    const saa = wtlNetSaaSql(def);
    const saaClause = saa ? `WHERE ${saa}` : '';

    if (def.yearCol) {
      const r = await db.execute(
        sql.raw(
          `SELECT
             MIN(NULLIF(left(regexp_replace(COALESCE("${def.yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'')::int) AS ymin,
             MAX(NULLIF(left(regexp_replace(COALESCE("${def.yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'')::int) AS ymax
           FROM layer."${tbl}"
           ${saaClause}`
        )
      );
      const row = r.rows?.[0] as { ymin?: number; ymax?: number } | undefined;
      if (row?.ymin != null && Number.isFinite(Number(row.ymin))) {
        yearMin = yearMin == null ? Number(row.ymin) : Math.min(yearMin, Number(row.ymin));
      }
      if (row?.ymax != null && Number.isFinite(Number(row.ymax))) {
        yearMax = yearMax == null ? Number(row.ymax) : Math.max(yearMax, Number(row.ymax));
      }
    }

    if (def.diameterCol) {
      const r = await db.execute(
        sql.raw(
          `SELECT
             MIN(NULLIF(regexp_replace(COALESCE("${def.diameterCol}"::text,''), '[^0-9.]', '', 'g'),'')::numeric) AS dmin,
             MAX(NULLIF(regexp_replace(COALESCE("${def.diameterCol}"::text,''), '[^0-9.]', '', 'g'),'')::numeric) AS dmax
           FROM layer."${tbl}"
           ${saaClause}`
        )
      );
      const row = r.rows?.[0] as { dmin?: number; dmax?: number } | undefined;
      if (row?.dmin != null && Number.isFinite(Number(row.dmin))) {
        const v = Math.floor(Number(row.dmin));
        diameterMin = diameterMin == null ? v : Math.min(diameterMin, v);
      }
      if (row?.dmax != null && Number.isFinite(Number(row.dmax))) {
        const v = Math.ceil(Number(row.dmax));
        diameterMax = diameterMax == null ? v : Math.max(diameterMax, v);
      }
    }
  }

  const bundle = await ensureMaterialTopBundle();
  const yMin = yearMin ?? 1970;
  const yMax = yearMax ?? new Date().getFullYear();
  const dMin = diameterMin ?? 0;
  const dMax = diameterMax ?? 2000;

  const materialLabelToCodes: Record<string, string[]> = {};
  for (const [label, codes] of bundle.labelToCodes) {
    materialLabelToCodes[label] = [...codes];
  }

  return {
    yearMin: Math.min(yMin, yMax),
    yearMax: Math.max(yMin, yMax),
    diameterMin: Math.min(dMin, dMax),
    diameterMax: Math.max(dMin, dMax),
    materials: materialChoicesFromBundle(bundle),
    materialLabelToCodes,
    materialTopCodes: [...bundle.topCodes],
  };
}

export type WtlNetworkExportScope = 'all' | 'filtered';

export type ExportWtlNetworkShpParams = {
  /** all=선택 레이어 전체(saa만), filtered=목록과 동일 검색조건 */
  scope?: WtlNetworkExportScope | string | null;
  layerKeys?: string[];
  mapSources?: string[];
  bbox?: number[] | null;
  keyword?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  diameterFrom?: number | null;
  diameterTo?: number | null;
  materials?: string[];
  emdCode?: string | null;
  riCode?: string | null;
  supplyBlock?: string | null;
  areaWkts5181?: string[] | null;
};

function safeShpEntryName(raw: string): string {
  return (
    String(raw ?? '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'layer'
  );
}

/**
 * 관망조회 SHP — 레이어관리 `/api/download/shp`와 동일 ogr 경로.
 * 레이어가 여러 개면 zip 안에 레이어별 zip을 담아 반환.
 */
export async function exportWtlNetworkShpZip(
  params: ExportWtlNetworkShpParams = {}
): Promise<{ success: boolean; zipBuffer?: Buffer; fileName?: string; error?: string }> {
  const scope: WtlNetworkExportScope =
    String(params.scope ?? 'filtered').trim() === 'all' ? 'all' : 'filtered';
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (keys.length === 0) return { success: false, error: '내보낼 레이어가 없습니다.' };

  const sources = parseMapSourceIds(params.mapSources)
    .map((id) => resolveWtlNetMapSource(id))
    .filter((s): s is WtlNetMapSourceDef => Boolean(s));
  if (sources.length === 0) return { success: false, error: '레이어 그룹이 없습니다.' };

  const materialBundle =
    scope === 'filtered' && (params.materials?.length ?? 0) > 0
      ? await ensureMaterialTopBundle()
      : null;

  const filterOpts: ListFilterOpts =
    scope === 'all'
      ? {}
      : {
          bbox: params.bbox,
          keyword: params.keyword,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          diameterFrom: params.diameterFrom,
          diameterTo: params.diameterTo,
          materials: params.materials,
          materialBundle,
          emdCode: params.emdCode,
          riCode: params.riCode,
          supplyBlock: params.supplyBlock,
          areaWkts5181: params.areaWkts5181,
        };

  const parts: Array<{ entryName: string; zipBuffer: Buffer }> = [];
  const errors: string[] = [];

  for (const source of sources) {
    for (const key of keys) {
      const def = getWtlNetLayerDef(key);
      if (!def?.table) continue;
      const physicalTable = source.remapTable(def.table);
      if (!(await tableExists(physicalTable))) continue;
      const sqlText = buildShpExportSql(def, physicalTable, filterOpts);
      const layerName = safeShpEntryName(
        `${source.id}_${def.defineTable || def.key || physicalTable}`
      );
      const result = await exportLayerTableToShp({
        tableName: physicalTable,
        schema: 'layer',
        sql: sqlText,
        layerName,
      });
      if (!result.success || !result.zipBuffer) {
        errors.push(`${layerName}: ${result.error ?? '실패'}`);
        continue;
      }
      parts.push({ entryName: `${layerName}.zip`, zipBuffer: result.zipBuffer });
    }
  }

  if (parts.length === 0) {
    return {
      success: false,
      error: errors[0] ?? '내보낼 SHP가 없습니다.',
    };
  }

  const stamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  })();
  const scopeTag = scope === 'all' ? '전체' : '조건';

  if (parts.length === 1) {
    return {
      success: true,
      zipBuffer: parts[0]!.zipBuffer,
      fileName: `관망조회_${scopeTag}_${parts[0]!.entryName.replace(/\.zip$/i, '')}_${stamp}.zip`,
    };
  }

  const chunks: Buffer[] = [];
  const archive = archiver('zip', { zlib: { level: 9 } });
  const out = new PassThrough();
  out.on('data', (c: Buffer) => chunks.push(c));
  archive.on('error', (err: unknown) => {
    console.error('[exportWtlNetworkShpZip] archiver', err);
  });
  archive.pipe(out);
  for (const part of parts) {
    archive.append(part.zipBuffer, { name: part.entryName });
  }
  await archive.finalize();
  await finished(out);

  return {
    success: true,
    zipBuffer: Buffer.concat(chunks),
    fileName: `관망조회_${scopeTag}_SHP_${stamp}.zip`,
  };
}
