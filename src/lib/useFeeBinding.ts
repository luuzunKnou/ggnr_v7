/**
 * 점사용료 — ser_eng(water|road|publicNglFeeList) · system · rprs_txm_nm
 * → water|road|public_ngl_fee_list (공통 점용대장과 동일 접두 규칙)
 */

export const USE_FEE_SER_ENGS = [
  'waterNglFeeList',
  'roadNglFeeList',
  'publicNglFeeList',
] as const;

export type UseFeeSerEng = (typeof USE_FEE_SER_ENGS)[number];

export const USE_FEE_PREFIXES = ['water', 'road', 'public'] as const;
export type UseFeePrefix = (typeof USE_FEE_PREFIXES)[number];

export type UseFeeBinding = {
  schema: 'layer';
  /** water_ngl_fee_list | road_ngl_fee_list | public_ngl_fee_list */
  mainTable: string;
  prefix: UseFeePrefix;
  /** URL system= */
  systemKey: 'river' | 'road' | 'build';
  title: string;
  serEng: UseFeeSerEng;
};

const BINDINGS_BY_SER_ENG: Record<UseFeeSerEng, UseFeeBinding> = {
  waterNglFeeList: {
    schema: 'layer',
    mainTable: 'water_ngl_fee_list',
    prefix: 'water',
    systemKey: 'river',
    title: '하천점사용료',
    serEng: 'waterNglFeeList',
  },
  roadNglFeeList: {
    schema: 'layer',
    mainTable: 'road_ngl_fee_list',
    prefix: 'road',
    systemKey: 'road',
    title: '도로점사용료',
    serEng: 'roadNglFeeList',
  },
  publicNglFeeList: {
    schema: 'layer',
    mainTable: 'public_ngl_fee_list',
    prefix: 'public',
    systemKey: 'build',
    title: '국공유지점사용료',
    serEng: 'publicNglFeeList',
  },
};

/** ngl_query_table.rprs_txm_nm → 저장 접두 */
const RPRS_TXM_NM_TO_PREFIX: Record<string, UseFeePrefix> = {
  하천점사용료: 'water',
  소하천점사용료: 'water',
  도로점사용료: 'road',
  국공유지점사용료: 'public',
  공유지점사용료: 'public',
};

export function isUseFeePrefix(v: string): v is UseFeePrefix {
  return (USE_FEE_PREFIXES as readonly string[]).includes(v);
}

export function isUseFeeSerEng(serEng: string): serEng is UseFeeSerEng {
  return (USE_FEE_SER_ENGS as readonly string[]).includes(serEng);
}

/** opened 토큰이 점사용료인지 (레거시 useFee 포함) */
export function isUseFeeOpenedToken(token: string): boolean {
  const t = String(token ?? '').trim();
  if (t === 'useFee') return true;
  return isUseFeeSerEng(t);
}

/** opened 목록에서 현재 열린 점사용료 ser_eng */
export function findOpenedUseFeeSerEng(openedTokens: string[]): UseFeeSerEng | null {
  for (const raw of openedTokens) {
    const t = String(raw ?? '').trim();
    if (t === 'useFee') return 'waterNglFeeList';
    if (isUseFeeSerEng(t)) return t;
  }
  return null;
}

/**
 * ser_eng 우선. 없으면 system(river/road/build)·prefix 로 추정.
 */
export function getUseFeeBinding(params: {
  serEng?: string | null;
  system?: string | null;
  prefix?: string | null;
}): UseFeeBinding {
  const eng = String(params.serEng ?? '').trim();
  if (eng === 'useFee') return BINDINGS_BY_SER_ENG.waterNglFeeList;
  if (isUseFeeSerEng(eng)) return BINDINGS_BY_SER_ENG[eng];

  const prefixRaw = String(params.prefix ?? '')
    .trim()
    .toLowerCase();
  if (isUseFeePrefix(prefixRaw)) {
    if (prefixRaw === 'road') return BINDINGS_BY_SER_ENG.roadNglFeeList;
    if (prefixRaw === 'public') return BINDINGS_BY_SER_ENG.publicNglFeeList;
    return BINDINGS_BY_SER_ENG.waterNglFeeList;
  }

  const system = String(params.system ?? '')
    .trim()
    .toLowerCase();
  if (system === 'road') return BINDINGS_BY_SER_ENG.roadNglFeeList;
  if (system === 'build') return BINDINGS_BY_SER_ENG.publicNglFeeList;
  return BINDINGS_BY_SER_ENG.waterNglFeeList;
}

/** WMS/본표 레이어 id. string만 주면 system 키로 취급(레거시). */
export function getUseFeeWmsLayerId(
  params?: string | null | { serEng?: string | null; system?: string | null }
): string {
  if (typeof params === 'string' || params == null) {
    return getUseFeeBinding({ system: params }).mainTable;
  }
  return getUseFeeBinding(params).mainTable;
}

/** @deprecated getUseFeeWmsLayerId({ system }) 사용 */
export function getUseFeeWmsLayerIdBySystem(system?: string | null): string {
  return getUseFeeWmsLayerId({ system });
}

export function getAllUseFeeWmsLayerIds(): string[] {
  return USE_FEE_SER_ENGS.map((s) => BINDINGS_BY_SER_ENG[s].mainTable);
}

export function getUseFeePrefixForRprsTxmNm(rprsTxmNm: string | null | undefined): UseFeePrefix | null {
  const nm = String(rprsTxmNm ?? '').trim();
  if (!nm) return null;
  return RPRS_TXM_NM_TO_PREFIX[nm] ?? null;
}

export function useFeePrefixToSystemKey(prefix: UseFeePrefix): 'river' | 'road' | 'build' {
  if (prefix === 'road') return 'road';
  if (prefix === 'public') return 'build';
  return 'river';
}

export function isUseFeePrefixAllowedBySystems(
  prefix: UseFeePrefix,
  enabledSystems: string[] | null
): boolean {
  if (enabledSystems == null) return true;
  if (enabledSystems.length === 0) return true;
  const key = useFeePrefixToSystemKey(prefix);
  return enabledSystems.map((s) => s.trim().toLowerCase()).includes(key);
}

/** 현재 시스템에 속하지 않는 점사용료 WMS id */
export function getForeignUseFeeWmsLayerIds(system?: string | null): string[] {
  const allowed = getUseFeeBinding({ system }).mainTable.toLowerCase();
  return getAllUseFeeWmsLayerIds().filter((id) => id.toLowerCase() !== allowed);
}

/** 시스템 전환 시 opened 에서 다른 시스템 점사용료 토큰 제거 */
export function scrubUseFeeFromMapSearchParams(
  params: URLSearchParams,
  system: string | null | undefined
): void {
  const allowed = getUseFeeBinding({ system }).serEng;
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean);
  const nextOpened = opened.filter((token) => {
    if (!isUseFeeOpenedToken(token)) return true;
    const eng = token === 'useFee' ? 'waterNglFeeList' : token;
    return eng === allowed;
  });
  if (nextOpened.length > 0) params.set('opened', nextOpened.join(','));
  else params.delete('opened');
}
