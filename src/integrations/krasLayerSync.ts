/**
 * 토지행정망 SHAPE(KRAS000038) — 지적·읍면동·주제도 원본만 받아 public_layer(또는 layer) 교체.
 * 6세대는 목록 전체를 받았으나, 여기서는 지도에 쓰는 레이어만 받는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import tables from '@/config/defineLayer/tables.json';
import { pool } from '@/database/db';
import { withAdvisoryLock } from '@/integrations/core';
import {
  buildKrasQuery,
  fetchKrasBytes,
  krasRequestUrl,
  requireKrasConn,
  shouldStopAll,
  type KrasConn,
} from '@/integrations/krasGateway';
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

function dataDir(): string {
  return (process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir').trim() || 'd:\\ggnr_data_dir';
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
  await pool.query(`drop table if exists ${qi(schema)}.${qi(table)}`);
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
  const workDir = path.join(dataDir(), 'kras_sync', target.targetTable);
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
    const relShp = path.join('kras_sync', target.targetTable, `${baseName}.shp`).replace(/\\/g, '/');
    const loaded = await createTableFromShp({
      pathOrResult: relShp,
      dbSchema: schema,
      tableNameOverride: tmpName,
      sourceSrsOverride: sourceSrs(),
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
    await cleanupDir(workDir);
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
