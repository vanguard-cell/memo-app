import { todayStr, parse } from './parser'
import { supabase, hasSupabase } from './supabase'

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
        return {
          memos: migrate(data.memos),
          works: Array.isArray(data.works) ? data.works : [],
          dayOrder: data.dayOrder || {},
        }
      }
    }
  } catch (e) {
    console.error('저장 데이터를 읽지 못했습니다', e)
  }
  return { memos: [], works: [], dayOrder: {} }
}

let state = load()
let session = null
const listeners = new Set()

let authSnap = { ready: !hasSupabase, loggedIn: false, email: null, syncError: false }

function notify() {
  listeners.forEach((fn) => fn())
}

function setAuth(patch) {
  authSnap = { ...authSnap, ...patch }
  notify()
}

function commit(next) {
  state = next
  localStorage.setItem(KEY, JSON.stringify(state))
  notify()
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getMemos = () => state.memos
export const getWorks = () => state.works
export const getDayOrder = () => state.dayOrder
export const getAuth = () => authSnap

// ---------- 서버 동기화 ----------

async function pushMemoRows(memos) {
  const rows = memos.map((m) => ({ id: m.id, data: m, updated_at: m.updatedAt }))
  const { error } = await supabase.from('memos').upsert(rows)
  if (error) throw error
}

function remoteUpsert(id) {
  if (!hasSupabase || !session) return
  const memo = state.memos.find((m) => m.id === id) || state.works.find((w) => w.id === id)
  if (!memo) return
  pushMemoRows([memo])
    .then(() => setAuth({ syncError: false }))
    .catch((e) => {
      console.error('동기화 실패', e)
      setAuth({ syncError: true })
    })
}

function remoteDelete(id) {
  if (!hasSupabase || !session) return
  supabase
    .from('memos')
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.error('동기화 실패', error)
      setAuth({ syncError: !!error })
    })
}

function remotePushState() {
  if (!hasSupabase || !session) return
  supabase
    .from('app_state')
    .upsert({ user_id: session.user.id, day_order: state.dayOrder, updated_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error) console.error('동기화 실패', error)
      setAuth({ syncError: !!error })
    })
}

async function syncFromServer() {
  try {
    const { data: rows, error } = await supabase.from('memos').select('id,data,updated_at')
    if (error) throw error
    const serverById = new Map(rows.map((r) => [r.id, r]))
    const toPush = []
    // 로컬 목록과 서버를 updatedAt 기준 병합. isWork에 따라 memos/works로 나뉜다.
    const mergeList = (locals, isWork) => {
      const merged = []
      for (const local of locals) {
        const srv = serverById.get(local.id)
        if (!srv) {
          merged.push(local)
          toPush.push(local)
        } else {
          serverById.delete(local.id)
          if ((srv.data.updatedAt || '') >= (local.updatedAt || '')) {
            merged.push(isWork ? srv.data : migrate([srv.data])[0])
          } else {
            merged.push(local)
            toPush.push(local)
          }
        }
      }
      return merged
    }
    const memos = mergeList(state.memos, false)
    const works = mergeList(state.works, true)
    // 서버에만 있는 행
    for (const [, srv] of serverById) {
      if (srv.data && srv.data.type === 'work') works.push(srv.data)
      else memos.push(migrate([srv.data])[0])
    }
    works.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const { data: st } = await supabase.from('app_state').select('day_order').maybeSingle()
    const dayOrder = { ...((st && st.day_order) || {}), ...state.dayOrder }

    commit({ memos, works, dayOrder })
    if (toPush.length) await pushMemoRows(toPush)
    remotePushState()
    setAuth({ syncError: false })
  } catch (e) {
    console.error('서버 동기화 실패', e)
    setAuth({ syncError: true })
  }
}

if (hasSupabase) {
  supabase.auth.onAuthStateChange((_event, s) => {
    const wasLoggedIn = !!session
    session = s
    setAuth({ ready: true, loggedIn: !!s, email: s ? s.user.email : null })
    if (s && !wasLoggedIn) syncFromServer()
  })
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
  return error ? error.message : null
}

export async function sendLoginLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
  return error ? error.message : null
}

export async function signOut() {
  await supabase.auth.signOut()
}

// ---------- 메모 조작 ----------

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
  remoteUpsert(memo.id)
  return memo
}

export function updateMemo(id, patch) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)),
  })
  remoteUpsert(id)
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
  remoteUpsert(id)
}

export function updateHistory(id, index, patch) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id
        ? {
            ...m,
            history: m.history.map((h, i) => (i === index ? { ...h, ...patch } : h)),
            updatedAt: now,
          }
        : m
    ),
  })
  remoteUpsert(id)
}

export function removeHistory(id, index) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id
        ? { ...m, history: m.history.filter((_, i) => i !== index), updatedAt: now }
        : m
    ),
  })
  remoteUpsert(id)
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
  remoteUpsert(id)
}

export function completeMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, status: 'done', completedAt: now, updatedAt: now } : m
    ),
  })
  remoteUpsert(id)
}

export function reopenMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, status: 'open', completedAt: null, updatedAt: now } : m
    ),
  })
  remoteUpsert(id)
}

export function deleteMemo(id) {
  commit({ ...state, memos: state.memos.filter((m) => m.id !== id) })
  remoteDelete(id)
}

export function setDayOrder(date, ids) {
  commit({ ...state, dayOrder: { ...state.dayOrder, [date]: ids } })
  remotePushState()
}

// ---------- 점검(안전관리 캘린더) ----------
// work = { id, type:'work', area, title, cycle, owner, evidence, months:[1..12], risk,
//          runs: { '2026-07': { done, note } }, order, createdAt, updatedAt }

export function addWork(fields) {
  const now = new Date().toISOString()
  const work = {
    id: crypto.randomUUID(),
    type: 'work',
    area: fields.area || '',
    title: fields.title,
    cycle: fields.cycle || '',
    owner: fields.owner || '',
    evidence: fields.evidence || '',
    months: fields.months || [],
    risk: !!fields.risk,
    runs: {},
    order: state.works.length ? Math.max(...state.works.map((w) => w.order ?? 0)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
  }
  commit({ ...state, works: [...state.works, work] })
  remoteUpsert(work.id)
  return work
}

export function updateWork(id, patch) {
  const now = new Date().toISOString()
  commit({
    ...state,
    works: state.works.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: now } : w)),
  })
  remoteUpsert(id)
}

export function deleteWork(id) {
  commit({ ...state, works: state.works.filter((w) => w.id !== id) })
  remoteDelete(id)
}

export function toggleWorkRun(id, ym) {
  const now = new Date().toISOString()
  commit({
    ...state,
    works: state.works.map((w) => {
      if (w.id !== id) return w
      const runs = { ...(w.runs || {}) }
      if (runs[ym] && runs[ym].done) delete runs[ym]
      else runs[ym] = { done: true, at: now.slice(0, 10) }
      return { ...w, runs, updatedAt: now }
    }),
  })
  remoteUpsert(id)
}

export function seedWorks(rows) {
  const now = new Date().toISOString()
  const works = rows.map((r, i) => ({
    id: crypto.randomUUID(),
    type: 'work',
    area: r.area,
    title: r.title,
    cycle: r.cycle,
    owner: r.owner,
    evidence: r.evidence,
    months: r.months,
    risk: !!r.risk,
    runs: {},
    order: i,
    createdAt: now,
    updatedAt: now,
  }))
  commit({ ...state, works })
  if (hasSupabase && session) {
    pushMemoRows(works).catch((e) => {
      console.error('동기화 실패', e)
      setAuth({ syncError: true })
    })
  }
}
