/**
 * 공통 점용대장 — 기능관리 ser_eng(`water|road|publicOccupationLedger`) → 물리 테이블
 * 테이블명 접두(water_/road_/public_)와 동일 순서로 맞춘다.
 */

export type OccupationLedgerFieldMap = {
  keyField: string;
  nameField: string;
  placeField: string;
  periodField?: string;
  startField?: string;
  endField?: string;
  childParentField: string;
  childAddressField: string;
};

export type OccupationLedgerBinding = {
  schema: 'layer';
  mainTable: string;
  jijukTable: string;
  mgjTable: string;
  fields: OccupationLedgerFieldMap;
  editPresetKey: string;
  title: string;
  serEng: OccupationLedgerSerEng;
};

export const OCCUPATION_LEDGER_SER_ENGS = [
  'waterOccupationLedger',
  'roadOccupationLedger',
  'publicOccupationLedger',
] as const;

export type OccupationLedgerSerEng = (typeof OCCUPATION_LEDGER_SER_ENGS)[number];

const COMMON_FIELDS: OccupationLedgerFieldMap = {
  keyField: 'id',
  nameField: 'work_name',
  placeField: 'occup_place',
  startField: 'perm_start_date',
  endField: 'perm_end_date',
  childParentField: 'id',
  childAddressField: 'occup_place',
};

function commonBinding(
  serEng: OccupationLedgerSerEng,
  prefix: 'water' | 'road' | 'public',
  title: string,
  editPresetKey: string
): OccupationLedgerBinding {
  const base = `${prefix}_occupationledger`;
  return {
    schema: 'layer',
    mainTable: base,
    jijukTable: `${base}_jijuk`,
    mgjTable: `${base}_mgj`,
    fields: COMMON_FIELDS,
    editPresetKey,
    title,
    serEng,
  };
}

const BINDINGS_BY_SER_ENG: Record<OccupationLedgerSerEng, OccupationLedgerBinding> = {
  waterOccupationLedger: commonBinding(
    'waterOccupationLedger',
    'water',
    '하천점용1',
    'waterOccupationLedger'
  ),
  roadOccupationLedger: commonBinding(
    'roadOccupationLedger',
    'road',
    '도로점용',
    'roadOccupationLedger'
  ),
  publicOccupationLedger: commonBinding(
    'publicOccupationLedger',
    'public',
    '국공유지',
    'publicOccupationLedger'
  ),
};

export function isOccupationLedgerSerEng(serEng: string): serEng is OccupationLedgerSerEng {
  return (OCCUPATION_LEDGER_SER_ENGS as readonly string[]).includes(serEng);
}

/** opened 쿼리 토큰이 *OccupationLedger 인지 */
export function isOccupationLedgerOpenedToken(token: string): boolean {
  return isOccupationLedgerSerEng(String(token ?? '').trim());
}

/** opened 목록에서 현재 열린 점용대장 ser_eng */
export function findOpenedOccupationLedgerSerEng(
  openedTokens: string[]
): OccupationLedgerSerEng | null {
  for (const t of openedTokens) {
    const s = String(t ?? '').trim();
    if (isOccupationLedgerSerEng(s)) return s;
  }
  return null;
}

/**
 * ser_eng로 바인딩 조회.
 * 레거시 호환: system(river/road/build)만 오면 해당 ser_eng로 변환.
 */
export function getOccupationLedgerBinding(params: {
  serEng?: string | null;
  /** @deprecated serEng 우선. 없으면 system으로 추정 */
  system?: string | null;
}): OccupationLedgerBinding | null {
  const eng = String(params.serEng ?? '').trim();
  if (isOccupationLedgerSerEng(eng)) return BINDINGS_BY_SER_ENG[eng];

  const system = String(params.system ?? '').trim().toLowerCase();
  if (system === 'river') return BINDINGS_BY_SER_ENG.waterOccupationLedger;
  if (system === 'road') return BINDINGS_BY_SER_ENG.roadOccupationLedger;
  if (system === 'build') return BINDINGS_BY_SER_ENG.publicOccupationLedger;
  return null;
}

export function getOccupationLedgerWmsLayerIds(binding: OccupationLedgerBinding): string[] {
  return [binding.mainTable, binding.jijukTable, binding.mgjTable].map((t) =>
    t.trim().toLowerCase()
  );
}

export function isOccupationLedgerWmsLayerId(
  tableName: string,
  binding: OccupationLedgerBinding | null
): boolean {
  if (!binding) return false;
  const set = new Set(getOccupationLedgerWmsLayerIds(binding));
  return set.has(String(tableName ?? '').trim().toLowerCase());
}
