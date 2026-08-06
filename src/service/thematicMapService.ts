/**
 * 주제도·소유구분: 정의(공통) + DB 부모 존재 + 분할 조건에 실제 행이 있는 자식만 노출
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import tables from '@/config/defineLayer/tables.json';
import { getLayerTableList } from './devTestService';
import { resolveLayerPhysicalRelName, sanitizeDefineLayerRowFilter } from './standardService';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

const THEMATIC_MAP_GROUP_ALLOW = new Set([
  '도시계획시설',
  '용도구역',
  '용도지구',
  '용도지역',
  '주제도(기타)',
  '지구단위계획구역',
  '행정제한/특별고시',
]);

const OWNERSHIP_GROUP_NAME = '소유자정보';

function isThematicMapGroup(group: string): boolean {
  if (!group) return false;
  if (THEMATIC_MAP_GROUP_ALLOW.has(group)) return true;
  return group.startsWith('주제도');
}

function isOwnershipGroup(group: string): boolean {
  return group === OWNERSHIP_GROUP_NAME;
}

function escIdent(name: string): string {
  return name.replace(/"/g, '""');
}

function escLit(s: string): string {
  return s.replace(/'/g, "''");
}

type Candidate = {
  tableName: string;
  sourceTable: string;
  divQuery?: string;
};

function collectCandidates(
  publicTables: Set<string>,
  isGroup: (group: string) => boolean
): Candidate[] {
  const rows = tables as DefineTableRow[];
  const parentNames = new Set<string>();
  for (const t of rows) {
    const parent = String(t.define_table_parents_layer ?? '').trim();
    if (parent) parentNames.add(parent.toLowerCase());
  }

  const out: Candidate[] = [];
  for (const t of rows) {
    const schema = String(t.define_table_schema ?? '').trim();
    if (schema && schema !== 'public_layer') continue;

    const group = String(t.define_table_group ?? '').trim();
    if (!isGroup(group)) continue;

    const tableName = String(t.define_table_name ?? '').trim();
    if (!tableName) continue;

    const layerName = String(t.define_table_kor_name ?? tableName).trim();
    const parentTableName = String(t.define_table_parents_layer ?? '').trim();
    const divQuery = String(t.define_table_div_query ?? '').trim();

    if (parentNames.has(tableName.toLowerCase())) continue;
    if (!parentTableName && layerName.startsWith('(연속주제)')) continue;

    if (parentTableName) {
      if (!publicTables.has(parentTableName.toLowerCase())) continue;
      if (!divQuery) continue;
      out.push({ tableName, sourceTable: parentTableName, divQuery });
    } else {
      if (!publicTables.has(tableName.toLowerCase())) continue;
      out.push({ tableName, sourceTable: tableName });
    }
  }
  return out;
}

async function listAvailableLayerNames(isGroup: (group: string) => boolean) {
  try {
    const listRes = await getLayerTableList();
    if (!listRes.success) {
      return { success: false as const, error: listRes.error ?? '테이블 목록 조회 실패', tableNames: [] as string[] };
    }

    const publicTables = new Set(
      (listRes.tables ?? [])
        .filter((t) => String(t.schema ?? '').toLowerCase() === 'public_layer')
        .map((t) => String(t.table ?? '').trim().toLowerCase())
        .filter(Boolean)
    );

    const candidates = collectCandidates(publicTables, isGroup);
    if (candidates.length === 0) {
      return { success: true as const, tableNames: [] as string[] };
    }

    const physicalCache = new Map<string, string | null>();
    const resolvePhysical = async (logical: string) => {
      const key = logical.toLowerCase();
      if (physicalCache.has(key)) return physicalCache.get(key) ?? null;
      const phys = await resolveLayerPhysicalRelName('public_layer', logical);
      physicalCache.set(key, phys);
      return phys;
    };

    for (const c of candidates) {
      await resolvePhysical(c.sourceTable);
    }

    const selectParts: string[] = [];
    for (const c of candidates) {
      const physical = physicalCache.get(c.sourceTable.toLowerCase());
      if (!physical) continue;

      const litName = escLit(c.tableName);
      const qTable = `"public_layer"."${escIdent(physical)}"`;

      if (c.divQuery) {
        const filter = sanitizeDefineLayerRowFilter(c.divQuery);
        if (!filter) continue;
        selectParts.push(
          `SELECT '${litName}' AS name WHERE EXISTS (SELECT 1 FROM ${qTable} WHERE (${filter}) LIMIT 1)`
        );
      } else {
        selectParts.push(
          `SELECT '${litName}' AS name WHERE EXISTS (SELECT 1 FROM ${qTable} LIMIT 1)`
        );
      }
    }

    if (selectParts.length === 0) {
      return { success: true as const, tableNames: [] as string[] };
    }

    const tableNames: string[] = [];
    const CHUNK = 40;
    for (let i = 0; i < selectParts.length; i += CHUNK) {
      const chunk = selectParts.slice(i, i + CHUNK);
      const res = await db.execute(sql.raw(chunk.join(' UNION ALL ')));
      for (const row of res.rows as Array<{ name?: string }>) {
        const n = String(row?.name ?? '').trim();
        if (n) tableNames.push(n);
      }
    }

    return { success: true as const, tableNames };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false as const, error: msg, tableNames: [] as string[] };
  }
}

/**
 * 주제도 UI에 올릴 define 테이블명 목록.
 */
export async function listAvailableThematicMapLayerNames() {
  return listAvailableLayerNames(isThematicMapGroup);
}

/**
 * 소유구분 UI에 올릴 define 테이블명 목록 (소유자정보 그룹).
 */
export async function listAvailableOwnershipLayerNames() {
  return listAvailableLayerNames(isOwnershipGroup);
}

const JIMOK_GROUP_NAME = '지목';

function isJimokGroup(group: string): boolean {
  return group === JIMOK_GROUP_NAME;
}

/**
 * 지목 UI: tables.json «지목» 그룹 + 부모 존재 + 분할 조건에 데이터가 있는 테이블만.
 */
export async function listAvailableJimokLayerNames() {
  return listAvailableLayerNames(isJimokGroup);
}

/** 건물·도로 패널 후보 (tables.json·DB 교집합 대상) */
const BUILDING_ROAD_TABLE_CANDIDATES = [
  'tl_sgco_rnadr_mst',
  'tl_spbd_entrc',
  'tl_sgco_rnadr_dong',
  'tl_spbd_entrc_dong',
  'tl_sprd_rw',
  'tl_sprd_manage',
] as const;

/**
 * 건물·도로 UI: tables.json 등록 + public_layer 존재 + 행 1건 이상인 테이블만.
 */
export async function listAvailableBuildingRoadLayerNames() {
  try {
    const defineNames = new Set(
      (tables as DefineTableRow[])
        .map((t) => String(t.define_table_name ?? '').trim().toLowerCase())
        .filter(Boolean)
    );

    const listRes = await getLayerTableList();
    if (!listRes.success) {
      return {
        success: false as const,
        error: listRes.error ?? '테이블 목록 조회 실패',
        tableNames: [] as string[],
      };
    }

    const publicTables = new Set(
      (listRes.tables ?? [])
        .filter((t) => String(t.schema ?? '').toLowerCase() === 'public_layer')
        .map((t) => String(t.table ?? '').trim().toLowerCase())
        .filter(Boolean)
    );

    const candidates = BUILDING_ROAD_TABLE_CANDIDATES.filter(
      (name) => defineNames.has(name.toLowerCase()) && publicTables.has(name.toLowerCase())
    );
    if (candidates.length === 0) {
      return { success: true as const, tableNames: [] as string[] };
    }

    const selectParts: string[] = [];
    for (const name of candidates) {
      const physical = await resolveLayerPhysicalRelName('public_layer', name);
      if (!physical) continue;
      const litName = escLit(name);
      const qTable = `"public_layer"."${escIdent(physical)}"`;
      selectParts.push(
        `SELECT '${litName}' AS name WHERE EXISTS (SELECT 1 FROM ${qTable} LIMIT 1)`
      );
    }

    if (selectParts.length === 0) {
      return { success: true as const, tableNames: [] as string[] };
    }

    const res = await db.execute(sql.raw(selectParts.join(' UNION ALL ')));
    const tableNames: string[] = [];
    for (const row of res.rows as Array<{ name?: string }>) {
      const n = String(row?.name ?? '').trim();
      if (n) tableNames.push(n);
    }
    return { success: true as const, tableNames };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false as const, error: msg, tableNames: [] as string[] };
  }
}
