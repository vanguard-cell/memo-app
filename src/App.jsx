import { useEffect, useState, useSyncExternalStore } from 'react'
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
  const works = useSyncExternalStore(subscribe, getWorks)
  const dayOrder = useSyncExternalStore(subscribe, getDayOrder)
  const auth = useSyncExternalStore(subscribe, getAuth)
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const narrow = useIsNarrow()
  const open = memos.find((m) => m.id === openId)
  const openWork = works.find((w) => w.id === openId)
  const nags = nagCount(memos)
  const workNags = openWorkCount(works)

  // 폰: 누른 줄 바로 아래에 상세를 펼침 (각 뷰가 자기 줄 밑에서 호출)
  const renderDetail = (id) => {
    if (!narrow || openId !== id) return null
    if (open && open.id === id) {
      return (
        <MemoDetail key={open.id} inline memo={open} works={works} onOpen={setOpenId} onClose={() => setOpenId(null)} />
      )
    }
    if (openWork && openWork.id === id) {
      return (
        <WorkDetail key={openWork.id} inline work={openWork} memos={memos} onOpen={setOpenId} onClose={() => setOpenId(null)} />
      )
    }
    return null
  }

  if (hasSupabase && !auth.ready) return null
  if (hasSupabase && !auth.loggedIn) return <Login />

  const sidePanel = !narrow

  return (
    <div className={'app' + (sidePanel && (open || openWork) ? ' with-detail' : '') + (tab === 'work' ? ' app-wide' : '')}>
      <header className="topbar">
        <div className="brand">
          내 기록
          {hasSupabase && auth.syncError && <span className="sync-bad">동기화 안 됨</span>}
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={'tab' + (tab === t.id ? ' on' : '')}
              onClick={() => {
                setTab(t.id)
                if (t.id !== tab) setOpenId(null)
              }}
            >
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
              renderDetail={renderDetail}
            />
          )}
          {tab === 'calendar' && (
            <CalendarView memos={memos} dayOrder={dayOrder} onOpen={setOpenId} renderDetail={renderDetail} />
          )}
          {tab === 'memos' && <MemosView memos={memos} onOpen={setOpenId} renderDetail={renderDetail} />}
          {tab === 'work' && <WorkView works={works} onOpen={setOpenId} renderDetail={renderDetail} />}
        </main>
        {sidePanel && open && (
          <MemoDetail key={open.id} memo={open} works={works} onOpen={setOpenId} onClose={() => setOpenId(null)} />
        )}
        {sidePanel && openWork && (
          <WorkDetail
            key={openWork.id}
            work={openWork}
            memos={memos}
            onOpen={setOpenId}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </div>
  )
}
