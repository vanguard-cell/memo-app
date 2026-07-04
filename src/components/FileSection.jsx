import { useRef, useState } from 'react'
import { supabase } from '../supabase'
import { uploadFile } from '../files'

const fmtSize = (n) =>
  n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'

export default function FileSection({ files = [], onAttach, onRemove }) {
  const inputRef = useRef()
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState(null)

  async function uploadFiles(fileList) {
    setError(null)
    setBusy(true)
    try {
      for (const f of fileList) {
        const meta = await uploadFile(f)
        if (meta) onAttach(meta)
      }
    } catch (e) {
      console.error('업로드 실패', e)
      setError('업로드 실패: ' + (e.message || '알 수 없는 오류'))
    }
    setBusy(false)
  }

  async function open(file) {
    const { data, error: err } = await supabase.storage.from('files').createSignedUrl(file.path, 3600)
    if (err) {
      setError('파일을 여는 데 실패했습니다')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function remove(file) {
    if (!window.confirm(`"${file.name}" 파일을 삭제할까요?`)) return
    await supabase.storage.from('files').remove([file.path])
    onRemove(file.path)
  }

  return (
    <div
      className={'filebox' + (drag ? ' drag' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files])
      }}
    >
      <div className="tl-title">
        파일
        <button className="file-add" onClick={() => inputRef.current.click()} disabled={busy}>
          {busy ? '올리는 중...' : '+ 올리기'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files.length) uploadFiles([...e.target.files])
          e.target.value = ''
        }}
      />
      {files.length === 0 && <div className="file-hint">여기로 파일을 끌어다 놓거나 [+ 올리기]</div>}
      {files.map((f) => (
        <div key={f.path} className="file-row">
          <button className="file-name" onClick={() => open(f)} title="새 창에서 열기">
            {f.name}
          </button>
          <span className="file-size">{fmtSize(f.size)}</span>
          <button className="chip-x" onClick={() => remove(f)} aria-label="파일 삭제">
            ×
          </button>
        </div>
      ))}
      {error && <div className="login-error">{error}</div>}
    </div>
  )
}
