// 地图页雷达回波（图片图层）与 WGS-84 → GCJ-02 校正
//
// 背景：微信 <map> 的底图是腾讯的 GCJ-02，而 RainViewer 雷达瓦片是 WGS-84。
// 实测（2026-09-28，中方县）偏移 东 482 m / 北 −347 m（直线 594 m，东南向）；
// 县域内各点 591~594 m ⇒ 在县域尺度上近似常数平移，整块平移即可（残差 ≤21 m）。
// 本文件锁住三件事：换算方向、bounds 确实换算过、以及失败态与「无回波」可区分。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(R, rel), 'utf8');
const geo = require(path.join(R, 'utils/geoLayer.js'));
const radar = require(path.join(R, 'utils/layerRadar.js'));
const datum = require(path.join(R, 'utils/geoDatum.js'));

const CENTER = geo.COUNTY_CENTER;
const FRAME = { index: 12, timeStamp: Math.floor(Date.UTC(2026, 8, 27, 19, 40) / 1000), time: '03:40', path: '/v2/radar/1790538000', isLatest: true };
const HOST = 'https://tilecache.rainviewer.com';

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

/* ---------------- 一、坐标换算本身 ---------------- */

test('中方县中心：WGS-84 → GCJ-02 偏移约 594 m、方向东南', () => {
  const o = datum.offsetMeters(CENTER.longitude, CENTER.latitude);
  assert.ok(o.dx > 470 && o.dx < 500, '东向分量应约 +482 m，实际 ' + o.dx);
  assert.ok(o.dy < -335 && o.dy > -360, '北向分量应约 −347 m，实际 ' + o.dy);
  assert.ok(o.distance > 588 && o.distance < 600, '直线距离应约 594 m，实际 ' + o.distance);
  assert.ok(o.bearing > 120 && o.bearing < 135, '方位应约 126°（东南），实际 ' + o.bearing);
});

test('换算方向不能反：GCJ 经度更大、纬度更小', () => {
  const g = datum.wgsToGcj(CENTER.longitude, CENTER.latitude);
  assert.ok(g.longitude > CENTER.longitude, 'GCJ 经度必须更大（向东偏）');
  assert.ok(g.latitude < CENTER.latitude, 'GCJ 纬度必须更小（向南偏）');
  assert.strictEqual(g.shifted, true);
});

test('境外坐标必须原样返回（GCJ-02 只在国内生效）', () => {
  const tokyo = datum.wgsToGcj(139.6917, 35.6895);
  assert.strictEqual(tokyo.longitude, 139.6917);
  assert.strictEqual(tokyo.latitude, 35.6895);
  assert.strictEqual(tokyo.shifted, false, '境外不得偏移，否则会把境外点位改坏');
  assert.strictEqual(datum.offsetMeters(139.6917, 35.6895).distance, 0);
});

test('GCJ → WGS 反算是逆运算（往返误差 < 1e-7 度）', () => {
  const g = datum.wgsToGcj(CENTER.longitude, CENTER.latitude);
  const back = datum.gcjToWgs(g.longitude, g.latitude);
  assert.ok(Math.abs(back.longitude - CENTER.longitude) < 1e-7, '经度往返误差过大：' + back.longitude);
  assert.ok(Math.abs(back.latitude - CENTER.latitude) < 1e-7, '纬度往返误差过大：' + back.latitude);
});

test('县域尺度上偏移近似常数：整块平移的残差 ≤ 25 m', () => {
  const pts = [[110.0, 27.6], [110.25, 27.6], [110.0, 27.42], [110.25, 27.42], [110.115, 27.55], [110.2, 27.45]];
  const base = datum.offsetMeters(CENTER.longitude, CENTER.latitude);
  let worst = 0;
  pts.forEach(([lng, lat]) => {
    const o = datum.offsetMeters(lng, lat);
    assert.ok(o.distance > 585 && o.distance < 600, '取样点偏移应在 591~594 m 量级，实际 ' + o.distance);
    worst = Math.max(worst, Math.abs(o.dx - base.dx), Math.abs(o.dy - base.dy));
  });
  assert.ok(worst <= 25, '整块平移的最大残差应 ≤25 m，实际 ' + worst);
});

test('矩形范围换算：两角都平移，且仍是有效矩形', () => {
  const b = { west: 109.9, south: 27.4, east: 110.3, north: 27.6 };
  const g = datum.wgsBoundsToGcj(b);
  assert.ok(g.west > b.west && g.east > b.east, '东西两角都应向东移');
  assert.ok(g.south < b.south && g.north < b.north, '南北两角都应向南移');
  assert.ok(g.west < g.east && g.south < g.north, '换算后必须仍是有效矩形');
});

/* ---------------- 二、地图图片图层规划 ---------------- */

test('县域只需 1 张 z7 瓦片，且层级不突破免费源上限', () => {
  const plan = radar.planMapOverlays(HOST, FRAME, geo.COUNTY_BOUNDS);
  assert.strictEqual(plan.zoom, geo.LAYER.MAX_ZOOM, '应取免费档上限 z' + geo.LAYER.MAX_ZOOM);
  assert.ok(plan.zoom <= 7, 'z≥8 恒返回空瓦片，不得使用');
  assert.ok(plan.count >= 1 && plan.count <= 6, '县域瓦片数应可控，实际 ' + plan.count);
  assert.strictEqual(plan.count, plan.tiles.length);
  assert.ok(plan.kmPerPx > 1.0 && plan.kmPerPx < 1.2, 'z7 原始分辨率应约 1.1 km/像素，实际 ' + plan.kmPerPx);
});

test('★ 交给地图的 bounds 必须是 GCJ-02，不能是瓦片原始的 WGS-84', () => {
  const plan = radar.planMapOverlays(HOST, FRAME, geo.COUNTY_BOUNDS);
  plan.tiles.forEach((t) => {
    assert.ok(t.bounds.west !== t.sourceBounds.west, 'bounds 未做换算 → 整片回波会偏约 594 m');
    const o = datum.offsetMeters(t.sourceBounds.west, t.sourceBounds.south);
    const dEast = (t.bounds.west - t.sourceBounds.west) * 111412.84 * Math.cos((t.sourceBounds.south * Math.PI) / 180);
    const dNorth = (t.bounds.south - t.sourceBounds.south) * 111132.92;
    assert.ok(Math.abs(dEast - o.dx) < 1, '东向平移量应与换算一致，实际 ' + dEast.toFixed(1) + ' vs ' + o.dx);
    assert.ok(Math.abs(dNorth - o.dy) < 1, '北向平移量应与换算一致，实际 ' + dNorth.toFixed(1) + ' vs ' + o.dy);
    assert.ok(t.bounds.west > t.sourceBounds.west, '方向必须是向东偏');
    assert.ok(t.bounds.north < t.sourceBounds.north, '方向必须是向南偏');
  });
});

test('瓦片 url 符合 RainViewer 规范且层级段正确', () => {
  const plan = radar.planMapOverlays(HOST, FRAME, geo.COUNTY_BOUNDS);
  plan.tiles.forEach((t) => {
    assert.match(t.url, /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/\d+\/256\/7\/\d+\/\d+\/4\/1_1\.png$/);
    assert.ok(t.url.indexOf('/256/8/') === -1 && t.url.indexOf('/256/9/') === -1, '不得请求空瓦片层级');
  });
});

test('overlay id 必须是数字、同一瓦片稳定、同批不重复', () => {
  const a = radar.planMapOverlays(HOST, FRAME, geo.COUNTY_BOUNDS);
  const b = radar.planMapOverlays('https://tilecache.rainviewer.com', { ...FRAME, timeStamp: FRAME.timeStamp + 600 }, geo.COUNTY_BOUNDS);
  a.tiles.forEach((t) => assert.strictEqual(typeof t.id, 'number', 'map 的图片图层 id 必须是数字'));
  const ids = new Set(a.tiles.map((t) => t.id));
  assert.strictEqual(ids.size, a.tiles.length, '同批 id 不得重复');
  assert.deepStrictEqual(a.tiles.map((t) => t.id), b.tiles.map((t) => t.id), '换帧后同一块瓦片的 id 必须不变（否则删不掉）');
});

test('北京时间与帧龄：不依赖设备时区、不能出现负数', () => {
  assert.strictEqual(radar.timeCst(FRAME.timeStamp), '03:40', '19:40Z 应是北京时间 03:40');
  assert.strictEqual(radar.timeCst(Math.floor(Date.UTC(2026, 0, 1, 0, 5) / 1000)), '08:05');
  assert.strictEqual(radar.frameAgeMinutes(FRAME.timeStamp, FRAME.timeStamp + 600), 10);
  assert.strictEqual(radar.frameAgeMinutes(FRAME.timeStamp, FRAME.timeStamp - 600), 0, '未来时间戳也不得出现负数帧龄');
});

test('★ 北京时间必须显式按 UTC+8 算，不能用设备本地时间冒充', () => {
  // 这台开发机本身就在 +8 时区，若实现里用设备本地时间，数值断言照样通过 —— 换台机器就错。
  // 所以必须再锁实现：用 getUTC* 且显式 +8。
  const src = fs.readFileSync(path.join(R, 'utils/layerRadar.js'), 'utf8');
  const fn = src.slice(src.indexOf('const timeCst ='), src.indexOf('const frameAgeMinutes'));
  assert.ok(fn.indexOf('getUTCHours') !== -1 && fn.indexOf('getUTCMinutes') !== -1, '必须用 getUTC* 取时间');
  assert.strictEqual(/getHours\(|getMinutes\(/.test(fn), false, '不得使用设备本地时间（换时区即错）');
  assert.ok(/8 \* 3600/.test(fn), '必须显式 +8 小时');
});

test('帧对象带北京时间标签（免费档只有历史帧，界面才好如实标注）', () => {
  const frames = radar.buildFrames({ host: HOST, radar: { past: [{ time: FRAME.timeStamp, path: FRAME.path }] } });
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].timeCst, '03:40');
});

test('图例四档与气象页调色板完全一致（同一数据源调色板）', () => {
  const css = read('pages/rainfall/rainfall.wxss');
  assert.strictEqual(radar.RADAR.LEGEND.length, 4);
  radar.RADAR.LEGEND.forEach((l) => {
    const re = new RegExp('\\.legend-dot\\.lv-' + l.level + '\\{background:([^}]+)\\}');
    const m = css.match(re);
    assert.ok(m, '气象页缺少 .legend-dot.lv-' + l.level);
    assert.strictEqual(m[1].trim(), l.color, '第 ' + l.level + ' 档颜色与气象页不一致');
  });
  assert.deepStrictEqual(radar.RADAR.LEGEND.map((l) => l.label), ['弱', '中', '强', '特强']);
});

/* 注：地图监测页的雷达图层已于 2026-09-29 按用户要求移除，
   本文件只保留数据/坐标层面的断言（页面接线断言随之删除，不是放宽）。 */
if (failed) {
  console.error('\n雷达瓦片与坐标校正：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n雷达瓦片与坐标校正：全部通过');
}
