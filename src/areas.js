// 분야 (2026-11-06, 보고서 중간점검) — 모든 메모를 업무 구역으로 나눈다.
// 주간보고의 구역과 같은 이름을 써서, 보고서·대장·연간실적이 같은 기준으로 묶이게 한다.
// "개인"은 업무가 아닌 것 — 보고서와 업무 거르기에서 빠진다.
// 저장은 id(영문)로, 화면엔 이름으로. 이름을 바꿔도 데이터는 그대로다.
export const AREAS = [
  ['safety', '안전보건'],
  ['fire', '소방'],
  ['facility', '시설'],
  ['dorm', '기숙사'],
  ['car', '차량'],
  ['admin', '총무'],
  ['personal', '개인'],
]

export const AREA_LABEL = Object.fromEntries(AREAS)
export const isArea = (a) => !!AREA_LABEL[a]

// ---------- 분야 추정 ----------
// 1) 제목이 비슷한 옛 메모의 분야를 따른다 — 글자 두 개씩 끊어(바이그램) 겹치는 수로 본다.
//    한글은 띄어쓰기가 들쭉날쭉해서("공장기숙사"/"공장 기숙사") 낱말보다 두 글자 조각이 잘 맞는다.
// 2) 비슷한 메모가 없으면 일반 업무 낱말로 정한다.
// 3) 그래도 모르면 비워 둔다(미분류) — 억지로 넣지 않는다.
// ⚠️ 공개 저장소다 — 개인 일정 낱말(집·청약 같은 것)을 여기에 적지 말 것. 개인 분야는 1)로만 배운다.

// 일하는 방식을 뜻하는 말 — 분야를 가리지 않으니 겹쳐도 세지 않는다
const STOP = [
  '확인', '문의', '진행', '요청', '기안', '전표', '방문', '예정', '준비', '완료', '관련', '처리',
  '작성', '신청', '전화', '연락', '공유', '등록', '보고', '회신', '메일', '오전', '오후', '내일',
  '오늘', '업체', '계약', '견적', '결재', '정산', '일정', '점검', '월분',
]

function grams(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ') // 말머리([전표] 등)는 분야를 안 가린다
    .replace(/\d+/g, ' ')
  const out = new Set()
  for (const w of s.split(/[^0-9a-z가-힣]+/)) {
    if (w.length < 2) continue
    for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2))
  }
  for (const st of STOP) out.delete(st)
  return out
}

const RULES = [
  ['fire', /소방|소화|경보|감지기|화재|자위|방재|피난|119/],
  ['dorm', /기숙사|숙소|월세|호실|임대차|가스요금|전기요금|공과금|입실|퇴실/],
  ['car', /차량|봉고|스타리아|주유|유류비|요소수|자동차|종합검사|정기검사|타이어/],
  ['safety', /안전|보건|위험성|msds|관리감독자|건강검진|건강상담|산업|유해|근골격|특별교육|지게차|보호구/],
  ['facility', /승강기|엘베|엘리베이터|e\/v|전기|누전|전등|led|에어컨|휀|배관|저수조|기계설비|보수|수리|교체|고장|누수|물새|버너|가스레인지|화장실|소변기|비데|시설|설비/],
  ['admin', /공장등록|공단|인허가|오폐수|등기|법인|구매|식수|식당|우편|공지|비품|소모품|출장|외근|연차|반차|휴가/],
]

// samples: [{ grams:Set, area }] — 사용자가 정했거나 정리 파일로 들어온 분야만 넣는다(자동 추정은 안 넣는다)
// 점수 = 분야마다 가장 비슷한 메모의 (겹친 조각²/합친 조각 수), 일반 낱말이 맞으면 그 분야에 0.5점을 더한다.
// 조각이 우연히 두 개 겹친 것("정부24업로드" ~ "소방교육 업로드")은 내 제목의 3분의 1이 안 되면 버린다.
export function guessArea(text, samples) {
  const g = grams(text)
  const score = {}
  if (g.size) {
    for (const s of samples) {
      let shared = 0
      for (const x of g) if (s.grams.has(x)) shared++
      if (!shared) continue
      const full = shared === g.size // 짧은 제목이 통째로 들어 있다 ("식수" = "식수")
      if (!full && (shared < 2 || shared / g.size < 0.34)) continue
      // 분야마다 가장 비슷한 메모 하나만 본다 — 더하면 약하게 겹치는 메모가 많은 분야가 이긴다
      // ("기숙사동 소방경보" 여러 건 때문에 "사외 기숙사 임대 만기"가 소방으로 가던 것)
      const v = (shared * shared) / (g.size + s.grams.size - shared)
      if (!(score[s.area] >= v)) score[s.area] = v
    }
  }
  const low = String(text || '').toLowerCase()
  for (const [a, re] of RULES) if (re.test(low)) score[a] = (score[a] || 0) + 0.5
  let best = null
  for (const [a, v] of Object.entries(score)) if (!best || v > score[best]) best = a
  return best
}

export const areaSample = (text, area) => ({ grams: grams(text), area })
