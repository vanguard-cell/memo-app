import { Fragment, useMemo, useState } from 'react'
import { memoStatus, companies, fmtDate, fmtPeriod, diffDays, STATUS_LABEL } from '../derive'
import { completeMemo, reopenMemo, updateMemo, getWorks, getDayOrder } from '../store'
import { todayStr } from '../parser'

const pad = (n) => String(n).padStart(2, '0')

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

// 기한 배지: 며칠 밀림 / 오늘 / D-n
function dueBadge(m, today) {
  if (m.status === 'done' || m.keep) return null
  const end = m.due || (m.period && m.period.end)
  if (!end) return null
  const dd = diffDays(end, today)
  if (dd < 0) return ['b-red', `${-dd}일째`]
  if (dd === 0) return ['b-amber', '오늘']
  return ['b-gray', `D-${dd}`]
}

function checkInfo(m) {
  const items = (m.history || []).filter((h) => h.type !== 'log')
  if (!items.length) return null
  return `체크 ${items.filter((h) => h.done).length}/${items.length}`
}

const byUpdated = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)

// 보드에서 열 이동: 완료 열이면 완료 처리, 아니면 stage 지정 (완료였던 건 다시 연다)
function moveTo(m, col) {
  if (!m || memoStatus(m) === col) return
  if (col === 'done') {
    completeMemo(m.id)
    return
  }
  if (m.status === 'done') reopenMemo(m.id)
  updateMemo(m.id, { stage: col })
}

// ---------- 보드 ----------

const COLS = [
  ['todo', '할일'],
  ['active', '진행중'],
  ['done', '완료'],
]
const DONE_SHOWN = 8

function Card({ m, today, onOpen }) {
  const st = memoStatus(m)
  const badge = dueBadge(m, today)
  const chk = checkInfo(m)
  return (
    <div
      className={'kb-card' + (st === 'done' ? ' kb-done' : '')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'board', id: m.id }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onOpen(m.id)}
    >
      <div className="kb-title">{m.title}</div>
      {(badge || chk || m.company) && (
        <div className="kb-meta">
          {badge && <span className={'kb-badge ' + badge[0]}>{badge[1]}</span>}
          {chk && <span className="kb-badge b-gray">{chk}</span>}
          {m.company && <span className="chip chip-co">{m.company}</span>}
        </div>
      )}
      <div className="kb-actions">
        {st === 'todo' && (
          <button onClick={(e) => { e.stopPropagation(); moveTo(m, 'active') }}>시작 ›</button>
        )}
        {st === 'active' && (
          <button onClick={(e) => { e.stopPropagation(); moveTo(m, 'todo') }}>‹ 할일로</button>
        )}
        {st !== 'done' && (
          <button onClick={(e) => { e.stopPropagation(); moveTo(m, 'done') }}>완료 ›</button>
        )}
        {st === 'done' && (
          <button onClick={(e) => { e.stopPropagation(); moveTo(m, 'active') }}>‹ 다시 열기</button>
        )}
      </div>
    </div>
  )
}

function BoardView({ memos, onOpen, renderDetail }) {
  const today = todayStr()
  const [over, setOver] = useState(null)
  const by = { todo: [], active: [], done: [] }
  for (const m of memos) {
    const st = memoStatus(m)
    if (by[st]) by[st].push(m)
  }
  by.todo.sort(byUpdated)
  by.active.sort(byUpdated)
  by.done.sort(byUpdated)

  function drop(col, e) {
    e.preventDefault()
    setOver(null)
    let data
    try {
      data = JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch {
      return
    }
    if (data.kind !== 'board') return
    moveTo(memos.find((m) => m.id === data.id), col)
  }

  return (
    <div className="kb-grid-wrap">
      <div className="kb-grid">
        {COLS.map(([id, label]) => {
          const shown = id === 'done' ? by.done.slice(0, DONE_SHOWN) : by[id]
          return (
            <div
              key={id}
              className={'kb-col' + (over === id ? ' kb-over' : '')}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(id)
              }}
              onDragLeave={() => setOver((cur) => (cur === id ? null : cur))}
              onDrop={(e) => drop(id, e)}
            >
              <div className="kb-head">
                <span className={'badge st-' + id}>{label}</span>
                <span className="kb-count">{by[id].length}</span>
              </div>
              {shown.map((m) => (
                <Card key={m.id} m={m} today={today} onOpen={onOpen} />
              ))}
              {id === 'done' && by.done.length > DONE_SHOWN && (
                <div className="kb-more">외 {by.done.length - DONE_SHOWN}건 — 표에서 전체 보기</div>
              )}
              {by[id].length === 0 && <div className="kb-empty">여기로 끌어오기</div>}
            </div>
          )
        })}
      </div>
      {renderDetail && memos.map((m) => <Fragment key={'d' + m.id}>{renderDetail(m.id)}</Fragment>)}
    </div>
  )
}

// ---------- 표 ----------

const ORDER = { active: 0, todo: 1, keep: 2, done: 3 }

function TableView({ memos, words, onOpen, renderDetail }) {
  const today = todayStr()
  const list = [...memos].sort(
    (a, b) => ORDER[memoStatus(a)] - ORDER[memoStatus(b)] || byUpdated(a, b)
  )
  return (
    <div className="mv-table-wrap">
      <table className="mv-table">
        <thead>
          <tr>
            <th>상태</th>
            <th>제목</th>
            <th>업체</th>
            <th>기한·기간</th>
            <th>체크</th>
            <th>작성</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const st = memoStatus(m)
            const badge = dueBadge(m, today)
            const chk = checkInfo(m)
            const matched = words.length
              ? m.history.filter((h) => words.some((w) => h.text.toLowerCase().includes(w))).slice(0, 3)
              : []
            return (
              <Fragment key={m.id}>
                <tr className={st === 'done' ? 'mv-done' : ''} onClick={() => onOpen(m.id)}>
                  <td><span className={'badge st-' + st}>{STATUS_LABEL[st]}</span></td>
                  <td className="mv-title">{m.title}</td>
                  <td className="mv-date">{m.company || ''}</td>
                  <td className="mv-date">
                    {m.period ? fmtPeriod(m.period) : m.due ? fmtDate(m.due) : ''}
                    {badge && <span className={'kb-badge ' + badge[0]}> {badge[1]}</span>}
                  </td>
                  <td className="mv-date">{chk || ''}</td>
                  <td className="mv-date">{fmtDate(m.createdAt.slice(0, 10))}</td>
                </tr>
                {matched.length > 0 && (
                  <tr className="mv-hit">
                    <td colSpan={6}>
                      <div className="hit-lines">
                        {matched.map((h, i) => (
                          <div key={i} className="hit-line">
                            <span>{fmtDate(h.date)}</span> {h.text}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {list.length === 0 && <div className="empty small">해당하는 메모가 없습니다.</div>}
      {renderDetail && list.map((m) => <Fragment key={'d' + m.id}>{renderDetail(m.id)}</Fragment>)}
    </div>
  )
}

// ---------- 타임라인 ----------

function TimelineView({ memos, onOpen, renderDetail }) {
  const t = new Date()
  const [y, setY] = useState(t.getFullYear())
  const [mo, setMo] = useState(t.getMonth())
  const today = todayStr()
  const dim = new Date(y, mo + 1, 0).getDate()
  const first = `${y}-${pad(mo + 1)}-01`
  const last = `${y}-${pad(mo + 1)}-${pad(dim)}`
  const dayOf = (s) => Number(s.slice(8, 10))
  const todayDay = today >= first && today <= last ? dayOf(today) : null

  const items = memos
    .filter((m) => {
      if (m.keep) return false
      const s = m.period ? m.period.start : m.due
      const e = m.period ? m.period.end : m.due
      return s && e && s <= last && e >= first
    })
    .sort((a, b) =>
      (a.period ? a.period.start : a.due).localeCompare(b.period ? b.period.start : b.due)
    )

  function move(n) {
    const d = new Date(y, mo + n, 1)
    setY(d.getFullYear())
    setMo(d.getMonth())
  }

  const cols = { display: 'grid', gridTemplateColumns: `repeat(${dim}, 1fr)` }

  return (
    <div>
      <div className="cal-head">
        <button onClick={() => move(-1)}>‹</button>
        <span className="cal-title">{y}년 {mo + 1}월</span>
        <button onClick={() => move(1)}>›</button>
        <button
          className="cal-today-btn"
          onClick={() => {
            setY(t.getFullYear())
            setMo(t.getMonth())
          }}
        >
          오늘
        </button>
      </div>
      <div className="tlv-wrap">
        <div className="tlv">
          <div className="tlv-row">
            <div className="tlv-label" />
            <div className="tlv-hd" style={cols}>
              {Array.from({ length: dim }, (_, i) => i + 1).map((d) => (
                <span key={d} className={'tlv-d' + (d === todayDay ? ' tlv-today' : '')}>
                  {d === 1 || d % 5 === 0 || d === todayDay ? d : ''}
                </span>
              ))}
            </div>
          </div>
          {items.map((m) => {
            const st = memoStatus(m)
            const s = m.period ? m.period.start : m.due
            const e = m.period ? m.period.end : m.due
            const sd = s < first ? 1 : dayOf(s)
            const ed = e > last ? dim : dayOf(e)
            return (
              <div className="tlv-row" key={m.id}>
                <div className="tlv-label" onClick={() => onOpen(m.id)} title={m.title}>
                  {m.title}
                </div>
                <div className="tlv-days" style={cols}>
                  {todayDay && <span className="tlv-guide" style={{ gridColumn: `${todayDay} / ${todayDay + 1}` }} />}
                  <span
                    className={'tlv-bar tlv-' + st}
                    style={{ gridColumn: `${sd} / ${ed + 1}` }}
                    onClick={() => onOpen(m.id)}
                    title={`${m.title} (${fmtDate(s)}${s !== e ? ' ~ ' + fmtDate(e) : ''})`}
                  />
                </div>
              </div>
            )
          })}
          {items.length === 0 && <div className="empty small">이 달에 걸린 메모가 없습니다.</div>}
        </div>
      </div>
      {renderDetail && items.map((m) => <Fragment key={'d' + m.id}>{renderDetail(m.id)}</Fragment>)}
    </div>
  )
}

// ---------- 메모탭 ----------

const VIEWS = [
  ['board', '보드'],
  ['table', '표'],
  ['timeline', '타임라인'],
]

export default function MemosView({ memos, onOpen, renderDetail }) {
  const [q, setQ] = useState('')
  const [co, setCo] = useState(null)
  const [view, setView] = useState(() => localStorage.getItem('memo-view') || 'board')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const cos = useMemo(() => companies(memos), [memos])

  const list = memos.filter((m) => {
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

  function pick(v) {
    setView(v)
    localStorage.setItem('memo-view', v)
  }

  // 보드에는 보관 메모가 안 나오므로, 검색 중이면 걸린 보관 메모를 아래에 따로 보여준다
  const keepHits = view === 'board' && words.length ? list.filter((m) => memoStatus(m) === 'keep') : []

  return (
    <div className="view">
      <div className="mv-top">
        <input
          className="search-input mv-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="검색 — 제목·진행기록·업체, 보관·완료까지"
        />
        <div className="mv-toggle">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={'pill' + (view === id ? ' on' : '')} onClick={() => pick(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filters wrap">
        {cos.map((name) => (
          <button
            key={name}
            className={'pill' + (co === name ? ' on' : '')}
            onClick={() => setCo(co === name ? null : name)}
          >
            {name}
          </button>
        ))}
        <span className="count">{list.length}건</span>
        <button className="pill pill-backup" title="메모·점검 전체를 JSON 파일로 저장" onClick={() => downloadBackup(memos)}>
          백업
        </button>
      </div>
      {view === 'board' && <BoardView memos={list} onOpen={onOpen} renderDetail={renderDetail} />}
      {view === 'table' && <TableView memos={list} words={words} onOpen={onOpen} renderDetail={renderDetail} />}
      {view === 'timeline' && <TimelineView memos={list} onOpen={onOpen} renderDetail={renderDetail} />}
      {keepHits.length > 0 && (
        <div className="kb-keep">
          <div className="done-divider">검색에 걸린 보관 메모 · {keepHits.length}건</div>
          {keepHits.map((m) => (
            <Fragment key={m.id}>
              <div className="kb-card" onClick={() => onOpen(m.id)}>
                <div className="kb-meta" style={{ marginTop: 0 }}>
                  <span className="badge st-keep">보관</span>
                  <span className="kb-title">{m.title}</span>
                </div>
              </div>
              {renderDetail && renderDetail(m.id)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
