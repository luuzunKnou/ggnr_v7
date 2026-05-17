import { pool } from '@/database/db';
import { runKais, defaultDailyWindow } from '@/integrations/kais';
import { getSafetydataDatasetById, SAFETYDATA_DATASETS } from '@/integrations/safetydata.config';
import { getSafetydataTargetSchema } from '@/integrations/safetydataHttp';
import { ingestSafetydataDatasetToLayer } from '@/integrations/safetydataIngest';

type Params = Record<string, unknown>;

export type IntegrationSystem = 'KAIS' | 'KRAS' | 'KORPES' | 'SEUMTEO' | 'SAEOL' | 'SAFETYDATA';

const HARDCODED_KAIS_APP_KEY = 'U01TX0FVVEgyMDIzMDUzMDE3MzU1NDExMzgxMTM=';

/** `next dev` 직행 등으로 drizzle push 없이 올린 경우에도 연계 UI·API가 동작하도록 최소 테이블 보장 */
let integrationTablesEnsured = false;
async function ensureIntegrationTables(): Promise<void> {
  if (integrationTablesEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "log_kais" (
      "log_kais_key" serial PRIMARY KEY NOT NULL,
      "log_kais_cntc_cd" varchar(20),
      "log_kais_name" varchar(200) NOT NULL,
      "log_kais_date" varchar(8) NOT NULL,
      "log_kais_request_date" timestamp DEFAULT now() NOT NULL,
      "log_kais_result_code" varchar(50),
      "log_kais_response_code" varchar(50),
      "log_kais_response_msg" text,
      "log_kais_status" varchar(200) NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "log_safetydata" (
      "log_safetydata_key" serial PRIMARY KEY NOT NULL,
      "log_safetydata_dataset_id" varchar(80) NOT NULL,
      "log_safetydata_name" varchar(500) NOT NULL,
      "log_safetydata_date" varchar(8) NOT NULL,
      "log_safetydata_request_date" timestamp DEFAULT now() NOT NULL,
      "log_safetydata_result_code" varchar(50),
      "log_safetydata_response_code" varchar(50),
      "log_safetydata_response_msg" text,
      "log_safetydata_status" varchar(500) NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "integration_job_log" (
      "ijl_key" serial PRIMARY KEY NOT NULL,
      "ijl_system" varchar(30) NOT NULL,
      "ijl_started_at" timestamp DEFAULT now() NOT NULL,
      "ijl_finished_at" timestamp,
      "ijl_status" varchar(20) NOT NULL,
      "ijl_message" text
    );
  `);
  integrationTablesEnsured = true;
}

function normalizeSystem(v: unknown): IntegrationSystem {
  const s = String(v ?? '').trim().toUpperCase();
  if (
    s === 'KAIS' ||
    s === 'KRAS' ||
    s === 'KORPES' ||
    s === 'SEUMTEO' ||
    s === 'SAEOL' ||
    s === 'SAFETYDATA'
  )
    return s;
  throw new Error(`Unknown integration system: ${s}`);
}

function compactErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const first = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0) ?? 'unknown error';
  return first.length > 320 ? `${first.slice(0, 320)}...` : first;
}

async function updateIntegrationJobProgress(ijlKey: number | undefined, message: string): Promise<void> {
  if (!ijlKey) return;
  await pool.query(`update integration_job_log set ijl_message=$2 where ijl_key=$1`, [ijlKey, message]);
}

export async function listSafetydataDatasets(_p: Params) {
  return {
    rows: SAFETYDATA_DATASETS.map((d) => ({
      id: d.id,
      tableNameKo: d.tableNameKo,
      tableNameEn: d.tableNameEn,
      hasApiKey: Boolean(d.apiKey?.trim()),
    })),
  };
}

export async function listSafetydataDetailLogs(p: Params) {
  await ensureIntegrationTables();
  const limit = Math.max(1, Math.min(200, Number(p.limit ?? 100)));
  const { rows } = await pool.query(
    `select
       log_safetydata_key,
       log_safetydata_dataset_id,
       log_safetydata_name,
       log_safetydata_date,
       log_safetydata_request_date,
       log_safetydata_result_code,
       log_safetydata_response_code,
       log_safetydata_response_msg,
       log_safetydata_status
     from log_safetydata
     order by log_safetydata_key desc
     limit $1`,
    [limit]
  );
  return { rows };
}

export async function runIntegration(p: Params) {
  const system = normalizeSystem(p.system);
  const mode = (String(p.mode ?? 'daily') as 'daily' | 'initial') ?? 'daily';
  const from = p.from ? String(p.from) : undefined;
  const to = p.to ? String(p.to) : undefined;

  await ensureIntegrationTables();

  const started = await pool.query<{ ijl_key: number }>(
    `insert into integration_job_log (ijl_system, ijl_status, ijl_message)
     values ($1,'STARTED',$2)
     returning ijl_key`,
    [system, mode === 'initial' ? 'initial run' : 'daily run']
  );
  const ijlKey = started.rows[0]?.ijl_key;

  try {
    console.error(`[INTEGRATION] START system=${system} mode=${mode} ijlKey=${ijlKey ?? '-'}`);
    if (system === 'KAIS') {
      const appKey = (process.env.KAIS_APP_KEY ?? '').trim() || HARDCODED_KAIS_APP_KEY;
      const sggCode = process.env.SGG_CODE;
      const window = from && to ? { from, to } : defaultDailyWindow();
      const cntcList = ['300001', '300002', '300003'];

      for (const cntcCd of cntcList) {
        await runKais({
          mode,
          appKey,
          cntcCd,
          dateGb: 'D',
          retryIn: 'Y',
          from: window.from,
          to: window.to,
          sggCode,
        });
      }
    } else if (system === 'SAFETYDATA') {
      const runAll = p.runAll === true || String(p.datasetId ?? '') === '__ALL__';
      const singleId = p.datasetId != null ? String(p.datasetId).trim() : '';
      console.error(
        `[SAFETYDATA RUN] runAll=${runAll} datasetId=${singleId || '__ALL__'} targetSchema=${getSafetydataTargetSchema()}`
      );
      if (runAll) {
        const targets = SAFETYDATA_DATASETS.filter((d) => d.apiKey?.trim());
        const total = targets.length;
        if (total === 0) {
          throw new Error('API 키가 설정된 재난안전데이터 데이터셋이 없습니다.');
        }
        const errors: string[] = [];
        const summaries: string[] = [];
        for (let i = 0; i < targets.length; i++) {
          const d = targets[i];
          const seq = i + 1;
          console.error(`[SAFETYDATA RUN] ${seq}/${total} START ${d.id} -> ${d.tableNameEn}`);
          await updateIntegrationJobProgress(
            ijlKey,
            `진행중 ${seq}/${total} | ${d.id} | ${d.tableNameKo} -> ${getSafetydataTargetSchema()}.${d.tableNameEn}`
          );
          try {
            const priorIds = new Set(targets.slice(0, i).map((t) => t.id));
            const needPrereq = d.ingestPrerequisiteDatasetIds ?? [];
            const skipPrerequisites =
              needPrereq.length > 0 && needPrereq.every((pid) => priorIds.has(pid));
            const r = await ingestSafetydataDatasetToLayer(d.id, { skipPrerequisites });
            console.error(
              `[SAFETYDATA RUN] ${seq}/${total} DONE ${d.id} table=${r.schema}.${r.tableNameEn} fetched=${r.rowsFetched} inserted=${r.rowsInserted} filteredOut=${r.rowsFilteredOut}`
            );
            summaries.push(
              `${seq}/${total} ${d.id} ${r.schema}.${r.tableNameEn} fetched=${r.rowsFetched} inserted=${r.rowsInserted} filteredOut=${r.rowsFilteredOut}`
            );
            await updateIntegrationJobProgress(
              ijlKey,
              `완료 ${seq}/${total} | ${d.id} | ${r.schema}.${r.tableNameEn} | fetched=${r.rowsFetched}, inserted=${r.rowsInserted}, filteredOut=${r.rowsFilteredOut}`
            );
          } catch (e) {
            const msg = compactErrorMessage(e);
            console.error(`[SAFETYDATA RUN] ${seq}/${total} FAIL ${d.id} ${d.tableNameEn} ${msg}`);
            errors.push(`${seq}/${total} ${d.id} ${d.tableNameEn}: ${msg}`);
            await updateIntegrationJobProgress(
              ijlKey,
              `실패 ${seq}/${total} | ${d.id} | ${d.tableNameEn} | ${msg}`
            );
          }
        }
        if (errors.length) {
          throw new Error(errors.join('\n'));
        }
        await updateIntegrationJobProgress(
          ijlKey,
          `전체 완료 ${total}/${total}\n${summaries.join('\n')}`
        );
      } else {
        if (!singleId || singleId === '__ALL__') {
          throw new Error('datasetId가 필요합니다. 데이터셋을 선택하거나 전체 실행을 선택하세요.');
        }
        const cfg = getSafetydataDatasetById(singleId);
        if (!cfg) throw new Error(`Unknown safetydata dataset: ${singleId}`);
        console.error(`[SAFETYDATA RUN] 1/1 START ${cfg.id} -> ${cfg.tableNameEn}`);
        await updateIntegrationJobProgress(
          ijlKey,
          `진행중 1/1 | ${cfg.id} | ${cfg.tableNameKo} -> ${getSafetydataTargetSchema()}.${cfg.tableNameEn}`
        );
        const r = await ingestSafetydataDatasetToLayer(singleId);
        console.error(
          `[SAFETYDATA RUN] 1/1 DONE ${cfg.id} table=${r.schema}.${r.tableNameEn} fetched=${r.rowsFetched} inserted=${r.rowsInserted} filteredOut=${r.rowsFilteredOut}`
        );
        await updateIntegrationJobProgress(
          ijlKey,
          `완료 1/1 | ${cfg.id} | ${r.schema}.${r.tableNameEn} | fetched=${r.rowsFetched}, inserted=${r.rowsInserted}, filteredOut=${r.rowsFilteredOut}`
        );
      }
    } else {
      throw new Error('Not implemented yet');
    }

    await pool.query(
      `update integration_job_log
       set ijl_status='SUCCESS', ijl_finished_at=now()
       where ijl_key=$1`,
      [ijlKey]
    );
    console.error(`[INTEGRATION] DONE system=${system} ijlKey=${ijlKey ?? '-'}`);
    return { ijlKey, system, ok: true };
  } catch (e) {
    const msg = compactErrorMessage(e);
    console.error(`[INTEGRATION] FAIL system=${system} ijlKey=${ijlKey ?? '-'} message=${msg}`);
    await pool.query(
      `update integration_job_log
       set ijl_status='FAILED', ijl_finished_at=now(), ijl_message=$2
       where ijl_key=$1`,
      [ijlKey, msg]
    );
    throw e;
  }
}

export async function listIntegrationLogs(p: Params) {
  await ensureIntegrationTables();
  const system = normalizeSystem(p.system);
  const limit = Math.max(1, Math.min(200, Number(p.limit ?? 50)));
  const { rows } = await pool.query(
    `select ijl_key, ijl_system, ijl_started_at, ijl_finished_at, ijl_status, ijl_message
     from integration_job_log
     where ijl_system=$1
     order by ijl_key desc
     limit $2`,
    [system, limit]
  );
  return { rows };
}

const SAFETYDATA_REALTIME_FEED_IDS = ['sd-1066', 'sd-751', 'sd-228', 'sd-46'] as const;

function qi(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function assertSafeIdent(name: string, label: string): string {
  const n = name.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`Invalid ${label}: ${name}`);
  return n;
}

type SafetyHospitalBedStateRow = {
  addr: string;
  hsptlClsfNm: string;
  instNm: string;
  rprsTelno: string;
  emro: string;
  opro: string;
  ward: string;
  lon: number | null;
  lat: number | null;
};

/**
 * 병상정보 패널 목록:
 * - 시설 기본정보: sd_mois_hospital_poi (주소/구분/이름/전화/위치)
 * - 병상정보: sd_nmc_hospital_bed_realtime (EMRO/OPRO/WARD)
 */
export async function fetchSafetyHospitalBedStateList(p: Params): Promise<{ items: SafetyHospitalBedStateRow[] }> {
  const schema = assertSafeIdent(getSafetydataTargetSchema(), 'schema');
  const poiTable = assertSafeIdent('sd_mois_hospital_poi', 'table');
  const bedTable = assertSafeIdent('sd_nmc_hospital_bed_realtime', 'table');
  const limit = Math.min(5000, Math.max(1, Number(p.limit ?? 1000)));

  const sqlText = `
    WITH poi AS (
      SELECT
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'inst_id'), ''), '-') AS inst_id,
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'addr'), ''), '-') AS addr,
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'hsptl_clsf_nm'), ''), '-') AS hsptl_clsf_nm,
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'inst_nm'), ''), '-') AS inst_nm,
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'rprs_telno'), ''), '-') AS rprs_telno,
        CASE
          WHEN p.geom IS NULL THEN NULL
          WHEN ST_SRID(p.geom) = 4326 THEN ST_X(p.geom)
          WHEN ST_SRID(p.geom) = 0 THEN ST_X(ST_Transform(ST_SetSRID(p.geom, 5181), 4326))
          ELSE ST_X(ST_Transform(p.geom, 4326))
        END::float8 AS lon,
        CASE
          WHEN p.geom IS NULL THEN NULL
          WHEN ST_SRID(p.geom) = 4326 THEN ST_Y(p.geom)
          WHEN ST_SRID(p.geom) = 0 THEN ST_Y(ST_Transform(ST_SetSRID(p.geom, 5181), 4326))
          ELSE ST_Y(ST_Transform(p.geom, 4326))
        END::float8 AS lat
      FROM ${qi(schema)}.${qi(poiTable)} p
    ),
    bed AS (
      SELECT
        COALESCE(NULLIF(TRIM((to_jsonb(b))->>'bfr_inst_id'), ''), '-') AS join_key,
        MAX(COALESCE(NULLIF(TRIM((to_jsonb(b))->>'emro'), ''), '-')) AS emro,
        MAX(COALESCE(NULLIF(TRIM((to_jsonb(b))->>'opro'), ''), '-')) AS opro,
        MAX(COALESCE(NULLIF(TRIM((to_jsonb(b))->>'ward'), ''), '-')) AS ward
      FROM ${qi(schema)}.${qi(bedTable)} b
      GROUP BY 1
    )
    SELECT
      p.addr,
      p.hsptl_clsf_nm,
      p.inst_nm,
      p.rprs_telno,
      COALESCE(b.emro, '-') AS emro,
      COALESCE(b.opro, '-') AS opro,
      COALESCE(b.ward, '-') AS ward,
      p.lon,
      p.lat
    FROM poi p
    LEFT JOIN bed b
      ON p.inst_id = b.join_key
    WHERE p.inst_nm <> '-'
    ORDER BY p.inst_nm ASC
    LIMIT $1
  `;

  const { rows } = await pool.query(sqlText, [limit]);
  const items: SafetyHospitalBedStateRow[] = (rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const lonNum = Number(row.lon);
    const latNum = Number(row.lat);
    return {
      addr: String(row.addr ?? '-'),
      hsptlClsfNm: String(row.hsptl_clsf_nm ?? '-'),
      instNm: String(row.inst_nm ?? '-'),
      rprsTelno: String(row.rprs_telno ?? '-'),
      emro: String(row.emro ?? '-'),
      opro: String(row.opro ?? '-'),
      ward: String(row.ward ?? '-'),
      lon: Number.isFinite(lonNum) ? lonNum : null,
      lat: Number.isFinite(latNum) ? latNum : null,
    };
  });
  return { items };
}

type SafetyReservoirStateRow = {
  rsrvrCd: string;
  rsrvrNm: string;
  basinAddr: string;
  msrnDt: string;
  /** DSSP-IF-20286 저수위 LOLE */
  lole: string;
  /** 저수량 PONDAGE */
  pondage: string;
  /** 저수율 WRERATES */
  wrerates: string;
  lon: number | null;
  lat: number | null;
};

/**
 * 저수지 수위 패널(saftyJsj):
 * - 제원: sd_reservoir_master (RSRVR_CD 등)
 * - 10분: sd_reservoir_level_10min — IF-20286 필드명(적재 시 소문자 컬럼) LOLE, PONDAGE, WRERATES, RSRVR_CD, MSRN_DT
 * - 목록은 RSRVR_CD로 10분 계측에 조인되는 저수지만 반환(INNER JOIN).
 */
export async function fetchSafetyReservoirStateList(p: Params): Promise<{ items: SafetyReservoirStateRow[] }> {
  const schema = assertSafeIdent(getSafetydataTargetSchema(), 'schema');
  const masterTable = assertSafeIdent('sd_reservoir_master', 'table');
  const levelTable = assertSafeIdent('sd_reservoir_level_10min', 'table');
  const limit = Math.min(5000, Math.max(1, Number(p.limit ?? 1500)));

  const sqlText = `
    WITH m AS (
      SELECT
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'rsrvr_cd'), ''), '-') AS rsrvr_cd,
        COALESCE(NULLIF(TRIM((to_jsonb(p) - 'geom')->>'rsrvr_nm'), ''), '-') AS rsrvr_nm,
        COALESCE(
          NULLIF(TRIM((to_jsonb(p) - 'geom')->>'addr'), ''),
          NULLIF(TRIM((to_jsonb(p) - 'geom')->>'basin_nm'), ''),
          NULLIF(TRIM((to_jsonb(p) - 'geom')->>'rsrvr_addr'), ''),
          '-'
        ) AS basin_addr,
        CASE
          WHEN p.geom IS NULL THEN NULL
          WHEN ST_SRID(p.geom) = 4326 THEN ST_X(p.geom)
          WHEN ST_SRID(p.geom) = 0 THEN ST_X(ST_Transform(ST_SetSRID(p.geom, 5181), 4326))
          ELSE ST_X(ST_Transform(p.geom, 4326))
        END::float8 AS lon,
        CASE
          WHEN p.geom IS NULL THEN NULL
          WHEN ST_SRID(p.geom) = 4326 THEN ST_Y(p.geom)
          WHEN ST_SRID(p.geom) = 0 THEN ST_Y(ST_Transform(ST_SetSRID(p.geom, 5181), 4326))
          ELSE ST_Y(ST_Transform(p.geom, 4326))
        END::float8 AS lat
      FROM ${qi(schema)}.${qi(masterTable)} p
    ),
    ranked AS (
      SELECT
        COALESCE(NULLIF(TRIM((to_jsonb(b))->>'rsrvr_cd'), ''), '-') AS join_key,
        COALESCE(NULLIF(TRIM((to_jsonb(b))->>'msrn_dt'), ''), '-') AS msrn_dt,
        COALESCE(
          NULLIF(TRIM((to_jsonb(b))->>'lole'), ''),
          NULLIF(TRIM((to_jsonb(b))->>'LOLE'), ''),
          '-'
        ) AS lole,
        COALESCE(
          NULLIF(TRIM((to_jsonb(b))->>'pondage'), ''),
          NULLIF(TRIM((to_jsonb(b))->>'PONDAGE'), ''),
          '-'
        ) AS pondage,
        COALESCE(
          NULLIF(TRIM((to_jsonb(b))->>'wrerates'), ''),
          NULLIF(TRIM((to_jsonb(b))->>'WRERATES'), ''),
          '-'
        ) AS wrerates,
        ROW_NUMBER() OVER (
          PARTITION BY lower(trim(coalesce((to_jsonb(b)->>'rsrvr_cd'), '')))
          ORDER BY trim(coalesce((to_jsonb(b)->>'msrn_dt'), '')) DESC NULLS LAST
        ) AS rn
      FROM ${qi(schema)}.${qi(levelTable)} b
    ),
    lvl AS (
      SELECT join_key, msrn_dt, lole, pondage, wrerates
      FROM ranked
      WHERE rn = 1
        AND lower(trim(join_key)) <> '-'
    )
    SELECT
      m.rsrvr_cd AS "rsrvrCd",
      m.rsrvr_nm AS "rsrvrNm",
      m.basin_addr AS "basinAddr",
      l.msrn_dt AS "msrnDt",
      l.lole AS "lole",
      l.pondage AS "pondage",
      l.wrerates AS "wrerates",
      m.lon,
      m.lat
    FROM m m
    INNER JOIN lvl l
      ON lower(trim(m.rsrvr_cd)) = lower(trim(l.join_key))
    WHERE m.rsrvr_cd <> '-'
    ORDER BY m.rsrvr_nm ASC
    LIMIT $1
  `;

  const { rows } = await pool.query(sqlText, [limit]);
  const items: SafetyReservoirStateRow[] = (rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const lonNum = Number(row.lon);
    const latNum = Number(row.lat);
    return {
      rsrvrCd: String(row.rsrvrCd ?? '-'),
      rsrvrNm: String(row.rsrvrNm ?? '-'),
      basinAddr: String(row.basinAddr ?? '-'),
      msrnDt: String(row.msrnDt ?? '-'),
      lole: String(row.lole ?? '-'),
      pondage: String(row.pondage ?? '-'),
      wrerates: String(row.wrerates ?? '-'),
      lon: Number.isFinite(lonNum) ? lonNum : null,
      lat: Number.isFinite(latNum) ? latNum : null,
    };
  });
  return { items };
}

/** layer 등 적재 테이블 기준 정렬 — 화면과 DB `ORDER BY` 일치 */
const REALTIME_ORDER_SQL: Record<(typeof SAFETYDATA_REALTIME_FEED_IDS)[number], string> = {
  'sd-1066': `${qi('mstn_bgng_ymd')} DESC NULLS LAST, ${qi('mstn_bgng_hominsec')} DESC NULLS LAST`,
  'sd-751': `${qi('last_mdfcn_dt')} DESC NULLS LAST, ${qi('frst_reg_dt')} DESC NULLS LAST`,
  'sd-228': `${qi('crt_dt')} DESC NULLS LAST`,
  'sd-46': `${qi('yna_ymd')} DESC NULLS LAST`,
};

/** 실시간 재난정보 패널: 적재 DB에서 정렬 조회(OpenAPI 1페이지와 순서·건수 불일치 방지) */
export async function fetchSafetydataRealtimeFeed(p: Params) {
  const datasetId = String(p.datasetId ?? '').trim();
  if (!(SAFETYDATA_REALTIME_FEED_IDS as readonly string[]).includes(datasetId)) {
    throw new Error('허용되지 않은 데이터셋입니다.');
  }

  const cfg = getSafetydataDatasetById(datasetId);
  if (!cfg) throw new Error(`Unknown dataset: ${datasetId}`);

  const schema = assertSafeIdent(getSafetydataTargetSchema(), 'schema');
  const table = assertSafeIdent(cfg.tableNameEn, 'table');
  const orderClause = REALTIME_ORDER_SQL[datasetId as (typeof SAFETYDATA_REALTIME_FEED_IDS)[number]];
  const limit = Math.min(500, Math.max(1, Number(p.limit ?? 100)));

  const fromClause = `${qi(schema)}.${qi(table)}`;
  const countSql = `SELECT count(*)::bigint AS c FROM ${fromClause}`;
  const dataSql = `SELECT * FROM ${fromClause} ORDER BY ${orderClause} LIMIT $1`;

  const [countR, dataR] = await Promise.all([
    pool.query<{ c: string }>(countSql),
    pool.query<Record<string, unknown>>(dataSql, [limit]),
  ]);

  const totalCount = Number(countR.rows[0]?.c ?? 0);

  return {
    datasetId,
    totalCount,
    items: dataR.rows,
    source: 'database' as const,
  };
}
