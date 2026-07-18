import { useMemo, useRef, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo } from '../store'
import { fmtDate, fmtPeriod } from '../derive'
import SendToDateBtn from './SendToDateBtn'

// 음성 입력 (브라우저 내장, 무료) — 크롬·폰 크롬 지원. 미지원 브라우저에선 버튼이 안 보인다.
// 아이폰 사파리는 웹 음성인식이 사실상 동작하지 않으므로, 키보드 받아쓰기(정확함)를 안내한다.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

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
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const baseTextRef = useRef('')
  const finalRef = useRef('')
  const inputRef = useRef(null)

  // 즉시 끊기 — 어떤 상태에서든 버튼과 인식기를 확실히 되돌린다
  function stopMic() {
    try {
      recRef.current?.abort()
    } catch { /* 이미 끝난 경우 무시 */ }
    recRef.current = null
    setListening(false)
  }

  function toggleMic() {
    if (IS_IOS) {
      inputRef.current?.focus()
      say('아이폰은 키보드의 🎤(받아쓰기)로 말하면 글로 입력됩니다 — 입력창을 누르고 키보드의 마이크를 사용하세요')
      return
    }
    if (listening) return stopMic()
    let rec
    try {
      rec = new SR()
    } catch {
      return
    }
    rec.lang = 'ko-KR'
    rec.interimResults = true
    // 한 마디 모드: 말을 멈추면 저절로 끝난다 (안드로이드에서 continuous 모드가 불안정)
    rec.continuous = false
    baseTextRef.current = text.trim()
    finalRef.current = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current += r[0].transcript
        else interim += r[0].transcript
      }
      const base = baseTextRef.current
      setText(((base ? base + ' ' : '') + finalRef.current + interim).trim())
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
      // 인식이 끝났으면 다음 단계를 알려준다 — 내용은 입력창에 있고, 저장해야 메모가 된다
      if (finalRef.current.trim()) say('🎤 인식 완료 — 아래 인식 결과 확인 후 [저장]을 누르면 메모가 됩니다')
    }
    rec.onerror = (e) => {
      recRef.current = null
      setListening(false)
      // 실패 이유를 화면에 보여준다 — 폰에서 "왜 아무것도 안 나오는지" 알 수 있게
      const code = e && e.error
      if (code === 'no-speech') say('말소리가 인식되지 않았습니다 — 마이크 가까이서 다시 시도해보세요')
      else if (code === 'not-allowed' || code === 'service-not-allowed')
        say('마이크 권한이 막혀 있습니다 — 브라우저 설정에서 이 사이트의 마이크를 허용해주세요')
      else if (code === 'network') say('음성 인식 서버 연결 실패 — 인터넷 상태를 확인해주세요')
      else if (code && code !== 'aborted') say('음성 인식 오류: ' + code)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      stopMic()
    }
  }

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
    addMemo({ title, period: eff.period, due, deadline: eff.deadline })
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
          ref={inputRef}
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
        {SR && (
          <button
            className={'mic-btn' + (listening ? ' listening' : '')}
            title={listening ? '누르면 즉시 중지' : '말로 입력 — 말을 멈추면 저절로 끝납니다'}
            aria-label="음성 입력"
            onClick={toggleMic}
          >
            {listening ? '듣는 중 · 중지' : '🎤'}
          </button>
        )}
        <button className="btn-save" onClick={saveNew}>저장</button>
      </div>
      <div className="chips">
          {!nothing && <span className="chips-label">인식됨</span>}
          {eff.period && (
            <Chip
              cls="chip-date"
              label={
                eff.deadline
                  ? `마감 ${fmtDate(eff.period.end)} · 오늘부터 표시`
                  : `기간 ${fmtPeriod(eff.period)}`
              }
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
