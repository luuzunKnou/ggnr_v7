/**
 * 레이어별 SHP·엑셀 / 첨부 다운로드 승인 주체 (layer_download_auth)
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import {
  LDA_AUTH_ADMIN,
  LDA_AUTH_AUTO,
  LDA_AUTH_NONE,
  LDA_AUTH_TEAM,
  LAYER_DOWNLOAD_AUTH_VALUES,
  layerDownloadAuth,
  type LayerDownloadAuthValue,
} from '@/database/schema/layer_download_auth';
import { ensureLayerDownloadAuthTable } from '@/service/ensureLayerAppTables';

const BACKUP_RE = /_bak\d*$/i;
const TEMP_RE = /^_(cmp_|sync_|rctmp_)/i;

export function normalizeLayerDownloadAuth(raw: unknown): LayerDownloadAuthValue {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ((LAYER_DOWNLOAD_AUTH_VALUES as readonly string[]).includes(v)) {
    return v as LayerDownloadAuthValue;
  }
  return LDA_AUTH_AUTO;
}

export function normalizeLayerSchema(raw: unknown): 'layer' | 'public_layer' {
  return String(raw ?? '').trim().toLowerCase() === 'public_layer'
    ? 'public_layer'
    : 'layer';
}

/** none < auto < team < admin — 여러 레이어일 때 가장 엄격한 값 */
export function pickStrictestDownloadAuth(
  values: LayerDownloadAuthValue[]
): LayerDownloadAuthValue {
  let best: LayerDownloadAuthValue = LDA_AUTH_NONE;
  let score = -1;
  const rank: Record<LayerDownloadAuthValue, number> = {
    [LDA_AUTH_NONE]: 0,
    [LDA_AUTH_AUTO]: 1,
    [LDA_AUTH_TEAM]: 2,
    [LDA_AUTH_ADMIN]: 3,
  };
  for (const v of values) {
    const n = normalizeLayerDownloadAuth(v);
    if (rank[n] > score) {
      score = rank[n];
      best = n;
    }
  }
  return best;
}

/**
 * tables.json(defineLayer) 기준 기본값.
 * SHP/엑셀=auto, 첨부=none. 레이어명·한글명·그룹에 «민원»이면 SHP/엑셀=team.
 */
export function resolveDownloadAuthDefaultsFromDefine(
  row: Record<string, unknown> | null | undefined
): { shpExcel: LayerDownloadAuthValue; attachment: LayerDownloadAuthValue } {
  const name = String(row?.define_table_name ?? '');
  const kor = String(row?.define_table_kor_name ?? '');
  const group = String(row?.define_table_group ?? '');
  const isMinwon =
    name.includes('민원') || kor.includes('민원') || group.includes('민원');

  const shpRaw = String(row?.define_table_shp_excel ?? '').trim();
  const attachRaw = String(row?.define_table_attachment ?? '').trim();

  const shpExcel = shpRaw
    ? normalizeLayerDownloadAuth(shpRaw)
    : isMinwon
      ? LDA_AUTH_TEAM
      : LDA_AUTH_AUTO;
  const attachment = attachRaw
    ? normalizeLayerDownloadAuth(attachRaw)
    : LDA_AUTH_NONE;

  return { shpExcel, attachment };
}

async function loadDefineAuthMap(): Promise<
  Map<string, { shpExcel: LayerDownloadAuthValue; attachment: LayerDownloadAuthValue }>
> {
  const map = new Map<
    string,
    { shpExcel: LayerDownloadAuthValue; attachment: LayerDownloadAuthValue }
  >();
  try {
    const { getDefineLayerTables } = await import('@/service/devTestService');
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !Array.isArray(defineRes.tables)) return map;
    for (const raw of defineRes.tables) {
      const t = raw as Record<string, unknown>;
      const tableName = String(t.define_table_name ?? '').trim();
      if (!tableName) continue;
      const schema = normalizeLayerSchema(t.define_table_schema);
      const defaults = resolveDownloadAuthDefaultsFromDefine(t);
      map.set(`${schema}:${tableName.toLowerCase()}`, defaults);
      if (!map.has(`*:${tableName.toLowerCase()}`)) {
        map.set(`*:${tableName.toLowerCase()}`, defaults);
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** 분할 레이어 → 부모 테이블명 (소문자 키) */
async function loadParentLayerMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { getDefineLayerTables } = await import('@/service/devTestService');
    const defineRes = await getDefineLayerTables();
    if (!defineRes.success || !Array.isArray(defineRes.tables)) return map;
    for (const raw of defineRes.tables) {
      const t = raw as Record<string, unknown>;
      const tableName = String(t.define_table_name ?? '').trim();
      const parent = String(t.define_table_parents_layer ?? '').trim();
      if (!tableName || !parent) continue;
      map.set(tableName.toLowerCase(), parent);
    }
  } catch {
    /* ignore */
  }
  return map;
}

async function findAuthRow(schema: 'layer' | 'public_layer', tableName: string) {
  const name = tableName.trim();
  if (!name) return null;
  const [exact] = await db
    .select()
    .from(layerDownloadAuth)
    .where(
      and(
        eq(layerDownloadAuth.tableSchema, schema),
        eq(layerDownloadAuth.tableName, name)
      )
    )
    .limit(1);
  if (exact) return exact;
  // 대소문자 불일치 대비
  const rows = await db
    .select()
    .from(layerDownloadAuth)
    .where(
      and(
        eq(layerDownloadAuth.tableSchema, schema),
        sql`lower(${layerDownloadAuth.tableName}) = ${name.toLowerCase()}`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function seedMissingFromGeometryColumns(): Promise<void> {
  const result = await db.execute(
    sql`
      SELECT f_table_schema, f_table_name
      FROM geometry_columns
      WHERE f_table_schema IN ('layer', 'public_layer')
    `
  );
  const rows = (result.rows ?? []) as Array<{
    f_table_schema?: string;
    f_table_name?: string;
  }>;
  const defineMap = await loadDefineAuthMap();
  const now = new Date().toISOString();
  for (const r of rows) {
    const schema = normalizeLayerSchema(r.f_table_schema);
    const table = String(r.f_table_name ?? '').trim();
    if (!table || BACKUP_RE.test(table) || TEMP_RE.test(table)) continue;
    const defaults =
      defineMap.get(`${schema}:${table.toLowerCase()}`) ??
      defineMap.get(`*:${table.toLowerCase()}`) ??
      resolveDownloadAuthDefaultsFromDefine({
        define_table_name: table,
      });
    await db
      .insert(layerDownloadAuth)
      .values({
        tableSchema: schema,
        tableName: table,
        shpExcel: defaults.shpExcel,
        attachment: defaults.attachment,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}

export async function ensureLayerDownloadAuthReady(): Promise<void> {
  await ensureLayerDownloadAuthTable();
  try {
    await seedMissingFromGeometryColumns();
  } catch {
    /* seed best-effort */
  }
}

export type LayerDownloadAuthRow = {
  tableSchema: string;
  tableName: string;
  shpExcel: LayerDownloadAuthValue;
  attachment: LayerDownloadAuthValue;
};

export async function listLayerDownloadAuth(): Promise<{
  success: true;
  rows: LayerDownloadAuthRow[];
} | {
  success: false;
  error: string;
  rows: LayerDownloadAuthRow[];
}> {
  try {
    await ensureLayerDownloadAuthReady();
    const rows = await db.select().from(layerDownloadAuth);
    return {
      success: true,
      rows: rows.map((r) => ({
        tableSchema: String(r.tableSchema ?? ''),
        tableName: String(r.tableName ?? ''),
        shpExcel: normalizeLayerDownloadAuth(r.shpExcel),
        attachment: normalizeLayerDownloadAuth(r.attachment),
      })),
    };
  } catch (e: unknown) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      rows: [],
    };
  }
}

export async function getLayerDownloadAuth(params: {
  schema?: string;
  tableName?: string;
  /** 부모 재귀 조회 생략 (내부용) */
  skipParent?: boolean;
}): Promise<{
  success: true;
  shpExcel: LayerDownloadAuthValue;
  attachment: LayerDownloadAuthValue;
} | {
  success: false;
  error: string;
}> {
  const tableName = String(params.tableName ?? '').trim();
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const schema = normalizeLayerSchema(params.schema);
  try {
    await ensureLayerDownloadAuthReady();
    const row = await findAuthRow(schema, tableName);
    let shpExcel: LayerDownloadAuthValue;
    let attachment: LayerDownloadAuthValue;
    if (!row) {
      const defineMap = await loadDefineAuthMap();
      const defaults =
        defineMap.get(`${schema}:${tableName.toLowerCase()}`) ??
        defineMap.get(`*:${tableName.toLowerCase()}`) ??
        resolveDownloadAuthDefaultsFromDefine({ define_table_name: tableName });
      const now = new Date().toISOString();
      await db
        .insert(layerDownloadAuth)
        .values({
          tableSchema: schema,
          tableName,
          shpExcel: defaults.shpExcel,
          attachment: defaults.attachment,
          updatedAt: now,
        })
        .onConflictDoNothing();
      shpExcel = defaults.shpExcel;
      attachment = defaults.attachment;
    } else {
      shpExcel = normalizeLayerDownloadAuth(row.shpExcel);
      attachment = normalizeLayerDownloadAuth(row.attachment);
    }

    // 분할 자식이면 부모 권한과 합쳐 더 엄격한 쪽 적용 (부모 admin → 자식 다운로드에도 반영)
    if (!params.skipParent) {
      const parentMap = await loadParentLayerMap();
      const parent = parentMap.get(tableName.toLowerCase());
      if (parent && parent.toLowerCase() !== tableName.toLowerCase()) {
        const parentAuth = await getLayerDownloadAuth({
          schema,
          tableName: parent,
          skipParent: true,
        });
        if (parentAuth.success) {
          shpExcel = pickStrictestDownloadAuth([shpExcel, parentAuth.shpExcel]);
          attachment = pickStrictestDownloadAuth([
            attachment,
            parentAuth.attachment,
          ]);
        }
      }
    }

    return { success: true, shpExcel, attachment };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function upsertLayerDownloadAuth(params: {
  schema?: string;
  tableName?: string;
  field?: 'shpExcel' | 'attachment' | 'shp_excel' | 'attachment';
  value?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const tableName = String(params.tableName ?? '').trim();
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const schema = normalizeLayerSchema(params.schema);
  const fieldRaw = String(params.field ?? '').trim();
  const isShp = fieldRaw === 'shpExcel' || fieldRaw === 'shp_excel';
  const isAttach = fieldRaw === 'attachment';
  if (!isShp && !isAttach) {
    return { success: false, error: 'field는 shpExcel 또는 attachment 여야 합니다.' };
  }
  const value = normalizeLayerDownloadAuth(params.value);
  const now = new Date().toISOString();
  try {
    await ensureLayerDownloadAuthReady();
    const existing = await db
      .select()
      .from(layerDownloadAuth)
      .where(
        and(
          eq(layerDownloadAuth.tableSchema, schema),
          eq(layerDownloadAuth.tableName, tableName)
        )
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(layerDownloadAuth)
        .set(
          isShp
            ? { shpExcel: value, updatedAt: now }
            : { attachment: value, updatedAt: now }
        )
        .where(
          and(
            eq(layerDownloadAuth.tableSchema, schema),
            eq(layerDownloadAuth.tableName, tableName)
          )
        );
    } else {
      await db.insert(layerDownloadAuth).values({
        tableSchema: schema,
        tableName,
        shpExcel: isShp ? value : LDA_AUTH_AUTO,
        attachment: isAttach ? value : LDA_AUTH_NONE,
        updatedAt: now,
      });
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 여러 테이블의 attachment(또는 shpExcel) 중 가장 엄격한 값 (부모 권한 포함) */
export async function resolveStrictestAuthForTables(params: {
  tables: { schema?: string; tableName: string }[];
  kind: 'shpExcel' | 'attachment';
}): Promise<LayerDownloadAuthValue> {
  if (!params.tables.length) return LDA_AUTH_AUTO;
  const parentMap = await loadParentLayerMap();
  const seen = new Set<string>();
  const expanded: { schema?: string; tableName: string }[] = [];
  for (const t of params.tables) {
    const name = String(t.tableName ?? '').trim();
    if (!name) continue;
    const schema = normalizeLayerSchema(t.schema);
    const selfKey = `${schema}:${name.toLowerCase()}`;
    if (!seen.has(selfKey)) {
      seen.add(selfKey);
      expanded.push({ schema, tableName: name });
    }
    const parent = parentMap.get(name.toLowerCase());
    if (parent) {
      const parentKey = `${schema}:${parent.toLowerCase()}`;
      if (!seen.has(parentKey)) {
        seen.add(parentKey);
        expanded.push({ schema, tableName: parent });
      }
    }
  }
  const values: LayerDownloadAuthValue[] = [];
  for (const t of expanded) {
    const res = await getLayerDownloadAuth({
      schema: t.schema,
      tableName: t.tableName,
      skipParent: true,
    });
    if (!res.success) {
      values.push(LDA_AUTH_AUTO);
      continue;
    }
    values.push(params.kind === 'shpExcel' ? res.shpExcel : res.attachment);
  }
  return values.length ? pickStrictestDownloadAuth(values) : LDA_AUTH_AUTO;
}
