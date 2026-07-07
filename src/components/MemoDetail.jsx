import { useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo, attachFile, detachFile } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod, diffDays } from '../derive'
import { todayStr } from '../parser'
import { hasSupabase } from '../supabase'
import Timeline from './Timeline'
import FileSection from './FileSection'

export default function MemoDetail({ memo, works = [], onOpen, onClose, inline }) {
  const linkedWork = memo.fromWork ? works.find((w) => w.id === memo.fromWork) : null
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

  const dday = memo.period?.end && memo.status !== 'done' ? diffDays(memo.period.end, today) : null
  const dueD = memo.due && memo.status !== 'done' ? diffDays(memo.due, today) : null

  return (
    <aside className={'detail' + (inline ? ' detail-inline' : '')} onClick={(e) => e.stopPropagation()}>
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
          {linkedWork && onOpen && (
            <button className="linkish" onClick={() => onOpen(linkedWork.id)} title="연결된 점검 열기">
              점검: {linkedWork.title}
            </button>
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
        <Timeline
          history={memo.history}
          onAdd={(t, d) => addHistory(memo.id, t, d)}
          onToggle={(i) => toggleHistory(memo.id, i)}
          onUpdate={(i, p) => updateHistory(memo.id, i, p)}
          onRemove={(i) => removeHistory(memo.id, i)}
        />
        {hasSupabase && (
          <FileSection
            files={memo.files || []}
            onAttach={(f) => attachFile(memo.id, f)}
            onRemove={(p) => detachFile(memo.id, p)}
          />
        )}
        <div className="panel-foot">
          작성 {fmtDate(memo.createdAt.slice(0, 10))}
          {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
        </div>
    </aside>
  )
}
