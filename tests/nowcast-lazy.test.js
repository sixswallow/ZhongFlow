// 乡镇短临「按需获取」测试
//
// 背景：短临是 12 个乡镇 = 12 次上游请求，原先页面一打开就取（和风按 QPM 限流，
// 这 12 次是配额消耗的大头）。改为「用户展开短临卡片时才取」。
//
// 本文件锁定四件事：
//   1) 页面打开 / 刷新时不主动取短临（未展开就一次都不打）；
//   2) 展开才取数，收起不取数也不丢数据，5 分钟内重复展开不重复请求；
//   3) 「尚未取数」必须是一个独立状态——不能被显示成「无降雨」，也不能说成「数据缺失」；
//   4) 失败原因、完整性标注、来源标注这些既有口径不能被这次改动破坏。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');

// —— 用桩加载页面对象：比只做源码字符串匹配更有说服力 ——
let page = null;
global.Page = (obj) => { page = obj; };
global.Component = (obj) => obj;
global.App = (obj) => obj;
global.getApp = () => ({ globalData: {}, setLocation() {} });
global.wx = new Proxy({}, { get: () => () => ({}) });

const api = require(path.join(R, 'utils/api.js'));
require(path.join(R, 'pages/rainfall/rainfall.js'));

const jsSrc = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');
const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxss'), 'utf8');
const fcSrc = fs.readFileSync(path.join(R, 'cloudfunctions/getWeather/index.js'), 'utf8');
const T = require(path.join(R, 'cloudfunctions/getWeather/index.js')).__test;

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

const TOWN = (name) => ({ code: name, name, ok: true, peakProb: null, peakMinute: 12, totalRain: 0.4, willRain: true, startMinute: 12 });

// 一个够用的页面上下文：只带短临相关的数据与方法
const makeCtx = (over) => {
  const ctx = {
    data: Object.assign({
      nowcastExpanded: false,
      nowcastStatus: 'idle',
      nowcast: { townships: [], sourceLabel: '', degraded: false, integrityText: '', failedReasonText: '', note: '' },
      location: { latitude: 27.5, longitude: 110.1 }
    }, over || {}),
    fetchCount: 0,
    setDataCalls: [],
    setData(o, cb) { this.setDataCalls.push(o); Object.assign(this.data, o); if (typeof cb === 'function') cb(); },
    updateRainImpact() {},
    nowcastFresh: page.nowcastFresh,
    // 用计数器替身代替真正的网络请求
    loadNowcast() {
      this.fetchCount += 1;
      this.data.nowcastStatus = 'success';
      this.nowcastLoadedAt = Date.now();
      return Promise.resolve(true);
    }
  };
  return ctx;
};

(async () => {
  // ==================== 1. 打开 / 刷新时不取数 ====================

  await test('data 初值：短临是「尚未取数」，且默认未展开', () => {
    assert.strictEqual(page.data.nowcastStatus, 'idle', '初值必须是 idle（尚未取数）');
    assert.notStrictEqual(page.data.nowcastStatus, 'loading', '未取数不能显示成加载中');
    assert.strictEqual(page.data.nowcastExpanded, false, '默认不展开');
    assert.strictEqual(page.data.nowcast.sourceLabel, '', '未取数不得声称数据来源');
    assert.strictEqual(page.data.nowcastErrorMessage, '', '未取数不得预留错误文案');
  });

  await test('loadAllData：未展开时一次都不请求短临', async () => {
    const ctx = {
      data: { weatherStatus: 'idle', weatherErrorMessage: '', nowcastErrorMessage: '', nowcastExpanded: false, nowcastStatus: 'idle', nowcast: { townships: [] } },
      nowcastCalls: 0,
      setData(o, cb) { Object.assign(this.data, o); if (typeof cb === 'function') cb(); },
      nowcastFresh: page.nowcastFresh,
      loadWeather: async () => true,
      initLayer() {},
      loadNowcast() { this.nowcastCalls += 1; return Promise.resolve(true); }
    };
    await page.loadAllData.call(ctx);
    assert.strictEqual(ctx.nowcastCalls, 0, '未展开却请求了短临，实际 ' + ctx.nowcastCalls + ' 次');
  });

  await test('loadAllData：已展开且数据过期时才跟着刷新短临', async () => {
    const mk = (over) => ({
      data: Object.assign({ weatherStatus: 'idle', weatherErrorMessage: '', nowcastErrorMessage: '', nowcastExpanded: true, nowcastStatus: 'success', nowcast: { townships: [TOWN('中方镇')] } }, over),
      nowcastCalls: 0,
      nowcastLoadedAt: 0,
      setData(o, cb) { Object.assign(this.data, o); if (typeof cb === 'function') cb(); },
      nowcastFresh: page.nowcastFresh,
      loadWeather: async () => true,
      initLayer() {},
      loadNowcast() { this.nowcastCalls += 1; return Promise.resolve(true); }
    });
    const fresh = mk({}); fresh.nowcastLoadedAt = Date.now();
    await page.loadAllData.call(fresh);
    assert.strictEqual(fresh.nowcastCalls, 0, '5 分钟内的结果不该重取');
    const stale = mk({}); stale.nowcastLoadedAt = Date.now() - 6 * 60 * 1000;
    await page.loadAllData.call(stale);
    assert.strictEqual(stale.nowcastCalls, 1, '过期了应当跟着刷新一次');
  });

  await test('loadAllData 不会重置展开状态（刷新后短临仍然开着）', () => {
    const body = jsSrc.slice(jsSrc.indexOf('async loadAllData()'), jsSrc.indexOf('nowcastFresh()'));
    assert.doesNotMatch(body, /nowcastExpanded\s*:/, '刷新不得改写展开状态');
    assert.doesNotMatch(body, /nowcastStatus:\s*'loading'/, '刷新不得把短临打回加载中（会清掉已有结果）');
  });

  // ==================== 2. 展开才取数 ====================

  await test('展开：会取一次数', () => {
    const ctx = makeCtx();
    page.onToggleNowcast.call(ctx);
    assert.strictEqual(ctx.data.nowcastExpanded, true, '应变为已展开');
    assert.strictEqual(ctx.fetchCount, 1, '展开应取一次数');
  });

  await test('收起：不取数、也不丢已有数据', () => {
    const ctx = makeCtx({
      nowcastExpanded: true,
      nowcastStatus: 'success',
      nowcast: { townships: [TOWN('中方镇'), TOWN('桐木镇')], sourceLabel: '和风天气', degraded: false }
    });
    ctx.nowcastLoadedAt = Date.now();
    page.onToggleNowcast.call(ctx);
    assert.strictEqual(ctx.data.nowcastExpanded, false, '应变为已收起');
    assert.strictEqual(ctx.fetchCount, 0, '收起不得产生请求');
    assert.strictEqual(ctx.data.nowcast.townships.length, 2, '收起不得丢数据');
    assert.strictEqual(ctx.data.nowcastStatus, 'success', '收起不得改状态');
  });

  await test('新鲜度：5 分钟内再次展开不重复请求', () => {
    const ctx = makeCtx({ nowcastStatus: 'success', nowcast: { townships: [TOWN('中方镇')], sourceLabel: '和风天气' } });
    ctx.nowcastLoadedAt = Date.now() - 60 * 1000;
    page.onToggleNowcast.call(ctx);
    assert.strictEqual(ctx.fetchCount, 0, '5 分钟内的结果直接复用，不该再打上游');
  });

  await test('新鲜度：超过 5 分钟再次展开会重取', () => {
    const ctx = makeCtx({ nowcastStatus: 'success', nowcast: { townships: [TOWN('中方镇')], sourceLabel: '和风天气' } });
    ctx.nowcastLoadedAt = Date.now() - 5 * 60 * 1000 - 1000;
    page.onToggleNowcast.call(ctx);
    assert.strictEqual(ctx.fetchCount, 1, '过期后展开应重取');
  });

  await test('新鲜度：上一次失败后展开必须重试（不能因为有过结果就跳过）', () => {
    const ctx = makeCtx({ nowcastStatus: 'error', nowcast: { townships: [TOWN('中方镇')] } });
    ctx.nowcastLoadedAt = Date.now();
    page.onToggleNowcast.call(ctx);
    assert.strictEqual(ctx.fetchCount, 1, '失败态必须允许重试');
  });

  await test('短临卡片里的「重试」只重取短临，不连带刷新天气', () => {
    const ctx = makeCtx({ nowcastExpanded: true });
    page.onNowcastRefresh.call(ctx);
    assert.strictEqual(ctx.fetchCount, 1, '应只取一次短临');
    const retryTag = (wxml.match(/<view[^>]*class="nowcast-error-retry"[^>]*>/) || [''])[0];
    assert.match(retryTag, /bindtap="onNowcastRefresh"/, '失败卡片的按钮应指向只重取短临的方法');
    assert.doesNotMatch(retryTag, /bindtap="onRefresh"/, '不该连带刷新整个页面');
  });

  await test('loadNowcast：进入时立刻给出「正在获取」，成功时记录取数时刻', async () => {
    const ctx = makeCtx({ nowcastExpanded: true });
    api.getNowcast = async () => ({
      success: true,
      townshipCount: 12,
      failedCount: 0,
      source: 'qweather',
      issueTime: '2026-09-23 14:28',
      note: '数据来源：和风天气分钟级降水 API（1km，5 分钟一档）',
      townships: T.TOWNSHIPS.map((t) => TOWN(t.name))
    });
    const before = Date.now();
    const ok = await page.loadNowcast.call(ctx);
    assert.strictEqual(ok, true);
    assert.strictEqual(ctx.setDataCalls[0].nowcastStatus, 'loading', '第一件事应是置为加载中');
    assert.strictEqual(ctx.data.nowcastStatus, 'success');
    assert.strictEqual(ctx.data.nowcast.townships.length, 12);
    assert.ok(ctx.nowcastLoadedAt >= before, '必须记录取数时刻，否则新鲜度判断失效');
  });

  // ==================== 3. 「尚未取数」不能被误读 ====================

  await test('模板：未展开时显示「尚未获取」，且不含任何降雨结论', () => {
    const idle = (wxml.match(/<view class="nowcast-idle"[\s\S]*?(?=<block wx:if="\{\{nowcastExpanded\}\}">)/) || [''])[0];
    assert.ok(idle, '找不到未展开区块');
    assert.match(idle, /wx:if="\{\{!nowcastExpanded\}\}"/, '未展开区块必须绑定展开状态');
    assert.match(idle, /尚未获取/, '必须明确说「尚未获取」');
    assert.doesNotMatch(idle, /无降雨|无降水|暂无降雨|没下雨|不下雨/, '未取数不得暗示「没事」');
    assert.doesNotMatch(idle, /数据缺失|取数失败/, '未取数不得说成「数据缺失」');
    assert.match(idle, /展开后查看/, '应告诉用户展开能得到什么（面向用户的收益，不是实现细节）');
  assert.doesNotMatch(idle, /请求|额度|上游|接口|12 次/, '未展开文案不得暴露实现细节（请求次数 / 上游额度 / 接口）');
  });

  await test('模板：三种状态互斥且各自可辨（未展开 / 加载中 / 失败）', () => {
    assert.match(wxml, /class="nowcast-idle" wx:if="\{\{!nowcastExpanded\}\}"/, '缺少未展开态');
    assert.match(wxml, /class="nowcast-loading" wx:if="\{\{nowcastStatus === 'loading'\}\}"/, '缺少加载态');
    assert.match(wxml, /class="nowcast-error" wx:if="\{\{nowcastStatus === 'error'\}\}"/, '缺少失败态');
    // 三者条件互不相同：收起时既不是加载中也不是失败
    assert.doesNotMatch(wxml, /class="nowcast-idle" wx:if="\{\{nowcastStatus/, '未展开态不能挂在状态上');
  });

  await test('模板：列表只在真的有数据时渲染（失败时不会出现一张空表）', () => {
    assert.match(wxml, /<block wx:if="\{\{nowcast\.townships && nowcast\.townships\.length > 0\}\}">/, '列表应改由数据是否存在决定');
    const idleToNote = (wxml.match(/class="township-forecast[\s\S]*?provider-info/) || [''])[0];
    assert.match(idleToNote, /nowcast-integrity/, '完整性提示不能被这次改动弄丢');
    assert.match(idleToNote, /\{\{nowcast\.issueTimeText\}\}/, '标题时间不能被这次改动弄丢');
    assert.match(idleToNote, /未取到该乡镇的短临数据/, '缺失说明不能被弄丢');
    assert.match(idleToNote, /class="nowcast-reason" wx:if="\{\{nowcast\.degraded && nowcast\.failedReasonText\}\}"/, '失败原因行不能被弄丢');
    assert.doesNotMatch(idleToNote, /上游|接口/, '短临卡片不得出现「上游 / 接口」这类实现用语');
    assert.ok(idleToNote.indexOf('{{nowcast.note}}') < 0, '卡片内不再重复「数据来源」，只保留页脚一处');
  });

  await test('onRefresh：没展开过只是「本轮没取」，不能提示成「不可用」', () => {
    const body = jsSrc.slice(jsSrc.indexOf('onRefresh()'), jsSrc.indexOf('});', jsSrc.indexOf('onRefresh()')));
    assert.match(body, /const nowcastIdle = this\.data\.nowcastStatus === 'idle';/, 'onRefresh 需识别未展开');
    assert.match(body, /weatherOk && \(nowcastIdle \|\| \(nowcastOk && !nowcastDegraded\)\)[\s\S]{0,80}刷新成功/, '未展开时刷新成功文案');
  });

  // ==================== 4. 可点性 / 样式 / 云函数不变 ====================

  await test('展开入口在真实设备上可点，且触控高度够（≥88rpx）', () => {
    const head = (wxml.match(/<view[^>]*class="[^"]*nowcast-head[^"]*"[^>]*>/) || [''])[0];
    assert.match(head, /bindtap="onToggleNowcast"/, '标题行必须可点');
    assert.match(wxss, /\.nowcast-idle\{[^}]*min-height:88rpx/, '未展开区块需有足够触控高度');
    assert.match(wxss, /\.nowcast-head:active/, '需要按压反馈');
    assert.match(wxss, /\.nowcast-toggle\{/, '缺少展开/收起胶囊样式');
  });

  await test('样式：新增区不用 flex gap，也不用 ::after/::before 之外的伪类', () => {
    const region = wxss.split('乡镇短临：按需获取')[1].split('短临数据完整性')[0];
    assert.ok(region.length > 0, '取不到新增样式区');
    region.split('}').forEach((b) => {
      assert.doesNotMatch(b, /(^|[^-\w])gap\s*:/, '不得使用 flex gap: ' + b.trim().slice(0, 60));
      const selector = (b.split('{')[0] || '').replace(/::(after|before)/g, '');
      assert.ok(!selector.includes(':') || /:active$/.test(selector.trim()), '只允许 :active 与 ::after/::before: ' + selector.trim());
    });
    const idleBlock = wxss.split('短临数据完整性')[1];
    idleBlock.split('}').forEach((b) => {
      const selector = (b.split('{')[0] || '').replace(/::(after|before)/g, '');
      assert.ok(!selector.includes(':'), '原有短临区不得新增伪类: ' + selector.trim());
    });
  });

  await test('文案：新增文案不含「关注 / 预警 / 风险 / 态势」', () => {
    const copy = [
      (wxml.match(/<view class="nowcast-idle"[\s\S]*?(?=<block wx:if="\{\{nowcastExpanded\}\}">)/) || [''])[0],
      (jsSrc.match(/nowcastFresh\(\)[\s\S]{0,400}/) || [''])[0],
      (jsSrc.match(/onToggleNowcast\(\)[\s\S]{0,400}/) || [''])[0],
    ].join('\n');
    assert.doesNotMatch(copy, /关注|预警|风险|态势/);
  });

  await test('云函数不变：仍然一次把 12 个乡镇的短临全取（按需只发生在前端）', () => {
    assert.strictEqual(T.TOWNSHIPS.length, 12, '短临仍是 12 个乡镇');
    assert.match(fcSrc, /async function buildNowcastFromQWeather/, '云函数短临链路不应被改动');
    assert.match(fcSrc, /\[nowcast-q\] 口径自检 /, '云函数口径自检日志不应被改动');
  });

  if (failed) {
    console.error('\n乡镇短临按需获取测试：失败 ' + failed + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n乡镇短临按需获取测试：全部通过');
  }
})();
