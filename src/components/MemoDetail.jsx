import { useEffect, useRef, useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod, diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import Timeline from './Timeline'
import SendToDateBtn from './SendToDateBtn'

export default function MemoDetail({ memo, works = [], onOpen, onClose, inline, closing }) {
  const linkedWork = memo.fromWork ? works.find((w) => w.id === memo.fromWork) : null
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  // 작업 설명 — 진행기록(시간순 줄)과 달리 "이 일이 뭔지"를 적어두는 고정 칸.
  // 저장 버튼 없이 자동 저장한다: 타이핑이 멎으면 0.7초 뒤, 포커스가 빠질 때, 패널이 닫힐 때.
  const [desc, setDesc] = useState(memo.desc || '')
  const latestRef = useRef(memo.desc || '')
  const savedRef = useRef(memo.desc || '')
  const timerRef = useRef(null)
  const st = memoStatus(memo)
  const today = todayStr()

  function fitDesc(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function saveDesc() {
    clearTimeout(timerRef.current)
    const v = latestRef.current.trim()
    if (v === savedRef.current) return
    savedRef.current = v
    updateMemo(memo.id, { desc: v })
  }

  function onDescChange(v) {
    setDesc(v)
    latestRef.current = v
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(saveDesc, 700)
  }

  // 패널을 닫거나 다른 메모로 옮겨가도 적던 내용이 날아가지 않게
  useEffect(() => () => saveDesc(), [])

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
    // 폼에서 예정일과 기간이 상호 배타라 여기선 검증만 — 한쪽만 채운 기간은 저장 막기
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
    <aside
      className={'detail' + (inline ? ' detail-inline' : '') + (closing ? ' detail-out' : '')}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="panel-head">
          <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
          <span className="panel-title">{memo.title}</span>
          {inline ? (
            <button className="fold-btn" onClick={onClose}>접기</button>
          ) : (
            <button className="x" onClick={onClose} aria-label="닫기" title="닫기">×</button>
          )}
        </div>
        <div className="panel-meta">
          {memo.period && (
            <span className="meta-date">
              {memo.deadline ? `⚑ 마감 ${fmtDate(memo.period.end)}` : `기간 ${fmtPeriod(memo.period)}`}
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
              예정 {fmtDate(memo.due)}
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
              {/* 밀림·오늘이면 내일로, 이미 미래 날짜면 하루 더 — 라벨은 "하루 미루기" 하나로 통일 */}
              {memo.due && memo.due > today ? (
                <button title="날짜를 하루 뒤로 미룹니다" onClick={() => postpone(addDays(memo.due, 1))}>하루 미루기</button>
              ) : (
                <button title="날짜를 내일로 미룹니다" onClick={() => postpone(tomorrow)}>하루 미루기</button>
              )}
              <SendToDateBtn
                label="날짜 지정"
                min={memo.due && memo.due < today ? today : tomorrow}
                max={!memo.due && memo.period ? memo.period.end : undefined}
                onPick={postpone}
              />
              {/* 예정 ↔ 마감 전환 — "까지"로 안 던진 것도 나중에 진짜 마감으로 바꿀 수 있게 (2026-07-22) */}
              {memo.due && !memo.period && (
                <button
                  title="그날까지 끝낼 일로 바꿉니다 — 달력에 ⚑ 마감(빨강)으로 표시"
                  onClick={() =>
                    updateMemo(memo.id, {
                      due: null,
                      period: { start: today < memo.due ? today : memo.due, end: memo.due },
                      deadline: true,
                    })
                  }
                >
                  마감으로 지정
                </button>
              )}
              {memo.deadline && memo.period && (
                <button
                  title="날짜만 잡힌 예정으로 되돌립니다"
                  onClick={() => updateMemo(memo.id, { due: memo.period.end, period: null, deadline: false })}
                >
                  마감 해제
                </button>
              )}
            </>
          )}
          <button onClick={editing ? () => setEditing(false) : startEdit}>{editing ? '수정 취소' : '정보 수정'}</button>
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm('휴지통으로 옮길까요? 30일 안에는 휴지통에서 복구할 수 있습니다.')) {
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
              {/* 예정일과 기간은 상호 배타 — 한쪽을 입력하면 다른 쪽이 비워진다 (기한이 조용히 무시되던 버그 방지) */}
              <label>
                예정일
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
        <div className="panel-desc">
          <div className="panel-sec-label">작업 설명</div>
          <textarea
            ref={fitDesc}
            className="desc-input"
            value={desc}
            placeholder="이 일이 무엇인지 적어두는 칸 — 배경·목적·담당·참고할 내용"
            onChange={(e) => {
              onDescChange(e.target.value)
              fitDesc(e.target)
            }}
            onBlur={saveDesc}
          />
        </div>
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
