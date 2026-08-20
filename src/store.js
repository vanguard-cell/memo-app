import { todayStr, parse, addDays } from './parser'
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
    // (보관·보류·삭제된 메모는 예외)
    if (!m.due && !m.period && m.status !== 'done' && !m.keep && !m.hold && !m.deleted) {
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
          routines: Array.isArray(data.routines) ? data.routines : [],
          dayOrder: data.dayOrder || {},
        }
      }
    }
  } catch (e) {
    console.error('저장 데이터를 읽지 못했습니다', e)
  }
  return { memos: [], works: [], routines: [], dayOrder: {} }
}

// 삭제는 지우지 않고 표식(deleted:true)만 남긴다 — UI에는 안 보이고,
// 다른 기기의 옛 복사본이 "서버에 없네?" 하며 다시 올려 되살리는 걸 막는다.
// 표식은 30일 뒤 동기화 때 실제로 삭제된다.
function withVisible(s) {
  return {
    ...s,
    visible: s.memos.filter((m) => !m.deleted),
    // ⚠️ 화면이 읽는 목록은 반드시 여기서 한 번만 만들어 담아둔다.
    // useSyncExternalStore는 "상태가 그대로면 같은 것"이 나와야 하는데, getter에서 매번
    // filter·sort로 새 배열을 만들면 렌더할 때마다 값이 달라져 무한 렌더로 화면이 하얘진다.
    // (2026-08-11 루틴 추가하며 실제로 그렇게 됐다)
    routineList: (s.routines || [])
      .filter((r) => !r.deleted)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    // 휴지통: 삭제 표식이 붙은 메모 (최근 삭제한 것부터). 30일 뒤 동기화 때 완전 삭제된다.
    // purged(완전 삭제한 빈 표식)는 내용이 이미 지워졌으므로 휴지통에도 안 보인다.
    trash: s.memos
      .filter((m) => m.deleted && !m.purged)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
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
    JSON.stringify({
      memos: state.memos,
      works: state.works,
      routines: state.routines,
      dayOrder: state.dayOrder,
    })
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
// 루틴 정의 — 지운 것(표식)은 빼고, 화면에 놓인 순서대로.
// 목록 자체는 withVisible()에서 만들어 담아둔다 (여기서 만들면 무한 렌더)
export const getRoutines = () => state.routineList
export const getAuth = () => authSnap

// ---------- 서버 동기화 ----------

async function pushMemoRows(memos) {
  const rows = memos.map((m) => ({ id: m.id, data: m, updated_at: m.updatedAt }))
  const { error } = await supabase.from('memos').upsert(rows)
  if (error) throw error
}

function remoteUpsert(id) {
  if (!hasSupabase || !session) return
  const memo =
    state.memos.find((m) => m.id === id) ||
    state.works.find((w) => w.id === id) ||
    state.routines.find((r) => r.id === id)
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
    // 루틴 정의도 같은 memos 테이블에 type:'routine' 행으로 산다 (works와 같은 방식 — 서버 스키마 그대로)
    const routines = mergeList(state.routines, true)
    // 서버에만 있는 행
    for (const [, srv] of serverById) {
      if (srv.data && srv.data.type === 'work') works.push(srv.data)
      else if (srv.data && srv.data.type === 'routine') routines.push(srv.data)
      else memos.push(migrate([srv.data])[0])
    }
    works.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    routines.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const { data: st } = await supabase.from('app_state').select('day_order').maybeSingle()
    const dayOrder = { ...((st && st.day_order) || {}), ...state.dayOrder }

    // 30일 지난 삭제 표식은 이번 동기화에서 실제로 지운다 (모든 기기에 전파된 뒤)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    const isOldTomb = (x) => x.deleted && (x.updatedAt || '') < cutoff
    const tombIds = [...memos, ...works, ...routines].filter(isOldTomb).map((x) => x.id)

    commit({
      memos: memos.filter((x) => !isOldTomb(x)),
      works: works.filter((x) => !isOldTomb(x)),
      routines: routines.filter((x) => !isOldTomb(x)),
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
  const before = state.memos.find((m) => m.id === id)
  commit({
    ...state,
    memos: state.memos.map((m) => (m.id === id ? { ...m, ...patch, ...settle(m, patch), updatedAt: now } : m)),
  })
  remoteUpsert(id)
  // 회차 제목을 고치면 루틴 이름도 따라 바뀐다 — 격자는 규칙 이름을, 상세는 회차 제목을
  // 보여줘서 "상세에서 고쳤는데 메인이 안 바뀐다"가 됐다 (2026-08-14 사용자 지적).
  // 아래 renamedRule이 자동 제목 모양을 지킨 경우에만 이름을 되뽑는다.
  const rule = before && typeof patch.title === 'string' ? renamedRule(before, patch.title) : null
  if (rule) updateRoutine(before.routineId, { title: rule })
}

// 회차 제목에서 바뀐 루틴 이름을 되뽑는다. 조건 둘 다 맞아야 한다:
//  · 고치기 전 제목이 자동 제목 그대로였다 = 그 달만의 제목을 쓰던 회차가 아니다
//  · 새 제목도 "○○ — 8월분" 모양이다 = 앞의 이름만 바꾼 것이다
// "8월분 재발행"처럼 그 달 얘기를 덧붙인 제목은 그 달 것으로 두고 규칙은 안 건드린다.
function renamedRule(m, next) {
  if (!m.routineId || !m.ym) return null
  const r = state.routines.find((x) => x.id === m.routineId)
  if (!r || m.title !== cycleTitle(r.title, m.ym)) return null
  const tail = cycleTitle('', m.ym)
  const v = next.trim()
  if (!v.endsWith(tail)) return null
  const name = v.slice(0, -tail.length).trim()
  return name && name !== r.title ? name : null
}

// 가예정 풀기 — 루틴이 자동으로 찍어둔 날짜(tentative)는 "아직 안 잡은 자리"일 뿐이라,
// 내가 날짜를 건드리는 순간 "내가 정한 날"이 된다 (달력에서 끌기·날짜 지정·하루 미루기·정보 수정).
// 묶음 예정일 일괄 변경은 updateMemo를 안 거치므로 여기 안 걸린다 — 그건 내가 잡은 날이 아니니까.
const settle = (m, patch) =>
  m.tentative && !('tentative' in patch) && ('due' in patch || 'period' in patch)
    ? { tentative: false }
    : null

export function addHistory(id, text, date) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id
        ? {
            ...m,
            history: [...m.history, { date: date || todayStr(), text, ts: Date.now(), done: false }],
            // 기록을 한 줄이라도 남겼다 = 업체와 얘기가 됐다 — 가예정을 푼다 (2026-08-13)
            tentative: false,
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

// 반복 메모의 다음 예정일 — 원래 예정일 기준으로 굴러간다 (늦게 완료해도 주기가 안 밀림).
// 한 번은 무조건 전진하고, 그래도 과거면 오늘 이후가 될 때까지 굴린다.
function addMonthsClamped(ymd, n) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const t = new Date(y, mo - 1 + n, 1)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  const pad = (x) => String(x).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, last))}`
}

export function nextRepeatDate(due, repeat) {
  const today = todayStr()
  let d = due
  let guard = 0
  do {
    if (repeat === 'weekly') d = addDays(d, 7)
    else if (repeat === 'yearly') d = addMonthsClamped(d, 12)
    else d = addMonthsClamped(d, 1)
  } while (d <= today && guard++ < 200)
  return d
}

export function completeMemo(id) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) => {
      if (m.id !== id) return m
      // 반복 메모(공과금 등): 완료 대신 다음 주기로 굴러간다 — 할일로 복귀, 기록은 계속 쌓임 (2026-07-31)
      if (m.repeat && m.due) {
        return { ...m, due: nextRepeatDate(m.due, m.repeat), stage: 'todo', snoozeUntil: null, updatedAt: now }
      }
      return { ...m, status: 'done', completedAt: now, tentative: false, updatedAt: now }
    }),
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

// 보관함에서 꺼내기 — 지정한 날짜(예정)를 달아 할 일로 보낸다 (여러 개 한 번에 가능)
export function unkeepMemos(ids, due) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      ids.includes(m.id) ? { ...m, keep: false, due, updatedAt: now } : m
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

// 보류함으로 보내기 — 날짜를 떼고 보류(hold) 표식을 단다. 진행기록·설명은 그대로 남고
// 보드·달력에서만 사라진다. "하다가 멈췄는데 언제 다시 할지 모르는 일"을 넣어두는 곳.
export function holdMemos(ids) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      ids.includes(m.id)
        ? { ...m, hold: true, holdAt: todayStr(), due: null, period: null, deadline: false, snoozeUntil: null, updatedAt: now }
        : m
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

// 보류함에서 꺼내기 — 지정한 날짜(예정)를 달아 다시 할 일로 보낸다 (여러 개 한 번에 가능)
export function unholdMemos(ids, due) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      ids.includes(m.id) ? { ...m, hold: false, due, updatedAt: now } : m
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

// 휴지통에서 완전 삭제 — 30일을 기다리지 않고 지금 내용을 지운다. 되돌릴 수 없음.
// 행을 통째로 지우지 않고 빈 표식(purged)만 남기는 이유: 서버에서 사라지면 다른 기기에 남아
// 있던 옛 복사본이 "서버에 없네?" 하며 다시 올려 되살아난다(휴지통에 도로 나타나던 문제).
// 표식은 화면 어디에도 안 보이고, 30일 뒤 동기화 때 행까지 실제로 지워진다.
export function purgeMemos(ids) {
  const now = new Date().toISOString()
  const idSet = new Set(ids)
  const tombs = []
  const memos = state.memos.map((m) => {
    if (!idSet.has(m.id)) return m
    const tomb = {
      id: m.id,
      deleted: true,
      purged: true,
      title: '',
      history: [],
      createdAt: m.createdAt || now,
      updatedAt: now,
    }
    tombs.push(tomb)
    return tomb
  })
  if (!tombs.length) return
  commit({ ...state, memos })
  if (!hasSupabase || !session) return
  pushMemoRows(tombs)
    .then(() => setAuth({ syncError: false }))
    .catch((e) => {
      console.error('완전 삭제 동기화 실패', e)
      setAuth({ syncError: true })
    })
}

// ---------- 루틴 (매달·분기·해마다 도는 일) — 2026-08-11 ----------
// 정의와 회차를 나눈다:
//  · 정의(routines) = 반복 규칙 그 자체. 이름·묶음·매달 같은 설명(엑셀 비고 열)·예정일·해당 월.
//  · 회차(memos) = 그 달의 실제 일. 그냥 메모라서 달력·오늘·검색·상세·파일·진행기록이 전부 그대로 붙는다.
// 회차에 repeat를 쓰지 않는 이유: repeat은 메모 하나가 앞으로 굴러가는 방식이라
// "몇 월에 했나"가 안 남는다. 격자로 1년을 보려면 달마다 회차가 따로 있어야 한다.
// 회차는 미리 12개를 만들지 않는다 — 이번 달치만 자동으로, 나머지는 칸을 누를 때.

const pad2 = (n) => String(n).padStart(2, '0')
export const thisYm = () => todayStr().slice(0, 7)

// 그 달의 예정일 — 말일보다 큰 날짜(31일 등)는 그 달 말일로 당긴다
export function routineDue(ym, dueDay) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${ym}-${pad2(Math.min(Math.max(1, dueDay || 1), last))}`
}

// 회차 메모의 자동 제목 — 이름을 고칠 때 "손대지 않은 회차"를 가려내는 데도 쓴다
export const cycleTitle = (title, ym) => `${title} — ${Number(ym.slice(5, 7))}월분`

// 그 달에 해당하는 루틴인가 — months가 비어 있으면 매월, 아니면 그 달 목록에만
export function routineHasMonth(r, ym) {
  const m = Number(ym.slice(5, 7))
  if (r.startYm && ym < r.startYm) return false
  if (r.endYm && ym >= r.endYm) return false
  return !r.months || r.months.length === 0 || r.months.includes(m)
}

export const routineOf = (id) => state.routines.find((r) => r.id === id && !r.deleted) || null

export const routineCycle = (routineId, ym) =>
  state.visible.find((m) => m.routineId === routineId && m.ym === ym)

// 그 달 회차를 "만든 적이 있나" — 지운 것(휴지통 표식)까지 센다.
// routineCycle은 보이는 것만 찾으므로 그걸로 판정하면 내가 지운 회차를 앱이 다음에 열 때
// 다시 만들어낸다. 지운 건 지운 것으로 둔다. (2026-08-19 사용자: "지웠는데 자꾸 생성되지")
const cycleEverMade = (routineId, ym) =>
  state.memos.some((m) => m.routineId === routineId && m.ym === ym)

// 이름이 사실상 비어 있는가 — 눈에 안 보이는 글자(제로폭 공백 등)만 남은 것도 빈 이름으로 본다.
// 그런 게 섞이면 trim()을 통과해 "— 8월분" 같은 이름 없는 회차가 계속 만들어진다.
export const blankTitle = (t) => !String(t || '').replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '')

// 날짜가 고정인 일(공과금·월세)과 매번 잡아야 하는 일(업체 방문·정기점검)은 다르다.
// flexible=true면 그 루틴의 회차는 "가예정"으로 태어난다 — 달력에서 흐리게 보이고,
// 내가 날짜를 잡거나 기록을 남기면 확정된다. 없는 값(옛 루틴)은 고정으로 본다.
export function addRoutine({ title, group, desc, dueDay, months, startYm, flexible }) {
  const now = new Date().toISOString()
  const r = {
    id: crypto.randomUUID(),
    type: 'routine',
    title: title || '',
    group: group || '기타',
    desc: desc || '',
    dueDay: dueDay || 5,
    flexible: !!flexible,
    months: months || null,
    startYm: startYm || thisYm(),
    endYm: null,
    endNote: '',
    order: state.routines.length,
    createdAt: now,
    updatedAt: now,
  }
  commit({ ...state, routines: [...state.routines, r] })
  remoteUpsert(r.id)
  return r
}

// 예정일을 바꾸면 이미 만들어진 그 루틴의 회차 날짜도 같이 옮긴다 (완료된 회차는 그대로 —
// 지난 일은 지난 일이다). 묶음 일괄(setGroupDueDay)은 원래 그렇게 동작했는데 항목 하나를
// 고칠 때는 정의만 바뀌어서, 예정일을 14일로 고쳐도 달력의 회차는 5일에 남아 있었다.
// (2026-08-13 사용자: "각 항목마다 날짜 지정해뒀는데 달력에 표시가 안되는데?")
// 이름을 고치면 회차 제목도 따라간다 — 격자는 규칙 이름을, 달력·오늘·검색은 회차 제목을
// 보여주므로 한쪽만 바뀌면 같은 일이 두 이름으로 남는다. 단 **자동으로 지어진 제목
// ("○○ — 8월분") 그대로인 회차만** 바꾼다 — 그 달만 따로 적어둔 제목은 내가 쓴 글이다.
// 날짜와 달리 지난 회차도 같이 바꾼다(이름은 딱지일 뿐, 언제 했나는 그대로다).
// (2026-08-14 사용자: "이름을 새롬 승강기로 바꿨는데 메인에서는 안바뀌네")
export function updateRoutine(id, patch) {
  const now = new Date().toISOString()
  const before = state.routines.find((r) => r.id === id)
  const dayMoved = before && 'dueDay' in patch && Number(patch.dueDay) !== Number(before.dueDay)
  const newTitle = typeof patch.title === 'string' ? patch.title.trim() : ''
  const renamed = before && newTitle && newTitle !== before.title
  const routines = state.routines.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now } : r))
  const moved = []
  const memos =
    dayMoved || renamed
      ? state.memos.map((m) => {
          if (m.routineId !== id || !m.ym) return m
          let next = m
          if (dayMoved && m.status !== 'done') next = { ...next, due: routineDue(m.ym, patch.dueDay) }
          if (renamed && m.title === cycleTitle(before.title, m.ym)) {
            next = { ...next, title: cycleTitle(newTitle, m.ym) }
          }
          if (next === m) return m
          next = { ...next, updatedAt: now }
          moved.push(next)
          return next
        })
      : state.memos
  commit({ ...state, routines, memos })
  if (moved.length && hasSupabase && session) {
    pushMemoRows(moved)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  remoteUpsert(id)
}

// 묶음 통째로 예정일 바꾸기 — 34건을 하나씩 고치는 건 일이라 묶음 단위로 준다 (2026-08-11).
// 이미 만들어진 회차의 날짜도 같이 옮긴다(완료된 회차는 그대로 둔다 — 지난 일은 지난 일이다).
export function setGroupDueDay(group, day) {
  const now = new Date().toISOString()
  // 31일까지 — 그 날이 없는 달은 routineDue가 말일로 당긴다 (2026-08-14)
  const d = Math.min(31, Math.max(1, Number(day) || 1))
  const ids = new Set(
    state.routines.filter((r) => !r.deleted && (r.group || '기타') === group).map((r) => r.id)
  )
  if (!ids.size) return 0
  const routines = state.routines.map((r) => (ids.has(r.id) ? { ...r, dueDay: d, updatedAt: now } : r))
  const memos = state.memos.map((m) =>
    m.routineId && ids.has(m.routineId) && m.ym && m.status !== 'done'
      ? { ...m, due: routineDue(m.ym, d), updatedAt: now }
      : m
  )
  commit({ ...state, routines, memos })
  const changed = [
    ...routines.filter((r) => ids.has(r.id)),
    ...memos.filter((m) => m.routineId && ids.has(m.routineId) && m.status !== 'done'),
  ]
  if (hasSupabase && session && changed.length) {
    pushMemoRows(changed)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return ids.size
}

// 자동으로 찍힌 날짜가 마침 맞을 때 — 날짜를 안 옮기고 "이 날 맞다"만 표시한다
export const confirmDate = (id) => updateMemo(id, { tentative: false })

// 묶음 통째로 "날짜 고정 ↔ 매번 잡음" — 34건을 하나씩 켜는 건 일이라 묶음 단위로 준다.
// 아직 안 끝난 회차의 표시도 같이 맞춘다(이미 내가 잡은 날·끝난 회차는 그대로 둔다).
export function setGroupFlexible(group, flexible) {
  const now = new Date().toISOString()
  const ids = new Set(
    state.routines.filter((r) => !r.deleted && (r.group || '기타') === group).map((r) => r.id)
  )
  if (!ids.size) return 0
  const routines = state.routines.map((r) =>
    ids.has(r.id) ? { ...r, flexible: !!flexible, updatedAt: now } : r
  )
  // 켤 때: 아직 손 안 댄 회차를 가예정으로. 끌 때: 가예정 표시만 지운다.
  const touch = (m) =>
    m.routineId &&
    ids.has(m.routineId) &&
    m.status !== 'done' &&
    (flexible ? !m.tentative && !(m.history || []).length : m.tentative)
  const moved = new Set()
  const memos = state.memos.map((m) => {
    if (!touch(m)) return m
    moved.add(m.id)
    return { ...m, tentative: !!flexible, updatedAt: now }
  })
  commit({ ...state, routines, memos })
  const changed = [
    ...routines.filter((r) => ids.has(r.id)),
    ...memos.filter((m) => moved.has(m.id)),
  ]
  if (hasSupabase && session && changed.length) {
    pushMemoRows(changed)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return ids.size
}

// 중단 — 지우는 게 아니라 "이 달부터 안 함". 지난 회차는 이력으로 그대로 남는다
// (엑셀에서 행을 지우면 처리 이력까지 사라지던 것과 다르다)
export const stopRoutine = (id, endYm, endNote) =>
  updateRoutine(id, { endYm: endYm || thisYm(), endNote: endNote || '' })

// 회차에 남은 게 있나 — 완료·진행기록·파일 중 하나라도 있으면 "기록"이다.
const cycleHasRecord = (m) =>
  m.status === 'done' || (m.history || []).length > 0 || (m.files || []).length > 0

// 정의를 지운다. 기록이 남은 회차는 메모로 그대로 둔다(검색·이력 보존) — 다만 **아무것도
// 안 한 빈 회차는 같이 치운다**. 예전엔 전부 남겨서, 루틴을 지워도 달력에 그 달 회차가
// 계속 떠 있고 지울 곳을 찾기 어려웠다. (2026-08-19)
export function removeRoutine(id) {
  const now = new Date().toISOString()
  const gone = state.memos.filter((m) => m.routineId === id && !m.deleted && !cycleHasRecord(m))
  const goneIds = new Set(gone.map((m) => m.id))
  const routines = state.routines.map((r) => (r.id === id ? { ...r, deleted: true, updatedAt: now } : r))
  const memos = state.memos.map((m) => (goneIds.has(m.id) ? { ...m, deleted: true, updatedAt: now } : m))
  commit({ ...state, routines, memos })
  const changed = [
    ...routines.filter((r) => r.id === id),
    ...memos.filter((m) => goneIds.has(m.id)),
  ]
  if (hasSupabase && session) {
    pushMemoRows(changed)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
}

// 앱을 열 때 빈 줄을 치운다 — 이름 없는 루틴과, 주인이 없어진(지워졌거나 이름 없는) 빈 회차.
// "+ 항목"을 누르면 그 줄이 바로 만들어지므로, 이름을 안 적고 새로고침하거나 다른 화면으로
// 넘어가면 "(이름 없음)" 줄과 "— 8월분" 회차가 남는다(취소로 닫을 때만 정리됐다).
// 기록이 있는 회차는 손대지 않는다. (2026-08-19)
export function cleanupBlankRoutines() {
  const now = new Date().toISOString()
  const blank = new Set(
    state.routines.filter((r) => !r.deleted && blankTitle(r.title)).map((r) => r.id)
  )
  const live = new Set(state.routines.filter((r) => !r.deleted && !blank.has(r.id)).map((r) => r.id))
  const orphan = state.memos.filter(
    (m) => m.routineId && !m.deleted && !live.has(m.routineId) && !cycleHasRecord(m)
  )
  const orphanIds = new Set(orphan.map((m) => m.id))
  if (!blank.size && !orphanIds.size) return 0
  const routines = state.routines.map((r) => (blank.has(r.id) ? { ...r, deleted: true, updatedAt: now } : r))
  const memos = state.memos.map((m) => (orphanIds.has(m.id) ? { ...m, deleted: true, updatedAt: now } : m))
  commit({ ...state, routines, memos })
  const changed = [
    ...routines.filter((r) => blank.has(r.id)),
    ...memos.filter((m) => orphanIds.has(m.id)),
  ]
  if (hasSupabase && session) {
    pushMemoRows(changed)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return changed.length
}

// 회차를 실제로 한 날로 옮겼을 때, 그 날을 규칙의 예정일로 삼는다 — "앞으로도 매달 18일".
// 상세 화면이 그 자리에서 물어보고(안 누르면 그 달만의 일로 남는다) 여기서 규칙을 고친다.
// 규칙이 바뀌면 updateRoutine이 아직 안 끝난 회차의 날짜도 같이 옮긴다. (2026-08-20)
export function adoptCycleDay(memoId) {
  const m = state.memos.find((x) => x.id === memoId)
  if (!m || !m.routineId || !m.due) return 0
  const day = Number(m.due.slice(8, 10))
  const r = routineOf(m.routineId)
  if (!r || !day || Number(r.dueDay) === day) return 0
  updateRoutine(m.routineId, { dueDay: day })
  return day
}

// 지난 달들을 한 번에 맞추기 — 그 달 회차를 실제로 한 날로 옮겨 완료해 뒀다면
// 그 날을 규칙의 예정일로 삼는다. 앞으로는 상세에서 그때그때 물어보므로(adoptCycleDay)
// 이건 이미 쌓인 달을 따라잡기 위한 일괄 처리다. 34건을 한 번에 저장한다.
// 매번 날짜를 새로 잡는 유동 루틴(가예정)은 건드리지 않는다 — 그 날짜는 그 달의 약속일 뿐이다.
// (2026-08-20 사용자 요청: "8월에 완료한 것들은 이번만 루틴에서 날짜 바꿔줘")
export function adoptDoneDays(ym) {
  const now = new Date().toISOString()
  const dayById = new Map()
  const changes = []
  for (const r of state.routines) {
    if (r.deleted || r.flexible) continue
    const c = state.memos.find((m) => !m.deleted && m.routineId === r.id && m.ym === ym)
    if (!c || c.status !== 'done' || !c.due) continue
    const day = Number(c.due.slice(8, 10))
    // 규칙대로 찍힌 날 그대로면 옮긴 게 아니다 (말일 당김도 여기서 걸러진다)
    if (!day || c.due === routineDue(ym, r.dueDay)) continue
    dayById.set(r.id, day)
    changes.push({ title: r.title, from: Number(r.dueDay) || 5, to: day })
  }
  if (!dayById.size) return []
  const routines = state.routines.map((r) =>
    dayById.has(r.id) ? { ...r, dueDay: dayById.get(r.id), updatedAt: now } : r
  )
  // 아직 안 끝난 회차는 새 날로 따라 옮긴다 — 완료한 회차는 한 날 그대로 둔다(지난 일은 지난 일)
  const moved = []
  const memos = state.memos.map((m) => {
    if (!m.routineId || !m.ym || m.deleted || m.status === 'done') return m
    if (!dayById.has(m.routineId)) return m
    const due = routineDue(m.ym, dayById.get(m.routineId))
    if (due === m.due) return m
    const next = { ...m, due, updatedAt: now }
    moved.push(next)
    return next
  })
  commit({ ...state, routines, memos })
  const changed = [...routines.filter((r) => dayById.has(r.id)), ...moved]
  if (hasSupabase && session) {
    pushMemoRows(changed)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return changes
}

// 회차 메모 한 개 만들기 (저장은 부르는 쪽에서 — 여러 개를 한 번에 담을 수 있게)
function newCycle(r, ym) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: cycleTitle(r.title, ym),
    status: 'open',
    keep: false,
    due: routineDue(ym, r.dueDay),
    period: null,
    deadline: false,
    history: [],
    desc: r.desc || '',
    routineId: r.id,
    ym,
    // 유동 루틴의 날짜는 앱이 자리만 잡아둔 것 — 확정 전까지 달력에서 흐리게 보인다
    tentative: !!r.flexible,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    snoozeUntil: null,
  }
}

// 그 달의 회차를 찾고, 없으면 만든다
export function ensureCycle(routineId, ym) {
  const found = routineCycle(routineId, ym)
  if (found) return found
  const r = state.routines.find((x) => x.id === routineId)
  // 이름 없는 루틴(= "+ 항목"을 눌렀다 만 빈 줄)은 회차를 만들지 않는다. 그 줄을 눌렀다가
  // 달력에 이름 없는 "— 8월분" 회차가 태어나고, 루틴을 지워도 그 회차는 남아 계속 뜨던 문제.
  // (2026-08-19 사용자: "이거 지워도 계속 뜨는데 왜그러냐") 앱 시작(ensureThisMonth)과
  // 달력 예고(ghost)는 원래 이름 없는 루틴을 건너뛴다 — 여기만 빠져 있었다.
  if (!r || r.deleted || !(r.title || '').trim()) return null
  const memo = newCycle(r, ym)
  commit({ ...state, memos: [memo, ...state.memos] })
  remoteUpsert(memo.id)
  return memo
}

// 격자 칸 클릭 — 완료 ↔ 되돌리기. 회차가 없으면 만들면서 완료 처리한다.
// 완료 경로는 메모와 같은 것을 쓰므로 오늘 화면·달력·보드가 저절로 따라온다.
export function toggleCycle(routineId, ym) {
  const cyc = ensureCycle(routineId, ym)
  if (!cyc) return
  if (cyc.status === 'done') reopenMemo(cyc.id)
  else completeMemo(cyc.id)
}

// 앱을 열 때 이번 달 회차를 채운다 — 그래야 오늘 화면·달력에 이번 달 할 일로 뜬다.
// 지난 달은 자동으로 만들지 않는다(안 한 달이 우르르 살아나 화면을 덮는다).
// 34건이 한꺼번에 생기는 첫 달을 생각해 한 번에 담고 한 번만 저장한다
// (하나씩 만들면 저장·서버 요청이 34번 난다)
export function ensureThisMonth() {
  const ym = thisYm()
  const made = []
  for (const r of getRoutines()) {
    if (blankTitle(r.title)) continue
    if (routineHasMonth(r, ym) && !cycleEverMade(r.id, ym)) made.push(newCycle(r, ym))
  }
  if (!made.length) return 0
  commit({ ...state, memos: [...made, ...state.memos] })
  if (hasSupabase && session) {
    pushMemoRows(made)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return made.length
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
    routines: state.routines.filter((r) => !r.deleted),
    dayOrder: state.dayOrder,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `내기록-백업-${todayStr()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 가져오기 — 백업 파일이나 엑셀에서 변환한 파일을 그대로 받는다 (2026-08-11).
// 지금까지는 내보내기만 있어서 백업 파일을 만들어도 되돌릴 길이 없었다.
// 규칙: 같은 id가 이미 있으면 건드리지 않는다(덮어쓰기 없음) — 두 번 눌러도 안전하다.
// 돌려주는 값은 {memos, routines} 실제로 추가된 건수.
export function importData(data) {
  if (!data || (!Array.isArray(data.memos) && !Array.isArray(data.routines))) {
    throw new Error('내 기록 백업 파일이 아닙니다')
  }
  const has = (arr, id) => arr.some((x) => x.id === id)
  const newMemos = (data.memos || []).filter((m) => m && m.id && !has(state.memos, m.id))
  const newRoutines = (data.routines || []).filter((r) => r && r.id && !has(state.routines, r.id))
  if (!newMemos.length && !newRoutines.length) return { memos: 0, routines: 0 }
  const base = state.routines.length
  const routines = newRoutines.map((r, i) => ({ ...r, type: 'routine', order: r.order ?? base + i }))
  commit({
    ...state,
    memos: [...migrate(newMemos), ...state.memos],
    routines: [...state.routines, ...routines],
    dayOrder: { ...state.dayOrder, ...(data.dayOrder || {}) },
  })
  for (const x of [...newMemos, ...routines]) remoteUpsert(x.id)
  if (data.dayOrder) remotePushState()
  return { memos: newMemos.length, routines: routines.length }
}

// 엑셀에서 읽은 줄들을 루틴으로 들인다 (src/importXlsx.js가 넘겨준다, 2026-08-11).
// · 이름이 같은 루틴이 이미 있으면 묶음·설명만 갱신한다 — 예정일·주기·중단은 손대지 않는다.
//   (엑셀을 다시 넣어도 앱에서 손으로 정한 것들이 안 날아가게. 대신 설명은 엑셀이 원본이라 덮어쓴다)
// · 표에서 O가 찍힌 달은 그 달 회차를 완료로 만든다. 이미 있는 회차는 건드리지 않는다.
// 돌려주는 값: {added, updated, cycles}
export function importRoutineRows({ rows, year }) {
  const now = new Date().toISOString()
  const byTitle = new Map(state.routines.filter((r) => !r.deleted).map((r) => [r.title.trim(), r]))
  const routines = [...state.routines]
  const madeCycles = []
  const touched = []
  let added = 0
  let updated = 0

  for (const row of rows) {
    const key = row.title.trim()
    let r = byTitle.get(key)
    if (r) {
      // 예정일은 엑셀에 '예정일' 열이 있을 때만 따라간다 — 없으면 앱에서 정한 값을 지킨다
      const next = {
        ...r,
        group: row.group,
        desc: row.desc,
        ...(row.dueDay ? { dueDay: row.dueDay } : {}),
        updatedAt: now,
      }
      routines[routines.indexOf(r)] = next
      byTitle.set(key, next)
      touched.push(next)
      r = next
      updated++
    } else {
      r = {
        id: crypto.randomUUID(),
        type: 'routine',
        title: key,
        group: row.group,
        desc: row.desc,
        dueDay: row.dueDay || 5,
        months: null,
        startYm: `${year}-01`,
        endYm: null,
        endNote: '',
        order: routines.length,
        createdAt: now,
        updatedAt: now,
      }
      routines.push(r)
      byTitle.set(key, r)
      touched.push(r)
      added++
    }
    for (const m of row.done) {
      const ym = `${year}-${pad2(m)}`
      if (routineCycle(r.id, ym) || madeCycles.some((c) => c.routineId === r.id && c.ym === ym)) continue
      // 엑셀에는 "그 달에 했다"만 있고 며칠에 했는지가 없다 — 완료일은 지어내지 않고 비워둔다
      madeCycles.push({ ...newCycle(r, ym), status: 'done' })
    }
  }

  commit({ ...state, routines, memos: [...madeCycles, ...state.memos] })
  const push = [...touched, ...madeCycles]
  if (hasSupabase && session && push.length) {
    pushMemoRows(push)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return { added, updated, cycles: madeCycles.length }
}

// 문서 접수대장 → 그 달 회차의 기록 (2026-08-12).
// 체크리스트 가져오기와 다른 점: 여기는 "언제 무엇을 받았다"는 지난 사실이라
//  · 회차를 완료로 넣되 완료일을 실제 접수일로 적는다 (체크리스트는 날짜가 없어 비워둔다)
//  · 차수마다 진행기록 한 줄로 쌓는다 (체크만으로는 1·2·3차가 안 남는다)
//  · 이미 있는 루틴 정의는 건드리지 않는다 — 접수대장은 기록이지 규칙이 아니다
// 같은 표를 두 번 붙여넣어도 같은 줄(날짜+글)은 다시 안 쌓인다.
export function importRoutineCycles({ items }) {
  const now = new Date().toISOString()
  const byTitle = new Map(state.routines.filter((r) => !r.deleted).map((r) => [r.title.trim(), r]))
  const routines = [...state.routines]
  const madeRoutines = []
  const madeCycles = []
  const changedCycles = new Map() // id → 바뀐 회차 (한 회차에 여러 줄이 붙을 수 있다)
  let addedRoutines = 0
  let addedLines = 0

  // 시작 달은 루틴마다 "자기 기록의 첫 달"로 잡는다 — 전체에서 가장 이른 달을 쓰면
  // 7월부터 있는 항목이 5·6월에 안 한 것처럼 빈 칸으로 남는다 (격자는 시작 전이면 '해당 없음')
  const earliestOf = new Map()
  for (const it of items) {
    const k = it.title.trim()
    if (!earliestOf.has(k) || it.ym < earliestOf.get(k)) earliestOf.set(k, it.ym)
  }

  for (const it of items) {
    const key = it.title.trim()
    const earliest = earliestOf.get(key)
    let r = byTitle.get(key)
    if (!r) {
      r = {
        id: crypto.randomUUID(),
        type: 'routine',
        title: key,
        group: it.group || '기타',
        desc: it.desc || '',
        dueDay: 5,
        months: null,
        startYm: earliest || thisYm(),
        endYm: null,
        endNote: '',
        order: routines.length,
        createdAt: now,
        updatedAt: now,
      }
      routines.push(r)
      madeRoutines.push(r)
      byTitle.set(key, r)
      addedRoutines++
    } else if (r.startYm && earliest && earliest < r.startYm) {
      // 지난 달 기록을 넣는데 시작이 그 뒤면 격자에 안 보인다 — 시작만 당긴다
      const next = { ...r, startYm: earliest, updatedAt: now }
      routines[routines.indexOf(r)] = next
      madeRoutines.push(next)
      byTitle.set(key, next)
      r = next
    }

    // 읽는 쪽에서 (문서명, 연월)로 이미 묶어 오므로 한 회차는 한 번만 지나간다
    const exist = routineCycle(r.id, it.ym)
    if (exist) {
      const has = new Set((exist.history || []).map((h) => `${h.date}|${h.text}`))
      const add = it.lines.filter((l) => !has.has(`${l.date}|${l.text}`))
      if (!add.length) continue
      addedLines += add.length
      const history = [...(exist.history || []), ...add.map((l) => ({ ...l, type: 'log' }))]
        .sort((a, b) => a.date.localeCompare(b.date))
      changedCycles.set(exist.id, { ...exist, history, updatedAt: now })
    } else {
      addedLines += it.lines.length
      const last = it.lines[it.lines.length - 1].date
      madeCycles.push({
        ...newCycle(r, it.ym),
        // 접수한 날이 곧 그 달 일이 이뤄진 날 — 예정일 대신 실제 날짜를 적는다
        due: it.lines[0].date,
        status: 'done',
        completedAt: last + 'T00:00:00.000Z',
        history: it.lines.map((l) => ({ ...l, type: 'log' })),
      })
    }
  }

  const edited = [...changedCycles.values()]
  const editedIds = new Set(edited.map((c) => c.id))
  commit({
    ...state,
    routines,
    memos: [...madeCycles, ...state.memos.map((m) => (editedIds.has(m.id) ? changedCycles.get(m.id) : m))],
  })
  const push = [...madeRoutines, ...madeCycles, ...edited]
  if (hasSupabase && session && push.length) {
    pushMemoRows(push)
      .then(() => setAuth({ syncError: false }))
      .catch((e) => {
        console.error('동기화 실패', e)
        setAuth({ syncError: true })
      })
  }
  return { routines: addedRoutines, cycles: madeCycles.length, updated: edited.length, lines: addedLines }
}

// ---------- 파일 첨부 (2026-07-31 부활) ----------
// 실물은 Storage 'files' 버킷에, 여기서는 메모에 실리는 메타데이터만 다룬다 (동기화 그대로 탐)

export function attachFile(id, file) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, files: [...(m.files || []), file], updatedAt: now } : m
    ),
  })
  remoteUpsert(id)
}

export function detachFile(id, path) {
  const now = new Date().toISOString()
  commit({
    ...state,
    memos: state.memos.map((m) =>
      m.id === id ? { ...m, files: (m.files || []).filter((f) => f.path !== path), updatedAt: now } : m
    ),
  })
  remoteUpsert(id)
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
