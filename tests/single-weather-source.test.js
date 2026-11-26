// 单一数据源（只用和风）测试
//
// 背景（2026-09-23）：用户要求「不想彩云和和风混用」。核对官方文档时发现，
// 和风已把常规天气迁到新一套路径与结构：
//   实况   /weather/v1/current/{纬度}/{经度}
//   逐小时 /weather/v1/hourly/{纬度}/{经度}
//   逐日   /weather/v1/daily/{纬度}/{经度}
// 返回嵌套对象（temperature.value / hours[] / days[] / precipitation.probability），
// 而旧代码写的是 /v7/weather/now|24h|7d 的扁平字段（now.temp / hourly[] / daily[]）。
// 两代的单位约定也不同：v1 湿度与概率是 [0,1] 小数、风速 m/s、能见度米；
// v7 湿度与概率是百分比整数、风速 km/h、能见度公里。混用会得到差 100 倍 / 3.6 倍的错值。
// 分钟级降水仍留在 /v7/minutely/5m。
//
// 本文件锁死四类容易出错的地方：
//   1) 单一数据源：前端只传一个 provider，短临不会回落到另一个源；
//   2) 结构：v1 / v7 两代形态都能归一化，结构不符必须抛错而不是给空界面；
//   3) 单位与时区：湿度的 100 倍坑、风速的 3.6 倍坑、Z 的 +8 与跨日、显式偏移用墙钟；
//   4) 口径：没有概率就显示「--」，绝不把降水量毫米数当概率。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');
const fcSrc = fs.readFileSync(fcPath, 'utf8');
const T = require(fcPath).__test;

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

// —— 官方文档里的两个真实样例 ——
const V1_CURRENT = { condition: { text: '少云', code: '102' }, temperature: { value: 31.71 }, feelsLike: { value: 33.64 }, humidity: 0.69, wind: { direction: { degree: 226, compass: 'sw' }, speed: { value: 4.74, unit: 'm/s' }, scale: 3 }, precipitation: { amount: { value: 0 } }, pressure: { value: 1001.5 }, visibility: { value: 29020, unit: 'm' }, uvIndex: 3 };
const V1_HOURLY = { hours: [{ forecastTime: '2024-05-31T03:00Z', condition: { text: 'Overcast', code: '104' }, temperature: { value: 31.12 }, precipitation: { amount: { value: 0.09 }, probability: 0.31 } }] };
const V1_DAILY = { days: [{ forecastStartTime: '2024-08-10T22:00Z', temperatureMax: { value: 29.94 }, temperatureMin: { value: 20.93 }, daytime: { condition: { text: '小雨' }, precipitation: { amount: { value: 0.75 }, probability: 0.64 } }, nighttime: { condition: { text: '晴间多云' } } }] };
const V7_NOW = { now: { temp: '21', feelsLike: '22', humidity: '96', windDir: '东北风', windScale: '1', windSpeed: '5.3', text: '小雨', pressure: '1008', vis: '8' } };
const V7_HOURLY = { hourly: [{ fxTime: '2026-09-23T15:00+08:00', temp: '22', text: '小雨', precip: '1.2', pop: '60' }] };
const V7_DAILY = { daily: [{ fxDate: '2026-09-23', tempMax: '25', tempMin: '21', textDay: '小雨', textNight: '阴', precip: '3.4' }] };

// ==================== 一、单一数据源 ====================
test('单一数据源：前端数据源开关就是 qweather', () => {
  const cfg = read('utils/config.js');
  assert.match(cfg, /WEATHER_PROVIDER:\s*'qweather'/, '前端必须只声明一个数据源');
  assert.ok(!/WEATHER_PROVIDER:\s*'caiyun'/.test(cfg), '不得留着彩云作为当前数据源');
});

test('单一数据源：短临请求也带上同一个 provider（否则云函数会按 auto 回落另一个源）', () => {
  const api = read('utils/api.js');
  assert.match(api, /mode: 'nowcast', provider: config\.WEATHER_PROVIDER/, '短临必须显式传 provider');
  assert.match(api, /provider:\s*config\.WEATHER_PROVIDER/, '常规天气也要传（同一开关）');
});

test('单一数据源：云函数收到 qweather 时，数据源列表里不得再出现彩云', () => {
  const order = T.resolveNowcastProviders('qweather');
  assert.deepStrictEqual(order, ['qweather'], '显式指定和风时只能是和风，实际 ' + JSON.stringify(order));
  assert.ok(order.indexOf('caiyun') < 0, '不得回落彩云');
});

test('单一数据源：只有显式给 caiyun 或环境变量时才用彩云（保留能力，但不再是默认）', () => {
  assert.deepStrictEqual(T.resolveNowcastProviders('caiyun'), ['caiyun'], '显式 caiyun 仍然可用');
});

// ==================== 二、结构：v1 / v7 双形态 ====================
test('结构：v1 新结构（嵌套对象）能正确归一化', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.current.temperature, 32, '温度取 temperature.value');
  assert.strictEqual(a.current.weather, '少云', '天气现象取 condition.text');
  assert.strictEqual(a.current.windDirection, '西南风', 'v1 的 compass 是小写英文，要转中文');
  assert.strictEqual(a.hourly[0].time, '11:00', '00:00Z 才是 08:00，03:00Z → 11:00');
  assert.strictEqual(a.hourly[0].rain, 0.09, '逐小时雨量取 precipitation.amount.value');
  assert.strictEqual(a.daily[0].dayWeather, '小雨', '白天天气取 daytime.condition.text');
  assert.strictEqual(a.daily[0].nightWeather, '晴间多云', '夜间天气取 nighttime.condition.text');
});

test('结构：v7 旧结构（扁平字段）也能归一化（同一 API Host 上两代并存）', () => {
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.current.temperature, 21, 'v7 取 now.temp');
  assert.strictEqual(b.current.windDirection, '东北风', 'v7 的 windDir 已是中文');
  assert.strictEqual(b.hourly[0].time, '15:00', 'v7 取 fxTime');
  assert.strictEqual(b.daily[0].date, '9/23', 'v7 的 fxDate 只有日期也要能解析');
});

test('结构：缺 hours/days/hourly/daily 时必须抛错，不能返回空界面冒充「没有预报」', () => {
  assert.throws(() => T.normalizeQWeatherHourly({}, 'v1'), /结构不符/, 'v1 缺 hours 要抛错');
  assert.throws(() => T.normalizeQWeatherHourly({}, 'v7'), /结构不符/, 'v7 缺 hourly 要抛错');
  assert.throws(() => T.normalizeQWeatherDaily({ days: [] }, 'v1'), /结构不符/, 'v1 空 days 要抛错');
  assert.throws(() => T.normalizeQWeatherDaily({}, 'v7'), /结构不符/, 'v7 缺 daily 要抛错');
});

test('结构：两代的路径与经纬度顺序都不同，必须分别写对', () => {
  assert.strictEqual(T.QWEATHER_WEATHER_PATHS.v1.current('27.51', '110.12').path, '/weather/v1/current/27.51/110.12', 'v1 是路径参数且纬度在前');
  assert.strictEqual(T.QWEATHER_WEATHER_PATHS.v1.hourly('27.51', '110.12').path, '/weather/v1/hourly/27.51/110.12');
  assert.strictEqual(T.QWEATHER_WEATHER_PATHS.v1.daily('27.51', '110.12').path, '/weather/v1/daily/27.51/110.12');
  assert.deepStrictEqual(T.QWEATHER_WEATHER_PATHS.v7.current('27.51', '110.12').query, { location: '110.12,27.51' }, 'v7 是 query 且经度在前');
  assert.strictEqual(T.QWEATHER_WEATHER_PATHS.v7.daily('27.51', '110.12').path, '/v7/weather/7d', 'v7 逐日仍是 7d');
  assert.strictEqual(T.QWEATHER_WEATHER_PATHS.v1.current('27.51', '110.12').query, undefined, 'v1 不该再挂 query');
});

test('结构：分钟级降水的路径不受影响（官方文档仍是 /v7/minutely/5m）', () => {
  assert.match(fcSrc, /QWEATHER_MINUTELY_PATH = '\/v7\/minutely\/5m'/, '分钟级路径保持 v7');
});

// ==================== 三、单位与时区（差 100 倍 / 3.6 倍的坑） ====================
test('单位：v1 的湿度是 [0,1] 小数，必须 ×100；v7 的湿度已是百分比，不能再 ×100', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.current.humidity, 69, '0.69 → 69%');
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.current.humidity, 96, '96 必须还是 96（96*100=9600 是典型错值）');
});

test('单位：v1 的降水概率是 [0,1] 小数，v7 是百分比整数', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.daily[0].rainProb, 64, '0.64 → 64%');
  assert.strictEqual(a.hourly[0].rainProb, 31, '0.31 → 31%');
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.hourly[0].rainProb, 60, '60 必须还是 60');
});

test('单位：v1 风速是 m/s 要 ×3.6 换 km/h；v7 风速已是 km/h', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.current.windSpeedKmh, 17.1, '4.74m/s → 17.1km/h');
  assert.strictEqual(a.current.windSpeedMs, 4.7, 'm/s 原值保留');
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.current.windSpeedKmh, 5.3, '5.3km/h 不再被乘一次');
  assert.strictEqual(b.current.windSpeedMs, 1.5, '5.3km/h → 1.5m/s');
});

test('单位：能见度 v1 是米、v7 是公里，都要落到公里（v7 别再除一次变成 0）', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.current.visibility, 29, '29020m → 29km');
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.current.visibility, 8, '8km 必须还是 8km');
});

test('风级：界面上的「N级」用上游的 scale，缺失时才按 GB/T 28591-2012 自己算', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.current.windSpeed, 3, 'v1 用 wind.scale');
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.current.windSpeed, 1, 'v7 用 windScale');
  const noScale = JSON.parse(JSON.stringify(V1_CURRENT));
  delete noScale.wind.scale;
  const c = T.normalizeQWeatherWeather('v1', noScale, V1_HOURLY, V1_DAILY);
  assert.strictEqual(c.current.windSpeed, T.beaufortFromKmh(17.1), '缺 scale 时自己按蒲福表算');
});

test('时区：上游给 Z（UTC）时按北京时间 +8 显示，并且必须处理跨日', () => {
  assert.strictEqual(T.qweatherClock('2024-05-31T03:00Z').label, '11:00', '03:00Z → 11:00');
  assert.strictEqual(T.qweatherClock('2024-08-10T22:00Z').date, '8/11', '22:00Z 加 8 小时已跨到次日');
  assert.strictEqual(T.qweatherClock('2024-08-10T22:00Z').label, '06:00', '跨日后的时刻也要对');
});

test('时区：上游给显式偏移（+08:00）时说明已是当地时间，直接用墙钟时间', () => {
  assert.strictEqual(T.qweatherClock('2026-09-23T15:00+08:00').label, '15:00', '不能再加 8 小时变成 23:00');
  assert.strictEqual(T.qweatherClock('2026-09-23T23:30+08:00').label, '23:30', '加 8 小时会滚到次日，必须避免');
});

test('时区：只有日期（旧 v7 的 fxDate）也要能解析出日期', () => {
  assert.strictEqual(T.qweatherClock('2026-09-23').date, '9/23');
  assert.strictEqual(T.qweatherClock('2026-09-23').label, '', '没有时刻就留空，不凭空造一个 00:00');
  assert.strictEqual(T.qweatherClock('乱码'), null, '解析不了就 null');
});

// ==================== 四、口径：没有概率就说没有 ====================
test('口径：上游没给概率时必须是 null 且 hasRainProb 为 false（旧实现拿降水量冒充概率）', () => {
  const b = T.normalizeQWeatherWeather('v7', V7_NOW, V7_HOURLY, V7_DAILY);
  assert.strictEqual(b.daily[0].rainProb, null, 'v7 逐日没给 pop → 概率必须是 null');
  assert.strictEqual(b.daily[0].hasRainProb, false, '要显式标记「没有概率」');
  assert.strictEqual(b.daily[0].rain, 3.4, '降水量仍然要保留，放在 rain 而不是 rainProb');
  assert.notStrictEqual(b.daily[0].rainProb, 3.4, '绝不能把 3.4mm 当成 3.4% 显示');
});

test('口径：有概率时 hasRainProb 为 true，且概率被夹在 0–100', () => {
  const a = T.normalizeQWeatherWeather('v1', V1_CURRENT, V1_HOURLY, V1_DAILY);
  assert.strictEqual(a.daily[0].hasRainProb, true);
  assert.ok(a.daily[0].rainProb >= 0 && a.daily[0].rainProb <= 100, '概率必须在 0–100');
  assert.strictEqual(T.pct(1.8, 'v1'), 100, '超过 100% 要夹住');
  assert.strictEqual(T.pct(-0.2, 'v1'), 0, '负数要夹到 0');
});

test('口径：云函数不再把 precip 填进 rainProb 字段', () => {
  assert.ok(!/rainProb:\s*parseInt\(item\.precip/.test(fcSrc), '旧实现 rainProb = precip 必须已被移除');
  assert.match(fcSrc, /rainProb:\s*probPct/, '概率只能来自真正的概率字段');
});

// ==================== 五、前端展示 ====================
test('前端：逐日概率按 hasRainProb 条件渲染，没概率时显示 --（不是 0%）', () => {
  const wxml = read('pages/rainfall/rainfall.wxml');
  assert.match(wxml, /daily-rain" wx:if="\{\{item\.hasRainProb\}\}"/, '概率块要看 hasRainProb');
  assert.match(wxml, /rain-prob-none">--</, '没概率时显示占位符');
  const wxss = read('pages/rainfall/rainfall.wxss');
  assert.match(wxss, /\.rain-prob-none\{/, '占位符要有样式');
  assert.ok(!/gap\s*:/.test(wxss.match(/\.rain-prob-none\{[^}]*\}/)[0]), '不得使用 flex gap（真机不支持）');
});

test('前端：归一化时把非有限数的概率收成 null 并补上 hasRainProb', () => {
  const js = read('pages/rainfall/rainfall.js');
  assert.match(js, /hasRainProb: prob !== null/, '前端要自己兜一道');
  assert.match(js, /typeof d\.rainProb === 'number' && isFinite\(d\.rainProb\)/, 'NaN/undefined 都要收成 null');
});

// ==================== 六、切源之后不能丢掉配额保护 ====================
test('配额保护：和风分支同样要有缓存、退避、有界回落（否则每次刷新都真打上游）', () => {
  const start = fcSrc.indexOf('async function getQWeather(');
  const end = fcSrc.indexOf('// ==================== 乡镇短临预报');
  const body = fcSrc.slice(start, end);
  assert.ok(start > 0 && end > start, '要能定位到和风分支');
  assert.match(body, /weatherCache\.get\(key\)/, '要有命中缓存');
  assert.match(body, /cached: true/, '命中缓存要标明 cached');
  assert.match(body, /upstreamBlockUntil\.set\(key, Date\.now\(\) \+ UPSTREAM_BACKOFF_MS\)/, '429 要退避');
  assert.match(body, /serveStale\(/, '要有界回落到上次成功结果');
  assert.match(body, /staleMinutes/, '回落要如实标注数据新旧');
  // 这条曾经写成「或」的空断言，永远为真，被反向自检抓到；改成直接要求真的写缓存
  assert.match(body, /weatherCache\.set\(key, \{ at: Date\.now\(\), data: transformed \}\)/, '成功结果必须写进缓存，否则每次刷新都真打上游');
});

test('失败如实：和风分支的失败必须带 source 与可读原因（不伪装成「没有数据」）', () => {
  const start = fcSrc.indexOf('async function getQWeather(');
  const end = fcSrc.indexOf('// ==================== 乡镇短临预报');
  const body = fcSrc.slice(start, end);
  assert.match(body, /source: 'qweather'/, '成功与失败都要标数据源');
  assert.match(body, /和风天气访问频率超限/, '429 要如实说原因');
  assert.match(body, /retryAfterSec/, '要给出重试等待秒数');
  assert.match(body, /和风天气取数失败/, '取数失败要有明确文案');
  assert.match(body, /error: String\(\(e && e\.message\) \|\| e\)\.slice\(0, 300\)/, '要把上游原因带上');
});

test('形态自检：首个真实响应要打一条把原始值与换算结果并排的日志，便于当场核对时区与单位', () => {
  assert.match(fcSrc, /\[qweather\] 形态自检 /, '要有形态自检日志');
  assert.match(fcSrc, /qweatherShapeLogged/, '只打一次');
  assert.match(fcSrc, /null 表示上游确实没给概率/, '日志要解释 null 的含义');
});

test('分钟级：和风分支的分钟级仍来自和风（同一个源，不混用）', () => {
  const start = fcSrc.indexOf('async function getQWeather(');
  const end = fcSrc.indexOf('// ==================== 乡镇短临预报');
  const body = fcSrc.slice(start, end);
  assert.match(body, /await fillMinuteFromQWeather\(transformed, longitude, latitude\)/, '分钟级要走和风');
  assert.match(fcSrc, /function fillMinuteFromQWeather[\s\S]{0,600}fetchQWeatherMinutely\(/, '兜底取数函数要和风');
});

test('文档：源码注释里要写清新旧两代路径与「单位约定按代区分」，避免下次又写错', () => {
  assert.match(fcSrc, /\/weather\/v1\/current\/\{纬度\}\/\{经度\}/, '要写明 v1 路径形态');
  assert.match(fcSrc, /v1 的湿度与降水概率是 \[0,1\] 小数，v7 是百分比整数/, '要写明单位差异');
  assert.match(fcSrc, /所以同一个 API Host 上两代路径并存/, '要说明两代并存的原因');
});

if (failed) {
  console.error('\n单一数据源测试：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n单一数据源测试：全部通过');
}
