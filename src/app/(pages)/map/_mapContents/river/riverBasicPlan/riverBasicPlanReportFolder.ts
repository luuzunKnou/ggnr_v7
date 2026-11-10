import { assertSafeFileDataSegment } from '@/lib/serviceFileData';
import type { RiverBasicPlanTab } from '@/lib/riverBasicPlanMapAttachmentLayers';

/**
 * rivp_name 에서 폴더에 쓸 접미사 — 마지막 `_` 뒤 값(`부구천_2차` → `2차`, `남대천_울진읍` → `울진읍`).
 * `_` 가 없으면 빈 문자열. 서버 rivpFolderSuffixSql 과 같은 규칙.
 */
export function extractRiverBasicPlanRivpFolderSuffix(
  rivpName: string | null | undefined
): string {
  const raw = String(rivpName ?? '').trim();
  const m = raw.match(/_([^_]+)$/);
  return m?.[1] ? m[1] : '';
}

/** 기본계획 보고서 1단: {plan_year}_{plan_name} 또는 …_{rivp_name 의 `_` 뒤 값} */
export function buildRiverBasicPlanReportPlanFolderKey(
  detail: Record<string, unknown> | null | undefined
): string | null {
  if (!detail) return null;
  const planYear = String(detail.plan_year ?? '').trim();
  const planName = String(detail.plan_name ?? '').trim();
  if (!planYear || !planName) return null;
  const suffix = extractRiverBasicPlanRivpFolderSuffix(
    String(detail.rivp_name ?? '')
  );
  const raw = suffix ? `${planYear}_${planName}_${suffix}` : `${planYear}_${planName}`;
  return assertSafeFileDataSegment(raw);
}

/** 필드만으로 1단 폴더 키 (목록·쿼리와 동일) */
export function buildRiverBasicPlanReportPlanFolderKeyFromParts(opts: {
  planYear: string;
  planName: string;
  rivpName?: string | null;
  rivpSuffix?: string | null;
}): string | null {
  const planYear = String(opts.planYear ?? '').trim();
  const planName = String(opts.planName ?? '').trim();
  if (!planYear || !planName) return null;
  const suffix =
    opts.rivpSuffix !== undefined && opts.rivpSuffix !== null
      ? String(opts.rivpSuffix).trim()
      : extractRiverBasicPlanRivpFolderSuffix(opts.rivpName);
  const raw = suffix ? `${planYear}_${planName}_${suffix}` : `${planYear}_${planName}`;
  return assertSafeFileDataSegment(raw);
}

/** plan_len → 폴더용 (20860.0000 → 20860). 기존 디스크 키와 맞춤 */
function normalizePlanLenForFolder(raw: unknown): string {
  const t = String(raw ?? '').trim().replace(/,/g, '');
  if (!t) return '';
  const n = Number(t);
  if (Number.isFinite(n)) return String(n);
  return t;
}

/**
 * 하천 2단 폴더 — 구 첨부 키 재사용: {river_type}_{river_code}_{plan_year}_{plan_len}
 * 예: MB_001_2013_20860
 * 1·2차는 1단(계획) 폴더에만 두고, 하위는 기존 폴더명을 그대로 쓴다.
 */
export function buildRiverBasicPlanReportRiverSubfolderKey(
  detail: Record<string, unknown> | null | undefined
): string | null {
  if (!detail) return null;
  const riverType = String(detail.river_type ?? '').trim();
  const riverCode = String(detail.river_code ?? '').trim();
  const planYear = String(detail.plan_year ?? '').trim();
  const planLen = normalizePlanLenForFolder(detail.plan_len);
  if (!riverType || !riverCode || !planYear || !planLen) return null;
  return assertSafeFileDataSegment(`${riverType}_${riverCode}_${planYear}_${planLen}`);
}

export type RiverBasicPlanReportPath = {
  /** file_data/{AS}/ 아래 1단 */
  planFolderKey: string;
  /**
   * 2단 하천 폴더.
   * 지방: 항상 사용. 소하천: 해당 하위 폴더가 있을 때만(없으면 null → 계획 폴더 직속).
   */
  riverSubfolder: string | null;
};

/**
 * 상세 행·탭으로 보고서 경로 조각 생성.
 * 소하천의 «하위 폴더 존재 여부»는 호출측에서 folders API로 확정한다.
 */
export function buildRiverBasicPlanReportPathParts(
  detail: Record<string, unknown> | null | undefined,
  tab: RiverBasicPlanTab
): RiverBasicPlanReportPath | null {
  const planFolderKey = buildRiverBasicPlanReportPlanFolderKey(detail);
  if (!planFolderKey) return null;
  const riverSub = buildRiverBasicPlanReportRiverSubfolderKey(detail);
  if (tab === 'river') {
    return { planFolderKey, riverSubfolder: riverSub };
  }
  /** 소하천: 기본은 계획 폴더 직속. 하위가 있으면 호출측이 riverSubfolder를 켠다 */
  return { planFolderKey, riverSubfolder: null };
}

/** GGNR_DATA_DIR 기준 상대 경로 (표시·디버그용) */
export function riverBasicPlanReportRelativeDir(
  layerSegment: string,
  planFolderKey: string,
  riverSubfolder?: string | null
): string {
  const sub = String(riverSubfolder ?? '').trim();
  if (sub) return `file_data/${layerSegment}/${planFolderKey}/${sub}`;
  return `file_data/${layerSegment}/${planFolderKey}`;
}

/**
 * @deprecated 구 키 — 신규는 plan+river 경로 사용
 */
export function buildRiverBasicPlanReportFolderKey(
  detail: Record<string, unknown> | null | undefined
): string | null {
  return buildRiverBasicPlanReportPlanFolderKey(detail);
}
