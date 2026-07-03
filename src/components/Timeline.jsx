import { useState } from 'react'
import { fmtDate } from '../derive'
import { todayStr } from '../parser'

// 진행 기록 공용 UI — 메모 상세(MemoDetail)와 점검 상세(WorkDetail)가 같이 쓴다.
// onAdd(text, date) / onToggle(i) / onUpdate(i, patch) / onRemove(i)
export default function Timeline({ history, onAdd, onToggle, onUpdate, onRemove }) {
  const today = todayStr()
  const [line, setLine] = useState('')
  const [lineDate, setLineDate] = useState(today)
  const [editIdx, setEditIdx] = useState(null)
  const [editText, setEditText] = useState('')
  const [editDate, setEditDate] = useState('')

  function submitLine() {
    const t = line.trim()
    if (!t) return
    onAdd(t, lineDate || today)
    setLine('')
  }

  function startLineEdit(i, h) {
    setEditIdx(i)
    setEditText(h.text)
    setEditDate(h.date)
  }

  function saveLineEdit() {
    const t = editText.trim()
    if (t) onUpdate(editIdx, { text: t, date: editDate || today })
    setEditIdx(null)
  }

  return (
    <div className="timeline">
      <div className="tl-title">
        진행 기록
        {(() => {
          const items = history.filter((h) => h.type !== 'log')
          const done = items.filter((h) => h.done).length
          return items.length > 0 ? <span className="tl-progress"> · 체크 {done}/{items.length}</span> : null
        })()}
      </div>
      {history.length === 0 && (
        <div className="empty small">아직 진행 기록이 없습니다. 아래에 한 줄씩 남기세요.</div>
      )}
      {history.map((h, i) =>
        editIdx === i ? (
          <div key={i} className="tl-item tl-editing">
            <input
              type="date"
              className="tl-date-input"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
            <input
              className="tl-input"
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLineEdit()
                if (e.key === 'Escape') setEditIdx(null)
              }}
            />
            <button onClick={saveLineEdit}>저장</button>
            <button onClick={() => setEditIdx(null)}>취소</button>
          </div>
        ) : (
          <div key={i} className={'tl-item' + (h.done ? ' tl-done' : '')}>
            {h.type === 'log' ? (
              <span className="tl-check tl-log">·</span>
            ) : (
              <input
                type="checkbox"
                className="tl-check"
                checked={!!h.done}
                onChange={() => onToggle(i)}
              />
            )}
            <span className="tl-date">{fmtDate(h.date)}</span>
            <span className="tl-text tl-editable" title="누르면 수정" onClick={() => startLineEdit(i, h)}>
              {h.text}
            </span>
            <button
              className="tl-x"
              aria-label="이 줄 삭제"
              onClick={() => {
                if (window.confirm('이 진행기록 한 줄을 삭제할까요?\n"' + h.text + '"')) {
                  onRemove(i)
                  if (editIdx !== null) setEditIdx(null)
                }
              }}
            >
              ×
            </button>
          </div>
        )
      )}
      <div className="tl-add">
        <input type="date" className="tl-date-input" value={lineDate} onChange={(e) => setLineDate(e.target.value)} />
        <input
          className="tl-input"
          value={line}
          placeholder="진행사항 한 줄 추가 (Enter)"
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitLine()
          }}
        />
        <button onClick={submitLine}>추가</button>
      </div>
    </div>
  )
}
