import { useMemo, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo } from '../store'
import { fmtDate, fmtPeriod } from '../derive'
import SendToDateBtn from './SendToDateBtn'

function Chip({ cls, label, onX }) {
  return (
    <span className={'chip ' + cls}>
      {label}
      <button className="chip-x" onClick={onX} aria-label="인식 제거">×</button>
    </span>
  )
}

export default function InputBar() {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState({})
  // "날짜 지정" 버튼으로 직접 고른 기한 — 글에 쓴 날짜보다 우선
  const [pickedDue, setPickedDue] = useState(null)
  const [flash, setFlash] = useState('')

  const parsed = useMemo(() => parse(text), [text])
  const eff = {
    due: removed.due ? null : pickedDue || parsed.due,
    period: removed.period ? null : parsed.period,
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
    addMemo({ title, period: eff.period, due })
    reset()
    say('새 메모로 저장했습니다')
  }

  // 보관: 기한 없이 저장 — 오늘·달력에 안 뜨고 메모탭 검색으로만 꺼내본다
  function saveKeep() {
    const t = text.trim()
    if (!t) return
    addMemo({ title: t, keep: true })
    reset()
    say('보관함에 저장했습니다 — 필요할 때 메모탭에서 검색하세요')
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
          placeholder='여기에 그냥 던지세요 — 예: 7/20 견적 회신 / A업체 계약 26.5.30~27.5.29'
          onChange={(e) => {
            setText(e.target.value)
            if (!e.target.value.trim()) {
              setRemoved({})
              setPickedDue(null)
            }
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn-save" onClick={saveNew}>저장</button>
      </div>
      <div className="chips">
          {!nothing && <span className="chips-label">인식됨</span>}
          {eff.period && (
            <Chip
              cls="chip-date"
              label={`기간 ${fmtPeriod(eff.period)}`}
              onX={() => setRemoved((r) => ({ ...r, period: true }))}
            />
          )}
          {eff.due && (
            <Chip
              cls="chip-date"
              label={`기한 ${fmtDate(eff.due)}`}
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
            <button className="pill pill-keep" title="기한 없이 저장 — 오늘·달력에 안 뜨고 검색으로만 꺼내봅니다" onClick={saveKeep}>
              보관함에 넣기
            </button>
          </span>
      </div>
      {flash && <div className="flash">{flash}</div>}
    </section>
  )
}
