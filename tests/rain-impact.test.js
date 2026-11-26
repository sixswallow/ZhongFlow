// 「未来降雨影响」与逐小时雨量柱的测试
// 一、纯计算（utils/rainImpact.js）——口径正确性是重点：等级只在覆盖满 12/24 小时时才给
// 二、页面接线（rainfall.wxml / rainfall.js）——防止卡片被删或计算没被调用
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rainImpact = require('../utils/rainImpact.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const R = path.join(__dirname, '..');
const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const js = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');
const wxss = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxss'), 'utf8');

const flat = (arr) => arr.map((x) => (typeof x === 'number' ? { time: String(x) + ':00', rain: x } : x));
const hoursOf = (list) => flat(list.map((v, i) => ({ time: String(i).padStart(2, '0') + ':00', rain: v })));

// ---------------- 一、雨量等级（GB/T 28592-2012） ----------------
test('雨量等级：12 小时表边界正确', () => {
  const g = (mm) => rainImpact.gradeOf(mm, 12);
  assert.strictEqual(g(0.1), '小雨');
  assert.strictEqual(g(4.9), '小雨');
  assert.strictEqual(g(5), '中雨');
  assert.strictEqual(g(14.9), '中雨');
  assert.strictEqual(g(15), '大雨');
  assert.strictEqual(g(29.9), '大雨');
  assert.strictEqual(g(30), '暴雨');
  assert.strictEqual(g(69.9), '暴雨');
  assert.strictEqual(g(70), '大暴雨');
  assert.strictEqual(g(139.9), '大暴雨');
  assert.strictEqual(g(140), '特大暴雨');
  assert.strictEqual(g(0), null, '无降雨不给等级');
});

test('雨量等级：24 小时表边界正确，且非 12/24 小时一律不给等级', () => {
  const g = (mm) => rainImpact.gradeOf(mm, 24);
  assert.strictEqual(g(0.1), '小雨');
  assert.strictEqual(g(9.9), '小雨');
  assert.strictEqual(g(10), '中雨');
  assert.strictEqual(g(24.9), '中雨');
  assert.strictEqual(g(25), '大雨');
  assert.strictEqual(g(49.9), '大雨');
  assert.strictEqual(g(50), '暴雨');
  assert.strictEqual(g(99.9), '暴雨');
  assert.strictEqual(g(100), '大暴雨');
  assert.strictEqual(g(249.9), '大暴雨');
  assert.strictEqual(g(250), '特大暴雨');
  // 国标没有 6/10/15 小时表，绝不能套错表
  [6, 10, 15, 23, 25].forEach((h) => assert.strictEqual(rainImpact.gradeOf(120, h), null, h + ' 小时不应套用等级表'));
});

// ---------------- 二、累计与覆盖时长 ----------------
test('累计降雨：脏数据被过滤，不把 NaN / 负数算进去', () => {
  const rows = hoursOf([1, 2, null, undefined, NaN, -5, '3']);
  const impact = rainImpact.buildRainImpact(rows, []);
  const total = impact.spans[impact.spans.length - 1].mm;
  // 1 + 2 + 0 + 3 = 6
  assert.strictEqual(total, 6);
  assert.strictEqual(rainImpact.sumFirst([{ rain: 1 }, { rain: 2 }], 5), 3, '不足时按实际条数求和');
});

test('覆盖时长不足时如实降档：不重复标签、不套错等级', () => {
  const s = (n) => rainImpact.buildRainImpact(hoursOf(new Array(n).fill(1)), []);
  assert.deepStrictEqual(s(30).spans.map((x) => x.label), ['6h', '12h', '24h']);
  assert.deepStrictEqual(s(12).spans.map((x) => x.label), ['6h', '12h'], '只有 12 小时时不得出现两个 12h');
  assert.deepStrictEqual(s(4).spans.map((x) => x.label), ['4h']);
  assert.strictEqual(s(4).spans[0].partial, true);
  assert.strictEqual(s(15).gradeText, '', '15 小时覆盖没有对应国标表，不得给等级');
  assert.match(s(15).tip, /时长不足/, '应如实说明只给累计值');
  assert.strictEqual(s(24).gradeText, '中雨', '24 小时覆盖 24mm 应为中雨');
  assert.strictEqual(s(12).gradeText, '中雨', '12 小时覆盖 12mm 按 12 小时表也是中雨');
});

test('最强小时与短临雨中心', () => {
  const rows = hoursOf([0, 1.5, 9.2, 0, 3]);
  const peak = rainImpact.peakOf(rows, 24);
  assert.strictEqual(peak.rain, 9.2);
  assert.strictEqual(peak.time, '02:00', '最强小时要带得出时段');
  const impact = rainImpact.buildRainImpact(rows, [
    { name: '泸阳镇', totalRain: 1.2 }, { name: '中方镇', totalRain: 7.6 }, { name: '花桥镇', totalRain: 0 },
  ]);
  assert.match(impact.centerText, /中方镇/, '雨中心应取累计降水最大的乡镇');
  assert.match(impact.centerText, /7\.6mm/);
  assert.match(impact.metaText, /最强 02:00 9\.2mm\/h/);
  assert.match(impact.metaText, /雨中心 中方镇/);
});

test('雨中心：全为 0 或缺数据时不给（不能凭空指一个乡镇）', () => {
  assert.strictEqual(rainImpact.rainCenter([{ name: 'A', totalRain: 0 }]), null);
  assert.strictEqual(rainImpact.rainCenter([]), null);
  assert.strictEqual(rainImpact.rainCenter(undefined), null);
  assert.strictEqual(rainImpact.buildRainImpact(hoursOf([1, 1]), []).centerText, '');
});

test('无降雨：空态文案明确，且不显示等级', () => {
  const impact = rainImpact.buildRainImpact(hoursOf(new Array(24).fill(0)), []);
  assert.strictEqual(impact.ready, true);
  assert.strictEqual(impact.empty, true);
  assert.strictEqual(impact.gradeText, '');
  assert.strictEqual(impact.tone, 'none');
  assert.strictEqual(impact.tip, '未来24小时无明显降雨');
  assert.strictEqual(impact.metaText, '');
});

test('无逐小时数据：整卡不渲染，而不是显示 0mm', () => {
  const impact = rainImpact.buildRainImpact([], []);
  assert.strictEqual(impact.ready, false, '拿不到预报时不能显示 0mm 冒充「无雨」');
  assert.deepStrictEqual(impact.spans, []);
});

test('提示语不含「关注 / 预警 / 风险 / 态势」等主观措辞', () => {
  const banned = /关注|预警|风险|态势/;
  ['小雨', '中雨', '大雨', '暴雨', '大暴雨', '特大暴雨'].forEach((g) => {
    const mm = { 小雨: 3, 中雨: 15, 大雨: 30, 暴雨: 60, 大暴雨: 120, 特大暴雨: 260 }[g];
    const impact = rainImpact.buildRainImpact(hoursOf(new Array(24).fill(rainImpact.round1(mm / 24))), []);
    assert.strictEqual(impact.gradeText, g, g + ' 分级不符');
    assert.strictEqual(impact.tone, g === '小雨' ? 'light' : g === '中雨' ? 'moderate' : g === '大雨' ? 'heavy' : 'storm');
    assert.doesNotMatch(impact.tip, banned, g + ' 的提示语含主观措辞: ' + impact.tip);
  });
});

// ---------------- 三、逐小时雨量柱 ----------------
test('雨量柱：0 不显示、有雨至少 12%、16mm/h 满格并封顶', () => {
  assert.strictEqual(rainImpact.barPercent(0), 0);
  assert.strictEqual(rainImpact.barPercent(0.1), 12, '微量降雨也要看得见');
  assert.strictEqual(rainImpact.barPercent(8), 50);
  assert.strictEqual(rainImpact.barPercent(16), 100);
  assert.strictEqual(rainImpact.barPercent(80), 100, '超过满格参考值应封顶');
  assert.strictEqual(rainImpact.barPercent(-3), 0);
});

test('雨量柱配色分档与雷达图例同一套色阶', () => {
  const l = rainImpact.levelOf;
  assert.strictEqual(l(0), 'none');
  assert.strictEqual(l(0.5), 'light');
  assert.strictEqual(l(2.5), 'light');
  assert.strictEqual(l(2.6), 'moderate');
  assert.strictEqual(l(8), 'moderate');
  assert.strictEqual(l(8.1), 'heavy');
  assert.strictEqual(l(16), 'heavy');
  assert.strictEqual(l(16.1), 'storm');
  // 样式里这 4 档必须真的存在，否则柱子是灰的
  ['light', 'moderate', 'heavy', 'storm'].forEach((k) => {
    assert.match(wxss, new RegExp('\\.hour-bar\\.' + k + '\\s*\\{'), '缺少 .hour-bar.' + k + ' 配色');
  });
});

// ---------------- 四、页面接线 ----------------
test('降雨影响卡片：标题、三档累计、分级 chip、提示、雨中心都在 WXML 里', () => {
  assert.match(wxml, /class="rain-impact card anim-up/, '缺少「未来降雨影响」卡片');
  assert.match(wxml, /未来降雨影响/, '卡片标题缺失');
  assert.match(wxml, /\{\{rainImpact\.spans\}\}/, '三档累计必须来自 rainImpact.spans');
  assert.match(wxml, /wx:key="want"/, 'spans 需要稳定的 wx:key');
  assert.match(wxml, /未来\{\{item\.label\}\}/, '每档要标明覆盖时长，不能含糊写「累计」');
  assert.match(wxml, /\{\{item\.mmText\}\}<text class="impact-unit">mm<\/text>/, '累计值要带 mm 单位（单位为小字号）');
  assert.match(wxml, /\{\{rainImpact\.gradeText\}\}/, '缺少雨量等级 chip');
  assert.match(wxml, /class="impact-grade \{\{rainImpact\.tone\}\}"/, 'chip 需按等级上色');
  assert.match(wxml, /\{\{rainImpact\.metaText\}\}/, '缺少最强小时 / 雨中心一行');
  assert.match(wxml, /\{\{rainImpact\.tip\}\}/, '缺少结论提示');
});

test('降雨影响卡片：拿不到预报时整卡不渲染（宁可不显示）', () => {
  assert.match(wxml, /wx:if="\{\{rainImpact\.ready\}\}"/, '卡片必须以 ready 为渲染前提');
});

test('逐小时预报：每小时加雨量柱，并按雨强上色', () => {
  assert.match(wxml, /class="hour-bar-track"/, '缺少雨量柱轨道');
  assert.match(wxml, /class="hour-bar \{\{item\.rainLevel\}\}"/, '雨量柱需按雨强分档上色');
  assert.match(wxml, /style="height: \{\{item\.rainBar\}\}%"/, '雨量柱高度需按雨量归一化');
});

test('页面接线：模块被引用，且天气与短临任一加载完成后都会重算', () => {
  assert.match(js, /require\('\.\.\/\.\.\/utils\/rainImpact(\.js)?'\)/, '未引用 rainImpact 模块');
  assert.match(js, /rainImpact:\s*\{/, 'data 里缺少 rainImpact');
  assert.match(js, /updateRainImpact\(\)\s*\{/, '缺少 updateRainImpact 实现');
  const calls = (js.match(/this\.updateRainImpact\(\)/g) || []).length;
  assert.ok(calls >= 2, '天气与短临两条链路都要重算（当前 ' + calls + ' 处）：雨中心来自短临');
  // 逐小时条目必须带上柱高与分档
  assert.match(js, /rainBar:\s*rainImpact\.barPercent\(/, '逐小时条目未计算柱高');
  assert.match(js, /rainLevel:\s*rainImpact\.levelOf\(/, '逐小时条目未计算分档');
});

test('新增样式不使用 flex gap，也不使用真机不支持的伪类', () => {
  const blocks = wxss.split('}');
  blocks.forEach((b) => {
    if (!/rain-impact|impact-|hour-bar/.test(b)) return;
    assert.doesNotMatch(b, /(^|[;{\s])gap\s*:/, '不得使用 flex gap: ' + b.trim().slice(0, 60));
    const selector = b.split('{')[0] || '';
    const cleaned = selector.replace(/::(after|before)/g, '');
    assert.ok(!cleaned.includes(':'), '不得使用 ::after/::before 之外的伪类: ' + selector.trim());
  });
});

console.log('未来降雨影响测试通过。');
