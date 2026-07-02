import { useState, useSyncExternalStore } from 'react'
import { subscribe, getMemos, getDayOrder } from './store'
import { nagCount } from './derive'
import InputBar from './components/InputBar'
import MemoDetail from './components/MemoDetail'
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
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const open = memos.find((m) => m.id === openId)
  const nags = nagCount(memos)

  return (
    <div className={'app' + (open ? ' with-detail' : '')}>
      <header className="topbar">
        <div className="brand">내 기록</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'today' && nags > 0 && <span className="nag-badge">{nags}</span>}
            </button>
          ))}
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
