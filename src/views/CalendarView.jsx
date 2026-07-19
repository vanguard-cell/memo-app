import { Fragment, useMemo, useState } from 'react'
import { fmtDate, fmtPeriod, memoStatus, STATUS_LABEL, diffDays } from '../derive'
import { todayStr, addDays, parse } from '../parser'
import { addMemo, updateMemo, setDayOrder } from '../store'
import SendToDateBtn from '../components/SendToDateBtn'

// 메모 조각을 다른 날짜로 — 드래그와 "이동" 버튼이 같이 쓴다.
// 기한→기한 이동 / 시작·만기 조각→그쪽 끝만 / 중간(기간) 조각→기간 전체 평행이동
function moveEvent(m, type, fromDate, targetDate) {
  if (!m || targetDate === fromDate) return
  if (type === 'due') {
    updateMemo(m.id, { due: targetDate })
  } else if (type === 'start' && m.period) {
    const [start, end] = targetDate <= m.period.end ? [targetDate, m.period.end] : [m.period.end, targetDate]
    updateMemo(m.id, { period: { start, end } })
  } else if (type === 'end' && m.period) {
    const [start, end] = targetDate >= m.period.start ? [m.period.start, targetDate] : [targetDate, m.period.start]
    updateMemo(m.id, { period: { start, end } })
  } else if (type === 'span' && m.period) {
    const delta = diffDays(targetDate, fromDate)
    updateMemo(m.id, { period: { start: addDays(m.period.start, delta), end: addDays(m.period.end, delta) } })
  }
}

const pad = (n) => String(n).padStart(2, '0')

const TYPE = {
  due: ['기한', 'ev-due'],
  start: ['시작', 'ev-start'],
  end: ['만기', 'ev-end'],
  span: ['기간', 'ev-span'],
}

// 마감형 메모는 만기 대신 "마감"으로 표기
const typeLabel = (e) => (e.type === 'end' && e.m.deadline ? '마감' : TYPE[e.type][0])

// 메모탭의 "달력" 보기. memos = 검색이 적용된 목록(달력에도 필터가 먹는다).
export default function CalendarView({ memos, dayOrder, onOpen, renderDetail, filtered }) {
  const t = new Date()
  const [y, setY] = useState(t.getFullYear())
  const [mo, setMo] = useState(t.getMonth())
  // 폰: 칸이 좁아 제목이 안 읽히므로, 처음부터 오늘이 선택돼 아래 목록으로 읽게 한다
  const [sel, setSel] = useState(() =>
    window.matchMedia('(max-width: 899px)').matches ? todayStr() : null
  )
  const [qtext, setQtext] = useState('')
  const [dropTarget, setDropTarget] = useState(null)
  const [rowDrop, setRowDrop] = useState(null)
  const today = todayStr()

  function orderedEvents(date, evs) {
    const order = (dayOrder && dayOrder[date]) || []
    const idx = (e) => {
      const i = order.indexOf(e.m.id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...evs].sort((a, b) => idx(a) - idx(b))
  }

  function reorder(date, evs, draggedId, targetId, after) {
    const ids = [...new Set(orderedEvents(date, evs).map((e) => e.m.id))].filter((id) => id !== draggedId)
    let pos = ids.indexOf(targetId)
    if (pos === -1) pos = ids.length
    else if (after) pos += 1
    ids.splice(pos, 0, draggedId)
    setDayOrder(date, ids)
  }

  function onDrop(targetDate, e) {
    e.preventDefault()
    setDropTarget(null)
    let data
    try {
      data = JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch {
      return
    }
    const m = memos.find((x) => x.id === data.id)
    moveEvent(m, data.type, data.date, targetDate)
  }

  function quickAdd() {
    const txt = qtext.trim()
    if (!txt || !sel) return
    const p = parse(txt)
    const dateInText = p.period || p.due
    addMemo({
      title: dateInText && p.cleaned ? p.cleaned : txt,
      due: p.due || (p.period ? null : sel),
      period: p.period,
    })
    setQtext('')
  }

  const events = useMemo(() => {
    const map = {}
    const push = (date, e) => {
      if (!date) return
      ;(map[date] = map[date] || []).push(e)
    }
    // 기간 메모: 그 날짜의 진행기록 줄이 있으면 제목 대신 그 내용을 칸에 보여준다
    // (예: 주간 식당 메뉴 — 월요일 칸엔 월요일 메뉴)
    const dayLine = (m, date) => {
      const h = (m.history || []).find((x) => x.date === date && x.text)
      return h ? h.text : null
    }
    for (const m of memos) {
      if (m.due) push(m.due, { m, type: 'due', text: m.title })
      if (m.period && m.period.start && m.period.end) {
        // 마감형("~까지"): 던진 날~마감의 기간은 오늘부터 보이게 하는 내부 장치일 뿐 —
        // 달력엔 마감일 조각 하나만 그린다 (시작·중간까지 그리면 한 메모가 여러 개처럼 겹쳐 보임)
        if (m.deadline) {
          push(m.period.end, { m, type: 'end', text: m.title })
          continue
        }
        push(m.period.start, { m, type: 'start', text: dayLine(m, m.period.start) || m.title })
        if (m.period.end !== m.period.start)
          push(m.period.end, { m, type: 'end', text: dayLine(m, m.period.end) || m.title })
        const len = diffDays(m.period.end, m.period.start)
        if (len > 1 && len <= 31) {
          let d = addDays(m.period.start, 1)
          while (d < m.period.end) {
            push(d, { m, type: 'span', text: dayLine(m, d) || m.title })
            d = addDays(d, 1)
          }
        }
      }
    }
    return map
  }, [memos])

  const startDow = new Date(y, mo, 1).getDay()
  const dim = new Date(y, mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(d)

  const first = `${y}-${pad(mo + 1)}-01`
  const last = `${y}-${pad(mo + 1)}-${pad(dim)}`
  // 이 달에 걸쳐 있는 기간 메모 — 장기(31일 초과) 기간은 칸에 안 그려지므로 여기서 존재를 알린다
  const monthPeriods = memos
    .filter(
      (m) =>
        m.period && m.period.start && m.period.end && m.status !== 'done' &&
        m.period.start <= last && m.period.end >= first
    )
    .sort((a, b) => a.period.end.localeCompare(b.period.end))
  // 그 날짜에 걸쳐 있지만 칸에 조각이 없는 장기 기간 — 날짜 목록에 "기간 중"으로 끼워준다
  const longSpanning = (date) =>
    memos.filter(
      (m) =>
        m.period && m.period.start && m.period.end && m.status !== 'done' &&
        !m.deadline &&
        diffDays(m.period.end, m.period.start) > 31 &&
        m.period.start < date && date < m.period.end
    )
  // 날짜 목록의 "기간 중" 줄 (PC 날짜 목록·폰 월 목록 공용)
  const spanningRows = (date) =>
    longSpanning(date).map((m) => (
      <Fragment key={'ls' + m.id}>
        <div className="row" onClick={() => onOpen(m.id)}>
          <span className="badge ev-span">기간 중</span>
          <span className="row-title">
            {m.title} <span className="muted-inline">{diffDays(date, m.period.start) + 1}일차</span>
          </span>
          <span className={'badge st-' + memoStatus(m)}>{STATUS_LABEL[memoStatus(m)]}</span>
        </div>
        {renderDetail && renderDetail(m.id)}
      </Fragment>
    ))

  function move(n) {
    const nd = new Date(y, mo + n, 1)
    setY(nd.getFullYear())
    setMo(nd.getMonth())
    setSel(null)
  }

  return (
    <div className="view">
      {filtered && (
        <div className="cal-filter-note">검색·필터 적용 중 — 걸러진 메모만 달력에 보입니다</div>
      )}
      <div className="cal-head">
        <button onClick={() => move(-1)}>‹</button>
        <span className="cal-title">
          {y}년 {mo + 1}월
        </span>
        <button onClick={() => move(1)}>›</button>
        <button
          className="cal-today-btn"
          onClick={() => {
            // 이번 달로 이동 + 오늘 날짜 선택 — 이미 이번 달이어도 반응이 보이게
            setY(t.getFullYear())
            setMo(t.getMonth())
            setSel(today)
          }}
        >
          오늘
        </button>
      </div>
      {monthPeriods.length > 0 && (
        <div className="cal-periods">
          <span className="cal-periods-label">이 달에 걸친 기간</span>
          {monthPeriods.map((m) => (
            <button key={m.id} className="cal-period-chip" onClick={() => onOpen(m.id)}>
              {m.title}
              <span>{m.deadline ? `~ ${fmtDate(m.period.end)} 마감` : fmtPeriod(m.period)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={'e' + i} className="cal-cell blank" />
          const date = `${y}-${pad(mo + 1)}-${pad(d)}`
          const evs = orderedEvents(date, events[date] || [])
          return (
            <div
              key={date}
              className={
                'cal-cell' +
                (date === today ? ' cal-now' : '') +
                (sel === date ? ' cal-sel' : '') +
                (dropTarget === date ? ' cal-drop' : '')
              }
              onClick={() => setSel(date)}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(date)
              }}
              onDragLeave={() => setDropTarget((cur) => (cur === date ? null : cur))}
              onDrop={(e) => onDrop(date, e)}
            >
              <span className="cal-day">{d}</span>
              {evs.slice(0, 4).map((e, j) => (
                <span
                  key={j}
                  className={'cal-ev ' + TYPE[e.type][1] + (memoStatus(e.m) === 'done' ? ' ev-done' : '')}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', JSON.stringify({ id: e.m.id, type: e.type, date }))
                    ev.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onOpen(e.m.id)
                  }}
                >
                  {(e.type === 'start' || e.type === 'end') && <b>{typeLabel(e)} </b>}
                  {e.text}
                </span>
              ))}
              {evs.length > 4 && <span className="cal-more">+{evs.length - 4}</span>}
            </div>
          )
        })}
      </div>
      {/* 날짜 목록: 선택한 날 하나만, 달력 바로 아래 고정 — 다른 날짜를 누르면 그 자리에서
          내용만 바뀐다 (폰·PC 공통. 달 전체 나열 + 스크롤 점프는 조작감이 나빠서 제거, 2026-07-19) */}
      {sel && (
        <div className="cal-detail">
          <div className="cal-detail-title">
            {fmtDate(sel)} ({['일', '월', '화', '수', '목', '금', '토'][new Date(sel + 'T00:00').getDay()]})
            {sel === today && <span className="ag-now">오늘</span>}
          </div>
          <div className="cal-add">
            <input
              value={qtext}
              placeholder={`${fmtDate(sel)}에 바로 추가 (Enter)`}
              onChange={(e) => setQtext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') quickAdd()
              }}
            />
            <button onClick={quickAdd}>추가</button>
          </div>
          {(events[sel] || []).length === 0 && longSpanning(sel).length === 0 && (
            <div className="empty small">이 날짜에 걸린 기록이 없습니다</div>
          )}
          {orderedEvents(sel, events[sel] || []).map((e) => (
            <Fragment key={e.m.id + e.type}>
            <div
              className={
                'row' +
                (rowDrop && rowDrop.id === e.m.id ? (rowDrop.after ? ' drop-below' : ' drop-above') : '')
              }
              draggable
              onDragStart={(ev) => {
                // type을 같이 담아서, 달력 칸에 떨어뜨리면 날짜 이동으로도 동작하게 한다
                ev.dataTransfer.setData(
                  'text/plain',
                  JSON.stringify({ kind: 'reorder', id: e.m.id, date: sel, type: e.type })
                )
                ev.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(ev) => {
                ev.preventDefault()
                const r = ev.currentTarget.getBoundingClientRect()
                setRowDrop({ id: e.m.id, after: ev.clientY > r.top + r.height / 2 })
              }}
              onDragLeave={() => setRowDrop((cur) => (cur && cur.id === e.m.id ? null : cur))}
              onDrop={(ev) => {
                ev.preventDefault()
                const cur = rowDrop
                setRowDrop(null)
                let data
                try {
                  data = JSON.parse(ev.dataTransfer.getData('text/plain'))
                } catch {
                  return
                }
                if (data.kind !== 'reorder' || data.date !== sel || data.id === e.m.id) return
                reorder(sel, events[sel] || [], data.id, e.m.id, cur ? cur.after : false)
              }}
              onClick={() => onOpen(e.m.id)}
            >
              <span className={'badge ' + TYPE[e.type][1]}>{typeLabel(e)}</span>
              <span className="row-title">{e.text}</span>
              <SendToDateBtn label="이동" onPick={(d) => moveEvent(e.m, e.type, sel, d)} />
              <span className={'badge st-' + memoStatus(e.m)}>{STATUS_LABEL[memoStatus(e.m)]}</span>
            </div>
            {renderDetail && renderDetail(e.m.id)}
            </Fragment>
          ))}
          {spanningRows(sel)}
        </div>
      )}
    </div>
  )
}
