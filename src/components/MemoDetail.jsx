import { useEffect, useRef, useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, fmtPeriod, diffDays } from '../derive'
import { todayStr, addDays } from '../parser'
import Timeline from './Timeline'
import SendToDateBtn from './SendToDateBtn'
import FileSection from './FileSection'
import { attachFile, detachFile } from '../store'
import { ICONS } from '../icons'
import useIsNarrow from '../useIsNarrow'

// 액션 아이콘 기본 순서 — 세로 구분선(div)도 한 자리를 차지해 같이 끌 수 있다
const PA_DEFAULT = ['done', 'postpone', 'date', 'div', 'flag', 'hold', 'keep', 'edit', 'del']

const REPEAT_LABEL = { weekly: '매주', monthly: '매달', yearly: '매년' }

export default function MemoDetail({ memo, works = [], onOpen, onClose, inline, closing }) {
  const linkedWork = memo.fromWork ? works.find((w) => w.id === memo.fromWork) : null
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  // 액션 아이콘 순서 — 드래그로 바꿀 수 있고 이 기기(localStorage)에 저장된다 (2026-07-31 사용자 요청)
  const [paOrder, setPaOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pa-order'))
      if (Array.isArray(saved)) return [...saved, ...PA_DEFAULT.filter((k) => !saved.includes(k))]
    } catch (e) {
      console.error('아이콘 순서 읽기 실패', e)
    }
    return PA_DEFAULT
  })
  const [paDrop, setPaDrop] = useState(null)

  function movePa(src, target, after) {
    setPaOrder((cur) => {
      const next = cur.filter((k) => k !== src)
      let pos = next.indexOf(target)
      if (pos === -1) pos = next.length
      else if (after) pos += 1
      next.splice(pos, 0, src)
      localStorage.setItem('pa-order', JSON.stringify(next))
      return next
    })
  }

  // 각 아이콘에 붙는 드래그 핸들러 묶음 — 아이콘을 끌어 다른 아이콘 위에 놓으면 순서가 바뀐다
  const paDrag = (key) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/plain', 'pa:' + key)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e) => {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      setPaDrop({ key, after: e.clientX > r.left + r.width / 2 })
    },
    onDragLeave: () => setPaDrop((c) => (c && c.key === key ? null : c)),
    onDrop: (e) => {
      e.preventDefault()
      const data = e.dataTransfer.getData('text/plain')
      const cur = paDrop
      setPaDrop(null)
      if (!data.startsWith('pa:')) return
      const src = data.slice(3)
      if (src !== key) movePa(src, key, cur ? cur.after : false)
    },
  })
  const paCls = (key, base) =>
    base + (paDrop && paDrop.key === key ? (paDrop.after ? ' pa-drop-r' : ' pa-drop-l') : '')
  // 작업 설명 — 진행기록(시간순 줄)과 달리 "이 일이 뭔지"를 적어두는 고정 칸.
  // 저장 버튼 없이 자동 저장한다: 타이핑이 멎으면 0.7초 뒤, 포커스가 빠질 때, 패널이 닫힐 때.
  const [desc, setDesc] = useState(memo.desc || '')
  const latestRef = useRef(memo.desc || '')
  const savedRef = useRef(memo.desc || '')
  const timerRef = useRef(null)
  // 제목 — 상세 맨 위에서 바로 쓴다(+ 로 만든 새 메모는 빈 제목으로 열려 자동 포커스). 자동 저장.
  const [title, setTitle] = useState(memo.title || '')
  const titleLatest = useRef(memo.title || '')
  const titleSaved = useRef(memo.title || '')
  // 되돌리기 기준값 — 칸에 커서를 놓은 순간의 내용. 자동 저장이라 잘못 고치면 되살릴 길이
  // 없어서, Esc 한 번이면 이 값으로 되돌린다(이미 자동 저장됐어도 되돌린 값으로 다시 저장).
  // (2026-08-05 사용자 요청)
  const descBase = useRef(memo.desc || '')
  const titleBase = useRef(memo.title || '')
  // 제목이 확정되는 순간의 연출 — 'reg'(빈 초안에 이름이 붙는 "등록")는 크게,
  // 'edit'(이미 있던 제목 고치기)은 아주 약하게. 매번 요란하면 금방 질린다. (2026-08-06)
  const [flash, setFlash] = useState(null)
  const flashTimer = useRef(null)
  const alive = useRef(true)
  const histRef = useRef(null)

  function flashSaved(kind) {
    if (!alive.current) return
    clearTimeout(flashTimer.current)
    // 클래스를 뺐다 다시 붙여야 연달아 눌러도 애니메이션이 새로 돈다
    setFlash(null)
    requestAnimationFrame(() => {
      if (!alive.current) return
      setFlash(kind)
      flashTimer.current = setTimeout(() => {
        if (alive.current) setFlash(null)
      }, kind === 'reg' ? 1000 : 450)
    })
  }
  const st = memoStatus(memo)
  const today = todayStr()
  // 상태 UI 기준은 "인라인이냐"가 아니라 "폰이냐" (2026-07-31) — 달력 우측 상세는 인라인이지만
  // PC라면 보드 패널과 똑같이 상태 드롭다운 + 완료 아이콘을 쓴다. 폰만 상태 버튼 줄.
  const narrow = useIsNarrow()

  function fitTA(el) {
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

  // 저장했으면 true(그중 "등록"이면 'reg')를 돌려준다 — 부른 쪽이 뒷처리를 정하게.
  function saveTitle() {
    const v = titleLatest.current.trim()
    if (v === titleSaved.current) return null
    // 빈 초안(+ 로 만들어 이름이 없던 것)에 이름이 붙는 순간이 이 앱의 "등록"이다.
    // 메모 자체는 + 를 누를 때 이미 만들어져 있어서, 이 순간 말고는 등록이랄 사건이 없다.
    const kind = !titleSaved.current && v ? 'reg' : 'edit'
    titleSaved.current = v
    updateMemo(memo.id, { title: v })
    flashSaved(kind)
    // 달력이 듣고 그 항목을 한 번 번쩍여 준다 — "내가 쓴 게 저기 가서 붙었구나"
    if (kind === 'reg') window.dispatchEvent(new CustomEvent('memo-registered', { detail: memo.id }))
    return kind
  }

  // Esc 되돌리기 공용 — 커서를 놓은 때의 내용으로 돌린다. 되돌릴 게 없으면 칸에서 빠져나간다
  // (그 다음 Esc는 원래대로 패널 닫기). 되돌린 값이 이미 저장돼 있으면 그 값으로 다시 저장.
  function revertOnEsc(e, field, { base, latest, saved, set, timer }) {
    e.preventDefault()
    const el = e.currentTarget
    if (timer) clearTimeout(timer.current)
    if (latest.current === base.current) {
      el.blur()
      return
    }
    const v = base.current
    set(v)
    latest.current = v
    if (v.trim() !== saved.current) {
      saved.current = v.trim()
      updateMemo(memo.id, { [field]: v.trim() })
    }
    requestAnimationFrame(() => fitTA(el))
  }

  // 패널을 닫거나 다른 메모로 옮겨가도 적던 내용이 날아가지 않게.
  // (여기서 등록이 일어나면 패널은 사라지지만 달력 번쩍임은 그대로 뜬다 — 그게 맞다)
  useEffect(() => () => { saveTitle(); saveDesc(); alive.current = false; clearTimeout(flashTimer.current) }, [])

  function startEdit() {
    setForm({
      title: memo.title,
      due: memo.due || '',
      start: memo.period?.start || '',
      end: memo.period?.end || '',
      repeat: memo.repeat || '',
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
      repeat: period ? null : form.repeat || null, // 반복은 예정일 메모 전용
      // 보류 메모에 날짜를 달면 보류가 풀린다 — 날짜가 생겼는데 화면에 안 보이면 이상하니까
      ...(memo.hold && (period || form.due) ? { hold: false } : {}),
    })
    setEditing(false)
  }

  const dday = memo.period?.end && memo.status !== 'done' ? diffDays(memo.period.end, today) : null
  const dueD = memo.due && memo.status !== 'done' ? diffDays(memo.due, today) : null

  // 미루기: 기한은 그 날짜로 이동, 기간(만기) 메모는 만기일 안 건드리고 그날까지 숨김.
  // 단 마감·만기가 이미 오늘이거나 지났으면 숨길 창(내일~마감)이 비어서 날짜 지정이
  // 아무 날도 못 고르는 먹통이 된다 — 이때는 끝 날짜 자체를 옮긴다 (2026-07-31 버그 수정)
  const tomorrow = addDays(today, 1)
  const endPassed = !memo.due && !!memo.period && memo.period.end <= today
  function postpone(d) {
    if (!memo.due && memo.period) {
      if (endPassed) {
        const start = memo.period.start <= d ? memo.period.start : d
        updateMemo(memo.id, { period: { start, end: d } })
      } else updateMemo(memo.id, { snoozeUntil: d })
    } else updateMemo(memo.id, { due: d })
  }

  return (
    <>
    {/* 분할선에 걸친 접기 손잡이 — 누르면 패널이 오른쪽으로 접히고 목록으로 돌아간다.
        ×·빈 곳 누르기와 같은 동작이지만 "왼쪽(목록)으로 돌아간다"가 눈에 보인다 (2026-08-04) */}
    {!inline && !narrow && (
      <button
        className={'panel-fold' + (closing ? ' pf-out' : '')}
        data-tip="접기 — 목록으로"
        aria-label="접기"
        onClick={onClose}
      >
        {ICONS.chevronR}
      </button>
    )}
    <aside
      className={'detail' + (inline ? ' detail-inline' : '') + (closing ? ' detail-out' : '')}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="panel-head">
          {/* PC: 상태를 드롭다운 칩으로 바로 변경 — 드래그 없이도 클릭 한 번 (2026-07-30 시안 채택).
              보관·보류는 상태 개념 밖이라 배지 유지. 폰은 아래 상태 버튼 줄 그대로. */}
          {!narrow && !memo.keep && !memo.hold ? (
            <select
              className="stage-select"
              value={st}
              onChange={(e) => {
                const next = e.target.value
                if (next === st) return
                if (next === 'done') return completeMemo(memo.id)
                if (memo.status === 'done') reopenMemo(memo.id)
                updateMemo(memo.id, { stage: next })
              }}
            >
              <option value="todo">할일</option>
              <option value="active">진행중</option>
              <option value="done">완료</option>
            </select>
          ) : (
            <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>
          )}
          <textarea
            className={'panel-title-input' + (flash ? ' pti-' + flash : '')}
            value={title}
            rows={1}
            ref={fitTA}
            autoFocus={!memo.title}
            placeholder="제목을 입력하세요"
            onChange={(e) => {
              setTitle(e.target.value)
              titleLatest.current = e.target.value
              fitTA(e.target)
            }}
            onFocus={() => { titleBase.current = titleLatest.current }}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // 한글 조합 중 Enter는 글자를 맺는 것 — 아래 진행사항 칸과 같은 규칙 (2026-08-06)
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                const kind = saveTitle()
                e.target.blur()
                // 등록됐으면 "제목 정했으니 이제 내용" 으로 커서를 넘겨준다.
                // 다른 데를 눌러서 저장된 경우(onBlur)엔 그쪽을 누른 거라 뺏지 않는다.
                if (kind === 'reg') requestAnimationFrame(() => histRef.current && histRef.current.focus())
              }
              if (e.key === 'Escape')
                revertOnEsc(e, 'title', {
                  base: titleBase,
                  latest: titleLatest,
                  saved: titleSaved,
                  set: setTitle,
                })
            }}
          />
          {/* 접기는 폰의 아코디언 상세에서만 — PC는 어디서 열리든 × 로 통일 (2026-07-31) */}
          {inline && narrow ? (
            <button className="fold-btn" onClick={onClose}>접기</button>
          ) : (
            <button className="x" onClick={onClose} aria-label="닫기" title="닫기">×</button>
          )}
        </div>
        {/* 등록되는 순간 예정·D-day 줄이 살짝 떠오르며 자리를 잡는다 — "이 일이 8/12에 걸렸다" */}
        <div className={'panel-meta' + (flash === 'reg' ? ' meta-settle' : '')}>
          {memo.period && (
            <span className="meta-date">
              {memo.deadline ? `마감 ${fmtDate(memo.period.end)}` : `기간 ${fmtPeriod(memo.period)}`}
              {dday !== null && (
                <b className={dday < 0 ? 't-red' : 't-blue'}>
                  {' · '}
                  {dday < 0 ? `마감 ${-dday}일 지남` : `마감 D-${dday}`}
                </b>
              )}
            </span>
          )}
          {memo.due && !memo.period && (
            <div className="meta-block">
              <div className="panel-sec-label">예정</div>
              <span className="meta-row">
                {/* 날짜를 바로 고른다 — 새 메모는 기본이 오늘이라 안 건드리고 넘어가도 된다 */}
                <input
                  type="date"
                  className="meta-date-input"
                  value={memo.due}
                  onChange={(e) => e.target.value && updateMemo(memo.id, { due: e.target.value })}
                />
                {dueD !== null && (
                  <b className={'meta-dday' + (dueD < 0 ? ' t-red' : '')}>
                    {dueD < 0 ? `${-dueD}일 지남` : dueD === 0 ? '오늘' : `D-${dueD}`}
                  </b>
                )}
                {/* 기간 설정이 정보 수정 폼 안에만 있어 못 찾는 문제 — 바로가기 (2026-07-31) */}
                {memo.status !== 'done' && !memo.keep && !memo.hold && (
                  <button
                    className="linkish"
                    title="시작~끝이 있는 기간 일정으로 바꿉니다 — 달력에 이어진 띠로 표시"
                    onClick={startEdit}
                  >
                    기간으로
                  </button>
                )}
                {memo.repeat && (
                  <span className="meta-repeat" title="완료하면 예정일이 다음 주기로 굴러갑니다">
                    ↻ {REPEAT_LABEL[memo.repeat] || memo.repeat}
                  </span>
                )}
              </span>
            </div>
          )}
          {memo.hold && (
            <span className="meta-date">
              보류 {fmtDate(memo.holdAt || (memo.updatedAt || '').slice(0, 10))}
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
        {/* 폰: 드래그가 없으니 여기서 보드 열을 옮긴다 (PC는 상태 드롭다운 — 버튼 안 보임) */}
        {narrow && !memo.keep && !memo.hold && (
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
        {/* 액션 줄 — 전부 아이콘 + 마우스 설명 (2026-07-31 확정). 아이콘은 드래그로 순서를
            바꿀 수 있다(세로 구분선 포함, 기기별 저장). 보류·보관·삭제 아이콘은 사이드바의
            보류함·보관함·휴지통과 같은 그림 — 누르면 어디로 가는지 그림이 말해준다.
            보관·보류 메모의 꺼내기만 글자 버튼 유지. */}
        <div className="panel-actions">
          {memo.status !== 'done' && memo.keep && (
            <button
              className="btn-done"
              title="보관에서 꺼내 오늘 할 일로 보냅니다"
              onClick={() => updateMemo(memo.id, { keep: false, due: todayStr() })}
            >
              오늘 할 일로 꺼내기
            </button>
          )}
          {memo.status !== 'done' && memo.hold && (
            <>
              <button
                className="btn-done"
                title="보류를 풀고 오늘 할 일로 보냅니다"
                onClick={() => updateMemo(memo.id, { hold: false, due: todayStr() })}
              >
                오늘 할 일로 꺼내기
              </button>
              <SendToDateBtn
                label="날짜 지정"
                min={todayStr()}
                onPick={(d) => updateMemo(memo.id, { hold: false, due: d })}
              />
            </>
          )}
          {paOrder.map((k) => {
            if (k === 'done') {
              if (narrow || memo.keep || memo.hold) return null
              return memo.status !== 'done' ? (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic pa-done')}
                  data-tip={memo.repeat && memo.due ? `이번 회차 완료 — 다음 ${REPEAT_LABEL[memo.repeat] || ''} 예정으로` : '완료 처리'}
                  {...paDrag(k)}
                  onClick={() => completeMemo(memo.id)}
                >
                  {ICONS.check}
                  <span className="pa-tx">완료</span>
                </button>
              ) : (
                <button key={k} className={paCls(k, 'pa-ic')} data-tip="다시 열기" {...paDrag(k)} onClick={() => reopenMemo(memo.id)}>
                  {ICONS.undo}
                  <span className="pa-tx">다시 열기</span>
                </button>
              )
            }
            const dated = memo.status !== 'done' && !memo.keep && !memo.hold && (memo.due || memo.period)
            if (k === 'postpone') {
              if (!dated) return null
              return (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic')}
                  data-tip={
                    memo.due && memo.due > today
                      ? '하루 미루기 — 하루 뒤로'
                      : endPassed
                        ? '하루 미루기 — 마감일을 내일로'
                        : '하루 미루기 — 내일로'
                  }
                  {...paDrag(k)}
                  onClick={() => postpone(memo.due && memo.due > today ? addDays(memo.due, 1) : tomorrow)}
                >
                  {ICONS.next}
                  <span className="pa-tx">미루기</span>
                </button>
              )
            }
            if (k === 'date') {
              if (!dated) return null
              return (
                <span key={k} className={paCls(k, 'pa-tipwrap')} data-tip="날짜 지정 — 고른 날짜로" {...paDrag(k)}>
                  <SendToDateBtn
                    className="pa-ic"
                    label={<>{ICONS.calendar}<span className="pa-tx">날짜</span></>}
                    min={memo.due && memo.due < today ? today : tomorrow}
                    max={!memo.due && memo.period && !endPassed ? memo.period.end : undefined}
                    onPick={postpone}
                  />
                </span>
              )
            }
            if (k === 'div') return <span key={k} className={paCls(k, 'pa-div')} {...paDrag(k)} />
            const openPlain = memo.status !== 'done' && !memo.keep && !memo.hold
            if (k === 'flag') {
              if (openPlain && memo.due && !memo.period)
                return (
                  <button
                    key={k}
                    className={paCls(k, 'pa-ic')}
                    data-tip="마감으로 지정 — 그날까지 끝낼 일로"
                    {...paDrag(k)}
                    onClick={() =>
                      updateMemo(memo.id, {
                        due: null,
                        period: { start: today < memo.due ? today : memo.due, end: memo.due },
                        deadline: true,
                      })
                    }
                  >
                    {ICONS.flag}
                    <span className="pa-tx">마감</span>
                  </button>
                )
              if (openPlain && memo.deadline && memo.period)
                return (
                  <button
                    key={k}
                    className={paCls(k, 'pa-ic')}
                    data-tip="마감 해제 — 날짜만 잡힌 예정으로"
                    {...paDrag(k)}
                    onClick={() => updateMemo(memo.id, { due: memo.period.end, period: null, deadline: false })}
                  >
                    {ICONS.flagOff}
                    <span className="pa-tx">마감 해제</span>
                  </button>
                )
              return null
            }
            if (k === 'hold') {
              if (!openPlain || !(memo.due || memo.period)) return null
              return (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic')}
                  data-tip="보류 — 날짜를 떼고 보류함으로"
                  {...paDrag(k)}
                  onClick={() =>
                    updateMemo(memo.id, {
                      hold: true,
                      holdAt: today,
                      due: null,
                      period: null,
                      deadline: false,
                      snoozeUntil: null,
                    })
                  }
                >
                  {ICONS.hold}
                  <span className="pa-tx">보류</span>
                </button>
              )
            }
            if (k === 'keep') {
              if (!openPlain) return null
              return (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic')}
                  data-tip="보관 — 자료로 보관함에"
                  {...paDrag(k)}
                  onClick={() =>
                    updateMemo(memo.id, {
                      keep: true,
                      due: null,
                      period: null,
                      deadline: false,
                      snoozeUntil: null,
                    })
                  }
                >
                  {ICONS.keep}
                  <span className="pa-tx">보관</span>
                </button>
              )
            }
            if (k === 'edit') {
              return (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic' + (editing ? ' on' : ''))}
                  data-tip={editing ? '수정 취소' : '정보 수정 — 제목·예정일·기간'}
                  {...paDrag(k)}
                  onClick={editing ? () => setEditing(false) : startEdit}
                >
                  {ICONS.memo}
                  <span className="pa-tx">{editing ? '취소' : '수정'}</span>
                </button>
              )
            }
            if (k === 'del') {
              return (
                <button
                  key={k}
                  className={paCls(k, 'pa-ic pa-danger')}
                  data-tip="삭제 — 휴지통으로 (30일 보관)"
                  {...paDrag(k)}
                  onClick={() => {
                    if (window.confirm('휴지통으로 옮길까요? 30일 안에는 휴지통에서 복구할 수 있습니다.')) {
                      deleteMemo(memo.id)
                      onClose()
                    }
                  }}
                >
                  {ICONS.trash}
                  <span className="pa-tx">삭제</span>
                </button>
              )
            }
            return null
          })}
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
            <label>
              반복
              <span className="eg-range">
                <select
                  className="edit-select"
                  value={form.repeat || ''}
                  onChange={(e) => setForm({ ...form, repeat: e.target.value })}
                >
                  <option value="">없음</option>
                  <option value="weekly">매주</option>
                  <option value="monthly">매달</option>
                  <option value="yearly">매년</option>
                </select>
                <span className="edit-hint">완료하면 예정일이 다음 주기로 굴러갑니다 (공과금·정기점검용)</span>
              </span>
            </label>
            <button className="btn-done" onClick={saveEdit}>저장</button>
          </div>
        )}
        <div className="panel-desc">
          <div className="panel-sec-label">작업 설명</div>
          <textarea
            ref={fitTA}
            className="desc-input"
            value={desc}
            placeholder="이 일이 무엇인지 적어두는 칸 — 배경·목적·담당·참고할 내용 (Esc: 고치기 전으로)"
            onChange={(e) => {
              onDescChange(e.target.value)
              fitTA(e.target)
            }}
            onFocus={() => { descBase.current = latestRef.current }}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Escape')
                revertOnEsc(e, 'desc', {
                  base: descBase,
                  latest: latestRef,
                  saved: savedRef,
                  set: setDesc,
                  timer: timerRef,
                })
            }}
          />
        </div>
        <Timeline
          history={memo.history}
          onAdd={(t, d) => addHistory(memo.id, t, d)}
          onToggle={(i) => toggleHistory(memo.id, i)}
          onUpdate={(i, p) => updateHistory(memo.id, i, p)}
          onRemove={(i) => removeHistory(memo.id, i)}
          inputRef={histRef}
        />
        {/* 파일 — 계약서·견적서·캡처 등. 2026-07-15 제거했다가 2026-07-31 부활
            (캡처 붙여넣기·썸네일 미리보기·다운로드 추가) */}
        <FileSection
          files={memo.files || []}
          onAttach={(f) => attachFile(memo.id, f)}
          onRemove={(p) => detachFile(memo.id, p)}
        />
    </aside>
    </>
  )
}
