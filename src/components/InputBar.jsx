import { useMemo, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo } from '../store'
import { fmtDate, fmtPeriod } from '../derive'

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
  const [flash, setFlash] = useState('')

  const parsed = useMemo(() => parse(text), [text])
  const eff = {
    due: removed.due ? null : parsed.due,
    period: removed.period ? null : parsed.period,
  }
  if (eff.period) eff.due = null

  function reset() {
    setText('')
    setRemoved({})
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
          placeholder='여기에 그냥 던지세요 — 예: A업체 계약 26.5.30~27.5.29'
          onChange={(e) => {
            setText(e.target.value)
            if (!e.target.value.trim()) setRemoved({})
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn-save" onClick={saveNew}>저장</button>
      </div>
      {text.trim() && (
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
            <Chip cls="chip-date" label={`기한 ${fmtDate(eff.due)}`} onX={() => setRemoved((r) => ({ ...r, due: true }))} />
          )}
          {nothing && <span className="chips-none">날짜 인식 없음 — 오늘 할 일로 들어갑니다</span>}
          <button className="pill pill-keep" title="기한 없이 저장 — 오늘·달력에 안 뜨고 검색으로만 꺼내봅니다" onClick={saveKeep}>
            보관함에 넣기
          </button>
        </div>
      )}
      {flash && <div className="flash">{flash}</div>}
    </section>
  )
}
