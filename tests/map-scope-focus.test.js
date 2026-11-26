// 地图乡镇聚焦交互回归测试：
// ① 选乡镇后默认只渲染该乡镇边界内的点位（点在多边形内判定），周边密集点位不再遮挡；
// ② 聚焦提示条可切回全县；③ 选中 marker 放大 + 气泡常驻（BYALWAYS），关闭面板后复原；
// ④ 选乡镇自动放大视野（scale 13），回全县恢复 11；⑤ 点选后面板避让（includePoints）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(R, rel), 'utf8');
const { resolveTownshipLocation } = require('../utils/locationOptions.js');

const calls = { translated: [], includePoints: [] };

function loadMapPage(locationCity) {
  let page = null;
  global.Page = (o) => { page = o; };
  global.getApp = () => ({
    globalData: { location: resolveTownshipLocation(locationCity) },
    setLocation(l) { this.globalData.location = l; }
  });
  global.wx = {
    createMapContext: () => ({
      translateMarker: (o) => calls.translated.push(o),
      includePoints: (o) => calls.includePoints.push(o),
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
  return { inst, page };
}

// 中方镇中心一定落在中方镇边界内，桐木镇中心一定在外面（两组样本天然隔开）
const INSIDE = resolveTownshipLocation('中方镇');
const OUTSIDE = resolveTownshipLocation('桐木镇');
const sampleStations = [
  { id: 'in1', name: '镇内甲', type: 'reservoir', status: 'normal', longitude: INSIDE.longitude, latitude: INSIDE.latitude },
  { id: 'in2', name: '镇内乙', type: 'soil', status: 'normal', longitude: INSIDE.longitude + 0.004, latitude: INSIDE.latitude + 0.003 },
  { id: 'out1', name: '邻镇丙', type: 'reservoir', status: 'normal', longitude: OUTSIDE.longitude, latitude: OUTSIDE.latitude },
  { id: 'out2', name: '邻镇丁', type: 'river', status: 'normal', longitude: OUTSIDE.longitude + 0.005, latitude: OUTSIDE.latitude - 0.004 }
];

function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (e) {
    console.error('✗ ' + name);
    console.error('   ' + ((e && e.message) || e));
    process.exitCode = 1;
  }
}

test('选乡镇后默认聚焦：只有乡镇边界内的点位渲染成 marker', () => {
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = sampleStations;
  inst.onTownshipChange({ detail: { value: '1' } }); // 中方镇
  assert.strictEqual(inst.data.selectedRegionName, '中方镇');
  assert.strictEqual(inst.data.scale, 13, '选乡镇应放大视野，点位间距变大');
  assert.strictEqual(inst.data.markers.length, 2, '应只显示镇内 2 个点位，实际 ' + inst.data.markers.length);
  const names = inst.data.markers.map((m) => m.title);
  assert.ok(names.indexOf('镇内甲') >= 0 && names.indexOf('镇内乙') >= 0, '镇内点位应保留');
  assert.ok(names.indexOf('邻镇丙') < 0 && names.indexOf('邻镇丁') < 0, '镇外点位不得渲染');
  assert.strictEqual(inst.data.townshipStationCount, 2, '聚焦提示条应拿到本乡镇点位数');
});

test('切回全县（含定位按钮/全局定位同步）恢复全量点位与 scale 11', () => {
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = sampleStations;
  inst.onTownshipChange({ detail: { value: '1' } });
  inst.toggleScope();
  assert.strictEqual(inst.data.townshipFocus, false);
  assert.strictEqual(inst.data.markers.length, 4, '切换后应显示全县 4 个点位');
  inst.onTownshipChange({ detail: { value: '0' } }); // 全县
  assert.strictEqual(inst.data.scale, 11);
  assert.strictEqual(inst.data.markers.length, 4);
  assert.strictEqual(inst.data.townshipStationCount, 0, '全县模式无聚焦计数');
});

test('选中 marker 放大且气泡常驻（BYALWAYS），关闭面板复原', () => {
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = sampleStations;
  inst.onTownshipChange({ detail: { value: '1' } });
  const target = inst.data.markers[0];
  inst.onMarkerTap({ markerId: target.id });
  const selected = inst.data.markers.find((m) => m.id === target.id);
  assert.strictEqual(selected.width, 56, '选中图标应放大');
  assert.strictEqual(selected.callout.display, 'BYALWAYS', '选中气泡应常驻');
  const others = inst.data.markers.filter((m) => m.id !== target.id);
  others.forEach((m) => assert.strictEqual(m.callout.display, 'BYCLICK', '未选中气泡仍为点击显示'));
  inst.closePanel();
  assert.strictEqual(inst.data.markers.find((m) => m.id === target.id).width, 42, '关闭面板后图标复原');
  assert.strictEqual(inst.data.selectedStation, null);
});

test('点选点位后面板避让：includePoints 以选中点为中心给 ~8km 视野并抬到面板上方', () => {
  calls.includePoints.length = 0;
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = sampleStations;
  inst.updateMarkers();
  const target = inst.data.markers[0];
  inst.onMarkerTap({ markerId: target.id });
  assert.strictEqual(calls.includePoints.length, 1, '应调用 includePoints 避让面板');
  const arg = calls.includePoints[0];
  // 单点会把地图顶到最小视野（用户反馈「选中后视野过小」）：
  // 必须用选中点周边的虚拟包围盒（两个对角点）撑出 ~8km 视野
  assert.strictEqual(arg.points.length, 2, '应传包围盒两个对角点，而不是单点');
  const center = target.latitude; // marker 坐标在 GCJ-02 下与站点近似重合（594m 内）
  const dLat = Math.abs(arg.points[1].latitude - arg.points[0].latitude);
  const dLng = Math.abs(arg.points[1].longitude - arg.points[0].longitude);
  assert.ok(dLat > 0.07 && dLat < 0.09, '包围盒纬向跨度应约 0.08°（≈8km），实际 ' + dLat.toFixed(3));
  assert.ok(dLng > 0.07 && dLng < 0.09, '包围盒经向跨度应约 0.08°，实际 ' + dLng.toFixed(3));
  assert.ok(arg.padding[2] > arg.padding[0], 'padding 应下大上小，点位落在可视区上半段');
});

test('切换乡镇/筛选时清除选中态，不残留旧选中高亮', () => {
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = sampleStations;
  inst.updateMarkers();
  inst.onMarkerTap({ markerId: inst.data.markers[0].id });
  inst.setFilter({ currentTarget: { dataset: { type: 'reservoir' } } });
  assert.strictEqual(inst.data.selectedMarkerId, null);
  assert.ok(inst.data.markers.every((m) => m.callout.display === 'BYCLICK'), '切换筛选后不得残留常驻气泡');
});

test('乡镇内点位为零时不显示任何 marker（提示条如实说「暂无监测点位」）', () => {
  const { inst } = loadMapPage('中方县');
  inst.data.allStations = [sampleStations[2], sampleStations[3]]; // 只有镇外点位
  inst.onTownshipChange({ detail: { value: '1' } });
  assert.strictEqual(inst.data.markers.length, 0);
  assert.strictEqual(inst.data.townshipStationCount, 0);
  const wxml = read('pages/map/map.wxml');
  assert.ok(wxml.indexOf('暂无监测点位') !== -1, '提示条应对空乡镇如实说明');
});

/* ---------------- 浮层整合（防再次拥挤的回归锁定） ---------------- */

test('顶部三件套合并：区域选择与重定位在同一个 header 里', () => {
  const wxml = read('pages/map/map.wxml');
  const header = wxml.slice(wxml.indexOf('map-header'), wxml.indexOf('map-load-failed'));
  assert.ok(header.indexOf('bindchange="onTownshipChange"') !== -1, 'header 内应有乡镇选择');
  assert.ok(header.indexOf('bindtap="moveToLocation"') !== -1, 'header 内应有重定位按钮');
  assert.strictEqual(wxml.indexOf('map-title-card'), -1, '旧标题卡应已删除');
  assert.strictEqual(wxml.indexOf('legend'), -1, '旧图例卡应已删除（色点由筛选栏表达）');
  assert.strictEqual(wxml.indexOf('region-btn'), -1, '旧区域浮层按钮应已并入 header');
  assert.strictEqual(wxml.indexOf('locate-btn'), -1, '旧定位浮层按钮应已并入 header');
});

test('聚焦取景：includePoints 装下乡镇边界全部点位（换算成底图坐标）', () => {
  calls.includePoints.length = 0;
  const { inst } = loadMapPage('中方县');
  inst.onTownshipChange({ detail: { value: '1' } });
  assert.strictEqual(calls.includePoints.length, 1, '选乡镇应触发边界自适应取景');
  const arg = calls.includePoints[0];
  const raw = require('../utils/townshipBoundaries.js').TOWNSHIP_BOUNDARIES.find((b) => b.name === '中方镇');
  const datum = require('../utils/geoDatum.js');
  assert.strictEqual(arg.points.length, raw.points.length, '边界点位数不能丢');
  const expect = datum.toMapPoints(raw.points);
  assert.ok(Math.abs(arg.points[0].latitude - expect[0].latitude) < 1e-9, '边界点必须换算到 GCJ-02');
  assert.ok(arg.padding[2] > arg.padding[0] === false || arg.padding.length === 4, 'padding 应为四元数组');
});

test('切回全县不做边界取景（保持县中心 + scale 11）', () => {
  calls.includePoints.length = 0;
  const { inst } = loadMapPage('中方县');
  inst.onTownshipChange({ detail: { value: '0' } });
  assert.strictEqual(calls.includePoints.length, 0, '全县模式不应触发乡镇取景');
});

test('聚焦提示并入顶部区域选择：计数徽章 + 切换按钮都在 header 内，旧聚焦条已删除', () => {
  const wxml = read('pages/map/map.wxml');
  const header = wxml.slice(wxml.indexOf('map-header'), wxml.indexOf('map-load-failed'));
  assert.ok(header.indexOf('bindchange="onTownshipChange"') !== -1, 'header 内应有乡镇选择');
  assert.ok(header.indexOf('townshipStationCount') !== -1, 'header 内应显示本乡镇点位计数');
  assert.ok(header.indexOf('bindtap="toggleScope"') !== -1, 'header 内应有聚焦/全县切换按钮');
  assert.ok(header.indexOf('bindtap="moveToLocation"') !== -1, 'header 内应有重定位按钮');
  assert.strictEqual(wxml.indexOf('scope-pill'), -1, '旧聚焦提示条应已并入 header');
  assert.strictEqual(wxml.indexOf('map-title-card'), -1, '旧标题卡应已删除');
  assert.strictEqual(wxml.indexOf('legend'), -1, '旧图例卡应已删除（色点由筛选栏表达）');
  const css = read('pages/map/map.wxss');
  assert.strictEqual(css.indexOf('.scope-pill'), -1, '旧聚焦条样式应已清理');
  assert.ok(/\.header-region\.focus\{/.test(css), '聚焦态应在区域选择上高亮');
  assert.ok(/\.header-region-count\{/.test(css) && /\.header-region-count\.off\{/.test(css), '计数徽章应有聚焦/非聚焦两态');
});

test('失败横幅位于筛选栏下方，不与其重叠', () => {
  const css = read('pages/map/map.wxss');
  const failedTop = Number((css.match(/\.map-load-failed\{position:absolute;top:(\d+)rpx/) || [])[1]);
  assert.ok(failedTop > 126, '横幅应在筛选栏（top 126）之下');
});

test('底部说明条保留乡镇分界线说明与点位计数', () => {
  const wxml = read('pages/map/map.wxml');
  const note = wxml.slice(wxml.indexOf('map-note'));
  assert.ok(note.indexOf('乡镇分界线') !== -1);
  assert.ok(note.indexOf('hiddenMarkerCount') !== -1, '超出上限的点位计数应保留');
});

if (!process.exitCode) {
  console.log('\n地图乡镇聚焦交互：全部通过');
}
