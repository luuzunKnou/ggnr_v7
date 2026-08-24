import { pool } from '@/database/db';

export const NEXTGEN_INTEGRATION_SYSTEM = 'NEXTGEN';

async function ensureJobLogTable(): Promise<void> {
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
}

export async function startNextGenYearJobLog(fyr: string): Promise<number | undefined> {
  await ensureJobLogTable();
  const { rows } = await pool.query<{ ijl_key: number }>(
    `insert into integration_job_log (ijl_system, ijl_status, ijl_message)
     values ($1,'STARTED',$2)
     returning ijl_key`,
    [NEXTGEN_INTEGRATION_SYSTEM, `${fyr}년 연계 시작`]
  );
  return rows[0]?.ijl_key;
}

export async function finishNextGenYearJobLog(
  ijlKey: number | undefined,
  status: 'SUCCESS' | 'FAILED',
  message: string
): Promise<void> {
  if (!ijlKey) return;
  await pool.query(
    `update integration_job_log
     set ijl_status=$2, ijl_finished_at=now(), ijl_message=$3
     where ijl_key=$1`,
    [ijlKey, status, message]
  );
}

export async function insertNextGenSkipJobLog(message: string): Promise<void> {
  await ensureJobLogTable();
  await pool.query(
    `insert into integration_job_log (ijl_system, ijl_status, ijl_finished_at, ijl_message)
     values ($1,'FAILED', now(), $2)`,
    [NEXTGEN_INTEGRATION_SYSTEM, message]
  );
}
