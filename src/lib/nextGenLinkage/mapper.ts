import type { NewNglFeeList } from '@/database/schema/ngl_fee_list';

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function vaFields(item: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 1; i <= 20; i++) {
    out[`vtlacBankNm${i}`] = str(item[`vtlacBankNm${i}`]);
    out[`vrActno${i}`] = str(item[`vrActno${i}`]);
  }
  return out;
}

/** 과세번호 = 부서(7)+특별회계사업(4)+회계연도(4)+회계구분(2)+대표세입과목(6)+부과번호(6)+분납일련(2) */
export function buildTaxnNoKey(parts: {
  dptCd?: string | null;
  spacBizCd?: string | null;
  fyr?: string | null;
  actSeCd?: string | null;
  rprsTxmCd?: string | null;
  lvyNo?: string | null;
  itmSn?: string | null;
}): string {
  const pad = (v: string | null | undefined, n: number) =>
    String(v ?? '')
      .trim()
      .padStart(n, '0')
      .slice(-n);
  return (
    pad(parts.dptCd, 7) +
    pad(parts.spacBizCd, 4) +
    pad(parts.fyr, 4) +
    pad(parts.actSeCd, 2) +
    pad(parts.rprsTxmCd, 6) +
    pad(parts.lvyNo, 6) +
    pad(parts.itmSn, 2)
  );
}

/** B-1 부과/체납 → fee_status=미납, rcvmt_sn='' */
export function mapArrearsItem(item: Record<string, unknown>): NewNglFeeList {
  const mng: Record<string, string | null> = {};
  for (let i = 1; i <= 6; i++) mng[`mngItemSn${i}`] = str(item[`mngItemSn${i}`]);

  return {
    feeStatus: '미납',
    sgbCd: str(item.sgbCd),
    lvyKey: str(item.lvyKey),
    dptNm: str(item.dptNm),
    dptCd: str(item.dptCd),
    sgbNm: str(item.sgbNm),
    fyr: str(item.fyr),
    actSeCd: str(item.actSeCd),
    rprsTxmCd: str(item.rprsTxmCd),
    rprsTxmNm: str(item.rprsTxmNm),
    lvyNo: str(item.lvyNo),
    itmSn: str(item.itmSn),
    rcvmtSeNm: str(item.rcvmtSeNm),
    szrSeNm: str(item.szrSeNm),
    pyrSeCd: str(item.pyrSeCd),
    pyrMngNo: str(item.pyrMngNo),
    pyrAddrSn: str(item.pyrAddrSn),
    pyrNo: str(item.pyrNo),
    pyrNm: str(item.pyrNm),
    pyrSttCd: str(item.pyrSttCd),
    pyrSttNm: str(item.pyrSttNm),
    zip: str(item.zip),
    pyrAddr: str(item.pyrAddr),
    lotnoRoadAddrSeCd: str(item.lotnoRoadAddrSeCd),
    pyrCnpcNo: str(item.pyrCnpcNo),
    pyrMblCnpcNo: str(item.pyrMblCnpcNo),
    pyrEmlAddr: str(item.pyrEmlAddr),
    lvySeCd: str(item.lvySeCd),
    lvyYmd: str(item.lvyYmd),
    frstPidYmd: str(item.frstPidYmd),
    lastPidYmd: str(item.lastPidYmd),
    pidAfYmd: str(item.pidAfYmd),
    pidAfAmt: num(item.pidAfAmt),
    frstPctAmt: num(item.frstPctAmt),
    lvySttSeNm: str(item.lvySttSeNm),
    lastPctAmt: num(item.lastPctAmt),
    lastAdtnAmt: num(item.lastAdtnAmt),
    lastItmIntrAmt: num(item.lastItmIntrAmt),
    itmSeNm: str(item.itmSeNm),
    untyLvyDataSeNm: str(item.untyLvyDataSeNm),
    glNm: str(item.glNm),
    glMngNo: str(item.glMngNo),
    glLotnoRoadAddrSeCd: str(item.glLotnoRoadAddrSeCd),
    glZip: str(item.glZip),
    glAddr: str(item.glAddr),
    ...vaFields(item),
    epayNo: str(item.epayNo),
    ...mng,
    arrRsnCd: str(item.arrRsnCd),
    arrRsnNm: str(item.arrRsnNm),
    dftSeNm: str(item.dftSeNm),
    autoPaySeCd: str(item.autoPaySeCd),
    rdtSeNm: str(item.rdtSeNm),
    rpmSzrVhrno: str(item.rpmSzrVhrno),
    untyRprsKey: str(item.untyRprsKey),
    rcvmtSn: '',
    syncStatus: 'SYNCED',
  } as NewNglFeeList;
}

/** B-2 수납 → fee_status=수납 */
export function mapReceiptItem(item: Record<string, unknown>): NewNglFeeList {
  return {
    feeStatus: '수납',
    sgbCd: str(item.sgbCd),
    lvyKey: str(item.lvyKey),
    dptNm: str(item.dptNm),
    dptCd: str(item.dptCd),
    spacBizCd: str(item.spacBizCd),
    fyr: str(item.fyr),
    actSeCd: str(item.actSeCd),
    rprsTxmCd: str(item.rprsTxmCd),
    rprsTxmNm: str(item.rprsTxmNm),
    lvyNo: str(item.lvyNo),
    itmSn: str(item.itmSn),
    rcvmtSn: str(item.rcvmtSn) ?? '',
    rcvmtYmd: str(item.rcvmtYmd),
    rcvmtPctAmt: num(item.rcvmtPctAmt),
    rcvmtAdtnAmt: num(item.rcvmtAdtnAmt),
    itmIntrAmt: num(item.itmIntrAmt),
    rcvmtBank: str(item.rcvmtBank),
    rcvmtTyCd: str(item.rcvmtTyCd),
    rcvmtTyNm: str(item.rcvmtTyNm),
    actYmd: str(item.actYmd),
    pmkYmd: str(item.pmkYmd),
    frstPidYmd: str(item.frstPidYmd),
    lvyYmd: str(item.lvyYmd),
    glNm: str(item.glNm),
    ...vaFields(item),
    epayNo: str(item.epayNo),
    pyrNo: str(item.pyrNo),
    pyrNm: str(item.pyrNm),
    rcvmtSeCd: str(item.rcvmtSeCd),
    rcvmtSttSeCd: str(item.rcvmtSttSeCd),
    taxnNo: str(item.taxnNo),
    glMngNo: str(item.glMngNo),
    glAddr: str(item.glAddr),
    pyrAddr: str(item.pyrAddr),
    syncStatus: 'SYNCED',
  } as NewNglFeeList;
}
