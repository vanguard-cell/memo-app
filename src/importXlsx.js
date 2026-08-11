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
      desc: [x.site, x.vendor, x.form, x.note, x.who && x.who !== main ? `담당 ${x.who}` : '']
        .filter((s) => s && s !== '-')
        .join(' · '),
      done: x.done,
    })),
  }
}

// ② 붙여넣기 — 엑셀에서 복사하면 탭으로 나뉜 글자가 온다.
// 숨긴 열(1~6월 등)은 복사에 안 실려 오는데, 열을 이름으로 찾으므로 그대로 괜찮다.
export function readRoutinePaste(text, year) {
  const grid = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t').map((c) => c.trim()))
  if (!grid.length) throw new Error('붙여넣은 내용이 비어 있습니다')
  return { sheet: '붙여넣기', ...readRoutineGrid(grid, year) }
}

// ① 엑셀 파일 — exceljs는 1MB에 가까워 평소엔 안 불러온다(엑셀을 고른 순간에만 받아온다)
export async function readRoutineXlsx(file, year) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  // 시트가 여러 장이면 '항목명'이 있는 첫 시트를 쓴다
  let found = null
  wb.eachSheet((sheet) => {
    if (found) return
    const grid = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      grid.push((row.values || []).slice(1).map(txt))
    })
    if (grid.some((r) => r.includes('항목명'))) found = { sheet, grid }
  })
  if (!found) throw new Error("'항목명' 열이 있는 표를 못 찾았습니다 — 월간체크리스트 형식인지 확인해 주세요")
  return { sheet: found.sheet.name, ...readRoutineGrid(found.grid, year) }
}
