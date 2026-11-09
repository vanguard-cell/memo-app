import { useEffect, useRef, useState } from 'react'
import { addHistory, toggleHistory, updateHistory, removeHistory, updateMemo, completeMemo, reopenMemo, deleteMemo, confirmDate, routineOf, cycleDue, ymDiff, adoptCycleDay } from '../store'
import { STATUS_LABEL, fmtDate, dueBadge } from '../derive'
import { todayStr } from '../parser'
import Timeline from './Timeline'
import { useTagSuggest, TagList } from './TagSuggest'
import { ScheduleBlock } from './ScheduleFields'
import { splitTime } from '../schedule'
import SendToDateBtn from './SendToDateBtn'
import FileSection from './FileSection'
import { attachFile, detachFile } from '../store'
import { ICONS } from '../icons'
import useIsNarrow from '../useIsNarrow'

// 상세의 버튼 자리 (2026-11-09 다시 정리, 사용자: "완료/보관/휴지통 위치도 적절한 곳으로"):
// 완료 = 제목 왼쪽 동그라미(아이폰 미리 알림처럼) · 보관·삭제 = 맨 아래 작성일 옆.
// 버튼 줄(완료·미루기·날짜 지정·보관·삭제)과 하루 미루기는 없앴다 — 날짜는 일정 칸에서 바로 고친다.

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

  // 하루 미루기는 2026-11-09 없앴다(사용자: "필요없다") — 날짜는 일정 칸의 시작 날짜로 옮긴다
  const openPlain = memo.status !== 'done' && !memo.keep
  const done = memo.status === 'done'
  function remove() {
    if (window.confirm('휴지통으로 옮길까요? 30일 안에는 휴지통에서 복구할 수 있습니다.')) {
      deleteMemo(memo.id)
      onClose()
    }
  }

  return (
    <>
    {/* » 접기(패널 좌측 상단)는 2026-11-09 없앴다 — × · 빈 곳 클릭 · Esc로 닫는다 */}
    <aside
      className={'detail' + (inline ? ' detail-inline' : '') + (closing ? ' detail-out' : '')}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="panel-head">
          {/* 완료 = 제목 왼쪽 동그라미 (아이폰 미리 알림처럼). 누르면 완료, 완료된 메모는 다시 누르면 되살린다.
              보관 메모는 완료 개념 밖이라 "보관" 표시만. (상태 고르기는 2026-11-09 없앴다 — 진행중은 체크하면 저절로) */}
          {memo.keep && !done ? (
            <span className="badge st-keep">{STATUS_LABEL.keep}</span>
          ) : (
            <button
              type="button"
              className={'title-check' + (done ? ' on' : '')}
              title={
                done
                  ? '다시 열기'
                  : memo.repeat && memo.due
                    ? `이번 회차 완료 — 다음 ${REPEAT_LABEL[memo.repeat] || ''} 예정으로`
                    : '완료'
              }
              aria-label={done ? '다시 열기' : '완료'}
              aria-pressed={done}
              onClick={() => (done ? reopenMemo(memo.id) : completeMemo(memo.id))}
            >
              <span className="tc-dot">{ICONS.check}</span>
            </button>
          )}
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
              {/* 루틴이 잡은 날 확정·"매달 ○일로?" 질문은 일정 칸 안, 날짜 줄 바로 밑에 (2026-11-09,
                  사용자: "따로 나오게 하지 말고 같은 곳에 묶어") */}
              <ScheduleBlock memo={memo}>
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
              </ScheduleBlock>
            </div>
          )}
          {linkedWork && onOpen && (
            <button className="linkish" onClick={() => onOpen(linkedWork.id)} title="연결된 점검 열기">
              점검: {linkedWork.title}
            </button>
          )}
        </div>
        {/* 보관 메모만 — 꺼내는 버튼 두 개 (보류의 "날짜 지정"도 2026-10-29 여기로 합쳤다) */}
        {memo.keep && !done && (
          <div className="panel-actions">
            <button
              className="btn-done"
              title="보관에서 꺼내 오늘 할 일로 보냅니다"
              onClick={() => updateMemo(memo.id, { keep: false, due: todayStr() })}
            >
              오늘 할 일로 꺼내기
            </button>
            <SendToDateBtn label="날짜 지정" min={todayStr()} onPick={(d) => updateMemo(memo.id, { keep: false, due: d })} />
          </div>
        )}
        {/* 분야 칸은 2026-11-09 사용자 요청으로 상세에서 뺐다 — 분야는 앱이 계속 저절로 정해 두고
            (보고서·대장의 기준, 검색에도 걸림), 고치는 자리가 다시 필요하면 대장·보고서 화면에 둔다 */}
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
        {/* 맨 아래 한 줄: 보관 · 삭제(가끔 쓰는 것) + 작성일·완료일 (2026-11-09) */}
        <div className="panel-foot">
          {openPlain && (
            <button
              type="button"
              className="foot-btn"
              title="날짜를 떼고 보관으로 (달력·보드에서 빠짐)"
              onClick={() => updateMemo(memo.id, { keep: true, due: null, period: null, snoozeUntil: null })}
            >
              {ICONS.keep}
              보관
            </button>
          )}
          <button type="button" className="foot-btn foot-danger" title="휴지통으로 (30일 보관)" onClick={remove}>
            {ICONS.trash}
            삭제
          </button>
          <span className="panel-created">
            작성 {fmtDate(memo.createdAt.slice(0, 10))}
            {memo.completedAt && ` · 완료 ${fmtDate(memo.completedAt.slice(0, 10))}`}
          </span>
        </div>
    </aside>
    </>
  )
}
