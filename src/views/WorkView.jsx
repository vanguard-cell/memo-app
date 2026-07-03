import { useState } from 'react'
import { addWork, updateWork, deleteWork, toggleWorkRun, seedWorks } from '../store'
import { WORK_SEED } from '../workSeed'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function ymOf(year, m) {
  return `${year}-${String(m).padStart(2, '0')}`
}

const EMPTY_FORM = { area: '', title: '', cycle: '', owner: '', evidence: '', risk: false, months: [] }

function WorkForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial)
  const set = (k, v) => setF((cur) => ({ ...cur, [k]: v }))
  const toggleMonth = (m) =>
    setF((cur) => ({
      ...cur,
      months: cur.months.includes(m) ? cur.months.filter((x) => x !== m) : [...cur.months, m].sort((a, b) => a - b),
    }))
  return (
    <div className="work-form">
      <div className="work-form-grid">
        <label>
          분야
          <input value={f.area} onChange={(e) => set('area', e.target.value)} placeholder="예: 소방" />
        </label>
        <label className="wf-wide">
          업무
          <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 작동/종합점검" />
        </label>
        <label>
          주기
          <input value={f.cycle} onChange={(e) => set('cycle', e.target.value)} placeholder="예: 연1회" />
        </label>
        <label>
          담당(외주)
          <input value={f.owner} onChange={(e) => set('owner', e.target.value)} />
        </label>
        <label>
          증빙자료
          <input value={f.evidence} onChange={(e) => set('evidence', e.target.value)} />
        </label>
      </div>
      <div className="work-form-months">
        <span className="wf-label">시행 월</span>
        {MONTHS.map((m) => (
          <button
            key={m}
            className={'wf-month' + (f.months.includes(m) ? ' on' : '')}
            onClick={() => toggleMonth(m)}
          >
            {m}
          </button>
        ))}
        <label className="wf-risk">
          <input type="checkbox" checked={f.risk} onChange={(e) => set('risk', e.target.checked)} />
          ★ 과태료 리스크
        </label>
      </div>
      <div className="work-form-actions">
        <button
          className="btn-done"
          onClick={() => {
            if (!f.title.trim()) return
            onSave({ ...f, title: f.title.trim(), area: f.area.trim() })
          }}
        >
          저장
        </button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}

export default function WorkView({ works }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [editId, setEditId] = useState(null) // work id | 'new' | null
  const curYm = ymOf(now.getFullYear(), now.getMonth() + 1)

  const scheduled = works.filter((w) => (w.months || []).length > 0)
  const asNeeded = works.filter((w) => (w.months || []).length === 0)

  if (works.length === 0) {
    return (
      <div className="view">
        <div className="empty">
          안전관리 점검 캘린더가 비어 있습니다.
          <br />
          <button className="btn-done seed-btn" onClick={() => seedWorks(WORK_SEED)}>
            전임자 연간 캘린더 불러오기 (22건)
          </button>
          <button className="seed-btn" onClick={() => setEditId('new')}>직접 추가</button>
        </div>
        {editId === 'new' && (
          <WorkForm
            initial={EMPTY_FORM}
            onSave={(f) => { addWork(f); setEditId(null) }}
            onCancel={() => setEditId(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="view">
      <div className="work-head">
        <span className="work-title">안전관리 점검 캘린더</span>
        <span className="work-year">
          <button onClick={() => setYear(year - 1)}>‹</button>
          <b>{year}년</b>
          <button onClick={() => setYear(year + 1)}>›</button>
        </span>
        <span className="work-legend">O 예정 · <b className="t-teal">✓ 완료</b> · <b className="t-red">! 지남</b> · <b className="t-red">★</b> 과태료</span>
        <button onClick={() => setEditId('new')}>+ 업무 추가</button>
      </div>

      {editId === 'new' && (
        <WorkForm
          initial={EMPTY_FORM}
          onSave={(f) => { addWork(f); setEditId(null) }}
          onCancel={() => setEditId(null)}
        />
      )}

      <div className="work-scroll">
        <table className="work-table">
          <thead>
            <tr>
              <th>분야</th>
              <th className="wt-title">업무</th>
              <th>주기</th>
              <th>담당</th>
              <th>증빙</th>
              {MONTHS.map((m) => (
                <th key={m} className={'wt-m' + (ymOf(year, m) === curYm ? ' wt-now' : '')}>{m}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scheduled.map((w) =>
              editId === w.id ? (
                <tr key={w.id}>
                  <td colSpan={18}>
                    <WorkForm
                      initial={{ area: w.area, title: w.title, cycle: w.cycle, owner: w.owner, evidence: w.evidence, risk: w.risk, months: w.months || [] }}
                      onSave={(f) => { updateWork(w.id, f); setEditId(null) }}
                      onCancel={() => setEditId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={w.id}>
                  <td><span className="work-area">{w.area}</span></td>
                  <td className="wt-title">
                    {w.title}
                    {w.risk && <b className="t-red"> ★</b>}
                  </td>
                  <td className="wt-sub">{w.cycle}</td>
                  <td className="wt-sub">{w.owner}</td>
                  <td className="wt-sub">{w.evidence}</td>
                  {MONTHS.map((m) => {
                    const ym = ymOf(year, m)
                    const nowCol = ym === curYm ? ' wt-now' : ''
                    if (!(w.months || []).includes(m)) return <td key={m} className={'wt-m' + nowCol} />
                    const done = !!(w.runs && w.runs[ym] && w.runs[ym].done)
                    const overdue = !done && ym < curYm
                    return (
                      <td key={m} className={'wt-m' + nowCol}>
                        <button
                          className={'wt-cell' + (done ? ' c-done' : overdue ? ' c-over' : '')}
                          title={done ? `완료 (${w.runs[ym].at || ''}) — 누르면 취소` : overdue ? '지남 — 누르면 완료' : '예정 — 누르면 완료'}
                          onClick={() => toggleWorkRun(w.id, ym)}
                        >
                          {done ? '✓' : overdue ? '!' : 'O'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="wt-edit">
                    <button className="wt-mini" onClick={() => setEditId(w.id)}>수정</button>
                    <button
                      className="wt-mini t-red"
                      onClick={() => {
                        if (window.confirm(`"${w.title}" 업무를 삭제할까요? (완료 기록도 함께 삭제)`)) deleteWork(w.id)
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {asNeeded.length > 0 && (
        <div className="work-asneeded">
          <div className="sec-title">수시 · 조건부 (달력 칸 없음)</div>
          {asNeeded.map((w) =>
            editId === w.id ? (
              <WorkForm
                key={w.id}
                initial={{ area: w.area, title: w.title, cycle: w.cycle, owner: w.owner, evidence: w.evidence, risk: w.risk, months: w.months || [] }}
                onSave={(f) => { updateWork(w.id, f); setEditId(null) }}
                onCancel={() => setEditId(null)}
              />
            ) : (
              <div key={w.id} className="work-row">
                <span className="work-area">{w.area}</span>
                <span>{w.title}{w.risk && <b className="t-red"> ★</b>}</span>
                <span className="wt-sub">{w.cycle} · {w.evidence}</span>
                <span className="wt-edit">
                  <button className="wt-mini" onClick={() => setEditId(w.id)}>수정</button>
                  <button
                    className="wt-mini t-red"
                    onClick={() => {
                      if (window.confirm(`"${w.title}" 업무를 삭제할까요?`)) deleteWork(w.id)
                    }}
                  >
                    삭제
                  </button>
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
