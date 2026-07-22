import { useState } from 'react'
import { unkeepMemos } from '../store'
import { fmtDate } from '../derive'
import { todayStr } from '../parser'
import SendToDateBtn from '../components/SendToDateBtn'

// 보관함 — 날짜 없이 넣어둔 메모(keep)를 모아 보는 곳. 화면 구조는 휴지통과 동일:
// 목록 위 선택 줄(전체 선택 + 체크하면 이동 버튼), 줄마다 체크박스·제목·넣은 날짜·이동 버튼.
// 제목을 누르면 상세(진행기록)가 열리고, "오늘로"/"날짜 지정"으로 할 일로 내보낸다.
export default function KeepView({ memos, onOpen, onClose, renderDetail }) {
  const [sel, setSel] = useState([])
  const list = [...memos].sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1))
  const allSel = list.length > 0 && sel.length === list.length

  function toggle(id) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function send(ids, due) {
    unkeepMemos(ids, due)
    setSel([])
  }

  return (
    <div className="view">
      <div className="trash-head">
        <b>보관함</b>
        <span className="kb-count">{list.length}</span>
        <button className="pill" onClick={onClose}>닫기</button>
      </div>
      <div className="trash-note">
        날짜 없이 넣어둔 메모들입니다. 보드·달력에는 안 보이고 검색에는 걸립니다. 제목을 누르면
        내용·진행기록이 열리고, "오늘로"나 "날짜 지정"을 누르면 할 일로 나갑니다.
      </div>
      {list.length === 0 && <div className="empty">보관함이 비어 있습니다</div>}
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
        return (
          <div className="row" key={m.id} onClick={() => onOpen(m.id)}>
            <input
              type="checkbox"
              className="trash-check"
              checked={sel.includes(m.id)}
              onChange={() => toggle(m.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="row-title">{m.title}</span>
            <span className="trash-meta">넣음 {fmtDate(m.createdAt.slice(0, 10))}</span>
            <button
              title="오늘 할 일로 보냅니다"
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
