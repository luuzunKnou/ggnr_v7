/** 국공유재산 사용허가 대장 — 프로토타입 목업 (경산 엑셀 표본) */

export const PUBLIC_PROPERTY_PERMIT_NEW_ID = '__new_public_property_permit__';

export function isNewPublicPropertyPermitId(id: string | null | undefined): boolean {
  return String(id ?? '') === PUBLIC_PROPERTY_PERMIT_NEW_ID;
}

export type PublicPropertyOwnership = '국유' | '공유';
export type PublicPropertyDurationKind = '일시' | '영구';

export type PublicPropertyParcel = {
  emd: string;
  ri: string;
  bun: string;
  ji: string;
  cadastralArea: string;
};

export type PublicPropertyFee = {
  chargeStart: string;
  chargeEnd: string;
  days: string;
  adjLand: string;
  adjJibun: string;
  officialPrice: string;
  prevYearFee: string;
  assessedAmount: string;
  changeRate: string;
  adjustFactor: string;
  totalCharge: string;
  useFee: string;
  vat: string;
  nationalShare: string;
  cityShare: string;
  noticeIssued: string;
};

export type PublicPropertyPermit = {
  id: string;
  permitNo: string;
  ownership: PublicPropertyOwnership;
  durationKind: PublicPropertyDurationKind;
  purpose: string;
  useArea: string;
  rate: string;
  firstPermitYmd: string;
  periodStart: string;
  periodEnd: string;
  renewStart: string;
  renewEnd: string;
  userName: string;
  userPhone: string;
  userAddr: string;
  remark: string;
  parcel: PublicPropertyParcel;
  fee: PublicPropertyFee;
  /** 지도 강조용 WGS84 */
  lon: number;
  lat: number;
};

export function formatParcelAddress(p: PublicPropertyParcel): string {
  const parts = [p.emd, p.ri, p.bun && p.ji ? `${p.bun}-${p.ji}` : p.bun || p.ji]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
  return parts.join(' ') || '—';
}

export function derivePermitStatus(endYmd: string, now = new Date()): '진행중' | '종료' {
  const s = String(endYmd ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '진행중';
  const end = new Date(`${s}T23:59:59`);
  if (Number.isNaN(end.getTime())) return '진행중';
  return end.getTime() < now.getTime() ? '종료' : '진행중';
}

export function emptyParcel(): PublicPropertyParcel {
  return { emd: '', ri: '', bun: '', ji: '', cadastralArea: '' };
}

export function emptyFee(): PublicPropertyFee {
  return {
    chargeStart: '',
    chargeEnd: '',
    days: '',
    adjLand: '',
    adjJibun: '',
    officialPrice: '',
    prevYearFee: '',
    assessedAmount: '',
    changeRate: '',
    adjustFactor: '',
    totalCharge: '',
    useFee: '',
    vat: '',
    nationalShare: '',
    cityShare: '',
    noticeIssued: '',
  };
}

export function createEmptyPublicPropertyPermit(): PublicPropertyPermit {
  return {
    id: PUBLIC_PROPERTY_PERMIT_NEW_ID,
    permitNo: '',
    ownership: '국유',
    durationKind: '영구',
    purpose: '',
    useArea: '',
    rate: '',
    firstPermitYmd: '',
    periodStart: '',
    periodEnd: '',
    renewStart: '',
    renewEnd: '',
    userName: '',
    userPhone: '',
    userAddr: '',
    remark: '',
    parcel: emptyParcel(),
    fee: emptyFee(),
    lon: 128.74,
    lat: 35.82,
  };
}

export const PUBLIC_PROPERTY_PERMIT_SEED: PublicPropertyPermit[] = [
  {
    id: 'ppp-00-01',
    permitNo: '00-01',
    ownership: '국유',
    durationKind: '영구',
    purpose: '도시가스배관매설',
    useArea: '7.4',
    rate: '0.05',
    firstPermitYmd: '2012-03-08',
    periodStart: '2012-03-08',
    periodEnd: '2020-12-31',
    renewStart: '2021-01-01',
    renewEnd: '2025-12-31',
    userName: '대성에너지주식회사',
    userPhone: '053-606-1000',
    userAddr: '대구광역시 중구 남산동 2268-1',
    remark: '',
    parcel: {
      emd: '진량읍',
      ri: '봉회리',
      bun: '0551',
      ji: '0000',
      cadastralArea: '1451',
    },
    fee: {
      chargeStart: '2022-01-01',
      chargeEnd: '2022-12-31',
      days: '365',
      adjLand: '봉회리',
      adjJibun: '199-4',
      officialPrice: '287800',
      prevYearFee: '',
      assessedAmount: '5900',
      changeRate: '0',
      adjustFactor: '1',
      totalCharge: '6490',
      useFee: '5900',
      vat: '590',
      nationalShare: '2950',
      cityShare: '2950',
      noticeIssued: '',
    },
    lon: 128.82,
    lat: 35.87,
  },
  {
    id: 'ppp-00-02',
    permitNo: '00-02',
    ownership: '국유',
    durationKind: '영구',
    purpose: '학교용지',
    useArea: '17',
    rate: '0.05',
    firstPermitYmd: '2013-10-15',
    periodStart: '2013-10-15',
    periodEnd: '2020-12-31',
    renewStart: '2021-01-01',
    renewEnd: '2025-12-31',
    userName: '경산시',
    userPhone: '',
    userAddr: '',
    remark: '',
    parcel: {
      emd: '대동',
      ri: '',
      bun: '0285',
      ji: '0001',
      cadastralArea: '17',
    },
    fee: {
      chargeStart: '2020-01-01',
      chargeEnd: '2020-12-31',
      days: '366',
      adjLand: '대동',
      adjJibun: '232-10',
      officialPrice: '360500',
      prevYearFee: '',
      assessedAmount: '',
      changeRate: '',
      adjustFactor: '',
      totalCharge: '',
      useFee: '',
      vat: '',
      nationalShare: '',
      cityShare: '',
      noticeIssued: '',
    },
    lon: 128.74,
    lat: 35.825,
  },
  {
    id: 'ppp-00-25',
    permitNo: '00-25',
    ownership: '국유',
    durationKind: '영구',
    purpose: '경작용',
    useArea: '467',
    rate: '',
    firstPermitYmd: '2002-03-13',
    periodStart: '2002-03-13',
    periodEnd: '2024-12-31',
    renewStart: '2020-01-01',
    renewEnd: '2024-12-31',
    userName: '이상택',
    userPhone: '010-3827-8323',
    userAddr: '경상북도 경산시 자인면 교촌길3길 6-7, C동 302호',
    remark: '',
    parcel: {
      emd: '자인면',
      ri: '원당리',
      bun: '0711',
      ji: '0001',
      cadastralArea: '1035',
    },
    fee: {
      chargeStart: '2020-01-01',
      chargeEnd: '2020-12-31',
      days: '366',
      adjLand: '원당리',
      adjJibun: '28',
      officialPrice: '3622',
      prevYearFee: '164500',
      assessedAmount: '169600',
      changeRate: '3',
      adjustFactor: '1',
      totalCharge: '186560',
      useFee: '169600',
      vat: '16960',
      nationalShare: '84800',
      cityShare: '84800',
      noticeIssued: '',
    },
    lon: 128.82,
    lat: 35.78,
  },
  {
    id: 'ppp-s-01',
    permitNo: 'S-01',
    ownership: '공유',
    durationKind: '일시',
    purpose: '주차장',
    useArea: '120',
    rate: '0.05',
    firstPermitYmd: '2019-05-01',
    periodStart: '2019-05-01',
    periodEnd: '2023-12-31',
    renewStart: '2024-01-01',
    renewEnd: '2026-12-31',
    userName: '○○상가번영회',
    userPhone: '053-800-0000',
    userAddr: '경상북도 경산시 중방동',
    remark: '프로토타입 공유 표본',
    parcel: {
      emd: '중방동',
      ri: '',
      bun: '0101',
      ji: '0002',
      cadastralArea: '250',
    },
    fee: {
      chargeStart: '2025-01-01',
      chargeEnd: '2025-12-31',
      days: '365',
      adjLand: '중방동',
      adjJibun: '101-2',
      officialPrice: '450000',
      prevYearFee: '210000',
      assessedAmount: '220000',
      changeRate: '4.8',
      adjustFactor: '1',
      totalCharge: '242000',
      useFee: '220000',
      vat: '22000',
      nationalShare: '',
      cityShare: '242000',
      noticeIssued: '발급',
    },
    lon: 128.741,
    lat: 35.8255,
  },
];

export function lonLatTo3857(lon: number, lat: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}
