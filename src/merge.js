// 두 기기에서 같은 메모를 따로 고쳤을 때 합치기 (2026-11-12)
//
// 예전엔 나중에 저장한 쪽이 메모를 통째로 덮었다 — 회사 PC에 앱을 띄워 둔 채 폰으로 진행 기록을
// 쓰고, PC에서 같은 메모를 고치면 PC의 옛 사본이 폰에서 쓴 줄을 지웠다.
//
// 세 가지를 견준다:
//   base   = 둘이 갈라지기 전 (이 기기가 서버에서 마지막으로 본 것)
//   mine   = 이 기기의 지금 것
//   theirs = 서버의 지금 것 (다른 기기가 고친 것)
// 칸마다 — 내가 안 바꾼 칸은 서버 것을, 내가 바꾼 칸은 내 것을 쓴다.
// 진행 기록·파일은 줄 단위로 — 어느 한쪽이 새로 쓴 줄은 둘 다 살리고, 어느 한쪽이 지운 줄은 지운다.
// 같은 줄을 양쪽이 고쳤으면 그 줄 안에서도 칸마다 같은 규칙(한쪽은 체크, 한쪽은 글 고침 → 둘 다 남는다).
// 이 파일은 store에 기대지 않는다 — 따로 시험할 수 있게.

// 칸 순서가 달라도 같은 값으로 본다 (서버(jsonb)는 칸 순서를 제멋대로 바꿔 돌려준다). 없음·null도 같게.
function canon(v) {
  return JSON.stringify(v ?? null, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
      : x
  )
}
const same = (a, b) => canon(a) === canon(b)

// 줄마다 이름표 — 진행 기록은 쓴 순간(ts), 파일은 저장 경로. ts가 없는 옛 줄은 날짜+글로.
// 똑같은 이름표가 여러 줄이면 몇 번째인지까지 붙여 따로 센다.
const LIST_KEY = {
  history: (h) => (h && h.ts != null ? `t${h.ts}` : `x${h && h.date}|${h && h.text}`),
  files: (f) => `p${f && f.path}`,
}

function keyed(list, keyOf) {
  const seenN = new Map()
  const out = new Map()
  for (const x of Array.isArray(list) ? list : []) {
    const k = keyOf(x)
    const n = seenN.get(k) || 0
    seenN.set(k, n + 1)
    out.set(n ? `${k}#${n}` : k, x)
  }
  return out
}

function mergeFields(base, mine, theirs) {
  const b = base || {}
  const out = {}
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const v = LIST_KEY[k] ? mergeList(b[k], mine[k], theirs[k], LIST_KEY[k]) : same(mine[k], b[k]) ? theirs[k] : mine[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

function mergeList(base, mine, theirs, keyOf) {
  // 셋 다 목록이 아니면 보통 칸처럼
  if (!Array.isArray(mine) && !Array.isArray(theirs)) return same(mine, base) ? theirs : mine
  const B = keyed(base, keyOf)
  const M = keyed(mine, keyOf)
  const T = keyed(theirs, keyOf)
  const out = []
  // 내 순서대로 — 서버에서 지운 줄은 빼고, 서버에서 고친 줄은 고친 대로
  for (const [k, m] of M) {
    const b = B.get(k)
    const t = T.get(k)
    if (b && !t) continue // 다른 기기가 지웠다
    if (!b && !t) {
      out.push(m) // 내가 새로 썼다
      continue
    }
    out.push(b ? mergeLine(b, m, t) : m)
  }
  // 다른 기기가 새로 쓴 줄은 뒤에
  for (const [k, t] of T) if (!M.has(k) && !B.has(k)) out.push(t)
  return out
}

const mergeLine = (b, m, t) =>
  m && t && typeof m === 'object' && typeof t === 'object' ? mergeFields(b, m, t) : same(m, b) ? t : m

// 합친 것의 고친 시각 — 두 쪽 어느 것보다도 늦어야 한다(그래야 다른 기기가 이걸 새것으로 받는다).
// 기기 시계가 서로 조금 달라도 앞서도록 둘 중 늦은 것보다 최소 1ms 뒤로.
function stampAfter(a, b) {
  const t = Math.max(Date.now(), (Date.parse(a) || 0) + 1, (Date.parse(b) || 0) + 1)
  return new Date(t).toISOString()
}

export function merge3(base, mine, theirs) {
  return { ...mergeFields(base, mine, theirs), updatedAt: stampAfter(mine.updatedAt, theirs.updatedAt) }
}
