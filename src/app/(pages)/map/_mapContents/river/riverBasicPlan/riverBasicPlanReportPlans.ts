import { formatFiniteNumberKoTrimZeros } from "@/lib/formatDetailScalar";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import { serviceFileDataDownloadUrl } from "../../../_mapComponents/standard/useServiceFileData";
import type { ServiceFilePdfPreviewItem } from "../../../_mapComponents/standard/ServiceFilePdfPreview";
import { buildRiverBasicPlanReportPlanFolderKeyFromParts } from "./riverBasicPlanReportFolder";

/** 보고서(기본계획 묶음)에 속한 하천 */
export type RiverBasicPlanReportRiver = {
  riverName: string;
  planLen: string;
  riverType: string;
  riverCode: string;
};

/** 보고서별 목록 한 건 — 연도 + 계획명 + 차수 */
export type RiverBasicPlanReportPlan = {
  planYear: string;
  planName: string;
  rivpSuffix: string;
  riverCount: number;
  rivers?: RiverBasicPlanReportRiver[];
  totalPlanLen?: number | null;
  /** 검색어가 하천명에 걸린 하천 */
  matchedRivers?: { riverName: string }[];
};

/** 계획 폴더별 보고서 구성 — 서버 폴더 요약 */
export type RiverBasicPlanReportFolderSummary = Record<
  string,
  { rootPdfs: string[]; riverFolders: string[]; riverPdfs?: Record<string, string[]> }
>;

export function riverBasicPlanPlanKey(p: Pick<RiverBasicPlanReportPlan, "planYear" | "planName" | "rivpSuffix">): string {
  return `${p.planYear}\0${p.planName}\0${p.rivpSuffix}`;
}

export function riverBasicPlanPlanFolderKey(p: RiverBasicPlanReportPlan): string | null {
  return buildRiverBasicPlanReportPlanFolderKeyFromParts({
    planYear: p.planYear,
    planName: p.planName,
    rivpSuffix: p.rivpSuffix,
  });
}

export function riverBasicPlanPlanTitle(p: Pick<RiverBasicPlanReportPlan, "planName" | "rivpSuffix">): string {
  return p.rivpSuffix ? `${p.planName}_${p.rivpSuffix}` : p.planName;
}

/** 보고서 하천 — 하천 목록 표시 순서(이름순). 카드를 누를 때 처음 여는 하천도 이 순서의 첫 번째 */
export function riverBasicPlanSortedRivers(p: RiverBasicPlanReportPlan): RiverBasicPlanReportRiver[] {
  return [...(p.rivers ?? [])].sort((a, b) => a.riverName.localeCompare(b.riverName, "ko"));
}

/** 카드 아래 펼칠 하천 — 하천명 검색에 걸린 하천이 있으면 그 하천만, 아니면(검색 없음·보고서명 검색) 전체 */
export function riverBasicPlanShownRivers(p: RiverBasicPlanReportPlan): RiverBasicPlanReportRiver[] {
  const sorted = riverBasicPlanSortedRivers(p);
  const matched = new Set((p.matchedRivers ?? []).map((m) => m.riverName));
  if (matched.size === 0) return sorted;
  const hit = sorted.filter((r) => matched.has(r.riverName));
  return hit.length > 0 ? hit : sorted;
}

export function riverBasicPlanYearLabel(year: string): string {
  return /^\d+$/.test(year) ? `${year}년` : year;
}

/**
 * 계획연장(plan_len) → km. 지방하천은 m(2,050~27,000), 일부·소하천은 km(0.5~10) 로 섞여 들어와
 * 100 이상이면 m 로 보고 km 로 바꾼다(지방·소하천 계획연장이 100km 를 넘는 경우는 없음).
 */
export function planLenKm(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n >= 100 ? n / 1000 : n;
}

function formatKm(km: number): string {
  return `${formatFiniteNumberKoTrimZeros(Number(km.toFixed(3)))}km`;
}

export function formatRiverBasicPlanKm(raw: string | number | null | undefined): string | null {
  const km = planLenKm(raw);
  return km == null ? null : formatKm(km);
}

/** 합계연장 — 하천이 여러 곳이면 하천별 연장(km 로 맞춘 뒤) 합, 한 곳이면 그 하천 연장 */
export function riverBasicPlanPlanLengthLabel(p: RiverBasicPlanReportPlan): string | null {
  const rivers = p.rivers ?? [];
  if (rivers.length === 0) return formatRiverBasicPlanKm(p.totalPlanLen ?? null);
  let sum: number | null = null;
  for (const r of rivers) {
    const km = planLenKm(r.planLen);
    if (km != null) sum = (sum ?? 0) + km;
  }
  return sum == null ? null : formatKm(sum);
}

/** 하천 하위 폴더 이름은 {하천구분}_{하천코드}_{연도}_{연장} */
function isRiverFolder(r: RiverBasicPlanReportRiver, folder: string): boolean {
  return Boolean(r.riverType && r.riverCode && folder.startsWith(`${r.riverType}_${r.riverCode}_`));
}

/** 하천 하위 폴더 → 하천명. 못 찾으면 폴더명 */
function riverLabelForFolder(p: RiverBasicPlanReportPlan, folder: string): string {
  return (p.rivers ?? []).find((r) => isRiverFolder(r, folder))?.riverName || folder;
}


/** 보고서 PDF — 계획 폴더 바로 아래(공통) 먼저, 이어서 하천별 폴더(하천명 · 파일명) */
export function riverBasicPlanReportPdfItems(
  p: RiverBasicPlanReportPlan,
  summary: RiverBasicPlanReportFolderSummary | null,
  layer: string
): ServiceFilePdfPreviewItem[] {
  const folderKey = riverBasicPlanPlanFolderKey(p);
  const folder = folderKey && summary ? summary[folderKey] : undefined;
  if (!folderKey || !folder) return [];
  const items: ServiceFilePdfPreviewItem[] = folder.rootPdfs.map((name) => ({
    url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, layer, folderKey, name),
    fileName: name,
  }));
  const riverPdfs = folder.riverPdfs ?? {};
  const subs = Object.keys(riverPdfs)
    .map((sub) => ({ sub, label: riverLabelForFolder(p, sub) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  for (const { sub, label } of subs) {
    for (const name of riverPdfs[sub] ?? []) {
      items.push({
        url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, layer, folderKey, name, { subfolder: sub }),
        fileName: `${label} · ${name}`,
      });
    }
  }
  return items;
}
