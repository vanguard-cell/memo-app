import { Fragment, useMemo, useState } from 'react'
import { fmtDate, memoStatus, STATUS_LABEL, diffDays, companies } from '../derive'
import { todayStr, addDays, parse } from '../parser'
import { addMemo, updateMemo, setDayOrder } from '../store'

const pad = (n) => String(n).padStart(2, '0')

const TYPE = {
  due: ['기한', 'ev-due'],
  start: ['시작', 'ev-start'],
  end: ['만기', 'ev-end'],
  span: ['기간', 'ev-span'],
}

export default function CalendarView({ memos, dayOrder, onOpen, renderDetail }) {
  const t = new Date()
  const [y, setY] = useState(t.getFullYear())
  const [mo, setMo] = useState(t.getMonth())
  const [sel, setSel] = useState(null)
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
    if (!m || targetDate === data.date) return
    if (data.type === 'due') {
      updateMemo(m.id, { due: targetDate })
    } else if (data.type === 'start' && m.period) {
      const [start, end] = targetDate <= m.period.end ? [targetDate, m.period.end] : [m.period.end, targetDate]
      updateMemo(m.id, { period: { start, end } })
    } else if (data.type === 'end' && m.period) {
      const [start, end] = targetDate >= m.period.start ? [m.period.start, targetDate] : [targetDate, m.period.start]
      updateMemo(m.id, { period: { start, end } })
    } else if (data.type === 'span' && m.period) {
      const delta = diffDays(targetDate, data.date)
      updateMemo(m.id, { period: { start: addDays(m.period.start, delta), end: addDays(m.period.end, delta) } })
    }
  }

  function quickAdd() {
    const txt = qtext.trim()
    if (!txt || !sel) return
    const p = parse(txt, companies(memos))
    const dateInText = p.period || p.due
    addMemo({
      title: dateInText && p.cleaned ? p.cleaned : txt,
      company: p.company,
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

  function move(n) {
    const nd = new Date(y, mo + n, 1)
    setY(nd.getFullYear())
    setMo(nd.getMonth())
    setSel(null)
  }

  return (
    <div className="view">
      <div className="cal-head">
        <button onClick={() => move(-1)}>‹</button>
        <span className="cal-title">
          {y}년 {mo + 1}월
        </span>
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
              {evs.slice(0, 3).map((e, j) => (
                <span
                  key={j}
                  className={'cal-ev ' + TYPE[e.type][1]}
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
                  {(e.type === 'start' || e.type === 'end') && <b>{TYPE[e.type][0]} </b>}
                  {e.text}
                </span>
              ))}
              {evs.length > 3 && <span className="cal-more">+{evs.length - 3}</span>}
            </div>
          )
        })}
      </div>
      {sel && (
        <div className="cal-detail">
          <div className="cal-detail-title">{fmtDate(sel)}</div>
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
          {(events[sel] || []).length === 0 && <div className="empty small">이 날짜에 걸린 기록이 없습니다</div>}
          {orderedEvents(sel, events[sel] || []).map((e) => (
            <Fragment key={e.m.id + e.type}>
            <div
              className={
                'row' +
                (rowDrop && rowDrop.id === e.m.id ? (rowDrop.after ? ' drop-below' : ' drop-above') : '')
              }
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'reorder', id: e.m.id, date: sel }))
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
              <span className={'badge ' + TYPE[e.type][1]}>{TYPE[e.type][0]}</span>
              <span className="row-title">{e.text}</span>
              <span className={'badge st-' + memoStatus(e.m)}>{STATUS_LABEL[memoStatus(e.m)]}</span>
            </div>
            {renderDetail && renderDetail(e.m.id)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
