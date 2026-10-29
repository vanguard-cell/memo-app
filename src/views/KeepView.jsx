import { useEffect, useRef, useState } from 'react'
import { addMemo, addHistory, toggleHistory, completeMemo, reopenMemo, unkeepMemos, updateMemo } from '../store'
import { todayStr } from '../parser'
import SendToDateBtn from '../components/SendToDateBtn'

// 「보관」 — 날짜 없이 넣어둔 목록(살 것·챙길 것·자료). 2026-10-29 아래 서랍에서 메뉴로 올리며 다시 짰다.
// 쓰는 장면(사용자): 달력을 보며 일하다가 한 번씩 메뉴를 눌러 들어와 체크한다. 그래서
//  · 메모마다 카드 한 장, 진행기록 체크리스트를 카드에 바로 펼쳐 그 자리에서 체크한다 (상세를 안 열어도 됨)
//  · 카드 아래 한 줄 칸으로 항목을 바로 더한다 (Enter)
//  · 체크한 항목은 접어 둔다 — 남은 것만 한눈에. "체크한 것 N"을 누르면 펼쳐진다
//  · 다 체크했으면 [완료]로 끝낸다 — 완료한 목록은 메모 표의 완료 묶음·검색에 남는다(버리지 않는다)
//  · 맨 위 한 줄 칸으로 새 목록을 바로 만든다 (예전엔 보드에서 만들고 상세의 [보관]을 눌러야 했다)
//  · 제목을 누르면 평소 상세(설명·파일·날짜 지정)가 열린다
// 카드 순서는 만든 순서(새 것이 위) — 고친 순으로 두면 체크할 때마다 카드가 맨 위로 뛰어 누르던 자리가 도망간다.
export default function KeepView({ memos, openId, onOpen, renderDetail }) {
  const [newTitle, setNewTitle] = useState('')
  const [unfold, setUnfold] = useState(() => new Set()) // 체크한 것을 펼쳐 둔 카드
  const [drafts, setDrafts] = useState({}) // 카드별 "항목 추가" 칸의 글자
  const [undo, setUndo] = useState(null)
  const [focusId, setFocusId] = useState(null) // 방금 만든 목록 — 그 카드의 추가 칸으로 커서를 넘긴다
  const undoTimer = useRef(null)
  const addRefs = useRef({})

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  // 새 카드가 실제로 그려진 뒤에 커서를 옮긴다 (그리기 전에 옮기면 커서가 위 칸에 남아
  // 다음에 친 글자가 또 새 목록이 된다 — 2026-10-29 미리보기에서 실제로 그랬다)
  useEffect(() => {
    if (!focusId) return
    const el = addRefs.current[focusId]
    if (el) {
      el.focus()
      setFocusId(null)
    }
  }, [focusId, memos])

  const list = [...memos].sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))
  // 체크할 수 있는 줄 = 진행기록 중 기록 전용(log)이 아닌 것. 원래 순서(index)를 지켜야 체크가 맞는 줄에 간다
  const linesOf = (m) => (m.history || []).map((h, i) => ({ h, i })).filter(({ h }) => h.type !== 'log')
  const totalLeft = list.reduce((n, m) => n + linesOf(m).filter(({ h }) => !h.done).length, 0)

  function create() {
    const t = newTitle.trim()
    if (!t) return
    const m = addMemo({ title: t, keep: true })
    setNewTitle('')
    // 만들자마자 첫 항목을 적을 수 있게 그 카드의 추가 칸으로 (위 useEffect가 그린 뒤에 옮긴다)
    setFocusId(m.id)
  }

  function addLine(id) {
    const t = (drafts[id] || '').trim()
    if (!t) return
    addHistory(id, t, todayStr())
    setDrafts((d) => ({ ...d, [id]: '' }))
  }

  function toggleFold(id) {
    setUnfold((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 완료·할 일로 보내기는 카드가 이 화면에서 사라진다 — 몇 초간 되돌릴 수 있게 (루틴 칸과 같은 방식)
  function withUndo(label, fn) {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  function finish(m) {
    completeMemo(m.id)
    withUndo(`${m.title} — 완료`, () => reopenMemo(m.id))
  }

  function sendTo(m, d) {
    unkeepMemos([m.id], d)
    // 되돌리기 = 다시 보관으로 (상세의 [보관]과 같은 모양: 날짜를 뗀다)
    withUndo(`${m.title} — ${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} 할 일로`, () =>
      updateMemo(m.id, { keep: true, due: null, period: null, snoozeUntil: null })
    )
  }

  const enter = (e, fn) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return // 한글 조합 중 Enter는 글자를 맺는 것
    e.preventDefault()
    fn()
  }

  return (
    <div className="view kp-view">
      <div className="kp-top">
        <b>보관</b>
        <span className="kb-count">
          {list.length}개{totalLeft > 0 ? ` · 남은 체크 ${totalLeft}` : ''}
        </span>
      </div>
      <div className="kp-new">
        <input
          className="kp-input"
          value={newTitle}
          placeholder="새 목록 — 예: 살 것, 출장 챙길 것 (Enter)"
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => enter(e, create)}
        />
        <button onClick={create}>만들기</button>
      </div>
      {list.length === 0 && (
        <div className="empty">
          비어 있습니다. 위에 목록 이름을 적어 만들거나, 메모 상세에서 [보관]을 누르면 여기로 옵니다.
        </div>
      )}
      <div className="kp-grid">
        {list.map((m) => {
          // 폰: 제목을 누르면 카드 자리에서 상세가 펼쳐진다 (보드·달력과 같은 규칙)
          const d = renderDetail ? renderDetail(m.id) : null
          if (d) return <div key={m.id} className="kp-detail">{d}</div>
          const lines = linesOf(m)
          const open = lines.filter(({ h }) => !h.done)
          const checked = lines.filter(({ h }) => h.done)
          const logs = (m.history || []).filter((h) => h.type === 'log')
          const allDone = lines.length > 0 && open.length === 0
          const folded = !unfold.has(m.id)
          const desc = (m.desc || '').trim()
          return (
            <div key={m.id} className={'kp-card' + (openId === m.id ? ' on' : '') + (allDone ? ' kp-alldone' : '')}>
              <div className="kp-head">
                <span className="kp-title" title="누르면 상세 — 설명·파일·날짜" onClick={() => onOpen(m.id)}>
                  {m.title || '(제목 없음)'}
                </span>
                {lines.length > 0 && (
                  <span className="kp-count">
                    {checked.length}/{lines.length}
                  </span>
                )}
              </div>
              {desc && <div className="kp-desc">{desc}</div>}
              {open.length > 0 && (
                <ul className="kp-lines">
                  {open.map(({ h, i }) => (
                    <li key={i}>
                      <label className="kp-line">
                        <input type="checkbox" checked={false} onChange={() => toggleHistory(m.id, i)} />
                        <span>{h.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {allDone && <div className="kp-alldone-msg">다 체크했습니다</div>}
              {(checked.length > 0 || logs.length > 0) && (
                <>
                  <button className="kp-fold" onClick={() => toggleFold(m.id)}>
                    {folded ? '▸' : '▾'} 체크한 것 {checked.length}
                    {logs.length > 0 ? ` · 기록 ${logs.length}` : ''}
                  </button>
                  {!folded && (
                    <ul className="kp-lines kp-done">
                      {checked.map(({ h, i }) => (
                        <li key={i}>
                          <label className="kp-line" title="체크를 풀면 남은 것으로 돌아갑니다">
                            <input type="checkbox" checked onChange={() => toggleHistory(m.id, i)} />
                            <span>{h.text}</span>
                          </label>
                        </li>
                      ))}
                      {logs.map((h, j) => (
                        <li key={'l' + j} className="kp-line kp-log">
                          · <span>{h.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <input
                ref={(el) => {
                  if (el) addRefs.current[m.id] = el
                  else delete addRefs.current[m.id]
                }}
                className="kp-input kp-add"
                value={drafts[m.id] || ''}
                placeholder="+ 항목 추가 (Enter)"
                onChange={(e) => setDrafts((dr) => ({ ...dr, [m.id]: e.target.value }))}
                onKeyDown={(e) => enter(e, () => addLine(m.id))}
              />
              <div className="kp-foot">
                <SendToDateBtn
                  className="linkish"
                  label="할 일로"
                  min={todayStr()}
                  onPick={(dd) => sendTo(m, dd)}
                />
                <button
                  className={'linkish' + (allDone ? ' kp-finish' : '')}
                  title="이 목록을 끝냅니다 — 완료 묶음·검색에는 남습니다"
                  onClick={() => finish(m)}
                >
                  완료
                </button>
              </div>
            </div>
          )
        })}
      </div>
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
    </div>
  )
}
