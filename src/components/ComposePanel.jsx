import InputBar from './InputBar'

const STATUS_LABEL = { todo: '할일', active: '진행중', done: '완료' }

// 보드 칸의 + 를 누르면 우측에 뜨는 새 메모 작성 패널. 저장하면 그 칸(상태)으로 만들어지고
// 방금 만든 메모의 상세로 이어진다. (2026-07-24)
export default function ComposePanel({ status, onClose, onCreated, closing }) {
  return (
    <aside
      className={'detail compose-panel' + (closing ? ' detail-out' : '')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="panel-head">
        <span className={'badge st-' + status}>{STATUS_LABEL[status]}</span>
        <span className="panel-title">새 메모</span>
        <button className="x" onClick={onClose} aria-label="닫기" title="닫기">×</button>
      </div>
      <InputBar status={status} onSaved={onCreated} />
    </aside>
  )
}
