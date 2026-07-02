import { useState } from 'react'
import { sendLoginLink, signInWithGoogle } from '../store'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showEmail, setShowEmail] = useState(false)

  async function google() {
    setError(null)
    const err = await signInWithGoogle()
    if (err) setError(err)
  }

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
        <button className="google-btn" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Google로 로그인
        </button>
        <p className="login-desc small">
          한 번 로그인하면 이 기기에서 계속 유지됩니다.
        </p>
        {!showEmail && (
          <button className="linkish" onClick={() => setShowEmail(true)}>
            이메일 링크로 로그인
          </button>
        )}
        {showEmail && !sent && (
          <>
            <input
              type="email"
              value={email}
              placeholder="이메일 주소"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <button className="btn-save login-btn" onClick={submit} disabled={busy}>
              {busy ? '보내는 중...' : '로그인 링크 보내기'}
            </button>
          </>
        )}
        {showEmail && sent && (
          <p className="login-desc">
            <b>{email.trim()}</b> 로 링크를 보냈습니다.
            <br />
            메일함에서 링크를 누르면 이 앱이 열립니다. (스팸함도 확인)
          </p>
        )}
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  )
}
