#!/usr/bin/env node
// 거시경제 일정 수집기 — public/macro.json을 만든다 (2026-10-12).
//
// 왜 이렇게 하나: 앱은 서버가 없는 정적 사이트(GitHub Pages)라 브라우저에서 외부 기관
// 사이트를 직접 부르면 CORS에 막힌다. 그래서 **GitHub Actions가 대신 읽어** 같은 주소에
// macro.json으로 놓아두고, 앱은 그 파일 하나만 읽는다. API 키도 유료 서비스도 없다.
//
// 출처는 전부 발표 기관 **공식 일정 페이지**다. 한 곳이 막히거나 모양이 바뀌어도
// 그 출처만 건너뛰고 **기존 macro.json의 그 출처 항목을 그대로 유지**한다 —
// 달력이 통째로 비는 일이 없게. (실패는 경고로만 남기고 0으로 끝낸다)
//
// 시각은 전부 **한국시간**으로 바꿔 둔다. 미국 서머타임(3월 둘째 일요일~11월 첫째
// 일요일)에 따라 한국시간이 한 시간씩 달라지고, FOMC 성명(미 동부 14:00)은
// 한국 날짜로 **다음날 새벽**이 된다 — 그걸 여기서 계산해 날짜까지 옮겨 적는다.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'macro.json')
const UA = 'Mozilla/5.0 (memo-app macro calendar)'
const YEARS = [new Date().getFullYear(), new Date().getFullYear() + 1]

const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

// ⚠️ Node의 fetch 대신 curl을 쓴다 — 국가데이터처(mods.go.kr)가 **HTTP/2로 붙으면
// 연결을 끊어서** 그 출처만 1.1로 붙어야 하는데, Node fetch로는 버전을 못 고른다.
// (2026-10-12 실제로 겪은 것)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 막히면 **쉬었다 다시** — 노동통계국은 짧은 사이에 거푸 두드리면 403을 준다.
// 곧바로 재시도하면 더 오래 막히므로 몇 초 쉬고 간다. (2026-10-12)
async function get(url, opts = {}) {
  let last
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(8000 * i)
    try {
      return await once(url, opts)
    } catch (e) {
      last = e
    }
  }
  throw last
}

async function once(url, { http1 = false } = {}) {
  const args = [
    '-sS', '--compressed', '--max-time', '40',
    '-A', UA,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: ko,en-US;q=0.9,en;q=0.8',
    '-w', '\n@@HTTP:%{http_code}',
  ]
  if (http1) args.push('--http1.1')
  args.push(url)
  const { stdout } = await run('curl', args, { maxBuffer: 32 * 1024 * 1024 })
  const cut = stdout.lastIndexOf('\n@@HTTP:')
  const code = Number(stdout.slice(cut + 8).trim())
  if (code !== 200) throw new Error(`HTTP ${code} ${url}`)
  return stdout.slice(0, cut)
}

// ---------- 미국 동부 → 한국 시간 ----------
// 서머타임: 3월 둘째 일요일 02:00 ~ 11월 첫째 일요일 02:00 (미 동부)
function nthWeekday(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7
}
function isEdt(date) {
  const [y, m, d] = date.split('-').map(Number)
  const start = ymd(y, 3, nthWeekday(y, 3, 0, 2))
  const end = ymd(y, 11, nthWeekday(y, 11, 0, 1))
  return date >= start && date < end
}
// 미 동부 날짜·시각(HH:MM) → 한국 날짜·시각. 서머타임이면 +13, 아니면 +14시간.
function toKst(date, time) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d, hh + (isEdt(date) ? 13 : 14), mm))
  return {
    date: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  }
}
const MON = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const monNo = (s) => MON[String(s).slice(0, 3).toLowerCase()]
const KMON = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
// "08:30 AM" → "08:30"
const hhmm = (s) => {
  const g = /(\d{1,2}):(\d{2})\s*([AP])M/i.exec(s || '')
  if (!g) return '08:30'
  let h = Number(g[1]) % 12
  if (g[3].toUpperCase() === 'P') h += 12
  return `${pad(h)}:${g[2]}`
}

// ---------- 출처 ① 미국 노동통계국(BLS) — CPI·PPI·고용보고서 ----------
// **그 해 전체 일정표**(schedule/{연도}/home.htm) 한 장에서 셋을 다 꺼낸다.
// 지표별 페이지(news_release/cpi.htm)는 같은 주소를 자주 두드리면 403으로 막히고
// 다음 14회분만 보여준다 — 연간 표는 막히지 않고 한 해치가 통째로 있다. (2026-10-12)
const BLS_WANT = {
  'Consumer Price Index': '미 CPI',
  'Producer Price Index': '미 PPI',
  'Employment Situation': '미 고용보고서', // "Employment Situation of Veterans"는 이름이 달라 안 걸린다
}
async function bls() {
  const out = []
  for (const year of YEARS) {
    let html
    if (out.length) await sleep(4000) // 한 장 받고 숨 돌리기
    try {
      html = await get(`https://www.bls.gov/schedule/${year}/home.htm`)
    } catch (e) {
      if (year === YEARS[0]) throw e // 올해 표를 못 읽으면 실패로 본다
      continue // 내년 표는 아직 안 올라왔을 수 있다
    }
    const re =
      /<td class="date-cell"><p>[A-Za-z]+,\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})<\/p><\/td>\s*<td class="time-cell"><p>([^<]*)<\/p><\/td>\s*<td class="desc-cell"><p><strong>([^<]+)<\/strong>([^<]*)/g
    for (const m of html.matchAll(re)) {
      const label = BLS_WANT[m[5].trim()]
      if (!label) continue
      const date = ymd(Number(m[3]), monNo(m[1]), Number(m[2]))
      const ref = /for\s+([A-Za-z]+)\s+(\d{4})/.exec(m[6] || '')
      const k = toKst(date, hhmm(m[4]))
      out.push({
        id: `${m[5].trim().split(' ')[0].toLowerCase()}-${ref ? `${ref[2]}-${pad(monNo(ref[1]))}` : date}`,
        ...k,
        title: `${label}${ref ? ` (${KMON[monNo(ref[1])]})` : ''}`,
        kind: 'us',
        src: 'BLS',
      })
    }
  }
  if (!out.length) throw new Error('BLS 연간 일정표를 못 읽음')
  return out
}

// ---------- 출처 ② 연준 — FOMC 회의·성명·의사록 ----------
// 해마다 패널이 있고, 회의 한 건이 "월 / 날짜(27-28, *면 점도표)" 한 줄이다.
// 성명·기자회견은 **마지막 날 14:00(미 동부)**, 의사록은 "(Released February 18, 2026)".
async function fomc() {
  const html = await get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
  const out = []
  const panels = [...html.matchAll(/>(\d{4}) FOMC Meetings<\/a>([\s\S]*?)(?=>\d{4} FOMC Meetings<\/a>|$)/g)]
  for (const [, yearStr, body] of panels) {
    const year = Number(yearStr)
    if (!YEARS.includes(year)) continue
    // ⚠️ 줄을 "fomc-meeting__month"로 가른다 — 한 줄 걸러 class가
    // "fomc-meeting--shaded row fomc-meeting"이라 'class="row fomc-meeting"'으로 가르면
    // 회색 줄(= 절반)이 통째로 빠진다 (2026-10-12 12월 회의가 사라져서 찾았다)
    const blocks = body.split('fomc-meeting__month').slice(1)
    for (const b of blocks) {
      const mm = /^[^>]*>(?:<strong>)?([A-Za-z/\s]+?)(?:<\/strong>)?<\/div>/.exec(b)
      const dd = /fomc-meeting__date[^>]*>([^<]+)<\/div>/.exec(b)
      if (!mm || !dd) continue
      const months = mm[1].trim().split('/').map(monNo).filter(Boolean)
      const raw = dd[1].trim()
      const sep = raw.includes('*') // 점도표(경제전망) 있는 회의
      const days = raw.replace(/[^0-9-]/g, '').split('-').filter(Boolean).map(Number)
      if (!months.length || !days.length) continue
      const d1 = days[0]
      const d2 = days.length > 1 ? days[days.length - 1] : days[0]
      const m1 = months[0]
      const m2 = months.length > 1 ? months[1] : months[0]
      // 12월에 시작해 1월에 끝나는 회의는 없지만, 달이 넘어가면 연도도 같이 넘긴다
      const y2 = m2 < m1 ? year + 1 : year
      const start = ymd(year, m1, d1)
      const end = ymd(y2, m2, d2)
      if (start !== end) {
        out.push({ id: `fomc1-${start}`, date: start, title: 'FOMC 1일차', kind: 'fed', src: '연준' })
      }
      // 성명·기자회견 = 마지막 날 미 동부 14:00 → 한국은 다음날 새벽
      out.push({
        id: `fomc-${end}`,
        ...toKst(end, '14:00'),
        title: sep ? 'FOMC 결과·점도표' : 'FOMC 결과·기자회견',
        note: `현지 ${end} 회의 종료`,
        kind: 'fed',
        src: '연준',
      })
      const rel = /\(Released\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\)/.exec(b)
      if (rel) {
        const mdate = ymd(Number(rel[3]), monNo(rel[1]), Number(rel[2]))
        out.push({
          id: `fomcmin-${mdate}`,
          ...toKst(mdate, '14:00'),
          title: 'FOMC 의사록',
          note: `${start} 회의분`,
          kind: 'fed',
          src: '연준',
        })
      }
    }
  }
  if (!out.length) throw new Error('FOMC 일정을 못 읽음')
  return out
}

// ---------- 출처 ③ 미국 경제분석국(BEA) — PCE ----------
// 표에 연도가 없다(두세 달치만 올라온다) — 지금 달보다 앞선 달이면 내년으로 본다.
async function bea() {
  const html = await get('https://www.bea.gov/news/schedule')
  const now = new Date()
  const out = []
  const re =
    /<div class="release-date">([A-Za-z]+)\s+(\d{1,2})<\/div>\s*<small[^>]*>([^<]*)<\/small>[\s\S]{0,900}?class="release-title[^"]*"[^>]*>([^<]+)</g
  for (const m of html.matchAll(re)) {
    const title = m[4].trim()
    if (!/^Personal Income and Outlays/i.test(title)) continue
    const mo = monNo(m[1])
    const year = mo < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear()
    const date = ymd(year, mo, Number(m[2]))
    const ref = /,\s*([A-Za-z]+)\s+\d{4}/.exec(title)
    const k = toKst(date, hhmm(m[3]))
    out.push({
      id: `pce-${date}`,
      ...k,
      title: `미 PCE물가·개인소비${ref ? ` (${KMON[monNo(ref[1])]})` : ''}`,
      kind: 'us',
      src: 'BEA',
    })
  }
  if (!out.length) throw new Error('BEA에서 PCE 일정을 못 읽음')
  return out
}

// ---------- 출처 ④ 한국은행 — 금융통화위원회 ----------
// 해마다 "01월 15일" 모양으로 여덟 번. 내년 일정은 보통 그해 가을에 올라온다.
// 2·5·8·11월 회의날에는 수정 경제전망이 같이 나온다.
async function bok() {
  const out = []
  for (const year of YEARS) {
    let html
    try {
      html = await get(
        `https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755&pYear=${year}`,
        { http1: true }
      )
    } catch {
      continue
    }
    const body = html.slice(html.indexOf('통화정책방향 결정회의'))
    for (const m of body.matchAll(/(\d{2})월\s*(\d{1,2})일/g)) {
      const mo = Number(m[1])
      const date = ymd(year, mo, Number(m[2]))
      const 전망 = [2, 5, 8, 11].includes(mo)
      out.push({
        id: `bok-${date}`,
        date,
        time: '09:00',
        title: 전망 ? '한은 금통위·수정 경제전망' : '한은 금통위',
        kind: 'kr',
        src: '한국은행',
      })
    }
  }
  if (!out.length) throw new Error('한국은행 금통위 일정을 못 읽음')
  return out
}

// ---------- 출처 ⑤ 국가데이터처(옛 통계청) — 소비자물가 ----------
// 보도계획에서 oa_mm=ALL로 받으면 그 해 열두 달이 한 번에 온다.
// ⚠️ 이 서버는 HTTP/2로 붙으면 연결을 끊는다 — Node fetch는 HTTP/1.1이라 괜찮다.
async function kostat() {
  const out = []
  for (const year of YEARS) {
    let html
    try {
      // HTTP/2로 붙으면 이 서버가 연결을 끊는다 — 반드시 1.1로
      html = await get(`https://mods.go.kr/newsPln.es?mid=a10305000000&oa_yy=${year}&oa_mm=ALL`, { http1: true })
    } catch {
      continue
    }
    const re =
      /<tr class="tr-notice">\s*<td class="center"\s*>(\d{2})\.(\d{2})\.\(\s*.\s*\)<\/td>\s*<td class="center"\s*>([0-9:]+)<\/td>\s*<td>([^<]*)<\/td>/g
    for (const m of html.matchAll(re)) {
      const name = m[4].trim()
      if (!name.includes('소비자물가동향')) continue
      // ⚠️ 아직 안 나온 해를 물어보면 이 서버는 **올해 것을 그대로 돌려준다** —
      // 그대로 믿으면 내년 날짜에 올해 일정이 박힌다. 자료 이름의 연도로 걸러낸다.
      // (2026-10-12 oa_yy=2027로 물었더니 2026년 표가 왔다)
      if (!name.startsWith(`${year}년`)) continue
      const date = ymd(year, Number(m[1]), Number(m[2]))
      const ref = /(\d{1,2})월/.exec(name.replace(/^\d{4}년\s*/, ''))
      out.push({
        id: `krcpi-${date}`,
        date,
        time: m[3],
        title: `한국 소비자물가${ref ? ` (${ref[1]}월)` : ''}`,
        kind: 'kr',
        src: '국가데이터처',
      })
    }
  }
  if (!out.length) throw new Error('국가데이터처 소비자물가 일정을 못 읽음')
  return out
}

// ---------- 출처 ⑥ 계산으로 넣는 시장 일정 ----------
// 밖에서 받아올 게 없다 — 규칙이 정해져 있어 그대로 계산한다.
function market() {
  const out = []
  for (const y of YEARS) {
    // 쿼드러플 위칭 — 3·6·9·12월 셋째 금요일
    for (const m of [3, 6, 9, 12]) {
      const d = nthWeekday(y, m, 5, 3)
      out.push({ id: `witch-${ymd(y, m, d)}`, date: ymd(y, m, d), title: '쿼드러플 위칭', kind: 'mkt', src: '계산' })
    }
    // 미국 서머타임 — 이 날부터 미국 발표가 한국시간으로 한 시간씩 밀리거나 당겨진다
    const dstOn = ymd(y, 3, nthWeekday(y, 3, 0, 2))
    const dstOff = ymd(y, 11, nthWeekday(y, 11, 0, 1))
    out.push({ id: `dst-on-${y}`, date: dstOn, title: '미 서머타임 시작 — 발표 1시간 빨라짐', kind: 'mkt', src: '계산' })
    out.push({ id: `dst-off-${y}`, date: dstOff, title: '미 서머타임 해제 — 발표 1시간 늦어짐', kind: 'mkt', src: '계산' })
    for (const h of nyseHolidays(y)) out.push(h)
  }
  return out
}

// 미국 증시 휴장일 — 연방 공휴일 규칙 그대로. 토요일이면 전 금요일, 일요일이면 다음 월요일로
// 옮겨 쉰다. 성금요일(부활절 이틀 전)은 연방 공휴일이 아니지만 증시는 쉰다.
// 그 달의 마지막 해당 요일 (메모리얼 데이 = 5월 마지막 월요일)
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const w = new Date(Date.UTC(year, month - 1, last)).getUTCDay()
  return last - ((w - weekday + 7) % 7)
}

function observed(y, m, d) {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (w === 6) return ymd(y, m, d - 1)
  if (w === 0) return ymd(y, m, d + 1)
  return ymd(y, m, d)
}
function easter(y) {
  // 그레고리력 부활절 (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(y, month - 1, day))
}
function nyseHolidays(y) {
  const good = new Date(easter(y).getTime() - 2 * 86400000)
  const list = [
    ['신정', observed(y, 1, 1)],
    ['마틴 루터 킹 데이', ymd(y, 1, nthWeekday(y, 1, 1, 3))],
    ['대통령의 날', ymd(y, 2, nthWeekday(y, 2, 1, 3))],
    ['성금요일', ymd(good.getUTCFullYear(), good.getUTCMonth() + 1, good.getUTCDate())],
    ['메모리얼 데이', ymd(y, 5, lastWeekday(y, 5, 1))],
    ['준틴스', observed(y, 6, 19)],
    ['독립기념일', observed(y, 7, 4)],
    ['노동절', ymd(y, 9, nthWeekday(y, 9, 1, 1))],
    ['추수감사절', ymd(y, 11, nthWeekday(y, 11, 4, 4))],
    ['성탄절', observed(y, 12, 25)],
  ]
  const out = list.map(([name, date]) => ({
    id: `hol-${date}`,
    date,
    title: `미 증시 휴장 — ${name}`,
    kind: 'mkt',
    src: '계산',
  }))
  // 조기폐장(미 동부 13시) — 추수감사절 다음날, 성탄 전날이 평일일 때
  const tg = ymd(y, 11, nthWeekday(y, 11, 4, 4))
  const after = new Date(Date.UTC(Number(tg.slice(0, 4)), Number(tg.slice(5, 7)) - 1, Number(tg.slice(8, 10)) + 1))
  out.push({
    id: `half-${ymd(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate())}`,
    date: ymd(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate()),
    title: '미 증시 조기폐장 (추수감사절 다음날)',
    kind: 'mkt',
    src: '계산',
  })
  const eve = new Date(Date.UTC(y, 11, 24)).getUTCDay()
  if (eve >= 1 && eve <= 5) {
    out.push({ id: `half-${ymd(y, 12, 24)}`, date: ymd(y, 12, 24), title: '미 증시 조기폐장 (성탄 전날)', kind: 'mkt', src: '계산' })
  }
  return out
}

// ---------- 모으기 ----------
const SOURCES = [
  ['bls', bls],
  ['fomc', fomc],
  ['bea-pce', bea],
  ['bok', bok],
  ['kostat', kostat],
  ['market', async () => market()],
]

// 지난번 결과를 출처별로 되돌려 놓는다 — 한 곳이 막혀도 그 출처 일정은 그대로 남게.
// 일정마다 어느 출처에서 왔는지(g)를 적어 두므로 파일에 목록을 두 벌 들고 있을 필요가 없다.
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { events: [] }
const groups = {}
for (const e of prev.events || []) {
  if (!e.g) continue
  ;(groups[e.g] = groups[e.g] || []).push(e)
}
const warns = []

for (const [key, fn] of SOURCES) {
  try {
    const list = (await fn()).map((e) => ({ ...e, g: key }))
    groups[key] = list
    console.log(`✓ ${key} — ${list.length}건`)
  } catch (e) {
    warns.push(`${key}: ${e.message}`)
    console.warn(`✗ ${key} — ${e.message} (지난번 ${(groups[key] || []).length}건 그대로 둠)`)
  }
}

const events = Object.values(groups)
  .flat()
  .filter((e) => e && e.date)
  .sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date)))

// 같은 id가 두 번 들어오면 뒤엣것으로
const byId = new Map(events.map((e) => [e.id, e]))
const out = {
  generatedAt: new Date().toISOString(),
  warns,
  events: [...byId.values()],
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(`\n→ ${OUT} · 일정 ${out.events.length}건${warns.length ? ` · 경고 ${warns.length}건` : ''}`)
