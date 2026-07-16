import { Fragment, useRef, useState } from 'react'
import CalendarView from './CalendarView'
import { memoStatus, fmtDate, fmtPeriod, diffDays, STATUS_LABEL } from '../derive'
import { completeMemo, reopenMemo, updateMemo, setDayOrder } from '../store'
import { todayStr } from '../parser'

const pad = (n) => String(n).padStart(2, '0')

// 기한 배지: 며칠 밀림 / 오늘 / D-n
function dueBadge(m, today) {
  if (m.status === 'done' || m.keep) return null
  const end = m.due || (m.period && m.period.end)
  if (!end) return null
  const dd = diffDays(end, today)
  if (dd < 0) return ['b-red', `${-dd}일째`]
  if (dd === 0) return ['b-amber', '오늘']
  return ['b-blue', `D-${dd}`]
}

function checkInfo(m) {
  const items = (m.history || []).filter((h) => h.type !== 'log')
  if (!items.length) return null
  const done = items.filter((h) => h.done).length
  return { label: `체크 ${done}/${items.length}`, complete: done === items.length }
}

// 체크 배지 색: 진행 중엔 초록, 완료된 메모는 회색 — 단 체크가 남은 채 완료된 건 노랑(놓친 건지 확인용)
const checkCls = (st, chk) => (st === 'done' ? (chk.complete ? 'b-gray' : 'b-amber') : 'b-teal')

// ---------- 요약 타일 (오늘 탭 대체) ----------

// 기한/만기의 D-day. 완료·보관·스누즈된 건 제외.
function dueInfo(m, today) {
  if (m.status === 'done' || m.keep) return null
  if (m.snoozeUntil && m.snoozeUntil > today) return null
  const end = m.due || (m.period && m.period.end)
  if (!end) return null
  return { dd: diffDays(end, today), isEnd: !m.due && !!(m.period && m.period.end) }
}

// 타일은 둘뿐: 오늘(밀림 포함 — 밀린 게 있으면 빨갛게 병기), 만기(계약 만기 D-60 레이더)
function tileMatch(m, id, today) {
  const info = dueInfo(m, today)
  if (!info) return false
  if (id === 'late') return info.dd < 0
  if (id === 'today') return info.dd <= 0
  if (id === 'end') return info.isEnd && info.dd >= 0 && info.dd <= 60
  return false
}

const byUpdated = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)

// 완료 목록은 "최근 완료한 순" — 나중에 체크를 만져도 순서가 안 튄다
const byCompleted = (a, b) =>
  ((a.completedAt || a.updatedAt) < (b.completedAt || b.updatedAt) ? 1 : -1)

// 공통 우선순위 정렬: 급한 순(밀림→오늘→D-n)이 항상 먼저 — 새로 던진 오늘 메모가 바로 위로 온다.
// 드래그로 정한 순서는 같은 D-day 안에서만 순서를 가른다. 보드·표·타임라인 공통.
const boardIdx = (dayOrder, col, id) => {
  const order = (dayOrder && dayOrder['board-' + col]) || []
  const i = order.indexOf(id)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

const urgency = (m, today) => {
  const end = m.due || (m.period && m.period.end)
  return end ? diffDays(end, today) : Number.MAX_SAFE_INTEGER
}

const prioSort = (dayOrder, col, today) => (a, b) =>
  urgency(a, today) - urgency(b, today) ||
  boardIdx(dayOrder, col, a.id) - boardIdx(dayOrder, col, b.id) ||
  byUpdated(a, b)

// ---------- 보드 ----------

const COLS = [
  ['todo', '할일'],
  ['active', '진행중'],
  ['done', '완료'],
]
const DONE_SHOWN = 8

function Card({ m, col, today, onOpen, dropCls, onCardOver, onCardLeave, onCardDrop }) {
  const st = memoStatus(m)
  const badge = dueBadge(m, today)
  const chk = checkInfo(m)
  const doneDate =
    st === 'done' && m.completedAt
      ? `${Number(m.completedAt.slice(5, 7))}.${Number(m.completedAt.slice(8, 10))}`
      : null
  // 기간 메모에 오늘 날짜 진행기록이 있으면 카드에 그 줄을 보여준다 (예: 오늘의 식단)
  const dayLine = m.period ? (m.history || []).find((h) => h.date === today && h.text) : null
  return (
    <div
      className={'kb-card' + (st === 'done' ? ' kb-done' : '') + dropCls}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'board', id: m.id, st: col }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={onCardOver}
      onDragLeave={onCardLeave}
      onDrop={onCardDrop}
      onClick={() => onOpen(m.id)}
    >
      <div className="kb-title">{m.title}</div>
      {dayLine && <div className="kb-dayline">{dayLine.text}</div>}
      {(badge || chk || doneDate) && (
        <div className="kb-meta">
          {badge && <span className={'kb-badge ' + badge[0]}>{badge[1]}</span>}
          {chk && <span className={'kb-badge ' + checkCls(st, chk)}>{chk.label}</span>}
          {doneDate && <span className="kb-done-date">완료 {doneDate}</span>}
        </div>
      )}
    </div>
  )
}

function BoardView({ memos, dayOrder, onOpen, renderDetail }) {
  const today = todayStr()
  const [over, setOver] = useState(null)
  const [rowDrop, setRowDrop] = useState(null)
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  // 완료 직후 몇 초간 하단에 "되돌리기"를 보여준다 — 실수로 눌러도 복구 가능
  function showUndo(label, fn) {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  // 열 이동: 완료 열이면 완료 처리(+되돌리기), 아니면 stage 지정 (완료였던 건 다시 연다)
  function moveTo(m, col) {
    if (!m || memoStatus(m) === col) return
    if (col === 'done') {
      completeMemo(m.id)
      showUndo(`'${m.title}' 완료`, () => reopenMemo(m.id))
      return
    }
    if (m.status === 'done') reopenMemo(m.id)
    updateMemo(m.id, { stage: col })
  }

  const by = { todo: [], active: [], done: [] }
  for (const m of memos) {
    const st = memoStatus(m)
    if (by[st]) by[st].push(m)
  }

  by.todo.sort(prioSort(dayOrder, 'todo', today))
  by.active.sort(prioSort(dayOrder, 'active', today))
  by.done.sort(byCompleted)

  function reorderIn(col, draggedId, targetId, after) {
    const ids = by[col].map((x) => x.id).filter((id) => id !== draggedId)
    let pos = ids.indexOf(targetId)
    if (pos === -1) pos = ids.length
    else if (after) pos += 1
    ids.splice(pos, 0, draggedId)
    setDayOrder('board-' + col, ids)
  }

  function parseDrag(e) {
    try {
      const d = JSON.parse(e.dataTransfer.getData('text/plain'))
      return d.kind === 'board' ? d : null
    } catch {
      return null
    }
  }

  function dropOnCol(col, e) {
    e.preventDefault()
    setOver(null)
    setRowDrop(null)
    const data = parseDrag(e)
    if (!data) return
    moveTo(memos.find((m) => m.id === data.id), col)
  }

  // 카드 위에 놓으면: 같은 열이면 순서 바꾸기, 다른 열이면 그 자리로 이동
  function dropOnCard(col, target, e) {
    e.preventDefault()
    e.stopPropagation()
    const cur = rowDrop
    setOver(null)
    setRowDrop(null)
    const data = parseDrag(e)
    if (!data || data.id === target.id) return
    if (data.st !== col) moveTo(memos.find((m) => m.id === data.id), col)
    reorderIn(col, data.id, target.id, cur ? cur.after : false)
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
              onDrop={(e) => dropOnCol(id, e)}
            >
              <div className="kb-head">
                <span className={'badge st-' + id}>{label}</span>
                <span className="kb-count">{by[id].length}</span>
              </div>
              {shown.map((m) => (
                <Card
                  key={m.id}
                  m={m}
                  col={id}
                  today={today}
                  onOpen={onOpen}
                  dropCls={rowDrop && rowDrop.id === m.id ? (rowDrop.after ? ' drop-below' : ' drop-above') : ''}
                  onCardOver={(e) => {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setRowDrop({ id: m.id, after: e.clientY > r.top + r.height / 2 })
                  }}
                  onCardLeave={() => setRowDrop((cur) => (cur && cur.id === m.id ? null : cur))}
                  onCardDrop={(e) => dropOnCard(id, m, e)}
                />
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
      {undo && (
        <div className="undo-bar">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              undo.fn()
              clearTimeout(undoTimer.current)
              setUndo(null)
            }}
          >
            되돌리기
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- 표 ----------

function TableView({ memos, dayOrder, words, flat, onOpen, renderDetail }) {
  const today = todayStr()
  let list
  if (flat) {
    // 만기 타일 등에서: 상태 구분 없이 가까운 날짜부터 촤르륵
    list = [...memos].sort((a, b) => urgency(a, today) - urgency(b, today) || byUpdated(a, b))
  } else {
    // 진행중 → 할일 → 보관 → 완료 순. 진행중·할일 안에서는 보드와 같은 우선순위.
    const groups = { active: [], todo: [], keep: [], done: [] }
    for (const m of memos) groups[memoStatus(m)].push(m)
    groups.active.sort(prioSort(dayOrder, 'active', today))
    groups.todo.sort(prioSort(dayOrder, 'todo', today))
    groups.keep.sort(byUpdated)
    groups.done.sort(byCompleted)
    list = [...groups.active, ...groups.todo, ...groups.keep, ...groups.done]
  }
  return (
    <div className="mv-table-wrap">
      <table className="mv-table">
        <thead>
          <tr>
            <th>상태</th>
            <th>제목</th>
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
                  <td className="mv-date">
                    {m.period ? fmtPeriod(m.period) : m.due ? fmtDate(m.due) : ''}
                    {badge && <span className={'kb-badge ' + badge[0]}> {badge[1]}</span>}
                  </td>
                  <td className="mv-date">
                    {chk && <span className={'kb-badge ' + checkCls(st, chk)}>{chk.label}</span>}
                  </td>
                  <td className="mv-date">{fmtDate(m.createdAt.slice(0, 10))}</td>
                </tr>
                {matched.length > 0 && (
                  <tr className="mv-hit">
                    <td colSpan={5}>
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

const TLV_GROUPS = [
  ['active', '진행중'],
  ['todo', '할일'],
  ['done', '완료'],
]

function TimelineView({ memos, dayOrder, onOpen, renderDetail }) {
  const t = new Date()
  const [y, setY] = useState(t.getFullYear())
  const [mo, setMo] = useState(t.getMonth())
  const [showDone, setShowDone] = useState(false)
  // 막대에 마우스를 올리면 진행기록이 작은 카드로 붙는다 (PC 전용)
  const [hover, setHover] = useState(null)
  const today = todayStr()
  const dim = new Date(y, mo + 1, 0).getDate()
  const first = `${y}-${pad(mo + 1)}-01`
  const last = `${y}-${pad(mo + 1)}-${pad(dim)}`
  const dayOf = (s) => Number(s.slice(8, 10))
  const todayDay = today >= first && today <= last ? dayOf(today) : null

  // 막대 구간: 기간 메모는 기간, 기록이 쌓인 메모는 실제 활동 구간
  // (첫 기록 ~ 마지막 기록·완료일, 진행중이면 오늘까지), 기록 없으면 기한 자리에 점
  const spanOf = (m) => {
    if (m.period && m.period.start && m.period.end) return [m.period.start, m.period.end]
    const dates = (m.history || []).map((h) => h.date).filter(Boolean)
    let s = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null
    let e = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
    if (m.status === 'done') {
      const c = m.completedAt ? m.completedAt.slice(0, 10) : null
      if (c && (!e || c > e)) e = c
      if (!s) s = m.due || e
      if (!e) e = s
      return s ? [s, e] : null
    }
    // 할일(착수 전): 줄이 있어도 등록 시점으로 소급하지 않는다 — 현재 기한 자리에 점만.
    // 내일로/날짜로로 기한을 옮기면 점이 따라간다.
    if (memoStatus(m) !== 'active') return m.due ? [m.due, m.due] : null
    // 진행중(착수 후): 첫 기록부터 기한·오늘 중 늦은 쪽까지
    if (!s) return m.due ? [m.due, m.due] : null
    if (m.due && m.due > e) e = m.due
    if (today > e) e = today
    return [s, e]
  }

  // 라벨 밑 요약 줄: "7.8 ~ 진행중 · 체크 4/7" — 같은 제목이 여럿이어도 구분된다
  const md = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`
  const subOf = (m, s, e) => {
    const chk = checkInfo(m)
    let range
    if (m.period) range = s === e ? md(s) : `${md(s)} ~ ${md(e)}`
    else if (m.status === 'done') range = s === e ? md(e) : `${md(s)} ~ ${md(e)}`
    else {
      // 미완료는 실제 기한을 표기 — 시작점(첫 기록)이 앞서면 "7.10 ~ 기한 7.17"
      const due = m.due || e
      range = `기한 ${md(due)}`
      if (s < due) range = `${md(s)} ~ ${range}`
    }
    return range + (chk ? ` · ${chk.label}` : '')
  }

  const items = memos
    .filter((m) => !m.keep)
    .map((m) => {
      const sp = spanOf(m)
      return sp && { m, s: sp[0], e: sp[1] }
    })
    .filter((x) => x && x.s <= last && x.e >= first)
    .sort((a, b) => a.s.localeCompare(b.s))

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
          {TLV_GROUPS.map(([gid, glabel]) => {
            const rows = items.filter((x) => memoStatus(x.m) === gid)
            if (!rows.length) return null
            // 진행중·할일은 보드와 같은 우선순위, 완료는 최근 완료순
            const cmp =
              gid === 'done'
                ? (a, b) => byCompleted(a.m, b.m)
                : (a, b) => prioSort(dayOrder, gid, today)(a.m, b.m)
            rows.sort(cmp)
            const folded = gid === 'done' && !showDone
            return (
              <Fragment key={gid}>
                {gid === 'done' ? (
                  <button className="tlv-fold" onClick={() => setShowDone((v) => !v)}>
                    완료 {rows.length}건 {showDone ? '접기 ▴' : '펼치기 ▾'}
                  </button>
                ) : (
                  <div className="tlv-grp">
                    <span className={'badge st-' + gid}>{glabel}</span>
                    <span className="kb-count">{rows.length}</span>
                  </div>
                )}
                {!folded &&
                  rows.map(({ m, s, e }) => {
                    const st = memoStatus(m)
                    const sd = s < first ? 1 : dayOf(s)
                    const ed = e > last ? dim : dayOf(e)
                    return (
                      <div className="tlv-row" key={m.id}>
                        <div className="tlv-label" onClick={() => onOpen(m.id)} title={m.title}>
                          <span className={'tlv-dot tlv-' + st} />
                          <span className="tlv-lwrap">
                            <span className="tlv-title">{m.title}</span>
                            <span className="tlv-sub">{subOf(m, s, e)}</span>
                          </span>
                        </div>
                        <div className="tlv-days" style={cols}>
                          {todayDay && <span className="tlv-guide" style={{ gridColumn: `${todayDay} / ${todayDay + 1}` }} />}
                          <span
                            className={'tlv-bar tlv-' + st}
                            style={{ gridColumn: `${sd} / ${ed + 1}` }}
                            onClick={() => onOpen(m.id)}
                            onMouseEnter={(ev) => setHover({ m, s, e, x: ev.clientX, y: ev.clientY })}
                            onMouseLeave={() => setHover(null)}
                          />
                        </div>
                      </div>
                    )
                  })}
              </Fragment>
            )
          })}
          {items.length === 0 && <div className="empty small">이 달에 걸린 메모가 없습니다.</div>}
        </div>
      </div>
      {renderDetail && items.map(({ m }) => <Fragment key={'d' + m.id}>{renderDetail(m.id)}</Fragment>)}
      {hover && (() => {
        const lines = hover.m.history || []
        const shown = lines.slice(-8)
        const chk = checkInfo(hover.m)
        const below = hover.y < window.innerHeight * 0.55
        return (
          <div
            className="tlv-tip"
            style={{
              left: Math.min(hover.x + 14, window.innerWidth - 350),
              top: below ? hover.y + 16 : hover.y - 12,
              transform: below ? 'none' : 'translateY(-100%)',
            }}
          >
            <div className="tlv-tip-title">{hover.m.title}</div>
            <div className="tlv-tip-sub">
              {fmtDate(hover.s)}
              {hover.s !== hover.e && ` ~ ${fmtDate(hover.e)}`}
              {chk && ` · ${chk.label}`}
            </div>
            {shown.map((h, i) => (
              <div key={i} className={'tlv-tip-line' + (h.done ? ' done' : '')}>
                <span className="d">{fmtDate(h.date)}</span>
                <span>{h.text}</span>
              </div>
            ))}
            {lines.length > 8 && <div className="tlv-tip-more">위 {lines.length - 8}줄 생략 — 누르면 전체</div>}
            {lines.length === 0 && <div className="tlv-tip-more">진행 기록 없음</div>}
          </div>
        )
      })()}
    </div>
  )
}

// ---------- 메모탭 ----------

const VIEWS = [
  ['board', '보드'],
  ['calendar', '달력'],
  ['table', '표'],
  ['timeline', '타임라인'],
]

export default function MemosView({ memos, dayOrder, onOpen, renderDetail }) {
  const [q, setQ] = useState('')
  const [view, setView] = useState(() => localStorage.getItem('memo-view') || 'board')
  // 폰은 "오늘" 타일이 켜진 채 시작 — 예전 오늘 탭과 같은 첫 화면
  const [timeFilter, setTimeFilter] = useState(() =>
    window.matchMedia('(max-width: 899px)').matches ? 'today' : null
  )
  const today = todayStr()
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  const counts = {}
  for (const id of ['late', 'today', 'end']) {
    counts[id] = memos.filter((m) => tileMatch(m, id, today)).length
  }

  const list = memos.filter((m) => {
    if (timeFilter && !tileMatch(m, timeFilter, today)) return false
    if (words.length) {
      const hay = [m.title, ...m.history.map((h) => h.text)]
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

  const tileLabel = timeFilter === 'today' ? '오늘' : '만기'
  const toggleTile = (id) => setTimeFilter((f) => (f === id ? null : id))

  // 보드에는 보관 메모가 안 나오므로, 검색 중이면 걸린 보관 메모를 아래에 따로 보여준다
  const keepHits = view === 'board' && words.length ? list.filter((m) => memoStatus(m) === 'keep') : []

  return (
    <div className="view">
      <div className="mv-top">
        <div className="tiles">
          <button
            className={'tile t-amber' + (counts.late > 0 ? ' tile-late' : '') + (timeFilter === 'today' ? ' on' : '')}
            title={timeFilter === 'today' ? '다시 누르면 전체 보기' : '오늘까지 해야 하는 것만 모아 보기'}
            onClick={() => toggleTile('today')}
          >
            오늘 <b>{counts.today}</b>
            {counts.late > 0 && <span className="tile-latebit">· 밀림 <b>{counts.late}</b></span>}
          </button>
          <button
            className={'tile t-purple' + (timeFilter === 'end' ? ' on' : '')}
            title={timeFilter === 'end' ? '다시 누르면 전체 보기' : '계약 만기(60일 안)를 가까운 순으로'}
            onClick={() => toggleTile('end')}
          >
            만기 <b>{counts.end}</b>
          </button>
        </div>
        <input
          className="search-input mv-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="검색 — 제목·진행기록, 보관·완료까지"
        />
        <div className="mv-toggle">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={'pill' + (view === id ? ' on' : '')} onClick={() => pick(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {timeFilter && (
        <div className="cal-filter-note">
          "{tileLabel}" 타일 적용 중 · {list.length}건 — 타일을 다시 누르면 전체가 보입니다.
        </div>
      )}
      {view === 'board' && <BoardView memos={list} dayOrder={dayOrder} onOpen={onOpen} renderDetail={renderDetail} />}
      {view === 'calendar' && (
        <CalendarView
          memos={list}
          dayOrder={dayOrder}
          onOpen={onOpen}
          renderDetail={renderDetail}
          filtered={words.length > 0}
        />
      )}
      {view === 'table' && (
        <TableView memos={list} dayOrder={dayOrder} words={words} flat={timeFilter === 'end'} onOpen={onOpen} renderDetail={renderDetail} />
      )}
      {view === 'timeline' && <TimelineView memos={list} dayOrder={dayOrder} onOpen={onOpen} renderDetail={renderDetail} />}
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
