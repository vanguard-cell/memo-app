const pad = (n) => String(n).padStart(2, '0')

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return todayStr(new Date(y, m - 1, d + n))
}

function normYear(y) {
  const n = Number(y)
  return n < 100 ? 2000 + n : n
}

function toISO(y, m, d) {
  const yy = normYear(y)
  const mm = Number(m)
  const dd = Number(d)
  const dt = new Date(yy, mm - 1, dd)
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null
  return todayStr(dt)
}

const RANGE_RE = /(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})\s*[~〜∼-]\s*(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/
const SHORT_RANGE_RE = /(?<!\d)(\d{1,2})[./](\d{1,2})\s*[~〜∼-]\s*(\d{1,2})[./](\d{1,2})(?!\d)/
const FULL_RE = /(?<!\d)(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/
const KOR_RE = /(\d{1,2})월\s*(\d{1,2})일/
const SHORT_RE = /(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/
const KEYWORDS = [
  ['오늘', 0],
  ['내일', 1],
  ['모레', 2],
  ['다음주', 7],
  ['다음 주', 7],
]

export function parse(text, knownCompanies = []) {
  const result = { due: null, period: null, company: null }
  if (!text || !text.trim()) return result
  let rest = text

  const range = RANGE_RE.exec(rest)
  if (range) {
    const start = toISO(range[1], range[2], range[3])
    const end = toISO(range[4], range[5], range[6])
    if (start && end) {
      result.period = { start, end }
      rest = rest.replace(range[0], ' ')
    }
  }

  if (!result.period) {
    const sr = SHORT_RANGE_RE.exec(rest)
    if (sr) {
      const y = new Date().getFullYear()
      const start = toISO(y, sr[1], sr[2])
      let end = toISO(y, sr[3], sr[4])
      if (start && end && end < start) end = toISO(y + 1, sr[3], sr[4])
      if (start && end) {
        result.period = { start, end }
        rest = rest.replace(sr[0], ' ')
      }
    }
  }

  if (!result.period) {
    const now = new Date()
    let m = FULL_RE.exec(rest)
    if (m) {
      const iso = toISO(m[1], m[2], m[3])
      if (iso) {
        result.due = iso
        rest = rest.replace(m[0], ' ')
      }
    }
    if (!result.due) {
      m = KOR_RE.exec(rest)
      if (m) {
        const iso = toISO(now.getFullYear(), m[1], m[2])
        if (iso) {
          result.due = iso
          rest = rest.replace(m[0], ' ')
        }
      }
    }
    if (!result.due) {
      m = SHORT_RE.exec(rest)
      if (m) {
        const iso = toISO(now.getFullYear(), m[1], m[2])
        if (iso) {
          result.due = iso
          rest = rest.replace(m[0], ' ')
        }
      }
    }
    if (!result.due) {
      for (const [word, days] of KEYWORDS) {
        if (rest.includes(word)) {
          result.due = addDays(todayStr(), days)
          break
        }
      }
    }
  }

  const co = /([A-Za-z0-9가-힣]+업체)/.exec(text)
  if (co) result.company = co[1]
  if (!result.company) {
    const sorted = [...knownCompanies].sort((a, b) => b.length - a.length)
    for (const name of sorted) {
      if (name && text.includes(name)) {
        result.company = name
        break
      }
    }
  }

  result.cleaned = rest
    .replace(/\s+/g, ' ')
    .replace(/^[\s,·~-]+|[\s,·~-]+$/g, '')
  return result
}
