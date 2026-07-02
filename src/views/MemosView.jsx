import { useMemo, useState } from 'react'
import MemoRow from '../components/MemoRow'
import { memoStatus, companies, fmtDate } from '../derive'

const STATUS = [
  ['all', '전체'],
  ['todo', '할일'],
  ['active', '진행중'],
  ['done', '완료'],
]

export default function MemosView({ memos, onOpen }) {
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
      </div>
      {list.length === 0 && <div className="empty">해당하는 메모가 없습니다.</div>}
      {list.map((m) => {
        const matched = words.length
          ? m.history.filter((h) => words.some((w) => h.text.toLowerCase().includes(w))).slice(0, 3)
          : []
        return (
          <div key={m.id}>
            <MemoRow memo={m} onOpen={onOpen} />
            {matched.length > 0 && (
              <div className="hit-lines">
                {matched.map((h, i) => (
                  <div key={i} className="hit-line">
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
