import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  subscribe, getMemos, getTrash, getDayOrder, getAuth, signOut, downloadBackup, runDiagnostics,
  addMemo, updateMemo, completeMemo, purgeMemos,
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

// 화면은 하나(메모) — 오늘 탭은 2026-07-15 요약 타일로 흡수, 달력 탭은 메모탭 보기로 흡수,
// 점검탭은 2026-07-14 제거(데이터는 store·서버 보존, 반복 기한 변환 예정).

// 사이드바 아이콘 — 라이브러리 없이 작은 인라인 SVG (2026-07-30 스티치 시안 리디자인)
const ic = (path) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)
const ICONS = {
  memo: ic(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  hold: ic(<><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>),
  keep: ic(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>),
  trash: ic(<><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></>),
  backup: ic(<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.1 8.5 4.5 4.5 0 0 0 6.5 19Z" />),
  out: ic(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>),
}

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
  const [openId, setOpenId] = useState(null)
  const [showTrash, setShowTrash] = useState(false)
  const [showKeep, setShowKeep] = useState(false)
  const [showHold, setShowHold] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const keeps = memos.filter((m) => m.keep)
  const holds = memos.filter((m) => m.hold)
  const narrow = useIsNarrow()
  const updateReady = useUpdateReady()
  const open = memos.find((m) => m.id === openId)

  // 제목·기록·설명이 모두 빈 "임시 메모"(+ 로 만들었다가 안 쓰고 닫은 것)는 완전히 지운다.
  // 톰스톤(휴지통)이 아니라 purge — 빈 초안이 휴지통에 쌓이지 않게.
  function discardIfEmptyDraft(id) {
    // 최신 store 상태를 직접 읽는다 (제목 저장 직후 닫힘 등 타이밍에서 stale 방지)
    const m = getMemos().find((x) => x.id === id)
    if (m && !(m.title || '').trim() && (!m.history || m.history.length === 0) && !(m.desc || '').trim() && !m.keep && !m.hold) {
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
      '.detail, .kb-card, .kb-add, .row, .mv-table tbody tr, .tlv-label, .tlv-bar, .cal-ev, .cal-period-chip, .update-bar, .undo-bar'
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
            className={'stab' + (!showKeep && !showHold && !showTrash ? ' on' : '')}
            onClick={backToMemo}
          >
            <span className="stab-ic">{ICONS.memo}</span>메모
          </button>
          <button
            className={'stab' + (showHold ? ' on' : '')}
            title="하다가 멈췄거나 기약이 없어진 일 — 날짜를 떼서 넣어두고 필요할 때 꺼내는 곳"
            onClick={() => { setOpenId(null); setShowTrash(false); setShowKeep(false); setShowHold((v) => !v) }}
          >
            <span className="stab-ic">{ICONS.hold}</span>보류함
            {holds.length > 0 && <span className="stab-n">{holds.length}</span>}
          </button>
          <button
            className={'stab' + (showKeep ? ' on' : '')}
            title="날짜 없이 넣어둔 메모 모음 — 필요할 때 꺼내 보는 곳"
            onClick={() => { setOpenId(null); setShowTrash(false); setShowHold(false); setShowKeep((v) => !v) }}
          >
            <span className="stab-ic">{ICONS.keep}</span>보관함
            {keeps.length > 0 && <span className="stab-n">{keeps.length}</span>}
          </button>
          <button
            className={'stab' + (showTrash ? ' on' : '')}
            title="삭제한 메모는 30일 보관 후 자동 삭제 — 그 안에 복구 가능"
            onClick={() => { setOpenId(null); setShowKeep(false); setShowHold(false); setShowTrash((v) => !v) }}
          >
            <span className="stab-ic">{ICONS.trash}</span>휴지통
            {trash.length > 0 && <span className="stab-n">{trash.length}</span>}
          </button>
          <button className="stab" title="메모·점검 전체를 JSON 파일로 저장 — 사고 대비 보험" onClick={downloadBackup}>
            <span className="stab-ic">{ICONS.backup}</span>백업
          </button>
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
        {narrow && (
          <header className="topbar">
            <div className="brand">
              내 기록
              {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
            </div>
            <nav className="tabs">
              {hasSupabase && auth.loggedIn && (
                <button className="who" title="탭하면 진단 결과가 뜹니다" onClick={runDiagnostics}>
                  {auth.email}
                </button>
              )}
              <button className="tab tab-logout" onClick={() => { setOpenId(null); setShowTrash(false); setShowKeep(false); setShowHold((v) => !v) }}>
                보류함{holds.length > 0 ? ` ${holds.length}` : ''}
              </button>
              <button className="tab tab-logout" onClick={() => { setOpenId(null); setShowTrash(false); setShowHold(false); setShowKeep((v) => !v) }}>
                보관함{keeps.length > 0 ? ` ${keeps.length}` : ''}
              </button>
              <button className="tab tab-logout" onClick={() => { setOpenId(null); setShowKeep(false); setShowHold(false); setShowTrash((v) => !v) }}>
                휴지통{trash.length > 0 ? ` ${trash.length}` : ''}
              </button>
              <button className="tab tab-logout" onClick={downloadBackup}>
                백업
              </button>
              {hasSupabase && auth.loggedIn && (
                <button className="tab tab-logout" title={auth.email} onClick={signOut}>
                  로그아웃
                </button>
              )}
            </nav>
          </header>
        )}
        {showTrash ? (
          <TrashView memos={trash} onClose={() => setShowTrash(false)} />
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
