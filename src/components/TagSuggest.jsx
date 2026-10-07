import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { knownTags } from '../store'
import useIsNarrow from '../useIsNarrow'

// 제목 앞머리 고르기 — **"[" 한 글자가 메뉴다** (2026-10-07 사용자: "매번 타이핑하긴 싫고
// 선택해서 넣는것도 번거롭단 말이지?").
//
// 고정 목록(드롭다운)을 두지 않는 이유: 백업을 보면 손으로 쓴 말머리가 [미팅]·[회의록]·
// [방문예약]·[구매]·[기안]… 열네 가지가 **한 번씩** 나온다. 말이 계속 늘어나는 구조라
// 미리 정해둔 목록은 금방 안 맞는다. 그래서 **이미 쓴 말을 그대로** 보여주고, 없는 말은
// 그냥 타이핑하면 다음부터 목록에 올라온다 — 설정 화면도, 관리할 목록도 없다.
//
// 말머리는 **그냥 제목 글자**다(새 필드·새 개념 아님). 그래서 검색·달력·엑셀·루틴 회차와
// 생김새가 그대로 같고, 고치려면 제목을 고치면 끝이다.
export function useTagSuggest(apply, elRef) {
  // q = null이면 닫힘. 문자열이면 "[" 뒤에 지금까지 친 글자
  const [q, setQ] = useState(null)
  const [sel, setSel] = useState(0)
  const [start, setStart] = useState(0) // 그 "["의 자리

  const all = q === null ? [] : knownTags()
  const hit = q ? all.filter((t) => t.toLowerCase().includes(q.toLowerCase())) : all
  const list = hit.slice(0, 8)

  const close = () => {
    setQ(null)
    setSel(0)
  }

  // 커서 **앞쪽**에 닫히지 않은 "["가 있으면 그 뒤를 검색어로 본다.
  // 이미 [전표]처럼 닫힌 말머리를 지나 다른 데를 고칠 때는 안 뜬다.
  function read(el) {
    if (!el) return close()
    const caret = el.selectionStart ?? el.value.length
    const g = /\[([^\][\n]*)$/.exec(el.value.slice(0, caret))
    if (!g) return close()
    setStart(caret - g[0].length)
    setQ(g[1])
    setSel(0)
  }

  // 고른 말머리를 "["부터 커서까지와 바꾼다. 뒤에 공백을 안 붙이는 건 사용자의 지금
  // 표기가 "[전표]나성타운…"이기 때문 — 바로 이어서 제목을 치면 된다.
  function pick(tag) {
    const el = elRef.current
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    const head = `[${tag}]`
    apply(el.value.slice(0, start) + head + el.value.slice(caret))
    close()
    const pos = start + head.length
    requestAnimationFrame(() => {
      if (!elRef.current) return
      elRef.current.focus()
      elRef.current.setSelectionRange(pos, pos)
    })
  }

  // 폰 칩 — 빈 칸에 말머리부터 넣고 시작한다
  function prefix(tag) {
    const el = elRef.current
    const head = `[${tag}]`
    apply(head + (el ? el.value : ''))
    close()
    requestAnimationFrame(() => {
      if (!elRef.current) return
      elRef.current.focus()
      elRef.current.setSelectionRange(head.length, head.length)
    })
  }

  // 돌려주는 값이 true면 그 키는 목록이 먹은 것 — 부르는 쪽은 자기 처리를 건너뛴다
  function onKeyDown(e) {
    if (q === null || !list.length) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : list.length - 1
      setSel((s) => (s + d) % list.length)
      return true
    }
    // 한글 조합 중 Enter는 글자를 맺는 것 — 제목 칸·진행사항 칸과 같은 규칙 (2026-08-06)
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
      e.preventDefault()
      pick(list[sel])
      return true
    }
    return false
  }

  return { q, sel, list, read, close, pick, prefix, onKeyDown, elRef }
}

// 입력칸 바로 아래 목록. **화면 맨 위(body)에 띄운다** — 달력의 날짜 목록(.cal-detail)과
// 상세 패널은 스크롤 상자라, 그 안에 두면 상자 끝에서 목록이 잘린다(2026-10-07 실제로 두 줄만
// 보였다). 자리는 입력칸의 위치에서 그때그때 계산한다 — 글자를 칠 때마다 다시 그려지므로
// 따라다닌다. 화면을 스크롤하면 자리가 어긋나므로 그냥 닫는다.
// 누를 때 onMouseDown인 이유: click은 blur 뒤라 목록이 이미 닫혀 있다.
// ⚠️ 넓은 화면의 배율 보정(body zoom)만큼 좌표를 나눠야 한다 — 그 자리가 이미 배율이 먹은
// 값이라, 안 나누면 배율이 두 번 먹어 목록이 오른쪽 아래로 밀린다.
export function TagList({ ctl }) {
  const open = ctl.q !== null && ctl.list.length > 0
  useEffect(() => {
    if (!open) return
    const close = () => ctl.close()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, ctl])
  const el = ctl.elRef.current
  if (!open || !el) return null
  const r = el.getBoundingClientRect()
  const z = Number(getComputedStyle(document.body).zoom) || 1
  // 아래가 좁으면(폰에서 칸이 화면 아래쪽에 있을 때) 위로 펼친다 — 안 그러면 화면 밖으로 나간다
  const up = r.bottom + 248 > window.innerHeight && r.top > window.innerHeight - r.bottom
  const style = up
    ? { position: 'fixed', left: Math.round(r.left / z), bottom: Math.round((window.innerHeight - r.top + 4) / z) }
    : { position: 'fixed', left: Math.round(r.left / z), top: Math.round((r.bottom + 4) / z) }
  return createPortal(
    <div className="tag-list" style={style}>
      {ctl.list.map((t, n) => (
        <button
          key={t}
          className={'tag-item' + (n === ctl.sel ? ' on' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            ctl.pick(t)
          }}
        >
          [{t}]
        </button>
      ))}
    </div>,
    document.body
  )
}

// 폰에서만 뜨는 최근 말머리 칩 — 폰은 "[" 치는 것도 일이라 한 번 탭으로 넣는다.
// 칸이 비어 있을 때만 (쓰는 중에 밑에서 자리를 먹지 않게).
export function TagChips({ ctl, show }) {
  const narrow = useIsNarrow()
  const tags = narrow && show ? knownTags(4) : []
  if (!tags.length) return null
  return (
    <div className="tag-chips">
      {tags.map((t) => (
        <button
          key={t}
          className="tag-chip"
          onMouseDown={(e) => {
            e.preventDefault()
            ctl.prefix(t)
          }}
        >
          [{t}]
        </button>
      ))}
    </div>
  )
}
