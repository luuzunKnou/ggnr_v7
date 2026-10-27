/**
 * 관망조회 — layer.wtl_* 조회 전용 (목록·상세·필터 옵션)
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import {
  getWtlNetLayerDef,
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
  WtlNetworkFilterMeta,
  WtlNetworkRow,
} from '@/app/(pages)/map/_mapContents/wtlAdmin/networkMap/wtlNetworkTypes';

export type { WtlNetworkFilterMeta, WtlNetworkRow };

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
  /** 읍면동 코드(hjd 접두) */
  emdCode?: string | null;
  /** 리 코드(hjd 접두, 우선) */
  riCode?: string | null;
  /** 급수블록(통합검색과 동일 ILIKE) */
  supplyBlock?: string | null;
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

  const wheres: string[] = ['t.geom IS NOT NULL'];
  const saa = wtlNetSaaSql(def);
  if (saa) wheres.push(saa);

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
      if (raw) return { row: mapRow(raw, true) };
    }
  }
  return { row: null };
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

  return {
    yearMin: Math.min(yMin, yMax),
    yearMax: Math.max(yMin, yMax),
    diameterMin: Math.min(dMin, dMax),
    diameterMax: Math.max(dMin, dMax),
    materials: materialChoicesFromBundle(bundle),
  };
}
