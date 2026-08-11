/**
 * 점사용료(ngl_fee_list) 상세용 한글 필드명.
 * DB 코멘트·defineLayer와 분리 — 여기 값을 바꾸지 않으면 화면 라벨이 바뀌지 않는다.
 * key = camelCase (스키마 필드명)
 */
export const USE_FEE_FIELD_LABELS: Record<string, string> = {
  feeStatus: '상태',
  lvyNo: '부과번호',
  ledgerNo: '대장번호',
  fyr: '회계연도',
  dptNm: '부서명',
  dptCd: '부서코드',
  actSeCd: '회계구분코드',
  rprsTxmCd: '대표세입과목코드',
  rprsTxmNm: '대표세입과목명',
  itmSn: '분납일련번호',
  sgbCd: '지방자치단체코드',
  sgbNm: '자치단체명',
  pyrNo: '납부자번호',
  pyrNm: '납부자명',
  pyrAddr: '납부자주소',
  pyrSeCd: '납부자구분코드',
  pyrMngNo: '납부자관리번호',
  pyrSttCd: '납부자상태코드',
  pyrSttNm: '납부자상태',
  zip: '우편번호',
  pyrCnpcNo: '전화번호',
  pyrMblCnpcNo: '휴대폰번호',
  pyrEmlAddr: '이메일',
  lvySeCd: '부과구분코드',
  lvyYmd: '부과일자',
  frstPidYmd: '최초납기일자',
  lastPidYmd: '최종납기일자',
  pidAfYmd: '납기후일자',
  pidAfAmt: '납기후금액',
  frstPctAmt: '최초본세',
  lastPctAmt: '최종본세',
  lastAdtnAmt: '가산금',
  lastItmIntrAmt: '분납이자',
  lvySttSeNm: '부과상태',
  rcvmtSeNm: '수납구분명',
  szrSeNm: '압류구분명',
  itmSeNm: '분납구분명',
  untyLvyDataSeNm: '통합부과구분',
  rdtSeNm: '감경구분명',
  dftSeNm: '결손구분명',
  arrRsnCd: '체납사유코드',
  arrRsnNm: '체납사유',
  autoPaySeCd: '자동납부구분',
  glNm: '물건지명',
  glMngNo: '물건지관리번호',
  glAddr: '물건지주소',
  glZip: '물건지우편번호',
  acctItmCd: '회계과목코드',
  mngItemSn1: '점용기간',
  mngItemSn2: '점용면적',
  mngItemSn3: '공시지가',
  mngItemSn4: '점용목적',
  mngItemSn5: '관리항목5',
  mngItemSn6: '관리항목6',
  spacBizCd: '특별회계사업코드',
  rcvmtYmd: '수납일자',
  rcvmtPctAmt: '수납본세',
  rcvmtAdtnAmt: '수납가산금',
  itmIntrAmt: '수납분납이자',
  rcvmtBank: '수납은행',
  rcvmtTyCd: '수납유형코드',
  rcvmtTyNm: '수납유형',
  actYmd: '회계일자',
  pmkYmd: '납부일자',
  rcvmtSeCd: '수납구분코드',
  rcvmtSttSeCd: '수납상태코드',
  taxnNo: '과세번호',
};

for (let i = 1; i <= 20; i++) {
  USE_FEE_FIELD_LABELS[`vtlacBankNm${i}`] = `가상계좌은행${i}`;
  USE_FEE_FIELD_LABELS[`vrActno${i}`] = `가상계좌번호${i}`;
}

/** 상세 기본 노출(더보기 위) 항목 수 */
export const USE_FEE_DETAIL_PRIMARY_COUNT = 16;

export function labelForUseFeeField(field: string, fallback?: string): string {
  const key = String(field ?? '').trim();
  if (!key) return fallback ?? '';
  return USE_FEE_FIELD_LABELS[key] ?? USE_FEE_FIELD_LABELS[key.toLowerCase()] ?? fallback ?? field;
}
