import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod } from '../derive'

export default function MemoRow({ memo, onOpen }) {
  const st = memoStatus(memo)
  const dateInfo = memo.period
    ? fmtPeriod(memo.period)
    : memo.due
      ? fmtDate(memo.due)
      : fmtDate(memo.createdAt.slice(0, 10))
  const items = memo.history.filter((h) => h.type !== 'log')
  const doneCount = items.filter((h) => h.done).length
  return (
    <div className={'row' + (st === 'done' ? ' done' : '')} onClick={() => onOpen(memo.id)}>
      <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
      <span className="row-title">{memo.title}</span>
      {items.length > 0 && <span className="row-check">✓ {doneCount}/{items.length}</span>}
      {memo.company && <span className="chip chip-co">{memo.company}</span>}
      <span className="row-date">{dateInfo}</span>
    </div>
  )
}
