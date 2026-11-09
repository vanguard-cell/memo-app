import { useEffect, useState } from 'react'
import {
  updateMemo, updateRoutine, stopRoutine, makeRoutineFromMemo, routineOf, shiftYm,
  checkAlarm, uncheckAlarm, blankTitle,
} from '../store'
import { diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import { ICONS } from '../icons'
import {
  REPEAT_OPTIONS, ROUTINE_KINDS, routineKind, monthsFor,
  ALARM_PRESETS, ALARM_UNITS, alarmMode, alarmLabel, alarmStart, timeText,
} from '../schedule'

// 상세 패널의 "일정" 칸 — 시작 / 종료 / 반복·미리 알림 (2026-09-15 아이폰 달력식, 2026-11-09 정리:
// 하루 종일 스위치와 아래 요약 줄은 없앴다 — 시간 칸이 비어 있으면 그게 하루 종일이다).
// 예전의 "기간으로"·"루틴으로" 링크, 정보 수정 폼, 마감 버튼을 이 한 묶음이 대신한다.
// 저장 모양은 그대로다: 시작=종료면 due(하루짜리), 다르면 period. 시간은 time·endTime.

const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const DOW = ['일', '월', '화', '수', '목', '금', '토']
// 요약 줄의 날짜 — "11월 6일 (금)", 올해가 아니면 앞에 연도
const longDate = (d, today) =>
  `${d.slice(0, 4) !== today.slice(0, 4) ? `${d.slice(0, 4)}년 ` : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${DOW[new Date(d + 'T00:00').getDay()]})`

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

// 시간 칸 (2026-11-09, 사용자: "-- --:-- 로 보여서 시간 입력하는 곳인가 싶다").
// 비어 있으면 브라우저의 "-- --:--" 대신 흐린 "+ 시간"을 얹어 보여준다 — 칸 자체는 그대로라
// 누르면 폰은 시간 고르기 창, PC는 칸에 커서가 간다(그때는 원래 글자가 보인다).
// 정한 시간은 옆 × 로 지운다(하루 종일 스위치가 하던 일).
function TimeField({ value, onChange, onClear, label }) {
  return (
    <span className={'sched-timewrap' + (value ? '' : ' no-time')}>
      <input
        type="time"
        className="sched-input sched-time"
        aria-label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {!value && (
        <span className="sched-time-ph" aria-hidden="true">
          + 시간
        </span>
      )}
      {value && (
        <button type="button" className="sched-time-x" title="시간 지우기" aria-label={label + ' 지우기'} onClick={onClear}>
          ×
        </button>
      )}
    </span>
  )
}

export function ScheduleBlock({ memo }) {
  const today = todayStr()
  const rt = memo.routineId ? routineOf(memo.routineId) : null
  const nextYm = memo.ym ? shiftYm(memo.ym, 1) : null
  // 루틴이 이 회차 뒤로도 이어지나 — 이 회차에서 끊었으면(endYm = 다음 달) 반복 "안 함"으로 보인다
  const rtLive = !!rt && (!rt.endYm || (!!nextYm && rt.endYm > nextYm))
  const kind = rtLive
    ? routineKind(rt)
    : ['weekly', 'monthly', 'yearly'].includes(memo.repeat)
      ? memo.repeat
      : 'none'
  const start = memo.due || (memo.period && memo.period.start) || today
  const end = memo.due || (memo.period && memo.period.end) || start
  const repeating = kind !== 'none'
  const alarm = rt ? rt.alarm || null : memo.alarm || null
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

  // 시간 칸 — 비우면 하루 종일 (시간 유무로 판단)
  function onTime(field, v) {
    updateMemo(memo.id, { [field]: v || null })
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
      updateRoutine(rt.id, { months, everyYears: null, ...(rtLive ? {} : { endYm: null }) })
      return
    }
    makeRoutineFromMemo(memo.id, { months })
  }

  const onAlarm = (a) => (rt ? updateRoutine(rt.id, { alarm: a }) : updateMemo(memo.id, { alarm: a }))

  const aStart = alarm && alarm.text ? alarmStart(start, alarm) : null

  // 평소엔 한 줄 요약만, 누르면 칸들이 펼쳐진다 (2026-11-09, 사용자: "입력칸이 부담돼 보인다,
  // 시작/종료/반복은 필요할 때만 설정하는 거잖아"). 메모를 열 때마다 접힌 채로 시작한다.
  const [open, setOpen] = useState(false)
  const day = Number(start.slice(8, 10))
  const repeatText = {
    weekly: `매주 ${DOW[new Date(start + 'T00:00').getDay()]}요일`,
    monthly: `매월 ${rt && Number(rt.dueShift) === 1 ? '다음 달 ' : ''}${rt ? Number(rt.dueDay) || day : day}일`,
    quarter: '분기마다',
    half: '반기마다',
    yearly: `매년 ${Number(start.slice(5, 7))}월 ${day}일`,
    years: `${rt ? rt.everyYears : ''}년마다 ${Number(start.slice(5, 7))}월 ${day}일`,
    custom: '정해둔 달마다',
  }[kind]
  const when = start === end ? longDate(start, today) : `${longDate(start, today)} ~ ${longDate(end, today)}`
  const extras = [
    timeText(memo),
    repeatText,
    alarm ? `미리 알림 ${alarmLabel(alarm)}${alarm.daily ? ' 매일' : ''}` : '',
  ].filter(Boolean)

  return (
    <div className={'sched' + (open ? ' open' : '')}>
      <button
        type="button"
        className="sched-sum-btn"
        aria-expanded={open}
        title={open ? '접기' : '날짜·시간·반복·미리 알림 바꾸기'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sched-sum-t">
          <span className="sched-sum-when">{when}</span>
          {extras.length > 0 && <span className="sched-sum-more">{extras.join(' · ')}</span>}
        </span>
        <span className="sched-chev">{ICONS.chevronR}</span>
      </button>
      {open && (
        <>
          <div className="sched-row">
            <span className="sched-k">시작</span>
            <input
              key={'s' + bump}
              type="date"
              className="sched-input"
              value={start}
              onChange={(e) => onStart(e.target.value)}
            />
            <TimeField
              label="시작 시간"
              value={memo.time}
              onChange={(v) => onTime('time', v)}
              onClear={() => updateMemo(memo.id, { time: null, endTime: null })}
            />
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
            {/* 종료 시간은 시작 시간을 정했을 때만 — 빈 칸 두 개가 나란히 있으면 더 헷갈린다 */}
            {(memo.time || memo.endTime) && (
              <TimeField
                label="종료 시간"
                value={memo.endTime}
                onChange={(v) => onTime('endTime', v)}
                onClear={() => updateMemo(memo.id, { endTime: null })}
              />
            )}
          </div>
          {/* 반복 · 미리 알림은 한 줄에 나란히 (2026-11-09). 고르면 나오는 칸(그 달/다음 달, 알림 내용)은
              이 줄 안에서 다음 줄로 내려간다. 폰처럼 좁으면 미리 알림이 저절로 둘째 줄로 */}
          <div className="sched-row sched-pair">
            <span className="sched-k">반복</span>
            <select className="sched-select" value={kind} onChange={(e) => onRepeat(e.target.value)}>
              {REPEAT_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
              {kind === 'custom' && <option value="custom">정해둔 달</option>}
              {kind === 'years' && <option value="years">{rt.everyYears}년마다</option>}
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
            <span className="sched-k sched-k2">미리 알림</span>
            <AlarmField alarm={alarm} onChange={onAlarm} />
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
        </>
      )}
    </div>
  )
}
