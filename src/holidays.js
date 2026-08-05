// 한국 공휴일 — 달력 칸에 이름을 띄우고 날짜를 빨갛게 칠하는 데 쓴다.
//
// 외부 API(공공데이터포털 특일정보)를 안 쓰는 이유: 이 앱은 정적 배포(GitHub Pages) +
// 오프라인에서도 켜지는 도구라 키를 둘 데가 없고, 달력을 넘길 때마다 네트워크를 타면 안 된다.
// 대신 음력 명절(설날·추석·부처님오신날)의 양력 날짜만 표로 박고, 나머지는 규칙으로 계산한다.
//
// ⚠️ 해가 지나면 두 군데를 손봐야 한다: 아래 LUNAR 표(음력 명절)와 EXTRA(선거일·임시공휴일).

import { addDays } from './parser'

// 음력 명절의 양력 날짜. seol/chuseok은 "연휴 가운데 날"(설날 당일·추석 당일).
const LUNAR = {
  2020: { seol: '01-25', chuseok: '10-01', buddha: '04-30' },
  2021: { seol: '02-12', chuseok: '09-21', buddha: '05-19' },
  2022: { seol: '02-01', chuseok: '09-10', buddha: '05-08' },
  2023: { seol: '01-22', chuseok: '09-29', buddha: '05-27' },
  2024: { seol: '02-10', chuseok: '09-17', buddha: '05-15' },
  2025: { seol: '01-29', chuseok: '10-06', buddha: '05-05' },
  2026: { seol: '02-17', chuseok: '09-25', buddha: '05-24' },
  2027: { seol: '02-06', chuseok: '09-15', buddha: '05-13' },
  2028: { seol: '01-26', chuseok: '10-03', buddha: '05-02' },
  2029: { seol: '02-13', chuseok: '09-22', buddha: '05-20' },
  2030: { seol: '02-03', chuseok: '09-12', buddha: '05-09' },
}

// 양력 고정 공휴일. 세 번째 값은 "대체공휴일이 적용되기 시작한 해"(0이면 대체 없음) —
// 법이 단계적으로 늘어나서, 지난 달력을 넘겨봐도 그때 실제와 맞게 나오라고 연도를 같이 둔다.
// (2014~ 어린이날 / 2021~ 삼일절·광복절·개천절·한글날 / 2023~ 부처님오신날·성탄절)
const FIXED = [
  ['01-01', '신정', 0],
  ['03-01', '삼일절', 2021],
  ['05-05', '어린이날', 2014],
  ['06-06', '현충일', 0],
  ['08-15', '광복절', 2021],
  ['10-03', '개천절', 2021],
  ['10-09', '한글날', 2021],
  ['12-25', '성탄절', 2023],
]

// 규칙이 없어 그때그때 공고되는 날 — 선거일·임시공휴일. 새로 생기면 여기에 한 줄 추가.
const EXTRA = {
  '2020-04-15': '국회의원선거',
  '2020-08-17': '임시공휴일',
  '2022-03-09': '대통령선거',
  '2022-06-01': '지방선거',
  '2023-10-02': '임시공휴일',
  '2024-04-10': '국회의원선거',
  '2024-10-01': '국군의 날',
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령선거',
  '2026-06-03': '지방선거',
}

const dow = (d) => new Date(d + 'T00:00').getDay()

// 한 해치 공휴일 계산: 날짜 → { name, sub }. sub=true면 대체공휴일.
function build(year) {
  const names = {} // 날짜 → 이름 배열 (어린이날과 부처님오신날이 겹치는 해가 있다)
  const put = (date, name) => {
    ;(names[date] = names[date] || []).push(name)
  }

  const L = LUNAR[year]
  const runs = [] // 설·추석 연휴 (3일 묶음)
  const runDays = new Set()
  if (L) {
    for (const [key, name] of [['seol', '설날'], ['chuseok', '추석']]) {
      const mid = `${year}-${L[key]}`
      const days = [addDays(mid, -1), mid, addDays(mid, 1)]
      runs.push({ days, name })
      days.forEach((d, i) => {
        put(d, i === 1 ? name : `${name} 연휴`)
        runDays.add(d)
      })
    }
  }

  const singles = FIXED.map(([md, name, subFrom]) => ({ date: `${year}-${md}`, name, subFrom }))
  if (L) singles.push({ date: `${year}-${L.buddha}`, name: '부처님오신날', subFrom: 2023 })
  for (const s of singles) put(s.date, s.name)
  for (const [date, name] of Object.entries(EXTRA)) {
    if (date.startsWith(year + '-')) put(date, name)
  }

  // 대체공휴일: "그 공휴일 다음의 첫 번째 비공휴일". 일요일은 그 자체가 공휴일이고,
  // 토요일은 법으로는 공휴일이 아니지만 대체일로 지정된 적이 없어 같이 건너뛴다.
  const isHol = (d) => !!names[d] || dow(d) === 0
  const nextFree = (d) => {
    let x = addDays(d, 1)
    while (isHol(x) || dow(x) === 6) x = addDays(x, 1)
    return x
  }
  const subs = {} // 대체공휴일 날짜 → 원래 공휴일 이름

  // ① 설·추석 연휴: 일요일이나 다른 공휴일과 겹치면 연휴 다음 첫 비공휴일 하루.
  //    (토요일과 겹치는 건 대체 대상이 아니다 — 연휴는 명절만 예외 규정이 다르다)
  for (const r of runs) {
    const clash = r.days.some((d) => dow(d) === 0 || names[d].length > 1)
    if (!clash) continue
    const t = nextFree(r.days[2])
    put(t, '대체공휴일')
    subs[t] = r.name
  }

  // ② 나머지: 토·일이나 다른 공휴일과 겹치면 대체. 한 날짜에 여러 공휴일이 겹쳐도
  //    대체는 하루만 붙는다 (2025년 어린이날+부처님오신날이 같은 날이었던 경우).
  const done = new Set()
  for (const s of [...singles].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!s.subFrom || year < s.subFrom) continue
    if (done.has(s.date) || runDays.has(s.date)) continue // 연휴 안에 든 건 ①이 이미 처리
    const w = dow(s.date)
    if (!(w === 0 || w === 6 || names[s.date].length > 1)) continue
    done.add(s.date)
    const t = nextFree(s.date)
    put(t, '대체공휴일')
    subs[t] = names[s.date].filter((n) => n !== '대체공휴일').join('·')
  }

  const out = {}
  for (const [date, list] of Object.entries(names)) {
    // 겹친 날은 이름을 다 보여준다 (예: "어린이날·부처님오신날")
    out[date] = { name: [...new Set(list)].join('·'), sub: !!subs[date], origin: subs[date] || '' }
  }
  return out
}

const cache = {}

// 그 날짜의 공휴일 정보 — 공휴일이 아니면 null.
// { name: '광복절', sub: false } / { name: '대체공휴일', sub: true, origin: '추석' }
export function holiday(date) {
  if (!date) return null
  const y = Number(date.slice(0, 4))
  if (!cache[y]) cache[y] = build(y)
  return cache[y][date] || null
}

// 이름 하나로 — 대체공휴일은 무엇의 대체인지 붙여서 (툴팁·날짜 제목용)
export function holidayLabel(date) {
  const h = holiday(date)
  if (!h) return ''
  return h.sub && h.origin ? `${h.origin} 대체공휴일` : h.name
}
