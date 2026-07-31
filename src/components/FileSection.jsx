import { useEffect, useRef, useState } from 'react'
import { uploadFile, fileUrl, removeStoredFile, isImageFile } from '../files'

const fmtSize = (n) =>
  n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'

const pad2 = (n) => String(n).padStart(2, '0')

// 상세 하단 파일 칸 (2026-07-31 부활·확장) — 올리는 길 셋: [+ 올리기]·끌어놓기·캡처 붙여넣기(Ctrl+V).
// 이미지는 썸네일 미리보기, 이름·썸네일 클릭 = 새 탭에서 크게, 다운로드는 원본 이름으로.
export default function FileSection({ files = [], onAttach, onRemove }) {
  const inputRef = useRef()
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState(null)
  const [thumbs, setThumbs] = useState({}) // path → 서명 URL (1시간짜리 — 다시 열면 새로 받음)

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
      // "Failed to fetch" = 서버 응답조차 못 받음 — 회사망 보안장비가 브라우저 업로드를
      // 차단하는 경우가 대표적 (2026-07-31 회사 PC에서 확인). 폰·집에서는 정상.
      const msg = /Failed to fetch/i.test(e.message || '')
        ? '네트워크가 업로드를 차단한 것 같습니다 (회사망 보안 정책일 수 있음) — 폰이나 집에서 다시 시도해 보세요'
        : e.message || '알 수 없는 오류'
      setError('업로드 실패: ' + msg)
    }
    setBusy(false)
  }

  // 캡처 붙여넣기 — 클립보드에 파일(이미지)이 있을 때만 가로챈다. 글자 붙여넣기는 안 건드림.
  // 캡처는 이름이 "image.png"로 오므로 "캡처 MMDD-HHmm"으로 바꿔 언제 찍은 건지 남긴다.
  useEffect(() => {
    const onPaste = (e) => {
      const fs = [...((e.clipboardData && e.clipboardData.files) || [])]
      if (!fs.length) return
      e.preventDefault()
      const d = new Date()
      const stamp = `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
      const named = fs.map((f, i) => {
        if (f.name && f.name !== 'image.png') return f
        const ext = ((f.type.split('/')[1] || 'png')).replace('jpeg', 'jpg')
        return new File([f], `캡처 ${stamp}${i ? '-' + (i + 1) : ''}.${ext}`, { type: f.type })
      })
      uploadFiles(named)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 이미지 첨부의 썸네일 URL을 받아온다 — 실패하면(만료·삭제) 썸네일만 생략
  useEffect(() => {
    let stop = false
    ;(async () => {
      for (const f of files) {
        if (!isImageFile(f) || thumbs[f.path]) continue
        try {
          const url = await fileUrl(f.path)
          if (!stop) setThumbs((t) => ({ ...t, [f.path]: url }))
        } catch (e) {
          console.error('썸네일 실패', e)
        }
      }
    })()
    return () => {
      stop = true
    }
  }, [files]) // eslint-disable-line react-hooks/exhaustive-deps

  async function open(f) {
    try {
      window.open(await fileUrl(f.path), '_blank')
    } catch {
      setError('파일을 여는 데 실패했습니다')
    }
  }

  async function download(f) {
    try {
      const a = document.createElement('a')
      a.href = await fileUrl(f.path, f.name)
      a.click()
    } catch {
      setError('다운로드에 실패했습니다')
    }
  }

  async function remove(f) {
    if (!window.confirm(`"${f.name}" 파일을 삭제할까요? 되돌릴 수 없습니다.`)) return
    try {
      await removeStoredFile(f.path)
    } catch (e) {
      console.error('저장소 삭제 실패', e) // 이미 없어도 목록에서는 뗀다
    }
    onRemove(f.path)
  }

  const images = files.filter(isImageFile)
  const docs = files.filter((f) => !isImageFile(f))

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
      <div className="panel-sec-label">
        파일{files.length > 0 && <span className="file-count"> · {files.length}</span>}
        <button className="file-add" onClick={() => inputRef.current.click()} disabled={busy}>
          {busy ? '올리는 중…' : '+ 올리기'}
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
      {files.length === 0 && (
        <div className="file-hint">파일을 끌어다 놓거나, 캡처를 붙여넣거나(Ctrl+V), [+ 올리기]</div>
      )}
      {images.length > 0 && (
        <div className="file-thumbs">
          {images.map((f) => (
            <div key={f.path} className="file-thumb" title={`${f.name} · ${fmtSize(f.size)}`}>
              {thumbs[f.path] ? (
                <img src={thumbs[f.path]} alt={f.name} onClick={() => open(f)} />
              ) : (
                <span className="file-thumb-empty" onClick={() => open(f)}>
                  이미지
                </span>
              )}
              <div className="file-thumb-bar">
                <span className="file-thumb-name" onClick={() => open(f)}>
                  {f.name}
                </span>
                <button title="다운로드" onClick={() => download(f)}>
                  ⭳
                </button>
                <button className="chip-x" title="삭제" onClick={() => remove(f)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {docs.map((f) => (
        <div key={f.path} className="file-row">
          <button className="file-name" onClick={() => open(f)} title="새 탭에서 미리보기">
            {f.name}
          </button>
          <span className="file-size">{fmtSize(f.size)}</span>
          <button className="file-dl" title="원본 이름으로 내려받기" onClick={() => download(f)}>
            다운로드
          </button>
          <button className="chip-x" onClick={() => remove(f)} aria-label="파일 삭제">
            ×
          </button>
        </div>
      ))}
      {error && <div className="file-error">{error}</div>}
    </div>
  )
}
