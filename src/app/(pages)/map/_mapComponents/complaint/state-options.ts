/**
 * 민원 검색필터 / 이력 추가·수정 에서 쓰는 상태 옵션 (점검, 처리중, 완료)
 * 검색필터·추가·수정 UI에서 이 배열을 공유합니다.
 */
export const COMPLAINT_STATE_OPTIONS = ['접수', '점검', '처리중', '완료'] as const;

export type ComplaintStateOption = (typeof COMPLAINT_STATE_OPTIONS)[number];

/** 상태별 스타일 (점검, 처리중, 완료만 사용) */
const stateStyleMap: Record<string, { bg: string; text: string; border: string }> = {
  접수: { bg: 'bg-blue-50/90', text: 'text-[#1D6AE3]', border: 'border-[#1D6AE3]/30' },
  점검: { bg: 'bg-emerald-50/90', text: 'text-emerald-600', border: 'border-emerald-100' },
  처리중: { bg: 'bg-orange-50/90', text: 'text-orange-600', border: 'border-orange-100' },
  완료: { bg: 'bg-green-50/90', text: 'text-green-600', border: 'border-green-100' },
};

const defaultStyle = { bg: 'bg-muted/80', text: 'text-muted-foreground', border: 'border-border' };

export function getStateStyle(state: string | null): { bg: string; text: string; border: string } {
  return state ? stateStyleMap[state] ?? defaultStyle : defaultStyle;
}

/*
 * 참고: 기존 stateStyleMap 전체 (색상 보관용, 필요 시 복원)
 * - 접수: { bg: 'bg-blue-50/90', text: 'text-[#1D6AE3]', border: 'border-[#1D6AE3]/30' },
 * - 점검: { bg: 'bg-emerald-50/90', text: 'text-emerald-600', border: 'border-emerald-100' },
 * - 보수: { bg: 'bg-amber-50/90', text: 'text-amber-600', border: 'border-amber-100' },
 * - 이상발생: { bg: 'bg-red-50/90', text: 'text-red-600', border: 'border-red-100' },
 * - 준공: { bg: 'bg-sky-50/90', text: 'text-sky-600', border: 'border-sky-100' },
 * - 처리중: { bg: 'bg-orange-50/90', text: 'text-orange-600', border: 'border-orange-100' },
 * - 완료: { bg: 'bg-green-50/90', text: 'text-green-600', border: 'border-green-100' },
 */
