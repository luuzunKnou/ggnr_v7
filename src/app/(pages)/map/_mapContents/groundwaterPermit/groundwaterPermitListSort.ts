import { tryFormatToYmd } from '@/lib/formatDateYmd'

export type GroundwaterPermitListSortKey =
  | 'nameOrTrade'
  | 'developLocation'
  | 'permitStartDate'
  | 'permitEndDate'
  | 'statusLabel'

export type GroundwaterPermitListSortDir = 'asc' | 'desc'

export type GroundwaterPermitListSortSpec = {
  key: GroundwaterPermitListSortKey
  dir: GroundwaterPermitListSortDir
}

export type GroundwaterPermitListSortRow = {
  id: string
  nameOrTrade: string
  developLocation: string
  permitStartDate: string
  permitEndDate: string
  statusLabel: string
}

const SORT_KEYS = new Set<GroundwaterPermitListSortKey>([
  'nameOrTrade',
  'developLocation',
  'permitStartDate',
  'permitEndDate',
  'statusLabel',
])

export function initialGroundwaterPermitSortDir(
  key: GroundwaterPermitListSortKey
): GroundwaterPermitListSortDir {
  return key === 'permitStartDate' || key === 'permitEndDate' ? 'desc' : 'asc'
}

function ymd(raw: string): string {
  return tryFormatToYmd(raw) ?? String(raw ?? '').trim().slice(0, 10)
}

function compareText(a: string, b: string, dir: GroundwaterPermitListSortDir): number {
  const av = String(a ?? '').trim()
  const bv = String(b ?? '').trim()
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  const cmp = av.localeCompare(bv, 'ko')
  return dir === 'asc' ? cmp : -cmp
}

function compareDate(a: string, b: string, dir: GroundwaterPermitListSortDir): number {
  const av = ymd(a)
  const bv = ymd(b)
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  const cmp = av.localeCompare(bv)
  return dir === 'asc' ? cmp : -cmp
}

function compareByKey(
  a: GroundwaterPermitListSortRow,
  b: GroundwaterPermitListSortRow,
  key: GroundwaterPermitListSortKey,
  dir: GroundwaterPermitListSortDir
): number {
  switch (key) {
    case 'nameOrTrade':
      return compareText(a.nameOrTrade, b.nameOrTrade, dir)
    case 'developLocation':
      return compareText(a.developLocation, b.developLocation, dir)
    case 'permitStartDate':
      return compareDate(a.permitStartDate, b.permitStartDate, dir)
    case 'permitEndDate':
      return compareDate(a.permitEndDate, b.permitEndDate, dir)
    case 'statusLabel':
      return compareText(a.statusLabel, b.statusLabel, dir)
    default:
      return 0
  }
}

function compareDefault(a: GroundwaterPermitListSortRow, b: GroundwaterPermitListSortRow): number {
  return compareText(a.id, b.id, 'asc')
}

export function sortGroundwaterPermitListRows<T extends GroundwaterPermitListSortRow>(
  rows: T[],
  sorts?: GroundwaterPermitListSortSpec[] | null
): T[] {
  const specs = (sorts ?? []).filter((s) => SORT_KEYS.has(s.key))
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareByKey(a, b, spec.key, spec.dir)
      if (cmp !== 0) return cmp
    }
    return compareDefault(a, b)
  })
}
