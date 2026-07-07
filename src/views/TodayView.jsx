import { Fragment, useState } from 'react'
import { buildNags, fmtDate } from '../derive'
import { completeMemo, updateMemo, setDayOrder, toggleWorkRun } from '../store'
import { todayStr, addDays } from '../parser'
import { ymOf } from './WorkView'

function Row({ m, tag, tagCls, desc, onOpen, onTomorrow, drag }) {
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
        {onTomorrow && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onTomorrow()
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

export default function TodayView({ memos, works = [], dayOrder, onOpen, renderDetail }) {
  const { overdue, dueToday, upcoming } = buildNags(memos)
  const quiet = !overdue.length && !dueToday.length && !upcoming.length
  const [rowDrop, setRowDrop] = useState(null)
  const today = todayStr()
  const tomorrow = addDays(today, 1)

  // 내일로: 기한이 있는 메모는 기한 자체를 내일로 옮긴다 (달력도 함께 이동).
  // 기간 만기 알림은 만기일을 건드리면 안 되므로 하루 숨김(snooze)으로 처리.
  const tomorrowFor = (it) => () => {
    if (it.kind === 'end') updateMemo(it.m.id, { snoozeUntil: tomorrow })
    else updateMemo(it.m.id, { due: tomorrow })
  }

  // 이번 달 시행하는 점검 업무 (점검 탭과 동일 데이터)
  const now = new Date()
  const curMonth = now.getMonth() + 1
  const curYm = ymOf(now.getFullYear(), curMonth)
  const worksKey = `works-${curYm}`
  const monthWorks = works.filter((w) => (w.months || []).includes(curMonth))

  // 기간 메모에 오늘 날짜의 진행기록 줄이 있으면 줄 설명에 보여준다 (예: 오늘의 식단)
  const lineToday = (m) => {
    const h = (m.history || []).find((x) => x.date === today && x.text)
    return h ? h.text : null
  }

  const idxFor = (date, id) => {
    const order = (dayOrder && dayOrder[date]) || []
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const dateOf = (it) => (it.kind === 'end' ? it.m.period.end : it.m.due)

  dueToday.sort((a, b) => idxFor(today, a.m.id) - idxFor(today, b.m.id))
  upcoming.sort((a, b) => a.dd - b.dd || idxFor(dateOf(a), a.m.id) - idxFor(dateOf(b), b.m.id))

  const openWorks = monthWorks
    .filter((w) => !(w.runs && w.runs[curYm] && w.runs[curYm].done))
    .sort((a, b) => idxFor(worksKey, a.id) - idxFor(worksKey, b.id) || (a.order ?? 0) - (b.order ?? 0))

  function reorder(date, ids0, draggedId, targetId, after) {
    const ids = [...new Set(ids0)].filter((id) => id !== draggedId)
    let pos = ids.indexOf(targetId)
    if (pos === -1) pos = ids.length
    else if (after) pos += 1
    ids.splice(pos, 0, draggedId)
    setDayOrder(date, ids)
  }

  function makeDrag(key, orderKey, itemId, listIds) {
    return {
      dropCls: rowDrop && rowDrop.key === key ? (rowDrop.after ? ' drop-below' : ' drop-above') : '',
      onDragStart: (ev) => {
        ev.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'nag-reorder', id: itemId, date: orderKey }))
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
        if (data.kind !== 'nag-reorder' || data.date !== orderKey || data.id === itemId) return
        reorder(orderKey, listIds(), data.id, itemId, cur ? cur.after : false)
      },
    }
  }

  const dragFor = (item, list) => {
    const date = dateOf(item)
    return makeDrag(item.m.id + item.kind, date, item.m.id, () =>
      list.filter((it) => dateOf(it) === date).map((it) => it.m.id)
    )
  }

  const dragForWork = (w) =>
    makeDrag('work-' + w.id, worksKey, w.id, () => openWorks.map((x) => x.id))

  return (
    <div className="view">
      {overdue.length > 0 && (
        <Section title="미루고 있는 일" cls="sec-red">
          {overdue.map((it) => (
            <Fragment key={it.m.id + it.kind}>
              <Row
                m={it.m}
                tag={`${it.days}일째`}
                tagCls="t-red"
                desc={it.kind === 'end' ? `만기 ${fmtDate(it.m.period.end)} 지남` : null}
                onOpen={onOpen}
                onTomorrow={tomorrowFor(it)}
              />
              {renderDetail && renderDetail(it.m.id)}
            </Fragment>
          ))}
        </Section>
      )}
      {dueToday.length > 0 && (
        <Section title="오늘 할 일" cls="sec-amber">
          {dueToday.map((it) => (
            <Fragment key={it.m.id + it.kind}>
              <Row
                m={it.m}
                tag="오늘"
                tagCls="t-amber"
                desc={
                  it.kind === 'end'
                    ? '오늘 만기' + (lineToday(it.m) ? ` · ${lineToday(it.m)}` : '')
                    : lineToday(it.m)
                }
                onOpen={onOpen}
                onTomorrow={tomorrowFor(it)}
                drag={dragFor(it, dueToday)}
              />
              {renderDetail && renderDetail(it.m.id)}
            </Fragment>
          ))}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="다가오는 일정 · 만기" cls="sec-blue">
          {upcoming.map((it) => (
            <Fragment key={it.m.id + it.kind}>
              <Row
                m={it.m}
                tag={`D-${it.dd}`}
                tagCls="t-blue"
                desc={
                  (it.kind === 'end' ? `만기 ${fmtDate(it.m.period.end)}` : `기한 ${fmtDate(it.m.due)}`) +
                  (lineToday(it.m) ? ` · ${lineToday(it.m)}` : '')
                }
                onOpen={onOpen}
                drag={dragFor(it, upcoming)}
              />
              {renderDetail && renderDetail(it.m.id)}
            </Fragment>
          ))}
        </Section>
      )}
      {monthWorks.length > 0 && (
        <Section
          title={`이번 달 점검 (${curMonth}월) · ${monthWorks.length - openWorks.length}/${monthWorks.length} 완료`}
          cls="sec-teal"
        >
          {openWorks.map((w) => {
            const drag = dragForWork(w)
            return (
              <Fragment key={w.id}>
              <div
                className={'nag-row' + drag.dropCls}
                draggable
                onDragStart={drag.onDragStart}
                onDragOver={drag.onDragOver}
                onDragLeave={drag.onDragLeave}
                onDrop={drag.onDrop}
                onClick={() => onOpen(w.id)}
                title="누르면 이력 패널이 열립니다"
              >
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
              {renderDetail && renderDetail(w.id)}
              </Fragment>
            )
          })}
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
    </div>
  )
}
