import { useState } from 'react'
import { buildNags, fmtDate } from '../derive'
import { completeMemo, updateMemo } from '../store'
import { todayStr, addDays } from '../parser'

function Row({ m, tag, tagCls, desc, onOpen, snoozable }) {
  return (
    <div className="nag-row" onClick={() => onOpen(m.id)}>
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

export default function TodayView({ memos, dayOrder, onOpen }) {
  const { overdue, dueToday, upcoming, dateless } = buildNags(memos)
  const quiet = !overdue.length && !dueToday.length && !upcoming.length
  const [showDateless, setShowDateless] = useState(false)

  const order = (dayOrder && dayOrder[todayStr()]) || []
  const orderIdx = (id) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  dueToday.sort((a, b) => orderIdx(a.m.id) - orderIdx(b.m.id))

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
          {dueToday.map(({ m, kind }) => (
            <Row
              key={m.id + kind}
              m={m}
              tag="오늘"
              tagCls="t-amber"
              desc={kind === 'end' ? '오늘 만기' : null}
              onOpen={onOpen}
              snoozable
            />
          ))}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="다가오는 일정 · 만기" cls="sec-blue">
          {upcoming.map(({ m, dd, kind }) => (
            <Row
              key={m.id + kind}
              m={m}
              tag={`D-${dd}`}
              tagCls="t-blue"
              desc={kind === 'end' ? `만기 ${fmtDate(m.period.end)}` : `기한 ${fmtDate(m.due)}`}
              onOpen={onOpen}
            />
          ))}
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
