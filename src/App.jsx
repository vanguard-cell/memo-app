import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getDayOrder, getAuth, signOut } from './store'
import { hasSupabase } from './supabase'
import { nagCount } from './derive'
import InputBar from './components/InputBar'
import MemoDetail from './components/MemoDetail'
import Login from './components/Login'
import TodayView from './views/TodayView'
import MemosView from './views/MemosView'

// 점검탭은 2026-07-14 제거(데이터는 store·서버 보존, 반복 기한 변환 예정).
// 달력 탭은 2026-07-15 메모탭의 "달력" 보기로 흡수.
const TABS = [
  { id: 'today', label: '오늘' },
  { id: 'memos', label: '메모' },
]

// 화면이 좁으면(폰) 상세를 우측 패널 대신 누른 줄 아래에 펼친다
function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const update = () => setNarrow(mq.matches)
    mq.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      mq.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return narrow
}

export default function App() {
  const memos = useSyncExternalStore(subscribe, getMemos)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const narrow = useIsNarrow()
  const open = memos.find((m) => m.id === openId)
  const nags = nagCount(memos)

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

  const switchTab = (id) => {
    setTab(id)
    if (id !== tab) setOpenId(null)
  }

  const tabBadge = (t) => (
    <>{t.id === 'today' && nags > 0 && <span className="nag-badge">{nags}</span>}</>
  )

  return (
    <div className={'app' + (sidePanel && open ? ' with-detail' : '') + (tab === 'memos' ? ' app-mid' : '')}>
      {!narrow && (
        <aside className="sidenav">
          <div className="brand">
            내 기록
            {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
          </div>
          {TABS.map((t) => (
            <button key={t.id} className={'stab' + (tab === t.id ? ' on' : '')} onClick={() => switchTab(t.id)}>
              {t.label}
              {tabBadge(t)}
            </button>
          ))}
          {hasSupabase && auth.loggedIn && (
            <button className="stab stab-logout" title={auth.email} onClick={signOut}>
              로그아웃
            </button>
          )}
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
              {TABS.map((t) => (
                <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => switchTab(t.id)}>
                  {t.label}
                  {tabBadge(t)}
                </button>
              ))}
              {hasSupabase && auth.loggedIn && (
                <button className="tab tab-logout" title={auth.email} onClick={signOut}>
                  로그아웃
                </button>
              )}
            </nav>
          </header>
        )}
        <InputBar memos={memos} onOpen={setOpenId} />
        <div className="layout">
          <main>
            {tab === 'today' && (
              <TodayView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} renderDetail={renderDetail} />
            )}
            {tab === 'memos' && <MemosView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} renderDetail={renderDetail} />}
          </main>
          {sidePanel && open && (
            <MemoDetail key={open.id} memo={open} onOpen={setOpenId} onClose={() => setOpenId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}
