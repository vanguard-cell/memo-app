import { todayStr, parse } from './parser'

const KEY = 'hds-memo-data-v1'

function migrate(memos) {
  return memos.map((raw) => {
    const m = {
      ...raw,
      history: (raw.history || []).filter(
        (h) => h.type !== 'log' && h.text !== '완료 처리' && h.text !== '다시 열음'
      ),
    }
    delete m.category
    const p = parse(m.title)
    if (!m.period && p.period) {
      m.period = p.period
      if (m.due === p.period.start) m.due = null
    }
    if ((m.due || m.period) && p.cleaned && p.cleaned !== m.title) {
      m.title = p.cleaned
    }
    return m
  })
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (Array.isArray(data.memos)) {
        return { memos: migrate(data.memos), dayOrder: data.dayOrder || {} }
      }
    }
  } catch (e) {
    console.error('저장 데이터를 읽지 못했습니다', e)
  }
  return { memos: [], dayOrder: {} }
}

let state = load()
const listeners = new Set()

function commit(next) {
  state = next
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach((fn) => fn())
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getMemos = () => state.memos
export const getDayOrder = () => state.dayOrder

export function setDayOrder(date, ids) {
  commit({ ...state, dayOrder: { ...state.dayOrder, [date]: ids } })
}

export function addMemo({ title, company, due, period }) {
  const now = new Date().toISOString()
  const memo = {
    id: crypto.randomUUID(),
    title,
    company: company || null,
    status: 'open',
    due: due || null,
    period: period || null,
    history: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    snoozeUntil: null,
  }
  commit({ ...state, memos: [memo, ...state.memos] })
  return memo
}

export function updateMemo(id, patch) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)),
  })
}

export function addHistory(id, text, date) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id
        ? {
            ...m,
            history: [...m.history, { date: date || todayStr(), text, ts: Date.now(), done: false }],
            updatedAt: now,
          }
        : m
    ),
  })
}

export function toggleHistory(id, index) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id
        ? {
            ...m,
            history: m.history.map((h, i) => (i === index ? { ...h, done: !h.done } : h)),
            updatedAt: now,
          }
        : m
    ),
  })
}

export function completeMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, status: 'done', completedAt: now, updatedAt: now } : m
    ),
  })
}

export function reopenMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, status: 'open', completedAt: null, updatedAt: now } : m
    ),
  })
}

export function deleteMemo(id) {
  commit({ ...state, memos: state.memos.filter((m) => m.id !== id) })
}
