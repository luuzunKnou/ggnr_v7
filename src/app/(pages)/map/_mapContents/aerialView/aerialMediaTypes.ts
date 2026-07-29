/** 영상(드론·사진동영상 등) 통합관리 — UI 목업용 타입 (백엔드·DB 연동 없음) */

export type AerialKind = 'ortho' | 'drone' | 'panorama' | 'satellite';

export type ConvertStatus = 'done' | 'converting' | 'pending' | 'registered';

/** 상태 배지 문구 — 정사(변환) vs 사진·동영상(업로드 종료) */
export type StatusBadgeMode = 'convert' | 'upload';

export type AttrRow = {
  label: string;
  value: string;
};

export type WorkFileItem = {
  id: string;
  name: string;
  sizeLabel: string;
  format: string;
  status: ConvertStatus;
  /** 드론·파노라마 미리보기용 */
  previewKind?: 'image' | 'video' | 'panorama';
  locationLabel?: string;
};

export type WorkUnitItem = {
  id: string;
  workDate: string;
  workName: string;
  folderName: string;
  kind: AerialKind;
  crsHint: string;
  /** 목록 상태 — 드론영상(정사)은 변환, 항공은 등록·변환 등 */
  status?: ConvertStatus;
  /** 업로드일 (YYYY-MM-DD) — 항공영상 카드 등 */
  uploadedAt?: string;
  /** 연결 촬영신청 id (목업 조인 키) */
  linkedRequestId?: string;
  /** 작업단위 속성정보 (기본·상세 구분 없음) */
  attrs: AttrRow[];
  files: WorkFileItem[];
};

export const AERIAL_KIND_LABEL: Record<AerialKind, string> = {
  ortho: '드론영상 관리',
  drone: '사진,동영상',
  panorama: '파노라마 영상',
  satellite: '항공영상 관리',
};

/** 드론영상(정사)·항공 타일 변환 */
export const CONVERT_STATUS_LABEL: Record<ConvertStatus, string> = {
  done: '변환완료',
  converting: '변환중',
  pending: '대기',
  registered: '등록',
};

/** 사진·동영상·파노라마 — 업로드하면 종료 */
export const UPLOAD_STATUS_LABEL: Record<ConvertStatus, string> = {
  done: '업로드완료',
  converting: '업로드중',
  pending: '대기',
  registered: '업로드완료',
};

export function statusLabel(status: ConvertStatus, mode: StatusBadgeMode = 'convert'): string {
  return mode === 'upload' ? UPLOAD_STATUS_LABEL[status] : CONVERT_STATUS_LABEL[status];
}

/**
 * 드론영상(정사) 작업단위 목록용 — 파일 상태 집계.
 * 변환중 > 대기 > 변환완료
 */
export function deriveOrthoUnitStatus(files: WorkFileItem[]): ConvertStatus {
  if (files.length === 0) return 'pending';
  if (files.some((f) => f.status === 'converting')) return 'converting';
  if (files.some((f) => f.status === 'pending')) return 'pending';
  if (files.every((f) => f.status === 'done' || f.status === 'registered')) return 'done';
  return 'pending';
}

/** 종류별 배지 모드 */
export function statusModeForKind(kind: AerialKind): StatusBadgeMode {
  return kind === 'ortho' || kind === 'satellite' ? 'convert' : 'upload';
}
