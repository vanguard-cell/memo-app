import { useMemo, useState } from 'react'
import MemoRow from '../components/MemoRow'
import { memoStatus, companies, fmtDate } from '../derive'
import { getWorks, getDayOrder } from '../store'
import { todayStr } from '../parser'

// 전체 백업 — 메모·점검·순서를 JSON 파일로 내려받는다 (복원은 이 파일로 가능)
function downloadBackup(memos) {
  const data = {
    app: '내 기록',
    exportedAt: new Date().toISOString(),
    memos,
    works: getWorks(),
    dayOrder: getDayOrder(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `내기록-백업-${todayStr()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const STATUS = [
  ['all', '전체'],
  ['todo', '할일'],
  ['active', '진행중'],
  ['done', '완료'],
]

export default function MemosView({ memos, onOpen, renderDetail }) {
  const [q, setQ] = useState('')
  const [st, setSt] = useState('all')
  const [co, setCo] = useState(null)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const cos = useMemo(() => companies(memos), [memos])

  const list = memos
    .filter((m) => {
      if (st !== 'all' && memoStatus(m) !== st) return false
      if (co && m.company !== co) return false
      if (words.length) {
        const hay = [m.title, m.company, ...m.history.map((h) => h.text)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  // 진행 중인 것 먼저, 완료는 아래로 분리
  const openList = list.filter((m) => memoStatus(m) !== 'done')
  const doneList = list.filter((m) => memoStatus(m) === 'done')

  return (
    <div className="view">
      <input
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="검색 — 제목·진행기록·업체, 완료된 것까지"
      />
      <div className="filters wrap">
        {STATUS.map(([id, label]) => (
          <button key={id} className={'pill' + (st === id ? ' on' : '')} onClick={() => setSt(id)}>
            {label}
          </button>
        ))}
        {cos.length > 0 && <span className="pill-sep" />}
        {cos.map((name) => (
          <button key={name} className={'pill' + (co === name ? ' on' : '')} onClick={() => setCo(co === name ? null : name)}>
            {name}
          </button>
        ))}
        <span className="count">{list.length}건</span>
        <button className="pill pill-backup" title="메모·점검 전체를 JSON 파일로 저장" onClick={() => downloadBackup(memos)}>
          백업
        </button>
      </div>
      {list.length === 0 && <div className="empty">해당하는 메모가 없습니다.</div>}
      {[...openList, ...doneList].map((m, i) => {
        const matched = words.length
          ? m.history.filter((h) => words.some((w) => h.text.toLowerCase().includes(w))).slice(0, 3)
          : []
        const firstDone = st === 'all' && doneList.length > 0 && i === openList.length
        return (
          <div key={m.id}>
            {firstDone && <div className="done-divider">완료 · {doneList.length}건</div>}
            <MemoRow memo={m} onOpen={onOpen} />
            {renderDetail && renderDetail(m.id)}
            {matched.length > 0 && (
              <div className="hit-lines">
                {matched.map((h, i2) => (
                  <div key={i2} className="hit-line">
                    <span>{fmtDate(h.date)}</span> {h.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
