'use client';

import { cn } from '@/lib/utils';
import {
  normalizeParcelLandSource,
  PARCEL_LAND_LINKAGE_FAIL_LABEL,
  PARCEL_LAND_LINKAGE_FAIL_TITLE,
  parcelLandLinkageSourceCellClass,
  parcelLandLinkageSourceLabel,
  parcelLandLinkageSourceTitle,
  SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI,
  type ParcelLandRowSource,
} from '@/lib/parcelLandNormalize';

/** 우클릭 필지정보·필지분석 공통 — 연계 출처 텍스트(출처별 색) */
export function ParcelLandLinkageSourceText({
  source,
  className,
  prefix = '연계 ',
  failed = false,
}: {
  source?: ParcelLandRowSource;
  className?: string;
  /** false면 접두 «연계 » 생략 (표 셀 등) */
  prefix?: string | false;
  failed?: boolean;
}) {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI && !failed) return null;
  if (failed) {
    return (
      <span className={cn('text-[10px] font-medium text-amber-800', className)}>
        {prefix === false ? PARCEL_LAND_LINKAGE_FAIL_LABEL : `${prefix}${PARCEL_LAND_LINKAGE_FAIL_LABEL}`}
      </span>
    );
  }
  const label = parcelLandLinkageSourceLabel(source);
  if (!label) return <span className={cn('text-[10px] text-muted-foreground', className)}>-</span>;
  const text = prefix === false ? label : `${prefix}${label}`;
  return (
    <span className={cn('text-[10px] font-medium', parcelLandLinkageSourceCellClass(source), className)}>
      {text}
    </span>
  );
}

/** 우클릭 필지정보·필지분석 공통 — 연계 출처별 값 색상 */
export function ParcelLinkageValueText({
  value,
  source,
  className,
}: {
  value?: string | null;
  source?: ParcelLandRowSource;
  className?: string;
}) {
  const text = value?.trim() ? value : '-';
  const hasValue = text !== '-' && text !== PARCEL_LAND_LINKAGE_FAIL_LABEL;
  const srcClass = hasValue ? parcelLandLinkageSourceCellClass(source) : undefined;
  const isFail = text === PARCEL_LAND_LINKAGE_FAIL_LABEL;
  return (
    <span
      className={cn(isFail && 'font-medium text-amber-800', hasValue && srcClass, className)}
      title={hasValue ? parcelLandLinkageSourceTitle(source) : isFail ? PARCEL_LAND_LINKAGE_FAIL_TITLE : undefined}
    >
      {text}
      {isFail ? <ParcelLandLinkageFailReasonHidden reason={PARCEL_LAND_LINKAGE_FAIL_TITLE} /> : null}
    </span>
  );
}

/** 연계실패 상세원인 — 화면에는 안 보이고 개발자도구에서만 확인 */
export function ParcelLandLinkageFailReasonHidden({ reason }: { reason?: string | null }) {
  const text = reason?.trim();
  if (!text) return null;
  return (
    <span data-linkage-fail-reason={text} style={{ display: 'none' }}>
      {text}
    </span>
  );
}

/** 건축물대장·인허가·토지 화면 출처 — 우클릭·필지분석 공통 */
const DATA_SOURCE_LABEL: Record<string, string> = {
  seum: '세움터',
  portal: '공공데이터포털',
  arch: '공공데이터포털',
  housing: '공공데이터포털',
  kras: 'KRAS',
  koreps: 'KOREPS',
  vworld: 'V-WORLD',
};

const DATA_SOURCE_ORDER = ['세움터', '공공데이터포털', 'KRAS', 'KOREPS', 'V-WORLD'];

export function dataSourceLabel(source?: string | null): string | undefined {
  if (source == null || source === '') return undefined;
  const key = normalizeParcelLandSource(source);
  if (!key) return undefined;
  if (key === 'mixed') return undefined;
  return DATA_SOURCE_LABEL[key];
}

function dataSourceLabels(source?: string | null): string[] {
  if (source == null || source === '') return [];
  const key = normalizeParcelLandSource(source);
  if (key === 'mixed') return ['KRAS', 'KOREPS'];
  const one = dataSourceLabel(source);
  return one ? [one] : [];
}

export function buildingDataSourceLabel(source?: string | null): string | undefined {
  return dataSourceLabel(source);
}

/** 사용자 화면 출처 한 줄. 디버그 색 범례와 별개로 항상 표시 */
export function BuildingDataSourceLine({
  sources,
  className,
}: {
  sources: Array<string | null | undefined>;
  className?: string;
}) {
  const found = new Set(sources.flatMap((s) => dataSourceLabels(s)));
  const labels = DATA_SOURCE_ORDER.filter((label) => found.has(label));
  if (!labels.length) return null;
  return (
    <p className={cn('text-[11px] text-muted-foreground', className)}>
      출처: {labels.join(' · ')}
    </p>
  );
}

/** 건축인허가 출처 — 세움터·포털(건축/주택) */
export function buildingPermitLinkageSource(
  source?: 'seum' | 'arch' | 'housing' | null
): ParcelLandRowSource | undefined {
  if (source === 'seum') return 'seum';
  if (source === 'arch' || source === 'housing') return 'portal';
  return undefined;
}

/** 건축인허가 연계 출처 범례 */
export function BuildingPermitLinkageLegend({
  source,
}: {
  source?: 'seum' | 'arch' | 'housing' | null;
}) {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return null;
  if (!source) return null;
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      {source === 'seum' ? <span className="mr-2 font-medium text-violet-700">세움터</span> : null}
      {source === 'arch' || source === 'housing' ? (
        <span className="mr-2 font-medium text-sky-700">공공데이터포털</span>
      ) : null}
      <span className="mr-2">표 값 = 동일 출처 색</span>
      <span>- = 연계됐으나 값 없음</span>
    </p>
  );
}

/** 건축물대장 연계 출처 범례 */
export function BuildingLinkageLegend({ sources }: { sources: Array<ParcelLandRowSource | undefined> }) {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return null;
  const set = new Set(sources.map((s) => normalizeParcelLandSource(s)).filter(Boolean));
  if (!set.size) return null;
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      {set.has('seum') ? <span className="mr-2 font-medium text-violet-700">세움터</span> : null}
      {set.has('portal') ? <span className="mr-2 font-medium text-sky-700">공공데이터포털</span> : null}
      <span className="mr-2">대지위치·지번 = 비면 PNU(행정명·번지) 폴백 · 도로명 = 원천만(폴백 없음)</span>
      <span className="mr-2">명칭·면적·건폐율 등 = 동일 출처</span>
      <span>- = 연계됐으나 값 없음</span>
    </p>
  );
}

/** 토지현황·필지정보 연계 출처 범례 */
export function LandLinkageLegend({
  sources,
  showFail,
  showJijukHint = false,
}: {
  sources: Array<ParcelLandRowSource | undefined>;
  showFail?: boolean;
  /** 필지분석 토지현황 표 — 지적 고정열 안내 */
  showJijukHint?: boolean;
}) {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return null;
  const set = new Set(sources.map((s) => normalizeParcelLandSource(s)).filter(Boolean));
  if (!set.size && !showFail) return null;
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      {showJijukHint ? <span className="mr-2">주소·면적 = 지적 DB</span> : null}
      {set.has('kras') ? <span className="mr-2 font-medium text-blue-700">파랑·KRAS</span> : null}
      {set.has('koreps') ? <span className="mr-2 font-medium text-indigo-700">남색·KOREPS</span> : null}
      {set.has('vworld') ? <span className="mr-2 font-medium text-emerald-700">초록·V-WORLD</span> : null}
      {set.has('mixed') ? <span className="mr-2 font-medium text-foreground">혼합 연계</span> : null}
      <span className="mr-2">소유·지목·공시 = 동일 출처</span>
      <span className="mr-2">- = 연계됐으나 값 없음</span>
      {showFail ? <span className="font-medium text-amber-800">주황·연계실패</span> : null}
    </p>
  );
}

/** 우클릭 필지정보 — 단일 출처 범례 */
export function LandLinkageLegendText({
  source,
  showFail,
}: {
  source?: ParcelLandRowSource;
  showFail?: boolean;
}) {
  return <LandLinkageLegend sources={source ? [source] : []} showFail={showFail} />;
}
