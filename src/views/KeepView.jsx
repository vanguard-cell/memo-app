import { updateMemo } from '../store'
import { fmtDate } from '../derive'
import { todayStr } from '../parser'

// 보관함 — 날짜 없이 넣어둔 메모(keep)를 모아 보는 곳. 보드·달력에는 안 나오고 검색에만 걸리던 것을
// 여기서 직접 훑어볼 수 있다. 줄을 누르면 상세(진행기록)가 열리고, "꺼내기"로 오늘 할 일로 보낸다.
export default function KeepView({ memos, onOpen, onClose, renderDetail }) {
  const list = [...memos].sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1))
  return (
    <div className="view">
      <div className="trash-head">
        <b>보관함</b>
        <span className="kb-count">{list.length}</span>
        <button className="pill" onClick={onClose}>닫기</button>
      </div>
      <div className="trash-note">
        날짜 없이 넣어둔 메모들입니다. 보드·달력에는 안 보이고 검색에는 걸립니다. 줄을 누르면
        내용·진행기록이 열리고, "꺼내기"를 누르면 오늘 할 일로 나갑니다.
      </div>
      {list.length === 0 && <div className="empty">보관함이 비어 있습니다</div>}
      {list.map((m) => {
        const d = renderDetail ? renderDetail(m.id) : null
        if (d) return <div key={m.id}>{d}</div>
        return (
          <div className="row" key={m.id} onClick={() => onOpen(m.id)}>
            <span className="row-title">{m.title}</span>
            <span className="trash-meta">넣음 {fmtDate(m.createdAt.slice(0, 10))}</span>
            <button
              title="보관에서 꺼내 오늘 할 일로 보냅니다"
              onClick={(e) => {
                e.stopPropagation()
                updateMemo(m.id, { keep: false, due: todayStr() })
              }}
            >
              꺼내기
            </button>
          </div>
        )
      })}
    </div>
  )
}
