/** 공사대장 알림설정과 알림일 계산. 화면·서버가 같이 쓴다. */

export type ConsAlertSettings = {
  /** 알림 주기(년). 0이면 미사용 */
  cycleYears: number
  doneBeforeDays: number
  doneBeforeOn: boolean
  doneAfterDays: number
  doneAfterOn: boolean
  startBeforeDays: number
  startBeforeOn: boolean
  startAfterDays: number
  startAfterOn: boolean
}

export const DEFAULT_CONS_ALERT: ConsAlertSettings = {
  cycleYears: 1,
  doneBeforeDays: 30,
  doneBeforeOn: true,
  doneAfterDays: 7,
  doneAfterOn: false,
  startBeforeDays: 14,
  startBeforeOn: true,
  startAfterDays: 7,
  startAfterOn: false,
}

export type Ymd = { y: number; m: number; d: number }

export type ConsAlertHit = {
  suffix: string
  label: string
  daysUntil: number
}

export function parseYmd(raw: string | undefined): Ymd | null {
  const s = String(raw ?? '').trim()
  const matched = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!matched) return null
  const y = Number(matched[1])
  const m = Number(matched[2])
  const d = Number(matched[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

function utcDay(ymd: Ymd): number {
  return Math.floor(Date.UTC(ymd.y, ymd.m - 1, ymd.d) / 86400000)
}

function fromUtcDay(day: number): Ymd {
  const date = new Date(day * 86400000)
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

function addDays(ymd: Ymd, days: number): Ymd {
  return fromUtcDay(utcDay(ymd) + days)
}

function addYears(ymd: Ymd, years: number): Ymd {
  const date = new Date(Date.UTC(ymd.y + years, ymd.m - 1, ymd.d))
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

export function todayYmd(now = new Date()): Ymd {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

export function diffYmd(from: Ymd, to: Ymd): number {
  return utcDay(to) - utcDay(from)
}

export function consAlertWhenLabel(daysUntil: number): string {
  if (daysUntil === 0) return '오늘'
  if (daysUntil > 0) return `D-${daysUntil}`
  return `${-daysUntil}일 지남`
}

/** 알림일이 오늘 기준 전후 withinDays 안에 있으면 반환한다. */
export function consAlertHits(
  settings: ConsAlertSettings,
  startRaw: string | undefined,
  doneRaw: string | undefined,
  today: Ymd,
  withinDays: number
): ConsAlertHit[] {
  const start = parseYmd(startRaw)
  const done = parseYmd(doneRaw)
  const hits: ConsAlertHit[] = []
  const push = (suffix: string, label: string, when: Ymd | null) => {
    if (!when) return
    const daysUntil = diffYmd(today, when)
    if (daysUntil < -withinDays || daysUntil > withinDays) return
    hits.push({ suffix, label, daysUntil })
  }

  if (settings.doneBeforeOn) {
    push('done-before', `준공 ${settings.doneBeforeDays}일 전`, done ? addDays(done, -settings.doneBeforeDays) : null)
  }
  if (settings.doneAfterOn) {
    push('done-after', `준공 ${settings.doneAfterDays}일 후`, done ? addDays(done, settings.doneAfterDays) : null)
  }
  if (settings.startBeforeOn) {
    push('start-before', `착수 ${settings.startBeforeDays}일 전`, start ? addDays(start, -settings.startBeforeDays) : null)
  }
  if (settings.startAfterOn) {
    push('start-after', `착수 ${settings.startAfterDays}일 후`, start ? addDays(start, settings.startAfterDays) : null)
  }
  if (settings.cycleYears > 0 && done) {
    let years = settings.cycleYears
    for (let i = 0; i < 40; i += 1) {
      const when = addYears(done, years)
      const daysUntil = diffYmd(today, when)
      if (daysUntil > withinDays) break
      if (daysUntil >= -withinDays) {
        hits.push({ suffix: 'cycle', label: `준공 ${settings.cycleYears}년 주기`, daysUntil })
        break
      }
      years += settings.cycleYears
    }
  }
  return hits
}
