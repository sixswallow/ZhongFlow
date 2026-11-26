// 生成线性 SVG 图标集 → assets/icons.wxss（base64 data URI 背景图）
const fs = require('fs');
const path = require('path');

// 24x24 线性图标，stroke 风格
const ICONS = {
  home: '<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.8 9.3V20h12.4V9.3"/><path d="M10 20v-5.2h4V20"/>',
  map: '<path d="M9 4.2 3.5 6.4v13.4L9 17.6l6 2.6 5.5-2.2V4.6L15 6.8z"/><path d="M9 4.2v13.4"/><path d="M15 6.8v13.4"/>',
  list: '<path d="M4.5 6.2h15"/><path d="M4.5 12h15"/><path d="M4.5 17.8h15"/>',
  cloud: '<path d="M7.2 18.5h9.4a3.9 3.9 0 0 0 .5-7.8 6.3 6.3 0 0 0-12-1.6A4.7 4.7 0 0 0 7.2 18.5z"/><circle cx="17.6" cy="6.2" r="2.5"/><path d="M17.6 1.8v1.1"/><path d="M17.6 9.5v1.1"/><path d="M13.9 6.2h1.1"/><path d="M20.2 6.2h1.1"/>',
  droplet: '<path d="M12 2.7c3.6 4.3 6.8 8.2 6.8 11.8a6.8 6.8 0 0 1-13.6 0C5.2 10.9 8.4 7 12 2.7z"/>',
  wave: '<path d="M2.5 8.5c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2"/><path d="M2.5 14.5c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2"/>',
  sprout: '<path d="M12 20.5V11"/><path d="M12 12.5C12 8.5 8.5 6 4.5 5.8c.3 4 3.5 6.7 7.5 6.7z"/><path d="M12 9.5c0-3.2 2.5-5.4 7-6-.2 4.2-3 6.6-7 6z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5 21 21"/>',
  pin: '<path d="M12 21.5s-6.5-5.5-6.5-10.2a6.5 6.5 0 0 1 13 0c0 4.7-6.5 10.2-6.5 10.2z"/><circle cx="12" cy="10.8" r="2.4"/>',
  locate: '<circle cx="12" cy="12" r="6.8"/><path d="M12 2.5v3.4"/><path d="M12 18.1v3.4"/><path d="M2.5 12h3.4"/><path d="M18.1 12h3.4"/><circle cx="12" cy="12" r="1.6"/>',
  inbox: '<path d="M4 10.5 6.2 4h11.6L20 10.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M4 10.5h4.4a3.6 3.6 0 0 0 7.2 0H20"/>'
};

// 颜色变体：白(头部)、青黛(品牌 #0e4d64)、青(强调 #0e9bb8)、灰(未激活 #94aebb)
const VARIANTS = {
  w: '#ffffff',
  d: '#0e4d64',
  a: '#0e9bb8',
  g: '#94aebb'
};

function svgToDataUri(iconSvg, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;
  return `url("data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}")`;
}

const lines = [];
lines.push('/* 自动生成：线性图标集（青黛设计系统 v3）。请勿手改，重新运行 scripts/gen-icons.js 生成。 */');
for (const [name, svg] of Object.entries(ICONS)) {
  for (const [v, color] of Object.entries(VARIANTS)) {
    const cls = `.ic-${name}-${v}`;
    const uri = svgToDataUri(svg, color);
    lines.push(`${cls}{background-image:${uri}}`);
  }
}
lines.push('/* 通用图标展示基类 */');
lines.push('.ic{background-repeat:no-repeat;background-position:center;background-size:contain}');

const outPath = path.join(__dirname, '..', 'assets', 'icons.wxss');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`已生成 ${outPath}，共 ${lines.length} 行，${Object.keys(ICONS).length} 个图标 × 4 色变体`);
