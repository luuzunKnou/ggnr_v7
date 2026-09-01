import {
  OCCUPATION_PERIOD_STATE_ENDED,
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
} from '@/lib/occupationLedgerPeriodState';

export type SampleListRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
  status: string;
};

export const SAMPLE_MOCK_ROWS: SampleListRow[] = [
  {
    rowKey: 'sample-1',
    name: '중앙로 보도 확장 공사',
    place: '영주시 중앙로 120',
    startDate: '2024-03-01',
    endDate: '2025-12-31',
    status: OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  },
  {
    rowKey: 'sample-2',
    name: '하천 제방 보수 점용',
    place: '풍기읍 낙동강변',
    startDate: '2023-06-15',
    endDate: '2024-05-30',
    status: OCCUPATION_PERIOD_STATE_ENDED,
  },
  {
    rowKey: 'sample-3',
    name: '상하수도관 매설',
    place: '문수면 문수로 45',
    startDate: '2025-01-10',
    endDate: '2026-06-30',
    status: OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  },
  {
    rowKey: 'sample-4',
    name: '전력 케이블 매설',
    place: '이산면 이산로 88',
    startDate: '2022-11-01',
    endDate: '2023-10-31',
    status: OCCUPATION_PERIOD_STATE_ENDED,
  },
  {
    rowKey: 'sample-5',
    name: '도로 포장 공사',
    place: '영주시 가흥동 일원',
    startDate: '2025-04-01',
    endDate: '2025-11-30',
    status: OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  },
  {
    rowKey: 'sample-6',
    name: '통신선로 지중화',
    place: '풍기읍 장재로 200',
    startDate: '2024-08-20',
    endDate: '2025-03-15',
    status: OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  },
  {
    rowKey: 'sample-7',
    name: '가로수 정비',
    place: '영주시 휴천동 중앙로',
    startDate: '2021-04-01',
    endDate: '2022-03-31',
    status: OCCUPATION_PERIOD_STATE_ENDED,
  },
  {
    rowKey: 'sample-8',
    name: '배수로 정비 공사',
    place: '문수면 문수로 12',
    startDate: '2025-07-01',
    endDate: '2026-02-28',
    status: OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  },
];
