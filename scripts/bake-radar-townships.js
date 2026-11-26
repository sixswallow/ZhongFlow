// 把真实乡镇边界抽稀成云函数可用的「面内掩膜」，供雷达回波乡镇实况计算使用。
//
// 为什么按名称匹配：utils/townshipBoundaries.js 头部自述为「未验证公开边界数据」，
// 其 code（如中方镇=431221111）与云函数 TOWNSHIPS（依 2024 区划目录，中方镇=431221100）冲突，
// 因此只能按名称对齐；输出沿用云函数的 code 作为权威值。
//
// 运行：node.exe scripts/bake-radar-townships.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'cloudfunctions/getWeather/lib/radarTownships.js');
const MAX_POINTS = 40;
const K = 111.32; // km / 度

// 与 cloudfunctions/getWeather/index.js 的 TOWNSHIPS 顺序、名称、代码严格一致
const ORDER = [
  { code: '431221100', name: '中方镇' },
  { code: '431221105', name: '桐木镇' },
  { code: '431221103', name: '花桥镇' },
  { code: '431221104', name: '铜湾镇' },
  { code: '431221102', name: '泸阳镇' },
  { code: '431221107', name: '新建镇' },
  { code: '431221108', name: '接龙镇' },
  { code: '431221106', name: '铁坡镇' },
  { code: '431221111', name: '袁家镇' },
  { code: '431221110', name: '新路河镇' },
  { code: '431221109', name: '铜鼎镇' },
  { code: '431221214', name: '蒿吉坪瑶族乡' }
];

const { TOWNSHIP_BOUNDARIES } = require(path.join(ROOT, 'utils/townshipBoundaries.js'));

function ringAreaKm2(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = K * Math.cos((lat0 * Math.PI) / 180);
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * kx * (b[1] * K) - b[0] * kx * (a[1] * K);
  }
  return Math.abs(s) / 2;
}

function downsample(ring, maxPts) {
  const n = ring.length;
  if (n <= maxPts) return ring.slice();
  const stride = Math.ceil(n / maxPts);
  const out = [];
  for (let i = 0; i < n; i += stride) out.push(ring[i]);
  // 保证首尾相邻不出现超长缺口：末点收尾
  if (out[out.length - 1] !== ring[n - 1]) out.push(ring[n - 1]);
  return out;
}

const rows = [];
let srcPoints = 0, keptPoints = 0, areaErrMax = 0;
for (const tw of ORDER) {
  const found = TOWNSHIP_BOUNDARIES.find((b) => b.name === tw.name);
  if (!found) { console.error('✗ 边界数据中找不到乡镇：' + tw.name); process.exit(1); }
  const ring = found.points.map((p) => [+p.longitude.toFixed(6), +p.latitude.toFixed(6)]);
  const thin = downsample(ring, MAX_POINTS);
  const a1 = ringAreaKm2(ring), a2 = ringAreaKm2(thin);
  const err = Math.abs(a1 - a2) / a1;
  areaErrMax = Math.max(areaErrMax, err);
  srcPoints += ring.length; keptPoints += thin.length;
  rows.push({ code: tw.code, name: tw.name, areaKm2: +a1.toFixed(1), ring: thin });
  console.log(
    tw.name.padEnd(8) + ' 原点 ' + String(ring.length).padStart(4) + ' → ' + String(thin.length).padStart(2) +
    '  面积 ' + a1.toFixed(1).padStart(6) + ' → ' + a2.toFixed(1).padStart(6) + ' km²  偏差 ' + (err * 100).toFixed(2) + '%'
  );
}
console.log('\n合计 原点 ' + srcPoints + ' → 抽稀 ' + keptPoints + '，最大面积偏差 ' + (areaErrMax * 100).toFixed(2) + '%');
if (areaErrMax > 0.10) { console.error('✗ 抽稀偏差超过 10%，请提高 MAX_POINTS'); process.exit(1); }

const body = `// 由 scripts/bake-radar-townships.js 生成，请勿手工编辑。
// 用途：计算「雷达回波乡镇实况」时的面内掩膜（点是否落在乡镇多边形内）。
// 来源：utils/townshipBoundaries.js（公开边界数据，仅作辅助判定，不作行政依据）
// 代码：沿用 cloudfunctions/getWeather/index.js 的 TOWNSHIPS（2024 区划目录）；
//       边界数据自身的 code 与之冲突，故按名称对齐。
// 抽稀：等间隔取样至 ≤ ${MAX_POINTS} 点/环；面积偏差 ≤ ${(areaErrMax * 100).toFixed(2)}%。
const TOWNSHIP_RINGS = ${JSON.stringify(rows, null, 0).replace(/\],\[/g, '],\n  [')};

const RING_META = {
  sourcePoints: ${srcPoints},
  keptPoints: ${keptPoints},
  maxPointsPerRing: ${MAX_POINTS},
  maxAreaErrorPct: ${+(areaErrMax * 100).toFixed(2)},
  generatedAt: '${new Date().toISOString().slice(0, 10)}'
};

module.exports = { TOWNSHIP_RINGS, RING_META };
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body, 'utf8');
console.log('✓ 写出 ' + OUT.replace(/\\/g, '/') + '  ' + fs.statSync(OUT).size + ' 字节');
