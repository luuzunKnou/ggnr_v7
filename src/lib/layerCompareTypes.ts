/** 기준 레이어 ↔ 첨부 파일 비교 — 클라이언트·서비스 공용 타입 */

export type CompareGeomKind = 'POINT' | 'LINE' | 'POLYGON' | 'NONE';

export type CompareColumn = {
  name: string;
  dataType: string;
  korName: string;
};

export type CompareSourceMeta = {
  schema: string;
  table: string;
  label: string;
  rowCount: number;
  geomKind: CompareGeomKind;
  srid: number | null;
  geomColumn: string | null;
  columns: CompareColumn[];
  isTemp: boolean;
};

/** 컬럼 매칭: same=영문동일, candidate=한글동일, baseOnly, fileOnly, typeMismatch */
export type ColumnMatchKind = 'same' | 'candidate' | 'baseOnly' | 'fileOnly' | 'typeMismatch';

export type ColumnMatchRow = {
  id: string;
  kind: ColumnMatchKind;
  baseName: string | null;
  fileName: string | null;
  baseKor: string;
  fileKor: string;
  baseType: string;
  fileType: string;
  /** 후보·타입불일치만: 확정 시에만 값 비교에 사용 */
  included?: boolean;
};

export type PairMethod = 'key' | 'spatial';

export type StructureCompareResult = {
  success: boolean;
  error?: string;
  base: CompareSourceMeta;
  file: CompareSourceMeta;
  sessionId: string;
  countSame: boolean;
  geomSame: boolean;
  sridSame: boolean;
  columns: ColumnMatchRow[];
};

/** value=값다름, baseOnly=식별키 기준만, fileOnly=식별키 파일만, colBaseOnly=컬럼 기준만, colFileOnly=컬럼 파일만 */
export type ValueDiffKind =
  | 'value'
  | 'baseOnly'
  | 'fileOnly'
  | 'colBaseOnly'
  | 'colFileOnly';

export type ValueDiffRow = {
  kind: ValueDiffKind;
  displayId: string;
  column: string;
  columnLabel: string;
  baseValue: string;
  fileValue: string;
};

export type ValueCompareResult = {
  success: boolean;
  error?: string;
  matched: number;
  baseOnly: number;
  fileOnly: number;
  /** 값이 다른 짝(식별) 수 */
  valueDiffCount: number;
  /** 탭별 목록(값다름·컬럼·식별) */
  valueDiffs: ValueDiffRow[];
  columnDiffs: ValueDiffRow[];
  idDiffs: ValueDiffRow[];
  /** 합본 */
  diffs: ValueDiffRow[];
  /** 값다름 항목 전체 수 */
  valueDiffItemTotal: number;
  columnDiffTotal: number;
  idDiffTotal: number;
  /** 전체 차이 행 수 */
  diffTotal: number;
  /** 탭당 상한(크게 두면 사실상 전체) */
  diffLimit: number;
  pairNote: string;
};
