import { addDays } from './parser'

// 일정·반복·미리 알림 공용 계산 (2026-09-15 상세 패널 개편).
// 화면(상세·루틴 수정 폼)과 store가 같이 쓰므로 store를 import하지 않는 순수 함수만 둔다.

const pad = (n) => String(n).padStart(2, '0')

// ---------- 반복 ----------
// 매주는 메모 하나가 굴러가는 방식(memo.repeat), 매월 이상은 루틴(정의 + 달마다 회차).
// 루틴의 주기는 "몇 월에 해당하나"(months) 목록이라, 고른 종류를 그 메모의 달에서부터 편다.
export const REPEAT_OPTIONS = [
  ['none', '안 함'],
  ['weekly', '매주'],
  ['monthly', '매월'],
  ['quarter', '분기'],
  ['half', '반기'],
  ['yearly', '매년'],
]

export const ROUTINE_KINDS = ['monthly', 'quarter', 'half', 'yearly']

export function kindOfMonths(months) {
  if (!months || months.length === 0 || months.length === 12) return 'monthly'
  if (months.length === 4) return 'quarter'
  if (months.length === 2) return 'half'
  if (months.length === 1) return 'yearly'
  return 'custom' // 엑셀에서 들어온 불규칙한 달 목록 — 고치지 않으면 그대로 둔다
}

export function monthsFor(kind, baseMonth) {
  const base = Math.min(12, Math.max(1, Number(baseMonth) || 1))
  const step = { quarter: 3, half: 6, yearly: 12 }[kind]
  if (!step) return null // 매월
  const list = []
  for (let k = 0; k < 12 / step; k++) list.push(((base - 1 + step * k) % 12) + 1)
  return list.sort((a, b) => a - b)
}

// ---------- 미리 알림 ----------
// alarm = { n, unit: 'd'|'w'|'m', daily, text } — 일정 N일/주/개월 전에 달력·보드에 칩으로 뜬다.
// 폰 푸시가 아니다. 체크하면 그 메모 진행 기록에 한 줄이 남는다.
export const ALARM_PRESETS = [
  ['1d', '1일 전', { n: 1, unit: 'd' }],
  ['3d', '3일 전', { n: 3, unit: 'd' }],
  ['1w', '1주 전', { n: 1, unit: 'w' }],
  ['2w', '2주 전', { n: 2, unit: 'w' }],
  ['1m', '1개월 전', { n: 1, unit: 'm' }],
  ['2m', '2개월 전', { n: 2, unit: 'm' }],
]

export const ALARM_UNITS = [
  ['d', '일 전'],
  ['w', '주 전'],
  ['m', '개월 전'],
]

export function alarmMode(alarm) {
  if (!alarm) return '0'
  const hit = ALARM_PRESETS.find(([, , p]) => p.n === alarm.n && p.unit === alarm.unit)
  return hit ? hit[0] : 'custom'
}

export function alarmLabel(alarm) {
  if (!alarm) return ''
  const unit = { d: '일', w: '주', m: '개월' }[alarm.unit] || '일'
  return `${alarm.n}${unit} 전`
}

// 달을 빼면 그 날이 없는 달(31일 → 2월)은 말일로 당긴다
function shiftMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(y, m - 1 + n, 1)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, last))}`
}

// 알림이 시작되는 날 — 일정 날짜(base)에서 N일/주/개월 전
export function alarmStart(base, alarm) {
  const n = Math.max(1, Number(alarm.n) || 1)
  if (alarm.unit === 'm') return shiftMonths(base, -n)
  return addDays(base, -(alarm.unit === 'w' ? 7 * n : n))
}

// 몇 달 앞까지 내다봐야 이 알림을 놓치지 않나 — 아직 안 만든 루틴 회차를 훑을 때 쓴다
export function alarmSpanMonths(alarm) {
  const n = Math.max(1, Number(alarm.n) || 1)
  if (alarm.unit === 'm') return n
  return Math.ceil((alarm.unit === 'w' ? 7 * n : n) / 28)
}

// 알림 칩이 뜨는 날들.
//  · 체크했으면 체크한 날(알림 시작 전에 미리 체크했으면 시작일)에 흐린 칩 하나
//  · 그날만: 시작일에 하나. 체크 안 하고 날이 지나면 오늘로 따라온다
//  · 매일: 시작일(지났으면 오늘)부터 일정 날까지 매일
export function alarmDays({ base, alarm, checkedAt, today }) {
  const start = alarmStart(base, alarm)
  if (checkedAt) return [{ date: checkedAt > start ? checkedAt : start, done: true }]
  const from = start < today ? today : start
  if (!alarm.daily) return [{ date: from, done: false }]
  const to = base < from ? from : base
  const days = []
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push({ date: d, done: false })
  return days
}

// 시간 "14:05" → 달력·요약에 그대로 쓴다. 시작 시간만 있으면 그것, 둘 다면 "14:05~15:00"
export function timeText(memo) {
  if (!memo.time && !memo.endTime) return ''
  if (memo.time && memo.endTime) return `${memo.time}~${memo.endTime}`
  return memo.time || `~${memo.endTime}`
}
