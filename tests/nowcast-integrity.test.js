// 乡镇短临预报的可信性测试
//
// 核心口径（本项目吃过「图例与数据不符」的亏，这次锁死）：
//   1. 取数失败的乡镇**绝不能**被当成「无雨」——否则彩云故障时界面会显示「全县无降雨」，是假阴性；
//   2. 「X分钟后开始降雨」必须是真分钟级，不能由 30 分钟一档的概率决定；
//   3. 失败批次不写缓存，避免窗口内反复复用坏结果；
//   4. 失败乡镇的数值必须是 null / 空，界面显示「数据缺失」，绝不显示 0.0mm。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
const T = require(path.join(R, 'cloudfunctions/getWeather/index.js')).__test;
const rainImpact = require(path.join(R, 'utils/rainImpact.js'));
const js = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');
const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxss'), 'utf8');

const T0 = new Date('2020-01-01T00:00:00Z');
const zeros = (n) => new Array(n).fill(0);
const rainFrom = (start, val, n = 120) => zeros(n).map((_, i) => (i >= start ? val : 0));
const rawOk = (precip, probability) => ({ result: { minutely: { precipitation_2h: precip, probability } } });
const allOk = (precip, probability) => T.TOWNSHIPS.map(() => rawOk(precip, probability));

// ==================== 一、分钟级判定 ====================

test('起始时刻：1 分钟强度序列首次达到阈值的那一分钟', () => {
  assert.strictEqual(T.findStartMinute([0, 0, 0.2, 0.4]), 2, '应返回第 2 分钟');
  assert.strictEqual(T.findStartMinute([0.5, 0, 0]), 0, '第一分钟就有雨应返回 0');
  assert.strictEqual(T.findStartMinute([0.05, 0.05, 0.09]), null, '低于阈值不算降雨');
  assert.strictEqual(T.findStartMinute([]), null, '空序列返回 null');
});

test('起始时刻：不再由 30 分钟档的概率决定（本次修复的核心）', () => {
  // 概率两档都很高（旧实现会给出 0 或 30），但真实降雨从第 7 分钟开始
  const r = T.summarizeTownship(rawOk(rainFrom(7, 1.6), [0.9, 0.9]), T.TOWNSHIPS[0]);
  assert.strictEqual(r.startMinute, 7, '必须给出真分钟级起始时刻，实际 ' + r.startMinute);
  assert.strictEqual(r.willRain, true);
  assert.ok(![0, 30, 60, 90, 120].includes(r.startMinute), '不应退化成 30 分钟档');
});

test('最强时刻：取强度最大的那一分钟', () => {
  const series = zeros(120);
  series[45] = 9;
  const r = T.summarizeTownship(rawOk(series, [0.5, 0.5]), T.TOWNSHIPS[0]);
  assert.strictEqual(r.peakMinute, 45, '最强时刻应为第 45 分钟');
  assert.strictEqual(T.findPeakMinute(zeros(120)), null, '全 0 时最强时刻为 null');
});

test('有数据但无降雨：ok 为真、雨量为 0，属于「真无雨」而不是「数据缺失」', () => {
  const r = T.summarizeTownship(rawOk(zeros(120), [0.1, 0.1]), T.TOWNSHIPS[0]);
  assert.strictEqual(r.ok, true, '取到数据就是 ok');
  assert.strictEqual(r.willRain, false);
  assert.strictEqual(r.startMinute, null);
  assert.strictEqual(r.totalRain, 0, '真无雨时累计应为 0，而不是 null');
  // 旧实现会退回 frames[0].minute，于是「全县无雨」的乡镇被写成「第 0 分钟最强」
  assert.strictEqual(r.peakMinute, null, '无雨时不得给出「第 0 分钟最强」的假结论');
  assert.strictEqual(T.summarizeTownship(rawOk(zeros(120), null), T.TOWNSHIPS[0]).peakMinute, null, '和风（不给概率）同样不得给出时刻');
});

// ==================== 二、取数失败必须是「数据缺失」 ====================

test('取数失败：ok=false 且所有数值为 null（绝不冒充 0mm「无雨」）', () => {
  const r = T.summarizeTownship({ __error: 'timeout' }, T.TOWNSHIPS[0]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.totalRain, null, 'totalRain 必须是 null 而不是 0');
  assert.strictEqual(r.willRain, null, 'willRain 必须是 null，三态不能退化成两态');
  assert.strictEqual(r.peakProb, null);
  assert.strictEqual(r.peakMinute, null);
  assert.deepStrictEqual(r.frames, []);
  assert.strictEqual(T.summarizeTownship({ result: { minutely: {} } }, T.TOWNSHIPS[0]).ok, false, '缺字段也算失败');
});

test('聚合：部分乡镇失败时给出 okCount / failedCount / degraded', () => {
  const mixed = T.TOWNSHIPS.map((_, i) => (i < 3 ? { __error: 'ECONNREFUSED' } : rawOk(rainFrom(20, 2), [0.8, 0.8])));
  const r = T.aggregateNowcast(mixed, T0);
  assert.strictEqual(r.townshipCount, 12);
  assert.strictEqual(r.okCount, 9);
  assert.strictEqual(r.failedCount, 3);
  assert.strictEqual(r.degraded, true, '有失败即降级');
  assert.strictEqual(r.success, true, '还有正常乡镇，整体仍算成功');
  assert.strictEqual(r.townships.length, 12, '失败的乡镇也要留在列表里，由界面标注');
  assert.strictEqual(r.townships[0].ok, false);
  assert.strictEqual(r.townships[3].ok, true);
  assert.strictEqual(r.townships[3].startMinute, 20);
});

test('聚合：全部失败时 success 必须是 false（旧实现恒为 true，界面会显示「全县无降雨」）', () => {
  const r = T.aggregateNowcast(T.TOWNSHIPS.map(() => ({ __error: 'ETIMEDOUT' })), T0);
  assert.strictEqual(r.success, false, '全军覆没必须报失败，否则前端无法区分「无雨」和「拿不到数据」');
  assert.strictEqual(r.okCount, 0);
  assert.strictEqual(r.failedCount, 12);
  assert.strictEqual(r.degraded, true);
  assert.ok(r.townships.every((t) => t.ok === false && t.totalRain === null), '每个乡镇都必须是数据缺失');
});

test('聚合：全部正常时 degraded 为 false', () => {
  const r = T.aggregateNowcast(allOk(rainFrom(30, 1), [0.6, 0.6]), T0);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.degraded, false);
  assert.strictEqual(r.okCount, 12);
  assert.strictEqual(r.failedCount, 0);
  assert.strictEqual(r.townships[0].ok, true);
});

test('缓存策略：只有正常乡镇过半才写缓存', () => {
  assert.strictEqual(T.shouldCacheNowcast(12, 12), true);
  assert.strictEqual(T.shouldCacheNowcast(7, 12), true, '7/12 过半可缓存');
  assert.strictEqual(T.shouldCacheNowcast(6, 12), false, '正好一半不缓存');
  assert.strictEqual(T.shouldCacheNowcast(1, 12), false);
  assert.strictEqual(T.shouldCacheNowcast(0, 12), false);
});

test('时间口径：issueTime 是实际取数时刻，窗口对齐时刻另存 windowTime', () => {
  const r = T.aggregateNowcast(allOk(zeros(120), [0.1, 0.1]), T0);
  assert.match(r.issueTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'issueTime 格式应为北京时间 YYYY-MM-DD HH:mm');
  assert.match(r.windowTime, /^2020-01-01 08:00$/, 'windowTime 应为窗口对齐时刻（北京时）');
  assert.notStrictEqual(r.issueTime, r.windowTime, '取数时刻不能等同于窗口对齐时刻');
  assert.strictEqual(r.source, 'caiyun');
});

// ==================== 三、前端三态接线 ====================

test('前端：success=false 必须抛错，绝不降级展示成「无降雨」', () => {
  assert.match(js, /nowcast\.success === false/, 'loadNowcast 必须检查 success');
  assert.match(js, /短临预报数据获取失败/, '缺少失败文案');
  assert.match(js, /throw new Error\('短临预报数据获取失败'\)/, '缺少抛错分支');
  assert.match(js, /!list\.length/, '空列表也必须按失败处理');
});

test('前端：失败乡镇标记 dataMissing，且不再输出 0.0mm', () => {
  assert.match(js, /dataMissing: !okTown/, '缺少 dataMissing 标记');
  assert.match(js, /totalRainText: okTown \?/, 'totalRainText 必须按 ok 分支');
  assert.doesNotMatch(js, /totalRainText: \(t\.totalRain \|\| 0\)\.toFixed\(1\)/, '不得无条件把失败乡镇写成 0.0mm');
  assert.match(js, /failedCount/, '需要读取 failedCount');
});

test('前端：起始时刻文案区分「暂无降雨 / 当前正在降雨 / N 分钟后」', () => {
  assert.match(js, /return '暂无降雨'/);
  assert.match(js, /return '当前正在降雨'/, 'startMinute 为 0 时应显示正在降雨，而不是「0分钟后」');
  assert.match(js, /t\.startMinute \+ '分钟后开始降雨'/);
});

test('前端：完整性文案与时间标签', () => {
  assert.match(js, /function formatIssueTimeText\(/, '缺少时间标签助手');
  assert.match(js, /'更新于 '/, '时间标签应明确是取数时刻');
  assert.match(js, /个乡镇中 .* 个取数失败/, '缺少部分缺失文案');
  assert.match(js, /个乡镇数据正常/, '缺少完整数据文案');
  assert.match(js, /issueTimeText: formatIssueTimeText/, 'data 未接线到时间标签');
  assert.match(js, /integrityText:/, 'data 未接线到完整性文案');
  assert.match(js, /nowcastDegraded/, '下拉刷新应区分部分缺失');
});

test('页面：三态分支齐备，失败乡镇的数值块被隐藏', () => {
  const card = wxml.match(/class="township-forecast[\s\S]*?provider-info/);
  assert.ok(card, '找不到短临卡片');
  assert.match(card[0], /<text wx:if="\{\{item\.dataMissing\}\}">数据缺失<\/text>/, '缺少「数据缺失」态');
  assert.match(card[0], /item\.dataMissing \? 'missing'/, '缺少 missing 样式分支');
  assert.match(card[0], /wx:if="\{\{!item\.dataMissing\}\}"/, '数值块必须在有数据时才显示');
  assert.match(card[0], /township-missing" wx:else/, '缺少缺失说明行');
  assert.match(card[0], /nowcast-integrity/, '缺少完整性提示行');
  assert.match(card[0], /\{\{nowcast\.issueTimeText\}\}/, '标题时间未接线');
  assert.match(card[0], /未取到该乡镇的短临数据/, '缺少缺失说明文案');
});

test('样式：新增区不使用 flex gap，也不使用 ::after/::before 之外的伪类', () => {
  const region = wxss.split('短临数据完整性')[1] || '';
  assert.ok(region.trim().length > 0, '找不到新增样式区');
  assert.doesNotMatch(region, /(^|[;{\s])gap\s*:/, '不得使用 flex gap');
  region.split('}').forEach((b) => {
    const selector = (b.split('{')[0] || '').replace(/::(after|before)/g, '');
    assert.ok(!selector.includes(':'), '不得使用真机不支持的伪类: ' + selector.trim());
  });
  assert.match(wxss, /\.township-status\.missing\{/, '缺少 missing 徽标样式');
});

test('文案：不出现「关注 / 预警 / 风险 / 态势」一类措辞', () => {
  const copy = [
    (js.match(/integrityText:[\s\S]{0,260}/) || [''])[0],
    (js.match(/function startTextOf\([\s\S]{0,280}/) || [''])[0],
    (wxml.match(/class="township-forecast[\s\S]*?provider-info/) || [''])[0]
  ].join('\n');
  assert.ok(copy.length > 0, '取不到新增文案');
  assert.doesNotMatch(copy, /关注|预警|风险|态势/);
});

test('雨中心：取数失败的乡镇不参与（不按 0mm 计入，也不会被选作雨中心）', () => {
  const list = [
    { name: '甲镇', totalRain: null, ok: false },
    { name: '乙镇', totalRain: 3.2, ok: true },
    { name: '丙镇', totalRain: 1.1, ok: true }
  ];
  const center = rainImpact.rainCenter(list);
  assert.strictEqual(center.name, '乙镇', '应是最大值且 ok 的乡镇');
  assert.strictEqual(center.mm, 3.2);
  assert.strictEqual(rainImpact.rainCenter([{ name: '甲镇', totalRain: null, ok: false }]), null, '全是失败时不给雨中心');
});

console.log('乡镇短临可信性测试通过。');
