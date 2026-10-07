/**
 * 공사대장 종류 — 메뉴(ser_eng)에 따라 같은 화면이 다른 레이어를 읽고 쓴다.
 * 서버(consDataAsService)·클라이언트(공사대장 패널) 공용.
 */
import { SER_FILE_ENG, type SerFileEng } from './serviceFileDataSerEng';

export type ConsLedgerKind = 'river' | 'wtl' | 'swl';

export type ConsLedgerVariant = {
  kind: ConsLedgerKind;
  /** serviceList.config ser_eng (첨부 API serEng 겸용) */
  serEng: SerFileEng;
  /** URL `opened` 토큰 (mapServiceOpened 와 일치) */
  openedKey: string;
  title: string;
  mainTable: string;
  soloTable: string;
  /** 필지 주소 컬럼 후보 — 앞에서부터 있는 컬럼 사용 */
  soloAddressFields: readonly string[];
  /** 테이블이 비었을 때 첫 공사코드 */
  defaultConsCode: string;
};

export const CONS_LEDGER_VARIANTS: Record<ConsLedgerKind, ConsLedgerVariant> = {
  river: {
    kind: 'river',
    serEng: SER_FILE_ENG.riverConstructionLedger,
    openedKey: 'riverConstructionLedger',
    title: '공사대장',
    mainTable: 'cons_data_as',
    soloTable: 'cons_data_solo_as',
    soloAddressFields: ['address', 'rd_addr'],
    defaultConsCode: 'GS_000001',
  },
  wtl: {
    kind: 'wtl',
    serEng: SER_FILE_ENG.waterworksLedger,
    openedKey: 'constructionLedger',
    title: '상수도 공사대장',
    mainTable: 'wtl_cons_as',
    soloTable: 'wtl_cons_solo_as',
    soloAddressFields: ['rd_addr', 'address'],
    defaultConsCode: 'WTL_000001',
  },
  swl: {
    kind: 'swl',
    serEng: SER_FILE_ENG.sewerConstructionLedger,
    openedKey: 'sewerConstructionLedger',
    title: '하수도 공사대장',
    mainTable: 'swl_cons_as',
    soloTable: 'swl_cons_solo_as',
    soloAddressFields: ['rd_addr', 'address'],
    defaultConsCode: 'SWL_000001',
  },
};

export const CONS_LEDGER_KINDS: readonly ConsLedgerKind[] = ['river', 'wtl', 'swl'];

export function resolveConsLedgerKind(raw: unknown): ConsLedgerKind {
  const s = String(raw ?? '').trim();
  return s === 'wtl' || s === 'swl' ? s : 'river';
}

export function getConsLedgerVariant(kind: unknown): ConsLedgerVariant {
  return CONS_LEDGER_VARIANTS[resolveConsLedgerKind(kind)];
}

/** URL opened 토큰 중 공사대장 메뉴 — 사이드바는 한 번에 하나만 연다 */
export function consLedgerKindFromOpened(openedTokens: readonly string[]): ConsLedgerKind | null {
  for (const kind of CONS_LEDGER_KINDS) {
    if (openedTokens.includes(CONS_LEDGER_VARIANTS[kind].openedKey)) return kind;
  }
  return null;
}
