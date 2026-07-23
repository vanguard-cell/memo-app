import { useMemo, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo, updateMemo, completeMemo } from '../store'
import { fmtDate, fmtPeriod } from '../derive'
import SendToDateBtn from './SendToDateBtn'

// 음성 입력(마이크 버튼)은 2026-07-18 제거 — 브라우저 음성인식이 기기마다 오작동.
// 나중에 "회의록 녹음 → 정리" 기능으로 다시 설계 예정 (사용자 요청 시).

function Chip({ cls, label, onX }) {
  return (
    <span className={'chip ' + cls}>
      {label}
      <button className="chip-x" onClick={onX} aria-label="인식 제거">×</button>
    </span>
  )
}

// status가 주어지면 "작성 패널" 모드 — 저장 시 그 칸(할일/진행중/완료)으로 만들고 onSaved(id)를 부른다.
// status가 없으면 예전 상단 던지기 입력(현재는 작성 패널에서만 사용).
export default function InputBar({ status, onSaved }) {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState({})
  // "날짜 지정" 버튼으로 직접 고른 기한 — 글에 쓴 날짜보다 우선
  const [pickedDue, setPickedDue] = useState(null)
  const [flash, setFlash] = useState('')

  const parsed = useMemo(() => parse(text), [text])
  const eff = {
    due: removed.due ? null : pickedDue || parsed.due,
    period: removed.period ? null : parsed.period,
    deadline: removed.period ? false : parsed.deadline,
  }
  if (eff.period) eff.due = null

  function reset() {
    setText('')
    setRemoved({})
    setPickedDue(null)
  }

  function say(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 2500)
  }

  function saveNew() {
    const t = text.trim()
    if (!t) return
    const dateAccepted = (parsed.period && !removed.period) || (parsed.due && !removed.due)
    const title = dateAccepted && parsed.cleaned ? parsed.cleaned : t
    // 날짜가 없으면 오늘 기한으로 — 던진 순간부터 오늘 할 일로 들어간다
    const due = eff.due || (eff.period ? null : todayStr())
    const memo = addMemo({ title, period: eff.period, due, deadline: eff.deadline })
    // 작성 패널 모드: 누른 칸의 상태로 만든다 (진행중=stage 지정, 완료=바로 완료 처리)
    if (status === 'active') updateMemo(memo.id, { stage: 'active' })
    else if (status === 'done') completeMemo(memo.id)
    reset()
    if (onSaved) onSaved(memo.id)
    else say('새 메모로 저장했습니다')
  }

  // 보관: 기한 없이 저장 — 오늘·달력에 안 뜨고 메모탭 검색으로만 꺼내본다
  function saveKeep() {
    const t = text.trim()
    if (!t) return
    const memo = addMemo({ title: t, keep: true })
    reset()
    if (onSaved) onSaved(memo.id)
    else say('보관함에 저장했습니다 — 필요할 때 메모탭에서 검색하세요')
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    saveNew()
  }

  const nothing = !eff.period && !eff.due

  return (
    <section className="inputbar">
      <div className="input-row">
        <input
          value={text}
          autoFocus={!!status}
          placeholder={status ? '무엇을 할지 한 줄로 — 예: 7/20 견적 회신' : '여기에 그냥 던지세요 — 예: 7/20 견적 회신'}
          onChange={(e) => {
            setText(e.target.value)
            if (!e.target.value.trim()) {
              setRemoved({})
              setPickedDue(null)
            }
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn-save" onClick={saveNew}>{status ? '추가' : '저장'}</button>
      </div>
      <div className="chips">
          {!nothing && <span className="chips-label">인식됨</span>}
          {eff.period && (
            <Chip
              cls="chip-date"
              label={
                eff.deadline
                  ? `⚑ 마감 ${fmtDate(eff.period.end)} · 오늘부터 표시`
                  : `기간 ${fmtPeriod(eff.period)}`
              }
              onX={() => setRemoved((r) => ({ ...r, period: true }))}
            />
          )}
          {eff.due && (
            <Chip
              cls="chip-date"
              label={`예정 ${fmtDate(eff.due)}`}
              onX={() => {
                setPickedDue(null)
                setRemoved((r) => ({ ...r, due: true }))
              }}
            />
          )}
          {nothing && (
            <span className="chips-none">
              {text.trim() ? '날짜 인식 없음 — 오늘 할 일로 들어갑니다' : '날짜를 안 쓰면 오늘로 들어갑니다'}
            </span>
          )}
          <span className="chips-right">
            {!eff.period && (
              <SendToDateBtn
                label="날짜 지정"
                className="pill"
                onPick={(d) => {
                  setPickedDue(d)
                  setRemoved((r) => ({ ...r, due: false }))
                }}
              />
            )}
            {/* 보관함에 넣기 — 던지기 입력이 사라져서, 새 메모 작성 패널이 유일한 보관 생성 통로다 */}
            <button className="pill pill-keep" title="날짜 없이 저장 — 오늘·달력에 안 뜨고 검색으로만 꺼내봅니다" onClick={saveKeep}>
              보관함에 넣기
            </button>
          </span>
      </div>
      {flash && <div className="flash">{flash}</div>}
    </section>
  )
}
