import { restoreMemo } from '../store'
import { fmtDate } from '../derive'

// 휴지통 — 삭제한 메모가 30일 보관되는 곳. 복구하면 원래 자리로 돌아온다.
// 30일이 지나면 동기화 때 자동으로 완전히 삭제된다 (store의 톰스톤 정리 규칙).
export default function TrashView({ memos, onClose }) {
  return (
    <div className="view">
      <div className="trash-head">
        <b>휴지통</b>
        <span className="kb-count">{memos.length}</span>
        <button className="pill" onClick={onClose}>닫기</button>
      </div>
      <div className="trash-note">
        삭제한 메모는 여기에 30일 보관된 뒤 자동으로 완전히 삭제됩니다. 실수로 지웠다면 "복구"를 누르세요.
      </div>
      {memos.length === 0 && <div className="empty">휴지통이 비어 있습니다</div>}
      {memos.map((m) => {
        const left = Math.max(
          0,
          30 - Math.floor((Date.now() - new Date(m.updatedAt).getTime()) / 86400000)
        )
        return (
          <div className="row" key={m.id}>
            <span className="row-title">{m.title}</span>
            <span className="trash-meta">
              삭제 {fmtDate(m.updatedAt.slice(0, 10))} · {left}일 남음
            </span>
            <button onClick={() => restoreMemo(m.id)}>복구</button>
          </div>
        )
      })}
    </div>
  )
}
