// 地图页坐标校正：站点 marker / 乡镇分界线 / 地图中心 都必须从 WGS-84 换算成 GCJ-02
//
// 为什么：微信 <map> 的底图是腾讯的 GCJ-02，而本项目的站点坐标与乡镇边界都是 WGS-84。
// 实测（2026-09-29，高德影像＝GCJ-02，与微信地图同坐标系）：
//   抽 8 座水库，按 WGS-84→GCJ-02 换算后的位置**全部**落在坝体/水面上（铜湾、保土、批修直接压在坝上），
//   而直接用原始坐标的点落在西北侧约 594m 的山坡/村里。
//   ⇒ 站点数据确实是 WGS-84，交给地图前必须换算。
// 同时必须守住反向边界：天气页那张自绘 canvas 用的是**同一套 WGS-84 烘焙底图**，
//   它的雷达/风场/分界线一律不能换算，否则反而会错 594m。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(R, rel), 'utf8');
const datum = require(path.join(R, 'utils/geoDatum.js'));
const geo = require(path.join(R, 'utils/geoLayer.js'));

const CENTER = geo.COUNTY_CENTER;
const OFFSET = datum.offsetMeters(CENTER.longitude, CENTER.latitude);

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

/* ---------------- 一、换算本身 ---------------- */

test('toMapPoint：县域内偏 594m 东南，且方向不能反', () => {
  const p = datum.toMapPoint(CENTER);
  assert.ok(p.longitude > CENTER.longitude, '应向东偏');
  assert.ok(p.latitude < CENTER.latitude, '应向南偏');
  const back = datum.offsetMeters(p.longitude, p.latitude);
  assert.ok(back.distance > 0, '换算结果本身不该是零偏移点');
  const moved = Math.round(Math.hypot(
    (p.longitude - CENTER.longitude) * 111412.84 * Math.cos((CENTER.latitude * Math.PI) / 180),
    (p.latitude - CENTER.latitude) * 111132.92
  ));
  assert.ok(moved > 588 && moved < 600, '位移应约 594m，实际 ' + moved);
});

test('toMapPoint：境外原样返回，缺字段不生成 NaN', () => {
  const tokyo = datum.toMapPoint({ longitude: 139.6917, latitude: 35.6895 });
  assert.strictEqual(tokyo.longitude, 139.6917);
  assert.strictEqual(tokyo.latitude, 35.6895);
  const bad = datum.toMapPoint({ longitude: undefined, latitude: null });
  assert.strictEqual(Number.isFinite(bad.longitude), false);
  assert.strictEqual(Number.isFinite(bad.latitude), false);
  const empty = datum.toMapPoint(undefined);
  assert.ok(empty && typeof empty === 'object', '不得抛异常');
  // ★ 只缺一个字段同样要判无效：Number(null) === 0，否则半个坐标会被悄悄画到赤道上
  const halfLat = datum.toMapPoint({ longitude: 110.1, latitude: null });
  assert.strictEqual(Number.isFinite(halfLat.latitude), false, '纬度缺失必须整体无效，不得当成 0');
  const halfLng = datum.toMapPoint({ longitude: '', latitude: 27.5 });
  assert.strictEqual(Number.isFinite(halfLng.longitude), false, '经度为空串必须整体无效');
  const nanText = datum.toMapPoint({ longitude: 'abc', latitude: 27.5 });
  assert.strictEqual(Number.isFinite(nanText.longitude), false, '非数字文本必须整体无效');
});

test('toMapPoints：长度与顺序保持（分界线点多，不能错位）', () => {
  const src = [{ longitude: 110.0, latitude: 27.5 }, { longitude: 110.1, latitude: 27.4 }, { longitude: 110.2, latitude: 27.6 }];
  const out = datum.toMapPoints(src);
  assert.strictEqual(out.length, src.length);
  out.forEach((p, i) => {
    assert.ok(p.longitude > src[i].longitude, '第 ' + i + ' 点应向东偏');
    assert.ok(p.latitude < src[i].latitude, '第 ' + i + ' 点应向南偏');
  });
  assert.deepStrictEqual(datum.toMapPoints(null), [], '空值应返回空数组');
});

/* ---------------- 二、页面行为（真跑页面方法） ---------------- */

function loadMapPage() {
  let page = null;
  const calls = { translated: [] };
  global.Page = (o) => { page = o; };
  global.getApp = () => ({
    globalData: { location: { city: '中方县', latitude: CENTER.latitude, longitude: CENTER.longitude } },
    setLocation(l) { this.globalData.location = l; }
  });
  global.wx = {
    createMapContext: () => ({
      translateMarker: (o) => calls.translated.push(o),
      addGroundOverlay() {}, removeGroundOverlay() {}
    }),
    request() {}, downloadFile() {}, getStorageSync: () => '', setStorageSync() {},
    showLoading() {}, hideLoading() {}, showToast() {}
  };
  delete require.cache[require.resolve(path.join(R, 'pages/map/map.js'))];
  require(path.join(R, 'pages/map/map.js'));
  if (!page) throw new Error('页面未注册');
  const inst = Object.create(page);
  inst.data = JSON.parse(JSON.stringify(page.data));
  inst.setData = function (patch) { Object.assign(this.data, patch); };
  inst.mapContext = global.wx.createMapContext();
  return { inst, page, calls };
}

const sampleStations = [
  { id: 'r1', name: '铜湾', type: 'reservoir', status: 'normal', longitude: 110.2924, latitude: 27.58558 },
  { id: 'r2', name: '三角滩', type: 'reservoir', status: 'normal', longitude: 109.93833, latitude: 27.45417 },
  { id: 's1', name: '某墒情站', type: 'soil', status: 'normal', longitude: 110.0, latitude: 27.4 }
];

test('★ 站点 marker 必须换算过：坐标要移约 594m，不能直接用原始值', () => {
  const { inst } = loadMapPage();
  inst.data.allStations = sampleStations;
  inst.data.activeFilter = 'all';
  inst.updateMarkers();
  assert.strictEqual(inst.data.markers.length, sampleStations.length, 'marker 数量应与站点数一致');
  inst.data.markers.forEach((m) => {
    const raw = sampleStations.filter((s) => s.name === m.title)[0];
    assert.ok(raw, 'marker 标题应保留站点名：' + m.title);
    const expect = datum.toMapPoint(raw);
    assert.ok(Math.abs(m.latitude - expect.latitude) < 1e-9, m.title + ' 的纬度没换算');
    assert.ok(Math.abs(m.longitude - expect.longitude) < 1e-9, m.title + ' 的经度没换算');
    // 必须真的移动了（防止"换算函数被换成恒等函数"这类静默回归）
    const movedM = Math.round(Math.hypot(
      (m.longitude - raw.longitude) * 111412.84 * Math.cos((raw.latitude * Math.PI) / 180),
      (m.latitude - raw.latitude) * 111132.92
    ));
    assert.ok(movedM > 560 && movedM < 620, m.title + ' 的位移应约 594m，实际 ' + movedM);
  });
});

test('marker 面板仍拿到原始站点对象（展示的数值不能被坐标换算污染）', () => {
  const { inst } = loadMapPage();
  inst.data.allStations = sampleStations;
  inst.data.activeFilter = 'all';
  inst.updateMarkers();
  const first = inst.data.markers[0];
  const mapped = inst.data.markerMap[first.id];
  assert.strictEqual(mapped.name, '铜湾');
  assert.strictEqual(mapped.longitude, 110.2924, 'markerMap 里应是原始站点数据');
  assert.strictEqual(mapped.latitude, 27.58558);
});

test('点击动画的终点必须与 marker 实际显示位置一致（否则图标会被挪走）', () => {
  const { inst, calls } = loadMapPage();
  inst.data.allStations = sampleStations;
  inst.data.activeFilter = 'all';
  inst.updateMarkers();
  const first = inst.data.markers[0];
  inst.onMarkerTap({ markerId: first.id });
  assert.strictEqual(calls.translated.length, 1);
  const d = calls.translated[0].destination;
  assert.ok(Math.abs(d.latitude - first.latitude) < 1e-9, '动画终点纬度与 marker 不一致');
  assert.ok(Math.abs(d.longitude - first.longitude) < 1e-9, '动画终点经度与 marker 不一致');
});

test('乡镇分界线（polygon）也要换算，且按乡镇缓存', () => {
  const { page } = loadMapPage();
  const polys = page.data.townshipPolygons;
  assert.ok(polys.length >= 12, '应有 12 个乡镇多边形，实际 ' + polys.length);
  const raw = require(path.join(R, 'utils/townshipBoundaries.js')).TOWNSHIP_BOUNDARIES[0];
  const poly = polys[0];
  assert.strictEqual(poly.points.length, raw.points.length, '点数不能变');
  const a = poly.points[0], b = raw.points[0];
  assert.ok(a.longitude > b.longitude && a.latitude < b.latitude, '第一个点应向东向南偏');
  const movedM = Math.round(Math.hypot(
    (a.longitude - b.longitude) * 111412.84 * Math.cos((b.latitude * Math.PI) / 180),
    (a.latitude - b.latitude) * 111132.92
  ));
  assert.ok(movedM > 560 && movedM < 620, '分界线位移应约 594m，实际 ' + movedM);
  // 缓存：同一乡镇两次取到同一个数组实例
  const again = require(path.join(R, 'pages/map/map.js'));
  assert.strictEqual(again, require(path.join(R, 'pages/map/map.js')), '模块应被缓存');
});

test('地图中心（初始与乡镇切换）也要换算', () => {
  const { inst } = loadMapPage();
  const expect = datum.toMapPoint(CENTER);
  assert.ok(Math.abs(inst.data.centerLat - expect.latitude) < 1e-9, '初始中心纬度没换算，实际 ' + inst.data.centerLat);
  assert.ok(Math.abs(inst.data.centerLng - expect.longitude) < 1e-9, '初始中心经度没换算');
  assert.ok(Math.abs(inst.data.centerLat - CENTER.latitude) > 0.001, '初始中心不能还是原始 WGS-84 值');
});

test('app.globalData.location 本身保持 WGS-84（不能把换算写回全局，否则其他页会二次偏移）', () => {
  const src = read('pages/map/map.js');
  assert.ok(src.indexOf('app.setLocation(location)') !== -1, '选择乡镇时应把原始 location 存回全局');
  assert.strictEqual(/app\.setLocation\((centerOf|geoDatum)/.test(src), false, '不得把换算后的坐标写回全局状态');
  const app = read('app.js');
  assert.strictEqual(/geoDatum/.test(app), false, 'app.js 不应引入坐标换算');
});

/* ---------------- 三、反向边界：天气页不能跟着改 ---------------- */

test('★ 天气页自绘 canvas：不得做「正向」换算，但允许把外来 GCJ-02 数据拉回 WGS-84', () => {
  // 本页底图/乡镇/雷达都是同源 WGS-84，把它们推向 GCJ-02 会整体偏 594m（这就是当初的坑）。
  // 反过来：周边区划数据源（DataV）是 GCJ-02，必须用 gcjToWgs 拉回本页坐标系 —— 这个方向是必须的。
  const rain = read('pages/rainfall/rainfall.js');
  assert.strictEqual(/geoDatum\.(wgsToGcj|wgsBoundsToGcj|toMapPoint|toMapPoints)/.test(rain), false, '本页数据不得被推向 GCJ-02');
  assert.ok(/geoDatum\.gcjToWgs\(/.test(rain), '外来 GCJ-02 数据（周边区划）应拉回 WGS-84');
  assert.ok(rain.indexOf('geoLayer.COUNTY_BOUNDS') !== -1, '它应继续直接用 WGS-84 的县域范围');
});

test('地图页已完成坐标换算，且不再有雷达图层（2026-09-29 按用户要求移除）', () => {
  const src = read('pages/map/map.js');
  assert.ok(src.indexOf('geoDatum.toMapPoint') !== -1 && src.indexOf('geoDatum.toMapPoints') !== -1, '站点与分界线两条都要换算');
  assert.strictEqual(/radar|Radar/.test(src), false, '雷达已退场');
});

if (failed) {
  console.error('\n地图坐标校正：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n地图坐标校正：全部通过');
}
