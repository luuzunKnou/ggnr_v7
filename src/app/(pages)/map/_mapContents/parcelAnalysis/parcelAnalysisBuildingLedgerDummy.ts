import type { MockBuildingRow } from './mockParcelAnalysisResult';

/**
 * 결과 모달 건축물대장 UI 테스트용 더미.
 * 실제 API 대신 아래 행을 표시한다. 끄려면 false.
 */
export const USE_DUMMY_BUILDING_LEDGER = true;

/** 가로 스크롤·긴 명칭 확인용 샘플 */
export const DUMMY_BUILDING_LEDGER_ROWS: MockBuildingRow[] = [
  {
    pnu: '4711135025100010001',
    addr: '금곡리 123',
    bldNm: '국립생태원멸종위기종복원센터 연구소(교육연구시설)',
    platLoc: '경상북도 영양군 수비면 금곡리',
    jibun: '123',
    roadAddr: '경상북도 영양군 수비면 금곡길 123-45 (국립생태원 일원)',
    bcRat: '45%',
    vlRat: '120%',
    jijigu: '자연녹지지역',
    platArea: '2,450.5',
    totArea: '1,161.05',
  },
  {
    pnu: '4711135025100020001',
    addr: '금곡리 124',
    bldNm: '흥림산자연휴양림 가동',
    platLoc: '경상북도 영양군 수비면 금곡리',
    jibun: '124',
    roadAddr: '경상북도 영양군 수비면 흥림산로 88',
    bcRat: '12%',
    vlRat: '35%',
    jijigu: '자연녹지지역',
    platArea: '890.0',
    totArea: '312.4',
  },
  {
    pnu: '4711135025100030001',
    addr: '송천리 45-1',
    bldNm: '영양군청 별관 행정복지동 및 민원편의시설 부속동',
    platLoc: '경상북도 영양군 영양읍 서부리',
    jibun: '45-1',
    roadAddr: '경상북도 영양군 영양읍 군청길 37',
    bcRat: '38%',
    vlRat: '95%',
    jijigu: '일반상업지역',
    platArea: '1,520.0',
    totArea: '2,840.75',
  },
  {
    pnu: '4711135025100040001',
    addr: '입암리 12',
    bldNm: '다목적체육관 및 실내수영장 복합시설',
    platLoc: '경상북도 영양군 입암면 입암리',
    jibun: '12',
    roadAddr: '-',
    bcRat: '52%',
    vlRat: '110%',
    jijigu: '보전관리지역',
    platArea: '3,100.0',
    totArea: '4,502.0',
  },
];
