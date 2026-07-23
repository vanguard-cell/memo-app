import { Fragment, useEffect, useMemo, useState } from 'react'
import { fmtDate, fmtPeriod, memoStatus, STATUS_LABEL, diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import { addMemo, updateMemo, setDayOrder } from '../store'
import SendToDateBtn from '../components/SendToDateBtn'
import MemoDetail from '../components/MemoDetail'
import useIsNarrow from '../useIsNarrow'

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
  due: ['예정', 'ev-due'],
  start: ['시작', 'ev-start'],
  end: ['만기', 'ev-end'],
  span: ['기간', 'ev-span'],
}

// 마감형 메모는 만기 대신 "마감"으로 표기
const typeLabel = (e) => (e.type === 'end' && e.m.deadline ? '마감' : TYPE[e.type][0])

// 깃발(⚑)은 마감형("~까지"로 던진 것)에만 — 날짜만 잡힌 예정까지 마감으로 보이던 문제 (2026-07-22)
const isDeadline = (e) => e.type === 'end' && e.m.deadline

// 메모탭의 "달력" 보기. memos = 검색이 적용된 목록(달력에도 필터가 먹는다).
export default function CalendarView({ memos, dayOrder, onOpen, renderDetail, filtered }) {
  const narrow = useIsNarrow()
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
  // PC: 상세를 우측 목록 위에 자체 인라인으로 띄운다 (App 우측 패널 대신) —
  // 폰은 화면이 좁아 기존대로 누른 줄이 그 자리에서 펼쳐진다(onOpen/renderDetail)
  const [localOpenId, setLocalOpenId] = useState(null)
  const today = todayStr()

  // PC 진입 시 App 우측 패널은 닫아둔다 — 달력 우측 목록과 이중으로 뜨지 않게
  useEffect(() => {
    if (!narrow) onOpen(null)
  }, [narrow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 항목 열기: PC는 우측 목록 위 인라인(로컬), 폰은 기존 App 인라인
  const openDetail = (id) => {
    if (narrow) onOpen(id)
    else setLocalOpenId((cur) => (cur === id ? null : id))
  }
  const localOpen = !narrow && localOpenId ? memos.find((m) => m.id === localOpenId) : null

  // 날짜를 고르면 그날 목록을 보여주고, 열려있던 상세는 닫는다 (다른 날 상세가 위에 남지 않게)
  const selectDay = (date) => {
    setSel(date)
    setLocalOpenId(null)
  }

  // PC: 우측 칸은 [닫힘 → 목록 → 상세] 3단계. 빈 곳 클릭·Esc는 한 단계씩 물러난다
  // (상세 → 목록 → 닫힘). 달력 칸·항목·우측 칸 안쪽을 누른 건 후퇴가 아니다.
  useEffect(() => {
    if (narrow || (!sel && !localOpenId)) return
    const KEEP =
      '.cal-cell, .cal-ev, .cal-period-chip, .cal-right, .cal-head, .cal-periods, .cal-filter-note, .mv-top, .inputbar, .sidenav, .topbar, .update-bar, .undo-bar'
    const stepBack = () => {
      if (localOpenId) setLocalOpenId(null)
      else setSel(null)
    }
    const onDown = (e) => {
      if (e.target.closest && e.target.closest(KEEP)) return
      stepBack()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      stepBack()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [narrow, sel, localOpenId])

  // 상태 우선 정렬: 진행중 → 할일 → 완료는 맨 아래 (달력 칸·아래 날짜 목록 공통).
  // 드래그로 정한 순서는 같은 상태끼리 안에서만 갈린다 (2026-07-22)
  const ST_RANK = { active: 0, todo: 1, keep: 2, done: 3 }

  function orderedEvents(date, evs) {
    const order = (dayOrder && dayOrder[date]) || []
    const idx = (e) => {
      const i = order.indexOf(e.m.id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...evs].sort((a, b) => {
      const r = ST_RANK[memoStatus(a.m)] - ST_RANK[memoStatus(b.m)]
      return r !== 0 ? r : idx(a) - idx(b)
    })
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
    // 날짜 칸을 클릭해 추가하는 맥락 — 글 속 날짜("7/20 메일참고" 같은 참고 표기)는
    // 파싱하지 않고, 클릭한 날짜를 그대로 기한으로 쓴다
    addMemo({ title: txt, due: sel })
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
  // 그 날짜에 걸쳐 있지만 칸에 조각이 없는 장기 기간 — 날짜 목록에 "기간 중"으로 끼워준다
  // ("이 달에 걸친 기간" 칩 줄은 2026-07-24 제거 — 검색이 그 자리를 대체)
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
    longSpanning(date).map((m) => {
      // 폰: 누른 줄이 그 자리에서 상세로 바뀐다 (제목 중복 방지)
      const d = renderDetail ? renderDetail(m.id) : null
      return (
        <Fragment key={'ls' + m.id}>
          {d || (
            <div className={'row' + (localOpenId === m.id ? ' row-sel' : '')} onClick={() => openDetail(m.id)}>
              <span className="badge ev-span">기간 중</span>
              <span className="row-title">
                {m.title} <span className="muted-inline">{diffDays(date, m.period.start) + 1}일차</span>
              </span>
              <span className={'badge st-' + memoStatus(m)}>{STATUS_LABEL[memoStatus(m)]}</span>
            </div>
          )}
        </Fragment>
      )
    })

  function move(n) {
    const nd = new Date(y, mo + n, 1)
    setY(nd.getFullYear())
    setMo(nd.getMonth())
    setSel(null)
    setLocalOpenId(null)
  }

  return (
    <div className={'view' + (!narrow ? ' cal-split' : '')}>
      <div className="cal-left">
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
            selectDay(today)
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
              onClick={() => selectDay(date)}
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
                    // 칩을 누르면 그 날짜를 선택하면서 우측에 상세를 연다
                    setSel(date)
                    openDetail(e.m.id)
                  }}
                >
                  {isDeadline(e) && <b>⚑ </b>}
                  {(e.type === 'start' || e.type === 'end') && <b>{typeLabel(e)} </b>}
                  {e.text}
                </span>
              ))}
              {evs.length > 4 && <span className="cal-more">+{evs.length - 4}</span>}
            </div>
          )
        })}
      </div>
      </div>{/* cal-left */}
      {/* 우측 절반: 날짜를 고르면 그날 목록이 왼쪽에, 목록의 항목을 누르면 그 오른쪽에 상세가 나란히.
          빈 곳 클릭·Esc로 상세→목록→닫힘 순으로 물러난다. 왼쪽 달력은 그대로 (PC, 2026-07-24) */}
      {(sel || localOpen) && (
        <div className="cal-right">
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
          {orderedEvents(sel, events[sel] || []).map((e) => {
            // 폰: 누른 줄이 그 자리에서 상세로 바뀐다 (제목 중복 방지)
            const d = renderDetail ? renderDetail(e.m.id) : null
            if (d) return <Fragment key={e.m.id + e.type}>{d}</Fragment>
            return (
            <Fragment key={e.m.id + e.type}>
            <div
              className={
                'row' +
                (localOpenId === e.m.id ? ' row-sel' : '') +
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
              onClick={() => openDetail(e.m.id)}
            >
              <span className={'badge ' + TYPE[e.type][1]}>{isDeadline(e) && '⚑ '}{typeLabel(e)}</span>
              <span className="row-title">{e.text}</span>
              <SendToDateBtn label="날짜 이동" onPick={(dt) => moveEvent(e.m, e.type, sel, dt)} />
              <span className={'badge st-' + memoStatus(e.m)}>{STATUS_LABEL[memoStatus(e.m)]}</span>
            </div>
            </Fragment>
            )
          })}
          {spanningRows(sel)}
        </div>
          )}
          {localOpen && (
            <div className="cal-detailcol">
              <MemoDetail
                key={localOpen.id}
                inline
                memo={localOpen}
                onOpen={openDetail}
                onClose={() => setLocalOpenId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
