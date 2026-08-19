import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  addRoutine,
  updateRoutine,
  removeRoutine,
  stopRoutine,
  ensureCycle,
  toggleCycle,
  routineHasMonth,
  importRoutineRows,
  importRoutineCycles,
  setGroupDueDay,
  setGroupFlexible,
  thisYm,
} from '../store'
import { readRoutinePaste } from '../importXlsx'
import useIsNarrow from '../useIsNarrow'

const pad2 = (n) => String(n).padStart(2, '0')
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
// 중단한 항목을 담는 가짜 묶음 이름 — 격자 맨 아래에 접힌 채로 붙는다
const STOPPED = '__stopped__'

// 주기 = 결국 "몇 월에 해당하는가"의 목록. 분기·반기는 시작 월이 제각각이라(1·4·7·10 vs 2·5·8·11)
// 기본값만 주고, 그 밖의 조합은 정의를 고쳐 쓰는 쪽으로 둔다.
const CYCLES = [
  ['매월', null],
  ['분기', [1, 4, 7, 10]],
  ['반기', [6, 12]],
  ['매년', [12]],
]

// 「루틴」 — 매달·분기·해마다 도는 일을 1년 격자로 (2026-08-11).
// 행 = 반복 규칙(정의), 칸 = 그 달의 회차 메모.
// 칸을 누르면 완료 ↔ 되돌리기, 이름을 누르면 고른 달의 회차가 상세로 열린다
// (그 달만의 특이사항·파일은 거기 쌓인다 — 정의에 적는 설명은 매달 같은 것만).
export default function RoutineView({ routines, memos, onOpen, renderDetail }) {
  const narrow = useIsNarrow()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  // 이름을 눌렀을 때 어느 달의 회차를 열지 — 기본은 이번 달, 월 머리를 눌러 바꾼다
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(null)
  // 엑셀에서 복사해 붙여넣기 — 회사 보안 프로그램이 브라우저의 파일 읽기를 막을 때의 길.
  // 파일을 안 거치므로 업로드 차단과 무관하다. (2026-08-11)
  const [paste, setPaste] = useState(null) // { text, parsed, error, result }
  const [undo, setUndo] = useState(null)
  const [showStopped, setShowStopped] = useState(false)
  const [gDay, setGDay] = useState(null) // 묶음 예정일 일괄 변경 { g, day }
  const [arm, setArm] = useState(null) // 완료 해제를 한 번 물어둔 칸 { id, m }
  const undoTimer = useRef(null)
  const armTimer = useRef(null)

  const ymOf = (m) => `${year}-${pad2(m)}`
  const curYm = thisYm()

  useEffect(() => () => { clearTimeout(undoTimer.current); clearTimeout(armTimer.current) }, [])

  // 회차 찾기 — 메모 전체를 한 번만 훑어 (루틴id|연월) 색인을 만든다
  const cycles = useMemo(() => {
    const map = new Map()
    for (const m of memos) if (m.routineId && m.ym) map.set(m.routineId + '|' + m.ym, m)
    return map
  }, [memos])
  const cycleOf = (rid, ym) => cycles.get(rid + '|' + ym)

  // 중단한 항목은 목록에서 내려 접어둔다 — 지운 게 아니라 "끝난 것"이라 지난 기록은 그대로 남는다.
  // 격자 맨 아래 "중단 N건"을 펼치면 그때까지의 체크가 다 보인다. (2026-08-11)
  const live = routines.filter((r) => !r.endYm)
  const stoppedList = routines.filter((r) => r.endYm)

  // 그룹 순서는 정의 순서를 따른다 (엑셀의 구분 열 순서가 그대로 들어온다)
  const groups = []
  for (const r of live) {
    const g = r.group || '기타'
    if (!groups.includes(g)) groups.push(g)
  }
  // 중단한 것들은 맨 아래 한 묶음으로 모아 접어둔다 (묶음 하나를 더 두는 것과 같은 취급)
  if (stoppedList.length) groups.push(STOPPED)

  // 왼쪽 위 배지는 "고른 달" 기준 — 월 머리를 누르면 그 달의 남은 건수로 바뀐다
  const selYm = ymOf(selMonth)
  const remain = routines.filter(
    (r) => r.title.trim() && routineHasMonth(r, selYm) && (cycleOf(r.id, selYm) || {}).status !== 'done'
  ).length
  const selCount = routines.filter((r) => r.title.trim() && routineHasMonth(r, selYm)).length

  // 묶음의 지금 값 — 패널을 열 때 이 값으로 채워야 한쪽만 바꿔도 다른 쪽이 안 덮인다
  function groupNow(g) {
    const rs = live.filter((r) => (r.group || '기타') === g)
    const tally = {}
    for (const r of rs) tally[r.dueDay || 5] = (tally[r.dueDay || 5] || 0) + 1
    const day = Number(Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0]) || 5
    return { day, flexible: rs.length > 0 && rs.every((r) => r.flexible) }
  }

  function startEdit(r) {
    setEditId(r.id)
    setForm({
      title: r.title,
      group: r.group || '',
      desc: r.desc || '',
      dueDay: r.dueDay || 5,
      flexible: !!r.flexible,
      months: r.months || null,
      endNote: r.endNote || '',
    })
  }

  // 이름 없이 닫으면 그 줄은 없던 일로 — "+ 항목"을 눌렀다 만 빈 줄이 남지 않게
  // (메모의 빈 초안 정리와 같은 규칙)
  function cancelEdit() {
    const r = routines.find((x) => x.id === editId)
    if (r && !(r.title || '').trim()) removeRoutine(r.id)
    setEditId(null)
  }

  function saveEdit() {
    if (!form.title.trim()) return cancelEdit()
    updateRoutine(editId, {
      title: form.title.trim(),
      group: form.group.trim() || '기타',
      desc: form.desc.trim(),
      // 31일까지 받는다 — 그 날이 없는 달(2월 등)은 routineDue가 말일로 당긴다 (2026-08-14)
      dueDay: Math.min(31, Math.max(1, Number(form.dueDay) || 5)),
      flexible: !!form.flexible,
      months: form.months,
      endNote: form.endNote.trim(),
    })
    setEditId(null)
  }

  function addTo(group) {
    startEdit(addRoutine({ title: '', group, dueDay: 5 }))
  }

  // 칸 하나의 상태 — 그 달 회차 메모에서 읽는다
  function cell(r, m) {
    const ym = ymOf(m)
    if (!routineHasMonth(r, ym)) return { kind: 'na' }
    const c = cycleOf(r.id, ym)
    const future = ym > curYm
    if (!c) return { kind: future ? 'future' : 'open' }
    const rec = (c.history || []).length > 0 || (c.files || []).length > 0
    return { kind: c.status === 'done' ? 'done' : future ? 'future' : 'open', rec }
  }

  function openCycle(r) {
    // 이름부터 적어야 회차가 생긴다 — 이름 없는 줄을 누르면 열리는 대신 이름칸이 열린다
    if (!(r.title || '').trim()) return startEdit(r)
    const memo = ensureCycle(r.id, ymOf(selMonth))
    if (memo) onOpen(memo.id)
  }

  // 칸을 잘못 눌러 완료가 켜지거나 꺼지는 일이 잦다 — 누른 직후 몇 초간 되돌릴 수 있게 한다
  // (보드의 완료 되돌리기 바와 같은 방식). 확인을 묻지 않는 이유: 매달 수십 번 누르는
  // 자리라 물어보면 그게 더 성가시다. (2026-08-11 사용자 요청)
  //
  // 여기에 더해 **완료 해제는 같은 칸을 두 번 눌러야** 풀린다 (2026-08-14 사용자 요청).
  // 해놓은 것이 지워지는 쪽이 더 아프고, 해제는 어쩌다 한 번이라 두 번 눌러도 안 성가시다.
  // 완료 켜기는 그대로 한 번 — 매달 수십 번 누르는 자리다. 팝업 대신 그 칸이 물어본다
  // ([전부 이 날로]와 같은 방식 — 이 앱은 팝업 금지).
  function tapCell(r, m) {
    const ym = ymOf(m)
    const was = (cycleOf(r.id, ym) || {}).status === 'done'
    if (was && !(arm && arm.id === r.id && arm.m === m)) {
      clearTimeout(armTimer.current)
      setArm({ id: r.id, m })
      armTimer.current = setTimeout(() => setArm(null), 4000)
      return
    }
    clearTimeout(armTimer.current)
    setArm(null)
    toggleCycle(r.id, ym)
    clearTimeout(undoTimer.current)
    setUndo({
      label: `${r.title} ${m}월 — ${was ? '완료 해제' : '완료'}`,
      fn: () => toggleCycle(r.id, ym),
    })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  return (
    <div className="view rt-view">
      <div className="rt-head">
        <button onClick={() => setYear((y) => y - 1)}>‹</button>
        <span className="rt-year">{year}년</span>
        <button onClick={() => setYear((y) => y + 1)}>›</button>
        {selCount > 0 && (
          <span className={'rt-remain' + (remain === 0 ? ' done' : '')}>
            {selMonth}월 {remain === 0 ? '다 끝남' : `${remain}건 남음`}
          </span>
        )}
        <button
          className={'rt-paste-btn' + (paste ? ' on' : '')}
          title="엑셀에서 표를 복사해 붙여넣으면 그대로 읽습니다 (파일 업로드가 막힌 곳에서도 됩니다)"
          onClick={() => setPaste(paste ? null : { text: '' })}
        >
          엑셀에서 붙여넣기
        </button>
        <span className="rt-hint">칸 = 완료 · 이름 = 그 달 기록</span>
      </div>

      {paste && (
        <div className="rt-paste">
          {/* 붙여넣은 표가 월간체크리스트인지 문서 접수대장인지는 머리줄을 보고 앱이 가른다 (2026-08-12) */}
          <div className="panel-sec-label">
            엑셀에서 머리줄까지 함께 긁어 복사한 뒤 여기에 붙여넣으세요 (Ctrl+V) — 월간체크리스트(항목명…)도,
            문서 접수대장(접수일·문서명…)도 읽습니다
          </div>
          <textarea
            className="rt-paste-area"
            autoFocus
            rows={5}
            value={paste.text}
            placeholder={'구분\t사업장\t항목명\t거래처\t…\t7월\t8월\t…\n공과금·구미\t구미\t전기요금 …'}
            onChange={(e) => setPaste({ text: e.target.value })}
          />
          {paste.error && <div className="rt-paste-err">{paste.error}</div>}
          {paste.result && <div className="rt-paste-ok">{paste.result}</div>}
          <div className="rt-paste-btns">
            {!paste.parsed ? (
              <button
                className="btn-done"
                onClick={() => {
                  try {
                    const parsed = readRoutinePaste(paste.text, year)
                    setPaste({ ...paste, parsed, error: null })
                  } catch (e) {
                    setPaste({ ...paste, parsed: null, error: e.message })
                  }
                }}
              >
                읽기
              </button>
            ) : paste.parsed.kind === 'receipt' ? (
              <button
                className="btn-done"
                onClick={() => {
                  const n = importRoutineCycles(paste.parsed)
                  setPaste({
                    text: '',
                    result: `넣었습니다 — 새 루틴 ${n.routines}건, 회차 ${n.cycles}건, 기록 ${n.lines}줄` +
                      (n.updated ? ` (기존 회차 ${n.updated}건에 이어 붙임)` : ''),
                  })
                }}
              >
                회차 {paste.parsed.items.length}건 넣기
              </button>
            ) : (
              <button
                className="btn-done"
                onClick={() => {
                  const n = importRoutineRows(paste.parsed)
                  setPaste({
                    text: '',
                    result: `넣었습니다 — 새 루틴 ${n.added}건, 갱신 ${n.updated}건, 지난 완료 ${n.cycles}건`,
                  })
                }}
              >
                {paste.parsed.rows.length}건 넣기
              </button>
            )}
            <button onClick={() => setPaste(null)}>닫기</button>
            {paste.parsed && (
              <span className="rt-hint">
                {paste.parsed.kind === 'receipt'
                  ? `문서 접수대장 — 기록 ${paste.parsed.lines}줄을 그 달 회차로 (완료로 표시, 차수는 회차 안에 줄로)`
                  : `${year}년 기준 · 이름이 같은 루틴은 묶음·설명만 갱신됩니다`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="rt-scroll">
        <table className="rt-table">
          <thead>
            <tr>
              <th className="rt-name-col" />
              {MONTHS.map((m) => (
                <th
                  key={m}
                  className={'rt-mh' + (m === selMonth ? ' on' : '') + (ymOf(m) === curYm ? ' now' : '')}
                  onClick={() => setSelMonth(m)}
                  title={`${m}월 기록 보기`}
                >
                  {m}
                </th>
              ))}
              <th className="rt-menu-col" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                {/* 묶음 머리 — 칸 열을 colSpan으로 덮지 않는다. 덮으면 그 줄에서 열이 끊겨
                    아래위 체크가 따로 노는 것처럼 보인다(2026-08-11 지적). 열은 그대로 두고
                    이름 칸에만 글자를 얹어, 고른 달의 세로 띠가 위아래로 쭉 이어지게 한다. */}
                <tr className="rt-group">
                  <td className="rt-gname">
                    {g === STOPPED ? (
                      <button
                        className="rt-fold"
                        title="끝난 루틴 — 지난 기록은 그대로 남아 있습니다"
                        onClick={() => setShowStopped((v) => !v)}
                      >
                        {showStopped ? '▾' : '▸'} 중단 {stoppedList.length}건
                      </button>
                    ) : (
                      <>
                        {g}
                        <button className="rt-add" onClick={() => addTo(g)}>
                          +
                        </button>
                        {/* 묶음 통째로 예정일 바꾸기 — 34건을 하나씩 고치지 않게 (2026-08-11) */}
                        <button
                          className="rt-add"
                          title="이 묶음의 예정일·날짜 방식을 한 번에 바꿉니다"
                          onClick={() => setGDay(gDay && gDay.g === g ? null : { g, ...groupNow(g) })}
                        >
                          날짜
                        </button>
                      </>
                    )}
                  </td>
                  {MONTHS.map((m) => (
                    <td key={m} className={'rt-gcell' + (m === selMonth ? ' sel' : '')} />
                  ))}
                  <td className="rt-gcell" />
                </tr>
                {gDay && gDay.g === g && (
                  <tr className="rt-edit-row">
                    <td colSpan={14}>
                      <div className="rt-edit rt-gday">
                        {/* 두 가지를 각각의 버튼으로 나눠 둔다 — 예정일은 항목마다 다른데,
                            날짜 방식만 바꾸려다 예정일까지 묶음 전체에 덮이면 안 된다.
                            (2026-08-13 사용자: "개별로 다 다른 건인데") */}
                        <div className="rt-grow">
                          <label>
                            「{g}」 날짜 방식
                            <select
                              className="edit-select"
                              value={gDay.flexible ? 'flex' : 'fix'}
                              onChange={(e) => setGDay({ ...gDay, flexible: e.target.value === 'flex' })}
                            >
                              <option value="fix">고정 — 매월 같은 날</option>
                              <option value="flex">매번 잡음 — 업체와 조율</option>
                            </select>
                          </label>
                          <button
                            className="btn-done"
                            onClick={() => {
                              const n = setGroupFlexible(g, gDay.flexible)
                              setGDay(null)
                              setUndo({
                                label: `「${g}」 ${n}건을 ${gDay.flexible ? '매번 잡는 일로 (달력에 흐리게)' : '날짜 고정으로'}`,
                                fn: null,
                              })
                              clearTimeout(undoTimer.current)
                              undoTimer.current = setTimeout(() => setUndo(null), 5000)
                            }}
                          >
                            방식만 적용
                          </button>
                          <span className="rt-hint">예정일은 안 건드립니다</span>
                        </div>
                        <div className="rt-grow">
                          <label>
                            예정일 통일
                            <span className="rt-day">
                              매월
                              <input
                                type="number"
                                min="1"
                                max="31"
                                value={gDay.day}
                                onChange={(e) => setGDay({ ...gDay, day: e.target.value })}
                              />
                              일
                            </span>
                          </label>
                          {/* 확인은 팝업 대신 그 자리에서 두 번 누르기 —
                              앱 원칙이 팝업 금지이고, 회사 PC에서 확인창이 막히면
                              아무 일도 안 일어난 것처럼 보인다 (2026-08-13) */}
                          {gDay.sure ? (
                            <>
                              <button
                                className="rt-danger-btn on"
                                onClick={() => {
                                  const n = setGroupDueDay(g, gDay.day)
                                  setGDay(null)
                                  setUndo({ label: `「${g}」 ${n}건을 매월 ${gDay.day}일로 옮겼습니다`, fn: null })
                                  clearTimeout(undoTimer.current)
                                  undoTimer.current = setTimeout(() => setUndo(null), 5000)
                                }}
                              >
                                정말 전부 바꿉니다
                              </button>
                              <button onClick={() => setGDay({ ...gDay, sure: false })}>취소</button>
                              <span className="rt-hint t-red">
                                이 묶음 항목의 예정일이 전부 {gDay.day}일이 됩니다 (지금 날짜는 사라집니다).
                                이미 완료한 회차는 그대로 둡니다
                              </span>
                            </>
                          ) : (
                            <>
                              <button
                                className="rt-danger-btn"
                                onClick={() => setGDay({ ...gDay, sure: true })}
                              >
                                전부 이 날로
                              </button>
                              <span className="rt-hint">항목마다 날짜가 다르면 쓰지 마세요 (개별은 ⋯ → 수정)</span>
                            </>
                          )}
                        </div>
                        <div className="rt-edit-btns">
                          <button onClick={() => setGDay(null)}>닫기</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {(g === STOPPED
                  ? showStopped
                    ? stoppedList
                    : []
                  : live.filter((r) => (r.group || '기타') === g)
                ).map((r) => {
                    const stopped = !!r.endYm
                    const detail = renderDetail ? renderDetail((cycleOf(r.id, ymOf(selMonth)) || {}).id) : null
                    return (
                      <Fragment key={r.id}>
                        <tr className={'rt-row' + (stopped ? ' rt-stopped' : '')}>
                          {/* 설명(엑셀 비고)은 격자에 안 쓴다 — 한 화면에 최대한 많이 보이는 게 먼저고,
                              내용은 이름을 눌러 여는 상세의 '작업 설명'에 그대로 있다.
                              마우스를 올리면 말풍선으로도 보인다 (2026-08-11 사용자 지시) */}
                          <td className="rt-name">
                            <span
                              className="rt-title"
                              title={r.desc ? `${r.title}\n${r.desc}` : r.title}
                              onClick={() => openCycle(r)}
                            >
                              {r.title || '(이름 없음)'}
                            </span>
                            {stopped && (
                              <span className="rt-stop-tag" title={r.endNote}>
                                {Number(r.endYm.slice(5, 7))}월 중단
                              </span>
                            )}
                          </td>
                          {MONTHS.map((m) => {
                            const c = cell(r, m)
                            const armed = arm && arm.id === r.id && arm.m === m
                            return (
                              <td
                                key={m}
                                className={
                                  'rt-cell rt-' + c.kind + (m === selMonth ? ' sel' : '') +
                                  (c.rec ? ' rec' : '') + (armed ? ' arm' : '')
                                }
                                onClick={() => c.kind !== 'na' && tapCell(r, m)}
                                title={
                                  c.kind === 'na'
                                    ? '해당 없음'
                                    : armed
                                      ? '한 번 더 누르면 완료가 풀립니다'
                                      : c.kind === 'done'
                                        ? '완료 — 풀려면 두 번 누릅니다'
                                        : '누르면 완료'
                                }
                              >
                                {c.kind === 'na' ? '–' : armed ? '↺' : c.kind === 'done' ? '✓' : '·'}
                              </td>
                            )
                          })}
                          <td className="rt-menu">
                            <button
                              className="rt-dots"
                              aria-label="항목 수정"
                              onClick={() => (editId === r.id ? cancelEdit() : startEdit(r))}
                            >
                              ⋯
                            </button>
                          </td>
                        </tr>
                        {editId === r.id && form && (
                          <tr className="rt-edit-row">
                            <td colSpan={14}>
                              <div className="rt-edit">
                                <label>
                                  이름
                                  <input
                                    value={form.title}
                                    autoFocus
                                    placeholder="예: 전기요금 보디가드 305호"
                                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                                  />
                                </label>
                                <label>
                                  묶음
                                  <input
                                    value={form.group}
                                    placeholder="예: 공과금·구미"
                                    onChange={(e) => setForm({ ...form, group: e.target.value })}
                                  />
                                </label>
                                <label className="rt-wide">
                                  매달 같은 설명
                                  <input
                                    value={form.desc}
                                    placeholder="검침 11일~익월 10일 · 회계전표 · 한국전력공사"
                                    onChange={(e) => setForm({ ...form, desc: e.target.value })}
                                  />
                                </label>
                                {/* 날짜가 고정인 일(공과금)과 매번 잡아야 하는 일(업체 방문)을 가른다 —
                                    매번 잡는 일의 회차는 달력에 '가예정'(점선·흐리게)으로 뜬다 (2026-08-13) */}
                                <label>
                                  날짜
                                  <select
                                    className="edit-select"
                                    value={form.flexible ? 'flex' : 'fix'}
                                    onChange={(e) => setForm({ ...form, flexible: e.target.value === 'flex' })}
                                  >
                                    <option value="fix">고정 — 매월 같은 날</option>
                                    <option value="flex">매번 잡음 — 업체와 조율</option>
                                  </select>
                                </label>
                                <label>
                                  {form.flexible ? '자리 잡을 날' : '예정일'}
                                  <span className="rt-day">
                                    매월
                                    <input
                                      type="number"
                                      min="1"
                                      max="31"
                                      value={form.dueDay}
                                      onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                                    />
                                    일
                                  </span>
                                  {/* 29~31일은 없는 달이 있다 — 그 달은 말일로 간다는 걸 미리 알려준다 */}
                                  {Number(form.dueDay) > 28 && (
                                    <span className="rt-hint">그 날이 없는 달은 말일로</span>
                                  )}
                                </label>
                                <label>
                                  주기
                                  <select
                                    className="edit-select"
                                    value={(form.months || []).join()}
                                    onChange={(e) =>
                                      setForm({
                                        ...form,
                                        months: e.target.value ? e.target.value.split(',').map(Number) : null,
                                      })
                                    }
                                  >
                                    {CYCLES.map(([label, months]) => (
                                      <option key={label} value={(months || []).join()}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {stopped && (
                                  <label className="rt-wide">
                                    중단 메모
                                    <input
                                      value={form.endNote}
                                      placeholder="예: 박유림 인계"
                                      onChange={(e) => setForm({ ...form, endNote: e.target.value })}
                                    />
                                  </label>
                                )}
                                <div className="rt-edit-btns">
                                  <button className="btn-done" onClick={saveEdit}>
                                    저장
                                  </button>
                                  <button onClick={cancelEdit}>취소</button>
                                  {!stopped ? (
                                    <button
                                      title="이 달부터 안 함 — 지난 기록은 그대로 남습니다"
                                      onClick={() => stopRoutine(r.id, thisYm(), form.endNote.trim())}
                                    >
                                      중단
                                    </button>
                                  ) : (
                                    <button onClick={() => updateRoutine(r.id, { endYm: null })}>중단 해제</button>
                                  )}
                                  <button
                                    className="rt-del"
                                    title="정의만 지웁니다 — 이미 만들어진 회차 메모는 남습니다"
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `"${r.title}" 루틴을 목록에서 지울까요?\n지난 회차 메모는 메모로 그대로 남습니다.`
                                        )
                                      ) {
                                        removeRoutine(r.id)
                                        setEditId(null)
                                      }
                                    }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {/* 폰: 이름을 누르면 그 줄 아래에서 상세가 펼쳐진다 (보드·달력과 같은 규칙) */}
                        {narrow && detail && (
                          <tr className="rt-detail-row">
                            <td colSpan={14}>{detail}</td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {routines.length === 0 && (
        <div className="empty">
          아직 루틴이 없습니다. 매달 도는 일을 여기에 두면 한 해가 격자로 보입니다.
          <div className="rt-empty-btn">
            <button className="btn-done" onClick={() => addTo('기타')}>
              첫 항목 만들기
            </button>
          </div>
        </div>
      )}

      {/* 되돌릴 게 없는 알림(묶음 예정일 변경 등)은 같은 자리에 글자만 띄운다 */}
      {undo && (
        <div className="undo-bar">
          <span>{undo.label}</span>
          {undo.fn && (
            <button
              onClick={() => {
                undo.fn()
                clearTimeout(undoTimer.current)
                setUndo(null)
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}

      <div className="rt-legend">
        <span>
          <b className="rt-t-done">✓</b> 완료
        </span>
        <span>
          <b className="rt-t-open">·</b> 남음 (고른 달은 색으로)
        </span>
        <span>
          <b className="rt-t-rec">•</b> 그 달 기록 있음
        </span>
        <span>
          <b className="rt-t-na">–</b> 해당 없음
        </span>
      </div>
    </div>
  )
}
