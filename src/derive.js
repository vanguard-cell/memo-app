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

// 기한 배지: 며칠 밀림(빨강) / 오늘(주황) / D-n(은은한 파랑 하나).
// 날짜별 색 그라데이션은 2026-07-30 제거 — 보드가 알록달록해지는 주범이었다 (스티치 시안 톤).
// (마감형 "7.30까지" 배지는 마감 기능과 함께 2026-09-15 없앴다)
// 며칠 남았나를 셀 때 기준이 되는 날. 아직 시작 안 한 기간은 **시작하는 날**까지 센다 —
// "기간의 시작은 예정에 흡수"라는 앱의 날짜 규칙(2026-08-03) 그대로다. 예전엔 늘 끝나는
// 날만 세서, 내일 시작하는 3일짜리 교육이 보드에서 D-3으로 뜨고 D-3 무리 사이에 파묻혔다.
// (2026-08-22 사용자: "내일 시작이고 3일뒤 마감인데 보드에서는 D-3으로 나오네")
export const dueAnchor = (m, today) => {
  if (m.due) return m.due
  if (!m.period) return null
  return today < m.period.start ? m.period.start : m.period.end
}

// 이미 시작해서 지금 굴러가는 기간인가 — 이때는 배지가 끝나는 날을 세므로 "마감"을 붙여
// 구분한다. 안 그러면 오늘 D-1(시작)이던 게 내일 D-2(마감)로 늘어나 보여 헷갈린다.
const inPeriod = (m, today) =>
  !m.due && !!m.period && today >= m.period.start

export function dueBadge(m, today) {
  if (m.status === 'done' || m.keep) return null
  const at = dueAnchor(m, today)
  if (!at) return null
  const dd = diffDays(at, today)
  const rp = m.repeat ? '↻ ' : '' // 반복 메모 표시 — 완료하면 다음 주기로 굴러감 (2026-07-31)
  const run = inPeriod(m, today)
  if (dd < 0) return ['b-red', rp + `${-dd}일째`]
  if (dd === 0) return ['b-amber', rp + (run ? '마감 오늘' : '오늘')]
  return ['b-blue', rp + (run ? `마감 D-${dd}` : `D-${dd}`)]
}
