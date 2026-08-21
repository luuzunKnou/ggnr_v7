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
import { getNglFeeListTableByPrefix } from '@/lib/nextGenLinkage/nglFeeTables';
import { insertNextGenErrorLog, upsertArrearsRow, upsertReceiptRow } from '@/lib/nextGenLinkage/upsertFee';
import {
  getUseFeePrefixForRprsTxmNm,
  isUseFeePrefixAllowedBySystems,
} from '@/lib/useFeeBinding';
import { getEnabledSystemKeysFromRuntime } from '@/lib/runtimeEnvFile';
import type { NglFeeListTable } from '@/database/schema/ngl_fee_list';

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

const PROGRESS_EVERY = 10;

type FetchSaveKind = 'saved' | 'empty' | 'error';

function kindLabel(interfaceId: string): string {
  return interfaceId === 'B-2' ? '수납' : '미납';
}

function previewItem(item: Record<string, unknown>): string {
  const key = String(item.lvyKey ?? '').trim() || '-';
  const pyr = String(item.pyrNm ?? '').trim() || '-';
  const addr = String(item.glAddr ?? '').trim() || '-';
  const amt = String(item.lastPctAmt ?? item.pidAfAmt ?? item.rcvmtPctAmt ?? '').trim() || '-';
  return `부과키=${key} 납부자=${pyr} 주소=${addr} 금액=${amt}`;
}

function fetchCtx(p: { fyr: string; rprsTxmNm: string; interfaceId: string; lvyNo: string }): string {
  return `연도=${p.fyr} 과목=${p.rprsTxmNm} ${kindLabel(p.interfaceId)} 부과=${p.lvyNo}`;
}

async function recordSyncError(
  params: {
    lvyNo: string;
    itmSn: string;
    ifId: string;
    rprsTxmCd: string;
    rprsTxmNm: string;
    fyr: string;
    interfaceId: string;
  },
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const msg = String(errorMessage ?? '').trim();
  console.warn(`${LOG} 오류 ${fetchCtx(params)} 코드=${errorCode}${msg ? ` ${msg}` : ''}`);
  await insertNextGenErrorLog({
    lvyNo: params.lvyNo,
    itmSn: params.itmSn,
    interfaceId: params.ifId,
    rprsTxmCd: params.rprsTxmCd,
    rprsTxmNm: params.rprsTxmNm,
    errorCode,
    errorMessage: msg,
  });
}

type FetchSaveResult = {
  kind: FetchSaveKind;
  savedRows: number;
  samples: string[];
};

function fetchResult(kind: FetchSaveKind, savedRows = 0, samples: string[] = []): FetchSaveResult {
  return { kind, savedRows, samples };
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
  feeTable: NglFeeListTable;
  tableName: string;
}): Promise<FetchSaveResult> {
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
    await recordSyncError(params, 'PARSE_ERR', responseJson.slice(0, 500));
    return fetchResult('error');
  }

  const resBody = (response.body ?? null) as Record<string, unknown> | null;
  const linkRstCd = resBody ? String(resBody.linkRstCd ?? 'UNKNOWN') : 'UNKNOWN';
  const linkRstMsg = resBody ? String(resBody.linkRstMsg ?? '') : '';

  if (linkRstCd === '005') return fetchResult('empty');

  if (linkRstCd === '002' || linkRstCd === '003' || linkRstCd === '006') {
    await recordSyncError(params, linkRstCd, linkRstMsg);
    return fetchResult('error');
  }

  if (linkRstCd !== '001' && linkRstCd !== '004') {
    await recordSyncError(params, linkRstCd, linkRstMsg || '알 수 없는 연계 코드');
    return fetchResult('error');
  }

  const resVo1 = (resBody?.resVo1 ?? null) as Record<string, unknown>[] | null;
  if (!resVo1?.length) {
    await recordSyncError(params, 'EMPTY_BODY', `성공코드=${linkRstCd} 인데 행이 없습니다`);
    return fetchResult('empty');
  }

  let savedRows = 0;
  const samples: string[] = [];
  const saveOne = async (item: Record<string, unknown>, kind: 'receipt' | 'arrears') => {
    try {
      let r;
      if (kind === 'receipt') {
        r = await upsertReceiptRow(mapReceiptItem(item), params.feeTable, params.tableName);
      } else {
        const mapped = mapArrearsItem(item);
        r = await upsertArrearsRow(
          {
            ...mapped,
            spacBizCd: mapped.spacBizCd || params.spacBizCd || null,
          },
          params.feeTable,
          params.tableName
        );
      }
      if (!r.saved) {
        await recordSyncError(params, 'NO_LVY_KEY', previewItem(item));
        return;
      }
      savedRows++;
      if (samples.length < 2) samples.push(previewItem(item));
    } catch (e) {
      await recordSyncError(
        params,
        'SAVE_ERR',
        `${previewItem(item)} ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  if (params.interfaceId === 'B-2') {
    for (const item of resVo1) await saveOne(item, 'receipt');
  } else {
    for (const item of resVo1) await saveOne(item, 'arrears');
  }

  if (savedRows === 0) {
    await recordSyncError(params, 'SAVE_NONE', `수신=${resVo1.length} ${previewItem(resVo1[0]!)}`);
    return fetchResult('error');
  }

  if (config.filePath) {
    const label = params.interfaceId === 'B-2' ? '수납상세' : '부과체납상세';
    const filePath = path.join(config.filePath, `차세대 세외수입_${label}_${params.runStamp}.csv`);
    try {
      appendCsv(filePath, resVo1);
    } catch (e) {
      console.warn(`${LOG} csv 저장 실패:`, e instanceof Error ? e.message : e);
    }
  }

  return fetchResult('saved', savedRows, samples);
}

let running = false;

export function isNextGenFeeSyncRunning(): boolean {
  return running;
}

/** 수동 시작 전 — 이미 실행 중이거나 접속값이 없으면 안내 문구 */
export function getNextGenFeeSyncBlockReason(): string | null {
  if (running) return '이미 연계가 실행 중입니다.';
  if (!getNextGenLinkageConfig()) {
    return '차세대 연계 접속 설정이 없습니다.';
  }
  return null;
}

/** v6 NextGenInfoModule.run 이식 — rprs_txm_nm별 water|road|public_ngl_fee_list 저장 */
export async function runNextGenFeeSync(params?: { fyr?: string }): Promise<NextGenSyncResult> {
  if (running) {
    console.info(`${LOG} 건너뜀 — 이미 실행 중`);
    return { ok: false, skipped: 'already_running', success: 0, fail: 0, message: '이미 연계가 실행 중입니다.' };
  }

  const config = getNextGenLinkageConfig();
  if (!config) {
    console.warn(`${LOG} 중단 — 차세대 연계 접속 설정이 없습니다`);
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
    const enabledSystems = getEnabledSystemKeysFromRuntime();
    const queries = await db
      .select()
      .from(nglQueryTable)
      .where(eq(nglQueryTable.isActive, 'Y'));

    if (!queries.length) {
      console.warn(`${LOG} 중단 — 활성 조회가 없습니다`);
      return {
        ok: false,
        skipped: 'no_query',
        success: 0,
        fail: 0,
        message: '활성 인터페이스가 없습니다. ngl_query_table 을 확인하세요.',
      };
    }

    const fyrList = parseFyrList(params?.fyr);
    const fyrFrom = fyrList[0] ?? '';
    const fyrTo = fyrList[fyrList.length - 1] ?? '';
    console.info(
      `${LOG} 시작 연도=${fyrFrom}~${fyrTo} (${fyrList.length}년) 조회=${queries.length}개 stamp=${runStamp} 시스템=${enabledSystems?.join(',') ?? '(전체)'}`
    );

    let totalSuccess = 0;
    let totalFail = 0;
    let skippedQuery = 0;

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

        const prefix = getUseFeePrefixForRprsTxmNm(rprsTxmNm);
        if (!prefix) {
          skippedQuery++;
          console.info(`${LOG} 건너뜀 과목=${rprsTxmNm} — 하천·도로·국공유지에 해당 없음`);
          continue;
        }
        if (!isUseFeePrefixAllowedBySystems(prefix, enabledSystems)) {
          skippedQuery++;
          console.info(`${LOG} 건너뜀 과목=${rprsTxmNm} — 이 시스템의 점사용료가 아님`);
          continue;
        }
        const feeTable = getNglFeeListTableByPrefix(prefix);
        const tableName = `${prefix}_ngl_fee_list`;

        let nextLvyNo = 1;
        let emptyCount = 0;
        let fail = 0;
        let scanned = 0;
        let rowOk = 0;
        const samples: string[] = [];

        console.info(
          `${LOG} 조회 시작 연도=${fyr} 과목=${rprsTxmNm} ${kindLabel(interfaceId)}`
        );

        while (true) {
          const lvyNoStr = padLvyNo(nextLvyNo);
          scanned++;
          try {
            const result = await fetchAndSave({
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
              feeTable,
              tableName,
            });
            if (result.kind === 'saved') {
              rowOk += result.savedRows;
              for (const s of result.samples) {
                if (samples.length < 2) samples.push(s);
              }
              emptyCount = 0;
            } else if (result.kind === 'error') {
              fail++;
              emptyCount++;
              if (emptyCount >= USE_FEE_SYNC_MAX_EMPTY_COUNT) break;
            } else {
              emptyCount++;
              if (emptyCount >= USE_FEE_SYNC_MAX_EMPTY_COUNT) break;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await recordSyncError(
              {
                lvyNo: lvyNoStr,
                itmSn: '00',
                ifId,
                rprsTxmCd,
                rprsTxmNm,
                fyr,
                interfaceId,
              },
              'HTTP_ERR',
              msg
            );
            fail++;
            emptyCount++;
            if (emptyCount >= USE_FEE_SYNC_MAX_EMPTY_COUNT) break;
          }
          if (scanned % PROGRESS_EVERY === 0) {
            console.info(
              `${LOG} 진행 연도=${fyr} 과목=${rprsTxmNm} ${kindLabel(interfaceId)} 건수=${rowOk} 실패=${fail} 빈응답연속=${emptyCount}`
            );
          }
          nextLvyNo++;
        }

        totalSuccess += rowOk;
        totalFail += fail;
        const sampleText = samples.length ? ` 확인=${samples.join(' / ')}` : '';
        console.info(
          `${LOG} 조회 끝 연도=${fyr} 과목=${rprsTxmNm} ${kindLabel(interfaceId)} 건수=${rowOk} 실패=${fail}${sampleText}`
        );
      }
    }

    const message = `연계 완료 — 건수 ${totalSuccess}, 실패 ${totalFail}${skippedQuery ? `, 스킵조회 ${skippedQuery}` : ''}`;
    console.info(`${LOG} 전체 끝 ${message}`);
    return { ok: true, success: totalSuccess, fail: totalFail, message };
  } finally {
    running = false;
  }
}
