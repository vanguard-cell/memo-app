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
  if (m.keep) return 'keep'
  // stage = 보드에서 직접 정한 상태. 자동 판정은 체크 기준 —
  // 줄만 적어둔 건(계획) 할일, 체크가 하나라도 되면(착수) 진행중.
  if (m.stage === 'todo' || m.stage === 'active') return m.stage
  return (m.history || []).some((h) => h.done) ? 'active' : 'todo'
}

export const STATUS_LABEL = { done: '완료', active: '진행중', todo: '할일', keep: '보관' }

