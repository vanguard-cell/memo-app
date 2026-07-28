import { useState } from 'react'
import { unholdMemos } from '../store'
import { fmtDate } from '../derive'
import { todayStr } from '../parser'
import SendToDateBtn from '../components/SendToDateBtn'

// 보류함 — 하다가 멈췄거나 기약이 없어진 일(hold)을 모아 보는 곳. 화면 구조는 보관함과 동일하되,
// 줄마다 보류한 날짜와 마지막 진행기록 한 줄을 같이 보여줘 "어디까지 하다 멈췄는지"가 바로 보인다.
export default function HoldView({ memos, onOpen, onClose, renderDetail }) {
  const [sel, setSel] = useState([])
  const list = [...memos].sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1))
  const allSel = list.length > 0 && sel.length === list.length

  function toggle(id) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function send(ids, due) {
    unholdMemos(ids, due)
    setSel([])
  }

  return (
    <div className="view">
      <div className="trash-head">
        <b>보류함</b>
        <span className="kb-count">{list.length}</span>
        <button className="pill" onClick={onClose}>닫기</button>
      </div>
      <div className="trash-note">
        하다가 멈췄거나 언제 다시 할지 정하지 못한 일들입니다. 보드·달력에는 안 보이고 검색에는
        걸립니다. 진행기록은 그대로 남아 있고, "오늘로"나 "날짜 지정"을 누르면 다시 할 일로 나갑니다.
      </div>
      {list.length === 0 && <div className="empty">보류함이 비어 있습니다</div>}
      {list.length > 0 && (
        <div className="trash-selbar">
          <label className="trash-selall">
            <input
              type="checkbox"
              className="trash-check"
              checked={allSel}
              onChange={() => setSel(allSel ? [] : list.map((m) => m.id))}
            />
            전체 선택
          </label>
          {sel.length > 0 && (
            <>
              <button onClick={() => send(sel, todayStr())}>오늘로 {sel.length}개</button>
              <SendToDateBtn
                label={`날짜 지정 ${sel.length}개`}
                min={todayStr()}
                onPick={(d) => send(sel, d)}
              />
            </>
          )}
        </div>
      )}
      {list.map((m) => {
        const d = renderDetail ? renderDetail(m.id) : null
        if (d) return <div key={m.id}>{d}</div>
        // 마지막으로 적은 진행기록 한 줄 — 멈춘 지점을 목록에서 바로 떠올릴 수 있게
        const last = [...(m.history || [])].reverse().find((h) => h.text)
        return (
          <div className="row" key={m.id} onClick={() => onOpen(m.id)}>
            <input
              type="checkbox"
              className="trash-check"
              checked={sel.includes(m.id)}
              onChange={() => toggle(m.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="row-title">
              {m.title}
              {last && (
                <span className="hold-last">
                  {fmtDate(last.date)} {last.text}
                </span>
              )}
            </span>
            <span className="trash-meta">보류 {fmtDate(m.holdAt || (m.updatedAt || '').slice(0, 10))}</span>
            <button
              title="보류를 풀고 오늘 할 일로 보냅니다"
              onClick={(e) => { e.stopPropagation(); send([m.id], todayStr()) }}
            >
              오늘로
            </button>
            <SendToDateBtn min={todayStr()} onPick={(d) => send([m.id], d)} />
          </div>
        )
      })}
    </div>
  )
}
