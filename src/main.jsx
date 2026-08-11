import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// 앱 전체를 감싼다 — 여기까지 오면 앱이 통째로 못 뜬 것이라, 하얀 화면 대신
// 사정과 빠져나갈 길(새로고침·백업 받기)을 보여준다 (2026-08-11)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary whole>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
