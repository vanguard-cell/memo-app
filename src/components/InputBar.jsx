import { useMemo, useRef, useState } from 'react'
import { parse, todayStr } from '../parser'
import { addMemo, addHistory, updateMemo, attachFile } from '../store'
import { companies, fmtDate, fmtPeriod } from '../derive'
import { uploadFile } from '../files'
import { hasSupabase } from '../supabase'

function Chip({ cls, label, onX }) {
  return (
    <span className={'chip ' + cls}>
      {label}
      <button className="chip-x" onClick={onX} aria-label="인식 제거">×</button>
    </span>
  )
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)

// 캡처 붙여넣기의 기본 파일명(image.png 등)이면 제목으로 쓰기엔 무의미
const GENERIC_NAME = /^(image|img|screenshot|clipboard|스크린샷|캡처|photo|kakaotalk)/i

export default function InputBar({ memos, onOpen }) {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState({})
  const [confirming, setConfirming] = useState(false)
  const [flash, setFlash] = useState('')
  const [files, setFiles] = useState([]) // { file, url(이미지 미리보기) }
  const [dropping, setDropping] = useState(false)
  const fileInput = useRef(null)

  const known = useMemo(() => companies(memos), [memos])
  const parsed = useMemo(() => parse(text, known), [text, known])
  const eff = {
    due: removed.due ? null : parsed.due,
    period: removed.period ? null : parsed.period,
    company: removed.company ? null : parsed.company,
  }

  const candidate = useMemo(() => {
    if (!eff.company) return null
    return (
      memos
        .filter((m) => m.status !== 'done' && m.company === eff.company)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] || null
    )
  }, [memos, eff.company])

  function addFiles(list) {
    const arr = [...list].filter((f) => f && f.size > 0)
    if (!arr.length) return
    setFiles((cur) => [
      ...cur,
      ...arr.map((f) => ({
        file: f,
        url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })),
    ])
  }

  function removeFile(i) {
    setFiles((cur) => {
      if (cur[i]?.url) URL.revokeObjectURL(cur[i].url)
      return cur.filter((_, j) => j !== i)
    })
  }

  function reset() {
    setText('')
    setRemoved({})
    setConfirming(false)
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url))
    setFiles([])
  }

  function say(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3500)
  }

  function defaultTitle() {
    const f = files[0]
    if (!f) return '메모'
    const base = f.file.name.replace(/\.[^.]+$/, '')
    return GENERIC_NAME.test(base) ? '사진 메모' : base
  }

  async function uploadTo(id, pending) {
    if (!hasSupabase) return '저장했습니다 (파일은 로그인 상태에서만 올라갑니다)'
    try {
      for (const p of pending) {
        const meta = await uploadFile(p.file)
        if (meta) attachFile(id, meta)
      }
      return `저장했습니다 · 파일 ${pending.length}개 첨부됨`
    } catch (e) {
      console.error('파일 업로드 실패', e)
      return '메모는 저장됐지만 파일 업로드에 실패했습니다 — 메모를 열어 다시 올려주세요'
    }
  }

  async function saveNew() {
    const t = text.trim()
    if (!t && files.length === 0) return
    const dateAccepted = (parsed.period && !removed.period) || (parsed.due && !removed.due)
    const title = t ? (dateAccepted && parsed.cleaned ? parsed.cleaned : t) : defaultTitle()
    // 날짜가 없으면 오늘 기한으로 — 던진 순간부터 오늘 할 일로 들어간다
    const due = eff.due || (eff.period ? null : todayStr())
    const memo = addMemo({ title, ...eff, due })
    const pending = files
    setText('')
    setRemoved({})
    setConfirming(false)
    setFiles([])
    if (pending.length) {
      say(`저장 — 파일 ${pending.length}개 올리는 중…`)
      say(await uploadTo(memo.id, pending))
      pending.forEach((f) => f.url && URL.revokeObjectURL(f.url))
    } else {
      say('새 메모로 저장했습니다')
    }
  }

  async function attach() {
    const t = text.trim()
    if ((!t && files.length === 0) || !candidate) return
    if (t) addHistory(candidate.id, t, todayStr())
    const patch = {}
    if (eff.period) patch.period = eff.period
    else if (eff.due) patch.due = eff.due
    if (Object.keys(patch).length) updateMemo(candidate.id, patch)
    const id = candidate.id
    const pending = files
    setText('')
    setRemoved({})
    setConfirming(false)
    setFiles([])
    if (pending.length) {
      say(await uploadTo(id, pending))
      pending.forEach((f) => f.url && URL.revokeObjectURL(f.url))
    }
    onOpen(id)
  }

  function submit(shift) {
    if (!text.trim() && files.length === 0) return
    if (shift) return saveNew()
    if (confirming) return attach()
    if (candidate && text.trim()) return setConfirming(true)
    saveNew()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setConfirming(false)
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    submit(e.shiftKey)
  }

  function onPaste(e) {
    const pasted = e.clipboardData && e.clipboardData.files
    if (pasted && pasted.length > 0) {
      e.preventDefault()
      addFiles(pasted)
    }
  }

  const nothing = !eff.period && !eff.due && !eff.company

  return (
    <section
      className={'inputbar' + (dropping ? ' inputbar-drop' : '')}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      <div className="input-row">
        <input
          value={text}
          placeholder="여기에 그냥 던지세요 — 글·캡처 붙여넣기·파일 끌어놓기"
          onChange={(e) => {
            setText(e.target.value)
            setConfirming(false)
            if (!e.target.value.trim()) setRemoved({})
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button className="btn-file" onClick={() => fileInput.current && fileInput.current.click()} title="사진·파일 첨부">
          +파일
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button className="btn-save" onClick={() => submit(false)}>저장</button>
      </div>
      {files.length > 0 && (
        <div className="file-chips">
          {files.map((f, i) => (
            <span key={i} className="file-chip">
              {f.url ? (
                <img className="file-thumb" src={f.url} alt="" />
              ) : (
                <span className="file-thumb file-thumb-doc">파일</span>
              )}
              <span className="file-chip-name">{truncate(f.file.name, 22)}</span>
              <button className="chip-x" onClick={() => removeFile(i)} aria-label="첨부 제거">×</button>
            </span>
          ))}
          {!text.trim() && (
            <span className="chips-none">제목 없이 저장하면 "{defaultTitle()}"로 저장됩니다</span>
          )}
        </div>
      )}
      {text.trim() && (
        <div className="chips">
          <span className="chips-label">인식됨</span>
          {eff.period && (
            <Chip cls="chip-date" label={`기간 ${fmtPeriod(eff.period)}`} onX={() => setRemoved((r) => ({ ...r, period: true }))} />
          )}
          {eff.due && (
            <Chip cls="chip-date" label={`기한 ${fmtDate(eff.due)}`} onX={() => setRemoved((r) => ({ ...r, due: true }))} />
          )}
          {eff.company && (
            <Chip cls="chip-co" label={`업체 ${eff.company}`} onX={() => setRemoved((r) => ({ ...r, company: true }))} />
          )}
          {nothing && <span className="chips-none">날짜 인식 없음 — 오늘 할 일로 들어갑니다</span>}
        </div>
      )}
      {confirming && candidate && (
        <div className="attach-bar">
          <span>'{candidate.company}' 진행중 메모가 있습니다</span>
          <button className="btn-attach" onClick={attach}>
            → "{truncate(candidate.title, 24)}"에 이어붙이기 (Enter)
          </button>
          <button onClick={saveNew}>새 메모로 저장</button>
        </div>
      )}
      {flash && <div className="flash">{flash}</div>}
    </section>
  )
}
