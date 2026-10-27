/**
 * 공통 점용대장 — 기능관리 ser_eng(`water|road|publicOccupationLedger`) → 물리 테이블·칸 이름.
 * 하천·도로는 받은 원천자료(울진 기준) 테이블, 국공유지는 기존 테이블.
 * 공통 칸 이름(10글자 이내)만 여기서 맞추고, 대장에만 있는 칸은 extra(jsonb)·필드 정의로 보인다.
 */

export type OccupationLedgerFieldMap = {
  /** 본표 키 — 목록·상세·필지·물건지 연결·첨부 폴더 기준값 (하천·도로 관리번호, 국공유지 고유키) */
  keyField: string;
  /** 관리번호(공사번호) */
  mgmtField?: string;
  permitField: string;
  permitDateField?: string;
  nameField: string;
  placeField: string;
  purposeField?: string;
  startField?: string;
  endField?: string;
  areaField?: string;
  ownerNameField?: string;
  ownerAddrField?: string;
  stateField: string;
  remarkField?: string;
  /** 필지·물건지에서 본표 고유키 값을 담는 칸 */
  childParentField: string;
  /** 필지·물건지 주소 칸 */
  childAddressField: string;
  /** 주소 칸이 없을 때 이어 붙일 칸 (예: 읍면동 · 리 · 지번) */
  childAddressPartFields?: string[];
};

export type OccupationLedgerBinding = {
  schema: 'layer';
  mainTable: string;
  /** 필지(점용필지) */
  jijukTable: string;
  /** 물건지 */
  mgjTable: string;
  fields: OccupationLedgerFieldMap;
  editPresetKey: string;
  title: string;
  serEng: OccupationLedgerSerEng;
  /** 첨부파일 폴더 file_data/{fileLayer}/{본표 키 값} */
  fileLayer: string;
  /** 새 건 등록 시 서버가 자동 채번하는 칸 (마지막 번호 +1) */
  autoCodeField?: string;
  /** 자동 채번 첫 번호 (표가 비어 있을 때) */
  autoCodeDefault?: string;
};

export const OCCUPATION_LEDGER_SER_ENGS = [
  'waterOccupationLedger',
  'roadOccupationLedger',
  'publicOccupationLedger',
] as const;

export type OccupationLedgerSerEng = (typeof OCCUPATION_LEDGER_SER_ENGS)[number];

export const OCCUPATION_LEDGER_PREFIXES = ['water', 'road', 'public'] as const;
export type OccupationLedgerPrefix = (typeof OCCUPATION_LEDGER_PREFIXES)[number];

export function isOccupationLedgerPrefix(v: string): v is OccupationLedgerPrefix {
  return (OCCUPATION_LEDGER_PREFIXES as readonly string[]).includes(v);
}

export function occupationLedgerPrefixToSystemKey(
  prefix: OccupationLedgerPrefix
): 'river' | 'road' | 'build' {
  if (prefix === 'road') return 'road';
  if (prefix === 'public') return 'build';
  return 'river';
}

/** 하천·도로 공통 칸 이름 (받은 원천자료 기준). 키는 관리번호(ftr_idn) — 새 건은 자동 채번 */
const COMMON_FIELDS: Omit<OccupationLedgerFieldMap, 'childAddressField' | 'childAddressPartFields'> = {
  keyField: 'ftr_idn',
  mgmtField: 'ftr_idn',
  permitField: 'prmt_no',
  permitDateField: 'prmt_ymd',
  nameField: 'occ_nam',
  placeField: 'occ_loc',
  purposeField: 'occ_purp',
  startField: 'prmt_sta',
  endField: 'prmt_end',
  areaField: 'occ_area',
  ownerNameField: 'prmt_nam',
  ownerAddrField: 'prmt_addr',
  stateField: 'state',
  remarkField: 'descript',
  childParentField: 'ftr_idn',
};

/** 국공유지 — 기존 공통 점용 테이블 칸 이름 그대로 */
const LEGACY_FIELDS: OccupationLedgerFieldMap = {
  keyField: 'ogc_fid',
  permitField: 'permit_no',
  permitDateField: 'permit_date',
  nameField: 'work_name',
  placeField: 'occup_place',
  purposeField: 'occup_purpose',
  startField: 'perm_start_date',
  endField: 'perm_end_date',
  areaField: 'perm_area',
  ownerNameField: 'occup_name',
  ownerAddrField: 'applicant_addr',
  stateField: 'state',
  remarkField: 'remark',
  childParentField: 'id',
  childAddressField: 'occup_place',
};

const BINDINGS_BY_SER_ENG: Record<OccupationLedgerSerEng, OccupationLedgerBinding> = {
  waterOccupationLedger: {
    schema: 'layer',
    mainTable: 'usage_data_as',
    jijukTable: 'usage_data_solo_as',
    mgjTable: 'usage_data_as_mgj',
    fields: { ...COMMON_FIELDS, childAddressField: 'usage_loc' },
    editPresetKey: 'waterOccupationLedger',
    title: '하천점용',
    serEng: 'waterOccupationLedger',
    fileLayer: 'usage_data_as',
    autoCodeField: 'ftr_idn',
    autoCodeDefault: 'JY_000001',
  },
  roadOccupationLedger: {
    schema: 'layer',
    mainTable: 'rdl_occ_as',
    jijukTable: 'rdl_occ_solo_as',
    mgjTable: 'rdl_occ_as_mgj',
    fields: {
      ...COMMON_FIELDS,
      childAddressField: 'occ_loc',
      childAddressPartFields: ['occ_emd', 'occ_ri', 'occ_jibun'],
    },
    editPresetKey: 'roadOccupationLedger',
    title: '도로점용',
    serEng: 'roadOccupationLedger',
    fileLayer: 'rdl_occ_as',
    autoCodeField: 'ftr_idn',
    autoCodeDefault: 'DR_000001',
  },
  publicOccupationLedger: {
    schema: 'layer',
    mainTable: 'public_occupationledger',
    jijukTable: 'public_occupationledger_jijuk',
    mgjTable: 'public_occupationledger_mgj',
    fields: LEGACY_FIELDS,
    editPresetKey: 'publicOccupationLedger',
    title: '국공유지',
    serEng: 'publicOccupationLedger',
    fileLayer: 'public_occupationledger',
  },
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
  prefix?: string | null;
}): OccupationLedgerBinding | null {
  const eng = String(params.serEng ?? '').trim();
  if (isOccupationLedgerSerEng(eng)) return BINDINGS_BY_SER_ENG[eng];

  const prefixRaw = String(params.prefix ?? '').trim().toLowerCase();
  if (isOccupationLedgerPrefix(prefixRaw)) {
    if (prefixRaw === 'road') return BINDINGS_BY_SER_ENG.roadOccupationLedger;
    if (prefixRaw === 'public') return BINDINGS_BY_SER_ENG.publicOccupationLedger;
    return BINDINGS_BY_SER_ENG.waterOccupationLedger;
  }

  const system = String(params.system ?? '').trim().toLowerCase();
  if (system === 'river') return BINDINGS_BY_SER_ENG.waterOccupationLedger;
  if (system === 'road') return BINDINGS_BY_SER_ENG.roadOccupationLedger;
  if (system === 'build') return BINDINGS_BY_SER_ENG.publicOccupationLedger;
  return null;
}

/** 본표·필지·물건지 테이블 이름 → 바인딩 */
export function getOccupationLedgerBindingByTable(
  tableName: string | null | undefined
): { binding: OccupationLedgerBinding; role: 'main' | 'jijuk' | 'mgj' } | null {
  const t = String(tableName ?? '').trim().toLowerCase();
  if (!t) return null;
  for (const b of Object.values(BINDINGS_BY_SER_ENG)) {
    if (b.mainTable === t) return { binding: b, role: 'main' };
    if (b.jijukTable === t) return { binding: b, role: 'jijuk' };
    if (b.mgjTable === t) return { binding: b, role: 'mgj' };
  }
  return null;
}

/**
 * 이 시스템에서 열어 둘 점용대장.
 * 메뉴 목록이 있으면 그 안의 점용대장만 (건설에 도로점용·국공유지점용이 같이 있는 경우).
 * 목록이 없으면 시스템 1개 기본값.
 */
export function getAllowedOccupationLedgerSerEngs(
  system?: string | null,
  serviceList?: readonly string[] | null
): OccupationLedgerSerEng[] {
  if (serviceList != null) {
    return serviceList
      .map((s) => String(s ?? '').trim())
      .filter(isOccupationLedgerSerEng);
  }
  const one = getOccupationLedgerBinding({ system })?.serEng;
  return one ? [one] : [];
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

/** 공통 점용대장 본표·필지·물건지 테이블 여부 */
export function isOccupationLedgerTableName(tableName: string): boolean {
  return getOccupationLedgerBindingByTable(tableName) != null;
}

/** 공통 점용대장 본표 여부 */
export function isOccupationLedgerMainTableName(tableName: string): boolean {
  return getOccupationLedgerBindingByTable(tableName)?.role === 'main';
}

/** system(river|road|build) → 테이블 접두 */
export function getOccupationLedgerPrefixForSystem(
  system: string | null | undefined
): OccupationLedgerPrefix | null {
  const s = String(system ?? '').trim().toLowerCase();
  if (s === 'river') return 'water';
  if (s === 'road') return 'road';
  if (s === 'build') return 'public';
  return null;
}

/**
 * 데이터 조회 등 — 점용대장 테이블은 현재 시스템 대장만 허용.
 * 점용대장이 아닌 테이블은 항상 true.
 */
export function isOccupationLedgerTableAllowedForSystem(
  tableName: string,
  system: string | null | undefined,
  serviceList?: readonly string[] | null
): boolean {
  const hit = getOccupationLedgerBindingByTable(tableName);
  if (!hit) return true;
  return getAllowedOccupationLedgerSerEngs(system, serviceList).includes(hit.binding.serEng);
}

/** 현재 시스템에 속하지 않는 점용대장 WMS 테이블 id 목록 */
export function getForeignOccupationLedgerTableIds(
  system: string | null | undefined,
  serviceList?: readonly string[] | null
): string[] {
  const allowed = new Set(getAllowedOccupationLedgerSerEngs(system, serviceList));
  const ids: string[] = [];
  for (const eng of OCCUPATION_LEDGER_SER_ENGS) {
    if (allowed.has(eng)) continue;
    ids.push(...getOccupationLedgerWmsLayerIds(BINDINGS_BY_SER_ENG[eng]));
  }
  return ids;
}

/** 시스템 전환 시 opened·dataTable 에서 다른 시스템 점용대장 토큰 제거 */
export function scrubOccupationLedgerFromMapSearchParams(
  params: URLSearchParams,
  system: string | null | undefined,
  serviceList?: readonly string[] | null
): void {
  const allowedSerEng = new Set(getAllowedOccupationLedgerSerEngs(system, serviceList));
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean);
  const nextOpened = opened.filter((token) => {
    const t = String(token ?? '').trim();
    if (!isOccupationLedgerSerEng(t)) return true;
    return allowedSerEng.has(t);
  });
  if (nextOpened.length > 0) params.set('opened', nextOpened.join(','));
  else params.delete('opened');

  const dataTable = String(params.get('dataTable') ?? '').trim();
  if (dataTable && !isOccupationLedgerTableAllowedForSystem(dataTable, system, serviceList)) {
    params.delete('dataTable');
    params.delete('dataKey');
  }
}
