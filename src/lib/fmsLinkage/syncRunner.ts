import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db, pool } from '@/database/db';
import { fmsIdentifierHeader } from '@/database/schema/fms_identifier_header';
import { fmsQueryTable } from '@/database/schema/fms_query_table';
import type { FmsPrefix } from '@/lib/fmsLinkage/fmsBinding';
import { getFmsLinkageConfig } from '@/lib/fmsLinkage/config';
import { downloadFmsPayload } from '@/lib/fmsLinkage/downloadPayload';
import { parseFmsResponseLine, receiveFmsFirstLine } from '@/lib/fmsLinkage/fmsClient';
import { parseFmsDelimitedData } from '@/lib/fmsLinkage/parseDelimited';
import { buildFacilPrefixMap, upsertFmsRowsToLayer } from '@/lib/fmsLinkage/upsertRows';
import { updateFmsCodeToKor } from '@/lib/fmsLinkage/updateCodeToKor';
import { backfillFmsFacilityGeom } from '@/lib/fmsLinkage/backfillFacilityGeom';
import { getEnabledSystemKeysFromRuntime } from '@/lib/runtimeEnvFile';
import { getFmsDataKindForIdentifier } from '@/lib/fmsLinkage/fmsBinding';

const LOG = '[fms-sync]';

export type FmsJobStatus = 'SUCCESS' | 'NO_DATA' | 'NOT_PROD' | 'FAILED';

export type FmsSyncResult = {
  ok: boolean;
  skipped?: string;
  jobStatus: FmsJobStatus;
  success: number;
  empty: number;
  fail: number;
  message: string;
};

type FmsIdentifierOutcome = {
  identifier: string;
  label: string;
  status: 'ok' | 'empty' | 'fail';
  detail: string;
};

let running = false;

function outcomeLabel(identifier: string, interfaceName?: string | null): string {
  const name = String(interfaceName ?? '').trim();
  return name || identifier;
}

function resolveJobStatus(success: number, fail: number): FmsJobStatus {
  if (fail > 0) return 'FAILED';
  if (success > 0) return 'SUCCESS';
  return 'NO_DATA';
}

function formatSyncMessage(outcomes: FmsIdentifierOutcome[], jobStatus: FmsJobStatus): string {
  const success = outcomes.filter((o) => o.status === 'ok').length;
  const empty = outcomes.filter((o) => o.status === 'empty').length;
  const fail = outcomes.filter((o) => o.status === 'fail').length;
  const summary =
    jobStatus === 'NO_DATA'
      ? `FMS 연계 완료 — 반영 없음 (자료없음 ${empty}건). FMS에 신규·변경분이 없습니다.`
      : `FMS 연계 완료 — 반영 ${success}건, 자료없음 ${empty}건, 실패 ${fail}건`;
  if (!outcomes.length) return summary;
  const lines = outcomes.map((o) => `${o.label}(${o.identifier}): ${o.detail}`);
  return [summary, ...lines].join('\n');
}

function isLikelyNetworkError(msg: string): boolean {
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|certificate|timeout|socket hang|getaddrinfo|connect /i.test(
    msg
  );
}

async function findHeadersByIdentifier(identifier: string): Promise<string[]> {
  const rows = await db
    .select({ colName: fmsIdentifierHeader.colName })
    .from(fmsIdentifierHeader)
    .where(eq(fmsIdentifierHeader.identifier, identifier))
    .orderBy(asc(fmsIdentifierHeader.colOrder));
  return rows.map((r) => String(r.colName ?? '').trim()).filter(Boolean);
}

async function saveErrorLog(
  identifier: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO fms_linkage.fms_error_log (identifier, error_code, error_message, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [identifier, errorCode, errorMessage]
    );
  } catch (e) {
    console.warn(`${LOG} error log save fail:`, e instanceof Error ? e.message : e);
  }
}

function saveRawDataToFile(
  filePath: string | null,
  identifier: string,
  rawData: string
): string | null {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) fs.mkdirSync(filePath, { recursive: true });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const outPath = path.join(filePath, `${identifier}_${stamp}.txt`);
    fs.writeFileSync(outPath, rawData, 'utf8');
    return outPath;
  } catch (e) {
    console.warn(`${LOG} file save fail:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function syncOneIdentifier(
  identifier: string,
  label: string,
  enabledSystems: string[] | null,
  facilPrefixMap: Map<string, FmsPrefix>
): Promise<FmsIdentifierOutcome> {
  const base = { identifier, label };
  const config = getFmsLinkageConfig();
  if (!config) {
    return { ...base, status: 'fail', detail: 'FMS 접속값이 없습니다.' };
  }

  const rawLine = await receiveFmsFirstLine(config, identifier);
  const response = parseFmsResponseLine(rawLine);

  if (response.code !== '0000') {
    const msg = response.message || response.raw || '응답 메시지 없음';
    if (response.code === 'E000') {
      console.info(`${LOG} ${identifier} empty: ${msg}`);
      return {
        ...base,
        status: 'empty',
        detail: `${msg} (E000, 신규·변경분 없음)`,
      };
    }
    await saveErrorLog(identifier, response.code, msg);
    console.warn(`${LOG} ${identifier} FMS error code=${response.code} msg=${msg}`);
    return { ...base, status: 'fail', detail: `FMS 오류 ${response.code}: ${msg}` };
  }

  if (!response.fmsKey) {
    await saveErrorLog(identifier, 'NO_KEY', 'FMS 반영키 없음');
    return { ...base, status: 'fail', detail: '다운로드 경로(반영키)가 없습니다.' };
  }

  const payload = await downloadFmsPayload(config, response.fmsKey);
  if (!payload.trim()) {
    await saveErrorLog(identifier, 'FETCH_EMPTY', '2차 다운로드 결과 없음');
    return { ...base, status: 'fail', detail: '2차 다운로드 결과가 비어 있습니다.' };
  }

  const saved = saveRawDataToFile(config.filePath, identifier, payload);
  if (saved) console.info(`${LOG} raw saved: ${saved}`);

  const headers = await findHeadersByIdentifier(identifier);
  const parsed = parseFmsDelimitedData(payload, identifier, headers);
  if (!parsed.length) {
    await saveErrorLog(identifier, 'PARSE_EMPTY', `파싱 0건 charset=${config.downloadCharset}`);
    return {
      ...base,
      status: 'fail',
      detail: `수신 데이터를 파싱하지 못했습니다 (charset=${config.downloadCharset}).`,
    };
  }

  const stats = await upsertFmsRowsToLayer(identifier, parsed, enabledSystems, facilPrefixMap);
  console.info(
    `${LOG} ${identifier} upsert ins=${stats.inserted} upd=${stats.updated} skip=${stats.skipped}`
  );

  await updateFmsCodeToKor(identifier);

  if (
    getFmsDataKindForIdentifier(identifier) === 'facility' &&
    stats.inserted + stats.updated > 0
  ) {
    try {
      const geomStats = await backfillFmsFacilityGeom({
        limit: Math.min(Math.max(stats.inserted + stats.updated, 50), 2000),
      });
      console.info(
        `${LOG} ${identifier} geom backfill scanned=${geomStats.scanned} updated=${geomStats.updated}`
      );
    } catch (e) {
      console.warn(
        `${LOG} ${identifier} geom backfill fail:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  if (stats.inserted + stats.updated > 0) {
    return {
      ...base,
      status: 'ok',
      detail: `저장 ${stats.inserted}건, 수정 ${stats.updated}건${stats.skipped ? `, 미분류 ${stats.skipped}건` : ''}`,
    };
  }
  return {
    ...base,
    status: 'empty',
    detail: `수신 ${parsed.length}건, 반영 0건 (시설구분 미매칭 등)`,
  };
}

/** v6 FmsInfoModule.run — fms_query_table 활성 identifier 순회 */
export async function runFmsSync(): Promise<FmsSyncResult> {
  if (running) {
    return {
      ok: false,
      skipped: 'already_running',
      jobStatus: 'FAILED',
      success: 0,
      empty: 0,
      fail: 0,
      message: '이미 FMS 연계가 실행 중입니다.',
    };
  }

  const config = getFmsLinkageConfig();
  if (!config) {
    return {
      ok: false,
      skipped: 'no_config',
      jobStatus: 'FAILED',
      success: 0,
      empty: 0,
      fail: 0,
      message:
        'runtime.env FMS_ORG_CODE·FMS_USER_ID·FMS_PASSWORD·FMS_CERTI_KEY·FMS_BASE_URL 가 필요합니다.',
    };
  }

  running = true;
  try {
    const queries = await db
      .select()
      .from(fmsQueryTable)
      .where(eq(fmsQueryTable.isActive, 'Y'));

    if (!queries.length) {
      return {
        ok: false,
        skipped: 'no_query',
        jobStatus: 'FAILED',
        success: 0,
        empty: 0,
        fail: 0,
        message: '활성 인터페이스가 없습니다. fms_query_table 을 확인하세요.',
      };
    }

    const enabledSystems = getEnabledSystemKeysFromRuntime();
    const facilPrefixMap = await buildFacilPrefixMap();
    const outcomes: FmsIdentifierOutcome[] = [];

    console.info(
      `${LOG} start queries=${queries.length} enabledSystems=${enabledSystems?.join(',') ?? '(all)'}`
    );

    for (const q of queries) {
      const identifier = String(q.identifier ?? '').trim();
      if (!identifier) continue;
      const label = outcomeLabel(identifier, q.interfaceName);
      try {
        const outcome = await syncOneIdentifier(identifier, label, enabledSystems, facilPrefixMap);
        outcomes.push(outcome);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${LOG} ${identifier} fail:`, msg);
        await saveErrorLog(identifier, 'SYSTEM_ERR', msg);
        const detail = isLikelyNetworkError(msg)
          ? `접속 실패: ${msg}`
          : msg;
        outcomes.push({ identifier, label, status: 'fail', detail });
      }
    }

    const success = outcomes.filter((o) => o.status === 'ok').length;
    const empty = outcomes.filter((o) => o.status === 'empty').length;
    const fail = outcomes.filter((o) => o.status === 'fail').length;
    const jobStatus = resolveJobStatus(success, fail);
    const message = formatSyncMessage(outcomes, jobStatus);
    console.info(`${LOG} ${message.replace(/\n/g, ' | ')}`);
    return { ok: jobStatus === 'SUCCESS', jobStatus, success, empty, fail, message };
  } finally {
    running = false;
  }
}
