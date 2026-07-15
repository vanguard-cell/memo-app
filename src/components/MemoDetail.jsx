import { useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod, diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import Timeline from './Timeline'
import SendToDateBtn from './SendToDateBtn'

export default function MemoDetail({ memo, works = [], onOpen, onClose, inline }) {
  const linkedWork = memo.fromWork ? works.find((w) => w.id === memo.fromWork) : null
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const st = memoStatus(memo)
  const today = todayStr()

  function startEdit() {
    setForm({
      title: memo.title,
      due: memo.due || '',
      start: memo.period?.start || '',
      end: memo.period?.end || '',
    })
    setEditing(true)
  }

  function saveEdit() {
    updateMemo(memo.id, {
      title: form.title.trim() || memo.title,
      due: form.due || null,
      period: form.start && form.end ? { start: form.start, end: form.end } : null,
    })
    setEditing(false)
  }

  const dday = memo.period?.end && memo.status !== 'done' ? diffDays(memo.period.end, today) : null
  const dueD = memo.due && memo.status !== 'done' ? diffDays(memo.due, today) : null

  // 미루기: 기한은 그 날짜로 이동, 기간(만기) 메모는 만기일 안 건드리고 그날까지 숨김
  const tomorrow = addDays(today, 1)
  function postpone(d) {
    if (!memo.due && memo.period) updateMemo(memo.id, { snoozeUntil: d })
    else updateMemo(memo.id, { due: d })
  }

  return (
    <aside className={'detail' + (inline ? ' detail-inline' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
          <span className="panel-title">{memo.title}</span>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="panel-meta">
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
          {linkedWork && onOpen && (
            <button className="linkish" onClick={() => onOpen(linkedWork.id)} title="연결된 점검 열기">
              점검: {linkedWork.title}
            </button>
          )}
        </div>
        <div className="panel-actions">
          {memo.status !== 'done' ? (
            memo.keep ? (
              <button
                className="btn-done"
                title="보관에서 꺼내 오늘 할 일로 보냅니다"
                onClick={() => updateMemo(memo.id, { keep: false, due: todayStr() })}
              >
                오늘 할 일로 꺼내기
              </button>
            ) : (
              <button className="btn-done" onClick={() => completeMemo(memo.id)}>완료 처리</button>
            )
          ) : (
            <button onClick={() => reopenMemo(memo.id)}>다시 열기</button>
          )}
          {memo.status !== 'done' && !memo.keep && (memo.due || memo.period) && (
            <>
              <button onClick={() => postpone(tomorrow)}>내일로</button>
              <SendToDateBtn
                min={memo.due && memo.due < today ? today : tomorrow}
                max={!memo.due && memo.period ? memo.period.end : undefined}
                onPick={postpone}
              />
            </>
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
        <Timeline
          history={memo.history}
          onAdd={(t, d) => addHistory(memo.id, t, d)}
          onToggle={(i) => toggleHistory(memo.id, i)}
          onUpdate={(i, p) => updateHistory(memo.id, i, p)}
          onRemove={(i) => removeHistory(memo.id, i)}
        />
        <div className="panel-foot">
          작성 {fmtDate(memo.createdAt.slice(0, 10))}
          {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
        </div>
    </aside>
  )
}
