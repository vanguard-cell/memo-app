import { Fragment, useEffect, useMemo, useState } from 'react'
import { fmtDate, fmtPeriod, memoStatus, STATUS_LABEL, diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import { addMemo, updateMemo, setDayOrder, getMemos, purgeMemos } from '../store'
import { holiday, holidayLabel } from '../holidays'
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

// 날짜 조각 어휘는 딱 셋 (2026-08-03 2차 정리, 사용자: 시작·종료·마감이 계속 거슬림):
// 예정 = 단일 날짜 + 기간의 시작(시작은 예정에 흡수), 마감 = 기간의 끝, 기간 = 기간 중간.
// "시작·종료·만기" 표기와 깃발(⚑)은 전부 은퇴 — 마감은 어디서 왔든 같은 얼굴.
const TYPE = {
  due: ['예정', 'ev-due'],
  start: ['예정', 'ev-due'],
  end: ['마감', 'ev-end'],
  span: ['기간', 'ev-span'],
}

// 마감형 메모는 만기 대신 "마감"으로 표기
const typeLabel = (e) => (e.type === 'end' && e.m.deadline ? '마감' : TYPE[e.type][0])

// 마감형("~까지"로 던진 것) 판별 — 표기는 일반 마감과 같고, 칩 색 규칙에만 쓴다 (깃발 은퇴 2026-08-03)
const isDeadline = (e) => e.type === 'end' && e.m.deadline

// 그 날짜의 진행기록 줄 — 있으면 제목 대신 보여준다 (예: 주간 식단 — 월요일 칸엔 월요일 메뉴)
const dayLine = (m, date) => {
  const h = (m.history || []).find((x) => x.date === date && x.text)
  return h ? h.text : null
}

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

  // 제목·기록·설명이 모두 빈 "초안"(칸 + 로 만들었다가 안 쓴 것)은 완전히 지운다 (휴지통 안 남김)
  const discardIfEmptyDraft = (id) => {
    const m = getMemos().find((x) => x.id === id)
    if (m && !(m.title || '').trim() && (!m.history || m.history.length === 0) && !(m.desc || '').trim() && (!m.files || m.files.length === 0) && !m.keep) {
      purgeMemos([m.id])
    }
  }
  const closeLocal = () => {
    const id = localOpenId
    setLocalOpenId(null)
    if (id) discardIfEmptyDraft(id)
  }

  // 항목 열기: PC는 우측 목록 위 인라인(로컬), 폰은 기존 App 인라인
  const openDetail = (id) => {
    if (narrow) return onOpen(id)
    if (localOpenId === id) return closeLocal()
    if (localOpenId) discardIfEmptyDraft(localOpenId)
    setLocalOpenId(id)
  }
  const localOpen = !narrow && localOpenId ? memos.find((m) => m.id === localOpenId) : null

  // 칸의 + — 그 날짜로 새 초안 메모를 만들고 상세를 연다 (보드 +와 같은 흐름)
  const newMemoOn = (date) => {
    if (localOpenId) discardIfEmptyDraft(localOpenId)
    const m = addMemo({ title: '', due: date })
    setSel(date)
    if (narrow) onOpen(m.id)
    else setLocalOpenId(m.id)
  }

  // 날짜를 고르면 그날 목록을 보여주고, 열려있던 상세는 닫는다 (다른 날 상세가 위에 남지 않게)
  const selectDay = (date) => {
    if (localOpenId) discardIfEmptyDraft(localOpenId)
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
      if (localOpenId) {
        discardIfEmptyDraft(localOpenId)
        setLocalOpenId(null)
      } else setSel(null)
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

  // 기간 띠 — 마감형이 아닌 기간 메모(31일 이하)는 칸마다 조각을 찍는 대신 칸 경계를
  // 넘어 쭉 이어진 밴드로 그린다 (구글 캘린더식, 2026-07-31 사용자 요청: 서류접수 기간 등).
  // 겹치는 기간은 레인을 나눠 같은 메모가 항상 같은 줄 높이에 오게 한다.
  const bands = useMemo(() => {
    const list = memos
      .filter(
        (m) =>
          m.period && m.period.start && m.period.end && !m.deadline &&
          diffDays(m.period.end, m.period.start) <= 31
      )
      .sort((a, b) =>
        a.period.start < b.period.start ? -1 : a.period.start > b.period.start ? 1 :
        (a.createdAt || '').localeCompare(b.createdAt || '')
      )
    const laneEnd = [] // 레인별 마지막 만기 — 빈 레인부터 채운다
    const lanes = new Map()
    for (const m of list) {
      let lane = laneEnd.findIndex((e) => e < m.period.start)
      if (lane === -1) {
        lane = laneEnd.length
        laneEnd.push(m.period.end)
      } else laneEnd[lane] = m.period.end
      lanes.set(m.id, lane)
    }
    return { list, lanes }
  }, [memos])
  const isBanded = (id) => bands.lanes.has(id)

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
            <div
              className={'row' + (memoStatus(m) === 'active' ? ' doing' : '') + (localOpenId === m.id ? ' row-sel' : '')}
              onClick={() => openDetail(m.id)}
            >
              <span className="badge ev-span">기간 중</span>
              <span className="row-title">
                {m.title} <span className="muted-inline">{diffDays(date, m.period.start) + 1}일차</span>
              </span>
            </div>
          )}
        </Fragment>
      )
    })

  function move(n) {
    const nd = new Date(y, mo + n, 1)
    if (localOpenId) discardIfEmptyDraft(localOpenId)
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
          // 공휴일·대체공휴일: 날짜를 빨갛게 + 이름표. 일요일 빨강·토요일 파랑은 요일 머리와 같은 규칙
          const hol = holiday(date)
          const dw = i % 7 // 칸 index = 열 = 요일 (0=일)
          // 띠로 그리는 기간 메모는 칸 조각(시작·중간·만기 칩)에서 뺀다 — 날짜 목록엔 그대로 남는다
          const evs = orderedEvents(date, events[date] || []).filter((e) => !isBanded(e.m.id))
          // 이 날짜를 지나는 띠들 — 레인 순서대로, 빈 레인은 투명 칸으로 높이를 맞춘다
          const cellBands = bands.list.filter((m) => m.period.start <= date && date <= m.period.end)
          const maxLane = cellBands.length
            ? Math.max(...cellBands.map((m) => bands.lanes.get(m.id)))
            : -1
          const laneEls = []
          for (let li = 0; li <= maxLane; li++) {
            const bm = cellBands.find((x) => bands.lanes.get(x.id) === li)
            if (!bm) {
              laneEls.push(<span key={'g' + li} className="cal-band cal-band-ghost" />)
              continue
            }
            const bst = memoStatus(bm)
            const isS = date === bm.period.start
            const isE = date === bm.period.end
            // 제목은 시작날과 매주 첫 칸(일요일)에만 — 띠가 길어도 어느 주에서든 이름이 보인다
            const btext = dayLine(bm, date) || (isS || new Date(date + 'T00:00').getDay() === 0 ? bm.title : '')
            laneEls.push(
              <span
                key={bm.id}
                className={
                  'cal-band' + (isS ? ' b-s' : '') + (isE ? ' b-e' : '') +
                  (bst === 'done' ? ' bd-done' : bst === 'active' ? ' bd-doing' : '')
                }
                title={bm.title}
                draggable
                onDragStart={(ev) => {
                  // 시작·만기 칸을 끌면 그쪽 끝만, 중간을 끌면 기간 전체 평행이동 (조각 때와 동일)
                  ev.dataTransfer.setData(
                    'text/plain',
                    JSON.stringify({ id: bm.id, type: isS ? 'start' : isE ? 'end' : 'span', date })
                  )
                  ev.dataTransfer.effectAllowed = 'move'
                }}
                onClick={(ev) => {
                  ev.stopPropagation()
                  setSel(date)
                  openDetail(bm.id)
                }}
              >
                {btext}
              </span>
            )
          }
          // 칩 표시 수는 띠가 차지한 줄만큼 줄인다 (칸 높이 안에서)
          const chipLimit = Math.max(1, 4 - laneEls.length)
          return (
            <div
              key={date}
              className={
                'cal-cell' +
                (date === today ? ' cal-now' : '') +
                (sel === date ? ' cal-sel' : '') +
                (dropTarget === date ? ' cal-drop' : '') +
                (hol ? ' cal-hol' : '')
              }
              onClick={() => selectDay(date)}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(date)
              }}
              onDragLeave={() => setDropTarget((cur) => (cur === date ? null : cur))}
              onDrop={(e) => onDrop(date, e)}
            >
              <span className={'cal-day' + (hol || dw === 0 ? ' d-red' : dw === 6 ? ' d-blue' : '')}>{d}</span>
              {hol && (
                <span className="cal-holname" title={holidayLabel(date)}>
                  {hol.name}
                </span>
              )}
              {/* 칸 우측 상단 + — 그 날짜로 새 메모. PC에서 칸에 마우스를 올리면 나타난다 */}
              {!narrow && (
                <button
                  className="cal-cell-add"
                  title="이 날짜에 새 메모"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    newMemoOn(date)
                  }}
                >
                  +
                </button>
              )}
              {laneEls}
              {evs.slice(0, chipLimit).map((e, j) => {
                const st = memoStatus(e.m)
                return (
                <span
                  key={j}
                  className={
                    'cal-ev ' +
                    TYPE[e.type][1] +
                    // 진행중인 메모는 보드 진행중과 같은 초록으로 — 굴러가는 중임이 달력에서도 보인다.
                    // 단 마감(빨강)은 급한 표시가 우선이라 색을 안 바꾼다 (2026-07-26)
                    (st === 'done' ? ' ev-done' : st === 'active' && !isDeadline(e) ? ' ev-doing' : '')
                  }
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
                  {(e.type === 'start' || e.type === 'end') && <b>{typeLabel(e)} </b>}
                  {e.text}
                </span>
                )
              })}
              {evs.length > chipLimit && <span className="cal-more">+{evs.length - chipLimit}</span>}
            </div>
          )
        })}
      </div>
      </div>{/* cal-left */}
      {/* 우측 절반: 날짜를 고르면 그날 목록, 항목을 누르면 보드·표와 똑같은 도킹 패널이
          우측 절반을 덮는다 (2026-07-31 "셋 다 보드 기준" 통일). ×·빈 곳 클릭·Esc로
          상세→목록→닫힘 순으로 물러나고, 패널이 닫히면 밑의 목록이 그대로 드러난다. */}
      {(sel || localOpen) && (
        <div className="cal-right">
          {sel && (
        <div className="cal-detail">
          <div className="cal-detail-title">
            {fmtDate(sel)} ({['일', '월', '화', '수', '목', '금', '토'][new Date(sel + 'T00:00').getDay()]})
            {holiday(sel) && <span className="cal-hol-tag">{holidayLabel(sel)}</span>}
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
                (memoStatus(e.m) === 'done' ? ' done' : '') +
                (memoStatus(e.m) === 'active' ? ' doing' : '') +
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
              {/* 왼쪽 배지 하나로 통일: 완료된 줄은 종류 대신 회색 "완료", 아니면 예정·마감·기간.
                  진행중은 줄의 은은한 초록 바탕으로만 (2026-08-03) */}
              {memoStatus(e.m) === 'done' ? (
                <span className="badge st-done">{STATUS_LABEL.done}</span>
              ) : (
                <span className={'badge ' + TYPE[e.type][1]}>{typeLabel(e)}</span>
              )}
              <span className="row-title">{e.text}</span>
            </div>
            </Fragment>
            )
          })}
          {spanningRows(sel)}
        </div>
          )}
          {localOpen && (
            <MemoDetail key={localOpen.id} memo={localOpen} onOpen={openDetail} onClose={closeLocal} />
          )}
        </div>
      )}
    </div>
  )
}
