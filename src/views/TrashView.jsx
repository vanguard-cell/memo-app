import { useState } from 'react'
import { restoreMemos, purgeMemos } from '../store'
import { fmtDate } from '../derive'

// 휴지통 — 삭제한 메모가 30일 보관되는 곳. 복구하면 원래 자리로 돌아온다.
// 30일이 지나면 동기화 때 자동으로 완전히 삭제된다 (store의 톰스톤 정리 규칙).
// 체크로 골라서 한 번에 복구하거나 즉시 완전 삭제할 수 있다 — 완전 삭제는 되돌릴 수 없다.
export default function TrashView({ memos, onClose }) {
  const [sel, setSel] = useState([])
  const allSel = memos.length > 0 && sel.length === memos.length

  function toggle(id) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function restoreSelected() {
    restoreMemos(sel)
    setSel([])
  }

  function purgeSelected() {
    if (!window.confirm(`선택한 ${sel.length}개를 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return
    purgeMemos(sel)
    setSel([])
  }

  return (
    <div className="view">
      <div className="trash-head">
        <b>휴지통</b>
        <span className="kb-count">{memos.length}</span>
        <button className="pill" onClick={onClose}>닫기</button>
      </div>
      <div className="trash-note">
        삭제한 메모는 여기에 30일 보관된 뒤 자동으로 완전히 삭제됩니다. 실수로 지웠다면 "복구"를,
        지금 바로 지우려면 체크한 뒤 "완전 삭제"를 누르세요.
      </div>
      {memos.length === 0 && <div className="empty">휴지통이 비어 있습니다</div>}
      {memos.length > 0 && (
        <div className="trash-selbar">
          <label className="trash-selall">
            <input
              type="checkbox"
              className="trash-check"
              checked={allSel}
              onChange={() => setSel(allSel ? [] : memos.map((m) => m.id))}
            />
            전체 선택
          </label>
          {sel.length > 0 && (
            <>
              <button onClick={restoreSelected}>복구 {sel.length}개</button>
              <button className="btn-danger" onClick={purgeSelected}>완전 삭제 {sel.length}개</button>
            </>
          )}
        </div>
      )}
      {memos.map((m) => {
        const left = Math.max(
          0,
          30 - Math.floor((Date.now() - new Date(m.updatedAt).getTime()) / 86400000)
        )
        return (
          <div className="row" key={m.id} onClick={() => toggle(m.id)}>
            <input
              type="checkbox"
              className="trash-check"
              checked={sel.includes(m.id)}
              onChange={() => toggle(m.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="row-title">{m.title}</span>
            <span className="trash-meta">
              삭제 {fmtDate(m.updatedAt.slice(0, 10))} · {left}일 남음
            </span>
            <button onClick={(e) => { e.stopPropagation(); restoreMemos([m.id]) }}>복구</button>
          </div>
        )
      })}
    </div>
  )
}
