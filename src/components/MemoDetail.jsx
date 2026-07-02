import { useState } from 'react'
import { addHistory, toggleHistory, updateMemo, completeMemo, reopenMemo, deleteMemo } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod, diffDays } from '../derive'
import { todayStr } from '../parser'

export default function MemoDetail({ memo, onClose }) {
  const [line, setLine] = useState('')
  const [lineDate, setLineDate] = useState(todayStr())
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const st = memoStatus(memo)
  const today = todayStr()

  function startEdit() {
    setForm({
      title: memo.title,
      company: memo.company || '',
      due: memo.due || '',
      start: memo.period?.start || '',
      end: memo.period?.end || '',
    })
    setEditing(true)
  }

  function saveEdit() {
    updateMemo(memo.id, {
      title: form.title.trim() || memo.title,
      company: form.company.trim() || null,
      due: form.due || null,
      period: form.start && form.end ? { start: form.start, end: form.end } : null,
    })
    setEditing(false)
  }

  function submitLine() {
    const t = line.trim()
    if (!t) return
    addHistory(memo.id, t, lineDate || today)
    setLine('')
  }

  const dday = memo.period?.end && memo.status !== 'done' ? diffDays(memo.period.end, today) : null
  const dueD = memo.due && memo.status !== 'done' ? diffDays(memo.due, today) : null

  return (
    <aside className="detail">
        <div className="panel-head">
          <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
          <span className="panel-title">{memo.title}</span>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="panel-meta">
          {memo.company && <span className="chip chip-co">{memo.company}</span>}
          {memo.period && (
            <span className="meta-date">
              기간 {fmtPeriod(memo.period)}
              {dday !== null && (
                <b className={dday < 0 ? 't-red' : 't-blue'}>
                  {' · '}
                  {dday < 0 ? `만기 ${-dday}일 지남` : `만기 D-${dday}`}
                </b>
              )}
            </span>
          )}
          {memo.due && !memo.period && (
            <span className="meta-date">
              기한 {fmtDate(memo.due)}
              {dueD !== null && (
                <b className={dueD < 0 ? 't-red' : ''}>
                  {' · '}
                  {dueD < 0 ? `${-dueD}일 지남` : dueD === 0 ? '오늘' : `D-${dueD}`}
                </b>
              )}
            </span>
          )}
        </div>
        <div className="panel-actions">
          {memo.status !== 'done' ? (
            <button className="btn-done" onClick={() => completeMemo(memo.id)}>완료 처리</button>
          ) : (
            <button onClick={() => reopenMemo(memo.id)}>다시 열기</button>
          )}
          <button onClick={editing ? () => setEditing(false) : startEdit}>{editing ? '수정 취소' : '정보 수정'}</button>
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm('이 메모와 진행기록을 모두 삭제할까요?')) {
                deleteMemo(memo.id)
                onClose()
              }
            }}
          >
            삭제
          </button>
        </div>
        {editing && form && (
          <div className="edit-form">
            <label>
              제목
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <div className="edit-grid">
              <label>
                업체
                <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </label>
              <label>
                기한
                <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </label>
              <label>
                기간 시작
                <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </label>
              <label>
                기간 끝
                <input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </label>
            </div>
            <button className="btn-done" onClick={saveEdit}>저장</button>
          </div>
        )}
        <div className="timeline">
          <div className="tl-title">
            진행 기록
            {(() => {
              const items = memo.history.filter((h) => h.type !== 'log')
              const done = items.filter((h) => h.done).length
              return items.length > 0 ? <span className="tl-progress"> · 체크 {done}/{items.length}</span> : null
            })()}
          </div>
          {memo.history.length === 0 && (
            <div className="empty small">아직 진행 기록이 없습니다. 아래에 한 줄씩 남기세요.</div>
          )}
          {memo.history.map((h, i) => (
            <div key={i} className={'tl-item' + (h.done ? ' tl-done' : '')}>
              {h.type === 'log' ? (
                <span className="tl-check tl-log">·</span>
              ) : (
                <input
                  type="checkbox"
                  className="tl-check"
                  checked={!!h.done}
                  onChange={() => toggleHistory(memo.id, i)}
                />
              )}
              <span className="tl-date">{fmtDate(h.date)}</span>
              <span className="tl-text">{h.text}</span>
            </div>
          ))}
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
        <div className="panel-foot">
          작성 {fmtDate(memo.createdAt.slice(0, 10))}
          {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
        </div>
    </aside>
  )
}
