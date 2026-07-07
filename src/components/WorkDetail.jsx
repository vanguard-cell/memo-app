import { useState } from 'react'
import {
  addWorkHistory,
  toggleWorkHistory,
  updateWorkHistory,
  removeWorkHistory,
  setWorkRunNote,
  attachFile,
  detachFile,
  addMemo,
} from '../store'
import { fmtDate, memoStatus, STATUS_LABEL } from '../derive'
import { todayStr } from '../parser'
import { hasSupabase } from '../supabase'
import Timeline from './Timeline'
import FileSection from './FileSection'

function RunHistory({ work }) {
  const runs = Object.entries(work.runs || {})
    .filter(([, r]) => r.done)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
  const [editYm, setEditYm] = useState(null)
  const [text, setText] = useState('')

  if (runs.length === 0) return null

  function save(ym) {
    setWorkRunNote(work.id, ym, text)
    setEditYm(null)
  }

  return (
    <div className="runhist">
      <div className="tl-title">월별 이력</div>
      {runs.map(([ym, r]) => {
        const label = `${ym.slice(2, 4)}년 ${parseInt(ym.slice(5), 10)}월`
        return (
          <div key={ym} className="tl-item">
            <span className="tl-date">{label}</span>
            <span className="tl-text">
              완료 {fmtDate(r.at)}
              {editYm === ym ? (
                <input
                  className="run-note-input"
                  autoFocus
                  value={text}
                  placeholder="특이사항 (Enter 저장, Esc 취소)"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(ym)
                    if (e.key === 'Escape') setEditYm(null)
                  }}
                  onBlur={() => save(ym)}
                />
              ) : r.note ? (
                <button
                  className="run-note"
                  title="누르면 수정"
                  onClick={() => {
                    setText(r.note)
                    setEditYm(ym)
                  }}
                >
                  · {r.note}
                </button>
              ) : (
                <button
                  className="run-note faint"
                  onClick={() => {
                    setText('')
                    setEditYm(ym)
                  }}
                >
                  + 특이사항
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function WorkDetail({ work, memos = [], onOpen, onClose, inline }) {
  const meta = [work.cycle, work.owner, work.evidence && `증빙: ${work.evidence}`]
    .filter(Boolean)
    .join(' · ')
  const linked = memos.filter((m) => m.fromWork === work.id)

  function createAction() {
    const memo = addMemo({ title: `${work.title} — 조치`, due: todayStr(), fromWork: work.id })
    onOpen(memo.id)
  }

  return (
    <aside className={'detail' + (inline ? ' detail-inline' : '')} onClick={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <span className="work-area">{work.area || '점검'}</span>
        <span className="panel-title">
          {work.title}
          {work.risk && <b className="t-red"> ★</b>}
        </span>
        <button className="x" onClick={onClose} aria-label="닫기">×</button>
      </div>
      <div className="panel-meta">
        {meta && <span className="meta-date">{meta}</span>}
      </div>
      <div className="panel-actions">
        <button onClick={createAction}>+ 조치·수리 만들기</button>
      </div>
      <RunHistory work={work} />
      {linked.length > 0 && (
        <div className="linked">
          <div className="tl-title">조치·수리</div>
          {linked.map((m) => (
            <div key={m.id} className="row" onClick={() => onOpen(m.id)}>
              <span className={'badge st-' + memoStatus(m)}>{STATUS_LABEL[memoStatus(m)]}</span>
              <span className="row-title">{m.title}</span>
            </div>
          ))}
        </div>
      )}
      <Timeline
        history={work.history || []}
        onAdd={(t, d) => addWorkHistory(work.id, t, d)}
        onToggle={(i) => toggleWorkHistory(work.id, i)}
        onUpdate={(i, p) => updateWorkHistory(work.id, i, p)}
        onRemove={(i) => removeWorkHistory(work.id, i)}
      />
      {hasSupabase && (
        <FileSection
          files={work.files || []}
          onAttach={(f) => attachFile(work.id, f)}
          onRemove={(p) => detachFile(work.id, p)}
        />
      )}
      <div className="panel-foot">
        월별 완료 체크는 점검 표에서 · 여기는 과정 기록
        {work.createdAt && ` · 등록 ${fmtDate(work.createdAt.slice(0, 10))}`}
      </div>
    </aside>
  )
}
