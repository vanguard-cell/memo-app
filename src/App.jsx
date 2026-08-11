import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  subscribe, getMemos, getTrash, getDayOrder, getAuth, signOut, downloadBackup, runDiagnostics,
  addMemo, updateMemo, completeMemo, purgeMemos,
  getRoutines, ensureThisMonth, importData,
} from './store'
import { todayStr } from './parser'
import { hasSupabase } from './supabase'
import useIsNarrow from './useIsNarrow'
import MemoDetail from './components/MemoDetail'
import Login from './components/Login'
import MemosView from './views/MemosView'
import TrashView from './views/TrashView'
import KeepView from './views/KeepView'
import HoldView from './views/HoldView'
import RoutineView from './views/RoutineView'
import ErrorBoundary from './components/ErrorBoundary'
import { ICONS } from './icons'

// 화면은 하나(메모) — 오늘 탭은 2026-07-15 요약 타일로 흡수, 달력 탭은 메모탭 보기로 흡수,
// 점검탭은 2026-07-14 제거(데이터는 store·서버 보존, 반복 기한 변환 예정).

// 사이드바·상세 공용 아이콘은 src/icons.jsx — 같은 그림 언어 (2026-07-31 모듈로 분리)

// 새 버전 감지 — 탭을 오래 열어두면 옛 코드가 계속 돌므로, 탭에 돌아올 때마다
// 배포본의 스크립트 파일명이 바뀌었는지 확인해서 새로고침 배너를 띄운다
function useUpdateReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const cur = (document.querySelector('script[src*="assets/index-"]') || {}).src || ''
    const curName = cur.split('/').pop()
    if (!curName) return
    let stopped = false
    let lastCheck = 0
    async function check() {
      if (Date.now() - lastCheck < 60000) return
      lastCheck = Date.now()
      try {
        const res = await fetch('index.html', { cache: 'no-store' })
        const html = await res.text()
        const m = html.match(/assets\/(index-[\w-]+\.js)/)
        if (!stopped && m && m[1] !== curName) setReady(true)
      } catch {
        // 오프라인 등 — 조용히 넘어간다
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    const iv = setInterval(check, 10 * 60 * 1000)
    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])
  return ready
}

export default function App() {
  const memos = useSyncExternalStore(subscribe, getMemos)
  const trash = useSyncExternalStore(subscribe, getTrash)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const routines = useSyncExternalStore(subscribe, getRoutines)
  const [openId, setOpenId] = useState(null)
  const [showTrash, setShowTrash] = useState(false)
  const [showKeep, setShowKeep] = useState(false)
  const [showHold, setShowHold] = useState(false)
  const [showRoutine, setShowRoutine] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const keeps = memos.filter((m) => m.keep)
  const holds = memos.filter((m) => m.hold)
  // 사이드바 배지 — 이번 달에 아직 안 끝난 루틴 건수
  const ym = todayStr().slice(0, 7)
  const routineLeft = routines.filter((r) => {
    if (!(r.title || '').trim() || (r.endYm && ym >= r.endYm) || (r.startYm && ym < r.startYm)) return false
    if (r.months && r.months.length && !r.months.includes(Number(ym.slice(5, 7)))) return false
    const cyc = memos.find((m) => m.routineId === r.id && m.ym === ym)
    return !cyc || cyc.status !== 'done'
  }).length
  const narrow = useIsNarrow()
  const updateReady = useUpdateReady()
  const open = memos.find((m) => m.id === openId)
  // 지금 보고 있는 화면 — 화면별 안전장치(ErrorBoundary)의 key로 쓴다.
  // 다른 화면으로 옮기면 key가 바뀌어 오류 상태가 저절로 풀린다.
  const screen = showTrash ? 'trash' : showRoutine ? 'routine' : showHold ? 'hold' : showKeep ? 'keep' : 'memo'

  // 제목·기록·설명이 모두 빈 "임시 메모"(+ 로 만들었다가 안 쓰고 닫은 것)는 완전히 지운다.
  // 톰스톤(휴지통)이 아니라 purge — 빈 초안이 휴지통에 쌓이지 않게.
  function discardIfEmptyDraft(id) {
    // 최신 store 상태를 직접 읽는다 (제목 저장 직후 닫힘 등 타이밍에서 stale 방지)
    const m = getMemos().find((x) => x.id === id)
    if (m && !(m.title || '').trim() && (!m.history || m.history.length === 0) && !(m.desc || '').trim() && (!m.files || m.files.length === 0) && !m.keep && !m.hold) {
      purgeMemos([m.id])
    }
  }

  // 메모 열기 — 닫히는 중이었다면 취소하고 그대로 이어서 연다.
  // 열려있던 게 빈 초안이면 버리고 넘어간다.
  function openMemo(id) {
    clearTimeout(closeTimer.current)
    setClosing(false)
    if (openId && openId !== id) discardIfEmptyDraft(openId)
    setOpenId(id)
  }

  // 보드 칸의 + — 그 칸 상태의 새 메모(제목 빈칸·오늘 예정)를 바로 만들고 상세를 연다.
  // 작성 패널을 따로 두지 않고 상세 패널을 그대로 쓴다 (제목·날짜·작업설명·진행기록 동일).
  function openCompose(status) {
    clearTimeout(closeTimer.current)
    setClosing(false)
    if (openId) discardIfEmptyDraft(openId)
    const m = addMemo({ title: '', due: todayStr() })
    if (status === 'active') updateMemo(m.id, { stage: 'active' })
    else if (status === 'done') completeMemo(m.id)
    setOpenId(m.id)
  }

  // 왼쪽 메뉴 빈 곳이나 "메모"를 누르면 보관함·휴지통을 닫고 메모 화면으로 돌아간다
  function backToMemo() {
    setOpenId(null)
    setShowKeep(false)
    setShowHold(false)
    setShowTrash(false)
    setShowRoutine(false)
  }

  // 왼쪽 메뉴는 한 번에 하나만 켜진다 — 켜져 있던 걸 끄고 그 화면으로
  function goTo(which) {
    setOpenId(null)
    setShowKeep(which === 'keep' && !showKeep)
    setShowHold(which === 'hold' && !showHold)
    setShowTrash(which === 'trash' && !showTrash)
    setShowRoutine(which === 'routine' && !showRoutine)
  }

  // 이번 달 회차를 채운다 — 루틴에 걸린 일이 오늘 화면·달력에 뜨려면 그 달 메모가 있어야 한다.
  // 지난 달은 자동으로 만들지 않는다(안 한 달이 우르르 살아나 화면을 덮는다). (2026-08-11)
  useEffect(() => {
    if (auth.ready) ensureThisMonth()
  }, [auth.ready, routines.length])

  // 가져오기 — 백업 파일이나 엑셀에서 변환한 파일을 그대로 받는다
  function importFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const n = importData(JSON.parse(reader.result))
        window.alert(
          n.memos + n.routines === 0
            ? '이미 다 들어 있는 내용입니다 (새로 추가된 것 없음)'
            : `가져왔습니다 — 루틴 ${n.routines}건, 메모 ${n.memos}건`
        )
      } catch (e) {
        window.alert('가져오지 못했습니다: ' + e.message)
      }
    }
    reader.readAsText(file)
  }

  // 닫기 — PC는 오른쪽으로 미끄러져 나간 뒤 사라진다. 빈 초안이면 지운다.
  function closePanel() {
    const closingId = openId
    if (narrow) {
      setOpenId(null)
      discardIfEmptyDraft(closingId)
      return
    }
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setOpenId(null)
      setClosing(false)
      discardIfEmptyDraft(closingId)
    }, 160)
  }

  // 빈 곳을 누르면(또는 Esc) 패널이 닫힌다. 메모를 여는 자리·+ 버튼은 예외.
  useEffect(() => {
    if (narrow || !open) return
    const KEEP_OPEN =
      '.detail, .panel-fold, .kb-card, .kb-add, .row, .mv-table tbody tr, .tlv-label, .tlv-bar, .cal-ev, .cal-period-chip, .update-bar, .undo-bar'
    const onDown = (e) => {
      if (e.target.closest && e.target.closest(KEEP_OPEN)) return
      closePanel()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // 입력 중일 땐 그 입력의 Esc(수정 취소)가 우선
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      closePanel()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [narrow, open])

  // 폰: 누른 줄 바로 아래에 상세를 펼침 (각 뷰가 자기 줄 밑에서 호출)
  const renderDetail = (id) => {
    if (!narrow || openId !== id) return null
    if (open && open.id === id) {
      return (
        <MemoDetail key={open.id} inline memo={open} onOpen={openMemo} onClose={() => setOpenId(null)} />
      )
    }
    return null
  }

  if (hasSupabase && !auth.ready) return null
  if (hasSupabase && !auth.loggedIn) return <Login />

  const sidePanel = !narrow

  return (
    <div className={'app app-mid' + (sidePanel && open ? ' with-detail' : '')}>
      {updateReady && (
        <div className="update-bar">
          새 버전이 배포됐습니다
          <button onClick={() => window.location.reload()}>새로고침</button>
        </div>
      )}
      {!narrow && (
        <aside
          className="sidenav"
          onClick={(e) => {
            // 빈 곳(버튼·탭이 아닌 곳)을 누르면 메모 화면으로 돌아간다
            if (e.target.closest('button, .stab')) return
            backToMemo()
          }}
        >
          <div className="brand">내 기록</div>
          {hasSupabase && auth.loggedIn && (
            <button className="who" title="탭하면 진단 결과가 뜹니다" onClick={runDiagnostics}>
              {auth.email}
            </button>
          )}
          <button
            className={'stab' + (!showKeep && !showHold && !showTrash && !showRoutine ? ' on' : '')}
            onClick={backToMemo}
          >
            <span className="stab-ic">{ICONS.memo}</span>메모
          </button>
          {/* 루틴 — 매달·해마다 도는 일. 메모와 나란한 항목이지 메모의 상태가 아니다 (2026-08-11) */}
          <button
            className={'stab' + (showRoutine ? ' on' : '')}
            title="매달·분기·해마다 도는 일을 1년 격자로 — 칸을 누르면 그 달 완료"
            onClick={() => goTo('routine')}
          >
            <span className="stab-ic">{ICONS.routine}</span>루틴
            {routineLeft > 0 && <span className="stab-n">{routineLeft}</span>}
          </button>
          <button
            className={'stab' + (showHold ? ' on' : '')}
            title="하다가 멈췄거나 기약이 없어진 일 — 날짜를 떼서 넣어두고 필요할 때 꺼내는 곳"
            onClick={() => goTo('hold')}
          >
            <span className="stab-ic">{ICONS.hold}</span>보류함
            {holds.length > 0 && <span className="stab-n">{holds.length}</span>}
          </button>
          <button
            className={'stab' + (showKeep ? ' on' : '')}
            title="날짜 없이 넣어둔 메모 모음 — 필요할 때 꺼내 보는 곳"
            onClick={() => goTo('keep')}
          >
            <span className="stab-ic">{ICONS.keep}</span>보관함
            {keeps.length > 0 && <span className="stab-n">{keeps.length}</span>}
          </button>
          <button
            className={'stab' + (showTrash ? ' on' : '')}
            title="삭제한 메모는 30일 보관 후 자동 삭제 — 그 안에 복구 가능"
            onClick={() => goTo('trash')}
          >
            <span className="stab-ic">{ICONS.trash}</span>휴지통
            {trash.length > 0 && <span className="stab-n">{trash.length}</span>}
          </button>
          <button className="stab" title="메모·루틴 전체를 JSON 파일로 저장 — 사고 대비 보험" onClick={downloadBackup}>
            <span className="stab-ic">{ICONS.backup}</span>백업
          </button>
          {/* 가져오기 — 백업 파일 되돌리기 겸 엑셀에서 변환한 루틴 넣기 (2026-08-11).
              지금까지는 내보내기만 있어서 백업 파일을 만들어도 되돌릴 길이 없었다 */}
          <label className="stab stab-file" title="백업 파일이나 변환 파일(JSON)을 읽어 없는 것만 추가합니다">
            <span className="stab-ic">{ICONS.restore}</span>가져오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                importFile(e.target.files[0])
                e.target.value = ''
              }}
            />
          </label>
          <div className="sidenav-foot">
            {hasSupabase && auth.loggedIn && (
              <button className="stab stab-foot" title={auth.email} onClick={signOut}>
                <span className="stab-ic">{ICONS.out}</span>로그아웃
              </button>
            )}
          </div>
        </aside>
      )}
      <div className="workarea">
        {/* 폰 상단 — PC 사이드바와 같은 아이콘 언어로 한 줄에 (2026-08-05).
            예전엔 이메일+보류함/보관함/휴지통/백업/로그아웃이 작은 글자로 두 줄을 차지했다. */}
        {narrow && (
          <header className="topbar">
            <div className="brand">
              내 기록
              {hasSupabase && auth.loggedIn && (
                <button
                  className={'sync-dot' + (auth.syncError ? ' bad' : '')}
                  title={auth.email}
                  aria-label="동기화 상태 — 누르면 진단 결과"
                  onClick={runDiagnostics}
                />
              )}
              {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
            </div>
            <nav className="ptabs">
              {[
                ['routine', ICONS.routine, '루틴', routineLeft, showRoutine, () => goTo('routine')],
                ['hold', ICONS.hold, '보류함', holds.length, showHold, () => goTo('hold')],
                ['keep', ICONS.keep, '보관함', keeps.length, showKeep, () => goTo('keep')],
                ['trash', ICONS.trash, '휴지통', trash.length, showTrash, () => goTo('trash')],
              ].map(([key, icon, label, n, on, go]) => (
                <button
                  key={key}
                  className={'ptab' + (on ? ' on' : '')}
                  title={label}
                  aria-label={label}
                  onClick={() => { setOpenId(null); go() }}
                >
                  {icon}
                  {n > 0 && <span className="ptab-n">{n}</span>}
                </button>
              ))}
              <button className="ptab" title="백업" aria-label="백업" onClick={downloadBackup}>
                {ICONS.backup}
              </button>
              {hasSupabase && auth.loggedIn && (
                <button className="ptab" title="로그아웃" aria-label="로그아웃" onClick={signOut}>
                  {ICONS.out}
                </button>
              )}
            </nav>
          </header>
        )}
        {/* 화면마다 안전장치 — 한 화면이 잘못돼도 왼쪽 메뉴는 살아 있어 다른 화면으로 갈 수 있다.
            key가 바뀌면(=다른 화면으로 옮기면) 오류 상태가 저절로 풀린다 (2026-08-11) */}
        <ErrorBoundary key={screen}>
        {showTrash ? (
          <TrashView memos={trash} onClose={() => setShowTrash(false)} />
        ) : showRoutine ? (
          <div className="layout">
            <main>
              <RoutineView routines={routines} memos={memos} onOpen={openMemo} renderDetail={renderDetail} />
            </main>
            {sidePanel && open && (
              <MemoDetail key={open.id} memo={open} closing={closing} onOpen={openMemo} onClose={closePanel} />
            )}
          </div>
        ) : showHold ? (
          <div className="layout">
            <main>
              <HoldView
                memos={holds}
                onOpen={openMemo}
                renderDetail={renderDetail}
                onClose={() => setShowHold(false)}
              />
            </main>
            {sidePanel && open && (
              <MemoDetail key={open.id} memo={open} closing={closing} onOpen={openMemo} onClose={closePanel} />
            )}
          </div>
        ) : showKeep ? (
          <div className="layout">
            <main>
              <KeepView
                memos={keeps}
                onOpen={openMemo}
                renderDetail={renderDetail}
                onClose={() => setShowKeep(false)}
              />
            </main>
            {sidePanel && open && (
              <MemoDetail key={open.id} memo={open} closing={closing} onOpen={openMemo} onClose={closePanel} />
            )}
          </div>
        ) : (
          <div className="layout">
            <main>
              <MemosView memos={memos} dayOrder={dayOrder} onOpen={openMemo} onCompose={openCompose} renderDetail={renderDetail} />
            </main>
            {sidePanel && open && (
              <MemoDetail key={open.id} memo={open} closing={closing} onOpen={openMemo} onClose={closePanel} />
            )}
          </div>
        )}
        </ErrorBoundary>
      </div>
      {/* 하단 상태줄 — 엑셀식: 건수 + 동기화 상태 (PC 전용, 2026-07-30 시안) */}
      {!narrow && (
        <div className="statusbar">
          <span>메모 {memos.length}건</span>
          <span className="sb-sync">
            <span
              className={
                'sb-dot' +
                (!hasSupabase || !auth.loggedIn ? ' off' : auth.syncError ? ' bad' : '')
              }
            />
            {!hasSupabase
              ? '로컬 저장'
              : !auth.loggedIn
                ? '로그인 안 됨'
                : auth.syncError
                  ? '동기화 안 됨'
                  : '동기화 정상'}
          </span>
        </div>
      )}
    </div>
  )
}
