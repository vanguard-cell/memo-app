import * as XLSX from 'xlsx'

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

export function exportExcel(works, year) {
  const curYm = ymOf(new Date().getFullYear(), new Date().getMonth() + 1)
  const scheduled = works.filter((w) => (w.months || []).length > 0)
  const asNeeded = works.filter((w) => (w.months || []).length === 0)

  const header = ['분야', '업무', '주기', '담당', '증빙자료', ...MONTHS.map((m) => `${m}월`), '계획', '완료', '이행률', '법정필수']
  const rows = scheduled.map((w) => {
    const { planned, done } = stats(w, year)
    return [
      w.area || '',
      w.title,
      w.cycle || '',
      w.owner || '',
      w.evidence || '',
      ...MONTHS.map((m) => {
        const c = cellMark(w, year, m, curYm)
        if (!c) return ''
        if (c.cls === 'ok') return `완료(${(w.runs[ymOf(year, m)].at || '').slice(5)})`
        return c.cls === 'miss' ? '미이행' : '예정'
      }),
      planned,
      done,
      planned ? Math.round((done / planned) * 100) + '%' : '',
      w.risk ? '★' : '',
    ]
  })
  const aoa = [[`${year}년 안전관리 점검 캘린더`], [], header, ...rows]
  if (asNeeded.length) {
    aoa.push([], ['수시·조건부 업무'], ['분야', '업무', '주기', '담당', '증빙자료'])
    for (const w of asNeeded) aoa.push([w.area || '', w.title, w.cycle || '', w.owner || '', w.evidence || ''])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, ...MONTHS.map(() => ({ wch: 11 })), { wch: 5 }, { wch: 5 }, { wch: 7 }, { wch: 5 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}년`)
  XLSX.writeFile(wb, `안전관리점검_${year}.xlsx`)
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
