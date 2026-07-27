import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { nglErrorLog } from '@/database/schema/ngl_error_log';
import { nglFeeList, type NewNglFeeList } from '@/database/schema/ngl_fee_list';

const nowSql = sql`now()`;

function arrearsUpdateSet(row: NewNglFeeList) {
  return {
    feeStatus: '미납' as const,
    sgbCd: row.sgbCd,
    dptNm: row.dptNm,
    dptCd: row.dptCd,
    sgbNm: row.sgbNm,
    fyr: row.fyr,
    actSeCd: row.actSeCd,
    rprsTxmCd: row.rprsTxmCd,
    rprsTxmNm: row.rprsTxmNm,
    lvyNo: row.lvyNo,
    itmSn: row.itmSn,
    rcvmtSeNm: row.rcvmtSeNm,
    szrSeNm: row.szrSeNm,
    pyrSeCd: row.pyrSeCd,
    pyrMngNo: row.pyrMngNo,
    pyrAddrSn: row.pyrAddrSn,
    pyrNo: row.pyrNo,
    pyrNm: row.pyrNm,
    pyrSttCd: row.pyrSttCd,
    pyrSttNm: row.pyrSttNm,
    zip: row.zip,
    pyrAddr: row.pyrAddr,
    lotnoRoadAddrSeCd: row.lotnoRoadAddrSeCd,
    pyrCnpcNo: row.pyrCnpcNo,
    pyrMblCnpcNo: row.pyrMblCnpcNo,
    pyrEmlAddr: row.pyrEmlAddr,
    lvySeCd: row.lvySeCd,
    lvyYmd: row.lvyYmd,
    frstPidYmd: row.frstPidYmd,
    lastPidYmd: row.lastPidYmd,
    pidAfYmd: row.pidAfYmd,
    pidAfAmt: row.pidAfAmt,
    frstPctAmt: row.frstPctAmt,
    lvySttSeNm: row.lvySttSeNm,
    lastPctAmt: row.lastPctAmt,
    lastAdtnAmt: row.lastAdtnAmt,
    lastItmIntrAmt: row.lastItmIntrAmt,
    itmSeNm: row.itmSeNm,
    untyLvyDataSeNm: row.untyLvyDataSeNm,
    glNm: row.glNm,
    glMngNo: row.glMngNo,
    glLotnoRoadAddrSeCd: row.glLotnoRoadAddrSeCd,
    glZip: row.glZip,
    glAddr: row.glAddr,
    vtlacBankNm1: row.vtlacBankNm1,
    vrActno1: row.vrActno1,
    vtlacBankNm2: row.vtlacBankNm2,
    vrActno2: row.vrActno2,
    vtlacBankNm3: row.vtlacBankNm3,
    vrActno3: row.vrActno3,
    vtlacBankNm4: row.vtlacBankNm4,
    vrActno4: row.vrActno4,
    vtlacBankNm5: row.vtlacBankNm5,
    vrActno5: row.vrActno5,
    vtlacBankNm6: row.vtlacBankNm6,
    vrActno6: row.vrActno6,
    vtlacBankNm7: row.vtlacBankNm7,
    vrActno7: row.vrActno7,
    vtlacBankNm8: row.vtlacBankNm8,
    vrActno8: row.vrActno8,
    vtlacBankNm9: row.vtlacBankNm9,
    vrActno9: row.vrActno9,
    vtlacBankNm10: row.vtlacBankNm10,
    vrActno10: row.vrActno10,
    vtlacBankNm11: row.vtlacBankNm11,
    vrActno11: row.vrActno11,
    vtlacBankNm12: row.vtlacBankNm12,
    vrActno12: row.vrActno12,
    vtlacBankNm13: row.vtlacBankNm13,
    vrActno13: row.vrActno13,
    vtlacBankNm14: row.vtlacBankNm14,
    vrActno14: row.vrActno14,
    vtlacBankNm15: row.vtlacBankNm15,
    vrActno15: row.vrActno15,
    vtlacBankNm16: row.vtlacBankNm16,
    vrActno16: row.vrActno16,
    vtlacBankNm17: row.vtlacBankNm17,
    vrActno17: row.vrActno17,
    vtlacBankNm18: row.vtlacBankNm18,
    vrActno18: row.vrActno18,
    vtlacBankNm19: row.vtlacBankNm19,
    vrActno19: row.vrActno19,
    vtlacBankNm20: row.vtlacBankNm20,
    vrActno20: row.vrActno20,
    epayNo: row.epayNo,
    mngItemSn1: row.mngItemSn1,
    mngItemSn2: row.mngItemSn2,
    mngItemSn3: row.mngItemSn3,
    mngItemSn4: row.mngItemSn4,
    mngItemSn5: row.mngItemSn5,
    mngItemSn6: row.mngItemSn6,
    arrRsnCd: row.arrRsnCd,
    arrRsnNm: row.arrRsnNm,
    dftSeNm: row.dftSeNm,
    autoPaySeCd: row.autoPaySeCd,
    rdtSeNm: row.rdtSeNm,
    rpmSzrVhrno: row.rpmSzrVhrno,
    untyRprsKey: row.untyRprsKey,
    syncStatus: 'SYNCED',
    syncedAt: nowSql,
    updatedAt: nowSql,
  };
}

function receiptUpdateSet(row: NewNglFeeList) {
  return {
    feeStatus: '수납' as const,
    sgbCd: row.sgbCd,
    dptNm: row.dptNm,
    dptCd: row.dptCd,
    spacBizCd: row.spacBizCd,
    fyr: row.fyr,
    actSeCd: row.actSeCd,
    rprsTxmCd: row.rprsTxmCd,
    rprsTxmNm: row.rprsTxmNm,
    lvyNo: row.lvyNo,
    itmSn: row.itmSn,
    rcvmtYmd: row.rcvmtYmd,
    rcvmtPctAmt: row.rcvmtPctAmt,
    rcvmtAdtnAmt: row.rcvmtAdtnAmt,
    itmIntrAmt: row.itmIntrAmt,
    rcvmtBank: row.rcvmtBank,
    rcvmtTyCd: row.rcvmtTyCd,
    rcvmtTyNm: row.rcvmtTyNm,
    actYmd: row.actYmd,
    pmkYmd: row.pmkYmd,
    frstPidYmd: row.frstPidYmd,
    lvyYmd: row.lvyYmd,
    glNm: row.glNm,
    vtlacBankNm1: row.vtlacBankNm1,
    vrActno1: row.vrActno1,
    vtlacBankNm2: row.vtlacBankNm2,
    vrActno2: row.vrActno2,
    vtlacBankNm3: row.vtlacBankNm3,
    vrActno3: row.vrActno3,
    vtlacBankNm4: row.vtlacBankNm4,
    vrActno4: row.vrActno4,
    vtlacBankNm5: row.vtlacBankNm5,
    vrActno5: row.vrActno5,
    vtlacBankNm6: row.vtlacBankNm6,
    vrActno6: row.vrActno6,
    vtlacBankNm7: row.vtlacBankNm7,
    vrActno7: row.vrActno7,
    vtlacBankNm8: row.vtlacBankNm8,
    vrActno8: row.vrActno8,
    vtlacBankNm9: row.vtlacBankNm9,
    vrActno9: row.vrActno9,
    vtlacBankNm10: row.vtlacBankNm10,
    vrActno10: row.vrActno10,
    vtlacBankNm11: row.vtlacBankNm11,
    vrActno11: row.vrActno11,
    vtlacBankNm12: row.vtlacBankNm12,
    vrActno12: row.vrActno12,
    vtlacBankNm13: row.vtlacBankNm13,
    vrActno13: row.vrActno13,
    vtlacBankNm14: row.vtlacBankNm14,
    vrActno14: row.vrActno14,
    vtlacBankNm15: row.vtlacBankNm15,
    vrActno15: row.vrActno15,
    vtlacBankNm16: row.vtlacBankNm16,
    vrActno16: row.vrActno16,
    vtlacBankNm17: row.vtlacBankNm17,
    vrActno17: row.vrActno17,
    vtlacBankNm18: row.vtlacBankNm18,
    vrActno18: row.vrActno18,
    vtlacBankNm19: row.vtlacBankNm19,
    vrActno19: row.vrActno19,
    vtlacBankNm20: row.vtlacBankNm20,
    vrActno20: row.vrActno20,
    epayNo: row.epayNo,
    pyrNo: row.pyrNo,
    pyrNm: row.pyrNm,
    rcvmtSeCd: row.rcvmtSeCd,
    rcvmtSttSeCd: row.rcvmtSttSeCd,
    taxnNo: row.taxnNo,
    glMngNo: row.glMngNo,
    glAddr: row.glAddr,
    pyrAddr: row.pyrAddr,
    syncStatus: 'SYNCED',
    syncedAt: nowSql,
    updatedAt: nowSql,
  };
}

export async function upsertArrearsRow(row: NewNglFeeList): Promise<void> {
  const key = String(row.lvyKey ?? '').trim();
  if (!key) return;
  const values: NewNglFeeList = {
    ...row,
    lvyKey: key,
    rcvmtSn: '',
    feeStatus: '미납',
    syncedAt: new Date().toISOString(),
  };
  await db
    .insert(nglFeeList)
    .values(values)
    .onConflictDoUpdate({
      target: [nglFeeList.lvyKey, nglFeeList.rcvmtSn],
      set: arrearsUpdateSet(values),
    });
}

export async function upsertReceiptRow(row: NewNglFeeList): Promise<void> {
  const key = String(row.lvyKey ?? '').trim();
  if (!key) return;
  const sn = String(row.rcvmtSn ?? '').trim();
  const values: NewNglFeeList = {
    ...row,
    lvyKey: key,
    rcvmtSn: sn,
    feeStatus: '수납',
    syncedAt: new Date().toISOString(),
  };
  await db
    .insert(nglFeeList)
    .values(values)
    .onConflictDoUpdate({
      target: [nglFeeList.lvyKey, nglFeeList.rcvmtSn],
      set: receiptUpdateSet(values),
    });

  // 수납이 생기면 동일 부과키의 미납(수납일련='') 행 제거
  await db
    .delete(nglFeeList)
    .where(and(eq(nglFeeList.lvyKey, key), eq(nglFeeList.feeStatus, '미납'), eq(nglFeeList.rcvmtSn, '')));
}

export async function insertNextGenErrorLog(params: {
  lvyNo: string;
  itmSn: string;
  interfaceId: string;
  rprsTxmCd: string;
  rprsTxmNm: string;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  try {
    await db.insert(nglErrorLog).values({
      lvyNo: params.lvyNo,
      itmSn: params.itmSn,
      interfaceId: params.interfaceId,
      rprsTxmCd: params.rprsTxmCd,
      rprsTxmNm: params.rprsTxmNm,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage?.slice(0, 4000) ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[nextGenLinkage] error log insert failed:', e instanceof Error ? e.message : e);
  }
}
