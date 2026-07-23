import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getTrash, getDayOrder, getAuth, signOut, downloadBackup, runDiagnostics } from './store'
import { hasSupabase } from './supabase'
import useIsNarrow from './useIsNarrow'
import MemoDetail from './components/MemoDetail'
import ComposePanel from './components/ComposePanel'
import Login from './components/Login'
import MemosView from './views/MemosView'
import TrashView from './views/TrashView'
import KeepView from './views/KeepView'

// 화면은 하나(메모) — 오늘 탭은 2026-07-15 요약 타일로 흡수, 달력 탭은 메모탭 보기로 흡수,
// 점검탭은 2026-07-14 제거(데이터는 store·서버 보존, 반복 기한 변환 예정).

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
  const [compose, setCompose] = useState(null) // 새 메모 작성 패널의 상태(todo/active/done) 또는 null
  const [showTrash, setShowTrash] = useState(false)
  const [showKeep, setShowKeep] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const keeps = memos.filter((m) => m.keep)
  const narrow = useIsNarrow()
  const updateReady = useUpdateReady()
  const open = memos.find((m) => m.id === openId)

  // 메모 열기 — 닫히는 중이었다면 취소하고 그대로 이어서 연다 (작성 패널이 떠 있었으면 닫는다)
  function openMemo(id) {
    clearTimeout(closeTimer.current)
    setClosing(false)
    setCompose(null)
    setOpenId(id)
  }

  // 보드 칸의 + — 그 칸 상태로 새 메모 작성 패널을 연다
  function openCompose(status) {
    clearTimeout(closeTimer.current)
    setClosing(false)
    setOpenId(null)
    setCompose(status)
  }

  // 닫기 — PC는 오른쪽으로 미끄러져 나간 뒤 사라진다 (상세·작성 패널 공통)
  function closePanel() {
    if (narrow) {
      setOpenId(null)
      setCompose(null)
      return
    }
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setOpenId(null)
      setCompose(null)
      setClosing(false)
    }, 160)
  }

  // 빈 곳을 누르면(또는 Esc) 패널이 닫힌다. 메모를 여는 자리·+ 버튼은 예외.
  useEffect(() => {
    if (narrow || (!open && !compose)) return
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
  }, [narrow, open, compose])

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
    <div className={'app app-mid' + (sidePanel && (open || compose) ? ' with-detail' : '')}>
      {updateReady && (
        <div className="update-bar">
          새 버전이 배포됐습니다
          <button onClick={() => window.location.reload()}>새로고침</button>
        </div>
      )}
      {!narrow && (
        <aside className="sidenav">
          <div className="brand">
            내 기록
            {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
          </div>
          <div className="stab on">메모</div>
          <div className="sidenav-foot">
            {hasSupabase && auth.loggedIn && (
              <button className="who" title="탭하면 진단 결과가 뜹니다" onClick={runDiagnostics}>
                {auth.email}
              </button>
            )}
            <button
              className="stab stab-foot"
              title="날짜 없이 넣어둔 메모 모음 — 필요할 때 꺼내 보는 곳"
              onClick={() => { setOpenId(null); setShowTrash(false); setShowKeep((v) => !v) }}
            >
              보관함{keeps.length > 0 ? ` ${keeps.length}` : ''}
            </button>
            <button
              className="stab stab-foot"
              title="삭제한 메모는 30일 보관 후 자동 삭제 — 그 안에 복구 가능"
              onClick={() => { setOpenId(null); setShowKeep(false); setShowTrash((v) => !v) }}
            >
              휴지통{trash.length > 0 ? ` ${trash.length}` : ''}
            </button>
            <button className="stab stab-foot" title="메모·점검 전체를 JSON 파일로 저장 — 사고 대비 보험" onClick={downloadBackup}>
              백업
            </button>
            {hasSupabase && auth.loggedIn && (
              <button className="stab stab-foot" title={auth.email} onClick={signOut}>
                로그아웃
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
              <button className="tab tab-logout" onClick={() => { setOpenId(null); setShowTrash(false); setShowKeep((v) => !v) }}>
                보관함{keeps.length > 0 ? ` ${keeps.length}` : ''}
              </button>
              <button className="tab tab-logout" onClick={() => { setOpenId(null); setShowKeep(false); setShowTrash((v) => !v) }}>
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
            {/* 작성 패널: PC는 오른쪽 고정, 폰은 화면을 덮는 오버레이(.detail 모바일 스타일) */}
            {compose && (
              <ComposePanel
                status={compose}
                closing={closing}
                onClose={closePanel}
                onCreated={(id) => openMemo(id)}
              />
            )}
            {sidePanel && !compose && open && (
              <MemoDetail key={open.id} memo={open} closing={closing} onOpen={openMemo} onClose={closePanel} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
