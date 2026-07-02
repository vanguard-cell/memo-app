import { todayStr } from './parser'

export function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${y.slice(2)}.${m}.${d}`
}

export function fmtPeriod(p) {
  return p ? `${fmtDate(p.start)} ~ ${fmtDate(p.end)}` : ''
}

export function diffDays(a, b) {
  return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000)
}

export function memoStatus(m) {
  if (m.status === 'done') return 'done'
  return m.history.length > 0 ? 'active' : 'todo'
}

export const STATUS_LABEL = { done: '완료', active: '진행중', todo: '할일' }

export const companies = (memos) => [...new Set(memos.map((m) => m.company).filter(Boolean))]

export function buildNags(memos) {
  const today = todayStr()
  const overdue = []
  const dueToday = []
  const upcoming = []
  const dateless = []
  for (const m of memos) {
    if (m.status === 'done') continue
    const snoozed = m.snoozeUntil && m.snoozeUntil > today
    if (m.due) {
      const dd = diffDays(m.due, today)
      if (dd < 0 && !snoozed) overdue.push({ m, days: -dd, kind: 'due' })
      else if (dd === 0 && !snoozed) dueToday.push({ m, kind: 'due' })
      else if (dd > 0 && dd <= 7) upcoming.push({ m, dd, kind: 'due' })
    }
    if (m.period && m.period.end) {
      const dd = diffDays(m.period.end, today)
      if (dd < 0 && !snoozed) overdue.push({ m, days: -dd, kind: 'end' })
      else if (dd === 0 && !snoozed) dueToday.push({ m, kind: 'end' })
      else if (dd > 0 && dd <= 60) upcoming.push({ m, dd, kind: 'end' })
    }
    if (!m.due && !m.period) dateless.push(m)
  }
  overdue.sort((a, b) => b.days - a.days)
  upcoming.sort((a, b) => a.dd - b.dd)
  return { overdue, dueToday, upcoming, dateless }
}

export function nagCount(memos) {
  const { overdue, dueToday } = buildNags(memos)
  return overdue.length + dueToday.length
}
