import { addWorkHistory, toggleWorkHistory, updateWorkHistory, removeWorkHistory, attachFile, detachFile } from '../store'
import { fmtDate } from '../derive'
import { hasSupabase } from '../supabase'
import Timeline from './Timeline'
import FileSection from './FileSection'

export default function WorkDetail({ work, onClose }) {
  const meta = [work.cycle, work.owner, work.evidence && `증빙: ${work.evidence}`]
    .filter(Boolean)
    .join(' · ')
  return (
    <aside className="detail">
      <div className="panel-head">
        <span className="work-area">{work.area || '점검'}</span>
        <span className="panel-title">
          {work.title}
          {work.risk && <b className="t-red"> ★</b>}
        </span>
        <button className="x" onClick={onClose} aria-label="닫기">×</button>
      </div>
      <div className="panel-meta">
        {meta && <span className="meta-date">{meta}</span>}
      </div>
      <Timeline
        history={work.history || []}
        onAdd={(t, d) => addWorkHistory(work.id, t, d)}
        onToggle={(i) => toggleWorkHistory(work.id, i)}
        onUpdate={(i, p) => updateWorkHistory(work.id, i, p)}
        onRemove={(i) => removeWorkHistory(work.id, i)}
      />
      {hasSupabase && (
        <FileSection
          files={work.files || []}
          onAttach={(f) => attachFile(work.id, f)}
          onRemove={(p) => detachFile(work.id, p)}
        />
      )}
      <div className="panel-foot">
        월별 완료 체크는 점검 표에서 · 여기는 과정 기록
        {work.createdAt && ` · 등록 ${fmtDate(work.createdAt.slice(0, 10))}`}
      </div>
    </aside>
  )
}
