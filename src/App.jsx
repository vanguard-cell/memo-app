import { useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getDayOrder, getAuth, signOut } from './store'
import { hasSupabase } from './supabase'
import { nagCount } from './derive'
import InputBar from './components/InputBar'
import MemoDetail from './components/MemoDetail'
import Login from './components/Login'
import TodayView from './views/TodayView'
import CalendarView from './views/CalendarView'
import MemosView from './views/MemosView'

const TABS = [
  { id: 'today', label: '오늘' },
  { id: 'calendar', label: '달력' },
  { id: 'memos', label: '메모' },
]

export default function App() {
  const memos = useSyncExternalStore(subscribe, getMemos)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const open = memos.find((m) => m.id === openId)
  const nags = nagCount(memos)

  if (hasSupabase && !auth.ready) return null
  if (hasSupabase && !auth.loggedIn) return <Login />

  return (
    <div className={'app' + (open ? ' with-detail' : '')}>
      <header className="topbar">
        <div className="brand">
          내 기록
          {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'today' && nags > 0 && <span className="nag-badge">{nags}</span>}
            </button>
          ))}
          {hasSupabase && auth.loggedIn && (
            <button className="tab tab-logout" title={auth.email} onClick={signOut}>
              로그아웃
            </button>
          )}
        </nav>
      </header>
      <InputBar memos={memos} onOpen={setOpenId} />
      <div className="layout">
        <main>
          {tab === 'today' && <TodayView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} />}
          {tab === 'calendar' && <CalendarView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} />}
          {tab === 'memos' && <MemosView memos={memos} onOpen={setOpenId} />}
        </main>
        {open && <MemoDetail memo={open} onClose={() => setOpenId(null)} />}
      </div>
    </div>
  )
}
