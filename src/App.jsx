import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  subscribe, getMemos, getTrash, getDayOrder, getAuth, signOut, downloadBackup, runDiagnostics,
  addMemo, updateMemo, completeMemo, purgeMemos,
  getRoutines, ensureThisMonth, importData, importRoutineRows,
} from './store'
import { readRoutineXlsx } from './importXlsx'
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

  // 가져오기 — 백업 파일(.json)과 월간체크리스트 엑셀(.xlsx) 둘 다 받는다.
  // 엑셀은 「항목명」 열이 있는 표를 찾아 루틴으로 읽는다 (src/importXlsx.js).
  async function importFile(file) {
    if (!file) return
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const year = new Date().getFullYear()
        const parsed = await readRoutineXlsx(file, year)
        const ok = window.confirm(
          `「${file.name}」의 [${parsed.sheet}] 시트에서 ${parsed.rows.length}건을 읽었습니다.\n` +
            `${year}년 루틴으로 넣을까요?\n\n` +
            '· 이름이 같은 루틴은 묶음·설명만 갱신됩니다 (예정일·주기·중단은 그대로)\n' +
            '· 표에 표시된 달은 그 달 완료로 들어갑니다'
        )
        if (!ok) return
        const n = importRoutineRows(parsed)
        window.alert(
          `엑셀에서 가져왔습니다 — 새 루틴 ${n.added}건, 갱신 ${n.updated}건, 지난 완료 ${n.cycles}건`
        )
        return
      }
      const n = importData(JSON.parse(await file.text()))
      window.alert(
        n.memos + n.routines === 0
          ? '이미 다 들어 있는 내용입니다 (새로 추가된 것 없음)'
          : `가져왔습니다 — 루틴 ${n.routines}건, 메모 ${n.memos}건`
      )
    } catch (e) {
      console.error('가져오기 실패', e)
      // 브라우저의 NotReadableError — 파일을 고른 뒤 읽으려는 순간 막힌 것.
      // 열에 아홉은 그 파일을 엑셀에서 열어둔 상태다(윈도우가 잠근다). 원문이 영어라 풀어 쓴다.
      const locked = /NotReadableError|could not be read|permission/i.test(
        (e && (e.name + ' ' + e.message)) || ''
      )
      window.alert(
        locked
          ? '파일을 읽지 못했습니다.\n\n' +
              '· 그 엑셀을 지금 엑셀 프로그램에서 열어두셨다면 닫고 다시 시도해 주세요 (열려 있으면 파일이 잠깁니다)\n' +
              '· 그래도 안 되면 파일을 바탕화면에 복사해서 그 복사본을 골라 보세요\n' +
              '· 회사 보안 프로그램이 브라우저의 파일 읽기를 막는 경우도 있습니다'
          : '가져오지 못했습니다: ' + e.message
      )
    }
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
      '.detail, .panel-fold, .kb-card, .kb-add, .row, .mv-table tbody tr, .tlv-label, .tlv-bar, .cal-ev, .cal-period-chip, .update-bar, .undo-bar, .rt-row, .rt-paste, .rt-edit-row'
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
            // 빈 곳(버튼·탭이 아닌 곳)을 누르면 열린 상세만 닫는다.
            // 예전엔 메모 화면으로 돌아갔는데, 루틴·보관함을 보다가 옆을 잘못 눌러
            // 화면이 통째로 바뀌는 게 놀랍다는 지적 (2026-08-11).
            // 화면은 왼쪽 메뉴를 눌렀을 때만 바뀐다 — 달력에서 빈 곳을 눌러도
            // 달력이 그대로 있고 상세만 닫히는 것과 같은 규칙.
            if (e.target.closest('button, .stab')) return
            setOpenId(null)
          }}
        >
          <div className="brand">내 기록</div>
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
          {/* 위는 "매일 쓰는 화면"(메모·루틴)만. 나머지 서랍(보류함·보관함·휴지통)과
              도구(백업·가져오기)는 아래에 아이콘 한 줄로 내렸다 — 폰 상단 줄과 같은 문법.
              계정도 로그아웃 옆으로 (2026-08-11 사용자 지시) */}
          <div className="sidenav-foot">
            <div className="sfoot-row">
              {[
                ['hold', ICONS.hold, '보류함', holds.length, showHold, () => goTo('hold')],
                ['keep', ICONS.keep, '보관함', keeps.length, showKeep, () => goTo('keep')],
                ['trash', ICONS.trash, '휴지통', trash.length, showTrash, () => goTo('trash')],
              ].map(([key, icon, label, n, on, go]) => (
                <button key={key} className={'sfoot-ic' + (on ? ' on' : '')} title={label} aria-label={label} onClick={go}>
                  {icon}
                  {n > 0 && <span className="sfoot-n">{n}</span>}
                </button>
              ))}
              <button
                className="sfoot-ic"
                title="백업 — 메모·루틴 전체를 JSON 파일로 저장 (사고 대비 보험)"
                aria-label="백업"
                onClick={downloadBackup}
              >
                {ICONS.backup}
              </button>
              {/* 가져오기 — 백업 되돌리기 겸 엑셀에서 루틴 읽어오기 (2026-08-11) */}
              <label
                className="sfoot-ic"
                title="가져오기 — 백업 파일(JSON) 되돌리기 · 월간체크리스트 엑셀(XLSX)에서 루틴 읽어오기"
              >
                {ICONS.restore}
                <input
                  type="file"
                  accept="application/json,.json,.xlsx,.xls"
                  onChange={(e) => {
                    importFile(e.target.files[0])
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            {hasSupabase && auth.loggedIn && (
              <>
                <button className="who" title="누르면 진단 결과가 뜹니다" onClick={runDiagnostics}>
                  {auth.email}
                </button>
                <button className="stab stab-foot" title={auth.email} onClick={signOut}>
                  <span className="stab-ic">{ICONS.out}</span>로그아웃
                </button>
              </>
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
              <MemosView memos={memos} routines={routines} dayOrder={dayOrder} onOpen={openMemo} onCompose={openCompose} renderDetail={renderDetail} />
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
