import { useEffect, useRef, useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo, confirmDate, routineOf, cycleDue, ymDiff, adoptCycleDay } from '../store'
import { memoStatus, STATUS_LABEL, fmtDate, dueBadge } from '../derive'
import { todayStr, addDays } from '../parser'
import Timeline from './Timeline'
import { useTagSuggest, TagList } from './TagSuggest'
import { ScheduleBlock } from './ScheduleFields'
import { splitTime } from '../schedule'
import SendToDateBtn from './SendToDateBtn'
import FileSection from './FileSection'
import { attachFile, detachFile, setArea, areaOf } from '../store'
import { AREAS } from '../areas'
import { ICONS } from '../icons'
import useIsNarrow from '../useIsNarrow'

// 상세 버튼 줄은 고정 순서: 완료 · 미루기 | 보관 · 삭제 (2026-11-09 정리 — 날짜 지정 버튼과
// 아이콘 끌어서 순서 바꾸기는 없앴다. 날짜는 위 일정 칸에서 바로 고친다)

const REPEAT_LABEL = { weekly: '매주', monthly: '매달', yearly: '매년' }

export default function MemoDetail({ memo, works = [], onOpen, onClose, inline, closing }) {
  const linkedWork = memo.fromWork ? works.find((w) => w.id === memo.fromWork) : null
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
  const titleEl = useRef(null)
  // 제목 칸의 말머리 고르기 — "["를 치면 지금까지 쓴 말머리가 그 자리에 뜬다 (2026-10-07)
  const tag = useTagSuggest((next) => {
    setTitle(next)
    titleLatest.current = next
    fitTA(titleEl.current)
  }, titleEl)

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
  const ddBadge = dueBadge(memo, today)
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
    let v = titleLatest.current.trim()
    if (v === titleSaved.current) return null
    // 제목 앞에 시각을 적으면("11:00 주간보고") 시간 칸으로 옮기고 제목에선 뗀다 (2026-10-29).
    // 루틴 회차는 빼둔다 — 회차 제목은 규칙 이름에서 나온다 (store migrate와 같은 규칙)
    const t = memo.routineId ? null : splitTime(v)
    if (t) {
      v = t.title
      titleLatest.current = v
      setTitle(v)
    }
    // 빈 초안(+ 로 만들어 이름이 없던 것)에 이름이 붙는 순간이 이 앱의 "등록"이다.
    // 메모 자체는 + 를 누를 때 이미 만들어져 있어서, 이 순간 말고는 등록이랄 사건이 없다.
    const kind = !titleSaved.current && v ? 'reg' : 'edit'
    titleSaved.current = v
    updateMemo(
      memo.id,
      t
        ? {
            title: v,
            time: t.time,
            // 끝 시각을 안 적었으면 원래 끝 시각을 두되, 새 시작보다 이르면 지운다
            endTime: t.endTime || (memo.endTime && memo.endTime > t.time ? memo.endTime : null),
          }
        : { title: v }
    )
    flashSaved(kind)
    // 달력이 듣고, 제목 칸에서 그 날짜 칸으로 칩을 날려 보낸 뒤 한 번 번쩍여 준다.
    // 제목 칸의 위치를 같이 실어 보낸다 — 어디서 출발할지는 여기만 안다.
    if (kind === 'reg') {
      const r = titleEl.current && titleEl.current.getBoundingClientRect()
      window.dispatchEvent(
        new CustomEvent('memo-registered', {
          detail: { id: memo.id, from: r && { x: r.left, y: r.top } },
        })
      )
    }
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

  // 루틴 회차를 실제로 한 날로 옮겼을 때 — 규칙(예정일)까지 바꿀지 그 자리에서 묻는다.
  // 휴일·출장으로 한 달만 밀린 것은 안 누르면 그만이고, 눌러야 다음 달부터 그 날로 온다.
  // (2026-08-20 사용자: "다음달에도 18일로 반영이 되는지?")
  // "루틴으로" 버튼은 2026-09-15 없앴다 — 일정 칸의 [반복]에서 매월·분기·반기·매년을 고른다.
  const rt = memo.routineId ? routineOf(memo.routineId) : null
  const askDay =
    rt && !memo.dayKept && memo.due && memo.ym && memo.due !== cycleDue(rt, memo.ym)
      ? Number(memo.due.slice(8, 10))
      : null
  // 옮겨둔 날이 그 달분의 달을 넘었는가 — "8월분을 9월 3일" 같은 익월 처리 (2026-09-07)
  const askShift = askDay ? Math.max(0, ymDiff(memo.ym, memo.due.slice(0, 7))) : 0
  const ruleNow = rt ? `${(Number(rt.dueShift) || 0) ? '다음 달 ' : ''}${Number(rt.dueDay) || 5}일` : ''
  const ruleNew = `${askShift === 1 ? '다음 달 ' : askShift > 1 ? `${askShift}달 뒤 ` : ''}${askDay}일`

  // 미루기: 하루짜리는 그 날짜로, 끝 날짜가 오늘이거나 지난 기간은 끝 날짜를 옮긴다.
  // 아직 안 끝난 기간에는 버튼이 안 나온다 — 예전엔 "그날까지 숨김"(snoozeUntil)을 적었는데 그 값을
  // 읽던 오늘/마감·만기 타일(2026-07-24 삭제)이 없어져서, 눌러도 아무 일도 안 일어났다 (2026-11-09).
  const tomorrow = addDays(today, 1)
  const endPassed = !memo.due && !!memo.period && memo.period.end <= today
  const openPlain = memo.status !== 'done' && !memo.keep
  const canPostpone = openPlain && (!!memo.due || endPassed)
  function postpone(d) {
    if (memo.due) return updateMemo(memo.id, { due: d })
    const start = memo.period.start <= d ? memo.period.start : d
    updateMemo(memo.id, { period: { start, end: d } })
  }

  return (
    <>
    {/* » 접기(패널 좌측 상단)는 2026-11-09 없앴다 — × · 빈 곳 클릭 · Esc로 닫는다 */}
    <aside
      className={'detail' + (inline ? ' detail-inline' : '') + (closing ? ' detail-out' : '')}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="panel-head">
          {/* 상태 고르기(PC 드롭다운·폰 버튼 줄)는 2026-11-09 없앴다 — 완료는 아래 ✓ 버튼, 진행중은
              체크하면 저절로(보드에서 끌어도 된다). 완료·보관인 메모만 무엇인지 작게 표시한다 */}
          {(st === 'done' || st === 'keep') && <span className={'badge st-' + st}>{STATUS_LABEL[st]}</span>}
          {/* 말머리([전표]·[회의록]…)는 "["를 치면 그 자리에서 고른다 (2026-10-07) */}
          <div className="tag-wrap">
          <textarea
            className={'panel-title-input' + (flash ? ' pti-' + flash : '')}
            value={title}
            rows={1}
            ref={(el) => {
              titleEl.current = el // 등록 연출이 출발할 자리
              fitTA(el)
            }}
            autoFocus={!memo.title}
            placeholder="제목을 입력하세요"
            onChange={(e) => {
              setTitle(e.target.value)
              titleLatest.current = e.target.value
              fitTA(e.target)
              tag.read(e.target)
            }}
            onFocus={() => { titleBase.current = titleLatest.current }}
            onBlur={(e) => {
              tag.close()
              saveTitle(e)
            }}
            onKeyDown={(e) => {
              // 말머리 목록이 떠 있으면 ↑↓·Enter·Esc는 목록이 먼저 먹는다
              if (tag.onKeyDown(e)) return
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
          <TagList ctl={tag} />
          </div>
          {/* 접기는 폰의 아코디언 상세에서만 — PC는 어디서 열리든 × 로 통일 (2026-07-31) */}
          {inline && narrow ? (
            <button className="fold-btn" onClick={onClose}>접기</button>
          ) : (
            <button className="x" onClick={onClose} aria-label="닫기" title="닫기">×</button>
          )}
        </div>
        {/* 등록되는 순간 예정·D-day 줄이 살짝 떠오르며 자리를 잡는다 — "이 일이 8/12에 걸렸다" */}
        <div className={'panel-meta' + (flash === 'reg' ? ' meta-settle' : '')}>
          {/* 일정 칸 — 하루 종일 / 시작 / 종료 / 반복 / 미리 알림 (2026-09-15 아이폰 달력식 개편).
              예전의 예정일 한 칸 + "기간으로"·"루틴으로" 링크 + 정보 수정 폼을 대신한다 */}
          {(memo.due || memo.period) && (
            <div className="meta-block sched-wrap">
              {/* 며칠 지났나·남았나는 "일정" 이름표 옆에 — 보드 카드와 같은 배지 (2026-11-09, 그전엔 시작 시간 옆 "3일 지남") */}
              <div className="panel-sec-label sched-label">
                일정
                {ddBadge && <span className={'kb-badge ' + ddBadge[0]}>{ddBadge[1]}</span>}
              </div>
              {/* 루틴이 자동으로 찍어둔 날짜 — 날짜를 옮기면 저절로 확정되지만,
                  자동 날짜가 마침 맞을 때를 위해 "이 날 맞다"만 누르는 길을 둔다 (2026-08-13) */}
              {memo.tentative && (
                <div className="sched-tent">
                  <span className="sched-tent-tag">자동으로 잡힌 날</span>
                  <button
                    className="linkish t-blue"
                    title="이 날짜로 잡혔다고 표시합니다 — 달력에서 진하게 바뀝니다"
                    onClick={() => confirmDate(memo.id)}
                  >
                    이 날로 확정
                  </button>
                </div>
              )}
              <ScheduleBlock memo={memo} />
              {/* 옮긴 날을 규칙으로 삼을지 그 자리에서 묻는다 — 누르면 다음 달부터 그 날로 온다.
                  "이번만"을 누르면 이 회차에서는 다시 안 묻는다 (2026-08-20) */}
              {askDay && (
                <div className="meta-ask">
                  <span>
                    루틴 예정일은 {ruleNow} — 앞으로도 매달 {ruleNew}에 할까요?
                  </span>
                  <button
                    className="linkish t-blue"
                    title={
                      askShift
                        ? '그 달분을 다음 달에 처리하는 것으로 규칙이 바뀝니다 (8월분 → 9월 3일)'
                        : '다음 달부터 이 날로 옵니다 (아직 안 끝난 회차도 같이 옮겨집니다)'
                    }
                    onClick={() => adoptCycleDay(memo.id)}
                  >
                    매달 {ruleNew}로
                  </button>
                  <button
                    className="linkish"
                    title="이 달만 옮긴 것으로 두고 규칙은 그대로 둡니다"
                    onClick={() => updateMemo(memo.id, { dayKept: true })}
                  >
                    이번만
                  </button>
                </div>
              )}
            </div>
          )}
          {linkedWork && onOpen && (
            <button className="linkish" onClick={() => onOpen(linkedWork.id)} title="연결된 점검 열기">
              점검: {linkedWork.title}
            </button>
          )}
        </div>
        {/* 액션 줄 — 아이콘 + 마우스 설명. 완료 · 미루기 | 보관 · 삭제 (2026-11-09 고정 순서, 폰도 같다).
            보관·삭제 아이콘은 왼쪽 메뉴의 보관·휴지통과 같은 그림 — 누르면 어디로 가는지 그림이 말해준다.
            보관 메모만 [오늘 할 일로 꺼내기]·[날짜 지정] 글자 버튼 (보류의 "날짜 지정"도 2026-10-29 여기로 합쳤다). */}
        <div className="panel-actions">
          {memo.status !== 'done' && memo.keep && (
            <>
              <button
                className="btn-done"
                title="보관에서 꺼내 오늘 할 일로 보냅니다"
                onClick={() => updateMemo(memo.id, { keep: false, due: todayStr() })}
              >
                오늘 할 일로 꺼내기
              </button>
              <SendToDateBtn
                label="날짜 지정"
                min={todayStr()}
                onPick={(d) => updateMemo(memo.id, { keep: false, due: d })}
              />
            </>
          )}
          {!memo.keep &&
            (memo.status !== 'done' ? (
              <button
                className="pa-ic pa-done"
                data-tip={memo.repeat && memo.due ? `이번 회차 완료 — 다음 ${REPEAT_LABEL[memo.repeat] || ''} 예정으로` : '완료 처리'}
                onClick={() => completeMemo(memo.id)}
              >
                {ICONS.check}
                <span className="pa-tx">완료</span>
              </button>
            ) : (
              <button className="pa-ic" data-tip="다시 열기" onClick={() => reopenMemo(memo.id)}>
                {ICONS.undo}
                <span className="pa-tx">다시 열기</span>
              </button>
            ))}
          {canPostpone && (
            <button
              className="pa-ic"
              data-tip={memo.due && memo.due > today ? '하루 미루기 — 하루 뒤로' : endPassed ? '하루 미루기 — 마감일을 내일로' : '하루 미루기 — 내일로'}
              onClick={() => postpone(memo.due && memo.due > today ? addDays(memo.due, 1) : tomorrow)}
            >
              {ICONS.next}
              <span className="pa-tx">미루기</span>
            </button>
          )}
          {openPlain && <span className="pa-div" />}
          {openPlain && (
            <button
              className="pa-ic"
              data-tip="보관 — 날짜를 떼고 보관으로 (달력·보드에서 빠짐)"
              onClick={() => updateMemo(memo.id, { keep: true, due: null, period: null, snoozeUntil: null })}
            >
              {ICONS.keep}
              <span className="pa-tx">보관</span>
            </button>
          )}
          <button
            className="pa-ic pa-danger"
            data-tip="삭제 — 휴지통으로 (30일 보관)"
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
        </div>
        {/* 분야 (2026-11-06) — 보고서·대장·연간실적을 묶는 기준. 새 메모는 비슷한 옛 메모를 보고
            앱이 정해 두고("자동"), 고르면 내가 정한 것이 된다. 루틴 회차는 루틴의 분야를 바꾼다 */}
        <div className="panel-area">
          <span className="panel-sec-label">분야</span>
          <select
            className="sched-select area-select"
            value={areaOf(memo) || ''}
            onChange={(e) => setArea(memo, e.target.value)}
          >
            <option value="">미분류</option>
            {AREAS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {memo.areaAuto && !memo.routineId && <span className="sched-muted">자동</span>}
          {memo.routineId && <span className="sched-muted">루틴 전체에 적용</span>}
        </div>
        {/* 완료하면 N년마다 루틴이 되는 메모 (2026-11-06) — 아직 한 번도 안 한 법정 조사 */}
        {Number(memo.repeatYears) > 1 && !memo.routineId && memo.status !== 'done' && (
          <div className="panel-years">
            <span>완료하면 그날부터 {memo.repeatYears}년마다 루틴으로 돕니다</span>
            <button
              className="linkish"
              title="완료해도 루틴을 만들지 않는 보통 메모로"
              onClick={() => updateMemo(memo.id, { repeatYears: null })}
            >
              풀기
            </button>
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
        {/* 작성일·완료일 — 맨 아래에 작게 (2026-11-09, 그전엔 일정 칸 밑) */}
        <div className="panel-created">
          작성 {fmtDate(memo.createdAt.slice(0, 10))}
          {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
        </div>
    </aside>
    </>
  )
}
