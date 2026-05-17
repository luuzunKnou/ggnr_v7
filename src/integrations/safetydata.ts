import { pool } from '@/database/db';
import {
  getSafetydataDatasetById,
  type SafetydataDatasetConfig,
  type SafetydataRefreshSchedule,
} from '@/integrations/safetydata.config';
import {
  buildSafetydataFetchUrl,
  getSafetydataTargetSchema,
  type SafetydataFetchQuery,
} from '@/integrations/safetydataHttp';
import { fetchWithRetry, withAdvisoryLock } from '@/integrations/core';

export { buildSafetydataFetchUrl, getSafetydataTargetSchema, type SafetydataFetchQuery };
export { resolveSafetydataDatasetApiKey } from '@/integrations/safetydataHttp';

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function tableExists(schema: string, relname: string): Promise<boolean> {
  const r = await pool.query<{ x: boolean }>(
    `
select exists(
  select 1 from information_schema.tables
  where table_schema = $1 and table_name = $2
) as x
`,
    [schema, relname.toLowerCase()]
  );
  return Boolean(r.rows[0]?.x);
}

/**
 * 데이터셋별 원시 JSON 수신 (DB 적재 전 단계).
 */
export async function fetchSafetydataJson(datasetId: string): Promise<unknown> {
  const cfg = getSafetydataDatasetById(datasetId);
  if (!cfg) throw new Error(`Unknown safetydata dataset: ${datasetId}`);
  const url = buildSafetydataFetchUrl(cfg, { pageNo: 1, numOfRows: 100 });
  const res = await fetchWithRetry(url, { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Safetydata HTTP ${res.status} for ${datasetId}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Safetydata response is not JSON (${datasetId}), length=${text.length}`);
  }
}

export type SafetydataSyncResult = {
  datasetId: string;
  tableNameKo: string;
  tableNameEn: string;
  schedule: string;
  payloadChars: number;
};

/** API 호출만 (동기화 락). 전체 적재는 ingestSafetydataDatasetToLayer 사용. */
export async function runSafetydataSync(datasetId: string): Promise<SafetydataSyncResult> {
  const cfg = getSafetydataDatasetById(datasetId);
  if (!cfg) throw new Error(`Unknown safetydata dataset: ${datasetId}`);

  const lockKey = `safetydata:${datasetId}`;
  return withAdvisoryLock(lockKey, async () => {
    const data = await fetchSafetydataJson(datasetId);
    const payloadChars = JSON.stringify(data).length;
    return {
      datasetId,
      tableNameKo: cfg.tableNameKo,
      tableNameEn: cfg.tableNameEn,
      schedule: describeSafetydataSchedule(cfg.refreshSchedule),
      payloadChars,
    };
  });
}

/** 스케줄러(cron 등)에 넘길 때 참고용 짧은 설명 */
export function describeSafetydataSchedule(s: SafetydataRefreshSchedule): string {
  if (s.mode === 'interval') return `every ${s.minutes} min (clock-aligned)`;
  if (s.mode === 'daily') return `daily ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  if (s.mode === 'monthly')
    return `monthly dom=${s.dayOfMonth} ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  return `weekly wd=${s.weekday} ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
}

export async function safetydataTargetTableExists(tableNameEn: string): Promise<boolean> {
  const schema = getSafetydataTargetSchema();
  return tableExists(schema, tableNameEn);
}

export function safetydataQualifiedTableName(tableNameEn: string): string {
  const schema = getSafetydataTargetSchema();
  return `${quoteIdent(schema)}.${quoteIdent(tableNameEn)}`;
}

export {
  ingestSafetydataDatasetToLayer,
  extractSafetydataItems,
  getSafetydataTotalCount,
  assertSafetydataResponseOk,
  type SafetydataIngestResult,
  type SafetydataIngestOptions,
} from '@/integrations/safetydataIngest';
