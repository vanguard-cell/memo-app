import { useState } from 'react'
import { sendLoginLink } from '../store'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const e = email.trim()
    if (!e || busy) return
    setBusy(true)
    setError(null)
    const err = await sendLoginLink(e)
    setBusy(false)
    if (err) setError(err)
    else setSent(true)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">내 기록</div>
        {!sent ? (
          <>
            <p className="login-desc">
              이메일 주소를 넣으면 로그인 링크를 보내드립니다.
              <br />
              비밀번호는 없습니다 — 메일의 링크를 누르면 바로 시작됩니다.
            </p>
            <input
              type="email"
              value={email}
              placeholder="이메일 주소"
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <button className="btn-save login-btn" onClick={submit} disabled={busy}>
              {busy ? '보내는 중...' : '로그인 링크 보내기'}
            </button>
            {error && <p className="login-error">{error}</p>}
          </>
        ) : (
          <p className="login-desc">
            <b>{email.trim()}</b> 로 링크를 보냈습니다.
            <br />
            메일함에서 링크를 누르면 이 앱이 열립니다. (스팸함도 확인)
          </p>
        )}
      </div>
    </div>
  )
}
