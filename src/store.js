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
    // 기한과 기간을 동시에 가진 메모 정리 — 기한이 기간 끝과 같으면 중복이므로 기한을 지운다
    // (달력에 같은 메모가 기한 칩 + 만기 칩으로 두 번 그려지던 문제)
    if (m.due && m.period && m.period.end && m.due === m.period.end) {
      m.due = null
    }
    // 날짜 없는 미완료 메모는 오늘 기한으로 — 완료 전까지 오늘 화면에서 괴롭힌다
    // (보관·삭제된 메모는 예외)
    if (!m.due && !m.period && m.status !== 'done' && !m.keep && !m.deleted) {
      m.due = todayStr()
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

// 삭제는 지우지 않고 표식(deleted:true)만 남긴다 — UI에는 안 보이고,
// 다른 기기의 옛 복사본이 "서버에 없네?" 하며 다시 올려 되살리는 걸 막는다.
// 표식은 30일 뒤 동기화 때 실제로 삭제된다.
function withVisible(s) {
  return {
    ...s,
    visible: s.memos.filter((m) => !m.deleted),
    // 휴지통: 삭제 표식이 붙은 메모 (최근 삭제한 것부터). 30일 뒤 동기화 때 완전 삭제된다.
    trash: s.memos.filter((m) => m.deleted).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
  }
}

let state = withVisible(load())
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
  state = withVisible(next)
  localStorage.setItem(
    KEY,
    JSON.stringify({ memos: state.memos, works: state.works, dayOrder: state.dayOrder })
  )
  notify()
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getMemos = () => state.visible
export const getTrash = () => state.trash
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

    // 30일 지난 삭제 표식은 이번 동기화에서 실제로 지운다 (모든 기기에 전파된 뒤)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    const isOldTomb = (x) => x.deleted && (x.updatedAt || '') < cutoff
    const tombIds = [...memos, ...works].filter(isOldTomb).map((x) => x.id)

    commit({
      memos: memos.filter((x) => !isOldTomb(x)),
      works: works.filter((x) => !isOldTomb(x)),
      dayOrder,
    })
    if (toPush.length) await pushMemoRows(toPush.filter((x) => !isOldTomb(x)))
    if (tombIds.length) await supabase.from('memos').delete().in('id', tombIds)
    remotePushState()
    setAuth({ syncError: false })
  } catch (e) {
    console.error('서버 동기화 실패', e)
    setAuth({ syncError: true })
  }
}

// 탭에 다시 돌아오거나 인터넷이 재연결되면 서버와 다시 맞춘다.
// (로그인 순간에만 받아오면, 열어둔 탭이 다른 기기의 변경을 영영 못 봄)
let lastSyncAt = 0
function requestSync() {
  if (!hasSupabase || !session) return
  if (Date.now() - lastSyncAt < 15000) return // 과도한 재요청 방지
  lastSyncAt = Date.now()
  syncFromServer()
}

if (hasSupabase) {
  supabase.auth.onAuthStateChange((_event, s) => {
    const wasLoggedIn = !!session
    session = s
    setAuth({ ready: true, loggedIn: !!s, email: s ? s.user.email : null })
    if (s && !wasLoggedIn) {
      lastSyncAt = Date.now()
      syncFromServer()
    }
  })
  window.addEventListener('focus', requestSync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync()
  })
  window.addEventListener('online', requestSync)
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

// 자가 진단 — 화면의 이메일을 탭하면 실행. 폰에서 "왜 안 보이는지"를 그 자리에서 알려준다.
export async function runDiagnostics() {
  const lines = []
  try {
    const { data } = await supabase.auth.getUser()
    const u = data && data.user
    lines.push(`계정: ${u ? u.email : '(로그인 안 됨)'}`)
    lines.push(`사용자 ID: ${u ? u.id.slice(0, 13) : '-'}`)
  } catch (e) {
    lines.push('계정 확인 실패: ' + (e.message || e))
  }
  try {
    const { count, error } = await supabase.from('memos').select('id', { count: 'exact', head: true })
    lines.push(error ? `서버 조회 오류: ${error.message}` : `서버에 있는 내 데이터: ${count}건`)
  } catch (e) {
    lines.push('서버 연결 실패: ' + (e.message || e))
  }
  lines.push(`이 기기에 보이는 메모: ${state.visible.length}건 (점검 ${state.works.length}건)`)
  lines.push(`동기화 오류 표시: ${authSnap.syncError ? '있음' : '없음'}`)
  lines.push(`앱 버전(빌드 시각): ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : '개발 모드'}`)
  lines.push(`브라우저: ${navigator.userAgent.slice(0, 80)}`)
  alert('[진단 결과]\n' + lines.join('\n'))
}

// ---------- 메모 조작 ----------

export function addMemo({ title, due, period, fromWork, keep, deadline }) {
  const now = new Date().toISOString()
  const memo = {
    id: crypto.randomUUID(),
    title,
    status: 'open',
    keep: !!keep,
    due: keep ? null : due || null,
    period: keep ? null : period || null,
    deadline: !keep && !!deadline && !!period,
    history: [],
    fromWork: fromWork || null,
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
            // 체크를 켜는 건 착수 — 보드에서 할일로 고정해둔 것도 풀어준다
            stage: !m.history[index].done && m.stage === 'todo' ? null : m.stage ?? null,
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
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) => (m.id === id ? { ...m, deleted: true, updatedAt: now } : m)),
  })
  remoteUpsert(id)
}

// 휴지통에서 복구 — 삭제 표식만 떼면 원래 자리(보드·달력)로 돌아온다
export function restoreMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) => (m.id === id ? { ...m, deleted: false, updatedAt: now } : m)),
  })
  remoteUpsert(id)
}

// 휴지통에서 여러 개 한 번에 복구
export function restoreMemos(ids) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      ids.includes(m.id) ? { ...m, deleted: false, updatedAt: now } : m
    ),
  })
  if (!hasSupabase || !session) return
  pushMemoRows(state.memos.filter((m) => ids.includes(m.id)))
    .then(() => setAuth({ syncError: false }))
    .catch((e) => {
      console.error('동기화 실패', e)
      setAuth({ syncError: true })
    })
}

// 휴지통에서 완전 삭제 — 30일을 기다리지 않고 즉시 지운다. 되돌릴 수 없음.
// 서버 삭제가 실패하면(오프라인 등) 다음 동기화 때 휴지통에 다시 나타나므로 그때 재시도하면 된다.
export function purgeMemos(ids) {
  commit({ ...state, memos: state.memos.filter((m) => !ids.includes(m.id)) })
  if (!hasSupabase || !session) return
  supabase
    .from('memos')
    .delete()
    .in('id', ids)
    .then(({ error }) => {
      if (error) {
        console.error('완전 삭제 동기화 실패', error)
        setAuth({ syncError: true })
      }
    })
}

export function setDayOrder(date, ids) {
  commit({ ...state, dayOrder: { ...state.dayOrder, [date]: ids } })
  remotePushState()
}

// 전체 백업 — 메모(보관·완료 포함)·점검·순서를 JSON 파일로 내려받는다 (이 파일로 복원 가능)
export function downloadBackup() {
  const data = {
    app: '내 기록',
    exportedAt: new Date().toISOString(),
    memos: state.visible,
    works: state.works,
    dayOrder: state.dayOrder,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `내기록-백업-${todayStr()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
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
    history: [],
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
  const now = new Date().toISOString()
  commit({
    ...state,
    works: state.works.map((w) => (w.id === id ? { ...w, deleted: true, updatedAt: now } : w)),
  })
  remoteUpsert(id)
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

export function setWorkRunNote(id, ym, note) {
  const now = new Date().toISOString()
  commit({
    ...state,
    works: state.works.map((w) => {
      if (w.id !== id || !w.runs || !w.runs[ym]) return w
      const runs = { ...w.runs, [ym]: { ...w.runs[ym], note: note.trim() || undefined } }
      return { ...w, runs, updatedAt: now }
    }),
  })
  remoteUpsert(id)
}

function patchWorkHistory(id, fn) {
  const now = new Date().toISOString()
  commit({
    ...state,
    works: state.works.map((w) =>
      w.id === id ? { ...w, history: fn(w.history || []), updatedAt: now } : w
    ),
  })
  remoteUpsert(id)
}

export function addWorkHistory(id, text, date) {
  patchWorkHistory(id, (h) => [...h, { date: date || todayStr(), text, ts: Date.now(), done: false }])
}

export function toggleWorkHistory(id, index) {
  patchWorkHistory(id, (h) => h.map((x, i) => (i === index ? { ...x, done: !x.done } : x)))
}

export function updateWorkHistory(id, index, patch) {
  patchWorkHistory(id, (h) => h.map((x, i) => (i === index ? { ...x, ...patch } : x)))
}

export function removeWorkHistory(id, index) {
  patchWorkHistory(id, (h) => h.filter((_, i) => i !== index))
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
    history: [],
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
