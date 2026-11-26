// 逐小时雨量柱的「可读性」与「三态诚实性」测试（A + B，2026-09-27）
//
// 起因：用户问「逐小时预报里天气图标和气温中间是什么标识」——那条柱子没有任何标注，
// 页面上也没写满格口径，所以看不出来它在说什么。
//
// 本文件锁死三件事：
//   1) 图例：满格口径只从 utils/rainImpact.js 的 BAR_FULL_MM 出，界面不另写一遍数字；
//   2) 三态：有雨 → X.Xmm；确实 0mm → --；上游没给 → 「未知」（三态必须能区分）；
//   3) 空槽：无雨 / 未取到时不画那个浅蓝空盒子，但轨道仍占位，六列气温不错行。
// 另外：窗口里只要有「没取到」的小时，「未来降雨影响」就不得给等级、也不得下「无明显降雨」的结论。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const rainImpact = require('../utils/rainImpact.js');
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');
const fcSrc = fs.readFileSync(fcPath, 'utf8');
const T = require(fcPath).__test;

const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxss'), 'utf8');
const js = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (e) {
    failed += 1;
    console.error('✗ ' + name);
    console.error('   ' + ((e && e.message) || e));
  }
}

// 造 24 小时：v = 数值 → 该小时雨量已知；v === null → 该小时上游没给（rainKnown=false）
const hoursOf = (list) => list.map((v, i) => {
  const t = String(i).padStart(2, '0') + ':00';
  return v === null
    ? { time: t, rain: null, rainKnown: false }
    : { time: t, rain: v, rainKnown: true };
});

/* ---------------- 一、图例：满格口径只有一个出处 ---------------- */
test('图例文字由 rainImpact.barLegendText() 给出，且含 BAR_FULL_MM', () => {
  const text = rainImpact.barLegendText();
  assert.ok(text.includes('柱高'), '图例要说明「柱高」，实际：' + text);
  assert.ok(text.includes(String(rainImpact.BAR_FULL_MM) + 'mm'), '图例要带上满格口径，实际：' + text);
  assert.doesNotMatch(text, /等级/, '小时雨强是「强度参考档」，不能说成等级');
});

test('满格数字不在模板与样式里重复写一遍（改常量只需改一处）', () => {
  assert.ok(wxml.includes('{{hourBarLegend}}'), '图例必须来自 data，不能在模板里写死');
  assert.ok(!/16mm/.test(wxml), '模板里不得再写一遍 16mm');
  assert.ok(!/16mm/.test(wxss), '样式里不得写 16mm');
  assert.match(js, /hourBarLegend:\s*rainImpact\.barLegendText\(\)/, 'onLoad 要把图例填进 data');
  assert.match(js, /hourBarLegend:\s*''/, 'data 需要 hourBarLegend 初值');
});

test('图例挂在逐小时卡片标题行，且不参与真机不支持的伪类', () => {
  assert.match(wxml, /<view class="card-title">逐小时预报<text class="hour-legend">\{\{hourBarLegend\}\}<\/text><\/view>/, '图例应在标题行内');
  const block = wxss.match(/\.hour-legend\{[^}]*\}/);
  assert.ok(block, '缺少 .hour-legend 样式');
  assert.match(block[0], /margin-left:\s*auto/, '图例要靠右，与标题同一行');
  assert.match(block[0], /white-space:\s*nowrap/, '图例不得换行');
  assert.ok(!/gap\s*:/.test(block[0]), '不得使用 flex gap（真机整条规则失效）');
});

/* ---------------- 二、云函数：没取到 ≠ 0mm ---------------- */
test('云函数：上游给了 0 也必须能区分出「确实 0」与「没给」', () => {
  const zero = T.normalizeQWeatherHourly({ hours: [{ forecastTime: '2024-05-31T03:00Z', temperature: { value: 25 }, precipitation: { amount: { value: 0 }, probability: 0 } }] }, 'v1')[0];
  assert.strictEqual(zero.rain, 0, '确实 0mm 时 rain 应为 0');
  assert.strictEqual(zero.rainKnown, true, '确实 0mm 时 rainKnown 应为 true');

  const missing = T.normalizeQWeatherHourly({ hours: [{ forecastTime: '2024-05-31T03:00Z', temperature: { value: 25 }, precipitation: {} }] }, 'v1')[0];
  assert.strictEqual(missing.rain, null, '上游没给雨量时 rain 必须是 null（不能悄悄变成 0）');
  assert.strictEqual(missing.rainKnown, false, '上游没给雨量时 rainKnown 必须是 false');
});

test('云函数：v7 缺 precip 同样标成未知，且不再做「null → 0」的静默转换', () => {
  const v7 = T.normalizeQWeatherHourly({ hourly: [{ fxTime: '2026-09-23T15:00+08:00', temp: '22', text: '小雨' }] }, 'v7')[0];
  assert.strictEqual(v7.rain, null);
  assert.strictEqual(v7.rainKnown, false);
  assert.ok(!/rain:\s*rain === null \? 0 : rain/.test(fcSrc), '旧的静默兜底必须已被移除');
  assert.match(fcSrc, /rainKnown:\s*rain !== null/, '云函数要显式给出 rainKnown');
});

test('云函数形态日志不打印 nullmm', () => {
  const i = fcSrc.indexOf('形态自检');
  assert.ok(i > 0, '应能找到形态自检日志');
  const stmt = fcSrc.slice(i, fcSrc.indexOf(');', i));
  assert.match(stmt, /rain === null \? '未取到'/, '日志要区分「未取到」');
  assert.doesNotMatch(stmt, /，雨量 → ' \+\s*transformed\.hourly\[0\]\.rain(?!\s*=== null)/, '雨量后面不得无守卫地直接拼 rain（未取到时会打印 nullmm）');
});

/* ---------------- 三、模板三态 ---------------- */
test('逐小时雨量文字是三态：有雨 / 确实 0mm / 未知', () => {
  assert.match(wxml, /wx:if="\{\{item\.rain > 0\}\}">\{\{item\.rain\}\}mm</, '有雨要显示毫米数');
  assert.match(wxml, /wx:elif="\{\{item\.rainKnown\}\}">--</, '确实 0mm 才显示 --');
  assert.match(wxml, /wx:else>未知</, '没取到要显示「未知」');
  assert.ok(!/no-rain" wx:else>--/.test(wxml), '-- 绝不能再是无条件兜底（否则「没取到」又变成「没事」）');
});

test('样式里「未知」与「--」是两种不同颜色，未知态有独立类', () => {
  const unknown = wxss.match(/\.hour-rain\.unknown-rain\{[^}]*\}/);
  const zero = wxss.match(/\.hour-rain\.no-rain\{[^}]*\}/);
  assert.ok(unknown, '缺少 .hour-rain.unknown-rain 样式');
  assert.ok(zero, '缺少 .hour-rain.no-rain 样式');
  const colorOf = (s) => (s.match(/color:(#[0-9a-f]{3,8})/i) || [])[1];
  assert.ok(colorOf(unknown[0]), '未知态要有颜色');
  assert.notStrictEqual(colorOf(unknown[0]), colorOf(zero[0]), '未知与无雨不能是同一个颜色');
});

test('前端：逐小时条目补上 rainQuiet / rainKnown，且柱高分档没被动过', () => {
  assert.match(js, /rainQuiet:\s*!\(h\.rain > 0\)/, '缺少空槽静默标记');
  assert.match(js, /rainKnown:\s*h\.rainKnown !== false/, '缺少三态判定（缺字段时按「已知」兜底）');
  assert.match(js, /rainBar:\s*rainImpact\.barPercent\(/, '柱高计算不能丢');
  assert.match(js, /rainLevel:\s*rainImpact\.levelOf\(/, '分档计算不能丢');
});

test('无雨 / 未取到时不画空槽，但轨道仍占位（六列气温不错行）', () => {
  const track = wxml.match(/<view class="hour-bar-track"[^>]*>/);
  assert.ok(track, '仍应保留雨量柱轨道（它负责占位）');
  assert.match(track[0], /class="hour-bar-track"/, '轨道类名保持不变，便于既有断言继续生效');
  assert.match(track[0], /style="\{\{item\.rainQuiet \? 'background:transparent' : ''\}\}"/, '静默应走内联样式，不新增伪类');
  assert.match(wxss, /\.hour-bar-track\{[^}]*background:#eef6fa/, '有雨时的轨道底色仍要保留');
});

/* ---------------- 四、未来降雨影响卡：有「没取到」就不许下结论 ---------------- */
test('窗口里有没取到的小时：不给等级、不下「无明显降雨」结论、给出独立说明', () => {
  const rows = new Array(24).fill(0);
  rows[0] = null;
  rows[1] = null;
  const impact = rainImpact.buildRainImpact(hoursOf(rows), []);
  assert.strictEqual(impact.spans[impact.spans.length - 1].unknown, 2, '要统计出没取到的小时数');
  assert.strictEqual(impact.empty, false, '不能把「没取到」当成「无雨」');
  assert.strictEqual(impact.gradeText, '', '累计只是已知部分时不得给等级');
  assert.strictEqual(impact.tone, 'none', '没有等级就不能上等级配色');
  assert.match(impact.tip, /未取到/, '要说清有小时没取到，实际：' + impact.tip);
  assert.doesNotMatch(impact.tip, /无明显降雨/, '不得声称无明显降雨');
});

test('有雨但有没取到的小时：等级照样不许给，最强只能叫「已知最强」', () => {
  const rows = new Array(24).fill(3.0);
  rows[5] = null;
  const impact = rainImpact.buildRainImpact(hoursOf(rows), []);
  assert.strictEqual(impact.gradeText, '', '累计不完整时 66mm 也不给等级');
  assert.match(impact.peakText, /^已知最强 /, '最强只能是已知部分的最强，实际：' + impact.peakText);
});

test('全部取到时行为一字不变（回归守卫）', () => {
  const dry = rainImpact.buildRainImpact(hoursOf(new Array(24).fill(0)), []);
  assert.strictEqual(dry.empty, true);
  assert.strictEqual(dry.tip, '未来24小时无明显降雨');

  const wet = rainImpact.buildRainImpact(hoursOf(new Array(24).fill(3.0)), []);
  assert.strictEqual(wet.gradeText, '暴雨', '72mm/24h 应为暴雨');
  assert.match(wet.peakText, /^最强 /, '全部已知时仍写「最强」，不能多出「已知」');
  assert.strictEqual(wet.spans[wet.spans.length - 1].unknown, 0);
});

test('没有时间字段的行仍被过滤（既有行为不变）', () => {
  const impact = rainImpact.buildRainImpact([{ rain: 3 }], []);
  assert.deepStrictEqual(impact.spans, [], '缺 time 的行照旧不参与');
  assert.strictEqual(impact.ready, false);
});

/* ---------------- 五、真机兼容：新样式不用 gap、不用伪类 ---------------- */
test('新增样式块：不用 flex gap，也不用 ::after/::before 之外的伪类', () => {
  const block = wxss.match(/\.hour-rain\.unknown-rain\{[^}]*\}\n[^\n]*\n\.hour-legend\{[^}]*\}/);
  assert.ok(block, '未找到新增的两个样式块');
  block[0].split('}').forEach((b) => {
    assert.ok(!/(^|[;{\s])gap\s*:/.test(b), '不得使用 flex gap: ' + b.trim().slice(0, 50));
    const selector = (b.split('{')[0] || '').replace(/::(after|before)/g, '');
    assert.ok(!selector.includes(':'), '不得使用 ::after/::before 之外的伪类: ' + selector.trim());
  });
});

if (failed) {
  console.error('\n逐小时雨量柱三态测试：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n逐小时雨量柱三态测试：全部通过');
}
