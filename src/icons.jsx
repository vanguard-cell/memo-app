// 공용 스트로크 아이콘 (2026-07-31) — 사이드바 메뉴와 상세 액션 줄이 같은 그림 언어를 쓴다.
// 보류=일시정지, 보관=상자, 삭제=휴지통: 버튼을 누르면 어디로 가는지 그림이 그대로 말해준다.
export const ic = (path) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
)

export const ICONS = {
  memo: ic(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  hold: ic(<><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>),
  keep: ic(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>),
  trash: ic(<><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></>),
  backup: ic(<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.1 8.5 4.5 4.5 0 0 0 6.5 19Z" />),
  // 루틴 = 돌아오는 화살표. 매달·해마다 같은 자리로 돌아오는 일 (2026-08-11)
  routine: ic(<><path d="M4 10a8 8 0 0 1 13.7-5.7L20 6" /><path d="M20 3v3h-3" /><path d="M20 14a8 8 0 0 1-13.7 5.7L4 18" /><path d="M4 21v-3h3" /></>),
  restore: ic(<><path d="M12 21V9" /><path d="M8 13l4-4 4 4" /><path d="M4 5h16" /></>),
  out: ic(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>),
  check: ic(<path d="M4 12l6 6L20 6" />),
  undo: ic(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></>),
  next: ic(<><path d="M5 12h13" /><path d="M12 6l6 6-6 6" /></>),
  calendar: ic(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M16 3v4M8 3v4M4 11h16" /></>),
  flag: ic(<><path d="M5 21V4" /><path d="M5 4c4-2 6 2 10 0v9c-4 2-6-2-10 0" /></>),
  flagOff: ic(<><path d="M5 21V4" /><path d="M5 4c4-2 6 2 10 0v9c-4 2-6-2-10 0" /><path d="M3 3l18 18" /></>),
  chevronR: ic(<path d="M9 6l6 6-6 6" />),
}
