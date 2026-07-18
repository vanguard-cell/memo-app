import { useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getDayOrder, getAuth, signOut, downloadBackup, runDiagnostics } from './store'
import { hasSupabase } from './supabase'
import useIsNarrow from './useIsNarrow'
import InputBar from './components/InputBar'
import MemoDetail from './components/MemoDetail'
import Login from './components/Login'
import MemosView from './views/MemosView'

// 화면은 하나(메모) — 오늘 탭은 2026-07-15 요약 타일로 흡수, 달력 탭은 메모탭 보기로 흡수,
// 점검탭은 2026-07-14 제거(데이터는 store·서버 보존, 반복 기한 변환 예정).

export default function App() {
  const memos = useSyncExternalStore(subscribe, getMemos)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const [openId, setOpenId] = useState(null)
  const narrow = useIsNarrow()
  const open = memos.find((m) => m.id === openId)

  // 폰: 누른 줄 바로 아래에 상세를 펼침 (각 뷰가 자기 줄 밑에서 호출)
  const renderDetail = (id) => {
    if (!narrow || openId !== id) return null
    if (open && open.id === id) {
      return (
        <MemoDetail key={open.id} inline memo={open} onOpen={setOpenId} onClose={() => setOpenId(null)} />
      )
    }
    return null
  }

  if (hasSupabase && !auth.ready) return null
  if (hasSupabase && !auth.loggedIn) return <Login />

  const sidePanel = !narrow

  return (
    <div className={'app app-mid' + (sidePanel && open ? ' with-detail' : '')}>
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
        <InputBar />
        <div className="layout">
          <main>
            <MemosView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} renderDetail={renderDetail} />
          </main>
          {sidePanel && open && (
            <MemoDetail key={open.id} memo={open} onOpen={setOpenId} onClose={() => setOpenId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}
