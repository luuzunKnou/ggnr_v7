/**
 * 하수 관망조회 — layer.swl_* 조회 전용
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import {
  getSwlNetLayerDef,
  type SwlNetGeomKind,
  type SwlNetLayerDef,
} from '@/app/(pages)/map/_mapContents/swlAdmin/networkMap/swlNetworkLayerCatalog';
import type {
  SwlNetworkFilterMeta,
  SwlNetworkRow,
  SwlNetworkStatus,
} from '@/app/(pages)/map/_mapContents/swlAdmin/networkMap/swlNetworkTypes';

export type { SwlNetworkFilterMeta, SwlNetworkRow, SwlNetworkStatus };

type ListParams = {
  layerKeys?: string[];
  bbox?: number[] | null;
  keyword?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  diameterFrom?: number | null;
  diameterTo?: number | null;
  materials?: string[];
  limit?: number;
  withGeom?: boolean;
};

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
  if (!Number.isFinite(n) || asStr(v) === '') return '—';
  return `${n} m`;
}

let mopLabelCache: Map<string, string> | null = null;

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
  if (!mopLabelCache) mopLabelCache = loadCodeMap('field_swl_pipe_lm__MOP_CDE.json');
  if (!code) return '—';
  return mopLabelCache.get(code) ?? code;
}

const MATERIAL_OTHER = '기타';
const MATERIAL_TOP_N = 5;
const MATERIAL_RANK_SKIP = new Set(['MOP000', 'MOP999', '미분류', '기타']);

type MaterialTopBundle = {
  labels: string[];
  labelToCodes: Map<string, string[]>;
  topCodes: Set<string>;
};

let materialTopBundle: MaterialTopBundle | null = null;

function materialDisplayLabel(code: string, collapse: boolean): string {
  if (!code) return collapse ? MATERIAL_OTHER : '—';
  const full = mopLabel(code);
  if (!collapse || !materialTopBundle) return full;
  if (materialTopBundle.topCodes.has(code)) return full;
  return MATERIAL_OTHER;
}

async function ensureMaterialTopBundle(): Promise<MaterialTopBundle> {
  if (materialTopBundle) return materialTopBundle;
  if (!mopLabelCache) mopLabelCache = loadCodeMap('field_swl_pipe_lm__MOP_CDE.json');

  const tables = ['swl_pipe_lm', 'swl_side_ls', 'swl_conn_ls'];
  const existing: string[] = [];
  for (const t of tables) {
    if (await tableExists(t)) existing.push(t);
  }

  const countByCode = new Map<string, number>();
  if (existing.length > 0) {
    try {
      const unions = existing
        .map(
          (t) =>
            `SELECT mop_cde::text AS code FROM layer."${t.replace(/"/g, '""')}"
             WHERE mop_cde IS NOT NULL AND trim(mop_cde::text) <> ''`
        )
        .join('\nUNION ALL\n');
      const res = await db.execute(
        sql.raw(`SELECT code, COUNT(*)::int AS n FROM (${unions}) u GROUP BY code ORDER BY n DESC`)
      );
      for (const row of res.rows ?? []) {
        const code = asStr((row as { code?: string }).code);
        const n = Number((row as { n?: number }).n) || 0;
        if (code) countByCode.set(code, n);
      }
    } catch {
      /* 재질 칼럼이 없으면 코드표만 사용 */
    }
  }

  const ranked = [...countByCode.entries()]
    .map(([code, n]) => ({ code, n, label: mopLabel(code) }))
    .filter((r) => !MATERIAL_RANK_SKIP.has(r.code) && !MATERIAL_RANK_SKIP.has(r.label))
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
  if (labels.length === 0) {
    for (const [code, label] of mopLabelCache) {
      if (MATERIAL_RANK_SKIP.has(code) || MATERIAL_RANK_SKIP.has(label)) continue;
      if (labels.length >= MATERIAL_TOP_N) break;
      labels.push(label);
      labelToCodes.set(label, [code]);
      topCodes.add(code);
    }
  }

  materialTopBundle = { labels, labelToCodes, topCodes };
  return materialTopBundle;
}

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
      parts.push('TRUE');
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
  def: SwlNetLayerDef,
  opts: {
    bbox?: number[] | null;
    keyword?: string;
    yearFrom?: number | null;
    yearTo?: number | null;
    diameterFrom?: number | null;
    diameterTo?: number | null;
    materials?: string[];
    materialBundle?: MaterialTopBundle | null;
    withGeom: boolean;
    limit: number;
  }
): string {
  const tbl = def.table.replace(/"/g, '""');
  const nameExpr = def.nameExpr;
  const dipCol = def.diameterCol;
  const mopCol = def.materialCol;
  const lenCol = def.lengthCol;
  const yearCol = def.yearCol;
  const idCol = def.idCol === undefined ? 'ftr_idn' : def.idCol;

  const wheres: string[] = ['t.geom IS NOT NULL'];
  if (def.whereSql) wheres.push(def.whereSql);

  if (opts.bbox && opts.bbox.length === 4) {
    const [minX, minY, maxX, maxY] = opts.bbox.map((n) => Number(n));
    if ([minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) {
      wheres.push(
        `ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope(${minX},${minY},${maxX},${maxY},3857), ST_SRID(t.geom)))`
      );
    }
  }

  if (dipCol && opts.diameterFrom != null && opts.diameterTo != null) {
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

  const kw = String(opts.keyword ?? '').trim();
  if (kw) {
    const like = `%${esc(kw)}%`;
    const parts = [`(${nameExpr}) ILIKE '${like}'`];
    if (idCol) parts.push(`COALESCE(t."${idCol}"::text,'') ILIKE '${like}'`);
    if (dipCol) parts.push(`COALESCE(t."${dipCol}"::text,'') ILIKE '${like}'`);
    if (mopCol) parts.push(`COALESCE(t."${mopCol}"::text,'') ILIKE '${like}'`);
    wheres.push(`(${parts.join(' OR ')})`);
  }

  const diamSel = dipCol ? `t."${dipCol}"::text` : 'NULL';
  const matSel = mopCol ? `t."${mopCol}"::text` : 'NULL';
  const lenSel = lenCol ? `t."${lenCol}"::text` : 'NULL';
  const yearSel = yearCol ? `t."${yearCol}"::text` : 'NULL';
  const hjdSel = def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`;
  const geomSel = opts.withGeom ? `ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json` : 'NULL';

  return `
    SELECT
      '${esc(def.key)}' AS "layerKey",
      '${esc(def.geomKind)}' AS "geomKind",
      t.ogc_fid AS "ogcFid",
      (${nameExpr}) AS name,
      ${diamSel} AS diameter,
      ${matSel} AS material,
      ${lenSel} AS length,
      ${yearSel} AS year,
      ${hjdSel} AS hjd,
      ${geomSel} AS geom
    FROM layer."${tbl}" t
    WHERE ${wheres.join(' AND ')}
    LIMIT ${Math.max(1, Math.min(opts.limit, 3000))}
  `;
}

function mapRow(row: Record<string, unknown>, collapseMaterial = true): SwlNetworkRow {
  const layerKey = asStr(row.layerKey);
  const def = getSwlNetLayerDef(layerKey);
  const matRaw = asStr(row.material);
  const materialFull = def?.materialCol ? mopLabel(matRaw) : '—';
  const material = def?.materialCol
    ? materialDisplayLabel(matRaw, collapseMaterial)
    : '—';
  const diameter = asStr(row.diameter) || '—';
  const length = lengthLabel(row.length);
  const year = yearOf(row.year) || '—';
  const name = asStr(row.name) || String(row.ogcFid ?? '');
  const ogcFid = Number(row.ogcFid);
  const attrs: Array<{ label: string; value: string }> = [
    { label: '구분', value: layerKey },
    { label: '관리번호', value: name },
    { label: '구경', value: diameter },
    { label: '재질', value: materialFull || '—' },
    { label: '연장', value: length },
    { label: '설치연도', value: year },
    { label: '행정동코드', value: asStr(row.hjd) || '—' },
  ];
  return {
    id: `${layerKey}:${ogcFid}`,
    layerKey,
    geomKind: (asStr(row.geomKind) as SwlNetGeomKind) || 'point',
    name,
    diameter,
    material: material || '—',
    length,
    year,
    hjd: asStr(row.hjd),
    attrs,
    geom: parseGeom(row.geom),
  };
}

function parseNetworkRowId(id: string): { layerKey: string; ogcFid: number } | null {
  const raw = String(id ?? '').trim();
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) return null;
  const layerKey = raw.slice(0, idx);
  const ogcFid = Number(raw.slice(idx + 1));
  if (!layerKey || !Number.isFinite(ogcFid)) return null;
  return { layerKey, ogcFid };
}

export async function getSwlNetworkList(params: ListParams = {}): Promise<{ rows: SwlNetworkRow[] }> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (keys.length === 0) return { rows: [] };

  const limitPer = Math.max(30, Math.floor((params.limit ?? 1500) / Math.max(keys.length, 1)));
  const materialBundle = await ensureMaterialTopBundle();
  const rows: SwlNetworkRow[] = [];
  const cap = Math.min(params.limit ?? 1500, 5000);

  for (const key of keys) {
    if (rows.length >= cap) break;
    const def = getSwlNetLayerDef(key);
    if (!def?.table || !(await tableExists(def.table))) continue;
    try {
      const res = await db.execute(
        sql.raw(
          buildSelect(def, {
            bbox: params.bbox,
            keyword: params.keyword,
            yearFrom: params.yearFrom,
            yearTo: params.yearTo,
            diameterFrom: params.diameterFrom,
            diameterTo: params.diameterTo,
            materials: params.materials,
            materialBundle,
            withGeom: Boolean(params.withGeom),
            limit: limitPer,
          })
        )
      );
      for (const raw of res.rows ?? []) {
        rows.push(mapRow(raw as Record<string, unknown>, true));
        if (rows.length >= cap) break;
      }
    } catch {
      /* 칼럼이 다른 레이어는 건너뜀 */
    }
  }

  return { rows };
}

export async function getSwlNetworkDetail(params: {
  id?: string;
  layerKey?: string;
  ogcFid?: number;
}): Promise<{ row: SwlNetworkRow | null }> {
  let layerKey = String(params.layerKey ?? '').trim();
  let ogcFid = Number(params.ogcFid);
  const id = String(params.id ?? '').trim();
  if (id) {
    const parsed = parseNetworkRowId(id);
    if (parsed) {
      layerKey = parsed.layerKey;
      ogcFid = parsed.ogcFid;
    }
  }
  if (!layerKey || !Number.isFinite(ogcFid)) return { row: null };
  const def = getSwlNetLayerDef(layerKey);
  if (!def?.table || !(await tableExists(def.table))) return { row: null };

  const tbl = def.table.replace(/"/g, '""');
  const dipCol = def.diameterCol;
  const mopCol = def.materialCol;
  const lenCol = def.lengthCol;
  const yearCol = def.yearCol;
  const res = await db.execute(
    sql.raw(
      `SELECT
        '${esc(def.key)}' AS "layerKey",
        '${esc(def.geomKind)}' AS "geomKind",
        t.ogc_fid AS "ogcFid",
        (${def.nameExpr}) AS name,
        ${dipCol ? `t."${dipCol}"::text` : 'NULL'} AS diameter,
        ${mopCol ? `t."${mopCol}"::text` : 'NULL'} AS material,
        ${lenCol ? `t."${lenCol}"::text` : 'NULL'} AS length,
        ${yearCol ? `t."${yearCol}"::text` : 'NULL'} AS year,
        ${def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`} AS hjd,
        ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geom
      FROM layer."${tbl}" t
      WHERE t.ogc_fid = ${ogcFid}
      LIMIT 1`
    )
  );
  const raw = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!raw) return { row: null };
  return { row: mapRow(raw, true) };
}

export async function getSwlNetworkAtPoint(params: {
  x: number;
  y: number;
  layerKeys?: string[];
  tolerance?: number;
}): Promise<{ row: SwlNetworkRow | null }> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || keys.length === 0) return { row: null };
  const tol = Math.max(1, Number(params.tolerance) || 12);
  await ensureMaterialTopBundle();

  let best: { row: Record<string, unknown>; dist: number } | null = null;
  for (const key of keys) {
    const def = getSwlNetLayerDef(key);
    if (!def?.table || !(await tableExists(def.table))) continue;
    const tbl = def.table.replace(/"/g, '""');
    const dipCol = def.diameterCol;
    const mopCol = def.materialCol;
    const lenCol = def.lengthCol;
    const yearCol = def.yearCol;
    let raw: Record<string, unknown> | undefined;
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT
          '${esc(def.key)}' AS "layerKey",
          '${esc(def.geomKind)}' AS "geomKind",
          t.ogc_fid AS "ogcFid",
          (${def.nameExpr}) AS name,
          ${dipCol ? `t."${dipCol}"::text` : 'NULL'} AS diameter,
          ${mopCol ? `t."${mopCol}"::text` : 'NULL'} AS material,
          ${lenCol ? `t."${lenCol}"::text` : 'NULL'} AS length,
          ${yearCol ? `t."${yearCol}"::text` : 'NULL'} AS year,
          ${def.hasHjd === false ? `''` : `COALESCE(t.hjd_cde::text,'')`} AS hjd,
          ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geom,
          ST_Distance(
            ST_Transform(t.geom, 3857),
            ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857)
          ) AS dist
        FROM layer."${tbl}" t
        WHERE t.geom IS NOT NULL
          ${def.whereSql ? `AND ${def.whereSql}` : ''}
          AND ST_DWithin(
            ST_Transform(t.geom, 3857),
            ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857),
            ${tol}
          )
        ORDER BY dist
        LIMIT 1`
        )
      );
      raw = res.rows?.[0] as Record<string, unknown> | undefined;
    } catch {
      continue;
    }
    if (!raw) continue;
    const dist = Number(raw.dist);
    if (!best || dist < best.dist) best = { row: raw, dist };
  }
  if (!best) return { row: null };
  return { row: mapRow(best.row, true) };
}

export async function getSwlNetworkFilterMeta(
  params: { layerKeys?: string[] } = {}
): Promise<SwlNetworkFilterMeta> {
  const keys = (params.layerKeys ?? []).map((k) => String(k).trim()).filter(Boolean);
  const defs = (
    keys.length
      ? keys.map((k) => getSwlNetLayerDef(k)).filter(Boolean)
      : [
          getSwlNetLayerDef('우수관'),
          getSwlNetLayerDef('오수관'),
          getSwlNetLayerDef('하수관거(기타)'),
          getSwlNetLayerDef('측구'),
          getSwlNetLayerDef('하수연결관'),
        ]
  ) as SwlNetLayerDef[];

  let yearMin: number | null = null;
  let yearMax: number | null = null;
  let diameterMin: number | null = null;
  let diameterMax: number | null = null;

  for (const def of defs) {
    if (!def?.table || !(await tableExists(def.table))) continue;
    const tbl = def.table.replace(/"/g, '""');
    try {
      if (def.yearCol) {
        const r = await db.execute(
          sql.raw(
            `SELECT
               MIN(NULLIF(left(regexp_replace(COALESCE("${def.yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'')::int) AS ymin,
               MAX(NULLIF(left(regexp_replace(COALESCE("${def.yearCol}"::text,''), '[^0-9]', '', 'g'), 4),'')::int) AS ymax
             FROM layer."${tbl}"`
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
             FROM layer."${tbl}"`
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
    } catch {
      /* 칼럼이 없으면 해당 레이어는 범위에서 제외 */
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
    materials: [...bundle.labels, MATERIAL_OTHER],
  };
}

const STATUS_FACILITIES: { label: string; table: string }[] = [
  { label: '하수관거', table: 'swl_pipe_lm' },
  { label: '측구', table: 'swl_side_ls' },
  { label: '연결관', table: 'swl_conn_ls' },
  { label: '배수설비', table: 'swl_bssb_ps' },
  { label: '맨홀', table: 'swl_manh_ps' },
  { label: '물받이', table: 'swl_spot_ps' },
  { label: '토구', table: 'swl_spew_ps' },
  { label: '환기구', table: 'swl_vent_ps' },
  { label: '펌프장', table: 'swl_pump_ps' },
];

const STATUS_SORT_LAST = Number.MAX_SAFE_INTEGER;

function statusRows(
  rows: { label: string; meters: number; sort: number }[]
): { label: string; meters: number }[] {
  const merged = new Map<string, { meters: number; sort: number }>();
  for (const row of rows) {
    if (row.meters <= 0) continue;
    const prev = merged.get(row.label);
    if (prev) {
      prev.meters += row.meters;
      prev.sort = Math.min(prev.sort, row.sort);
    } else {
      merged.set(row.label, { meters: row.meters, sort: row.sort });
    }
  }
  return [...merged.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0], 'ko'))
    .map(([label, row]) => ({ label, meters: Math.round(row.meters) }));
}

function materialSortKey(code: string, label: string): number {
  if (!code || label === '기타' || code === 'MOP999') return STATUS_SORT_LAST;
  if (label === '미분류' || code === 'MOP000') return STATUS_SORT_LAST - 1;
  const n = Number(code.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : STATUS_SORT_LAST - 1;
}

export async function getSwlNetworkStatus(): Promise<SwlNetworkStatus> {
  const empty: SwlNetworkStatus = { byDiameter: [], byMaterial: [], byYear: [], facilities: [] };
  if (!(await tableExists('swl_pipe_lm'))) {
    empty.facilities = await facilityCounts();
    return empty;
  }

  const byDiameter: { label: string; meters: number; sort: number }[] = [];
  const byMaterial: { label: string; meters: number; sort: number }[] = [];
  const byYear: { label: string; meters: number; sort: number }[] = [];

  try {
    const dip = await db.execute(
      sql.raw(
        `SELECT
           COALESCE(NULLIF(regexp_replace(COALESCE(std_dip::text,''), '[^0-9.]', '', 'g'), ''), '') AS dip,
           SUM(COALESCE(NULLIF(regexp_replace(COALESCE(byc_len::text,''), '[^0-9.]', '', 'g'), '')::numeric, 0)) AS meters
         FROM layer.swl_pipe_lm
         GROUP BY 1`
      )
    );
    for (const row of dip.rows ?? []) {
      const dipRaw = asStr((row as { dip?: string }).dip);
      const meters = Number((row as { meters?: number }).meters) || 0;
      const n = Number(dipRaw);
      const label = dipRaw && Number.isFinite(n) ? `${Math.round(n)}㎜` : '기타';
      byDiameter.push({
        label,
        meters,
        sort: label === '기타' ? STATUS_SORT_LAST : Math.round(n),
      });
    }
  } catch {
    /* ignore */
  }

  try {
    if (!mopLabelCache) mopLabelCache = loadCodeMap('field_swl_pipe_lm__MOP_CDE.json');
    const mat = await db.execute(
      sql.raw(
        `SELECT
           COALESCE(mop_cde::text, '') AS code,
           SUM(COALESCE(NULLIF(regexp_replace(COALESCE(byc_len::text,''), '[^0-9.]', '', 'g'), '')::numeric, 0)) AS meters
         FROM layer.swl_pipe_lm
         GROUP BY 1`
      )
    );
    for (const row of mat.rows ?? []) {
      const code = asStr((row as { code?: string }).code);
      const meters = Number((row as { meters?: number }).meters) || 0;
      const rawLabel = code ? mopLabel(code) : '기타';
      const label = rawLabel === '—' ? '기타' : rawLabel;
      byMaterial.push({ label, meters, sort: materialSortKey(code, label) });
    }
  } catch {
    /* ignore */
  }

  try {
    const yr = await db.execute(
      sql.raw(
        `SELECT
           NULLIF(left(regexp_replace(COALESCE(ist_ymd::text,''), '[^0-9]', '', 'g'), 4), '') AS yr,
           SUM(COALESCE(NULLIF(regexp_replace(COALESCE(byc_len::text,''), '[^0-9.]', '', 'g'), '')::numeric, 0)) AS meters
         FROM layer.swl_pipe_lm
         GROUP BY 1`
      )
    );
    for (const row of yr.rows ?? []) {
      const label = asStr((row as { yr?: string }).yr) || '기타';
      const meters = Number((row as { meters?: number }).meters) || 0;
      const year = Number(label);
      byYear.push({
        label,
        meters,
        sort: label !== '기타' && Number.isFinite(year) ? year : STATUS_SORT_LAST,
      });
    }
  } catch {
    /* ignore */
  }

  return {
    byDiameter: statusRows(byDiameter),
    byMaterial: statusRows(byMaterial),
    byYear: statusRows(byYear),
    facilities: await facilityCounts(),
  };
}

async function facilityCounts(): Promise<{ label: string; count: number }[]> {
  const out: { label: string; count: number }[] = [];
  for (const item of STATUS_FACILITIES) {
    if (!(await tableExists(item.table))) continue;
    try {
      const res = await db.execute(
        sql.raw(`SELECT COUNT(*)::int AS n FROM layer."${item.table.replace(/"/g, '""')}"`)
      );
      const n = Number((res.rows?.[0] as { n?: number } | undefined)?.n) || 0;
      out.push({ label: item.label, count: n });
    } catch {
      /* ignore */
    }
  }
  return out;
}
