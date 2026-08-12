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
  const undoTimer = useRef(null)

  const ymOf = (m) => `${year}-${pad2(m)}`
  const curYm = thisYm()

  useEffect(() => () => clearTimeout(undoTimer.current), [])

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

  function startEdit(r) {
    setEditId(r.id)
    setForm({
      title: r.title,
      group: r.group || '',
      desc: r.desc || '',
      dueDay: r.dueDay || 5,
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
      dueDay: Math.min(28, Math.max(1, Number(form.dueDay) || 5)),
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
    const memo = ensureCycle(r.id, ymOf(selMonth))
    if (memo) onOpen(memo.id)
  }

  // 칸을 잘못 눌러 완료가 켜지거나 꺼지는 일이 잦다 — 누른 직후 몇 초간 되돌릴 수 있게 한다
  // (보드의 완료 되돌리기 바와 같은 방식). 확인을 묻지 않는 이유: 매달 수십 번 누르는
  // 자리라 물어보면 그게 더 성가시다. (2026-08-11 사용자 요청)
  function tapCell(r, m) {
    const ym = ymOf(m)
    const was = (cycleOf(r.id, ym) || {}).status === 'done'
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
          <div className="panel-sec-label">
            엑셀에서 머리줄(구분·항목명·담당…)까지 함께 긁어 복사한 뒤 여기에 붙여넣으세요 (Ctrl+V)
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
                {year}년 기준 · 이름이 같은 루틴은 묶음·설명만 갱신됩니다
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
                      </>
                    )}
                  </td>
                  {MONTHS.map((m) => (
                    <td key={m} className={'rt-gcell' + (m === selMonth ? ' sel' : '')} />
                  ))}
                  <td className="rt-gcell" />
                </tr>
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
                            return (
                              <td
                                key={m}
                                className={
                                  'rt-cell rt-' + c.kind + (m === selMonth ? ' sel' : '') + (c.rec ? ' rec' : '')
                                }
                                onClick={() => c.kind !== 'na' && tapCell(r, m)}
                                title={
                                  c.kind === 'na'
                                    ? '해당 없음'
                                    : c.kind === 'done'
                                      ? '완료 — 누르면 되돌립니다'
                                      : '누르면 완료'
                                }
                              >
                                {c.kind === 'na' ? '–' : c.kind === 'done' ? '✓' : '·'}
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
                                <label>
                                  예정일
                                  <span className="rt-day">
                                    매월
                                    <input
                                      type="number"
                                      min="1"
                                      max="28"
                                      value={form.dueDay}
                                      onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                                    />
                                    일
                                  </span>
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

      {undo && (
        <div className="undo-bar">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              undo.fn()
              clearTimeout(undoTimer.current)
              setUndo(null)
            }}
          >
            되돌리기
          </button>
        </div>
      )}

      <div className="rt-legend">
        <span>
          <b className="rt-t-done">✓</b> 완료
        </span>
        <span>
          <b>·</b> 남음
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
