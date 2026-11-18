/**
 * 기준 DB 레이어 ↔ 첨부 파일 비교
 * 1) 구조(컬럼·건수·도형·좌표계) 2) 맞춰진 행 값 차이 — 반영 없음
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db } from '@/database/db';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { extractZip } from '@/integrations/core';
import {
  getDefineLayerTables,
  getLayerTableList,
  getTableColumnInfo,
} from '@/service/devTestService';
import { createTableFromShp } from '@/service/shpUploadService';
import type {
  ColumnMatchRow,
  CompareColumn,
  CompareGeomKind,
  CompareSourceMeta,
  PairMethod,
  StructureCompareResult,
  ValueCompareResult,
  ValueDiffRow,
} from '@/lib/layerCompareTypes';

export type {
  ColumnMatchRow,
  CompareColumn,
  CompareGeomKind,
  CompareSourceMeta,
  PairMethod,
  StructureCompareResult,
  ValueCompareResult,
  ValueDiffKind,
  ValueDiffRow,
} from '@/lib/layerCompareTypes';

const CMP_SCHEMA = 'layer' as const;
const SKIP_COLS = new Set([
  'geom',
  'geometry',
  'wkb_geometry',
  'shape',
  'ogc_fid',
  'gid',
  'id',
  'objectid',
  'fid',
  '_cmp_rid',
]);
const POINT_TOL_M = 1;
const LINE_HAUSDORFF_M = 2;
const POLYGON_IOU = 0.9;
/** 화면·엑셀 공통 상한(탭별). 0 이하면 이 값 사용 */
const DIFF_LIMIT = 100_000;
const DEFINE_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');
const TITLE_RE = /name|title|nm|도로명|시설명|명칭|관리번호|노선|주소|jibun|addr/i;
const HANGUL_RE = /[\uAC00-\uD7A3]/;
/** 값 비교용 — 긴 표기→짧은 표기 (경상북도↔경북 동일 취급). 길이 긴 것 우선 */
const COMPARE_REGION_FULL_TO_SHORT: Array<[string, string]> = [
  ['전북특별자치도', '전북'],
  ['강원특별자치도', '강원'],
  ['제주특별자치도', '제주'],
  ['세종특별자치시', '세종'],
  ['서울특별시', '서울'],
  ['부산광역시', '부산'],
  ['대구광역시', '대구'],
  ['인천광역시', '인천'],
  ['광주광역시', '광주'],
  ['대전광역시', '대전'],
  ['울산광역시', '울산'],
  ['경상북도', '경북'],
  ['경상남도', '경남'],
  ['전라북도', '전북'],
  ['전라남도', '전남'],
  ['충청북도', '충북'],
  ['충청남도', '충남'],
  ['강원도', '강원'],
  ['제주도', '제주'],
  ['경기도', '경기'],
];

/** 공백 제거 + 시도 표기 통일 후 비교 */
function normalizeCompareValue(raw: string): string {
  let t = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '');
  if (!t) return '';
  for (const [full, short] of COMPARE_REGION_FULL_TO_SHORT) {
    if (t.includes(full)) t = t.split(full).join(short);
  }
  return t;
}

/** SQL 텍스트 식에 동일 정규화 적용 */
function sqlNormalizeCompareExpr(sqlTextExpr: string): string {
  let e = `regexp_replace(TRIM(BOTH FROM COALESCE(${sqlTextExpr}, '')), '\\s+', '', 'g')`;
  for (const [full, short] of COMPARE_REGION_FULL_TO_SHORT) {
    e = `replace(${e}, '${full}', '${short}')`;
  }
  return e;
}

function getDataDir(): string {
  return resolveGgnrDataDir();
}

/** 비교용 컬럼명 — 한글 헤더 유지(영문만 남기면 layer_table 로 뭉개짐) */
function safeCompareColumnName(raw: string, fallbackIndex: number): string {
  let n = String(raw ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!n) n = `col_${fallbackIndex}`;
  while (Buffer.byteLength(n, 'utf8') > 63) {
    n = n.slice(0, -1);
  }
  return n || `col_${fallbackIndex}`;
}

function addKorIndex(map: Map<string, CompareColumn[]>, key: string, col: CompareColumn) {
  const k = key.trim();
  if (!k) return;
  const list = map.get(k) ?? [];
  list.push(col);
  map.set(k, list);
}
function escIdent(s: string): string {
  return String(s).replace(/"/g, '""');
}
function escLit(s: string): string {
  return String(s).replace(/'/g, "''");
}
function isTemp(table: string): boolean {
  return /^_cmp_/i.test(String(table ?? '').trim());
}
function normType(t: string): string {
  const u = String(t ?? '').toLowerCase();
  if (/int|serial|numeric|double|real|decimal|float|money/.test(u)) return 'number';
  if (/bool|bit/.test(u)) return 'bool';
  if (/timestamp|date|time/.test(u)) return 'date';
  return 'text';
}
function typeOk(a: string, b: string): boolean {
  return normType(a) === normType(b);
}

function readKorMap(tableName: string): Map<string, string> {
  const map = new Map<string, string>();
  const safe = String(tableName).replace(/[^a-zA-Z0-9_-]/g, '');
  const fp = path.join(DEFINE_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fsSync.existsSync(fp)) return map;
    const parsed = JSON.parse(fsSync.readFileSync(fp, 'utf-8'));
    if (!Array.isArray(parsed)) return map;
    for (const f of parsed) {
      const name = String(f?.define_field_name ?? '').trim();
      const kor = String(f?.define_field_kor_name ?? '').trim();
      if (name) map.set(name.toLowerCase(), kor);
    }
  } catch {
    /* ignore */
  }
  return map;
}

function classifyGeom(raw: string | null | undefined): CompareGeomKind {
  const t = String(raw ?? '').toUpperCase();
  if (!t || t === 'GEOMETRY' || t === 'GEOMETRYCOLLECTION') return 'NONE';
  if (/POINT/.test(t)) return 'POINT';
  if (/LINE/.test(t)) return 'LINE';
  if (/POLYGON/.test(t)) return 'POLYGON';
  return 'NONE';
}

async function resolveGeom(
  schema: string,
  table: string
): Promise<{ geomColumn: string | null; srid: number | null; geomKind: CompareGeomKind }> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid, type FROM geometry_columns
         WHERE f_table_schema = '${escLit(schema)}' AND f_table_name = '${escLit(table)}'
         ORDER BY CASE WHEN lower(f_geometry_column) = 'geom' THEN 0 ELSE 1 END LIMIT 1`
      )
    );
    const row = (res.rows as Array<{ name?: string; srid?: number; type?: string }>)[0];
    if (!row?.name) return { geomColumn: null, srid: null, geomKind: 'NONE' };
    return {
      geomColumn: String(row.name),
      srid: row.srid != null && Number(row.srid) > 0 ? Number(row.srid) : null,
      geomKind: classifyGeom(row.type),
    };
  } catch {
    return { geomColumn: null, srid: null, geomKind: 'NONE' };
  }
}

async function countRows(schema: string, table: string): Promise<number> {
  try {
    const res = await db.execute(
      sql.raw(`SELECT COUNT(*)::int AS cnt FROM "${escIdent(schema)}"."${escIdent(table)}"`)
    );
    return Number((res.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

async function loadMeta(
  schema: string,
  table: string,
  label?: string
): Promise<CompareSourceMeta> {
  const [colRes, geom, rowCount] = await Promise.all([
    getTableColumnInfo({ schema, table }),
    resolveGeom(schema, table),
    countRows(schema, table),
  ]);
  const korMap = readKorMap(table);
  const columns: CompareColumn[] = (colRes.columns ?? [])
    .filter((c) => !SKIP_COLS.has(c.name.toLowerCase()))
    .map((c) => {
      const fromDefine = korMap.get(c.name.toLowerCase()) ?? '';
      // 엑셀 한글 헤더를 컬럼명으로 쓴 경우 define 없어도 한글명으로 취급
      const korName = fromDefine || (HANGUL_RE.test(c.name) ? c.name : '');
      return {
        name: c.name,
        dataType: c.dataType,
        korName,
      };
    });

  let geomKind = geom.geomKind;
  if (geomKind === 'NONE' && geom.geomColumn) {
    try {
      const sample = await db.execute(
        sql.raw(
          `SELECT GeometryType("${escIdent(geom.geomColumn)}") AS t
           FROM "${escIdent(schema)}"."${escIdent(table)}"
           WHERE "${escIdent(geom.geomColumn)}" IS NOT NULL LIMIT 1`
        )
      );
      geomKind = classifyGeom(String((sample.rows as Array<{ t?: string }>)[0]?.t ?? ''));
    } catch {
      /* keep */
    }
  }

  return {
    schema,
    table,
    label: label || table,
    rowCount,
    geomKind,
    srid: geom.srid,
    geomColumn: geom.geomColumn,
    columns,
    isTemp: isTemp(table),
  };
}

function buildColumnMatches(base: CompareSourceMeta, file: CompareSourceMeta): ColumnMatchRow[] {
  const rows: ColumnMatchRow[] = [];
  const used = new Set<string>();
  const byEng = new Map(file.columns.map((c) => [c.name.toLowerCase(), c]));
  const byKor = new Map<string, CompareColumn[]>();
  for (const c of file.columns) {
    addKorIndex(byKor, c.korName, c);
    // 파일 컬럼명 자체가 한글이면 기준 한글명과 직접 매칭
    if (HANGUL_RE.test(c.name)) addKorIndex(byKor, c.name, c);
  }

  for (const b of base.columns) {
    const hit = byEng.get(b.name.toLowerCase());
    if (hit) {
      used.add(hit.name.toLowerCase());
      const ok = typeOk(b.dataType, hit.dataType);
      rows.push({
        id: `m-${b.name}-${hit.name}`,
        kind: ok ? 'same' : 'typeMismatch',
        baseName: b.name,
        fileName: hit.name,
        baseKor: b.korName,
        fileKor: hit.korName || hit.name,
        baseType: b.dataType,
        fileType: hit.dataType,
        included: true,
      });
      continue;
    }
    const kor = b.korName.trim();
    const cands = kor
      ? [...new Set((byKor.get(kor) ?? []).filter((c) => !used.has(c.name.toLowerCase())))]
      : [];
    if (cands.length === 1) {
      const c = cands[0]!;
      used.add(c.name.toLowerCase());
      const ok = typeOk(b.dataType, c.dataType);
      // 엑셀 한글 헤더가 기준 한글명과 같으면 영문 일치와 동일하게 바로 포함
      const exactHeader = HANGUL_RE.test(c.name) && c.name.trim() === kor;
      rows.push({
        id: `m-${b.name}-${c.name}`,
        kind: ok ? (exactHeader ? 'same' : 'candidate') : 'typeMismatch',
        baseName: b.name,
        fileName: c.name,
        baseKor: b.korName,
        fileKor: c.korName || c.name,
        baseType: b.dataType,
        fileType: c.dataType,
        included: exactHeader,
      });
      continue;
    }
    rows.push({
      id: `b-${b.name}`,
      kind: 'baseOnly',
      baseName: b.name,
      fileName: null,
      baseKor: b.korName,
      fileKor: '',
      baseType: b.dataType,
      fileType: '',
    });
  }

  for (const c of file.columns) {
    if (used.has(c.name.toLowerCase())) continue;
    rows.push({
      id: `f-${c.name}`,
      kind: 'fileOnly',
      baseName: null,
      fileName: c.name,
      baseKor: '',
      fileKor: c.korName,
      baseType: '',
      fileType: c.dataType,
    });
  }
  return rows;
}

function activePairs(
  columns: ColumnMatchRow[]
): Array<{ baseName: string; fileName: string; label: string }> {
  const out: Array<{ baseName: string; fileName: string; label: string }> = [];
  for (const m of columns) {
    if (!m.baseName || !m.fileName) continue;
    if (m.kind === 'same') {
      /* always */
    } else if (m.kind === 'candidate' || m.kind === 'typeMismatch') {
      if (m.included !== true) continue;
    } else {
      continue;
    }
    const label = m.baseKor?.trim() ? `${m.baseKor} (${m.baseName})` : m.baseName;
    out.push({ baseName: m.baseName, fileName: m.fileName, label });
  }
  return out;
}

async function dropTemp(schema: string, table: string): Promise<void> {
  if (!isTemp(table)) return;
  try {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${escIdent(schema)}"."${escIdent(table)}" CASCADE`));
  } catch {
    /* ignore */
  }
}

async function findShp(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const n = await findShp(full);
      if (n) return n;
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.shp')) return full;
  }
  return null;
}

async function importTabular(absPath: string, tempTable: string): Promise<{ success: boolean; error?: string }> {
  try {
    // UNC(네트워크) 경로에서 XLSX.readFile 의 existsSync 가 실패하는 경우가 있어
    // Node fs 로 읽은 뒤 버퍼 파싱한다.
    const fileBuf = await fs.readFile(absPath);
    const wb = XLSX.read(fileBuf, { type: 'buffer', raw: false, cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { success: false, error: '시트가 없습니다.' };
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
      defval: '',
    });
    await dropTemp(CMP_SCHEMA, tempTable);
    if (rows.length === 0) {
      await db.execute(
        sql.raw(
          `CREATE TABLE "${escIdent(CMP_SCHEMA)}"."${escIdent(tempTable)}" (_cmp_rid serial PRIMARY KEY)`
        )
      );
      return { success: true };
    }
    const headers = Object.keys(rows[0] ?? {});
    const cols = headers.map((h, i) => ({
      raw: h,
      safe: safeCompareColumnName(String(h || `col_${i}`), i),
    }));
    const seen = new Set<string>();
    for (const c of cols) {
      let n = c.safe;
      let i = 2;
      while (seen.has(n)) n = `${c.safe}_${i++}`.slice(0, 63);
      seen.add(n);
      c.safe = n;
    }
    const parts = ['_cmp_rid serial PRIMARY KEY', ...cols.map((c) => `"${escIdent(c.safe)}" text`)];
    await db.execute(
      sql.raw(`CREATE TABLE "${escIdent(CMP_SCHEMA)}"."${escIdent(tempTable)}" (${parts.join(', ')})`)
    );
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk
        .map((row) => {
          const vals = cols.map((c) => {
            const v = row[c.raw];
            if (v == null || v === '') return 'NULL';
            return `'${escLit(String(v))}'`;
          });
          return `(${vals.join(',')})`;
        })
        .join(',');
      await db.execute(
        sql.raw(
          `INSERT INTO "${escIdent(CMP_SCHEMA)}"."${escIdent(tempTable)}" (${cols
            .map((c) => `"${escIdent(c.safe)}"`)
            .join(',')}) VALUES ${values}`
        )
      );
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function geomExpr(alias: string, geomCol: string, srid: number | null): string {
  const g = `"${escIdent(alias)}"."${escIdent(geomCol)}"`;
  if (srid && srid !== 5181) return `ST_Transform(${g}, 5181)`;
  return g;
}

async function matchByKey(
  base: CompareSourceMeta,
  file: CompareSourceMeta,
  baseKey: string,
  fileKey: string,
  keyListLimit: number
): Promise<{
  pairs: Array<{ baseCtid: string; fileCtid: string; keyValue: string }>;
  baseOnly: number;
  fileOnly: number;
  baseOnlyKeys: string[];
  fileOnlyKeys: string[];
}> {
  const bFq = `"${escIdent(base.schema)}"."${escIdent(base.table)}"`;
  const fFq = `"${escIdent(file.schema)}"."${escIdent(file.table)}"`;
  const joinSql = `
    WITH b AS (
      SELECT b.ctid::text AS rid, NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') AS k,
             row_number() OVER (PARTITION BY NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') ORDER BY b.ctid) AS rn
      FROM ${bFq} b
    ),
    f AS (
      SELECT f.ctid::text AS rid, NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') AS k,
             row_number() OVER (PARTITION BY NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') ORDER BY f.ctid) AS rn
      FROM ${fFq} f
    )
    SELECT b.rid AS base_id, f.rid AS file_id, b.k AS key_value
    FROM b JOIN f ON b.k IS NOT NULL AND b.k = f.k AND b.rn = 1 AND f.rn = 1
  `;
  const pairRes = await db.execute(sql.raw(joinSql));
  const pairs = (pairRes.rows as Array<{ base_id: string; file_id: string; key_value: string }>).map(
    (r) => ({
      baseCtid: String(r.base_id),
      fileCtid: String(r.file_id),
      keyValue: String(r.key_value ?? ''),
    })
  );
  const onlySql = `
    WITH b AS (
      SELECT NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') AS k FROM ${bFq} b
      WHERE NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') IS NOT NULL
    ),
    f AS (
      SELECT NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') AS k FROM ${fFq} f
      WHERE NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') IS NOT NULL
    ),
    bo AS (SELECT DISTINCT k FROM b EXCEPT SELECT DISTINCT k FROM f),
    fo AS (SELECT DISTINCT k FROM f EXCEPT SELECT DISTINCT k FROM b)
    SELECT
      (SELECT COUNT(*)::int FROM bo) AS base_only,
      (SELECT COUNT(*)::int FROM fo) AS file_only,
      (SELECT COALESCE(json_agg(k ORDER BY k), '[]'::json)
         FROM (SELECT k FROM bo ORDER BY k LIMIT ${Math.max(0, keyListLimit)}) t) AS base_keys,
      (SELECT COALESCE(json_agg(k ORDER BY k), '[]'::json)
         FROM (SELECT k FROM fo ORDER BY k LIMIT ${Math.max(0, keyListLimit)}) t) AS file_keys
  `;
  const only = (
    (await db.execute(sql.raw(onlySql))).rows as Array<{
      base_only: number;
      file_only: number;
      base_keys: unknown;
      file_keys: unknown;
    }>
  )[0];
  const parseKeys = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.map((x) => String(x ?? ''));
    if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p.map((x) => String(x ?? '')) : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return {
    pairs,
    baseOnly: Number(only?.base_only ?? 0),
    fileOnly: Number(only?.file_only ?? 0),
    baseOnlyKeys: parseKeys(only?.base_keys),
    fileOnlyKeys: parseKeys(only?.file_keys),
  };
}

async function matchBySpatial(
  base: CompareSourceMeta,
  file: CompareSourceMeta
): Promise<
  | { pairs: Array<{ baseCtid: string; fileCtid: string }>; baseOnly: number; fileOnly: number; note: string }
  | { error: string }
> {
  if (!base.geomColumn || !file.geomColumn) {
    return { error: '양쪽에 도형이 없어 위치로 맞출 수 없습니다. 식별키를 쓰세요.' };
  }
  if (base.geomKind === 'NONE') return { error: '기준 레이어 도형 종류를 알 수 없습니다.' };

  const bG = geomExpr('b', base.geomColumn, base.srid);
  const fG = geomExpr('f', file.geomColumn, file.srid);
  const bFq = `"${escIdent(base.schema)}"."${escIdent(base.table)}"`;
  const fFq = `"${escIdent(file.schema)}"."${escIdent(file.table)}"`;
  const orderDir = base.geomKind === 'POLYGON' ? 'DESC' : 'ASC';
  const note =
    base.geomKind === 'POINT'
      ? `점 ${POINT_TOL_M}m`
      : base.geomKind === 'LINE'
        ? `선 Hausdorff ${LINE_HAUSDORFF_M}m`
        : `면 겹침비 ${POLYGON_IOU}`;

  const score =
    base.geomKind === 'POINT'
      ? 'ST_Distance(b.g, f.g)'
      : base.geomKind === 'LINE'
        ? 'ST_HausdorffDistance(b.g, f.g)'
        : `CASE WHEN ST_Area(ST_Union(b.g, f.g)) <= 0 THEN 0
             ELSE ST_Area(ST_Intersection(b.g, f.g)) / NULLIF(ST_Area(ST_Union(b.g, f.g)),0) END`;
  const pred =
    base.geomKind === 'POINT'
      ? `ST_DWithin(b.g, f.g, ${POINT_TOL_M})`
      : base.geomKind === 'LINE'
        ? `ST_HausdorffDistance(b.g, f.g) <= ${LINE_HAUSDORFF_M}`
        : `ST_Intersects(b.g, f.g) AND (
             CASE WHEN ST_Area(ST_Union(b.g, f.g)) <= 0 THEN 0
             ELSE ST_Area(ST_Intersection(b.g, f.g)) / NULLIF(ST_Area(ST_Union(b.g, f.g)),0) END
           ) >= ${POLYGON_IOU}`;

  const summarySql = `
    WITH b AS (
      SELECT b.ctid::text AS rid, ${bG} AS g FROM ${bFq} b
      WHERE b."${escIdent(base.geomColumn)}" IS NOT NULL
    ),
    f AS (
      SELECT f.ctid::text AS rid, ${fG} AS g FROM ${fFq} f
      WHERE f."${escIdent(file.geomColumn)}" IS NOT NULL
    ),
    cand AS (
      SELECT b.rid AS base_id, f.rid AS file_id, ${score} AS score FROM b JOIN f ON ${pred}
    ),
    ranked AS (
      SELECT *, row_number() OVER (PARTITION BY base_id ORDER BY score ${orderDir}, file_id) AS rn_b,
             row_number() OVER (PARTITION BY file_id ORDER BY score ${orderDir}, base_id) AS rn_f
      FROM cand
    ),
    best AS (SELECT base_id, file_id FROM ranked WHERE rn_b = 1 AND rn_f = 1)
    SELECT
      (SELECT COUNT(*)::int FROM best) AS matched,
      (SELECT COUNT(*)::int FROM b) - (SELECT COUNT(*)::int FROM best) AS base_only,
      (SELECT COUNT(*)::int FROM f) - (SELECT COUNT(*)::int FROM best) AS file_only
  `;
  const summary = (
    (await db.execute(sql.raw(summarySql))).rows as Array<{
      matched: number;
      base_only: number;
      file_only: number;
    }>
  )[0];

  const pairSql = `
    WITH b AS (
      SELECT b.ctid::text AS rid, ${bG} AS g FROM ${bFq} b
      WHERE b."${escIdent(base.geomColumn)}" IS NOT NULL
    ),
    f AS (
      SELECT f.ctid::text AS rid, ${fG} AS g FROM ${fFq} f
      WHERE f."${escIdent(file.geomColumn)}" IS NOT NULL
    ),
    cand AS (
      SELECT b.rid AS base_id, f.rid AS file_id, ${score} AS score FROM b JOIN f ON ${pred}
    ),
    ranked AS (
      SELECT *, row_number() OVER (PARTITION BY base_id ORDER BY score ${orderDir}, file_id) AS rn_b,
             row_number() OVER (PARTITION BY file_id ORDER BY score ${orderDir}, base_id) AS rn_f
      FROM cand
    )
    SELECT base_id, file_id FROM ranked WHERE rn_b = 1 AND rn_f = 1 LIMIT 5000
  `;
  const pairs = (
    (await db.execute(sql.raw(pairSql))).rows as Array<{ base_id: string; file_id: string }>
  ).map((r) => ({ baseCtid: String(r.base_id), fileCtid: String(r.file_id) }));

  return {
    pairs,
    baseOnly: Number(summary?.base_only ?? 0),
    fileOnly: Number(summary?.file_only ?? 0),
    note,
  };
}

function pickTitle(cols: CompareColumn[], exclude?: string): string | null {
  for (const c of cols) {
    if (exclude && c.name.toLowerCase() === exclude.toLowerCase()) continue;
    if (TITLE_RE.test(`${c.name} ${c.korName}`)) return c.name;
  }
  return null;
}

/** 레이어 목록 */
export async function listCompareLayers(): Promise<{
  success: boolean;
  layers: Array<{ schema: string; table: string; korName: string; group: string }>;
  error?: string;
}> {
  try {
    const [defineRes, listRes] = await Promise.all([getDefineLayerTables(), getLayerTableList()]);
    const defineByName = new Map<string, { korName: string; group: string }>();
    for (const row of defineRes.tables ?? []) {
      const name = String((row as Record<string, unknown>).define_table_name ?? '').trim();
      if (!name || isTemp(name)) continue;
      defineByName.set(name.toLowerCase(), {
        korName: String((row as Record<string, unknown>).define_table_kor_name ?? '').trim(),
        group: String((row as Record<string, unknown>).define_table_group ?? '').trim(),
      });
    }
    const layers: Array<{ schema: string; table: string; korName: string; group: string }> = [];
    const seen = new Set<string>();
    for (const t of listRes.tables ?? []) {
      const schema = t.schema === 'public_layer' ? 'public_layer' : 'layer';
      const table = String(t.table ?? '').trim();
      if (!table || isTemp(table)) continue;
      const key = `${schema}:${table.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const def = defineByName.get(table.toLowerCase());
      layers.push({ schema, table, korName: def?.korName ?? '', group: def?.group ?? '' });
    }
    layers.sort((a, b) => {
      const g = a.group.localeCompare(b.group, 'ko');
      return g !== 0 ? g : (a.korName || a.table).localeCompare(b.korName || b.table, 'ko');
    });
    return { success: true, layers };
  } catch (e: unknown) {
    return { success: false, layers: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function removeUnderCompareTmp(relativePath: string): Promise<void> {
  const rel = String(relativePath ?? '')
    .trim()
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return;
  // 업로드는 compare_tmp/{ts}/파일 — 파일 또는 그 상위 폴더만 삭제
  if (!rel.startsWith('compare_tmp/') && rel !== 'compare_tmp') return;
  const abs = path.join(getDataDir(), ...rel.split('/').filter(Boolean));
  const root = path.join(getDataDir(), 'compare_tmp');
  const rootResolved = path.resolve(root);
  const absResolved = path.resolve(abs);
  if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) return;
  await fs.rm(absResolved, { recursive: true, force: true });
}

/** 비교 세션·업로드 임시파일 정리. 처음으로/다시 선택 시 purgeCompareTmp 로 전체 비움 */
export async function cleanupCompareSession(params: {
  sessionId?: string;
  table?: string;
  /** 업로드 상대경로(파일 또는 폴더) */
  uploadPaths?: string[];
  /** compare_tmp 전체 삭제 */
  purgeCompareTmp?: boolean;
}): Promise<{ success: boolean }> {
  const table =
    String(params?.table ?? '').trim() ||
    (params?.sessionId
      ? `_cmp_${String(params.sessionId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
      : '');
  if (table && isTemp(table)) await dropTemp(CMP_SCHEMA, table);
  if (params?.sessionId) {
    try {
      await removeUnderCompareTmp(`compare_tmp/${String(params.sessionId)}`);
    } catch {
      /* ignore */
    }
  }
  for (const p of params?.uploadPaths ?? []) {
    try {
      // 파일 경로면 상위 타임스탬프 폴더까지 제거
      const norm = String(p ?? '')
        .trim()
        .replace(/\\/g, '/');
      const parts = norm.split('/').filter(Boolean);
      if (parts[0] === 'compare_tmp' && parts.length >= 2) {
        await removeUnderCompareTmp(`compare_tmp/${parts[1]}`);
      } else {
        await removeUnderCompareTmp(norm);
      }
    } catch {
      /* ignore */
    }
  }
  if (params?.purgeCompareTmp) {
    try {
      const root = path.join(getDataDir(), 'compare_tmp');
      await fs.rm(root, { recursive: true, force: true });
      await fs.mkdir(root, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return { success: true };
}

/** 1차: 기준 레이어 + 파일 → 구조 비교 */
export async function compareStructure(params: {
  baseSchema: string;
  baseTable: string;
  baseLabel?: string;
  relativePath: string;
}): Promise<StructureCompareResult> {
  const baseSchema = params.baseSchema === 'public_layer' ? 'public_layer' : 'layer';
  const baseTable = String(params.baseTable ?? '').trim();
  const relativePath = String(params.relativePath ?? '').trim().replace(/^[/\\]+/, '');
  if (!baseTable) {
    return {
      success: false,
      error: '기준 레이어가 필요합니다.',
      base: emptyMeta(),
      file: emptyMeta(),
      sessionId: '',
      countSame: false,
      geomSame: false,
      sridSame: false,
      columns: [],
    };
  }
  if (!relativePath || relativePath.includes('..')) {
    return {
      success: false,
      error: '파일 경로가 올바르지 않습니다.',
      base: emptyMeta(),
      file: emptyMeta(),
      sessionId: '',
      countSame: false,
      geomSame: false,
      sridSame: false,
      columns: [],
    };
  }

  const sessionId = randomUUID().replace(/-/g, '').slice(0, 12);
  const tempTable = `_cmp_${sessionId}`;
  const absPath = path.join(getDataDir(), relativePath.replace(/\//g, path.sep));
  const ext = path.extname(absPath).toLowerCase();

  try {
    await fs.stat(absPath);
  } catch {
    return failStruct('업로드된 파일을 찾을 수 없습니다.');
  }

  try {
    await dropTemp(CMP_SCHEMA, tempTable);
    if (ext === '.shp') {
      const r = await createTableFromShp({
        pathOrResult: relativePath.replace(/\\/g, '/'),
        dbSchema: CMP_SCHEMA,
        tableNameOverride: tempTable,
        spatialIndex: false,
      });
      if (!r.success) return failStruct(r.error ?? 'SHP 적재 실패');
    } else if (ext === '.zip') {
      const extractDir = path.join(getDataDir(), 'compare_tmp', sessionId, 'unzip');
      await fs.mkdir(extractDir, { recursive: true });
      await extractZip(absPath, extractDir);
      const shpAbs = await findShp(extractDir);
      if (!shpAbs) return failStruct('ZIP 안에 SHP가 없습니다.');
      const relShp = path.relative(getDataDir(), shpAbs).replace(/\\/g, '/');
      const r = await createTableFromShp({
        pathOrResult: relShp,
        dbSchema: CMP_SCHEMA,
        tableNameOverride: tempTable,
        spatialIndex: false,
      });
      if (!r.success) return failStruct(r.error ?? 'ZIP(SHP) 적재 실패');
    } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.dbf') {
      const r = await importTabular(absPath, tempTable);
      if (!r.success) return failStruct(r.error ?? '표 적재 실패');
    } else {
      return failStruct('지원 형식: shp, zip, xlsx, xls, csv, dbf');
    }

    const [base, file] = await Promise.all([
      loadMeta(baseSchema, baseTable, params.baseLabel),
      loadMeta(CMP_SCHEMA, tempTable, path.basename(relativePath)),
    ]);
    const columns = buildColumnMatches(base, file);
    return {
      success: true,
      base,
      file,
      sessionId,
      countSame: base.rowCount === file.rowCount,
      geomSame: base.geomKind === file.geomKind,
      // 한쪽만 좌표계가 있으면 다름 (엑셀 등 도형 없음 = 좌표계 없음)
      sridSame:
        (base.srid == null && file.srid == null) ||
        (base.srid != null && file.srid != null && base.srid === file.srid),
      columns,
    };
  } catch (e: unknown) {
    await dropTemp(CMP_SCHEMA, tempTable);
    return failStruct(e instanceof Error ? e.message : String(e));
  }
}

function emptyMeta(): CompareSourceMeta {
  return {
    schema: '',
    table: '',
    label: '',
    rowCount: 0,
    geomKind: 'NONE',
    srid: null,
    geomColumn: null,
    columns: [],
    isTemp: false,
  };
}

function failStruct(error: string): StructureCompareResult {
  return {
    success: false,
    error,
    base: emptyMeta(),
    file: emptyMeta(),
    sessionId: '',
    countSame: false,
    geomSame: false,
    sridSame: false,
    columns: [],
  };
}

function emptyValues(error?: string): ValueCompareResult {
  return {
    success: !error,
    error,
    matched: 0,
    baseOnly: 0,
    fileOnly: 0,
    valueDiffCount: 0,
    pairNote: '',
    valueDiffs: [],
    columnDiffs: [],
    idDiffs: [],
    diffs: [],
    valueDiffItemTotal: 0,
    columnDiffTotal: 0,
    idDiffTotal: 0,
    diffTotal: 0,
    diffLimit: DIFF_LIMIT,
  };
}

function formatKeyDisplay(raw: string): string {
  let keyValue = String(raw ?? '').trim();
  if (/^-?\d+\.0+$/.test(keyValue)) keyValue = keyValue.replace(/\.0+$/, '');
  else {
    const n = Number(keyValue);
    if (Number.isFinite(n) && Number.isInteger(n) && /\.\d+/.test(keyValue)) {
      keyValue = String(n);
    }
  }
  return keyValue;
}

type DiffBag = { rows: ValueDiffRow[]; total: number; limit: number };

function makeBag(limit: number): DiffBag {
  return { rows: [], total: 0, limit };
}

function pushBag(bag: DiffBag, row: ValueDiffRow) {
  bag.total += 1;
  if (bag.rows.length < bag.limit) bag.rows.push(row);
}

/** 2차: 맞춰서 값·식별·컬럼 유무 차이 */
export async function compareValues(params: {
  baseSchema: string;
  baseTable: string;
  fileSchema: string;
  fileTable: string;
  columns: ColumnMatchRow[];
  pairMethod: PairMethod;
  baseKey?: string | null;
  fileKey?: string | null;
  /** 화면/엑셀 차이 행 상한. 0 이하면 전체(최대 10만) */
  diffLimit?: number | null;
}): Promise<ValueCompareResult> {
  try {
    const baseSchema = params.baseSchema === 'public_layer' ? 'public_layer' : 'layer';
    const fileSchema = params.fileSchema === 'public_layer' ? 'public_layer' : 'layer';
    const [base, file] = await Promise.all([
      loadMeta(baseSchema, String(params.baseTable).trim()),
      loadMeta(fileSchema, String(params.fileTable).trim()),
    ]);
    const mapped = activePairs(params.columns ?? []);
    const method = params.pairMethod ?? 'key';
    const baseKey = String(params.baseKey ?? '').trim();
    const fileKey = String(params.fileKey ?? '').trim();
    const rawLimit = params.diffLimit;
    const limit =
      rawLimit == null
        ? DIFF_LIMIT
        : rawLimit <= 0
          ? 100_000
          : Math.min(Math.floor(rawLimit), 100_000);
    // 탭별 각각 상한 (값다름 / 컬럼 / 식별)
    const valueBag = makeBag(limit);
    const columnBag = makeBag(limit);
    const idBag = makeBag(limit);

    for (const c of params.columns ?? []) {
      if (c.kind === 'baseOnly' && c.baseName) {
        const label = c.baseKor?.trim() ? `${c.baseKor} (${c.baseName})` : c.baseName;
        pushBag(columnBag, {
          kind: 'colBaseOnly',
          displayId: '—',
          column: c.baseName,
          columnLabel: label,
          baseValue: '컬럼 있음',
          fileValue: '없음',
        });
      } else if (c.kind === 'fileOnly' && c.fileName) {
        const label = c.fileKor?.trim() ? `${c.fileKor} (${c.fileName})` : c.fileName;
        pushBag(columnBag, {
          kind: 'colFileOnly',
          displayId: '—',
          column: c.fileName,
          columnLabel: label,
          baseValue: '없음',
          fileValue: '컬럼 있음',
        });
      }
    }

    let pairs: Array<{ baseCtid: string; fileCtid: string; keyValue?: string }> = [];
    let baseOnly = 0;
    let fileOnly = 0;
    let pairNote = '';
    let baseOnlyKeys: string[] = [];
    let fileOnlyKeys: string[] = [];

    if (method === 'key') {
      if (!baseKey || !fileKey) {
        return { ...emptyValues('식별키를 기준·파일 양쪽에서 고르세요.'), success: false };
      }
      // 식별 탭도 탭당 limit 건 미리보기 — 기준/파일 각각 limit 개
      const r = await matchByKey(base, file, baseKey, fileKey, limit);
      pairs = r.pairs;
      baseOnly = r.baseOnly;
      fileOnly = r.fileOnly;
      baseOnlyKeys = r.baseOnlyKeys;
      fileOnlyKeys = r.fileOnlyKeys;
      pairNote = `식별키 ${baseKey} ↔ ${fileKey}`;
    } else {
      const r = await matchBySpatial(base, file);
      if ('error' in r) {
        return { ...emptyValues(r.error), success: false };
      }
      pairs = r.pairs;
      baseOnly = r.baseOnly;
      fileOnly = r.fileOnly;
      pairNote = r.note;
    }

    let valueDiffCount = 0;
    const titleCol = pickTitle(base.columns, baseKey || undefined);
    const bFq = `"${escIdent(base.schema)}"."${escIdent(base.table)}"`;
    const fFq = `"${escIdent(file.schema)}"."${escIdent(file.table)}"`;

    if (mapped.length > 0 && pairs.length > 0 && method === 'key' && baseKey && fileKey) {
      const titleExpr = titleCol
        ? `NULLIF(TRIM(b."${escIdent(titleCol)}"::text), '')`
        : 'NULL::text';
      const pairedCte = `
        WITH bkeys AS (
          SELECT b.ctid AS base_rid, NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') AS k,
                 row_number() OVER (
                   PARTITION BY NULLIF(TRIM(b."${escIdent(baseKey)}"::text), '') ORDER BY b.ctid
                 ) AS rn
          FROM ${bFq} b
        ),
        fkeys AS (
          SELECT f.ctid AS file_rid, NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') AS k,
                 row_number() OVER (
                   PARTITION BY NULLIF(TRIM(f."${escIdent(fileKey)}"::text), '') ORDER BY f.ctid
                 ) AS rn
          FROM ${fFq} f
        ),
        paired AS (
          SELECT bkeys.base_rid, fkeys.file_rid, bkeys.k
          FROM bkeys
          JOIN fkeys ON bkeys.k IS NOT NULL AND bkeys.k = fkeys.k AND bkeys.rn = 1 AND fkeys.rn = 1
        )
      `;
      const unions = mapped
        .map(
          (m) => `
        SELECT
          COALESCE(
            NULLIF(TRIM(BOTH FROM COALESCE(p.k, '')), ''),
            ${titleExpr},
            '식별값 없음'
          ) AS display_id,
          '${escLit(m.baseName)}' AS column_name,
          '${escLit(m.label)}' AS column_label,
          COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(b."${escIdent(m.baseName)}"::text, '')), ''), '') AS base_value,
          COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(f."${escIdent(m.fileName)}"::text, '')), ''), '') AS file_value,
          p.k AS pair_key
        FROM paired p
        JOIN ${bFq} b ON b.ctid = p.base_rid
        JOIN ${fFq} f ON f.ctid = p.file_rid
        WHERE ${sqlNormalizeCompareExpr(`b."${escIdent(m.baseName)}"::text`)}
          IS DISTINCT FROM
              ${sqlNormalizeCompareExpr(`f."${escIdent(m.fileName)}"::text`)}`
        )
        .join('\nUNION ALL\n');
      try {
        const countRes = await db.execute(
          sql.raw(`
            ${pairedCte},
            diffs AS (${unions})
            SELECT
              (SELECT COUNT(*)::int FROM diffs) AS item_cnt,
              (SELECT COUNT(DISTINCT pair_key)::int FROM diffs) AS pair_cnt
          `)
        );
        const cntRow = (countRes.rows as Array<{ item_cnt: number; pair_cnt: number }>)[0];
        valueDiffCount = Number(cntRow?.pair_cnt ?? 0);
        const itemCnt = Number(cntRow?.item_cnt ?? 0);
        valueBag.total = itemCnt;
        if (valueBag.limit > 0 && itemCnt > 0) {
          const listRes = await db.execute(
            sql.raw(`
              ${pairedCte},
              diffs AS (${unions})
              SELECT display_id, column_name, column_label, base_value, file_value
              FROM diffs
              ORDER BY display_id, column_name
              LIMIT ${valueBag.limit}
            `)
          );
          for (const r of listRes.rows as Array<{
            display_id: string;
            column_name: string;
            column_label: string;
            base_value: string;
            file_value: string;
          }>) {
            valueBag.rows.push({
              kind: 'value',
              displayId: formatKeyDisplay(String(r.display_id ?? '')) || '식별값 없음',
              column: String(r.column_name ?? ''),
              columnLabel: String(r.column_label ?? ''),
              baseValue: String(r.base_value ?? ''),
              fileValue: String(r.file_value ?? ''),
            });
          }
        }
      } catch {
        /* 값 비교 SQL 실패 시 식별/컬럼 차이는 유지 */
      }
    } else if (mapped.length > 0) {
      for (const p of pairs) {
        const bCols = mapped
          .map((m) => `b."${escIdent(m.baseName)}" AS b_${escIdent(m.baseName)}`)
          .join(', ');
        const fCols = mapped
          .map((m) => `f."${escIdent(m.fileName)}" AS f_${escIdent(m.fileName)}`)
          .join(', ');
        const titleSel = titleCol
          ? `, b."${escIdent(titleCol)}" AS _title`
          : ', NULL::text AS _title';
        try {
          const res = await db.execute(
            sql.raw(
              `SELECT ${bCols}, ${fCols}${titleSel}
               FROM ${bFq} b, ${fFq} f
               WHERE b.ctid = '${escLit(p.baseCtid)}'::tid AND f.ctid = '${escLit(p.fileCtid)}'::tid
               LIMIT 1`
            )
          );
          const row = (res.rows as Record<string, unknown>[])[0];
          if (!row) continue;
          const title = row._title == null ? '' : String(row._title).trim();
          const keyValue = formatKeyDisplay(p.keyValue ?? '');
          const displayId = [keyValue, title].filter(Boolean).join(' · ') || '식별값 없음';
          let rowDiff = false;
          for (const m of mapped) {
            const bv = row[`b_${m.baseName}`];
            const fv = row[`f_${m.fileName}`];
            const bs = bv == null ? '' : String(bv).trim();
            const fs = fv == null ? '' : String(fv).trim();
            if (normalizeCompareValue(bs) !== normalizeCompareValue(fs)) {
              rowDiff = true;
              pushBag(valueBag, {
                kind: 'value',
                displayId,
                column: m.baseName,
                columnLabel: m.label,
                baseValue: bs,
                fileValue: fs,
              });
            }
          }
          if (rowDiff) valueDiffCount += 1;
        } catch {
          continue;
        }
      }
    }

    // 식별 탭 200건: 기준만·파일만 반반(남는 칸은 반대쪽에서 채움)
    const idHalf = Math.max(1, Math.floor(idBag.limit / 2));
    let baseListed = 0;
    for (const k of baseOnlyKeys) {
      if (baseListed >= idHalf || idBag.rows.length >= idBag.limit) break;
      idBag.rows.push({
        kind: 'baseOnly',
        displayId: formatKeyDisplay(k) || '식별값 없음',
        column: '_base_only',
        columnLabel: '기준에만 있는 식별',
        baseValue: formatKeyDisplay(k),
        fileValue: '',
      });
      baseListed += 1;
    }
    for (const k of fileOnlyKeys) {
      if (idBag.rows.length >= idBag.limit) break;
      idBag.rows.push({
        kind: 'fileOnly',
        displayId: formatKeyDisplay(k) || '식별값 없음',
        column: '_file_only',
        columnLabel: '파일에만 있는 식별',
        baseValue: '',
        fileValue: formatKeyDisplay(k),
      });
    }
    // 파일쪽이 부족하면 기준만으로 남은 칸 채움
    if (idBag.rows.length < idBag.limit) {
      for (const k of baseOnlyKeys.slice(baseListed)) {
        if (idBag.rows.length >= idBag.limit) break;
        idBag.rows.push({
          kind: 'baseOnly',
          displayId: formatKeyDisplay(k) || '식별값 없음',
          column: '_base_only',
          columnLabel: '기준에만 있는 식별',
          baseValue: formatKeyDisplay(k),
          fileValue: '',
        });
      }
    }
    idBag.total = baseOnly + fileOnly;

    const diffs = [...valueBag.rows, ...columnBag.rows, ...idBag.rows];
    const diffTotal = valueBag.total + columnBag.total + idBag.total;

    return {
      success: true,
      matched: pairs.length,
      baseOnly,
      fileOnly,
      valueDiffCount,
      pairNote,
      valueDiffs: valueBag.rows,
      columnDiffs: columnBag.rows,
      idDiffs: idBag.rows,
      diffs,
      valueDiffItemTotal: valueBag.total,
      columnDiffTotal: columnBag.total,
      idDiffTotal: idBag.total,
      diffTotal,
      diffLimit: limit,
    };
  } catch (e: unknown) {
    return { ...emptyValues(e instanceof Error ? e.message : String(e)), success: false };
  }
}

function diffKindLabel(kind: ValueDiffRow['kind']): string {
  switch (kind) {
    case 'value':
      return '값다름';
    case 'baseOnly':
      return '식별·기준만';
    case 'fileOnly':
      return '식별·파일만';
    case 'colBaseOnly':
      return '컬럼·기준만';
    case 'colFileOnly':
      return '컬럼·파일만';
    default:
      return kind;
  }
}

/** 엑셀 내보내기 — 값 차이는 상한 없이 다시 비교해 전체 기록 */
export async function exportCompareExcel(params: {
  structure: StructureCompareResult;
  values?: ValueCompareResult | null;
  pairMethod?: PairMethod;
  baseKey?: string | null;
  fileKey?: string | null;
  columns?: ColumnMatchRow[];
}): Promise<{ success: boolean; base64?: string; fileName?: string; error?: string }> {
  const structure = params?.structure;
  if (!structure?.success) return { success: false, error: '내보낼 구조 결과가 없습니다.' };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['항목', '기준', '파일', '같음'],
      ['건수', structure.base.rowCount, structure.file.rowCount, structure.countSame ? 'Y' : 'N'],
      [
        '도형',
        structure.base.geomKind,
        structure.file.geomKind,
        structure.geomSame ? 'Y' : 'N',
      ],
      [
        '좌표계',
        structure.base.srid ?? '없음',
        structure.file.srid ?? '없음',
        structure.sridSame ? 'Y' : 'N',
      ],
    ]),
    '구조'
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['구분', '기준칸', '파일칸', '기준한글', '파일한글'],
      ...structure.columns.map((c) => [
        c.kind,
        c.baseName ?? '',
        c.fileName ?? '',
        c.baseKor,
        c.fileKor,
      ]),
    ]),
    '컬럼'
  );

  let values = params.values;
  const canFull =
    values?.success &&
    params.pairMethod &&
    Array.isArray(params.columns) &&
    structure.base.table &&
    structure.file.table;
  if (canFull) {
    values = await compareValues({
      baseSchema: structure.base.schema,
      baseTable: structure.base.table,
      fileSchema: structure.file.schema,
      fileTable: structure.file.table,
      columns: params.columns!,
      pairMethod: params.pairMethod!,
      baseKey: params.baseKey,
      fileKey: params.fileKey,
      diffLimit: 0,
    });
  }

  if (values?.success) {
    const valueRows = values.valueDiffs?.length
      ? values.valueDiffs
      : values.diffs.filter((d) => d.kind === 'value' || !d.kind);
    const columnRows = values.columnDiffs?.length
      ? values.columnDiffs
      : values.diffs.filter((d) => d.kind === 'colBaseOnly' || d.kind === 'colFileOnly');
    const idRows = values.idDiffs?.length
      ? values.idDiffs
      : values.diffs.filter((d) => d.kind === 'baseOnly' || d.kind === 'fileOnly');

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['맞춤', '기준만(식별)', '파일만(식별)', '값다른짝', '값다름항목', '컬럼갭', '식별갭', '비고'],
        [
          values.matched,
          values.baseOnly,
          values.fileOnly,
          values.valueDiffCount,
          values.valueDiffItemTotal ?? valueRows.length,
          values.columnDiffTotal ?? columnRows.length,
          values.idDiffTotal ?? idRows.length,
          values.pairNote,
        ],
      ]),
      '맞춤요약'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['식별', '항목', '기준값', '파일값'],
        ...valueRows.map((d) => [d.displayId, d.columnLabel, d.baseValue, d.fileValue]),
      ]),
      '값다름'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['구분', '항목', '기준', '파일'],
        ...columnRows.map((d) => [
          diffKindLabel(d.kind),
          d.columnLabel,
          d.baseValue,
          d.fileValue,
        ]),
      ]),
      '컬럼유무'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['구분', '식별값', '기준', '파일'],
        ...idRows.map((d) => [
          d.kind === 'baseOnly' ? '기준에만' : '파일에만',
          d.displayId,
          d.baseValue,
          d.fileValue,
        ]),
      ]),
      '식별'
    );
  }

  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return {
    success: true,
    base64: buf,
    fileName: `레이어파일비교_${structure.base.table}_${ts}.xlsx`,
  };
}
