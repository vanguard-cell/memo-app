import ExcelJS from 'exceljs'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`

function stats(w, year) {
  const planned = (w.months || []).length
  let done = 0
  for (const m of w.months || []) {
    const r = w.runs && w.runs[ymOf(year, m)]
    if (r && r.done) done++
  }
  return { planned, done }
}

function cellMark(w, year, m, curYm) {
  if (!(w.months || []).includes(m)) return null
  const ym = ymOf(year, m)
  const done = !!(w.runs && w.runs[ym] && w.runs[ym].done)
  if (done) return { mark: '✓', cls: 'ok' }
  if (ym < curYm) return { mark: '✕', cls: 'miss' }
  return { mark: '○', cls: 'plan' }
}

const THIN = { style: 'thin', color: { argb: 'FFC8C7C0' } }
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN }
const CELL_STYLE = {
  ok: { fill: 'FFE1F5EE', color: 'FF0F6E56' },
  miss: { fill: 'FFFCEBEB', color: 'FFA32D2D' },
  plan: { fill: null, color: 'FFB4B2A9' },
}

export async function exportExcel(works, year) {
  const curYm = ymOf(new Date().getFullYear(), new Date().getMonth() + 1)
  const scheduled = [...works.filter((w) => (w.months || []).length > 0)].sort(
    (a, b) => (a.area || '').localeCompare(b.area || '', 'ko') || (a.order ?? 0) - (b.order ?? 0)
  )
  const asNeeded = works.filter((w) => (w.months || []).length === 0)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`${year}년`, { views: [{ state: 'frozen', ySplit: 2 }] })
  const COLS = 21

  ws.columns = [
    { width: 9 },
    { width: 30 },
    { width: 13 },
    { width: 17 },
    { width: 19 },
    ...MONTHS.map(() => ({ width: 4.5 })),
    { width: 6 },
    { width: 6 },
    { width: 8 },
    { width: 9 },
  ]

  ws.mergeCells(1, 1, 1, COLS)
  const title = ws.getCell(1, 1)
  title.value = `${year}년 안전관리 점검 캘린더`
  title.font = { bold: true, size: 14 }
  ws.getRow(1).height = 26

  const header = ['분야', '업무', '주기', '담당', '증빙자료', ...MONTHS.map((m) => `${m}`), '계획', '완료', '이행률', '법정필수']
  const hr = ws.getRow(2)
  hr.values = header
  hr.height = 20
  hr.eachCell((c) => {
    c.font = { bold: true, size: 10 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F2ED' } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = BORDER
  })

  let r = 3
  let areaStart = 3
  let prevArea = null
  const closeAreaMerge = (endRow) => {
    if (prevArea !== null && endRow > areaStart) ws.mergeCells(areaStart, 1, endRow, 1)
  }
  for (const w of scheduled) {
    const area = w.area || '기타'
    if (area !== prevArea) {
      closeAreaMerge(r - 1)
      prevArea = area
      areaStart = r
    }
    const { planned, done } = stats(w, year)
    const row = ws.getRow(r)
    row.values = [
      area,
      w.title,
      w.cycle || '',
      w.owner || '',
      w.evidence || '',
      ...MONTHS.map((m) => {
        const c = cellMark(w, year, m, curYm)
        return c ? c.mark : ''
      }),
      planned,
      done,
      planned ? Math.round((done / planned) * 100) / 100 : '',
      w.risk ? '★' : '',
    ]
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > COLS) return
      cell.border = BORDER
      cell.font = { size: 10 }
      if (col === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (col >= 6 && col <= 17) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        const m = MONTHS[col - 6]
        const c = cellMark(w, year, m, curYm)
        if (c) {
          const st = CELL_STYLE[c.cls]
          cell.font = { size: 10, bold: c.cls !== 'plan', color: { argb: st.color } }
          if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } }
        }
      }
      if (col >= 18) cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (col === 20 && cell.value !== '') cell.numFmt = '0%'
      if (col === 21 && cell.value === '★') cell.font = { size: 10, bold: true, color: { argb: 'FFA32D2D' } }
    })
    r++
  }
  closeAreaMerge(r - 1)

  const legend = ws.getRow(r)
  ws.mergeCells(r, 1, r, COLS)
  legend.getCell(1).value = '✓ 완료 · ✕ 미이행 · ○ 예정(미도래) · ★ 법정 필수 (미이행 시 과태료)'
  legend.getCell(1).font = { size: 9, color: { argb: 'FF75736B' } }
  r += 2

  if (asNeeded.length) {
    ws.mergeCells(r, 1, r, COLS)
    const st = ws.getCell(r, 1)
    st.value = '수시·조건부 업무'
    st.font = { bold: true, size: 11 }
    r++
    const h2 = ws.getRow(r)
    h2.values = ['분야', '업무', '주기', '담당', '증빙자료']
    for (let col = 1; col <= 5; col++) {
      const c = h2.getCell(col)
      c.font = { bold: true, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F2ED' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
      c.border = BORDER
    }
    r++
    for (const w of asNeeded) {
      const row = ws.getRow(r)
      row.values = [w.area || '', w.title, w.cycle || '', w.owner || '', w.evidence || '']
      for (let col = 1; col <= 5; col++) {
        const c = row.getCell(col)
        c.border = BORDER
        c.font = { size: 10 }
        if (col === 1) c.alignment = { horizontal: 'center' }
      }
      r++
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `안전관리점검_${year}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function openReport(works, year) {
  const now = new Date()
  const curYm = ymOf(now.getFullYear(), now.getMonth() + 1)
  const scheduled = works.filter((w) => (w.months || []).length > 0)
  const asNeeded = works.filter((w) => (w.months || []).length === 0)

  let totPlanned = 0
  let totDone = 0
  let riskPlanned = 0
  let riskDone = 0
  for (const w of scheduled) {
    const { planned, done } = stats(w, year)
    totPlanned += planned
    totDone += done
    if (w.risk) {
      riskPlanned += planned
      riskDone += done
    }
  }
  const rate = totPlanned ? Math.round((totDone / totPlanned) * 100) : 0
  const riskRate = riskPlanned ? Math.round((riskDone / riskPlanned) * 100) : null

  const areas = [...new Set(scheduled.map((w) => w.area || '기타'))]
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

  const bodyRows = areas
    .map((area) => {
      const ws = scheduled.filter((w) => (w.area || '기타') === area)
      return ws
        .map((w, i) => {
          const { planned, done } = stats(w, year)
          const cells = MONTHS.map((m) => {
            const c = cellMark(w, year, m, curYm)
            return c ? `<td class="m ${c.cls}">${c.mark}</td>` : '<td class="m"></td>'
          }).join('')
          return `<tr>${i === 0 ? `<td class="area" rowspan="${ws.length}">${esc(area)}</td>` : ''}<td class="t">${esc(w.title)}${w.risk ? ' <b class="risk">★</b>' : ''}</td><td>${esc(w.cycle)}</td><td>${esc(w.owner)}</td><td>${esc(w.evidence)}</td>${cells}<td class="rate">${done}/${planned}</td></tr>`
        })
        .join('')
    })
    .join('')

  const asNeededHtml = asNeeded.length
    ? `<h2>수시·조건부 업무</h2><table class="rep"><thead><tr><th>분야</th><th>업무</th><th>주기</th><th>담당</th><th>증빙자료</th></tr></thead><tbody>${asNeeded
        .map((w) => `<tr><td class="area">${esc(w.area)}</td><td class="t">${esc(w.title)}</td><td>${esc(w.cycle)}</td><td>${esc(w.owner)}</td><td>${esc(w.evidence)}</td></tr>`)
        .join('')}</tbody></table>`
    : ''

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${year}년 안전관리 점검 결과 보고</title>
<style>
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #1f1f1c; margin: 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #75736b; font-size: 13px; margin-bottom: 20px; }
  .cards { display: flex; gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px 18px; min-width: 120px; }
  .card .k { font-size: 12px; color: #75736b; }
  .card .v { font-size: 22px; font-weight: 700; margin-top: 2px; }
  h2 { font-size: 15px; margin: 26px 0 8px; }
  table.rep { border-collapse: collapse; width: 100%; font-size: 12px; }
  .rep th, .rep td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
  .rep th { background: #f3f2ed; font-size: 11.5px; }
  .rep td.m { text-align: center; width: 26px; padding: 5px 2px; }
  .rep td.area { font-weight: 700; background: #fafaf7; }
  .rep td.t { min-width: 160px; }
  .rep td.rate { text-align: center; font-weight: 700; white-space: nowrap; }
  .ok { color: #0f6e56; font-weight: 700; }
  .miss { color: #a32d2d; font-weight: 700; }
  .plan { color: #b4b2a9; }
  .risk { color: #a32d2d; }
  .legend { font-size: 12px; color: #75736b; margin: 8px 0 0; }
  .toolbar { position: fixed; top: 10px; right: 10px; }
  .toolbar button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { margin: 10mm; } }
  @page { size: A4 landscape; margin: 10mm; }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>
<h1>${year}년 안전관리 점검 결과 보고</h1>
<div class="sub">작성일 ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} · 내 기록</div>
<div class="cards">
  <div class="card"><div class="k">정기 점검 업무</div><div class="v">${scheduled.length}건</div></div>
  <div class="card"><div class="k">연간 계획</div><div class="v">${totPlanned}회</div></div>
  <div class="card"><div class="k">완료</div><div class="v">${totDone}회</div></div>
  <div class="card"><div class="k">이행률</div><div class="v">${rate}%</div></div>
  ${riskRate !== null ? `<div class="card"><div class="k">법정 필수(★) 이행률</div><div class="v">${riskRate}%</div></div>` : ''}
</div>
<h2>분야별 이행 현황</h2>
<table class="rep"><thead><tr><th>분야</th><th>업무</th><th>주기</th><th>담당</th><th>증빙자료</th>${MONTHS.map((m) => `<th>${m}</th>`).join('')}<th>완료/계획</th></tr></thead><tbody>${bodyRows}</tbody></table>
<div class="legend">✓ 완료 · ✕ 미이행 · ○ 예정(미도래) · ★ 법정 필수 (미이행 시 과태료)</div>
${asNeededHtml}
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
