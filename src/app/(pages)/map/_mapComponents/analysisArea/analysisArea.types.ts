/** 필지분석·변동이력 등 분석 영역 공용 타입 */

export type AnalysisAreaMethod = 'draw' | 'boundary';

/** 푸터 설정 기준 시·군구 */
export type AnalysisRegion = {
  sido: string;
  sigungu: string;
};

/** @deprecated AnalysisRegion 사용 — 필지 경로 호환 */
export type ParcelAnalysisRegion = AnalysisRegion;

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

/** 좌측 영역 요약 패널에 필요한 최소 필드 */
export type AnalysisAreaSummaryLike = {
  method: AnalysisAreaMethod;
  summaryLabel: string;
  summaryDetail?: string;
  targetLabel: string;
  areaSqm: number;
};

/** 지도 좌표(EPSG:3857) — 도형 bbox 상단 중앙 */
export type DrawToolbarMapAnchor = {
  topCenter: [number, number];
};

export type DrawToolbarScreenPlacement = {
  left: number;
  top: number;
};
