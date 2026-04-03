import { pool } from '@/database/db';
import { runKais, defaultDailyWindow } from '@/integrations/kais';

type Params = Record<string, unknown>;

export type IntegrationSystem = 'KAIS' | 'KRAS' | 'KORPES' | 'SEUMTEO' | 'SAEOL';

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
  if (s === 'KAIS' || s === 'KRAS' || s === 'KORPES' || s === 'SEUMTEO' || s === 'SAEOL') return s;
  throw new Error(`Unknown integration system: ${s}`);
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
    } else {
      throw new Error('Not implemented yet');
    }

    await pool.query(
      `update integration_job_log
       set ijl_status='SUCCESS', ijl_finished_at=now()
       where ijl_key=$1`,
      [ijlKey]
    );
    return { ijlKey, system, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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

