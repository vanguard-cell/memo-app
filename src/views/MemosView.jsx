import { Fragment, useRef, useState } from 'react'
import CalendarView from './CalendarView'
import { memoStatus, fmtDate, fmtPeriod, diffDays, STATUS_LABEL } from '../derive'
import { completeMemo, reopenMemo, updateMemo, setDayOrder } from '../store'
import { todayStr } from '../parser'
import useIsNarrow from '../useIsNarrow'

const pad = (n) => String(n).padStart(2, '0')

// 기한 배지: 며칠 밀림 / 오늘 / D-n (마감형은 "마감 D-n"으로 구분)
// D-n은 가까울수록 따뜻한 색(주황) → 멀수록 차가운 색(파랑)으로 하루 단위 그라데이션 —
// D-1과 D-3이 배지 색만으로 구분된다. D-14부터는 같은 파랑.
function ddStyle(dd) {
  const t = Math.min(Math.max(dd - 1, 0), 13) / 13
  const hue = Math.round(26 + t * (215 - 26))
  return { background: `hsl(${hue} 85% 90%)`, color: `hsl(${hue} 80% 30%)` }
}

function dueBadge(m, today) {
  if (m.status === 'done' || m.keep) return null
  const end = m.due || (m.period && m.period.end)
  if (!end) return null
  const dd = diffDays(end, today)
  // 마감형은 배지에 마감 날짜를 같이 — "7.30까지 D-11"이면 어느 날이 마감인지 카드에서 바로 보인다
  const md = `${Number(end.slice(5, 7))}.${Number(end.slice(8, 10))}`
  if (dd < 0) return ['b-red', m.deadline ? `${md}까지 · ${-dd}일 지남` : `${-dd}일째`]
  if (dd === 0) return ['b-amber', m.deadline ? '마감 오늘' : '오늘']
  return ['', m.deadline ? `${md}까지 D-${dd}` : `D-${dd}`, ddStyle(dd)]
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
  // 다음 할 일 힌트: 입력 순서상 아직 체크 안 된 첫 줄 — 다음 작업일 가능성이 높다
  const nextLine =
    st !== 'done' ? (m.history || []).find((h) => h.type !== 'log' && !h.done && h.text) : null
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
      {(badge || chk || doneDate || nextLine) && (
        <div className="kb-meta">
          {badge && <span className={'kb-badge ' + badge[0]} style={badge[2]}>{badge[1]}</span>}
          {chk && <span className={'kb-badge ' + checkCls(st, chk)}>{chk.label}</span>}
          {nextLine && <span className="kb-next">{nextLine.text}</span>}
          {doneDate && <span className="kb-done-date">완료 {doneDate}</span>}
        </div>
      )}
    </div>
  )
}

function BoardView({ memos, dayOrder, onOpen, renderDetail }) {
  const today = todayStr()
  const narrow = useIsNarrow()
  const [over, setOver] = useState(null)
  const [rowDrop, setRowDrop] = useState(null)
  const [showDone, setShowDone] = useState(false)
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

  // 폰: PC처럼 할일|진행중 두 열 나란히 — 완료는 아래 접힌 목록.
  // 열 이동은 드래그 대신 상세의 상태 버튼으로, 상세는 누른 카드 줄 아래 전체 폭으로.
  if (narrow) {
    const rows = Math.max(by.todo.length, by.active.length)
    return (
      <div>
        <div className="kb-flat">
          <div className="kb-head">
            <span className="badge st-todo">할일</span>
            <span className="kb-count">{by.todo.length}</span>
          </div>
          <div className="kb-head">
            <span className="badge st-active">진행중</span>
            <span className="kb-count">{by.active.length}</span>
          </div>
          {rows === 0 && (
            <div className="empty small" style={{ gridColumn: '1 / -1' }}>
              할일·진행중 메모가 없습니다
            </div>
          )}
          {Array.from({ length: rows }, (_, i) => {
            const L = by.todo[i]
            const R = by.active[i]
            // 카드를 누르면 새 창이 아래 붙는 게 아니라, 카드 자리가 상세로 바뀐다 (제목 중복 방지)
            const Ld = L && renderDetail ? renderDetail(L.id) : null
            const Rd = R && renderDetail ? renderDetail(R.id) : null
            return (
              <Fragment key={(L && L.id) || (R && R.id) || i}>
                <div className="kbf-cell">
                  {L && !Ld && <Card m={L} col="todo" today={today} onOpen={onOpen} dropCls="" />}
                </div>
                <div className="kbf-cell">
                  {R && !Rd && <Card m={R} col="active" today={today} onOpen={onOpen} dropCls="" />}
                </div>
                {Ld && <div className="kbf-detail">{Ld}</div>}
                {Rd && <div className="kbf-detail">{Rd}</div>}
              </Fragment>
            )
          })}
        </div>
        <button className="tlv-fold" onClick={() => setShowDone((v) => !v)}>
          완료 {by.done.length}건 {showDone ? '접기 ▴' : '펼치기 ▾'}
        </button>
        {showDone && (
          <div className="kbf-done">
            {by.done.slice(0, DONE_SHOWN).map((m) => {
              const d = renderDetail ? renderDetail(m.id) : null
              return (
                <Fragment key={m.id}>
                  {d || <Card m={m} col="done" today={today} onOpen={onOpen} dropCls="" />}
                </Fragment>
              )
            })}
            {by.done.length > DONE_SHOWN && (
              <div className="kb-more">외 {by.done.length - DONE_SHOWN}건 — 표에서 전체 보기</div>
            )}
          </div>
        )}
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
                <Fragment key={m.id}>
                  <Card
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
                  {/* 폰: 누른 카드 바로 아래에 상세 — 보드 맨 밑에 열리면 안 보인다 */}
                  {renderDetail && renderDetail(m.id)}
                </Fragment>
              ))}
              {id === 'done' && by.done.length > DONE_SHOWN && (
                <div className="kb-more">외 {by.done.length - DONE_SHOWN}건 — 표에서 전체 보기</div>
              )}
              {by[id].length === 0 && <div className="kb-empty">여기로 끌어오기</div>}
            </div>
          )
        })}
      </div>
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
            <th>날짜·기간</th>
            <th>체크</th>
            <th>작성일</th>
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
            // 폰: 누른 줄이 그 자리에서 상세로 바뀐다 (제목 중복 방지)
            const d = renderDetail ? renderDetail(m.id) : null
            if (d) {
              return (
                <tr className="mv-detail-row" key={m.id}>
                  <td colSpan={5}>{d}</td>
                </tr>
              )
            }
            return (
              <Fragment key={m.id}>
                <tr className={st === 'done' ? 'mv-done' : ''} onClick={() => onOpen(m.id)}>
                  <td><span className={'badge st-' + st}>{STATUS_LABEL[st]}</span></td>
                  <td className="mv-title">{m.title}</td>
                  <td className="mv-date">
                    {/* 마감형은 배지("7.30까지 D-n")가 날짜를 이미 담고 있어 따로 안 쓴다 */}
                    {m.period ? (m.deadline ? '' : fmtPeriod(m.period)) : m.due ? fmtDate(m.due) : ''}
                    {badge && <span className={'kb-badge ' + badge[0]} style={badge[2]}> {badge[1]}</span>}
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
      // 미완료는 잡힌 날짜를 표기 — 시작점(첫 기록)이 앞서면 "7.10 ~ 예정 7.17"
      const due = m.due || e
      range = `예정 ${md(due)}`
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
                    // 폰: 누른 줄이 그 자리에서 상세로 바뀐다
                    const d = renderDetail ? renderDetail(m.id) : null
                    if (d) return <Fragment key={m.id}>{d}</Fragment>
                    return (
                      <Fragment key={m.id}>
                        <div className="tlv-row">
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
                      </Fragment>
                    )
                  })}
              </Fragment>
            )
          })}
          {items.length === 0 && <div className="empty small">이 달에 걸린 메모가 없습니다.</div>}
        </div>
      </div>
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
  // 폰은 들어올 때 항상 보드부터 — 마지막 보기 기억은 PC만 (사용자 요청 2026-07-19)
  const [view, setView] = useState(() =>
    window.matchMedia('(max-width: 899px)').matches
      ? 'board'
      : localStorage.getItem('memo-view') || 'board'
  )
  // 어디서든 전체 보기로 시작 — 폰만 필터가 켜진 채 시작하니 "메모가 없다"로 오해했음 (2026-07-18)
  const [timeFilter, setTimeFilter] = useState(null)
  const today = todayStr()
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  const counts = {}
  for (const id of ['late', 'today', 'end']) {
    counts[id] = memos.filter((m) => tileMatch(m, id, today)).length
  }
  // 타일 표기는 "오늘 = 딱 오늘 기한"과 "밀림"을 분리 (클릭하면 둘 다 모아서 보여줌)
  counts.todayOnly = memos.filter((m) => {
    const info = dueInfo(m, today)
    return info && info.dd === 0
  }).length

  // 검색만 적용된 목록 — 달력 보기는 타일(시간) 필터를 무시한다 (달력 자체가 시간 화면이라 겹치면 텅 비어 보임)
  const searchList = memos.filter((m) => {
    if (!words.length) return true
    const hay = [m.title, m.desc, ...m.history.map((h) => h.text)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const list = searchList.filter((m) => !timeFilter || tileMatch(m, timeFilter, today))

  function pick(v) {
    setView(v)
    localStorage.setItem('memo-view', v)
  }

  const tileLabel = timeFilter === 'today' ? '오늘' : '마감·만기'
  const toggleTile = (id) => setTimeFilter((f) => (f === id ? null : id))

  // 보드에는 보관 메모가 안 나오므로, 검색 중이면 걸린 보관 메모를 아래에 따로 보여준다
  const keepHits = view === 'board' && words.length ? list.filter((m) => memoStatus(m) === 'keep') : []

  return (
    <div className="view">
      <div className="mv-top">
        <div className="tiles">
          <button
            className={'tile t-amber' + (counts.late > 0 ? ' tile-late' : '') + (timeFilter === 'today' ? ' on' : '')}
            title={timeFilter === 'today' ? '다시 누르면 전체 보기' : '오늘까지 해야 하는 것(밀림 포함)만 모아 보기'}
            onClick={() => toggleTile('today')}
          >
            오늘 <b>{counts.todayOnly}</b>
            {counts.late > 0 && <span className="tile-latebit">· 밀림 <b>{counts.late}</b></span>}
          </button>
          <button
            className={'tile t-purple' + (timeFilter === 'end' ? ' on' : '')}
            title={timeFilter === 'end' ? '다시 누르면 전체 보기' : '마감("~까지")과 계약 만기(60일 안)를 가까운 순으로'}
            onClick={() => toggleTile('end')}
          >
            마감·만기 <b>{counts.end}</b>
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
      {timeFilter && view !== 'calendar' && (
        <div className="cal-filter-note">
          "{tileLabel}" 타일 적용 중 · {list.length}건 — 타일을 다시 누르면 전체가 보입니다.
        </div>
      )}
      {timeFilter && view !== 'calendar' && list.length === 0 && (
        <div className="empty">
          "{tileLabel}"에 해당하는 메모가 지금은 없습니다.
          <br />
          <button style={{ marginTop: 10 }} onClick={() => setTimeFilter(null)}>
            전체 보기
          </button>
        </div>
      )}
      {view === 'board' && <BoardView memos={list} dayOrder={dayOrder} onOpen={onOpen} renderDetail={renderDetail} />}
      {view === 'calendar' && (
        <CalendarView
          memos={searchList}
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
          {keepHits.map((m) => {
            const d = renderDetail ? renderDetail(m.id) : null
            return (
              <Fragment key={m.id}>
                {d || (
                  <div className="kb-card" onClick={() => onOpen(m.id)}>
                    <div className="kb-meta" style={{ marginTop: 0 }}>
                      <span className="badge st-keep">보관</span>
                      <span className="kb-title">{m.title}</span>
                    </div>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
