import { useState } from 'react'
import { buildNags, fmtDate } from '../derive'
import { completeMemo, updateMemo, setDayOrder, toggleWorkRun } from '../store'
import { todayStr, addDays } from '../parser'
import { ymOf } from './WorkView'

function Row({ m, tag, tagCls, desc, onOpen, snoozable, drag }) {
  return (
    <div
      className={'nag-row' + (drag ? drag.dropCls : '')}
      draggable={!!drag}
      onDragStart={drag && drag.onDragStart}
      onDragOver={drag && drag.onDragOver}
      onDragLeave={drag && drag.onDragLeave}
      onDrop={drag && drag.onDrop}
      onClick={() => onOpen(m.id)}
    >
      <span className={'nag-tag ' + tagCls}>{tag}</span>
      <span className="nag-title">
        {m.title}
        {desc && <span className="nag-desc"> · {desc}</span>}
      </span>
      <span className="nag-actions">
        <button
          onClick={(e) => {
            e.stopPropagation()
            completeMemo(m.id)
          }}
        >
          완료
        </button>
        {snoozable && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              updateMemo(m.id, { snoozeUntil: addDays(todayStr(), 1) })
            }}
          >
            내일로
          </button>
        )}
      </span>
    </div>
  )
}

function Section({ title, cls, children }) {
  return (
    <div className={'sec ' + cls}>
      <div className="sec-title">{title}</div>
      {children}
    </div>
  )
}

export default function TodayView({ memos, works = [], dayOrder, onOpen }) {
  const { overdue, dueToday, upcoming, dateless } = buildNags(memos)
  const quiet = !overdue.length && !dueToday.length && !upcoming.length
  const [showDateless, setShowDateless] = useState(false)
  const [rowDrop, setRowDrop] = useState(null)
  const today = todayStr()

  // 이번 달 시행하는 점검 업무 (점검 탭과 동일 데이터)
  const now = new Date()
  const curMonth = now.getMonth() + 1
  const curYm = ymOf(now.getFullYear(), curMonth)
  const monthWorks = works.filter((w) => (w.months || []).includes(curMonth))
  const openWorks = monthWorks.filter((w) => !(w.runs && w.runs[curYm] && w.runs[curYm].done))

  const idxFor = (date, id) => {
    const order = (dayOrder && dayOrder[date]) || []
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const dateOf = (it) => (it.kind === 'end' ? it.m.period.end : it.m.due)

  dueToday.sort((a, b) => idxFor(today, a.m.id) - idxFor(today, b.m.id))
  upcoming.sort((a, b) => a.dd - b.dd || idxFor(dateOf(a), a.m.id) - idxFor(dateOf(b), b.m.id))

  function reorder(date, group, draggedId, targetId, after) {
    const ids = [...new Set(group.map((it) => it.m.id))].filter((id) => id !== draggedId)
    let pos = ids.indexOf(targetId)
    if (pos === -1) pos = ids.length
    else if (after) pos += 1
    ids.splice(pos, 0, draggedId)
    setDayOrder(date, ids)
  }

  function dragFor(item, list) {
    const date = dateOf(item)
    const key = item.m.id + item.kind
    return {
      dropCls: rowDrop && rowDrop.key === key ? (rowDrop.after ? ' drop-below' : ' drop-above') : '',
      onDragStart: (ev) => {
        ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'nag-reorder', id: item.m.id, date }))
        ev.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (ev) => {
        ev.preventDefault()
        const r = ev.currentTarget.getBoundingClientRect()
        setRowDrop({ key, after: ev.clientY > r.top + r.height / 2 })
      },
      onDragLeave: () => setRowDrop((cur) => (cur && cur.key === key ? null : cur)),
      onDrop: (ev) => {
        ev.preventDefault()
        const cur = rowDrop
        setRowDrop(null)
        let data
        try {
          data = JSON.parse(ev.dataTransfer.getData('text/plain'))
        } catch {
          return
        }
        if (data.kind !== 'nag-reorder' || data.date !== date || data.id === item.m.id) return
        reorder(date, list.filter((it) => dateOf(it) === date), data.id, item.m.id, cur ? cur.after : false)
      },
    }
  }

  return (
    <div className="view">
      {overdue.length > 0 && (
        <Section title="미루고 있는 일" cls="sec-red">
          {overdue.map(({ m, days, kind }) => (
            <Row
              key={m.id + kind}
              m={m}
              tag={`${days}일째`}
              tagCls="t-red"
              desc={kind === 'end' ? `만기 ${fmtDate(m.period.end)} 지남` : null}
              onOpen={onOpen}
              snoozable
            />
          ))}
        </Section>
      )}
      {dueToday.length > 0 && (
        <Section title="오늘 할 일" cls="sec-amber">
          {dueToday.map((it) => (
            <Row
              key={it.m.id + it.kind}
              m={it.m}
              tag="오늘"
              tagCls="t-amber"
              desc={it.kind === 'end' ? '오늘 만기' : null}
              onOpen={onOpen}
              snoozable
              drag={dragFor(it, dueToday)}
            />
          ))}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="다가오는 일정 · 만기" cls="sec-blue">
          {upcoming.map((it) => (
            <Row
              key={it.m.id + it.kind}
              m={it.m}
              tag={`D-${it.dd}`}
              tagCls="t-blue"
              desc={it.kind === 'end' ? `만기 ${fmtDate(it.m.period.end)}` : `기한 ${fmtDate(it.m.due)}`}
              onOpen={onOpen}
              drag={dragFor(it, upcoming)}
            />
          ))}
        </Section>
      )}
      {monthWorks.length > 0 && (
        <Section
          title={`이번 달 점검 (${curMonth}월) · ${monthWorks.length - openWorks.length}/${monthWorks.length} 완료`}
          cls="sec-teal"
        >
          {openWorks.map((w) => (
            <div key={w.id} className="nag-row nag-work">
              <span className="nag-tag t-teal">{w.area || '점검'}</span>
              <span className="nag-title">
                {w.title}
                {w.risk && <b className="t-red"> ★</b>}
                {w.evidence && <span className="nag-desc"> · {w.evidence}</span>}
              </span>
              <span className="nag-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleWorkRun(w.id, curYm)
                  }}
                >
                  완료
                </button>
              </span>
            </div>
          ))}
          {openWorks.length === 0 && (
            <div className="empty small">이번 달 점검을 전부 마쳤습니다.</div>
          )}
        </Section>
      )}
      {quiet && (
        <div className="empty">
          지금 괴롭힐 일이 없습니다.
          <br />위 입력창에 던져두면 잊지 않고 여기서 챙겨드립니다.
        </div>
      )}
      {dateless.length > 0 && (
        <div className="sec sec-gray">
          <button className="sec-toggle" onClick={() => setShowDateless((v) => !v)}>
            기한 없는 메모 {dateless.length}건 {showDateless ? '▾' : '▸'}
          </button>
          {showDateless &&
            dateless.map((m) => <Row key={m.id} m={m} tag="메모" tagCls="t-gray" onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}
