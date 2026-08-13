// 「월간체크리스트」를 앱이 직접 읽어 루틴으로 만든다 (2026-08-11).
// 들어오는 길은 둘이고 읽는 규칙은 하나다:
//   ① 엑셀 파일(.xlsx) 고르기
//   ② 엑셀에서 범위를 복사해 붙여넣기 — 회사 보안 프로그램이 브라우저의 파일 읽기를
//      막는 곳에서도 되는 길 (2026-08-11 실제로 막혀서 추가)
//
// 읽는 표의 모양 (열 이름으로 찾으므로 순서가 바뀌어도, 숨긴 열이 있어도 된다):
//   구분 | 사업장 | 항목명 | 거래처 | 주기 | 기안양식 | 담당 | 1월…12월 | 비고
//   · 항목명 = 루틴 이름, 구분 = 묶음
//   · 사업장·거래처·기안양식·비고 = "매달 같은 설명" 한 줄로 합침
//     (거래처를 따로 칸으로 두지 않는 건 앱의 결정 — 업체는 개념이 아니라 검색어다)
//   · 1~12월 칸에 뭐라도 적혀 있으면(O 등) 그 달은 완료로 본다

const txt = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return String(v.text || v.result || '').trim()
  return String(v).trim()
}

// 열 이름은 엑셀마다 띄어쓰기·기호가 조금씩 다르다 ("발행 업체" / "발행업체", "기간/차수" / "기간·차수").
// 그래서 공백·괄호·가운뎃점·빗금을 떼고 견준다.
const norm = (s) => String(s || '').replace(/[\s()·/]/g, '')
const findCol = (head, names) => head.findIndex((h) => names.some((n) => norm(h) === norm(n)))

// 엑셀 날짜는 "2026-06-02" · "2026.6.2" · "26/6/2" 등으로 온다 (파일에서 읽으면 Date 객체).
// 전부 YYYY-MM-DD 한 모양으로 맞춘다. 못 읽으면 빈 문자열.
const pad2 = (n) => String(n).padStart(2, '0')
export function toDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  }
  const s = txt(v)
  const m = s.match(/(\d{2,4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/)
  if (!m) return ''
  let y = Number(m[1])
  if (y < 100) y += 2000
  return `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
}

// 표(글자 2차원 배열) → 루틴 줄들. 파일이든 붙여넣기든 여기서 만난다.
export function readRoutineGrid(grid, year) {
  const hi = grid.findIndex((row) => row.includes('항목명'))
  if (hi === -1) {
    throw new Error("'항목명' 열을 못 찾았습니다 — 머리줄(구분·항목명·담당…)까지 함께 복사했는지 확인해 주세요")
  }
  const head = grid[hi]
  const col = (name) => head.findIndex((h) => h === name)
  const C = {
    group: col('구분'),
    site: col('사업장'),
    title: col('항목명'),
    vendor: col('거래처'),
    form: col('기안양식'),
    who: col('담당'),
    note: col('비고'),
    // 엑셀에 '예정일' 열(숫자)을 두면 그대로 따라간다 — 없으면 앱 기본값(매월 5일)
    day: col('예정일'),
  }
  const monthCols = []
  for (let m = 1; m <= 12; m++) monthCols.push(col(m + '월'))

  const at = (row, i) => (i >= 0 ? row[i] || '' : '')
  const raw = []
  for (const row of grid.slice(hi + 1)) {
    const title = at(row, C.title)
    if (!title) continue
    const done = []
    monthCols.forEach((c, i) => {
      if (c >= 0 && at(row, c)) done.push(i + 1)
    })
    raw.push({
      title,
      group: at(row, C.group) || '기타',
      site: at(row, C.site),
      vendor: at(row, C.vendor),
      form: at(row, C.form),
      who: at(row, C.who),
      note: at(row, C.note),
      day: parseInt(at(row, C.day), 10) || null,
      done,
    })
  }
  if (!raw.length) throw new Error('표에서 항목을 하나도 못 읽었습니다')

  // 담당은 대부분 본인이라 이름을 다 적으면 설명이 지저분해진다 —
  // 가장 많이 나오는 담당(=나)은 생략하고, 다른 사람일 때만 "담당 ○○"으로 남긴다.
  const tally = {}
  for (const x of raw) if (x.who) tally[x.who] = (tally[x.who] || 0) + 1
  const main = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || ''

  return {
    year,
    rows: raw.map((x) => ({
      title: x.title,
      group: x.group,
      dueDay: x.day,
      desc: [x.site, x.vendor, x.form, x.note, x.who && x.who !== main ? `담당 ${x.who}` : '']
        .filter((s) => s && s !== '-')
        .join(' · '),
      done: x.done,
    })),
  }
}

// ---------- 문서 접수대장 → 그 달 회차의 기록 (2026-08-12) ----------
// 「월간체크리스트」가 "몇 월에 했나"의 표라면, 접수대장은 "언제 무엇을 받았나"의 표다.
// 같은 문서가 매달 돌아오므로(전기설비 점검결과 기록표 6월/1차·2차·3차) 루틴과 같은 것을 가리킨다.
//   문서명 = 루틴 이름 · 분야 = 묶음 · 보관 위치 = 설명
//   기간/차수의 "6월" = 어느 달 회차인지 (없으면 접수일의 달)
//   한 달에 여러 차수가 있으면 회차는 하나, 차수마다 진행기록 한 줄로 쌓는다
//     — 회차는 (루틴, 연월) 하나뿐이고, 그 달의 세부는 원래 상세에 쌓이는 구조라서.
export function readReceiptGrid(grid) {
  const hi = grid.findIndex((row) => findCol(row, ['문서명', '서류명']) >= 0)
  if (hi === -1) return null
  const head = grid[hi]
  const C = {
    date: findCol(head, ['접수일', '일자', '날짜', '접수일자']),
    field: findCol(head, ['분야', '구분']),
    title: findCol(head, ['문서명', '서류명']),
    vendor: findCol(head, ['발행업체', '업체', '발행처']),
    target: findCol(head, ['대상']),
    term: findCol(head, ['기간차수', '기간', '차수', '회차']),
    approval: findCol(head, ['결재']),
    place: findCol(head, ['보관위치', '보관']),
    note: findCol(head, ['메모', '비고']),
  }
  if (C.date === -1) {
    throw new Error("접수대장 같은데 '접수일' 열이 없습니다 — 머리줄까지 함께 복사했는지 확인해 주세요")
  }

  const at = (row, i) => (i >= 0 ? txt(row[i]) : '')
  const items = new Map() // "이름|연월" → 회차 하나
  let lines = 0
  for (const row of grid.slice(hi + 1)) {
    const title = at(row, C.title)
    const date = toDate(row[C.date])
    if (!title || !date) continue
    const term = at(row, C.term)

    // 어느 달 회차인가 — "6월/1차"의 6월이 우선, 없으면 접수한 달.
    // 연말 서류를 이듬해 1월에 접수하는 경우가 있어(12월분을 1/5에 접수) 그때는 지난 해로 본다.
    let y = Number(date.slice(0, 4))
    const dm = Number(date.slice(5, 7))
    const mm = term.match(/(\d{1,2})\s*월/)
    const month = mm ? Math.min(12, Math.max(1, Number(mm[1]))) : dm
    if (month - dm > 6) y -= 1
    const ym = `${y}-${pad2(month)}`

    const key = `${title}|${ym}`
    if (!items.has(key)) {
      items.set(key, {
        title,
        group: at(row, C.field) || '기타',
        desc: at(row, C.place),
        ym,
        lines: [],
      })
    }
    const it = items.get(key)
    if (!it.desc) it.desc = at(row, C.place)
    // 한 줄의 글: 차수 · 발행업체 · 대상 · 결재 · 메모 (빈 칸은 빠진다)
    const text = [
      term,
      at(row, C.vendor),
      at(row, C.target),
      at(row, C.approval) && `결재 ${at(row, C.approval)}`,
      at(row, C.note),
    ]
      .filter((s) => s && s !== '-')
      .join(' · ')
    it.lines.push({ date, text: text || '접수' })
    lines++
  }

  const list = [...items.values()]
  if (!list.length) throw new Error('표에서 접수 기록을 하나도 못 읽었습니다')
  for (const it of list) it.lines.sort((a, b) => a.date.localeCompare(b.date))
  return { kind: 'receipt', items: list, lines }
}

// ② 붙여넣기 — 엑셀에서 복사하면 탭으로 나뉜 글자가 온다.
// 숨긴 열(1~6월 등)은 복사에 안 실려 오는데, 열을 이름으로 찾으므로 그대로 괜찮다.
// 어느 표인지는 머리줄을 보고 앱이 알아서 가른다 — 붙여넣는 사람이 고를 게 없다.
export function readRoutinePaste(text, year) {
  const grid = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t').map((c) => c.trim()))
  if (!grid.length) throw new Error('붙여넣은 내용이 비어 있습니다')
  // 월간체크리스트(항목명)가 먼저, 없으면 접수대장(문서명)
  if (grid.some((r) => r.includes('항목명'))) {
    return { sheet: '붙여넣기', kind: 'checklist', ...readRoutineGrid(grid, year) }
  }
  const receipt = readReceiptGrid(grid)
  if (receipt) return { sheet: '붙여넣기', ...receipt }
  throw new Error(
    "무슨 표인지 모르겠습니다 — 월간체크리스트('항목명' 열)나 문서 접수대장('문서명' 열)의 머리줄까지 함께 복사해 주세요"
  )
}

// ① 엑셀 파일 — exceljs는 1MB에 가까워 평소엔 안 불러온다(엑셀을 고른 순간에만 받아온다)
export async function readRoutineXlsx(file, year) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  // 시트가 여러 장이면 아는 표가 있는 첫 시트를 쓴다 — 월간체크리스트가 먼저, 없으면 접수대장
  const sheets = []
  wb.eachSheet((sheet) => {
    const grid = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      grid.push((row.values || []).slice(1).map(txt))
    })
    sheets.push({ sheet, grid })
  })
  const list = sheets.find((s) => s.grid.some((r) => r.includes('항목명')))
  if (list) return { sheet: list.sheet.name, kind: 'checklist', ...readRoutineGrid(list.grid, year) }
  for (const s of sheets) {
    const receipt = readReceiptGrid(s.grid)
    if (receipt) return { sheet: s.sheet.name, ...receipt }
  }
  throw new Error(
    "아는 표를 못 찾았습니다 — 월간체크리스트('항목명' 열)나 문서 접수대장('문서명' 열)이 있는 파일인지 확인해 주세요"
  )
}
