/** 시설관리 예시. 저장소 없음. */

export type WtlPlantKind = '취수장' | '정수장' | '배수지' | '가압장'

export type WtlEquipKind =
  | '펌프'
  | '모터'
  | '밸브'
  | '변압기'
  | '염소투입설비'
  | '수질계측기'
  | '계측기'
  | '여과장치'
  | '흡수정'

export type WtlHistoryRow = {
  date: string
  title: string
  party: string
}

export type WtlEquipment = {
  id: string
  kind: WtlEquipKind
  name: string
  status: string
  lastCheck: string
  form: string
  capacity: string
  maker: string
  installYear: string
  maintenance: WtlHistoryRow[]
  inspection: WtlHistoryRow[]
  contracts: WtlHistoryRow[]
}

export type WtlPlant = {
  id: string
  kind: WtlPlantKind
  name: string
  capacity: string
  year: string
  status: string
  address: string
  manager: string
  phone: string
  equipment: WtlEquipment[]
}

export type WtlSimpleItem = {
  id: string
  name: string
  col2: string
  col3: string
  status: string
  attrs: { label: string; value: string }[]
}

function hist(date: string, title: string, party: string): WtlHistoryRow {
  return { date, title, party }
}

function equip(
  partial: Omit<WtlEquipment, 'maintenance' | 'inspection' | 'contracts'> & {
    maintenance?: WtlHistoryRow[]
    inspection?: WtlHistoryRow[]
    contracts?: WtlHistoryRow[]
  }
): WtlEquipment {
  return {
    ...partial,
    maintenance: partial.maintenance ?? [],
    inspection: partial.inspection ?? [],
    contracts: partial.contracts ?? [],
  }
}

export const WTL_INTAKE_PLANTS: WtlPlant[] = [
  {
    id: 'int-js',
    kind: '취수장',
    name: '장수 취수장',
    capacity: '4,200㎥/일',
    year: '1999',
    status: '가동',
    address: '영양읍 삼지리 88',
    manager: '이수영',
    phone: '054-680-6730',
    equipment: [
      equip({
        id: 'int-js-p1',
        kind: '펌프',
        name: '취수펌프 1호',
        status: '가동',
        lastCheck: '2026-08-01',
        form: '원심펌프',
        capacity: '15㎥/분',
        maker: '○○펌프',
        installYear: '1999',
        maintenance: [hist('2026-08-01', '베어링 교체', '○○기전')],
        inspection: [hist('2026-08-01', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '유지보수 연간계약', '○○기전 / 900만원')],
      }),
      equip({
        id: 'int-js-m1',
        kind: '모터',
        name: '취수모터 1호',
        status: '가동',
        lastCheck: '2026-08-01',
        form: '유도전동기',
        capacity: '75kW',
        maker: '◇◇전기',
        installYear: '1999',
        maintenance: [hist('2026-05-10', '절연저항 측정', '◇◇전기')],
        inspection: [hist('2026-08-01', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '전기설비 유지', '◇◇전기 / 400만원')],
      }),
      equip({
        id: 'int-js-v1',
        kind: '밸브',
        name: '취수밸브 1호',
        status: '가동',
        lastCheck: '2026-07-15',
        form: '버터플라이',
        capacity: 'D400',
        maker: '☆☆밸브',
        installYear: '2005',
        maintenance: [hist('2026-07-15', '패킹 교체', '☆☆밸브')],
        inspection: [hist('2026-07-15', '개폐 시험 적합', '시설팀')],
      }),
      equip({
        id: 'int-js-t1',
        kind: '변압기',
        name: '수전 변압기',
        status: '가동',
        lastCheck: '2026-06-20',
        form: '유입식',
        capacity: '500kVA',
        maker: '◇◇전기',
        installYear: '2012',
        inspection: [hist('2026-06-20', '절연유 점검 적합', '시설팀')],
        contracts: [hist('2025-04-01', '수전설비 유지', '◇◇전기 / 350만원')],
      }),
    ],
  },
  {
    id: 'int-ip',
    kind: '취수장',
    name: '입암 취수장',
    capacity: '1,500㎥/일',
    year: '2010',
    status: '가동',
    address: '입암면 흥구리 12',
    manager: '최민정',
    phone: '054-680-6731',
    equipment: [
      equip({
        id: 'int-ip-p1',
        kind: '펌프',
        name: '취수펌프 1호',
        status: '가동',
        lastCheck: '2026-07-01',
        form: '원심펌프',
        capacity: '8㎥/분',
        maker: '○○펌프',
        installYear: '2010',
        inspection: [hist('2026-07-01', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '유지보수 연간계약', '○○기전 / 500만원')],
      }),
      equip({
        id: 'int-ip-m1',
        kind: '모터',
        name: '취수모터 1호',
        status: '점검',
        lastCheck: '2026-07-01',
        form: '유도전동기',
        capacity: '45kW',
        maker: '◇◇전기',
        installYear: '2010',
        maintenance: [hist('2026-07-01', '베어링 소음 확인', '◇◇전기')],
        inspection: [hist('2026-07-01', '추가점검 필요', '시설팀')],
      }),
      equip({
        id: 'int-ip-v1',
        kind: '밸브',
        name: '방류밸브',
        status: '가동',
        lastCheck: '2026-05-22',
        form: '게이트',
        capacity: 'D300',
        maker: '☆☆밸브',
        installYear: '2010',
        inspection: [hist('2026-05-22', '개폐 시험 적합', '시설팀')],
      }),
    ],
  },
]

export const WTL_WATER_PLANTS: WtlPlant[] = [
  {
    id: 'wtp-yy',
    kind: '정수장',
    name: '영양 정수장',
    capacity: '3,000㎥/일',
    year: '2008',
    status: '가동',
    address: '영양읍 서부리 군청길 37',
    manager: '홍길동',
    phone: '054-680-6700',
    equipment: [
      equip({
        id: 'eq-p1',
        kind: '펌프',
        name: '취수펌프 1호',
        status: '가동',
        lastCheck: '2026-08-01',
        form: '원심펌프',
        capacity: '12㎥/분',
        maker: '○○펌프',
        installYear: '2008',
        maintenance: [
          hist('2026-08-01', '베어링 교체', '○○기전'),
          hist('2026-03-12', '오일 보충', '○○기전'),
        ],
        inspection: [
          hist('2026-08-01', '정기점검 적합', '시설팀'),
          hist('2026-02-10', '정기점검 적합', '시설팀'),
        ],
        contracts: [hist('2026-01-01', '유지보수 연간계약', '○○기전 / 1,200만원')],
      }),
      equip({
        id: 'eq-p2',
        kind: '펌프',
        name: '취수펌프 2호',
        status: '가동',
        lastCheck: '2026-08-01',
        form: '원심펌프',
        capacity: '12㎥/분',
        maker: '○○펌프',
        installYear: '2008',
        maintenance: [hist('2026-05-20', '패킹 교체', '○○기전')],
        inspection: [hist('2026-08-01', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '유지보수 연간계약', '○○기전 / 1,200만원')],
      }),
      equip({
        id: 'eq-cl',
        kind: '염소투입설비',
        name: '염소투입 1호',
        status: '가동',
        lastCheck: '2026-08-12',
        form: '액화염소',
        capacity: '5kg/h',
        maker: '△△환경',
        installYear: '2010',
        maintenance: [hist('2026-08-12', '주입관 세척', '△△환경')],
        inspection: [hist('2026-08-12', '정기점검 적합', '시설팀')],
        contracts: [hist('2025-03-01', '약품·설비 유지', '△△환경 / 800만원')],
      }),
      equip({
        id: 'eq-wq1',
        kind: '수질계측기',
        name: '탁도계',
        status: '점검',
        lastCheck: '2026-07-20',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2015',
        maintenance: [hist('2026-07-20', '센서 교정', '□□계측')],
        inspection: [hist('2026-07-20', '교정 필요', '시설팀')],
        contracts: [hist('2026-01-01', '계측기 유지', '□□계측 / 300만원')],
      }),
      equip({
        id: 'eq-wq2',
        kind: '수질계측기',
        name: '잔류염소계',
        status: '가동',
        lastCheck: '2026-07-20',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2015',
        maintenance: [hist('2026-04-02', '전극 교체', '□□계측')],
        inspection: [hist('2026-07-20', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '계측기 유지', '□□계측 / 300만원')],
      }),
    ],
  },
  {
    id: 'wtp-ip',
    kind: '정수장',
    name: '입암 정수장',
    capacity: '1,200㎥/일',
    year: '2014',
    status: '가동',
    address: '입암면 흥구리 120',
    manager: '김영희',
    phone: '054-680-6711',
    equipment: [
      equip({
        id: 'eq-ip-p1',
        kind: '펌프',
        name: '송수펌프 1호',
        status: '가동',
        lastCheck: '2026-06-15',
        form: '원심펌프',
        capacity: '6㎥/분',
        maker: '○○펌프',
        installYear: '2014',
        maintenance: [hist('2026-06-15', '임펠러 점검', '○○기전')],
        inspection: [hist('2026-06-15', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '유지보수 연간계약', '○○기전 / 600만원')],
      }),
      equip({
        id: 'eq-ip-cl',
        kind: '염소투입설비',
        name: '염소투입 1호',
        status: '가동',
        lastCheck: '2026-06-15',
        form: '액화염소',
        capacity: '2kg/h',
        maker: '△△환경',
        installYear: '2014',
        inspection: [hist('2026-06-15', '정기점검 적합', '시설팀')],
        contracts: [hist('2025-03-01', '약품·설비 유지', '△△환경 / 400만원')],
      }),
      equip({
        id: 'eq-ip-wq',
        kind: '수질계측기',
        name: '탁도계',
        status: '가동',
        lastCheck: '2026-06-15',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2014',
        inspection: [hist('2026-06-15', '정기점검 적합', '시설팀')],
      }),
    ],
  },
  {
    id: 'wtp-cg',
    kind: '정수장',
    name: '청기 정수장',
    capacity: '800㎥/일',
    year: '1998',
    status: '정지',
    address: '청기면 당리 45',
    manager: '박민수',
    phone: '054-680-6722',
    equipment: [
      equip({
        id: 'eq-cg-p1',
        kind: '펌프',
        name: '취수펌프 1호',
        status: '정지',
        lastCheck: '2025-12-01',
        form: '원심펌프',
        capacity: '4㎥/분',
        maker: '○○펌프',
        installYear: '1998',
        maintenance: [hist('2025-12-01', '모터 분리 점검', '○○기전')],
        inspection: [hist('2025-12-01', '가동 보류', '시설팀')],
      }),
    ],
  },
]

export const WTL_RESERVOIR_PLANTS: WtlPlant[] = [
  {
    id: 'res-ct',
    kind: '배수지',
    name: '중앙 배수지',
    capacity: '1,800㎥',
    year: '2012',
    status: '가동',
    address: '영양읍 서부리 210',
    manager: '강동훈',
    phone: '054-680-6740',
    equipment: [
      equip({
        id: 'res-ct-cl',
        kind: '염소투입설비',
        name: '잔류염소 보강 1호',
        status: '가동',
        lastCheck: '2026-08-05',
        form: '액화염소',
        capacity: '1kg/h',
        maker: '△△환경',
        installYear: '2012',
        maintenance: [hist('2026-08-05', '주입량 조정', '△△환경')],
        inspection: [hist('2026-08-05', '정기점검 적합', '시설팀')],
        contracts: [hist('2025-03-01', '약품·설비 유지', '△△환경 / 350만원')],
      }),
      equip({
        id: 'res-ct-m1',
        kind: '계측기',
        name: '수위계',
        status: '가동',
        lastCheck: '2026-07-28',
        form: '초음파',
        capacity: '0~5m',
        maker: '□□계측',
        installYear: '2016',
        inspection: [hist('2026-07-28', '교정 적합', '시설팀')],
      }),
      equip({
        id: 'res-ct-f1',
        kind: '여과장치',
        name: '유입 스트레이너',
        status: '가동',
        lastCheck: '2026-06-10',
        form: '스크린',
        capacity: 'D250',
        maker: '▽▽필터',
        installYear: '2012',
        maintenance: [hist('2026-06-10', '스크린 세척', '시설팀')],
        inspection: [hist('2026-06-10', '정기점검 적합', '시설팀')],
      }),
      equip({
        id: 'res-ct-wq',
        kind: '수질계측기',
        name: '잔류염소계',
        status: '가동',
        lastCheck: '2026-07-28',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2016',
        inspection: [hist('2026-07-28', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '계측기 유지', '□□계측 / 200만원')],
      }),
    ],
  },
  {
    id: 'res-sj',
    kind: '배수지',
    name: '석보 배수지',
    capacity: '600㎥',
    year: '2005',
    status: '가동',
    address: '석보면 포산리 33',
    manager: '윤서연',
    phone: '054-680-6741',
    equipment: [
      equip({
        id: 'res-sj-cl',
        kind: '염소투입설비',
        name: '염소투입 1호',
        status: '가동',
        lastCheck: '2026-05-18',
        form: '차아염소산',
        capacity: '0.5kg/h',
        maker: '△△환경',
        installYear: '2018',
        inspection: [hist('2026-05-18', '정기점검 적합', '시설팀')],
      }),
      equip({
        id: 'res-sj-m1',
        kind: '계측기',
        name: '유량계',
        status: '점검',
        lastCheck: '2026-05-18',
        form: '전자식',
        capacity: 'D150',
        maker: '□□계측',
        installYear: '2011',
        maintenance: [hist('2026-05-18', '영점 보정', '□□계측')],
        inspection: [hist('2026-05-18', '재점검 필요', '시설팀')],
      }),
      equip({
        id: 'res-sj-wq',
        kind: '수질계측기',
        name: '탁도계',
        status: '가동',
        lastCheck: '2026-05-18',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2018',
        inspection: [hist('2026-05-18', '정기점검 적합', '시설팀')],
      }),
    ],
  },
]

export const WTL_BOOSTER_PLANTS: WtlPlant[] = [
  {
    id: 'bst-ip',
    kind: '가압장',
    name: '입암 가압장',
    capacity: '0.2㎥/분',
    year: '2015',
    status: '정지',
    address: '입암면 산해리 7',
    manager: '정우성',
    phone: '054-680-6750',
    equipment: [
      equip({
        id: 'bst-ip-w1',
        kind: '흡수정',
        name: '흡수정(물탱크)',
        status: '정지',
        lastCheck: '2026-04-12',
        form: '지상식',
        capacity: '50㎥',
        maker: '—',
        installYear: '2015',
        inspection: [hist('2026-04-12', '수위 점검', '시설팀')],
      }),
      equip({
        id: 'bst-ip-p1',
        kind: '펌프',
        name: '가압펌프 1호',
        status: '정지',
        lastCheck: '2026-04-12',
        form: '원심펌프',
        capacity: '0.2㎥/분',
        maker: '○○펌프',
        installYear: '2015',
        maintenance: [hist('2026-04-12', '모터 분리 점검', '○○기전')],
        inspection: [hist('2026-04-12', '가동 보류', '시설팀')],
        contracts: [hist('2025-01-01', '가압설비 유지', '○○기전 / 280만원')],
      }),
      equip({
        id: 'bst-ip-cl',
        kind: '염소투입설비',
        name: '잔류염소 보강',
        status: '정지',
        lastCheck: '2026-04-12',
        form: '차아염소산',
        capacity: '0.3kg/h',
        maker: '△△환경',
        installYear: '2015',
        inspection: [hist('2026-04-12', '운전 중지', '시설팀')],
      }),
      equip({
        id: 'bst-ip-wq',
        kind: '수질계측기',
        name: '잔류염소계',
        status: '정지',
        lastCheck: '2026-04-12',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2015',
        inspection: [hist('2026-04-12', '전원 차단', '시설팀')],
      }),
    ],
  },
  {
    id: 'bst-ms',
    kind: '가압장',
    name: '일월 가압장',
    capacity: '0.35㎥/분',
    year: '2019',
    status: '가동',
    address: '일월면 용화리 55',
    manager: '한지민',
    phone: '054-680-6751',
    equipment: [
      equip({
        id: 'bst-ms-w1',
        kind: '흡수정',
        name: '흡수정(물탱크)',
        status: '가동',
        lastCheck: '2026-08-08',
        form: '지상식',
        capacity: '80㎥',
        maker: '—',
        installYear: '2019',
        inspection: [hist('2026-08-08', '수위·누수 점검 적합', '시설팀')],
      }),
      equip({
        id: 'bst-ms-p1',
        kind: '펌프',
        name: '가압펌프 1호',
        status: '가동',
        lastCheck: '2026-08-08',
        form: '원심펌프',
        capacity: '0.35㎥/분',
        maker: '○○펌프',
        installYear: '2019',
        maintenance: [hist('2026-08-08', '오일 보충', '○○기전')],
        inspection: [hist('2026-08-08', '정기점검 적합', '시설팀')],
        contracts: [hist('2026-01-01', '가압설비 유지', '○○기전 / 320만원')],
      }),
      equip({
        id: 'bst-ms-p2',
        kind: '펌프',
        name: '가압펌프 2호',
        status: '가동',
        lastCheck: '2026-08-08',
        form: '원심펌프',
        capacity: '0.35㎥/분',
        maker: '○○펌프',
        installYear: '2019',
        inspection: [hist('2026-08-08', '정기점검 적합', '시설팀')],
      }),
      equip({
        id: 'bst-ms-wq',
        kind: '수질계측기',
        name: '잔류염소계',
        status: '가동',
        lastCheck: '2026-08-08',
        form: '온라인',
        capacity: '—',
        maker: '□□계측',
        installYear: '2019',
        inspection: [hist('2026-08-08', '정기점검 적합', '시설팀')],
      }),
    ],
  },
]

export const WTL_PLANTS_BY_KIND: Record<WtlPlantKind, WtlPlant[]> = {
  취수장: WTL_INTAKE_PLANTS,
  정수장: WTL_WATER_PLANTS,
  배수지: WTL_RESERVOIR_PLANTS,
  가압장: WTL_BOOSTER_PLANTS,
}

export const WTL_PRV_ITEMS: WtlSimpleItem[] = [
  {
    id: 'prv-1',
    name: '감압변 PRV-01',
    col2: '영양읍 서부리',
    col3: '3.2→2.0',
    status: '정상',
    attrs: [
      { label: '시설명', value: '감압변 PRV-01' },
      { label: '위치', value: '영양읍 서부리 관로분기' },
      { label: '유입압력', value: '3.2 kgf/㎠' },
      { label: '설정압력', value: '2.0 kgf/㎠' },
      { label: '관경', value: 'D200' },
      { label: '설치연도', value: '2016' },
      { label: '상태', value: '정상' },
      { label: '최근점검', value: '2026-07-02' },
    ],
  },
  {
    id: 'prv-2',
    name: '감압변 PRV-02',
    col2: '입암면 흥구리',
    col3: '4.0→2.5',
    status: '점검',
    attrs: [
      { label: '시설명', value: '감압변 PRV-02' },
      { label: '위치', value: '입암면 흥구리 가압 후단' },
      { label: '유입압력', value: '4.0 kgf/㎠' },
      { label: '설정압력', value: '2.5 kgf/㎠' },
      { label: '관경', value: 'D150' },
      { label: '설치연도', value: '2018' },
      { label: '상태', value: '점검' },
      { label: '최근점검', value: '2026-06-18' },
    ],
  },
  {
    id: 'prv-3',
    name: '감압변 PRV-03',
    col2: '청기면 당리',
    col3: '2.8→1.8',
    status: '정상',
    attrs: [
      { label: '시설명', value: '감압변 PRV-03' },
      { label: '위치', value: '청기면 당리 급수구역' },
      { label: '유입압력', value: '2.8 kgf/㎠' },
      { label: '설정압력', value: '1.8 kgf/㎠' },
      { label: '관경', value: 'D100' },
      { label: '설치연도', value: '2011' },
      { label: '상태', value: '정상' },
      { label: '최근점검', value: '2026-05-30' },
    ],
  },
]

export const WTL_FIRE_ITEMS: WtlSimpleItem[] = [
  {
    id: 'fire-yy',
    name: '영양읍',
    col2: '42',
    col3: '2',
    status: '관리중',
    attrs: [
      { label: '읍면', value: '영양읍' },
      { label: '소화전 총수', value: '42기' },
      { label: '정상', value: '40기' },
      { label: '고장·폐쇄', value: '2기' },
      { label: '최근점검', value: '2026-08-10' },
      { label: '담당', value: '상수도팀' },
      { label: '비고', value: '서부리 2기 뚜껑 교체 예정' },
    ],
  },
  {
    id: 'fire-ip',
    name: '입암면',
    col2: '18',
    col3: '1',
    status: '관리중',
    attrs: [
      { label: '읍면', value: '입암면' },
      { label: '소화전 총수', value: '18기' },
      { label: '정상', value: '17기' },
      { label: '고장·폐쇄', value: '1기' },
      { label: '최근점검', value: '2026-07-22' },
      { label: '담당', value: '상수도팀' },
      { label: '비고', value: '흥구리 1기 누수' },
    ],
  },
  {
    id: 'fire-cg',
    name: '청기면',
    col2: '12',
    col3: '0',
    status: '관리중',
    attrs: [
      { label: '읍면', value: '청기면' },
      { label: '소화전 총수', value: '12기' },
      { label: '정상', value: '12기' },
      { label: '고장·폐쇄', value: '0기' },
      { label: '최근점검', value: '2026-07-05' },
      { label: '담당', value: '상수도팀' },
      { label: '비고', value: '—' },
    ],
  },
  {
    id: 'fire-sb',
    name: '석보면',
    col2: '15',
    col3: '1',
    status: '관리중',
    attrs: [
      { label: '읍면', value: '석보면' },
      { label: '소화전 총수', value: '15기' },
      { label: '정상', value: '14기' },
      { label: '고장·폐쇄', value: '1기' },
      { label: '최근점검', value: '2026-06-28' },
      { label: '담당', value: '상수도팀' },
      { label: '비고', value: '포산리 1기 페인트 도색' },
    ],
  },
]

export const WTL_FLOWMETER_ITEMS: WtlSimpleItem[] = [
  {
    id: 'fm-1',
    name: '유량계 FM-01',
    col2: '영양 정수장 송수',
    col3: 'D200',
    status: '정상',
    attrs: [
      { label: '시설명', value: '유량계 FM-01' },
      { label: '설치위치', value: '영양 정수장 송수관' },
      { label: '형식', value: '전자식' },
      { label: '관경', value: 'D200' },
      { label: '측정범위', value: '0~500㎥/h' },
      { label: '설치연도', value: '2016' },
      { label: '상태', value: '정상' },
      { label: '최근점검', value: '2026-08-15' },
    ],
  },
  {
    id: 'fm-2',
    name: '유량계 FM-02',
    col2: '중앙 배수지 유입',
    col3: 'D250',
    status: '정상',
    attrs: [
      { label: '시설명', value: '유량계 FM-02' },
      { label: '설치위치', value: '중앙 배수지 유입' },
      { label: '형식', value: '전자식' },
      { label: '관경', value: 'D250' },
      { label: '측정범위', value: '0~800㎥/h' },
      { label: '설치연도', value: '2012' },
      { label: '상태', value: '정상' },
      { label: '최근점검', value: '2026-07-28' },
    ],
  },
  {
    id: 'fm-3',
    name: '유량계 FM-03',
    col2: '입암 가압장',
    col3: 'D150',
    status: '점검',
    attrs: [
      { label: '시설명', value: '유량계 FM-03' },
      { label: '설치위치', value: '입암 가압장 토출' },
      { label: '형식', value: '초음파' },
      { label: '관경', value: 'D150' },
      { label: '측정범위', value: '0~200㎥/h' },
      { label: '설치연도', value: '2015' },
      { label: '상태', value: '점검' },
      { label: '최근점검', value: '2026-06-18' },
      { label: '비고', value: '영점 보정 예정' },
    ],
  },
  {
    id: 'fm-4',
    name: '유량계 FM-04',
    col2: '석보 배수지',
    col3: 'D100',
    status: '정상',
    attrs: [
      { label: '시설명', value: '유량계 FM-04' },
      { label: '설치위치', value: '석보 배수지 유출' },
      { label: '형식', value: '전자식' },
      { label: '관경', value: 'D100' },
      { label: '측정범위', value: '0~150㎥/h' },
      { label: '설치연도', value: '2018' },
      { label: '상태', value: '정상' },
      { label: '최근점검', value: '2026-05-18' },
    ],
  },
]

export const WTL_CCTV_ITEMS: WtlSimpleItem[] = [
  {
    id: 'cctv-1',
    name: '영양 정수장 정문',
    col2: '영양 정수장',
    col3: '2026-09-01',
    status: '정상',
    attrs: [
      { label: '카메라명', value: '영양 정수장 정문' },
      { label: '설치위치', value: '영양 정수장' },
      { label: '해상도', value: '2MP' },
      { label: '저장기간', value: '30일' },
      { label: '상태', value: '정상' },
      { label: '최근확인', value: '2026-09-01' },
      { label: '관리자', value: '시설팀' },
    ],
  },
  {
    id: 'cctv-2',
    name: '중앙 배수지 전면',
    col2: '중앙 배수지',
    col3: '2026-09-01',
    status: '정상',
    attrs: [
      { label: '카메라명', value: '중앙 배수지 전면' },
      { label: '설치위치', value: '중앙 배수지' },
      { label: '해상도', value: '2MP' },
      { label: '저장기간', value: '30일' },
      { label: '상태', value: '정상' },
      { label: '최근확인', value: '2026-09-01' },
      { label: '관리자', value: '시설팀' },
    ],
  },
  {
    id: 'cctv-3',
    name: '입암 가압장',
    col2: '입암 가압장',
    col3: '2026-08-20',
    status: '장애',
    attrs: [
      { label: '카메라명', value: '입암 가압장' },
      { label: '설치위치', value: '입암 가압장' },
      { label: '해상도', value: '2MP' },
      { label: '저장기간', value: '15일' },
      { label: '상태', value: '장애' },
      { label: '최근확인', value: '2026-08-20' },
      { label: '관리자', value: '시설팀' },
      { label: '비고', value: '영상 끊김 — 회선 점검 요청' },
    ],
  },
  {
    id: 'cctv-4',
    name: '장수 취수장',
    col2: '장수 취수장',
    col3: '2026-09-02',
    status: '정상',
    attrs: [
      { label: '카메라명', value: '장수 취수장' },
      { label: '설치위치', value: '장수 취수장' },
      { label: '해상도', value: '4MP' },
      { label: '저장기간', value: '30일' },
      { label: '상태', value: '정상' },
      { label: '최근확인', value: '2026-09-02' },
      { label: '관리자', value: '시설팀' },
    ],
  },
]

export type WtlSimpleListConfig = {
  columns: [string, string, string, string]
  items: WtlSimpleItem[]
}

export const WTL_SIMPLE_BY_TAB: Record<'감압변' | '유량계' | '소방시설' | 'CCTV', WtlSimpleListConfig> = {
  감압변: {
    columns: ['시설명', '위치', '압력', '상태'],
    items: WTL_PRV_ITEMS,
  },
  유량계: {
    columns: ['시설명', '위치', '관경', '상태'],
    items: WTL_FLOWMETER_ITEMS,
  },
  소방시설: {
    columns: ['읍면', '총수', '고장', '상태'],
    items: WTL_FIRE_ITEMS,
  },
  CCTV: {
    columns: ['카메라명', '위치', '확인일', '상태'],
    items: WTL_CCTV_ITEMS,
  },
}

export type WtlEquipListRow = {
  plant: WtlPlant
  equipment: WtlEquipment
}

/** 취수·정수·배수·가압 내부설비를 한 목록으로 */
export function listAllWtlEquipment(): WtlEquipListRow[] {
  return (Object.values(WTL_PLANTS_BY_KIND) as WtlPlant[][]).flatMap((plants) =>
    plants.flatMap((plant) => plant.equipment.map((equipment) => ({ plant, equipment })))
  )
}

export function listWtlEquipKinds(rows: WtlEquipListRow[]): WtlEquipKind[] {
  const seen = new Set<WtlEquipKind>()
  const order: WtlEquipKind[] = []
  for (const row of rows) {
    if (seen.has(row.equipment.kind)) continue
    seen.add(row.equipment.kind)
    order.push(row.equipment.kind)
  }
  return order
}
