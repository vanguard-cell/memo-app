import { Fragment, useRef, useState } from 'react'
import CalendarView from './CalendarView'
import { memoStatus, fmtDate, fmtPeriod, diffDays, STATUS_LABEL } from '../derive'
import { completeMemo, reopenMemo, updateMemo, setDayOrder } from '../store'
import { todayStr } from '../parser'
import useIsNarrow from '../useIsNarrow'

const pad = (n) => String(n).padStart(2, '0')

// 기한 배지: 며칠 밀림(빨강) / 오늘(주황) / D-n(은은한 파랑 하나).
// 날짜별 색 그라데이션은 2026-07-30 제거 — 보드가 알록달록해지는 주범이었다 (스티치 시안 톤).
// withDate: 보드 카드는 날짜 칸이 없어 마감형 배지에 날짜를 같이 담고("7.30까지 D-11"),
// 표는 날짜 칸이 따로 있어 D-n만 담는다 (마감형만 표기가 튀던 문제, 2026-08-01 통일)
// 며칠 남았나를 셀 때 기준이 되는 날. 아직 시작 안 한 기간은 **시작하는 날**까지 센다 —
// "기간의 시작은 예정에 흡수"라는 앱의 날짜 규칙(2026-08-03) 그대로다. 예전엔 늘 끝나는
// 날만 세서, 내일 시작하는 3일짜리 교육이 보드에서 D-3으로 뜨고 D-3 무리 사이에 파묻혔다.
// (2026-08-22 사용자: "내일 시작이고 3일뒤 마감인데 보드에서는 D-3으로 나오네")
// 마감형("~까지"로 던진 것)은 예외 — 그건 끝나는 날이 전부라 시작을 세지 않는다.
const dueAnchor = (m, today) => {
  if (m.due) return m.due
  if (!m.period) return null
  return !m.deadline && today < m.period.start ? m.period.start : m.period.end
}

// 이미 시작해서 지금 굴러가는 기간인가 — 이때는 배지가 끝나는 날을 세므로 "마감"을 붙여
// 구분한다. 안 그러면 오늘 D-1(시작)이던 게 내일 D-2(마감)로 늘어나 보여 헷갈린다.
const inPeriod = (m, today) =>
  !m.due && !!m.period && !m.deadline && today >= m.period.start

function dueBadge(m, today, withDate = true) {
  if (m.status === 'done' || m.keep) return null
  const at = dueAnchor(m, today)
  if (!at) return null
  const dd = diffDays(at, today)
  const md = `${Number(at.slice(5, 7))}.${Number(at.slice(8, 10))}`
  const pre = m.deadline && withDate ? `${md}까지` : ''
  const rp = m.repeat ? '↻ ' : '' // 반복 메모 표시 — 완료하면 다음 주기로 굴러감 (2026-07-31)
  const run = inPeriod(m, today)
  if (dd < 0) return ['b-red', rp + (m.deadline ? (pre ? `${pre} · ${-dd}일 지남` : `${-dd}일 지남`) : `${-dd}일째`)]
  if (dd === 0) return ['b-amber', rp + (m.deadline || run ? '마감 오늘' : '오늘')]
  return ['b-blue', rp + (pre ? `${pre} D-${dd}` : run ? `마감 D-${dd}` : `D-${dd}`)]
}

function checkInfo(m) {
  const items = (m.history || []).filter((h) => h.type !== 'log')
  if (!items.length) return null
  const done = items.filter((h) => h.done).length
  return { label: `체크 ${done}/${items.length}`, complete: done === items.length, done, total: items.length }
}

// 체크 배지 색: 진행 중엔 초록, 완료된 메모는 회색 — 단 체크가 남은 채 완료된 건 노랑(놓친 건지 확인용)
const checkCls = (st, chk) => (st === 'done' ? (chk.complete ? 'b-gray' : 'b-amber') : 'b-teal')

// 오늘/마감·만기 요약 타일(시간 필터)은 2026-07-24 제거 — 급한 순서는 보드 정렬·D-n 배지 색으로 본다.

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

// 급한 순서도 배지와 같은 기준으로 센다 — 내일 시작하는 일이 D-3 무리에 파묻히지 않게
const urgency = (m, today) => {
  const at = dueAnchor(m, today)
  return at ? diffDays(at, today) : Number.MAX_SAFE_INTEGER
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
  // 기간 메모에 오늘 날짜 진행기록이 있으면 카드에 그 줄을 보여준다 (예: 오늘의 식단).
  // 단 마감형은 제외하고, 오늘이 기간 안일 때만 — 오늘 추가한 일반 기록까지 걸려서
  // 아래 힌트 줄과 같은 내용이 두 번 보이던 버그 (2026-07-31)
  const dayLine =
    m.period && !m.deadline && m.period.start <= today && today <= m.period.end
      ? (m.history || []).find((h) => h.date === today && h.text)
      : null
  // "다음 할 일" 흐린 힌트 줄은 2026-07-31 제거 — 실제로 안 읽게 되어 자리만 차지 (사용자 결정)
  return (
    <div
      className={'kb-card' + (st === 'done' ? ' kb-done' : '') + (m.tentative ? ' kb-tent' : '') + dropCls}
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
      {/* D-배지(완료 카드는 완료 날짜)는 카드 우상단 고정(float) — 제목이 옆을 감아 흐른다.
          짧은 제목은 같은 줄, 긴 제목은 배지 아래로 자연스럽게 감겨서 배지가 혼자
          떨어지는 줄이 안 생긴다 (2026-07-31 flex 줄바꿈의 어색함 수정) */}
      <div className="kb-trow">
        {badge && <span className={'kb-badge ' + badge[0]}>{badge[1]}</span>}
        {doneDate && <span className="kb-done-date">완료 {doneDate}</span>}
        <span className={'kb-title' + (m.title ? '' : ' kb-untitled')}>{m.title || '제목 없음'}</span>
      </div>
      {dayLine && <div className="kb-dayline">{dayLine.text}</div>}
      {chk && (
        <div className={'kb-prog-row' + (st === 'done' ? ' done' : '')}>
          <div className="kb-prog">
            <span style={{ width: `${Math.round((chk.done / chk.total) * 100)}%` }} />
          </div>
          <span className={'kb-chk' + (st === 'done' && !chk.complete ? ' warn' : '')}>
            {chk.done}/{chk.total}
          </span>
        </div>
      )}
    </div>
  )
}

function BoardView({ memos, dayOrder, onOpen, onCompose, renderDetail }) {
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
      if (m.repeat && m.due) {
        // 반복 메모: 완료 = 다음 주기로 — 되돌리기는 이전 예정일 복원
        const prev = { due: m.due, stage: m.stage ?? null }
        completeMemo(m.id)
        showUndo(`'${m.title}' 다음 주기로`, () => updateMemo(m.id, prev))
      } else {
        completeMemo(m.id)
        showUndo(`'${m.title}' 완료`, () => reopenMemo(m.id))
      }
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
            {onCompose && <button className="kb-add" title="이 칸에 새 메모" onClick={() => onCompose('todo')}>+</button>}
          </div>
          <div className="kb-head">
            <span className="badge st-active">진행중</span>
            <span className="kb-count">{by.active.length}</span>
            {onCompose && <button className="kb-add" title="이 칸에 새 메모" onClick={() => onCompose('active')}>+</button>}
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
                {onCompose && <button className="kb-add" title="이 칸에 새 메모" onClick={() => onCompose(id)}>+</button>}
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
              {/* 칸 맨 아래 고스트 줄 — 그 칸 상태의 새 메모 (2026-07-30 시안, "여기로 끌어오기" 대체) */}
              {id !== 'done' && onCompose && (
                <button className="kb-ghost" onClick={() => onCompose(id)}>+ 항목 추가</button>
              )}
              {by[id].length === 0 && !onCompose && <div className="kb-empty">여기로 끌어오기</div>}
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

// 컬럼 헤더가 곧 정렬·필터 (2026-07-30 시안): 제목·날짜·체크·작성일 클릭 = ▲→▼→해제,
// 상태 클릭 = 상태별 걸러 보기(전체→진행중→할일→보류→보관→완료 순환). 별도 버튼 줄 없음.
const SORT_VAL = {
  title: (m) => (m.title || '').toLowerCase(),
  date: (m) => m.due || (m.period && m.period.end) || '9999-99-99',
  check: (m) => {
    const c = checkInfo(m)
    return c ? c.done / c.total : -1
  },
  created: (m) => m.createdAt || '',
}
const ST_ORDER = ['active', 'todo', 'hold', 'keep', 'done']
const FILTER_CYCLE = [null, ...ST_ORDER]

function TableView({ memos, dayOrder, words, flat, onOpen, onCompose, renderDetail }) {
  const today = todayStr()
  const [sort, setSort] = useState(null) // { key, dir: 1(▲)|-1(▼) } — 정렬 중엔 그룹 대신 통짜
  const [stFilter, setStFilter] = useState(null)
  const [folded, setFolded] = useState(() => new Set())

  const shown = stFilter ? memos.filter((m) => memoStatus(m) === stFilter) : memos

  function clickSort(key) {
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  }

  function toggleFold(st) {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(st)) next.delete(st)
      else next.add(st)
      return next
    })
  }

  // 표시는 [그룹 머리줄 + 줄들] 묶음의 나열 — 정렬·flat이면 머리줄 없는 묶음 하나
  let sections
  if (sort) {
    const val = SORT_VAL[sort.key]
    const rows = [...shown].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir || byUpdated(a, b)
    })
    sections = [{ st: null, items: rows }]
  } else if (flat) {
    // 만기 타일 등에서: 상태 구분 없이 가까운 날짜부터 촤르륵
    sections = [
      { st: null, items: [...shown].sort((a, b) => urgency(a, today) - urgency(b, today) || byUpdated(a, b)) },
    ]
  } else {
    // 진행중 → 할일 → 보류 → 보관 → 완료 그룹. 진행중·할일 안에서는 보드와 같은 우선순위.
    const groups = { active: [], todo: [], hold: [], keep: [], done: [] }
    for (const m of shown) groups[memoStatus(m)].push(m)
    groups.active.sort(prioSort(dayOrder, 'active', today))
    groups.todo.sort(prioSort(dayOrder, 'todo', today))
    groups.hold.sort(byUpdated)
    groups.keep.sort(byUpdated)
    groups.done.sort(byCompleted)
    sections = ST_ORDER.filter((st) => groups[st].length > 0).map((st) => ({ st, items: groups[st] }))
  }
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  const arrow = (key) => (sort && sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')

  const renderRow = (m) => {
    const st = memoStatus(m)
    const badge = dueBadge(m, today, false) // 표는 날짜 칸이 따로 있어 배지는 D-n만
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
            {/* 마감형도 날짜는 텍스트로, 배지는 D-n만 — 예정·기간과 같은 꼴 (2026-08-01, 깃발 은퇴 08-03) */}
            {m.period ? (m.deadline ? fmtDate(m.period.end) : fmtPeriod(m.period)) : m.due ? fmtDate(m.due) : ''}
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
  }

  return (
    <div className="mv-table-wrap">
      <table className="mv-table">
        <thead>
          <tr>
            <th
              className="mv-th"
              title="누르면 상태별로 걸러 봅니다 — 한 번씩 눌러 순환, 전체로 돌아옵니다"
              onClick={() =>
                setStFilter((cur) => FILTER_CYCLE[(FILTER_CYCLE.indexOf(cur) + 1) % FILTER_CYCLE.length])
              }
            >
              {stFilter ? `상태: ${STATUS_LABEL[stFilter]}` : '상태'} <span className="mv-filter-ic">▽</span>
            </th>
            <th className="mv-th" title="누르면 정렬 (다시 누르면 역순→해제)" onClick={() => clickSort('title')}>
              제목{arrow('title')}
            </th>
            <th className="mv-th" title="누르면 정렬 (다시 누르면 역순→해제)" onClick={() => clickSort('date')}>
              날짜·기간{arrow('date')}
            </th>
            <th className="mv-th" title="누르면 정렬 (다시 누르면 역순→해제)" onClick={() => clickSort('check')}>
              체크{arrow('check')}
            </th>
            <th className="mv-th" title="누르면 정렬 (다시 누르면 역순→해제)" onClick={() => clickSort('created')}>
              작성일{arrow('created')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => (
            <Fragment key={sec.st || 'all'}>
              {sec.st && (
                <tr className="mv-group" onClick={() => toggleFold(sec.st)}>
                  <td colSpan={5}>
                    <span className="mv-group-chev">{folded.has(sec.st) ? '▸' : '▾'}</span>
                    {STATUS_LABEL[sec.st]}
                    <span className="mv-group-n">{sec.items.length}</span>
                  </td>
                </tr>
              )}
              {!(sec.st && folded.has(sec.st)) && sec.items.map(renderRow)}
            </Fragment>
          ))}
          {onCompose && (
            <tr className="mv-ghost" onClick={() => onCompose('todo')}>
              <td colSpan={5}>+ 항목 추가</td>
            </tr>
          )}
        </tbody>
      </table>
      {total === 0 && <div className="empty small">해당하는 메모가 없습니다.</div>}
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
    .filter((m) => !m.keep && !m.hold)
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

export default function MemosView({ memos, routines = [], dayOrder, onOpen, onCompose, renderDetail }) {
  const [q, setQ] = useState('')
  const searchRef = useRef(null)
  // 폰은 들어올 때 항상 보드부터 — 마지막 보기 기억은 PC만 (사용자 요청 2026-07-19)
  const [view, setView] = useState(() =>
    window.matchMedia('(max-width: 899px)').matches
      ? 'board'
      : localStorage.getItem('memo-view') || 'board'
  )
  const today = todayStr()
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  // 검색만 적용된 목록 — 달력 보기는 타일(시간) 필터를 무시한다 (달력 자체가 시간 화면이라 겹치면 텅 비어 보임)
  const searchList = memos.filter((m) => {
    if (!words.length) return true
    const hay = [m.title, m.desc, ...m.history.map((h) => h.text)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const list = searchList

  function pick(v) {
    setView(v)
    localStorage.setItem('memo-view', v)
  }

  // 보드에는 보관·보류 메모가 안 나오므로, 검색 중이면 걸린 것들을 아래에 따로 보여준다
  const keepHits =
    view === 'board' && words.length
      ? list.filter((m) => ['keep', 'hold'].includes(memoStatus(m)))
      : []

  return (
    <div className="view">
      {/* 위쪽: 보기전환 탭(왼쪽) + 검색(오른쪽) 한 줄 — 밑줄 탭 바 (2026-07-30 시안).
          새 메모는 보드 칸의 + 로 만든다 (던지기 입력은 2026-07-24 제거) */}
      <div className="mv-head">
        <div className="mv-toggle">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={'pill' + (view === id ? ' on' : '')} onClick={() => pick(id)}>
              {label}
            </button>
          ))}
        </div>
        {/* 검색칸 오른쪽 × — 한 번에 지운다. 폰은 한 글자씩 지우기가 특히 번거롭다 (2026-08-07).
            지운 뒤에도 커서를 칸에 남겨둬서 키보드가 닫히지 않고 바로 다시 칠 수 있다. */}
        <span className="mv-searchwrap">
          <input
            ref={searchRef}
            className="search-input mv-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.stopPropagation()
                setQ('')
              }
            }}
            placeholder="검색 — 제목·진행기록, 보관·보류·완료까지"
          />
          {q && (
            <button
              className="mv-search-x"
              title="검색어 지우기 (Esc)"
              aria-label="검색어 지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ('')
                if (searchRef.current) searchRef.current.focus()
              }}
            >
              ×
            </button>
          )}
        </span>
      </div>
      {view === 'board' && <BoardView memos={list} dayOrder={dayOrder} onOpen={onOpen} onCompose={onCompose} renderDetail={renderDetail} />}
      {view === 'calendar' && (
        <CalendarView
          memos={searchList}
          routines={routines}
          dayOrder={dayOrder}
          onOpen={onOpen}
          renderDetail={renderDetail}
          filtered={words.length > 0}
        />
      )}
      {view === 'table' && (
        <TableView memos={list} dayOrder={dayOrder} words={words} flat={false} onOpen={onOpen} onCompose={onCompose} renderDetail={renderDetail} />
      )}
      {view === 'timeline' && <TimelineView memos={list} dayOrder={dayOrder} onOpen={onOpen} renderDetail={renderDetail} />}
      {keepHits.length > 0 && (
        <div className="kb-keep">
          <div className="done-divider">검색에 걸린 보관·보류 메모 · {keepHits.length}건</div>
          {keepHits.map((m) => {
            const d = renderDetail ? renderDetail(m.id) : null
            const st = memoStatus(m)
            return (
              <Fragment key={m.id}>
                {d || (
                  <div className="kb-card" onClick={() => onOpen(m.id)}>
                    <div className="kb-meta" style={{ marginTop: 0 }}>
                      <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
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
