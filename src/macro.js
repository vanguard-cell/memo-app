// 거시경제 일정 (CPI·PPI·고용·PCE·FOMC·금통위·한국 소비자물가·시장 일정) — 2026-10-12.
//
// ⭐ **메모를 만들지 않는다.** 이건 "내가 처리할 일"이 아니라 "그날 있는 일"이라,
// 달력에만 그려지는 **읽기 전용 참고 일정**이다. 메모로 만들면 보드 '할일'에 쌓이고,
// 안 끝내면 괴롭히고, 휴지통·동기화·백업까지 따라다닌다 — 전부 바라지 않는 것이다.
// (2026-10-12 사용자: "참고 일정 — 달력에만")
//
// 자료는 public/macro.json 한 장이고, 그건 GitHub Actions가 매주 발표 기관 공식
// 일정 페이지를 읽어 갱신한다(scripts/fetch-macro.mjs). 앱은 같은 주소의 그 파일만
// 읽으므로 CORS도, API 키도, 서버도 필요 없다.

const KEY = 'hds-macro-v1'

let data = null
let started = false
const listeners = new Set()

// 지난번에 받아둔 것 — 비행기모드·사내망 차단·파일 못 받는 상황에서도 달력이 안 빈다
function fromCache() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* 사파리 프라이빗 등 — 캐시 없이 간다 */
  }
  return null
}

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribeMacro(fn) {
  listeners.add(fn)
  start()
  return () => listeners.delete(fn)
}

export function getMacro() {
  if (!data) data = fromCache() || { events: [] }
  return data
}

// 앱을 열 때 한 번만 받아온다 (실패하면 캐시 그대로)
function start() {
  if (started) return
  started = true
  data = fromCache() || { events: [] }
  const url = `${import.meta.env.BASE_URL || './'}macro.json?v=${Math.floor(Date.now() / 36e5)}`
  fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((json) => {
      if (!json || !Array.isArray(json.events)) return
      data = json
      try {
        localStorage.setItem(KEY, JSON.stringify({ generatedAt: json.generatedAt, events: json.events }))
      } catch {
        /* 용량이 찼으면 캐시는 포기 — 화면엔 이미 떠 있다 */
      }
      notify()
    })
    .catch(() => {
      /* 조용히 — 참고 일정이 없다고 앱이 시끄러울 이유가 없다 */
    })
}

// 날짜별로 묶어 돌려준다 — 달력이 칸마다 꺼내 쓴다
export function macroByDate(from, to) {
  const map = {}
  for (const e of getMacro().events || []) {
    if (!e.date || e.date < from || e.date > to) continue
    ;(map[e.date] = map[e.date] || []).push(e)
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  }
  return map
}
