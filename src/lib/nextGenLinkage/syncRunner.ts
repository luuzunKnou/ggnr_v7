import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/database/db';
import { nglQueryTable } from '@/database/schema/ngl_query_table';
import {
  USE_FEE_SYNC_DEFAULT_START_YEAR,
  USE_FEE_SYNC_MAX_EMPTY_COUNT,
} from '@/integrations/useFeeSync.config';
import { getNextGenLinkageConfig } from '@/lib/nextGenLinkage/config';
import { postNextGenJson } from '@/lib/nextGenLinkage/httpsClient';
import { mapArrearsItem, mapReceiptItem } from '@/lib/nextGenLinkage/mapper';
import { insertNextGenErrorLog, upsertArrearsRow, upsertReceiptRow } from '@/lib/nextGenLinkage/upsertFee';

const LOG = '[nextGenLinkage]';

export type NextGenSyncResult = {
  ok: boolean;
  skipped?: string;
  success: number;
  fail: number;
  message: string;
};

function padLvyNo(n: number): string {
  return String(n).padStart(6, '0');
}

function parseFyrList(fyr?: string | null): string[] {
  const raw = (fyr ?? '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const end = new Date().getFullYear();
  const list: string[] = [];
  for (let y = USE_FEE_SYNC_DEFAULT_START_YEAR; y <= end; y++) list.push(String(y));
  return list;
}

function buildHeader(ifId: string, srcOrgCd: string, srcSysCd: string) {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ifDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return {
    ifDate,
    ifMsgKey: `${srcOrgCd}${srcSysCd}-${randomUUID().replace(/-/g, '')}`,
    ifId,
    source: `${srcOrgCd}${srcSysCd}`,
    target: '1741000NIS',
    ifType: 'S',
  };
}

function appendCsv(filePath: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const isNew = !fs.existsSync(filePath);
  const keys = Object.keys(rows[0]!);
  const lines: string[] = [];
  if (isNew) lines.push(keys.join(','));
  for (const row of rows) {
    lines.push(
      keys
        .map((k) => {
          const v = row[k] == null ? '' : String(row[k]).replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(',')
    );
  }
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function fetchAndSave(params: {
  lvyNo: string;
  itmSn: string;
  fyr: string;
  rprsTxmCd: string;
  rprsTxmNm: string;
  spacBizCd: string;
  actSeCd: string;
  interfaceId: string;
  ifId: string;
  dptCd: string;
  runStamp: string;
  config: NonNullable<ReturnType<typeof getNextGenLinkageConfig>>;
}): Promise<boolean> {
  const { config } = params;
  const reqVo: Record<string, string> = {
    sgbCd: config.srcOrgCd,
    dptCd: params.dptCd,
    spacBizCd: params.spacBizCd,
    fyr: params.fyr,
    actSeCd: params.actSeCd,
    rprsTxmCd: params.rprsTxmCd,
    lvyNo: params.lvyNo,
    itmSn: params.itmSn,
  };
  if (params.interfaceId === 'B-2') reqVo.dmndClCd = '2';
  else reqVo.dmndSeCd = '2';

  const request = {
    header: buildHeader(params.ifId, config.srcOrgCd, config.srcSysCd),
    body: { reqVo },
  };
  const requestJson = JSON.stringify(request);
  const responseJson = await postNextGenJson({
    url: config.baseUrl,
    ifId: params.ifId,
    srcOrgCd: config.srcOrgCd,
    srcSysCd: config.srcSysCd,
    body: requestJson,
  });

  let response: Record<string, unknown>;
  try {
    response = JSON.parse(responseJson) as Record<string, unknown>;
  } catch {
    await insertNextGenErrorLog({
      lvyNo: params.lvyNo,
      itmSn: params.itmSn,
      interfaceId: params.ifId,
      rprsTxmCd: params.rprsTxmCd,
      rprsTxmNm: params.rprsTxmNm,
      errorCode: 'PARSE_ERR',
      errorMessage: responseJson.slice(0, 500),
    });
    return false;
  }

  const resBody = (response.body ?? null) as Record<string, unknown> | null;
  const linkRstCd = resBody ? String(resBody.linkRstCd ?? 'UNKNOWN') : 'UNKNOWN';
  const linkRstMsg = resBody ? String(resBody.linkRstMsg ?? '') : '';

  if (linkRstCd === '005') return false;

  if (linkRstCd === '002' || linkRstCd === '003' || linkRstCd === '006') {
    await insertNextGenErrorLog({
      lvyNo: params.lvyNo,
      itmSn: params.itmSn,
      interfaceId: params.ifId,
      rprsTxmCd: params.rprsTxmCd,
      rprsTxmNm: params.rprsTxmNm,
      errorCode: linkRstCd,
      errorMessage: linkRstMsg,
    });
    return false;
  }

  if (linkRstCd !== '001' && linkRstCd !== '004') {
    await insertNextGenErrorLog({
      lvyNo: params.lvyNo,
      itmSn: params.itmSn,
      interfaceId: params.ifId,
      rprsTxmCd: params.rprsTxmCd,
      rprsTxmNm: params.rprsTxmNm,
      errorCode: linkRstCd,
      errorMessage: linkRstMsg || 'unknown linkRstCd',
    });
    return false;
  }

  const resVo1 = (resBody?.resVo1 ?? null) as Record<string, unknown>[] | null;
  if (!resVo1?.length) return false;

  if (params.interfaceId === 'B-2') {
    for (const item of resVo1) await upsertReceiptRow(mapReceiptItem(item));
  } else {
    // 조회에 쓰는 특별회계사업코드를 미납 행에도 저장 → 이후 과세번호 매칭 키에 포함
    for (const item of resVo1) {
      const mapped = mapArrearsItem(item);
      await upsertArrearsRow({
        ...mapped,
        spacBizCd: mapped.spacBizCd || params.spacBizCd || null,
      });
    }
  }

  if (config.filePath) {
    const label = params.interfaceId === 'B-2' ? '수납상세' : '부과체납상세';
    const filePath = path.join(config.filePath, `차세대 세외수입_${label}_${params.runStamp}.csv`);
    try {
      appendCsv(filePath, resVo1);
    } catch (e) {
      console.warn(`${LOG} csv save fail:`, e instanceof Error ? e.message : e);
    }
  }

  return true;
}

let running = false;

/** v6 NextGenInfoModule.run 이식 — 통합 테이블 ngl_fee_list 저장 */
export async function runNextGenFeeSync(params?: { fyr?: string }): Promise<NextGenSyncResult> {
  if (running) {
    return { ok: false, skipped: 'already_running', success: 0, fail: 0, message: '이미 연계가 실행 중입니다.' };
  }

  const config = getNextGenLinkageConfig();
  if (!config) {
    return {
      ok: false,
      skipped: 'no_config',
      success: 0,
      fail: 0,
      message: 'useFeeSync.config 의 USE_FEE_SYNC_CONNECTION(baseUrl·srcOrgCd·srcSysCd) 이 필요합니다.',
    };
  }

  running = true;
  const runStamp = (() => {
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  })();

  try {
    const queries = await db
      .select()
      .from(nglQueryTable)
      .where(eq(nglQueryTable.isActive, 'Y'));

    if (!queries.length) {
      return {
        ok: false,
        skipped: 'no_query',
        success: 0,
        fail: 0,
        message: '활성 인터페이스가 없습니다. ngl_query_table 을 확인하세요.',
      };
    }

    const fyrList = parseFyrList(params?.fyr);
    console.info(`${LOG} start fyr=${fyrList.join(',')} queries=${queries.length} stamp=${runStamp}`);

    let totalSuccess = 0;
    let totalFail = 0;

    for (const fyr of fyrList) {
      for (const query of queries) {
        const interfaceId = String(query.interfaceId ?? '').trim();
        const ifId = String(query.ifId ?? '').trim();
        const rprsTxmCd = String(query.rprsTxmCd ?? '').trim();
        const rprsTxmNm = String(query.rprsTxmNm ?? '').trim();
        const spacBizCd = String(query.spacBizCd ?? '').trim();
        const actSeCd = String(query.actSeCd ?? '').trim();
        const dptCd = String(query.dptCd ?? '').trim();
        if (!interfaceId || !ifId || !rprsTxmCd) continue;

        let nextLvyNo = 1;
        let emptyCount = 0;
        let success = 0;
        let fail = 0;

        while (true) {
          const lvyNoStr = padLvyNo(nextLvyNo);
          try {
            const hasData = await fetchAndSave({
              lvyNo: lvyNoStr,
              itmSn: '00',
              fyr,
              rprsTxmCd,
              rprsTxmNm,
              spacBizCd,
              actSeCd,
              interfaceId,
              ifId,
              dptCd,
              runStamp,
              config,
            });
            if (hasData) {
              success++;
              emptyCount = 0;
            } else {
              emptyCount++;
              if (emptyCount >= USE_FEE_SYNC_MAX_EMPTY_COUNT) break;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`${LOG} http err lvyNo=${lvyNoStr}:`, msg);
            await insertNextGenErrorLog({
              lvyNo: lvyNoStr,
              itmSn: '00',
              interfaceId: ifId,
              rprsTxmCd,
              rprsTxmNm,
              errorCode: 'HTTP_ERR',
              errorMessage: msg,
            });
            fail++;
            emptyCount++;
            if (emptyCount >= USE_FEE_SYNC_MAX_EMPTY_COUNT) break;
          }
          nextLvyNo++;
        }

        totalSuccess += success;
        totalFail += fail;
        console.info(
          `${LOG} done fyr=${fyr} rprsTxmCd=${rprsTxmCd} interface=${interfaceId} success=${success} fail=${fail}`
        );
      }
    }

    const message = `연계 완료 — 성공 ${totalSuccess}, 실패 ${totalFail}`;
    console.info(`${LOG} end ${message}`);
    return { ok: true, success: totalSuccess, fail: totalFail, message };
  } finally {
    running = false;
  }
}
