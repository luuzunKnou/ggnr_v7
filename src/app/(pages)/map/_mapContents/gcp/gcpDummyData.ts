import {
  GCP_INSPECT_DUE_DAYS,
  GCP_MAP_COLORS,
  type GcpDisplayStatus,
  type GcpStatus,
} from './gcpConfig'

export type GcpPhoto = {
  id: string
  name: string
  url: string
}

export type GcpInspectItem = {
  gcpId: string
  status: GcpStatus
  note: string
  photos: GcpPhoto[]
}

export type GcpInspection = {
  id: string
  inspectDate: string
  inspector: string
  items: GcpInspectItem[]
}

export type GcpPoint = {
  id: string
  gcpnum: string
  x: number
  y: number
  z: number
  geom5181: [number, number]
  placeNote: string
  installedAt: string
  status: GcpStatus
  address: string
  photos: GcpPhoto[]
  lastInspectDate: string
}

function daysSince(isoDate: string, today = new Date().toISOString().slice(0, 10)): number {
  const a = Date.parse(`${isoDate}T00:00:00`)
  const b = Date.parse(`${today}T00:00:00`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.floor((b - a) / 86400000)
}

export function statusLabel(status: GcpStatus): GcpDisplayStatus {
  if (status === 'abnormal') return '비정상'
  if (status === 'due') return '점검필요'
  return '정상'
}

export function displayStatusOf(point: GcpPoint): GcpDisplayStatus {
  if (point.status === 'abnormal') return '비정상'
  if (point.status === 'due') return '점검필요'
  const last = point.lastInspectDate || point.installedAt
  if (last && daysSince(last) >= GCP_INSPECT_DUE_DAYS) return '점검필요'
  return '정상'
}

export function mapColorOf(point: GcpPoint): string {
  const shown = displayStatusOf(point)
  if (shown === '비정상') return GCP_MAP_COLORS.bad
  if (shown === '점검필요') return GCP_MAP_COLORS.warn
  return GCP_MAP_COLORS.ok
}

export function statusBadgeClass(shown: GcpDisplayStatus): string {
  if (shown === '비정상') return 'bg-rose-100 text-rose-800'
  if (shown === '점검필요') return 'bg-yellow-100 text-yellow-800'
  return 'bg-primary/10 text-primary'
}

type Seed = {
  gid: number
  gcpnum: string
  x: number
  y: number
  z: number
  txt1: string
  txt2: string
  gx: number
  gy: number
  status: GcpStatus
  lastInspectDate: string
  address?: string
}

/** 레이어 CSV(gcp_202609101516) 일부 + 좌표 역검색 주소 일부 */
const SEED: Seed[] = [
  { gid: 1, gcpnum: '55', x: 238799.484, y: 323645.697, z: 22.538, txt1: '맨홀', txt2: '중앙', gx: 420259.61503145, gy: 226272.87900862, status: 'ok', lastInspectDate: '2026-08-02', address: '울산광역시 동구 진성4길 11' },
  { gid: 2, gcpnum: '56', x: 238918.694, y: 322924.175, z: 14.689, txt1: '맨홀', txt2: '중앙', gx: 420393.51169815, gy: 225553.50663096, status: 'ok', lastInspectDate: '2026-07-21', address: '울산광역시 동구 학문로' },
  { gid: 3, gcpnum: '119', x: 241051.367, y: 328942.054, z: 45.63, txt1: '사각배수구', txt2: '동쪽', gx: 422404.79524449, gy: 231616.96580444, status: 'due', lastInspectDate: '2025-10-04', address: '울산광역시 동구 미포산업로' },
  { gid: 4, gcpnum: '118', x: 240968.668, y: 329433.711, z: 43.944, txt1: '맨홀', txt2: '중앙', gx: 422312.07408081, gy: 232107.13015891, status: 'ok', lastInspectDate: '2026-08-11' },
  { gid: 5, gcpnum: '117', x: 240827.071, y: 330534.343, z: 6.973, txt1: '사각배수구', txt2: '북동쪽상단', gx: 422148.05412444, gy: 233205.30409542, status: 'abnormal', lastInspectDate: '2026-06-18' },
  { gid: 6, gcpnum: '115', x: 240953.36, y: 330651.108, z: 5.122, txt1: '맨홀', txt2: '중앙', gx: 422272.01784495, gy: 233324.68061242, status: 'ok', lastInspectDate: '2026-08-02' },
  { gid: 12, gcpnum: '109-1', x: 241237.78, y: 327961.459, z: 3.239, txt1: '주차선', txt2: '남서쪽바깥모서리', gx: 422611.20229126, gy: 230639.78281929, status: 'due', lastInspectDate: '2025-09-12', address: '울산광역시 동구 보밑길' },
  { gid: 13, gcpnum: '109', x: 241250.254, y: 327959.599, z: 2.964, txt1: '경계석', txt2: '안쪽모서리', gx: 422623.71885801, gy: 230638.17551282, status: 'ok', lastInspectDate: '2026-07-30' },
  { gid: 17, gcpnum: 'BO34', x: 240648.079, y: 326994.667, z: 23.202, txt1: '삼각보조점34', txt2: '파란색 페인트칠', gx: 422040.91401071, gy: 229660.64311965, status: 'abnormal', lastInspectDate: '2026-03-21', address: '울산광역시 동구' },
  { gid: 19, gcpnum: '14', x: 237321.831, y: 320564.388, z: 27.561, txt1: '북서쪽횡단보도선', txt2: '좌우중좌 우측하단', gx: 418843.92839009, gy: 223160.45056293, status: 'ok', lastInspectDate: '2026-08-20', address: '울산광역시 동구 문현로' },
]

export const GCP_SEED_POINTS: GcpPoint[] = SEED.map((row) => ({
  id: `gcp-${row.gid}`,
  gcpnum: row.gcpnum,
  x: row.x,
  y: row.y,
  z: row.z,
  geom5181: [row.gx, row.gy],
  placeNote: `${row.txt1} / ${row.txt2}`,
  installedAt: '2024-04-12',
  status: row.status,
  address: row.address || '—',
  photos: [],
  lastInspectDate: row.lastInspectDate,
}))

export const GCP_SEED_INSPECTIONS: GcpInspection[] = [
  {
    id: 'insp-1',
    inspectDate: '2026-08-02',
    inspector: '담당자',
    items: [
      { gcpId: 'gcp-1', status: 'ok', note: '표지 양호. 맨홀 중앙 표시가 선명하고 주변 가림이 없다.', photos: [] },
      { gcpId: 'gcp-6', status: 'ok', note: '이상 없음.', photos: [] },
    ],
  },
  {
    id: 'insp-3',
    inspectDate: '2026-07-21',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-2', status: 'ok', note: '위치 설명과 일치. 맨홀 뚜껑 위 표시 확인.', photos: [] }],
  },
  {
    id: 'insp-4',
    inspectDate: '2026-06-18',
    inspector: '담당자',
    items: [
      {
        gcpId: 'gcp-5',
        status: 'abnormal',
        note: '사각배수구 북동쪽 상단 표시가 훼손되어 식별이 어렵다. 재표시가 필요하다.',
        photos: [],
      },
    ],
  },
  {
    id: 'insp-2',
    inspectDate: '2026-03-21',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-17', status: 'abnormal', note: '파란색 페인트가 마모되어 보조점 식별이 어렵다. 재표시 필요.', photos: [] }],
  },
  {
    id: 'insp-5',
    inspectDate: '2026-02-10',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-1', status: 'ok', note: '동절기 점검. 표지 상태 양호, 주변 적설·가림 없음.', photos: [] }],
  },
  {
    id: 'insp-6',
    inspectDate: '2025-10-04',
    inspector: '담당자',
    items: [
      {
        gcpId: 'gcp-3',
        status: 'due',
        note: '사각배수구 동쪽 표시가 흐리다. 당장 유실 수준은 아니나 다음 회차에 재확인할 것.',
        photos: [],
      },
    ],
  },
  {
    id: 'insp-7',
    inspectDate: '2025-09-12',
    inspector: '담당자',
    items: [
      {
        gcpId: 'gcp-12',
        status: 'due',
        note: '주차선 남서쪽 바깥 모서리 표시가 희미하다. 재도색 여부를 다음 점검에서 판단.',
        photos: [],
      },
    ],
  },
  {
    id: 'insp-8',
    inspectDate: '2025-08-18',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-1', status: 'due', note: '도색이 다소 흐리다. 유실은 아니나 다음 점검 시 재확인할 것.', photos: [] }],
  },
  {
    id: 'insp-9',
    inspectDate: '2025-02-03',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-1', status: 'ok', note: '설치 후 1차 점검. 위치 설명(맨홀 / 중앙)과 일치한다.', photos: [] }],
  },
  {
    id: 'insp-10',
    inspectDate: '2024-11-15',
    inspector: '담당자',
    items: [{ gcpId: 'gcp-17', status: 'ok', note: '삼각보조점 페인트 상태 양호. 주변 공사 없음.', photos: [] }],
  },
]
