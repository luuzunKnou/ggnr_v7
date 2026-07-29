/** 촬영요청 UI 목업용 타입·샘플 (백엔드·DB 없음) */

export type ShootType = 'birdsEye' | 'video' | 'aerialPhoto' | 'aerialOverlay';

export const SHOOT_TYPE_LABEL: Record<ShootType, string> = {
  birdsEye: '조감도',
  video: '영상',
  aerialPhoto: '항공사진',
  aerialOverlay: '항공사진+중첩',
};

/** 접수·승인·등록·반려 (등록중은 승인 후 내부 단계 — 화면 표시는 «승인»과 동일) */
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'registering'
  | 'registered'
  | 'rejected';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '대기',
  approved: '승인',
  /** 승인 후 자료 등록 진행 — 목록·배지에서는 승인과 동일하게 표기 */
  registering: '승인',
  registered: '등록완료',
  rejected: '반려',
};

/** 자료 등록 가능(승인 계열) */
export function canStartMediaRegister(status: RequestStatus): boolean {
  return status === 'approved' || status === 'registering' || status === 'registered';
}

/** 승인관리 «승인» 필터에 포함 */
export function isApprovedFamily(status: RequestStatus): boolean {
  return status === 'approved' || status === 'registering' || status === 'registered';
}

export type ShootingRequestDraft = {
  id: string;
  department: string;
  applicantRankName: string;
  phone: string;
  manager: string;
  purpose: string;
  address: string;
  hasScope: boolean;
  scopeLabel: string;
  /** 새 지도 팝업에서 그린 촬영 범위 (EPSG:5181 POLYGON WKT) */
  scopeWkt?: string;
  shootDate: string;
  useDate: string;
  shootType: ShootType;
  detailRequest: string;
  submittedAt: string;
  status: RequestStatus;
  /** 반려 사유 (반려일 때 — 신청자도 조회) */
  rejectReason?: string;
  /** 승인·반려 처리일 */
  decidedAt?: string;
  /** 영상관리 작업단위 연결 표시용 (목업) */
  linkedWorkUnitLabel?: string;
  /** 자료 등록 시작·완료일 (목업) */
  registeredAt?: string;
};

export const MOCK_MY_REQUESTS: ShootingRequestDraft[] = [
  {
    id: 'req-1',
    department: '도시계획과',
    applicantRankName: '주무관 김민수',
    phone: '052-123-4567',
    manager: '과장 이영희',
    purpose: '현장 확인',
    address: '방어동',
    hasScope: true,
    scopeLabel: '다각형 범위 지정됨',
    shootDate: '2025-12-08',
    useDate: '2025-12-09',
    shootType: 'aerialOverlay',
    detailRequest: '건물 옥상 포함 촬영 요청',
    submittedAt: '2025-12-01',
    status: 'pending',
  },
  {
    id: 'req-2',
    department: '건설과',
    applicantRankName: '주무관 박지훈',
    phone: '052-234-5678',
    manager: '팀장 최수진',
    purpose: '시설 점검',
    address: '일산동',
    hasScope: true,
    scopeLabel: '사각형 범위 지정됨',
    shootDate: '2025-12-02',
    useDate: '2025-12-03',
    shootType: 'video',
    detailRequest: '',
    submittedAt: '2025-11-28',
    status: 'approved',
    decidedAt: '2025-11-29',
  },
  {
    id: 'req-3',
    department: '재난안전과',
    applicantRankName: '주무관 한소희',
    phone: '052-345-6789',
    manager: '과장 정우진',
    purpose: '피해 현황 파악',
    address: '강동동 해안',
    hasScope: true,
    scopeLabel: '다각형 범위 지정됨',
    shootDate: '2025-11-20',
    useDate: '2025-11-21',
    shootType: 'birdsEye',
    detailRequest: '해안 일대 조감',
    submittedAt: '2025-11-15',
    status: 'rejected',
    rejectReason: '비행금지구역 인근 · 일정 재협의 필요',
    decidedAt: '2025-11-16',
  },
  {
    id: 'req-4',
    department: '환경녹지과',
    applicantRankName: '주무관 오세린',
    phone: '052-456-7890',
    manager: '팀장 김도현',
    purpose: '공원 조성 현황',
    address: '효문동',
    hasScope: true,
    scopeLabel: '사각형 범위 지정됨',
    shootDate: '2025-12-15',
    useDate: '2025-12-16',
    shootType: 'aerialPhoto',
    detailRequest: '식생 포함',
    submittedAt: '2025-12-05',
    status: 'pending',
  },
];

export function emptyDraft(): Omit<ShootingRequestDraft, 'id' | 'submittedAt' | 'status' | 'rejectReason' | 'decidedAt'> {
  return {
    department: '',
    applicantRankName: '',
    phone: '',
    manager: '',
    purpose: '',
    address: '',
    hasScope: false,
    scopeLabel: '',
    scopeWkt: '',
    shootDate: '',
    useDate: '',
    shootType: 'aerialOverlay',
    detailRequest: '',
  };
}
