import { useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getWorks, getDayOrder, getAuth, signOut } from './store'
import { hasSupabase } from './supabase'
import { nagCount } from './derive'
import InputBar from './components/InputBar'
import MemoDetail from './components/MemoDetail'
import WorkDetail from './components/WorkDetail'
import Login from './components/Login'
import TodayView from './views/TodayView'
import CalendarView from './views/CalendarView'
import MemosView from './views/MemosView'
import WorkView, { ymOf } from './views/WorkView'

const TABS = [
  { id: 'today', label: '오늘' },
  { id: 'calendar', label: '달력' },
  { id: 'memos', label: '메모' },
  { id: 'work', label: '점검' },
]

export function openWorkCount(works) {
  const now = new Date()
  const m = now.getMonth() + 1
  const ym = ymOf(now.getFullYear(), m)
  return works.filter(
    (w) => (w.months || []).includes(m) && !(w.runs && w.runs[ym] && w.runs[ym].done)
  ).length
}

export default function App() {
  const memos = useSyncExternalStore(subscribe, getMemos)
  const works = useSyncExternalStore(subscribe, getWorks)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const open = memos.find((m) => m.id === openId)
  const openWork = works.find((w) => w.id === openId)
  const nags = nagCount(memos)
  const workNags = openWorkCount(works)

  if (hasSupabase && !auth.ready) return null
  if (hasSupabase && !auth.loggedIn) return <Login />

  return (
    <div className={'app' + (open || openWork ? ' with-detail' : '') + (tab === 'work' ? ' app-wide' : '')}>
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
              {t.id === 'work' && workNags > 0 && <span className="nag-badge">{workNags}</span>}
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
          {tab === 'today' && (
            <TodayView
              memos={memos}
              works={works}
              dayOrder={dayOrder}
              onOpen={setOpenId}
            />
          )}
          {tab === 'calendar' && <CalendarView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} />}
          {tab === 'memos' && <MemosView memos={memos} onOpen={setOpenId} />}
          {tab === 'work' && <WorkView works={works} onOpen={setOpenId} />}
        </main>
        {open && <MemoDetail key={open.id} memo={open} onClose={() => setOpenId(null)} />}
        {openWork && <WorkDetail key={openWork.id} work={openWork} onClose={() => setOpenId(null)} />}
      </div>
    </div>
  )
}
