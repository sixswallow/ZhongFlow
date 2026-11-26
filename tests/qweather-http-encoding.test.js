/**
 * 和风新 API Host 会「无条件」返回 gzip（实测 /v7/minutely/5m 与 /weather/v1/* 都带
 * content-encoding: gzip，即使请求里没写 Accept-Encoding）。云函数的 httpsGetJson 原先
 * 是 `data += chunk` 把响应体按字符串拼接再 JSON.parse —— 压缩字节当字符串拼，必然失败，
 * 表现是「JSON 解析失败」，**整条和风链路（短临 + 常规天气）全部取不到数**。
 *
 * 本文件锁死三件事：
 *   ① 带 content-encoding: gzip 的响应能被正确解压并解析（含缺 header 时按魔数识别）；
 *   ② 分块边界切在多字节字符中间时不得产生乱码（必须先拼 Buffer 再整体按 UTF-8 解码）；
 *   ③ 未压缩的响应不得被误当压缩体处理。
 * 夹具 tests/fixtures/qweather-v1.json 是 2026-09-25 从真实和风 API Host 抓下来的原文。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { EventEmitter } = require('events');

const R = path.join(__dirname, '..');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qweather-v1.json'), 'utf8'));

// ---------- https 打桩（必须在 require 云函数之前装好） ----------
const https = require('https');
let mode = 'gzip';        // gzip | plain
let oncePayload = null;   // 单次覆盖
const urls = [];

const gz = (obj) => ({ body: zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')), headers: { 'content-encoding': 'gzip' } });
const plain = (obj) => ({ body: Buffer.from(JSON.stringify(obj), 'utf8'), headers: {} });

function payloadBody(url) {
  if (url.indexOf('/minutely/5m') >= 0) return FX.minutely;
  if (url.indexOf('/weather/v1/current/') >= 0) return FX.current;
  if (url.indexOf('/weather/v1/hourly/') >= 0) return FX.hourly;
  if (url.indexOf('/weather/v1/daily/') >= 0) return FX.daily;
  return { code: '200' };
}

function buildPayload(url) {
  urls.push(url);
  const obj = payloadBody(url);
  if (oncePayload) { const p = oncePayload; oncePayload = null; return p; }
  return mode === 'plain' ? plain(obj) : gz(obj);
}

function makeRes(payload) {
  const res = new EventEmitter();
  res.statusCode = payload.statusCode || 200;
  res.headers = payload.headers || {};
  res.__payload = payload;
  return res;
}

// 必须在「调用方挂好 data/end 监听」之后才发事件，否则事件发在监听之前，promise 永远不 settle
function start(res) {
  const payload = res.__payload;
  const buf = Buffer.isBuffer(payload.body) ? payload.body : Buffer.from(String(payload.body), 'utf8');
  if (typeof payload.split === 'number' && payload.split > 0 && payload.split < buf.length) {
    res.emit('data', buf.slice(0, payload.split));
    res.emit('data', buf.slice(payload.split));
  } else {
    res.emit('data', buf);
  }
  res.emit('end');
}

function fakeReq() {
  const req = new EventEmitter();
  req.setTimeout = function () { return req; };
  req.destroy = function () {};
  req.end = function () {};
  return req;
}

https.get = function (url, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  const res = makeRes(buildPayload(String(url)));
  process.nextTick(() => { callback(res); process.nextTick(() => start(res)); });
  return fakeReq();
};
https.request = function (opts, cb) {
  const res = makeRes(buildPayload('https://' + opts.hostname + opts.path));
  process.nextTick(() => { cb(res); process.nextTick(() => start(res)); });
  return fakeReq();
};

process.env.QWEATHER_KEY = 'test-key';
process.env.QWEATHER_HOST = 'test.qweatherapi.example';
process.env.QWEATHER_KID = '';
process.env.QWEATHER_ISSUER = '';
process.env.QWEATHER_PROJECT = '';
process.env.QWEATHER_PRIVATE_KEY = '';
process.env.QWEATHER_PRIVATE_KEY_B64 = '';

const fc = require(path.join(R, 'cloudfunctions/getWeather/index.js'));
const T = fc.__test;
const jsSrc = fs.readFileSync(path.join(R, 'cloudfunctions/getWeather/index.js'), 'utf8');
// 去掉纯注释行后再做源码断言，免得我写在注释里的「旧写法」字样触发误报
const codeOnly = jsSrc.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('✓ ' + name); }
  catch (e) { failed += 1; console.error('✗ ' + name); console.error('   ' + ((e && e.message) || e)); }
}

(async () => {
  // ---------- ① 解压本身 ----------
  await test('decodeHttpBody：content-encoding: gzip 的响应体可解压为 UTF-8 文本', () => {
    const obj = { code: '200', summary: '未来两小时无降水' };
    const body = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
    const text = T.decodeHttpBody(body, 'gzip');
    assert.strictEqual(text, JSON.stringify(obj));
    assert.deepStrictEqual(JSON.parse(text).summary, '未来两小时无降水');
  });

  await test('decodeHttpBody：上游没给 content-encoding 时，按 gzip 魔数 1f 8b 也能识别', () => {
    const obj = { code: '200', summary: '20分钟后雨就停了' };
    const body = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
    assert.ok(body[0] === 0x1f && body[1] === 0x8b, '夹具本身应是 gzip 魔数开头');
    assert.strictEqual(JSON.parse(T.decodeHttpBody(body, '')).summary, '20分钟后雨就停了');
  });

  await test('decodeHttpBody：未压缩的响应不得被误伤（原样返回）', () => {
    const text = '{"code":"200","summary":"晴"}';
    assert.strictEqual(T.decodeHttpBody(Buffer.from(text, 'utf8'), ''), text);
    assert.strictEqual(T.decodeHttpBody(Buffer.from(text, 'utf8'), 'identity'), text);
  });

  await test('decodeHttpBuffer：返回 Buffer，且压缩体解压后与原文逐字节一致', () => {
    const raw = Buffer.from('{"a":"中文内容"}', 'utf8');
    const out = T.decodeHttpBuffer(zlib.gzipSync(raw), 'gzip');
    assert.ok(Buffer.isBuffer(out));
    assert.strictEqual(out.compare(raw), 0);
  });

  // ---------- ② 端到端：短临 ----------
  await test('fetchQWeatherMinutely：gzip 响应能取到 24 档（真实夹具）', async () => {
    mode = 'gzip';
    const rec = await T.fetchQWeatherMinutely('110.115186', '27.509196');
    assert.strictEqual(rec.slots.length, 24, '和风分钟级应为 24 档（每档 5 分钟）');
    assert.strictEqual(rec.stepMinutes, 5);
    assert.ok(typeof rec.summary === 'string' && rec.summary.length > 0, 'summary 不得丢');
    assert.ok(rec.slots.every((s) => typeof s.precip === 'string' || typeof s.precip === 'number'), '每档应有 precip');
  });

  await test('fetchQWeatherMinutely：分块边界切在多字节字符中间也不乱码', async () => {
    const payloadObj = { code: '200', summary: '未来两小时无降水', minutely: [{ fxTime: '2026-09-25T23:35+08:00', precip: '1.20', type: 'rain' }] };
    const buf = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const idx = buf.indexOf(Buffer.from('未', 'utf8')) + 1;   // 正好切在「未」字的 UTF-8 中间
    assert.ok(idx > 1, '应能在字节流里定位到中文');
    oncePayload = { body: buf, headers: {}, split: idx };
    const rec = await T.fetchQWeatherMinutely('110.115186', '27.509196');
    assert.strictEqual(rec.summary, '未来两小时无降水', '中文字符被拆成两个 chunk 后不得出现乱码');
    assert.ok(!/�/.test(rec.summary));
  });

  await test('fetchQWeatherMinutely：code 非 200 时如实抛错', async () => {
    oncePayload = gz({ code: '401', message: 'Unauthorized' });
    await assert.rejects(() => T.fetchQWeatherMinutely('110.115186', '27.509196'), /code=401/);
  });

  // ---------- ③ 端到端：常规天气（v1 三个接口都是 gzip） ----------
  await test('fetchQWeatherWeather：gzip 响应能归一化成 v1 结构（真实夹具）', async () => {
    mode = 'gzip';
    const built = await T.fetchQWeatherWeather('27.509196', '110.115186');
    assert.strictEqual(built.shape, 'v1', '应命中新版 v1 路径');
    const c = built.current;
    assert.strictEqual(c.humidity, 74, 'v1 湿度是 0-1，必须 ×100');
    assert.strictEqual(c.windSpeed, 2, '风级优先取上游 wind.scale');
    assert.strictEqual(c.windSpeedKmh, 7.8, 'v1 风速是 m/s，必须 ×3.6');
    assert.strictEqual(c.windSpeedMs, 2.2);
    assert.strictEqual(c.visibility, 26.8, 'v1 能见度是米，必须 ÷1000');
    assert.strictEqual(c.weather, '晴');
    assert.ok(c.temperature >= 25 && c.temperature <= 26, '气温应接近 25.6，实际 ' + c.temperature);
    assert.strictEqual(built.hourly.length, 24, '逐小时应为 24 条');
    assert.ok(/^\d{2}:\d{2}$/.test(built.hourly[0].time), '逐小时时间应为 HH:MM，实际 ' + built.hourly[0].time);
    assert.strictEqual(built.hourly[0].time.slice(0, 2), '00', '16:00Z 北京时间应为 00:00');
    assert.strictEqual(built.daily.length, 7, '逐日应为 7 条');
    assert.ok(built.daily[0].date.endsWith('/25'), '24T16:00Z 应为北京时间 9/25，实际 ' + built.daily[0].date);
    assert.strictEqual(built.daily[0].dayWeather, '少云');
    assert.strictEqual(built.daily[0].nightWeather, '晴');
  });

  await test('fetchQWeatherWeather：未压缩的响应同样能解析（不得只支持 gzip）', async () => {
    mode = 'plain';
    const built = await T.fetchQWeatherWeather('27.509196', '110.115186');
    assert.strictEqual(built.current.humidity, 74);
    assert.strictEqual(built.daily.length, 7);
    mode = 'gzip';
  });

  await test('fetchQWeatherWeather：请求确实打到「自有 API Host」而不是公共地址', () => {
    assert.ok(urls.length > 0);
    assert.ok(urls.every((u) => u.indexOf('test.qweatherapi.example') >= 0), '不应再打 devapi/api.qweather.com');
  });

  // ---------- ④ 源码守卫 ----------
  await test('源码：不得再把响应体按字符串拼接（data += chunk）', () => {
    assert.ok(!/res\.on\('data',\s*\(chunk\)\s*=>\s*data\s*\+=\s*chunk\)/.test(codeOnly),
      '必须改成先收集 Buffer，否则 gzip 响应会被当成字符串拼坏');
    assert.ok(!/data\s*\+=\s*chunk/.test(codeOnly), '不得残留任何 data += chunk');
  });

  await test('源码：三处 HTTP 读取都走统一解码（httpsGetJson / 彩云分支 / httpsGetBuffer）', () => {
    assert.ok(/require\('zlib'\)/.test(jsSrc), '应引入 zlib');
    const bodyUses = (jsSrc.match(/decodeHttpBody\(/g) || []).length;
    const bufUses = (jsSrc.match(/decodeHttpBuffer\(/g) || []).length;
    assert.strictEqual(bodyUses, 3, 'decodeHttpBody 应为「定义 1 + 调用 2」，实际 ' + bodyUses);
    assert.strictEqual(bufUses, 3, 'decodeHttpBuffer 应为「定义 1 + 被 decodeHttpBody 调 1 + httpsGetBuffer 调 1」，实际 ' + bufUses);
    assert.ok(/decodeHttpBuffer\(Buffer\.concat\(chunks\), res\.headers/.test(jsSrc), 'httpsGetBuffer 也要按 content-encoding 解码');
  });

  await test('源码：注释写明「无条件 gzip」的坑，避免后人再改回去', () => {
    assert.ok(/无条件返回 gzip|无条件 gzip/.test(jsSrc), '应写明上游会无条件返回 gzip');
    assert.ok(/content-encoding/.test(jsSrc), '应写明 content-encoding');
    assert.ok(/多字节字符/.test(jsSrc), '应写明分块边界切在多字节字符中间的风险');
  });

  // ---------- ⑤ 真实 HTTP 触发器形态：query 参数全是字符串 ----------
  // 线上曾出现：带 provider=qweather 时 HTTP 500，error「longitude.toFixed is not a function」。
  // 成因就是 FC 的 queryParameters 全是字符串，裸的 longitude.toFixed 会直接抛错。
  await test('handler：经纬度以字符串传入（真实 FC 事件形态）也必须取到数，不得崩', async () => {
    const res = await fc.handler({
      requestContext: { httpMethod: 'GET', path: '/' },
      queryParameters: { latitude: '27.509196', longitude: '110.115186', provider: 'qweather' }
    }, {});
    assert.strictEqual(res.statusCode, 200, '不得出现 500，实际 ' + res.statusCode + ' ｜ ' + res.body);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.source, 'qweather');
    assert.ok(body.data.current.windSpeedKmh != null, '应带上 windSpeedKmh');
    assert.strictEqual(body.data.hourly.length, 24);
    assert.strictEqual(body.data.daily.length, 7);
    assert.ok(urls.some((u) => u.indexOf('/weather/v1/current/27.51/110.12') >= 0),
      '字符串经纬度应被 Number() 规范化后再拼进 URL，实际请求 ' + urls.filter((u) => u.indexOf('/weather/') >= 0).join(' '));
  });

  await test('源码：经纬度取整必须先 Number() 包一层（不得出现裸的 .toFixed）', () => {
    assert.ok(/Number\((latitude|longitude|lat|lng)\)\.toFixed\(/.test(codeOnly),
      '应看到 Number(...).toFixed(...) 的写法');
    assert.ok(!/\b(latitude|longitude)\.toFixed\(/.test(codeOnly),
      '不得出现裸的 latitude.toFixed / longitude.toFixed：query 参数是字符串，会直接 500');
  });

  if (failed) { console.error('\n失败 ' + failed + ' 项'); process.exitCode = 1; }
  else console.log('\n全部通过');
})();
