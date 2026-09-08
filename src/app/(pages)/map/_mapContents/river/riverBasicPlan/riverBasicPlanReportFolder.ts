import { assertSafeFileDataSegment } from '@/lib/serviceFileData';

/** detail 행에서 보고서 file_data 폴더명: {river_type}_{river_code}_{plan_year}_{plan_len} */
export function buildRiverBasicPlanReportFolderKey(
  detail: Record<string, unknown> | null | undefined
): string | null {
  if (!detail) return null;
  const riverType = String(detail.river_type ?? '').trim();
  const riverCode = String(detail.river_code ?? '').trim();
  const planYear = String(detail.plan_year ?? '').trim();
  const planLen = String(detail.plan_len ?? '').trim();
  if (!riverType || !riverCode || !planYear || !planLen) return null;
  const key = `${riverType}_${riverCode}_${planYear}_${planLen}`;
  return assertSafeFileDataSegment(key);
}

/** GGNR_DATA_DIR 기준 상대 경로 (표시·디버그용) */
export function riverBasicPlanReportRelativeDir(
  layerSegment: string,
  folderKey: string
): string {
  return `file_data/${layerSegment}/${folderKey}`;
}
