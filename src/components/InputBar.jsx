import { useMemo, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo, addHistory, updateMemo } from '../store'
import { companies, fmtDate, fmtPeriod } from '../derive'

function Chip({ cls, label, onX }) {
  return (
    <span className={'chip ' + cls}>
      {label}
      <button className="chip-x" onClick={onX} aria-label="인식 제거">×</button>
    </span>
  )
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)

// 이번 주 월~금 (주말에 던지면 다음 주 월~금)
function thisWeekPeriod() {
  const t = new Date()
  const day = t.getDay() // 0=일
  const mon = new Date(t)
  mon.setDate(t.getDate() - ((day + 6) % 7) + (day === 0 || day === 6 ? 7 : 0))
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const s = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: s(mon), end: s(fri) }
}

export default function InputBar({ memos, onOpen }) {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState({})
  const [confirming, setConfirming] = useState(false)
  const [flash, setFlash] = useState('')
  const [weekOn, setWeekOn] = useState(false)

  const known = useMemo(() => companies(memos), [memos])
  const parsed = useMemo(() => parse(text, known), [text, known])
  const eff = {
    due: removed.due ? null : parsed.due,
    period: removed.period ? null : parsed.period || (weekOn ? thisWeekPeriod() : null),
    company: removed.company ? null : parsed.company,
  }
  if (eff.period) eff.due = null

  const candidate = useMemo(() => {
    if (!eff.company) return null
    return (
      memos
        .filter((m) => m.status !== 'done' && m.company === eff.company)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] || null
    )
  }, [memos, eff.company])

  function reset() {
    setText('')
    setRemoved({})
    setConfirming(false)
    setWeekOn(false)
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
    addMemo({ title, ...eff, due })
    reset()
    say('새 메모로 저장했습니다')
  }

  function attach() {
    const t = text.trim()
    if (!t || !candidate) return
    addHistory(candidate.id, t, todayStr())
    const patch = {}
    if (eff.period) patch.period = eff.period
    else if (eff.due) patch.due = eff.due
    if (Object.keys(patch).length) updateMemo(candidate.id, patch)
    const id = candidate.id
    reset()
    onOpen(id)
  }

  function submit(shift) {
    if (!text.trim()) return
    if (shift) return saveNew()
    if (confirming) return attach()
    if (candidate) return setConfirming(true)
    saveNew()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setConfirming(false)
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    submit(e.shiftKey)
  }

  const nothing = !eff.period && !eff.due && !eff.company

  return (
    <section className="inputbar">
      <div className="input-row">
        <input
          value={text}
          placeholder='여기에 그냥 던지세요 — 예: A업체 계약 26.5.30~27.5.29'
          onChange={(e) => {
            setText(e.target.value)
            setConfirming(false)
            if (!e.target.value.trim()) setRemoved({})
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn-save" onClick={() => submit(false)}>저장</button>
      </div>
      {text.trim() && (
        <div className="chips">
          <span className="chips-label">인식됨</span>
          {eff.period && (
            <Chip
              cls="chip-date"
              label={`기간 ${fmtPeriod(eff.period)}`}
              onX={() => {
                setWeekOn(false)
                setRemoved((r) => ({ ...r, period: true }))
              }}
            />
          )}
          {eff.due && (
            <Chip cls="chip-date" label={`기한 ${fmtDate(eff.due)}`} onX={() => setRemoved((r) => ({ ...r, due: true }))} />
          )}
          {eff.company && (
            <Chip cls="chip-co" label={`업체 ${eff.company}`} onX={() => setRemoved((r) => ({ ...r, company: true }))} />
          )}
          {!eff.period && !eff.due && (
            <button
              className="pill"
              onClick={() => {
                setWeekOn(true)
                setRemoved((r) => ({ ...r, period: false }))
              }}
            >
              이번 주 월~금에 넣기
            </button>
          )}
          {nothing && <span className="chips-none">날짜 인식 없음 — 오늘 할 일로 들어갑니다</span>}
        </div>
      )}
      {confirming && candidate && (
        <div className="attach-bar">
          <span>'{candidate.company}' 진행중 메모가 있습니다</span>
          <button className="btn-attach" onClick={attach}>
            → "{truncate(candidate.title, 24)}"에 이어붙이기 (Enter)
          </button>
          <button onClick={saveNew}>새 메모로 저장</button>
        </div>
      )}
      {flash && <div className="flash">{flash}</div>}
    </section>
  )
}
