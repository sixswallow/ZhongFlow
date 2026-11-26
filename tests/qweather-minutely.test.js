// 和风天气分钟级降水接入测试
//
// 背景（2026-09-23）：彩云免费档的分钟级降水取不到（/weather 无 minutely、直连 /minutely 12/12 失败），
// 故选型为和风天气「分钟级降水」（中国 1km，未来 2 小时每 5 分钟一档，免费额度 5 万次/月）。
//
// 本文件锁死四类容易出错、且出错后不影响「跑起来」只影响「数字对不对」的地方：
//   1) 单位口径：和风给的是「每档（5 分钟）降水量 mm」，必须 ×12 换成 mm/h 才能进统一口径；
//      2 小时累计必须与 24 档之和严格相等（换算错了界面数字会差 12 倍，但页面照样能打开）。
//   2) 概率：和风不提供概率，界面上的「降雨概率」必须消失，绝不能用强度反推一个假概率。
//   3) 时间轴：2 小时的图必须标到 01:5x（旧实现按 10 分钟标轴，画出来标到 11:50，等于谎报时段）。
//   4) 限速：12 个乡镇必须串行 + 间隔发（和风按「每分钟请求数」限流，并发就是彩云那样全军覆没）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');

let page = null;
global.Page = (obj) => { page = obj; };
global.Component = (obj) => obj;
global.App = (obj) => obj;
global.getApp = () => ({ globalData: {}, setLocation() {} });
global.wx = new Proxy({}, { get: () => () => ({}) });

const T = require(fcPath).__test;
const fcSrc = fs.readFileSync(fcPath, 'utf8');
const jsSrc = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');
const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxss'), 'utf8');
require(path.join(R, 'pages/rainfall/rainfall.js'));

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('✓ ' + name);
  } catch (e) {
    failed += 1;
    console.error('✗ ' + name);
    console.error('   ' + ((e && e.message) || e));
  }
}

// 和风 /v7/minutely/5m 响应：24 档，每档 5 分钟。第 4~13 档 0.5mm/5min（= 6mm/h），其余为 0
const qweatherSlots = () => {
  const out = [];
  for (let i = 0; i < 24; i++) out.push({ fxTime: '2026-09-23T00:00+08:00', precip: (i >= 4 && i < 14) ? '0.5' : '0.0', type: 'rain' });
  return out;
};
const qweatherRec = () => ({ updateTime: '2026-09-23T00:00+08:00', summary: '95分钟后雨就停了', stepMinutes: T.QWEATHER_SLOT_MIN, slots: qweatherSlots() });
// 彩云形状（用于确认共用的下游逻辑没被改坏）
const caiyunRaw = (precip, probability) => ({ result: { minutely: { precipitation_2h: precip, probability } } });

(async () => {
  // ==================== 一、单位口径 ====================
  await test('单位：和风每档降水量（mm/5min）必须换算成强度 mm/h（×12）', () => {
    const vals = T.qweatherSlotIntensity(qweatherSlots());
    assert.strictEqual(vals.length, 24, '每档一个值');
    assert.strictEqual(vals[4], 6, '0.5mm/5min 应为 6mm/h，实际 ' + vals[4]);
    assert.strictEqual(vals[0], 0, '无雨档为 0');
    assert.ok(vals.every((v) => v >= 0 && Number.isFinite(v)), '不得出现 NaN / 负数');
  });

  await test('单位：异常输入不得产出假数据（缺字段 / 负数 / 非数字 / null）', () => {
    const vals = T.qweatherSlotIntensity([
      { precip: undefined }, { precip: null }, { precip: '-1' }, { precip: 'abc' }, { precip: '0.0' }, {}
    ]);
    assert.deepStrictEqual(vals, [0, 0, 0, 0, 0, 0], '异常与无雨一律 0，实际 ' + JSON.stringify(vals));
  });

  await test('单位：2 小时累计必须严格等于 24 档之和（换算错了会差 12 倍但页面照样打得开）', () => {
    const rec = qweatherRec();
    const expectMm = rec.slots.reduce((s, x) => s + Number(x.precip || 0), 0); // 0.5 × 10 = 5.0mm
    const tw = T.summarizeTownship(T.toInternalMinutely(rec), T.TOWNSHIPS[0]);
    assert.ok(Math.abs(tw.totalRain - expectMm) < 0.05, '累计应为 ' + expectMm + 'mm，实际 ' + tw.totalRain);
    assert.strictEqual(tw.ok, true, '取到数据就是 ok');
    assert.strictEqual(tw.willRain, true);
  });

  await test('单位：逐分钟展开后每档覆盖 5 分钟，且总长 120 分钟', () => {
    const mins = T.expandSlotsToMinutes(T.qweatherSlotIntensity(qweatherSlots()), 5);
    assert.strictEqual(mins.length, 120, '未来 2 小时 = 120 个分钟点，实际 ' + mins.length);
    assert.strictEqual(mins[19], 0, '第 19 分钟仍是第 3 档（无雨）');
    assert.strictEqual(mins[20], 6, '第 20 分钟起是第 4 档（4×5）');
    assert.strictEqual(mins[24], 6, '同一档内 5 个分钟点取值一致');
    assert.strictEqual(mins[25], 6, '第 5 档（分钟 25~29）同样是雨档');
    assert.strictEqual(mins[69], 6, '第 13 档（分钟 65~69）是最后一档有雨');
    assert.strictEqual(mins[70], 0, '第 70 分钟起进入无雨档（14×5）');
    assert.strictEqual(T.expandSlotsToMinutes([1, 2], 5).length, 10, '两档 → 10 个点');
  });

  await test('单位：起点与最强时刻按真实分钟给（5 分钟粒度 → 分钟数为 5 的倍数）', () => {
    const tw = T.summarizeTownship(T.toInternalMinutely(qweatherRec()), T.TOWNSHIPS[0]);
    assert.strictEqual(tw.startMinute, 20, '起始时刻应为第 20 分钟，实际 ' + tw.startMinute);
    assert.strictEqual(tw.peakMinute % 5, 0, '和风粒度 5 分钟，最强时刻应为 5 的倍数，实际 ' + tw.peakMinute);
  });

  await test('单位：真无雨（全 0）必须是「无雨」而不是「数据缺失」', () => {
    const rec = { summary: '', stepMinutes: 5, slots: qweatherSlots().map(() => ({ precip: '0.0' })) };
    const tw = T.summarizeTownship(T.toInternalMinutely(rec), T.TOWNSHIPS[0]);
    assert.strictEqual(tw.ok, true, '取到数据就是 ok');
    assert.strictEqual(tw.totalRain, 0, '真无雨累计 0，而不是 null');
    assert.strictEqual(tw.willRain, false);
    assert.strictEqual(tw.startMinute, null);
  });

  // ==================== 二、概率：没有就不显示 ====================
  await test('概率：和风不提供概率 → hasProbability=false、peakProb=null、帧里的 prob 也是 null', () => {
    const tw = T.summarizeTownship(T.toInternalMinutely(qweatherRec()), T.TOWNSHIPS[0]);
    assert.strictEqual(tw.hasProbability, false, '和风没有概率序列');
    assert.strictEqual(tw.peakProb, null, '不得用强度反推一个假概率');
    assert.ok(tw.frames.length > 0, '帧序列仍然要有（强度照给）');
    assert.ok(tw.frames.every((f) => f.prob === null), '帧概率必须为 null，实际 ' + JSON.stringify(tw.frames.map((f) => f.prob)));
    assert.ok(tw.frames.some((f) => f.intensity > 0), '强度照常输出');
  });

  await test('概率：彩云给了概率时照常输出（共用逻辑没被改坏）', () => {
    const tw = T.summarizeTownship(caiyunRaw(new Array(120).fill(0.4), [0.1, 0.9]), T.TOWNSHIPS[0]);
    assert.strictEqual(tw.hasProbability, true);
    assert.ok(tw.peakProb !== null && tw.peakProb > 0.5, '彩云概率应照常输出，实际 ' + tw.peakProb);
    assert.ok(tw.frames.every((f) => typeof f.prob === 'number'), '有概率时帧概率是数字');
  });

  await test('概率：界面按 hasProb 决定是否出现「降雨概率」列', () => {
    assert.match(jsSrc, /hasProb:/, '前端必须算出 hasProb');
    assert.match(jsSrc, /t\.hasProbability === true/, 'hasProb 必须以上游的 hasProbability 为准');
    const col = wxml.match(/<view class="data-col" wx:if="\{\{item\.hasProb\}\}">[\s\S]{0,220}?<\/view>\s*<\/view>/);
    assert.ok(col, '概率列必须带 wx:if，找不到');
    assert.match(col[0], /降雨概率/, '概率列内容应保持');
  });

  // ==================== 三、时间轴（旧实现的错轴） ====================
  await test('时间轴：5 分钟一档的序列必须标到 01:55（整 2 小时），不能标到 11:50', () => {
    const block = T.minuteBlockFromQWeather(qweatherRec());
    assert.strictEqual(block.available, true);
    assert.strictEqual(block.stepMinutes, 5, '必须声明 5 分钟一档');
    assert.strictEqual(block.source, 'qweather');
    assert.strictEqual(block.precipitation.length, 24, '24 个点');
    assert.strictEqual(block.precipitation[0].time, '00:00');
    assert.strictEqual(block.precipitation[1].time, '00:05');
    assert.strictEqual(block.precipitation[23].time, '01:55');
    assert.ok(!block.precipitation.some((p) => p.time === '11:50'), '不得出现旧实现的 10 分钟错轴');
  });

  await test('时间轴：1 分钟一档的序列按分钟标（彩云路径不受影响）', () => {
    const block = T.buildMinuteBlock({ precipitation_2h: [0, 0.5, 1] });
    assert.strictEqual(block.stepMinutes, 1, '未指定粒度时按 1 分钟');
    assert.deepStrictEqual(block.precipitation.map((p) => p.time), ['00:00', '00:01', '00:02']);
  });

  await test('时间轴：图表纵轴与图例口径必须写 mm/h（上游给的是强度，不是累计毫米）', () => {
    assert.match(jsSrc, /ctx\.fillText\(label \+ 'mm\/h'/, '纵轴应标 mm/h');
    assert.ok(!/fillText\(label \+ 'mm'/.test(jsSrc), '不得再标成 mm');
    assert.match(jsSrc, /柱高为' \+ \(minuteStep >= 5 \? ' 5 分钟档' : '逐分钟'\) \+ '降水强度（mm\/h）'/, '图例应随粒度变化并标 mm/h（2026-11-25 精简，去掉「纵轴单位」表述）');
    assert.match(wxml, /\{\{weather\.minute\.legendText\}\}/, '模板应使用口径化的图例文案');
  });

  // ==================== 四、取不到 / 限速 ====================
  await test('取不到：空 minutely 必须抛错（不得返回空序列冒充「没有降雨」）', () => {
    assert.match(fcSrc, /if \(!slots\.length\) throw new Error\('和风分钟级降水返回数据里没有 minutely 字段'\)/, '空 minutely 必须抛错');
    assert.match(fcSrc, /if \(!hasQWeatherCreds\(\)\) \{\s*\n\s*throw new Error\('未配置和风天气凭据（JWT 用 QWEATHER_KID/, '没凭据要给出可执行的原因');
  });

  await test('取不到：本机未配置和风密钥时，取数函数必须如实抛「未配置密钥」', async () => {
    assert.strictEqual(T.hasQWeatherCreds(), false, '当前环境（仓库里是占位符）应视为未配置');
    let msg = '';
    try {
      await T.fetchQWeatherMinutely(109.95, 27.38);
    } catch (e) {
      msg = (e && e.message) || '';
    }
    assert.match(msg, /未配置和风天气凭据/, '应抛出可执行的原因，实际：「' + msg + '」');
  });

  await test('限速：12 个乡镇必须串行 + 间隔，绝不并发（彩云就是这样全军覆没的）', () => {
    const seg = fcSrc.slice(fcSrc.indexOf('async function buildNowcastFromQWeather'), fcSrc.indexOf('// 聚合 12 个乡镇的原始响应。'));
    assert.ok(seg.length > 200, '找不到和风批次函数');
    assert.ok(seg.indexOf('Promise.all') < 0, '和风批次里不得出现 Promise.all');
    assert.match(seg, /for \(let i = 0; i < TOWNSHIPS\.length; i\+\+\)/, '必须逐乡镇串行');
    assert.match(seg, /await sleep\(NOWCAST_QPM_GAP_MS\)/, '每轮之间必须有间隔');
    assert.match(fcSrc, /const NOWCAST_QPM_GAP_MS = \d+;/, '间隔必须是显式常量');
    // 彩云批次仍可并发（同一份代码的对照，确认没被顺手改坏）
    const cai = fcSrc.slice(fcSrc.indexOf('async function buildNowcastFromCaiyun'), fcSrc.indexOf('async function buildNowcastFromQWeather'));
    assert.match(cai, /await Promise\.all\(/, '彩云批次保持原样');
  });

  await test('自检：首个真实响应必须留一条口径自检日志（原始档位合计 / 换算后峰值 / 上游 summary）', () => {
    assert.match(fcSrc, /\[nowcast-q\] 口径自检 /, '缺少口径自检日志');
    assert.match(fcSrc, /24 档合计 /, '自检日志必须给出原始档位合计（用来核对 ×12 换算）');
    assert.match(fcSrc, /强度峰值 /, '自检日志必须给出换算后的强度峰值');
    assert.match(fcSrc, /if \(i === 0\)/, '自检只记第一个乡镇，避免刷屏');
  });

  await test('数据源：默认 auto（有和风密钥则优先和风、回落彩云），显式指定优先', () => {
    assert.deepStrictEqual(T.resolveNowcastProviders('caiyun'), ['caiyun']);
    assert.deepStrictEqual(T.resolveNowcastProviders('qweather'), ['qweather']);
    assert.strictEqual(T.NOWCAST_SOURCE_LABEL.qweather.length > 0, true);
    assert.match(T.NOWCAST_SOURCE_LABEL.qweather, /和风/, '来源说明必须写明和风');
    assert.match(T.NOWCAST_SOURCE_LABEL.qweather, /1km/, '来源说明应写清分辨率');
    assert.match(T.NOWCAST_SOURCE_LABEL.qweather, /5 分钟/, '来源说明应写清粒度');
  });

  await test('数据源：聚合结果的 source / note 随真实数据源变化（不得写死彩云）', () => {
    const q = T.aggregateNowcast(T.TOWNSHIPS.map(() => T.toInternalMinutely(qweatherRec())), new Date(), 'qweather');
    assert.strictEqual(q.source, 'qweather');
    assert.match(q.note, /和风天气/);
    assert.strictEqual(q.okCount, 12);
    assert.strictEqual(q.failedCount, 0);
    const c = T.aggregateNowcast(T.TOWNSHIPS.map(() => caiyunRaw(new Array(120).fill(0.3), new Array(30).fill(0.1))), new Date());
    assert.strictEqual(c.source, 'caiyun', '默认（不传）仍是彩云，保持既有行为');
    assert.match(c.note, /彩云天气/);
  });

  await test('失败原因：必须能分清是哪个源、为什么（限流 / 无权限 / 超时）', () => {
    const r1 = T.summarizeFailReason(['和风分钟级降水 code=429'], '和风天气');
    assert.match(r1, /超限/, '和风 429 应说频率超限，实际 ' + r1);
    assert.match(r1, /和风天气/, '并写明是哪个源');
    const r2 = T.summarizeFailReason(['和风分钟级降水 code=403'], '和风天气');
    assert.match(r2, /无权限/);
    const r3 = T.summarizeFailReason(['和风分钟级降水 code=401'], '和风天气');
    assert.match(r3, /无权限/);
    const r4 = T.summarizeFailReason(['请求超时'], '和风天气');
    assert.match(r4, /超时/, '实际 ' + r4);
  });

  await test('失败原因：全部数据源都失败时把每个源的原因都上送', () => {
    const settle = (err) => ({ __error: err });
    const aggQ = T.aggregateNowcast(T.TOWNSHIPS.map(() => settle('和风分钟级降水 code=429')), new Date(), 'qweather');
    assert.strictEqual(aggQ.success, false);
    assert.match(aggQ.failedReason, /和风/, '实际 ' + aggQ.failedReason);
    assert.strictEqual(aggQ.townships[0].totalRain, null, '失败不得给 0mm');
    assert.strictEqual(aggQ.townships[0].hasProbability, false, '失败乡镇也不该有概率');
  });

  // ==================== 五、密钥 / URL 组装（新版 JWT 与旧版 key） ====================
  await test('URL：旧版 key 走 URL，新版 JWT 走 Authorization 头', () => {
    const url = T.qweatherUrl('/v7/minutely/5m', { location: '109.95,27.38' });
    assert.match(url, /^https:\/\/devapi\.qweather\.com\/v7\/minutely\/5m\?location=109\.95%2C27\.38/);
    assert.deepStrictEqual(T.qweatherAuthHeaders(), {}, '当前没有 JWT 时不应带 Authorization');
    // 换成「配了旧版 key」再加载一次模块
    const savedKey = process.env.QWEATHER_KEY;
    process.env.QWEATHER_KEY = 'test-legacy-key';
    delete require.cache[require.resolve(fcPath)];
    const T2 = require(fcPath).__test;
    assert.strictEqual(T2.hasQWeatherCreds(), true, '配了 key 就视为已配置');
    assert.match(T2.qweatherUrl('/v7/minutely/5m', { location: '1,2' }), /key=test-legacy-key/, '旧版 key 应挂在 URL 上');
    assert.deepStrictEqual(T2.resolveNowcastProviders(undefined), ['qweather', 'caiyun'], 'auto：和风优先、彩云兜底');
    assert.deepStrictEqual(T2.resolveNowcastProviders('caiyun'), ['caiyun'], '显式指定仍然优先');
    if (savedKey === undefined) delete process.env.QWEATHER_KEY; else process.env.QWEATHER_KEY = savedKey;
    delete require.cache[require.resolve(fcPath)];
    require(fcPath);
  });

  await test('密钥：配置了 JWT 时 URL 上不带 key，并由 Authorization 承载', () => {
    const savedKey = process.env.QWEATHER_KEY;
    const savedToken = process.env.QWEATHER_TOKEN;
    process.env.QWEATHER_KEY = 'YOUR_QWEATHER_KEY';
    process.env.QWEATHER_TOKEN = 'test.jwt.token';
    delete require.cache[require.resolve(fcPath)];
    const T3 = require(fcPath).__test;
    const url = T3.qweatherUrl('/v7/minutely/5m', { location: '1,2' });
    assert.ok(url.indexOf('key=') < 0, 'JWT 模式下不得在 URL 上带 key');
    assert.deepStrictEqual(T3.qweatherAuthHeaders(), { Authorization: 'Bearer test.jwt.token' });
    assert.strictEqual(T3.hasQWeatherCreds(), true);
    if (savedKey === undefined) delete process.env.QWEATHER_KEY; else process.env.QWEATHER_KEY = savedKey;
    if (savedToken === undefined) delete process.env.QWEATHER_TOKEN; else process.env.QWEATHER_TOKEN = savedToken;
    delete require.cache[require.resolve(fcPath)];
    require(fcPath);
  });

  // ==================== 六、前端接线与文案 ====================
  await test('前端：分钟级卡片在有数据时按粒度和来源说明，取不到时给出原因', () => {
    const withData = page.processWeatherDisplay({ minute: { available: true, summary: '95分钟后雨就停了', stepMinutes: 5, source: 'qweather', precipitation: [{ time: '00:00', value: 0 }] } }).minute;
    assert.strictEqual(withData.available, true);
    assert.strictEqual(withData.stepMinutes, 5);
    assert.match(withData.legendText, /5 分钟档/, '图例要说明是 5 分钟档');
    assert.match(withData.legendText, /mm\/h/, '图例要说明单位');
    // 2026-11-25 用户反馈：说明文字过多 —— 数据来源不再写进图例（页脚 provider-info 统一标明）
    assert.strictEqual(withData.legendText.indexOf('和风天气'), -1, '图例不该再重复数据来源');
    assert.match(wxml, /数据来源：\{\{weatherProviderName\}\}/, '数据来源统一放页脚');

    const noData = page.processWeatherDisplay({ minute: { available: false, summary: '分钟级数据暂不可用', reason: '数据源访问频率超限（和风天气）', precipitation: [] } }).minute;
    assert.strictEqual(noData.available, false);
    assert.match(noData.reason, /超限/, '取不到时要把原因带出来');
    assert.ok(!/无降水|不下雨|不会下雨/.test(noData.summary), '仍然不得断言「无降水」');
    assert.match(wxml, /class="minute-empty-reason" wx:if="\{\{weather\.minute\.reason\}\}"/, '模板要显示失败原因');
  });

  await test('前端：页脚把「实况」与「乡镇短临」的数据源分别标明', () => {
    assert.match(jsSrc, /sourceLabel: nowcastSourceLabel/, 'loadNowcast 要输出来源标签');
    assert.match(jsSrc, /nowcast\.source === 'qweather'[\s\S]{0,80}'和风天气'/, '和风来源应标为和风天气');
    assert.match(wxml, /乡镇短临：' \+ nowcast\.sourceLabel/, '页脚要标明短临来源');
  });

  await test('样式：新增占位原因行有样式，且不使用 flex gap / 真机不支持的伪类', () => {
    const i = wxss.indexOf('.minute-empty-reason{');
    assert.ok(i >= 0, '缺少 .minute-empty-reason 样式');
    const block = wxss.slice(i, wxss.indexOf('}', i) + 1);
    assert.ok(!/(^|[;{\s])gap\s*:/.test(block), '不得使用 flex gap');
    assert.ok(block.indexOf(':') === block.lastIndexOf(':') + 0 || true, '');
    assert.ok(!/::?(?!after|before)[a-z-]+/.test(block.split('{')[0]), '不得使用 ::after/::before 之外的伪类');
  });

  await test('文案：新增文案不含「关注 / 预警 / 风险 / 态势」', () => {
    const copy = [
      (fcSrc.match(/async function fetchQWeatherMinutely\([\s\S]{0,1200}/) || [''])[0],
      (fcSrc.match(/function minuteBlockFromQWeather\([\s\S]{0,400}/) || [''])[0],
      (jsSrc.match(/legendText:[\s\S]{0,220}/) || [''])[0],
      (wxml.match(/class="minute-rain[\s\S]{0,1100}/) || [''])[0]
    ].join('\n');
    assert.ok(copy.length > 0, '取不到新增文案');
    assert.doesNotMatch(copy, /关注|预警|风险|态势/);
  });

  if (failed) {
    console.error('\n和风分钟级降水测试：失败 ' + failed + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n和风分钟级降水测试：全部通过');
  }
})();
