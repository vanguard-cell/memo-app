import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // 빌드 시각 — 진단 화면에서 "이 기기가 어느 버전을 실행 중인지" 확인용
    __BUILD__: JSON.stringify(
      new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    ),
  },
})
