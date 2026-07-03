export type ParcelAreaMethod = 'draw' | 'boundary';

export type ParcelAnalysisRegion = {
  sido: string;
  sigungu: string;
};

export type ParcelAnalysisArea = {
  method: ParcelAreaMethod;
  summaryLabel: string;
  /** 2건 이상일 때 읍·면·동·리 목록 */
  summaryDetail?: string;
  /** 대상 행 표시용 (면적 제외) */
  targetLabel: string;
  wkt: string;
  itemCount: number;
  /** 분석 영역 면적 (제곱미터, 정수) */
  areaSqm: number;
};

export type ParcelModalStep = 'choose' | 'draw' | 'boundary';

export type DrawTool = 'rectangle' | 'polygon' | 'circle';

/** 읍·면·동 선택 + 리 체크 상태 (모달 복원용) */
export type BoundaryEmdSelection = {
  emdCode: string;
  emdName: string;
  allRi: boolean;
  riCodes: string[];
  /** 리 일부 선택 시 표시명 (riCodes 순서와 대응) */
  riNames?: string[];
};

export type EmdRiOption = { code: string; name: string };

export function cloneBoundarySelection(selection: BoundaryEmdSelection[]): BoundaryEmdSelection[] {
  return selection.map((s) => ({
    emdCode: s.emdCode,
    emdName: s.emdName,
    allRi: s.allRi,
    riCodes: [...s.riCodes],
    riNames: s.riNames ? [...s.riNames] : undefined,
  }));
}
