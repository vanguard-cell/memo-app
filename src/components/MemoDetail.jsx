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
    // 폼에서 마감일과 기간이 상호 배타라 여기선 검증만 — 한쪽만 채운 기간은 저장 막기
    if ((form.start && !form.end) || (!form.start && form.end)) {
      window.alert('기간은 시작과 끝을 모두 선택해 주세요.')
      return
    }
    const period = form.start && form.end ? { start: form.start, end: form.end } : null
    updateMemo(memo.id, {
      title: form.title.trim() || memo.title,
      due: period ? null : form.due || null,
      period,
      deadline: period ? memo.deadline || false : false,
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
          <button className="x" onClick={onClose} aria-label={inline ? '접기' : '닫기'} title={inline ? '접기' : '닫기'}>
            {inline ? '▴' : '×'}
          </button>
        </div>
        <div className="panel-meta">
          {memo.period && (
            <span className="meta-date">
              {memo.deadline ? `마감 ${fmtDate(memo.period.end)}` : `기간 ${fmtPeriod(memo.period)}`}
              {dday !== null && (
                <b className={dday < 0 ? 't-red' : 't-blue'}>
                  {' · '}
                  {dday < 0
                    ? `${memo.deadline ? '마감' : '만기'} ${-dday}일 지남`
                    : `${memo.deadline ? '마감' : '만기'} D-${dday}`}
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
          <span className="panel-created">
            작성 {fmtDate(memo.createdAt.slice(0, 10))}
            {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
          </span>
        </div>
        {/* 폰: 드래그가 없으니 여기서 보드 열을 옮긴다 (PC는 드래그로 — 버튼 안 보임) */}
        {inline && !memo.keep && (
          <div className="stage-row">
            <span className="stage-label">상태</span>
            {[
              ['todo', '할일'],
              ['active', '진행중'],
              ['done', '완료'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={'pill' + (st === id ? ' on' : '')}
                onClick={() => {
                  if (st === id) return
                  if (id === 'done') return completeMemo(memo.id)
                  if (memo.status === 'done') reopenMemo(memo.id)
                  updateMemo(memo.id, { stage: id })
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
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
              !inline && <button className="btn-done" onClick={() => completeMemo(memo.id)}>완료 처리</button>
            )
          ) : (
            !inline && <button onClick={() => reopenMemo(memo.id)}>다시 열기</button>
          )}
          {memo.status !== 'done' && !memo.keep && (memo.due || memo.period) && (
            <>
              {/* 기한이 이미 미래면 "내일로"는 무의미(같은 날짜) — 하루 더 미루는 +1일로 바뀐다 */}
              {memo.due && memo.due > today ? (
                <button title="기한을 하루 뒤로" onClick={() => postpone(addDays(memo.due, 1))}>+1일</button>
              ) : (
                <button title="기한을 내일로 이동" onClick={() => postpone(tomorrow)}>내일로</button>
              )}
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
              {/* 마감일과 기간은 상호 배타 — 한쪽을 입력하면 다른 쪽이 비워진다 (기한이 조용히 무시되던 버그 방지) */}
              <label>
                마감일
                <input
                  type="date"
                  value={form.due}
                  onChange={(e) => setForm({ ...form, due: e.target.value, start: '', end: '' })}
                />
              </label>
              <label>
                기간
                <span className="eg-range">
                  <input
                    type="date"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value, due: '' })}
                  />
                  <span className="eg-tilde">~</span>
                  <input
                    type="date"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value, due: '' })}
                  />
                </span>
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
    </aside>
  )
}
