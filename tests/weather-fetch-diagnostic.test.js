// 天气取数失败的「如实可辨」测试
//
// 背景：页面此前只显示「暂未获取到天气数据」，看不出是「request 合法域名没配」、
//       「网络不通」、还是「上游彩云限流（429）」——排查时只能猜。
//       本测试锁住三件事：
//         1. 失败原因必须能从提示里直接读出来；
//         2. 失败提示不得暗示「没有降雨」；
//         3. 上游限流要有配额保护，且回落旧数据必须有期限（宁可不显示，也不显示错值）。
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
const api = require(path.join(R, 'utils/api.js'));
const config = require(path.join(R, 'utils/config.js'));
const rainJs = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.js'), 'utf8');
const rainWxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');
const indexJs = fs.readFileSync(path.join(R, 'pages/index/index.js'), 'utf8');
const layerRadar = fs.readFileSync(path.join(R, 'utils/layerRadar.js'), 'utf8');
const layerWind = fs.readFileSync(path.join(R, 'utils/layerWind.js'), 'utf8');
const fcSrc = fs.readFileSync(path.join(R, 'cloudfunctions/getWeather/index.js'), 'utf8');

// ==================== 一、原因翻译 ====================

test('api 导出 describeError', () => {
  assert.strictEqual(typeof api.describeError, 'function', '必须导出 describeError，供页面把原因上屏');
});

test('域名未配置能被直接认出来（开发工具原文：request:fail url not in domain list）', () => {
  const s = api.describeError({ errMsg: 'request:fail url not in domain list' });
  assert.ok(/合法域名|域名/.test(s), '应点明域名问题，实际：' + s);
  assert.ok(!/^request:fail/.test(s), '不应把原始噪音直接抛给用户，实际：' + s);
});

test('上游限流（429 / Rate limit）能被直接认出来', () => {
  assert.ok(/超限/.test(api.describeError(new Error('HTTP错误: 429 · 彩云天气访问频率超限'))));
  assert.ok(/超限/.test(api.describeError(new Error('HTTP错误: 500 · 天气数据获取失败 · HTTPS 429: Rate limit exceeded'))),
    '限流被包在 500 里时也必须能认出来');
  assert.ok(/超限/.test(api.describeError(new Error('Rate limit exceeded'))));
  assert.ok(/超限/.test(api.describeError(new Error('Too Many Requests'))));
  ['HTTP错误: 429 · 彩云天气访问频率超限', 'Rate limit exceeded', 'Too Many Requests'].forEach((raw) => {
    const out = api.describeError(new Error(raw));
    assert.ok(!/上游|接口/.test(out), '面向用户的错误文案不得出现「上游 / 接口」，实际：' + out);
  });
});

test('超时 / 中断 / 接口报错 / 解析失败 各自可辨', () => {
  assert.ok(/超时/.test(api.describeError({ errMsg: 'request:fail timeout' })));
  assert.ok(/中断/.test(api.describeError({ errMsg: 'request:fail abort' })));
  const http = api.describeError(new Error('HTTP错误: 503'));
  assert.ok(/503/.test(http), '接口报错应保留状态码，实际：' + http);
  assert.ok(/格式/.test(api.describeError(new Error('响应解析失败'))));
});

test('兜底不吞掉信息', () => {
  assert.ok(api.describeError({ errMsg: 'request:fail' }).length > 0, '未知错误也要给出非空说明');
  assert.ok(api.describeError(null).length > 0, '空错误也要给出非空说明');
  assert.ok(api.describeError(new Error('很长的自定义错误'.repeat(10))).length <= 60, '超长信息应截断');
});

test('正则未被转义破坏（曾因 patch 脚本模板字面量吃掉反斜杠）', () => {
  const fn = api.describeError.toString();
  assert.ok(/\\s\*|\\s\+/.test(fn), 'describeError 里应保留 \\s 转义：' + fn.slice(0, 40));
  assert.ok(!/[^\\a-zA-Z]s\*\(/.test(fn), '不应出现被吃掉反斜杠的 s*( ：' + fn);
  assert.ok(!/\^Error:s\*/.test(fn), '不应出现被吃掉反斜杠的 ^Error:s*');
  assert.strictEqual(api.describeError(new Error('Error: 自定义')), '自定义', '^Error:\\s* 应能剥掉前缀');
});

// ==================== 二、页面把原因显示出来 ====================

test('天气页失败时把原因放进提示文案', () => {
  assert.ok(/typeof api\.describeError === 'function'/.test(rainJs), '天气页必须调用 describeError');
  assert.ok(/weatherErrorMessage:\s*'暂未获取到天气数据'\s*\+\s*\(reason/.test(rainJs),
    '提示应带上原因（域名/网络/接口），而不是只说“暂未获取到天气数据”');
});

test('首页天气同样把原因显示出来', () => {
  assert.ok(/typeof api\.describeError === 'function'/.test(indexJs), '首页天气也必须调用 describeError');
  assert.ok(/weatherErrorMessage:\s*'暂未获取到天气数据'\s*\+\s*\(reason/.test(indexJs));
});

test('短临失败也显示原因（模板渲染 nowcastErrorMessage）', () => {
  assert.ok(/nowcastErrorMessage: ''/.test(rainJs), 'data 需有 nowcastErrorMessage 初值');
  assert.ok(/nowcastErrorMessage:\s*reason\s*\?/.test(rainJs), 'catch 里应写入原因');
  assert.ok(/wx:if="\{\{nowcastErrorMessage\}\}"/.test(rainWxml), 'wxml 需渲染 nowcastErrorMessage');
});

test('失败提示不得暗示“没有降雨 / 数据正常”', () => {
  const lines = rainJs.split('\n');
  const i = lines.findIndex((l) => /weatherErrorMessage: '暂未获取到天气数据'/.test(l));
  assert.ok(i > 0, '未定位到天气失败提示');
  const block = lines.slice(Math.max(0, i - 6), i + 6).join('\n');
  assert.ok(!/无雨|正常|晴|无降水/.test(block),
    '取数失败必须与“没有降雨”区分开，不得暗示无雨：\n' + block);
});

// ==================== 三、云函数侧的上游配额保护 ====================

test('云函数侧有配额保护：按坐标缓存 + 限流退避 + 有限期回落', () => {
  assert.ok(/WEATHER_CACHE_TTL\s*=/.test(fcSrc), '缺少成功结果缓存 TTL');
  assert.ok(/weatherCache/.test(fcSrc), '缺少结果缓存');
  assert.ok(/upstreamBlockUntil/.test(fcSrc) && /UPSTREAM_BACKOFF_MS/.test(fcSrc), '缺少限流退避');
  assert.ok(/isRateLimited/.test(fcSrc), '缺少限流判定');
  assert.ok(/serveStale/.test(fcSrc) && /stale: true/.test(fcSrc), '回落结果必须标记 stale，由时间戳体现新旧');
  assert.ok(/respond\(429,/.test(fcSrc), '限流应如实返回 429，而不是笼统的 500');
});

test('回落有期限：旧预报不得无限期顶上（宁可不显示，也不显示错值）', () => {
  const m = fcSrc.match(/WEATHER_STALE_MAX\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  assert.ok(m, '未找到 WEATHER_STALE_MAX');
  const staleMax = Number(m[1]) * Number(m[2]) * Number(m[3]);
  assert.ok(staleMax > 0 && staleMax <= 60 * 60 * 1000, '回落上限应在 1 小时以内，实际 ' + staleMax + 'ms');

  const t = fcSrc.match(/WEATHER_CACHE_TTL\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  assert.ok(t, '未找到 WEATHER_CACHE_TTL');
  const ttl = Number(t[1]) * Number(t[2]) * Number(t[3]);
  assert.ok(ttl > 0 && ttl <= staleMax, '缓存 TTL 应不长于回落上限，实际 ' + ttl + 'ms');
});

test('回落与限流都必须带上人类可读的说明', () => {
  assert.ok(fcSrc.indexOf("serveStale('数据源访问频率超限，以下为上次成功结果')") >= 0, '回落时应说明原因');
  assert.ok((fcSrc.match(/serveStale\('数据源访问频率超限，以下为上次成功结果'\)/g) || []).length >= 3, '三处回落都要说明原因');
  assert.ok(fcSrc.indexOf("message: '彩云天气访问频率超限'") >= 0, '无可用结果时应说明原因');
  assert.ok(fcSrc.indexOf('retryAfterSec') >= 0, '限流时应给出重试建议时间');
});

// ==================== 四、需要配置的合法域名清单（锁住，便于核对） ====================

test('三个云函数域名都是 https 且指向 fcapp.run', () => {
  const urls = [config.ALIYUN_FUNCTION_STATIONS_URL, config.ALIYUN_FUNCTION_HISTORY_URL, config.ALIYUN_FUNCTION_WEATHER_URL];
  urls.forEach((u) => {
    assert.ok(/^https:\/\/[a-z0-9-]+\.cn-shenzhen\.fcapp\.run$/.test(u), '云函数域名格式异常：' + u);
  });
  assert.ok(urls.includes('https://zf-getweather-sgxbwutnwe.cn-shenzhen.fcapp.run'), '天气云函数域名应与线上一致');
});

test('图层另有三个域名（request × 2 + downloadFile × 1），文案已提示需配域名', () => {
  assert.ok(/https:\/\/api\.rainviewer\.com\/public\/weather-maps\.json/.test(layerRadar),
    '雷达元数据取自 api.rainviewer.com（需加入 request 合法域名）');
  assert.ok(/api\.open-meteo\.com/.test(layerWind), '风场取自 api.open-meteo.com（需加入 request 合法域名）');
  assert.ok(/wx\.downloadFile/.test(rainJs), '雷达瓦片走 downloadFile（需把元数据返回的 host，即 tilecache.rainviewer.com，加入 downloadFile 合法域名）');
  assert.ok(/合法域名/.test(rainJs), '图层失败文案应提示检查合法域名配置');
});
