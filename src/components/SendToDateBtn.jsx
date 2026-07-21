import { useRef } from 'react'

// 날짜 선택 버튼 — 숨긴 date input의 달력을 열어 고른 날짜를 onPick으로 넘긴다.
// 오늘 탭 "날짜로", 달력 상세의 "이동"이 같이 쓴다. (폰에서도 동작)
export default function SendToDateBtn({ label = '날짜 지정', min, max, onPick, className }) {
  const ref = useRef(null)
  return (
    <span className="nag-datewrap" onClick={(e) => e.stopPropagation()}>
      <button
        className={className}
        onClick={() => {
          const el = ref.current
          if (!el) return
          el.value = ''
          try {
            el.showPicker()
          } catch {
            el.focus()
          }
        }}
      >
        {label}
      </button>
      <input
        ref={ref}
        type="date"
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => e.target.value && onPick(e.target.value)}
      />
    </span>
  )
}
