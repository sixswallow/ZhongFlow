// 天气数据「诚实性」测试
//
// 背景（2026-09-22 线上实测）：
//   1) 彩云免费档的 /weather 响应里没有 minutely 对象，直连 /minutely 的 12 个乡镇也全部失败。
//      旧代码用 `minutely?.description || '未来2小时无降水'` 兜底，于是页面上出现了一句没有任何
//      数据支撑的「无降水」——把「不知道」显示成了「没事」（假阴性）。前端默认值同样如此。
//   2) 短临全部失败时响应只有 ok=false，界面只能说「数据缺失」，说不出「为什么」。
//
// 本文件锁定两条口径：取不到 → 只说「暂不可用」；失败 → 原因可分辨（限流/超时/无权限/其他）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');

// —— 用桩加载页面对象，让测试能直接调用页面方法（比只做源码匹配更有说服力）——
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
const api = require(path.join(R, 'utils/api.js'));
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

// 造一个短临乡镇对象（字段与 cloudfunctions/getWeather 输出一致）
const town = (name, code, ok) => (ok
  ? { code, name, ok: true, peakProb: 0.2, peakMinute: 12, totalRain: 0.4, willRain: true, startMinute: 12 }
  : { code, name, ok: false, peakProb: null, peakMinute: null, totalRain: null, willRain: null, startMinute: null, error: 'HTTPS 429: Rate limit exceeded' });

const fakeThis = () => ({
  data: { location: {}, weather: {}, nowcast: {} },
  setData(o) { Object.assign(this.data, o); },
  updateRainImpact() {},
});

(async () => {
  // ==================== 修复①：取不到分钟级数据 ====================

  await test('① 没有 minutely 时，绝不给出「无降水」结论', () => {
    [undefined, null, {}, { precipitation_2h: [] }, { precipitation_2h: null }].forEach((input) => {
      const block = T.buildMinuteBlock(input);
      assert.strictEqual(block.available, false, '取不到时 available 必须为 false');
      assert.strictEqual(block.precipitation.length, 0, '取不到时不应有数据点');
      assert.deepStrictEqual(block.precipitation, [], '取不到时应是空数组');
      assert.ok(!/无降水|没有雨|不下雨|不会下雨/.test(block.summary), '不得断言「无降水」，实际：' + block.summary);
      assert.strictEqual(block.summary, '分钟级数据暂不可用', '应明确说「暂不可用」');
    });
  });

  await test('① 只有真的拿到序列才 available，且数据点格式正确', () => {
    const block = T.buildMinuteBlock({ description: '未来两小时不会下雨', precipitation_2h: [0, 0.12, 1.5] });
    assert.strictEqual(block.available, true, '拿到序列时 available 应为 true');
    assert.strictEqual(block.summary, '未来两小时不会下雨', '有 description 时沿用上游原文');
    assert.strictEqual(block.precipitation.length, 3, '数据点数量应与序列一致');
    block.precipitation.forEach((p) => {
      assert.ok(/^\d{2}:\d{2}$/.test(p.time), '时间格式应为 HH:MM，实际 ' + p.time);
      assert.ok(typeof p.value === 'number' && Number.isFinite(p.value), '雨量应为有限数字，实际 ' + p.value);
    });
    assert.strictEqual(block.precipitation[1].value, 0.12);
  });

  await test('① 有序列但没有 description 时，也不许编「无降水」', () => {
    const block = T.buildMinuteBlock({ precipitation_2h: [0.2, 0.3] });
    assert.strictEqual(block.available, true);
    assert.ok(!/无降水|不下雨|不会下雨/.test(block.summary), '仍不得断言「无降水」，实际：' + block.summary);
  });

  await test('① 云函数源码里不再有「无降水」类 summary 字面量', () => {
    assert.doesNotMatch(fcSrc, /summary:\s*['"][^'"]*无降水/, '云函数不得再把「无降水」写成 summary');
    assert.doesNotMatch(fcSrc, /\|\|\s*['"]未来2小时无降水['"]/, '旧兜底串必须消失');
    assert.match(fcSrc, /minute: buildMinuteBlock\(minutely\)/, '彩云分支应改用 buildMinuteBlock');
    // 和风分支改写后这句从多行对象变成单行赋值，意图不变：和风分支同样必须先声明「暂不可用」，
    // 而不是先给一个「无降水」的结论。[^}] 可同时匹配单行与多行写法。
    assert.match(fcSrc, /available: false[^}]*summary: '分钟级降水数据暂不可用'/, '和风分支也应带 available:false');
  });

  await test('① 前端页面：缺数据 / 缺字段 / available 与序列不一致，一律「暂不可用」', () => {
    const cases = [
      [{}, '完全没有 minute 字段'],
      [{ minute: {} }, 'minute 是空对象'],
      [{ minute: { available: false, summary: '', precipitation: [] } }, '明确没取到'],
      [{ minute: { available: true, summary: '不会下雨', precipitation: [] } }, 'available 为真但序列为空'],
      [{ minute: { available: true, precipitation: [] } }, '没有 summary'],
    ];
    cases.forEach(([input, label]) => {
      const out = page.processWeatherDisplay(input).minute;
      assert.strictEqual(out.available, false, label + ' → available 应为 false');
      assert.ok(!/无降水|不下雨|不会下雨/.test(out.summary), label + ' → 不得断言「无降水」，实际：' + out.summary);
      assert.ok(out.summary.length > 0, label + ' → 必须给出非空说明');
    });
  });

  await test('① 前端页面：真拿到数据时如实透出', () => {
    const out = page.processWeatherDisplay({ minute: { available: true, summary: '未来两小时不会下雨', precipitation: [{ time: '00:00', value: 0 }] } }).minute;
    assert.strictEqual(out.available, true);
    assert.strictEqual(out.summary, '未来两小时不会下雨');
    assert.strictEqual(out.precipitation.length, 1);
  });

  await test('① 前端默认值不再预置「未来2小时无降水，天气晴好」', () => {
    assert.doesNotMatch(jsSrc, /summary:\s*['"][^'"]*无降水/, 'data 里的默认 summary 不得含「无降水」');
    assert.match(jsSrc, /available: false/, '默认应声明 available:false');
    assert.match(jsSrc, /const precipitation = \(weather\.minute && weather\.minute\.precipitation\) \|\| \[\];/, 'drawRainChart 必须容忍 minute 缺失');
  });

  await test('① 模板：有数据才画图，没数据给明确占位（不是无条件渲染 summary）', () => {
    const card = wxml.match(/class="minute-rain[\s\S]*?<!-- 未来降雨影响/);
    assert.ok(card, '找不到分钟级降水卡片');
    const c = card[0];
    assert.match(c, /class="rain-summary" wx:if="\{\{weather\.minute\.available\}\}"/, 'summary 必须在 available 时才显示');
    assert.match(c, /class="minute-empty" wx:else/, '必须有不带数据的占位态');
    assert.match(c, /无法判断未来 2 小时/, '占位文案要说清「无法判断」（2026-11-25 精简，语义不变）');
    assert.ok(!/class="rain-summary">\{\{weather\.minute\.summary\}\}<\/view>/.test(c), '不得无条件渲染 summary');
    assert.match(c, /<view class="visual-canvas-shell" wx:if="\{\{weather\.minute\.available\}\}">/, '空图表不应渲染');
  });

  await test('① 样式：占位态有样式，且不使用 flex gap / 真机不支持的伪类', () => {
    ['.minute-empty{', '.minute-empty-title{', '.minute-empty-desc{', '.nowcast-reason{'].forEach((sel) => {
      assert.ok(wxss.includes(sel), '缺少样式 ' + sel);
    });
    ['.minute-empty', '.nowcast-reason'].forEach((sel) => {
      const i = wxss.indexOf(sel);
      const block = wxss.slice(i, wxss.indexOf('}', i) + 1);
      assert.ok(!/(^|[;{\s])gap\s*:/.test(block), sel + ' 不得使用 flex gap');
      assert.ok(!sel.includes(':'), sel + ' 不得使用伪类');
    });
  });

  // ==================== 修复②：失败原因可分辨 ====================

  await test('② 失败原因可分辨：限流 / 超时 / 无权限 / 其他', () => {
    assert.match(T.summarizeFailReason(['HTTPS 429: {"status":"failed","error":"Rate limit exceeded"}']), /超限/);
    assert.match(T.summarizeFailReason(['Too Many Requests']), /超限/);
    assert.match(T.summarizeFailReason(['HTTPS timeout']), /超时/);
    assert.match(T.summarizeFailReason(['HTTPS 403: forbidden']), /无权限/);
    assert.match(T.summarizeFailReason(['HTTPS 401: unauthorized']), /无权限/);
    ['HTTPS 429: Rate limit exceeded', 'HTTPS timeout', 'HTTPS 403: forbidden', 'HTTPS 401: unauthorized', 'HTTPS 500: boom']
      .forEach((raw) => {
        const out = T.summarizeFailReason([raw], '和风天气');
        assert.doesNotMatch(out, /上游|接口/, '面向用户的失败原因不得出现「上游 / 接口」这类实现用语，实际：' + out);
      });
    assert.strictEqual(T.summarizeFailReason(['HTTPS 500: 服务异常']), 'HTTPS 500: 服务异常', '其他错误保留原文');
    assert.strictEqual(T.summarizeFailReason([]), '未知原因');
    assert.strictEqual(T.summarizeFailReason(undefined), '未知原因');
  });

  await test('② 单乡镇失败时保留上游原因，字段缺失另有说法', () => {
    const fail = T.summarizeTownship({ __error: 'HTTPS 429: Rate limit exceeded' }, T.TOWNSHIPS[0]);
    assert.strictEqual(fail.ok, false);
    assert.match(fail.error, /429/, '应保留上游原始原因');
    assert.strictEqual(fail.totalRain, null, '失败不得给 0mm');
    const empty = T.summarizeTownship({ result: { minutely: {} } }, T.TOWNSHIPS[0]);
    assert.strictEqual(empty.ok, false);
    assert.match(empty.error, /字段/, '字段缺失要说清是字段缺失');
    const okTown = T.summarizeTownship({ result: { minutely: { precipitation_2h: new Array(120).fill(0.3), probability: new Array(30).fill(0.1) } } }, T.TOWNSHIPS[0]);
    assert.strictEqual(okTown.ok, true);
    assert.strictEqual(okTown.error, '', '成功时不应有错误原因');
  });

  await test('② 聚合：全失败 → success=false 且原因上送', () => {
    const r = T.aggregateNowcast(T.TOWNSHIPS.map(() => ({ __error: 'HTTPS 429: Rate limit exceeded' })), new Date());
    assert.strictEqual(r.success, false, '全军覆没必须是 false');
    assert.strictEqual(r.okCount, 0);
    assert.strictEqual(r.failedCount, 12);
    assert.match(r.failedReason, /超限/, '必须带回人话版失败原因');
    assert.ok(Array.isArray(r.failedReasons) && r.failedReasons.length > 0, '同时保留原始原因便于排查');
  });

  await test('② 聚合：部分失败 → ok 乡镇不受影响，原因同时上送', () => {
    const settled = T.TOWNSHIPS.map((tw, i) => (i < 9 ? { result: { minutely: { precipitation_2h: new Array(120).fill(0.5), probability: new Array(30).fill(0.2) } } } : { __error: 'HTTPS 429: Rate limit exceeded' }));
    const r = T.aggregateNowcast(settled, new Date());
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.okCount, 9);
    assert.strictEqual(r.failedCount, 3);
    assert.strictEqual(r.degraded, true);
    assert.match(r.failedReason, /超限/);
    assert.strictEqual(r.townships[0].ok, true);
    assert.strictEqual(r.townships[11].ok, false);
  });

  await test('② 失败必须留痕：云函数日志里能看出「哪个乡镇、为什么」', () => {
    assert.match(fcSrc, /console\.error\('\[nowcast\] ' \+ tw\.name \+ ' 取数失败 :: '/, '失败要写日志并带上乡镇名与原因');
  });

  await test('② 页面：短临全失败时把云函数的原因显示出来（而不是只说「数据获取失败」）', async () => {
    const ctx = fakeThis();
    api.getNowcast = async () => ({
      success: false,
      failedReason: '数据源访问频率超限（和风天气）',
      failedCount: 12,
      townshipCount: 12,
      townships: T.TOWNSHIPS.map((tw) => town(tw.name, tw.code, false)),
    });
    const okFlag = await page.loadNowcast.call(ctx);
    assert.strictEqual(okFlag, false, '全失败必须进错误态');
    assert.strictEqual(ctx.data.nowcastStatus, 'error');
    assert.match(ctx.data.nowcastErrorMessage, /超限/, '界面必须显示具体原因，实际：' + ctx.data.nowcastErrorMessage);
    assert.ok(!/无雨|无降水/.test(ctx.data.nowcastErrorMessage), '失败提示不得暗示没下雨');
  });

  await test('② 页面：部分失败时给出原因行，整体仍是正常态', async () => {
    const ctx = fakeThis();
    const list = T.TOWNSHIPS.map((tw, i) => town(tw.name, tw.code, i < 9));
    api.getNowcast = async () => ({
      success: true,
      failedCount: 3,
      townshipCount: 12,
      failedReason: '数据源访问频率超限（和风天气）',
      issueTime: '2026-09-22 23:42',
      note: '数据来源：彩云天气分钟级降雨预报 API',
      townships: list,
    });
    const okFlag = await page.loadNowcast.call(ctx);
    assert.strictEqual(okFlag, true);
    assert.strictEqual(ctx.data.nowcastStatus, 'success');
    assert.match(ctx.data.nowcast.failedReasonText, /失败原因：.*超限/, '应显示失败原因行');
    assert.match(ctx.data.nowcast.integrityText, /12 个乡镇中 3 个取数失败/, '完整性文案保持不变');
    assert.match(ctx.data.nowcast.integrityText, /数据缺失/, '缺失乡镇要标注为数据缺失');
    assert.strictEqual(ctx.data.nowcast.townships.filter((t) => t.dataMissing).length, 3);
  });

  await test('② 模板：短临卡片有失败原因行', () => {
    const card = wxml.match(/class="township-forecast[\s\S]*?provider-info/);
    assert.ok(card, '找不到短临卡片');
    assert.match(card[0], /class="nowcast-reason" wx:if="\{\{nowcast\.degraded && nowcast\.failedReasonText\}\}"/, '缺少失败原因行');
  });

  // ==================== 文案口径 ====================

  await test('文案：新增文案不含「关注 / 预警 / 风险 / 态势」', () => {
    const copy = [
      (fcSrc.match(/function summarizeFailReason\([\s\S]{0,700}/) || [''])[0],
      (fcSrc.match(/function buildMinuteBlock\([\s\S]{0,900}/) || [''])[0],
      (jsSrc.match(/failedReasonText:[\s\S]{0,160}/) || [''])[0],
      (wxml.match(/class="minute-rain[\s\S]{0,900}/) || [''])[0],
      (wxml.match(/class="nowcast-reason"[\s\S]{0,120}/) || [''])[0],
    ].join('\n');
    assert.ok(copy.length > 0, '取不到新增文案');
    assert.doesNotMatch(copy, /关注|预警|风险|态势/);
  });

  if (failed) {
    console.error('\n天气诚实性测试：失败 ' + failed + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n天气诚实性测试：全部通过');
  }
})();
