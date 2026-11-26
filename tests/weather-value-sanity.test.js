// 天气数值「口径正确性」测试
//
// 背景：界面上的「N级」曾经是 Math.round(彩云风速 * 3.6 / 1.6)——
//       既不是 km/h 也不是 m/s，把 5.3km/h 的微风（1 级）显示成「12级」台风级。
//       独立数据源交叉核对（Open-Meteo ECMWF/GFS/ICON/最佳匹配，同期 0.95~2.11 m/s）
//       证实彩云 realtime.wind.speed 单位是 km/h，正确风级应为 1 级。
//       同字段的和风分支用的是 now.windScale（本来就是风级），两条链路语义必须一致。
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
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');
const T = require(fcPath).__test;
const fcSrc = fs.readFileSync(fcPath, 'utf8');
const wxml = fs.readFileSync(path.join(R, 'pages/rainfall/rainfall.wxml'), 'utf8');

test('蒲福风级换算：km/h → 级（GB/T 28591-2012 级距）', () => {
  // 0级<0.3 / 1级0.3-1.5 / 2级1.6-3.3 / 3级3.4-5.4 / 4级5.5-7.9 / 5级8.0-10.7
  // 6级10.8-13.8 / 7级13.9-17.1 / 8级17.2-20.7 / 9级20.8-24.4 / 10级24.5-28.4 / 11级28.5-32.6 / 12级≥32.7（单位 m/s）
  const cases = [
    [0, 0], [1, 0], [5.3, 1], [10, 2], [12, 2], [20, 4], [29, 5],
    [40, 6], [54, 7], [62, 8], [80, 9], [90, 10], [110, 11], [120, 12], [200, 12],
  ];
  cases.forEach(([kmh, want]) => {
    assert.strictEqual(T.beaufortFromKmh(kmh), want, kmh + ' km/h 应为 ' + want + ' 级');
  });
});

test('异常输入不产生假风级', () => {
  assert.strictEqual(T.beaufortFromKmh(NaN), 0);
  assert.strictEqual(T.beaufortFromKmh(undefined), 0);
  assert.strictEqual(T.beaufortFromKmh(-5), 0);
  assert.strictEqual(T.beaufortFromKmh('abc'), 0);
});

test('回归锁：微风（1.5m/s 量级）绝不能再显示成大风级', () => {
  const lvl = T.beaufortFromKmh(5.3);
  assert.ok(lvl <= 2, '5.3km/h（≈1.47m/s）应为 0~2 级，实际 ' + lvl);
  assert.notStrictEqual(lvl, 12, '绝不能是 12 级（旧公式的结果）');
  // 旧公式对同一个输入确实得到 12，写进断言防止回退
  assert.strictEqual(Math.round(5.3 * 3.6 / 1.6), 12, '旧公式确实会得到 12（这就是当时的 bug）');
});

test('云函数里不再用旧公式算风速（注释里的说明不算）', () => {
  assert.ok(fcSrc.indexOf('realtime.wind.speed * 3.6 / 1.6') < 0, '风速换算不应再用 * 3.6 / 1.6');
  assert.ok(/windSpeed: beaufortFromKmh\(realtime\.wind\.speed\)/.test(fcSrc), '彩云分支应输出真实风级');
  // 和风两代都把「上游给的风级」摆在第一位（v1 是 wind.scale、v7 是 windScale），
  // 只有上游没给时才按 GB/T 28591-2012 的蒲福表自己算——语义与彩云分支一致（界面上都是「N级」）。
  assert.ok(/const scale = Number\(wind\.scale\)/.test(fcSrc), '和风 v1 分支的风级来自上游 wind.scale');
  assert.ok(/const scale = Number\(now\.windScale\)/.test(fcSrc), '和风 v7 分支的风级来自上游 windScale');
  assert.ok(/isFinite\(scale\) \? scale :/.test(fcSrc), '以上游风级为准，缺失才自己算');
  assert.ok(!/windSpeed: parseInt\(now\.temp/.test(fcSrc), '不得把温度之类别的字段当风级');
});

test('风级与界面单位一致（界面写的是「级」）', () => {
  assert.ok(/\{\{weather\.current\.windSpeed\}\}级/.test(wxml), '界面确实标注为「级」');
  [0.5, 5.3, 20, 62, 120].forEach((kmh) => {
    const v = T.beaufortFromKmh(kmh);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 12, '风级必须是 0~12 的整数，实际 ' + v);
  });
});

test('同时保留原始单位，便于以后核对与展示', () => {
  assert.ok(/windSpeedKmh: Math\.round\(realtime\.wind\.speed\)/.test(fcSrc), '应保留 km/h 原值');
  assert.ok(/windSpeedMs: Math\.round\(\(realtime\.wind\.speed \/ 3\.6\) \* 10\) \/ 10/.test(fcSrc), '应保留 m/s 换算值');
});
