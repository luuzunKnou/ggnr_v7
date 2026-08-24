/**
 * 토지행정망 SHAPE(KRAS000038) — 지적·읍면동·주제도 원본만 받아 public_layer(또는 layer) 교체.
 * 6세대는 목록 전체를 받았으나, 여기서는 지도에 쓰는 레이어만 받는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import tables from '@/config/defineLayer/tables.json';
import { pool } from '@/database/db';
import { withAdvisoryLock } from '@/integrations/core';
import { appendLinkageError, formatLinkageError } from '@/integrations/linkageErrorLog';
import {
  buildKrasQuery,
  fetchKrasBytes,
  krasRequestUrl,
  requireKrasConn,
  shouldStopAll,
  type KrasConn,
} from '@/integrations/krasGateway';
import { krasSyncRelShp, krasSyncWorkDir, pruneOldKrasSyncDays } from '@/integrations/krasSyncKeepDir';
import {
  KRAS_DEFAULT_SOURCE_SRS,
  KRAS_DROP_GUARD_MIN_OLD,
  KRAS_DROP_GUARD_RATIO,
  KRAS_FIXED_LAYER_MAP,
  KRAS_LAYER_CATALOG_SCHEMA,
  KRAS_LAYER_CATALOG_TABLE,
  KRAS_LAYER_SCHEMA_CANDIDATES,
  KRAS_SHAPE_FILE_PARTS,
  KRAS_SHAPE_QUERY_ID,
  KRAS_THEMATIC_DEFINE_GROUPS,
  type KrasLayerSyncScope,
} from '@/integrations/krasLayerSync.config';

export type { KrasLayerSyncScope };
import { readProjectRuntimeEnvVars } from '@/lib/runtimeEnvFile';
import { getLandLinkageConfig } from '@/service/configService';
import { createOrUpdateGeoServerLayer } from '@/service/devTestService';
import { createTableFromShp } from '@/service/shpUploadService';

const LOG = '[kras-layer-sync]';

type DefineTableRow = {
  define_table_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
};

type LayerKind = 'parcel' | 'boundary' | 'thematic';

export type KrasLayerSyncTarget = {
  layerCd: string;
  sendLayerCd: string;
  targetTable: string;
  label: string;
  kind: LayerKind;
};

export type KrasLayerSyncResult = {
  ok: boolean;
  total: number;
  success: number;
  skipped: number;
  failed: number;
  message: string;
  details: string[];
};

function qi(ident: string): string {
  const n = ident.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`잘못된 식별자: ${ident}`);
  return `"${n}"`;
}

function layerCdSuffix(layerCd: string): string {
  const raw = layerCd.trim();
  const dot = raw.lastIndexOf('.');
  return (dot >= 0 ? raw.slice(dot + 1) : raw).trim();
}

function sendLayerCd(layerCd: string): string {
  return layerCdSuffix(layerCd);
}

function isThematicDefineGroup(group: string): boolean {
  if (!group) return false;
  if ((KRAS_THEMATIC_DEFINE_GROUPS as readonly string[]).includes(group)) return true;
  return group.startsWith('주제도');
}

/** 지도 주제도 원본 테이블명 (분할 자식의 부모 + 비분할 본인) */
function thematicParentTableNames(): Set<string> {
  const names = new Set<string>();
  const rows = tables as DefineTableRow[];
  for (const t of rows) {
    const schema = String(t.define_table_schema ?? '').trim();
    if (schema && schema !== 'public_layer' && schema !== 'layer') continue;
    const group = String(t.define_table_group ?? '').trim();
    if (!isThematicDefineGroup(group)) continue;
    const parent = String(t.define_table_parents_layer ?? '').trim().toLowerCase();
    const self = String(t.define_table_name ?? '').trim().toLowerCase();
    if (parent) names.add(parent);
    else if (self) names.add(self);
  }
  return names;
}

async function catalogRows(): Promise<{ layer_cd: string; layer_nm: string; grp_id: string }[]> {
  const schema = qi(KRAS_LAYER_CATALOG_SCHEMA);
  const table = qi(KRAS_LAYER_CATALOG_TABLE);
  try {
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = $2`,
      [KRAS_LAYER_CATALOG_SCHEMA, KRAS_LAYER_CATALOG_TABLE]
    );
    const names = new Set(cols.map((c) => String(c.column_name).toLowerCase()));
    if (!names.has('layer_cd')) {
      throw new Error('레이어 목록에 코드 열이 없습니다.');
    }
    const nm = names.has('layer_nm') ? 'layer_nm' : 'layer_cd';
    const grp = names.has('grp_id') ? 'grp_id' : names.has('grp_nm') ? 'grp_nm' : null;
    const grpExpr = grp ? `${qi(grp)}` : `''`;
    const { rows } = await pool.query<{ layer_cd: string; layer_nm: string; grp_id: string }>(
      `select ${qi('layer_cd')} as layer_cd, ${qi(nm)} as layer_nm, ${grpExpr} as grp_id from ${schema}.${table}`
    );
    return rows ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`레이어 목록 테이블(${KRAS_LAYER_CATALOG_SCHEMA}.${KRAS_LAYER_CATALOG_TABLE})을 읽을 수 없습니다. ${msg}`);
  }
}

function matchFixed(row: { layer_cd: string; layer_nm: string }): KrasLayerSyncTarget | null {
  const suffix = layerCdSuffix(row.layer_cd).toUpperCase();
  const hit = KRAS_FIXED_LAYER_MAP.find((m) => m.layerSuffix === suffix);
  if (!hit) return null;
  return {
    layerCd: row.layer_cd.trim(),
    sendLayerCd: sendLayerCd(row.layer_cd),
    targetTable: hit.targetTable,
    label: hit.label,
    kind: hit.kind,
  };
}

export async function listKrasLayerSyncTargets(scope: KrasLayerSyncScope = 'all'): Promise<KrasLayerSyncTarget[]> {
  const rows = await catalogRows();
  const thematicParents = thematicParentTableNames();
  const out: KrasLayerSyncTarget[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const fixed = matchFixed(row);
    if (fixed) {
      if (seen.has(fixed.targetTable)) continue;
      seen.add(fixed.targetTable);
      out.push(fixed);
      continue;
    }
    const tableName = layerCdSuffix(row.layer_cd).toLowerCase();
    if (!thematicParents.has(tableName)) continue;
    if (seen.has(tableName)) continue;
    seen.add(tableName);
    out.push({
      layerCd: row.layer_cd.trim(),
      sendLayerCd: sendLayerCd(row.layer_cd),
      targetTable: tableName,
      label: String(row.layer_nm ?? tableName).trim() || tableName,
      kind: 'thematic',
    });
  }

  if (scope === 'all') return out;
  if (scope === 'parcel') return out.filter((t) => t.kind === 'parcel');
  if (scope === 'boundary') return out.filter((t) => t.kind === 'boundary');
  return out.filter((t) => t.kind === 'thematic');
}

function sourceSrs(): string {
  const raw = (readProjectRuntimeEnvVars().KRAS_EPSG ?? '').trim() || KRAS_DEFAULT_SOURCE_SRS;
  return /^EPSG:/i.test(raw) ? raw.toUpperCase() : `EPSG:${raw}`;
}

function buildShapeParam(sendLayerCd: string, fileType: string, key: string, sgg: string): string {
  return buildKrasQuery({
    key,
    queryId: KRAS_SHAPE_QUERY_ID,
    sgg,
    extra: { layer_cd: sendLayerCd, file_type: fileType },
  });
}

async function downloadPart(opts: {
  conn: KrasConn;
  body: string;
  destFile: string;
}): Promise<void> {
  const buf = await fetchKrasBytes(krasRequestUrl(opts.conn.url, opts.body));
  await fs.writeFile(opts.destFile, buf);
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ c: string }>(
    `select to_regclass($1) as c`,
    [`${schema}.${table}`]
  );
  return Boolean(rows[0]?.c);
}

async function resolveSchema(table: string): Promise<'public_layer' | 'layer'> {
  for (const schema of KRAS_LAYER_SCHEMA_CANDIDATES) {
    if (await tableExists(schema, table)) return schema;
  }
  return 'public_layer';
}

async function countRows(schema: string, table: string): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(
    `select count(*)::text as c from ${qi(schema)}.${qi(table)}`
  );
  return Number(rows[0]?.c ?? 0);
}

async function dropTable(schema: string, table: string): Promise<void> {
  await pool.query(`drop table if exists ${qi(schema)}.${qi(table)} cascade`);
}

async function relNameExists(schema: string, name: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `select exists(
       select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relname = $2
     ) as ok`,
    [schema, name]
  );
  return Boolean(rows[0]?.ok);
}

async function uniqueRelName(schema: string, preferred: string): Promise<string> {
  const base = preferred.replace(/_+$/, '') || preferred;
  if (!(await relNameExists(schema, base))) return base;
  for (let i = 2; i <= 20; i++) {
    const n = `${base}_${i}`;
    if (!(await relNameExists(schema, n))) return n;
  }
  throw new Error(`식별자 이름 충돌: ${schema}.${preferred}`);
}

/** 본 테이블로 이름만 바꾼 뒤에도 임시 테이블 이름이 남은 인덱스·제약·시퀀스를 본 이름으로 맞춤 */
async function rebindKrasTmpNames(schema: string, table: string, tmpName: string): Promise<void> {
  if (!(await tableExists(schema, table))) return;

  const { rows: idxRows } = await pool.query<{ name: string }>(
    `select i.relname as name
     from pg_index x
     join pg_class i on i.oid = x.indexrelid
     join pg_class t on t.oid = x.indrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = $1 and t.relname = $2 and i.relname like $3
     order by i.relname`,
    [schema, table, `%${tmpName}%`]
  );
  for (const row of idxRows) {
    const preferred = row.name.split(tmpName).join(table);
    const next = await uniqueRelName(schema, preferred);
    if (next === row.name) continue;
    await pool.query(`alter index ${qi(schema)}.${qi(row.name)} rename to ${qi(next)}`);
  }

  const { rows: conRows } = await pool.query<{ name: string }>(
    `select c.conname as name
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = $1 and t.relname = $2 and c.conname like $3
     order by c.conname`,
    [schema, table, `%${tmpName}%`]
  );
  for (const row of conRows) {
    const preferred = row.name.split(tmpName).join(table);
    const next = await uniqueRelName(schema, preferred);
    if (next === row.name) continue;
    try {
      await pool.query(
        `alter table ${qi(schema)}.${qi(table)} rename constraint ${qi(row.name)} to ${qi(next)}`
      );
    } catch {
      /* 기본키 인덱스를 먼저 바꾸면 제약 이름도 같이 바뀌는 경우가 있음 */
    }
  }

  const { rows: seqRows } = await pool.query<{ name: string }>(
    `select s.relname as name
     from pg_class s
     join pg_depend d on d.objid = s.oid and d.deptype = 'a'
     join pg_class t on t.oid = d.refobjid
     join pg_namespace n on n.oid = t.relnamespace
     where s.relkind = 'S' and n.nspname = $1 and t.relname = $2 and s.relname like $3
     order by s.relname`,
    [schema, table, `%${tmpName}%`]
  );
  for (const row of seqRows) {
    const preferred = row.name.split(tmpName).join(table);
    const next = await uniqueRelName(schema, preferred);
    if (next === row.name) continue;
    await pool.query(`alter sequence ${qi(schema)}.${qi(row.name)} rename to ${qi(next)}`);
  }
}

async function ensureKrasGeomIndex(schema: string, table: string): Promise<void> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `select exists(
       select 1
       from pg_index x
       join pg_class t on t.oid = x.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = $1 and t.relname = $2
         and pg_get_indexdef(x.indexrelid) ilike '% gist %'
     ) as ok`,
    [schema, table]
  );
  if (rows[0]?.ok) return;
  const idx = await uniqueRelName(schema, `${table}_geom_idx`);
  await pool.query(
    `create index ${qi(idx)} on ${qi(schema)}.${qi(table)} using gist (geom)`
  );
}

async function swapTables(schema: string, tmp: string, target: string): Promise<void> {
  const old = `${target}_krasold`;
  await dropTable(schema, old);
  const exists = await tableExists(schema, target);
  if (exists) {
    await pool.query(`alter table ${qi(schema)}.${qi(target)} rename to ${qi(old)}`);
  }
  try {
    await pool.query(`alter table ${qi(schema)}.${qi(tmp)} rename to ${qi(target)}`);
  } catch (e) {
    if (exists) {
      await pool.query(`alter table ${qi(schema)}.${qi(old)} rename to ${qi(target)}`).catch(() => {});
    }
    throw e;
  }
  await dropTable(schema, old);
}

async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function syncOne(
  target: KrasLayerSyncTarget,
  conn: KrasConn
): Promise<{ status: 'ok' | 'skip'; detail: string }> {
  const schema = await resolveSchema(target.targetTable);
  const tmpName = `${target.targetTable}_krastmp`;
  const workDir = krasSyncWorkDir(target.targetTable);
  const baseName = target.targetTable;
  await cleanupDir(workDir);
  await fs.mkdir(workDir, { recursive: true });

  try {
    for (const part of KRAS_SHAPE_FILE_PARTS) {
      const dest = path.join(workDir, `${baseName}.${part.ext}`);
      await downloadPart({
        conn,
        body: buildShapeParam(target.sendLayerCd, part.fileType, conn.key, conn.sgg),
        destFile: dest,
      });
    }
    await fs.writeFile(path.join(workDir, `${baseName}.cpg`), 'CP949\n', 'utf8');

    const shpStat = await fs.stat(path.join(workDir, `${baseName}.shp`));
    if (shpStat.size < 1) {
      return { status: 'skip', detail: `${target.label} 빈 도형 — 기존 유지` };
    }

    await dropTable(schema, tmpName);
    await rebindKrasTmpNames(schema, target.targetTable, tmpName);
    const relShp = krasSyncRelShp(target.targetTable, `${baseName}.shp`);
    const loaded = await createTableFromShp({
      pathOrResult: relShp,
      dbSchema: schema,
      tableNameOverride: tmpName,
      sourceSrsOverride: sourceSrs(),
      spatialIndex: false,
    });
    if (!loaded.success) {
      throw new Error(loaded.error || '도형 적재 실패');
    }

    const newCnt = await countRows(schema, tmpName);
    if (newCnt <= 0) {
      await dropTable(schema, tmpName);
      return { status: 'skip', detail: `${target.label} 0건 — 기존 유지` };
    }

    const oldExists = await tableExists(schema, target.targetTable);
    const oldCnt = oldExists ? await countRows(schema, target.targetTable) : 0;
    if (
      oldExists &&
      oldCnt >= KRAS_DROP_GUARD_MIN_OLD &&
      newCnt < oldCnt * KRAS_DROP_GUARD_RATIO
    ) {
      await dropTable(schema, tmpName);
      return {
        status: 'skip',
        detail: `${target.label} 건수 부족(기존 ${oldCnt} → ${newCnt}), 기존 유지`,
      };
    }

    await swapTables(schema, tmpName, target.targetTable);
    await rebindKrasTmpNames(schema, target.targetTable, tmpName);
    try {
      await ensureKrasGeomIndex(schema, target.targetTable);
    } catch (e) {
      console.warn(`${LOG} geom index ${target.targetTable}:`, e instanceof Error ? e.message : e);
    }
    try {
      await createOrUpdateGeoServerLayer({ layerName: target.targetTable });
    } catch (e) {
      console.warn(`${LOG} geoserver ${target.targetTable}:`, e instanceof Error ? e.message : e);
    }
    return {
      status: 'ok',
      detail: `${target.label} 반영 ${schema}.${target.targetTable} ${newCnt}건`,
    };
  } finally {
    await dropTable(schema, tmpName).catch(() => {});
  }
}

export async function runKrasLayerSync(opts?: {
  scope?: KrasLayerSyncScope;
  onProgress?: (message: string) => Promise<void> | void;
  skipLock?: boolean;
  throwIfAllFailed?: boolean;
}): Promise<KrasLayerSyncResult> {
  const scope = opts?.scope ?? 'all';
  const throwIfAllFailed = opts?.throwIfAllFailed !== false;
  const run = async (): Promise<KrasLayerSyncResult> => {
    const conn = requireKrasConn();
    await pruneOldKrasSyncDays();
    const targets = await listKrasLayerSyncTargets(scope);
    if (!targets.length) {
      throw new Error('받을 레이어가 없습니다. 레이어 목록 또는 주제도 정의를 확인하세요.');
    }

    const details: string[] = [];
    let success = 0;
    let skipped = 0;
    let failed = 0;
    const total = targets.length;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const seq = i + 1;
      const progress = `진행중 ${seq}/${total} | ${t.label} | ${t.targetTable}`;
      console.info(`${LOG} ${progress}`);
      await opts?.onProgress?.(progress);
      try {
        const r = await syncOne(t, conn);
        details.push(r.detail);
        if (r.status === 'ok') success += 1;
        else skipped += 1;
        await opts?.onProgress?.(
          `${r.status === 'ok' ? '완료' : '유지'} ${seq}/${total} | ${t.label} | ${r.detail}`
        );
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        const line = `${t.label} 실패: ${msg}`;
        details.push(line);
        console.warn(`${LOG} ${line}`);
        void appendLinkageError({
          system: 'KRAS',
          title: `${t.label} (${t.targetTable})`,
          detail: msg,
        });
        await opts?.onProgress?.(`실패 ${seq}/${total} | ${t.label} | ${msg}`);
        if (shouldStopAll(msg)) {
          throw new Error(`${line} (중단 ${seq}/${total})`);
        }
      }
    }

    const message = `완료 ${success}/${total}, 유지 ${skipped}, 실패 ${failed}\n${details.join('\n')}`;
    if (throwIfAllFailed && success === 0 && failed > 0) {
      throw new Error(details[0] ?? message);
    }
    return { ok: true, total, success, skipped, failed, message, details };
  };

  try {
    if (opts?.skipLock) return await run();
    return await withAdvisoryLock('KRAS-layer', run);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void appendLinkageError({
      system: 'KRAS',
      title: '도형 연계 중단',
      detail: formatLinkageError(e),
    });
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}

export function isKrasLayerAutoEnabled(): boolean {
  const ggnrEnv = (process.env.GGNR_ENV ?? '').trim().toLowerCase();
  if (ggnrEnv === 'dev') return false;
  const cfg = getLandLinkageConfig();
  return Boolean(cfg.krasKey && cfg.krasIp && cfg.krasPort && cfg.sggCode);
}
