import { useEffect, useRef, useState } from 'react'
import {
  updateMemo, updateRoutine, stopRoutine, makeRoutineFromMemo, routineOf, shiftYm,
  checkAlarm, uncheckAlarm, blankTitle,
} from '../store'
import { diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import {
  REPEAT_OPTIONS, ROUTINE_KINDS, kindOfMonths, monthsFor,
  ALARM_PRESETS, ALARM_UNITS, alarmMode, alarmLabel, alarmStart, timeText,
} from '../schedule'

// 상세 패널의 "일정" 칸 — 아이폰 달력처럼 하루 종일 / 시작 / 종료 / 반복 / 미리 알림 (2026-09-15).
// 예전의 "기간으로"·"루틴으로" 링크, 정보 수정 폼, 마감 버튼을 이 한 묶음이 대신한다.
// 저장 모양은 그대로다: 시작=종료면 due(하루짜리), 다르면 period. 시간은 time·endTime.

const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const DOW = ['일', '월', '화', '수', '목', '금', '토']

// 미리 알림 고르기 — 루틴 수정 폼도 같이 쓴다.
// 내용(그날 할 일)은 필수: 비어 있으면 저장하지 않고 안내만 띄운다 (사용자 확정).
export function AlarmField({ alarm, onChange }) {
  const [mode, setMode] = useState(() => alarmMode(alarm))
  const [draft, setDraft] = useState(() => (alarm ? { ...alarm } : { n: 1, unit: 'w', daily: false, text: '' }))
  const [err, setErr] = useState(false)
  // 다른 곳(다른 기기·루틴 화면)에서 바뀐 값을 따라간다
  const sig = alarm ? `${alarm.n}|${alarm.unit}|${alarm.daily ? 1 : 0}|${alarm.text}` : ''
  useEffect(() => {
    setMode(alarmMode(alarm))
    if (alarm) setDraft({ ...alarm })
    setErr(false)
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  function commit(next, nextMode) {
    if (nextMode === '0') {
      setErr(false)
      if (alarm) onChange(null)
      return
    }
    const text = (next.text || '').trim()
    if (!text) {
      setErr(true)
      return
    }
    setErr(false)
    onChange({ n: Math.max(1, Math.round(Number(next.n) || 1)), unit: next.unit, daily: !!next.daily, text })
  }

  function pick(v) {
    setMode(v)
    const preset = ALARM_PRESETS.find(([k]) => k === v)
    const next = { ...draft, ...(preset ? preset[2] : {}) }
    setDraft(next)
    commit(next, v)
  }

  const set = (patch, save) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (save) commit(next, mode)
  }

  return (
    <>
      <select className="sched-select" value={mode} onChange={(e) => pick(e.target.value)}>
        <option value="0">안 함</option>
        {ALARM_PRESETS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
        <option value="custom">사용자화…</option>
      </select>
      {mode !== '0' && (
        <div className="sched-sub">
          {mode === 'custom' && (
            <>
              <input
                type="number"
                min="1"
                max="365"
                className="sched-input sched-num"
                value={draft.n}
                onChange={(e) => set({ n: e.target.value })}
                onBlur={() => commit(draft, mode)}
              />
              <select className="sched-select" value={draft.unit} onChange={(e) => set({ unit: e.target.value }, true)}>
                {ALARM_UNITS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          <select
            className="sched-select"
            value={draft.daily ? 'daily' : 'once'}
            onChange={(e) => set({ daily: e.target.value === 'daily' }, true)}
          >
            <option value="once">그날만 표시</option>
            <option value="daily">그날부터 매일 표시</option>
          </select>
          <input
            className="sched-input sched-text"
            value={draft.text}
            placeholder="그날 할 일 — 예: 세금계산서 발행"
            onChange={(e) => {
              set({ text: e.target.value })
              if (err && e.target.value.trim()) setErr(false)
            }}
            onBlur={() => commit(draft, mode)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              e.currentTarget.blur()
            }}
          />
          {err && <span className="sched-err">미리 알림 내용을 적어야 저장됩니다</span>}
        </div>
      )}
    </>
  )
}

export function ScheduleBlock({ memo }) {
  const today = todayStr()
  const rt = memo.routineId ? routineOf(memo.routineId) : null
  const nextYm = memo.ym ? shiftYm(memo.ym, 1) : null
  // 루틴이 이 회차 뒤로도 이어지나 — 이 회차에서 끊었으면(endYm = 다음 달) 반복 "안 함"으로 보인다
  const rtLive = !!rt && (!rt.endYm || (!!nextYm && rt.endYm > nextYm))
  const kind = rtLive
    ? kindOfMonths(rt.months)
    : ['weekly', 'monthly', 'yearly'].includes(memo.repeat)
      ? memo.repeat
      : 'none'
  const start = memo.due || (memo.period && memo.period.start) || today
  const end = memo.due || (memo.period && memo.period.end) || start
  const repeating = kind !== 'none'
  const allDay = !memo.time && !memo.endTime
  const alarm = rt ? rt.alarm || null : memo.alarm || null
  const timeRef = useRef(null)
  // 날짜 칸에 받을 수 없는 값을 넣었을 때 칸을 원래 값으로 되돌리는 용도
  const [bump, setBump] = useState(0)
  const [msg, setMsg] = useState('')

  function writeDates(s, e) {
    const endDate = !e || e < s ? s : e
    updateMemo(memo.id, s === endDate ? { due: s, period: null } : { due: null, period: { start: s, end: endDate } })
  }

  // 시작을 옮기면 종료도 같은 간격만큼 따라간다 (3일짜리는 옮겨도 3일짜리)
  function onStart(v) {
    if (!v) return setBump((b) => b + 1)
    const len = Math.max(0, diffDays(end, start))
    writeDates(v, repeating ? v : addDays(v, len))
  }

  function onEnd(v) {
    if (!v || v < start) return setBump((b) => b + 1)
    writeDates(start, v)
  }

  // 시간을 넣으면 하루 종일이 저절로 꺼지고, 둘 다 지우면 다시 켜진다(시간 유무로 판단)
  function onTime(field, v) {
    updateMemo(memo.id, { [field]: v || null })
  }

  function toggleAllDay() {
    if (!allDay) return updateMemo(memo.id, { time: null, endTime: null })
    const el = timeRef.current
    if (!el) return
    el.focus()
    try {
      el.showPicker()
    } catch {
      /* 고르기 창을 못 여는 브라우저 — 칸에 커서만 둔다 */
    }
  }

  function onRepeat(next) {
    setMsg('')
    if (next === kind) return
    const toRoutine = ROUTINE_KINDS.includes(next)
    const baseMonth = Number(start.slice(5, 7))
    if (toRoutine && !rt && blankTitle(memo.title)) {
      setMsg('제목을 먼저 적어 주세요')
      return
    }
    // 루틴을 끊는다 — 이 회차까지만 하고 다음 달부터 안 함 (지난 기록은 그대로)
    if (rtLive && !toRoutine) stopRoutine(rt.id, nextYm, rt.endNote || '')
    if (next === 'none') {
      if (memo.repeat) updateMemo(memo.id, { repeat: null, repeatUntil: null })
      return
    }
    if (next === 'weekly') {
      updateMemo(memo.id, {
        repeat: 'weekly',
        due: start,
        period: null,
        ...(rt ? { routineId: null, ym: null } : {}),
      })
      return
    }
    const months = monthsFor(next, baseMonth)
    if (rt) {
      // 이미 루틴 회차 — 주기만 바꾸거나, 끊었던 루틴을 다시 잇는다
      updateRoutine(rt.id, { months, ...(rtLive ? {} : { endYm: null }) })
      return
    }
    makeRoutineFromMemo(memo.id, { months })
  }

  const onAlarm = (a) => (rt ? updateRoutine(rt.id, { alarm: a }) : updateMemo(memo.id, { alarm: a }))

  // D-day — 하루짜리는 그날, 아직 시작 안 한 기간은 시작일, 굴러가는 기간은 끝나는 날을 센다
  let dd = null
  let ddText = ''
  if (memo.status !== 'done') {
    const running = !memo.due && !!memo.period && today >= start
    dd = diffDays(running ? end : start, today)
    ddText = dd < 0 ? `${-dd}일 지남` : dd === 0 ? (running ? '마감 오늘' : '오늘') : running ? `마감 D-${dd}` : `D-${dd}`
  }

  const day = Number(start.slice(8, 10))
  const repeatText = {
    weekly: `매주 ${DOW[new Date(start + 'T00:00').getDay()]}요일`,
    monthly: `매월 ${rt && Number(rt.dueShift) === 1 ? '다음 달 ' : ''}${rt ? Number(rt.dueDay) || day : day}일`,
    quarter: '분기마다',
    half: '반기마다',
    yearly: `매년 ${Number(start.slice(5, 7))}월 ${day}일`,
    custom: '정해둔 달마다',
  }[kind]
  const summary = [
    start === end ? md(start) : `${md(start)} ~ ${md(end)}`,
    allDay ? '하루 종일' : timeText(memo),
    repeatText,
    alarm ? `미리 알림 ${alarmLabel(alarm)}${alarm.daily ? ' 매일' : ''}` : '',
  ].filter(Boolean)

  const aStart = alarm && alarm.text ? alarmStart(start, alarm) : null

  return (
    <>
      <div className="sched">
        <div className="sched-row">
          <span className="sched-k">하루 종일</span>
          <button
            type="button"
            role="switch"
            aria-checked={allDay}
            aria-label="하루 종일"
            className={'sched-switch' + (allDay ? ' on' : '')}
            title={allDay ? '시간을 넣으면 저절로 꺼집니다' : '누르면 시간을 지우고 하루 종일로'}
            onClick={toggleAllDay}
          >
            <i />
          </button>
        </div>
        <div className="sched-row">
          <span className="sched-k">시작</span>
          <input
            key={'s' + bump}
            type="date"
            className="sched-input"
            value={start}
            onChange={(e) => onStart(e.target.value)}
          />
          <input
            ref={timeRef}
            type="time"
            className="sched-input sched-time"
            value={memo.time || ''}
            onChange={(e) => onTime('time', e.target.value)}
          />
          {ddText && <b className={'meta-dday' + (dd < 0 ? ' t-red' : '')}>{ddText}</b>}
        </div>
        <div className="sched-row">
          <span className="sched-k">종료</span>
          <input
            key={'e' + bump}
            type="date"
            className="sched-input"
            value={end}
            min={start}
            disabled={repeating}
            title={repeating ? '반복 일정은 하루짜리입니다' : ''}
            onChange={(e) => onEnd(e.target.value)}
          />
          <input
            type="time"
            className="sched-input sched-time"
            value={memo.endTime || ''}
            onChange={(e) => onTime('endTime', e.target.value)}
          />
        </div>
        <div className="sched-row">
          <span className="sched-k">반복</span>
          <select className="sched-select" value={kind} onChange={(e) => onRepeat(e.target.value)}>
            {REPEAT_OPTIONS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
            {kind === 'custom' && <option value="custom">정해둔 달</option>}
          </select>
          {kind === 'monthly' && rtLive && (
            <select
              className="sched-select"
              value={Number(rt.dueShift) || 0}
              title="그 달분을 언제 처리하나 — 8월분 고지서가 9월에 나오면 다음 달"
              onChange={(e) => updateRoutine(rt.id, { dueShift: Number(e.target.value) })}
            >
              <option value={0}>그 달</option>
              <option value={1}>다음 달</option>
            </select>
          )}
          {msg && <span className="sched-err">{msg}</span>}
        </div>
        {(rtLive || kind === 'weekly') && (
          <div className="sched-row">
            <span className="sched-k">반복 종료</span>
            {rtLive ? (
              <>
                <select
                  className="sched-select"
                  value={rt.endYm ? 'date' : ''}
                  onChange={(e) =>
                    updateRoutine(rt.id, {
                      endYm: e.target.value ? shiftYm(memo.ym || start.slice(0, 7), 12) : null,
                    })
                  }
                >
                  <option value="">없음</option>
                  <option value="date">날짜 지정</option>
                </select>
                {rt.endYm && (
                  <>
                    <input
                      type="month"
                      className="sched-input"
                      value={shiftYm(rt.endYm, -1)}
                      min={memo.ym || undefined}
                      onChange={(e) =>
                        e.target.value &&
                        (!memo.ym || e.target.value >= memo.ym) &&
                        updateRoutine(rt.id, { endYm: shiftYm(e.target.value, 1) })
                      }
                    />
                    <span className="sched-muted">까지</span>
                  </>
                )}
              </>
            ) : (
              <>
                <select
                  className="sched-select"
                  value={memo.repeatUntil ? 'date' : ''}
                  onChange={(e) => updateMemo(memo.id, { repeatUntil: e.target.value ? addDays(start, 91) : null })}
                >
                  <option value="">없음</option>
                  <option value="date">날짜 지정</option>
                </select>
                {memo.repeatUntil && (
                  <>
                    <input
                      type="date"
                      className="sched-input"
                      value={memo.repeatUntil}
                      min={start}
                      onChange={(e) => e.target.value && updateMemo(memo.id, { repeatUntil: e.target.value })}
                    />
                    <span className="sched-muted">까지</span>
                  </>
                )}
              </>
            )}
          </div>
        )}
        <div className="sched-row">
          <span className="sched-k">미리 알림</span>
          <AlarmField alarm={alarm} onChange={onAlarm} />
        </div>
        {aStart && memo.status !== 'done' && (
          <div className="sched-row">
            <span className="sched-k" />
            <label className="sched-check">
              <input
                type="checkbox"
                checked={!!memo.alarmCheckedAt}
                onChange={() => (memo.alarmCheckedAt ? uncheckAlarm(memo.id) : checkAlarm(memo.id))}
              />
              <span className={memo.alarmCheckedAt ? 'sched-done' : ''}>{alarm.text}</span>
              <span className="sched-muted">
                {memo.alarmCheckedAt
                  ? `${md(memo.alarmCheckedAt)} 체크 — 진행 기록에 남음`
                  : `${md(aStart)}부터${alarm.daily ? ' 매일' : ''} 달력에 표시`}
              </span>
            </label>
          </div>
        )}
      </div>
      <div className="sched-sum">{summary.join(' · ')}</div>
    </>
  )
}
