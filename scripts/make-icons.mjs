// 앱 아이콘 만들기 (2026-11-09) — SVG 그림 → PNG. Playwright(크로미움)가 있어야 한다.
//   node scripts/make-icons.mjs preview <폴더>          색 시안 비교 그림(preview.png)
//   node scripts/make-icons.mjs build peach public       public/에 아이콘 파일 생성 (peach | lavender | sky)
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

export const PALETTES = {
  peach:    { name: '피치',   bg: ['#FFD9B8', '#FF9E8E'], acc: ['#FF8A6E', '#F0567A'], line: '#F2DFD9', glow: '#FFF3E8', shadow: '#C2504F' },
  lavender: { name: '라벤더', bg: ['#D9D4FF', '#9A9CF6'], acc: ['#8D8BF5', '#5E5BE0'], line: '#E3E1F7', glow: '#F4F2FF', shadow: '#4B47A8' },
  sky:      { name: '스카이', bg: ['#BFE3FF', '#5E9EF4'], acc: ['#5B9BF8', '#2F62DA'], line: '#DCE8F6', glow: '#EEF7FF', shadow: '#2A4F9C' },
}

// full: 네모 꽉 채움(아이폰·안드로이드가 모서리를 알아서 깎음). rounded: 모서리 둥근 판(브라우저 탭·일반 아이콘)
export function iconSvg(p, { rounded = false, size = 1024, id = 'i' } = {}) {
  const clip = rounded
    ? `<clipPath id="${id}r"><rect width="1024" height="1024" rx="230" ry="230"/></clipPath>`
    : ''
  const g = rounded ? ` clip-path="url(#${id}r)"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    ${clip}
    <linearGradient id="${id}bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/>
    </linearGradient>
    <radialGradient id="${id}glow" cx="0.3" cy="0.12" r="0.75">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.75"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.acc[0]}"/><stop offset="1" stop-color="${p.acc[1]}"/>
    </linearGradient>
    <linearGradient id="${id}card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FBF9F8"/>
    </linearGradient>
    <filter id="${id}sh" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="26" stdDeviation="34" flood-color="${p.shadow}" flood-opacity="0.28"/>
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${p.shadow}" flood-opacity="0.12"/>
    </filter>
  </defs>
  <g${g}>
    <rect width="1024" height="1024" fill="url(#${id}bg)"/>
    <rect width="1024" height="1024" fill="url(#${id}glow)"/>
    <g filter="url(#${id}sh)">
      <rect x="252" y="212" width="520" height="600" rx="116" fill="url(#${id}card)"/>
    </g>
    <circle cx="390" cy="392" r="66" fill="url(#${id}acc)"/>
    <path d="M361 393 L382 414 L421 373" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="500" y1="392" x2="664" y2="392" stroke="${p.line}" stroke-width="40" stroke-linecap="round"/>
    <line x1="350" y1="546" x2="664" y2="546" stroke="${p.line}" stroke-width="40" stroke-linecap="round"/>
    <line x1="350" y1="662" x2="572" y2="662" stroke="${p.line}" stroke-width="40" stroke-linecap="round"/>
  </g>
</svg>`
}

export async function renderPng(page, svg, size, out) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`)
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

if (process.argv[2] === 'preview') {
  const dir = process.argv[3]
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 2 })
  const tiles = Object.entries(PALETTES).map(([k, p]) => {
    const svg = iconSvg(p, { size: 120, id: k })
    return `<div class="t"><div class="ic">${svg}</div><div class="lb">내 기록</div><div class="nm">${p.name}</div></div>`
  }).join('')
  const html = `<html><head><style>
    body{margin:0;font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans CJK KR',sans-serif}
    .bg{width:720px;padding:56px 40px 44px;box-sizing:border-box;background:linear-gradient(160deg,#2b3350,#5b4a6e 55%,#c98a7a);display:flex;justify-content:space-around}
    .t{display:flex;flex-direction:column;align-items:center;gap:10px}
    .ic{width:120px;height:120px;border-radius:27px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.25)}
    .ic svg{display:block}
    .lb{color:#fff;font-size:15px;text-shadow:0 1px 2px rgba(0,0,0,.4)}
    .nm{color:#fff;opacity:.8;font-size:20px;font-weight:600;margin-top:8px}
    .small{background:#f2f2f7}
    .small .ic{width:60px;height:60px;border-radius:13.5px;box-shadow:0 2px 6px rgba(0,0,0,.15)}
    .small .ic svg{width:60px;height:60px}
    .small .lb{color:#111;text-shadow:none;font-size:12px}
    .small .nm{display:none}
  </style></head><body><div class="bg" id="a">${tiles}</div><div class="bg small" id="b" style="padding:28px 40px 24px;background:#f2f2f7">${tiles}</div></body></html>`
  await page.setViewportSize({ width: 720, height: 600 })
  await page.setContent(html)
  const box = await page.evaluate(() => { const a=document.getElementById('a').getBoundingClientRect(), b=document.getElementById('b').getBoundingClientRect(); return {h: a.height+b.height} })
  await page.screenshot({ path: `${dir}/preview.png`, clip: { x: 0, y: 0, width: 720, height: Math.ceil(box.h) } })
  await browser.close()
  console.log('preview ok')
}

// node gen.mjs build <palette> <public 폴더>
if (process.argv[2] === 'build') {
  const p = PALETTES[process.argv[3]]
  const dir = process.argv[4]
  writeFileSync(`${dir}/favicon.svg`, iconSvg(p, { rounded: true, size: 64, id: 'f' }) + '\n')
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await renderPng(page, iconSvg(p, { id: 'a' }), 180, `${dir}/apple-touch-icon.png`) // 아이폰 홈 화면 (모서리는 아이폰이 깎음)
  await renderPng(page, iconSvg(p, { rounded: true, id: 'b' }), 192, `${dir}/icon-192.png`)
  await renderPng(page, iconSvg(p, { rounded: true, id: 'c' }), 512, `${dir}/icon-512.png`)
  await renderPng(page, iconSvg(p, { id: 'd' }), 512, `${dir}/icon-maskable-512.png`) // 안드로이드 (모양은 폰이 깎음)
  await browser.close()
  console.log('build ok')
}
