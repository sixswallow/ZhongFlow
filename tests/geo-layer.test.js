const assert = require('assert');
const geo = require('../utils/geoLayer.js');
const { TOWNSHIP_BOUNDARIES } = require('../utils/townshipBoundaries.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('县域范围由真实乡镇边界推导，且包含全部乡镇中心', () => {
  const b = geo.COUNTY_BOUNDS;
  assert.ok(b.east > b.west && b.north > b.south, '县域范围必须有正面积');
  TOWNSHIP_BOUNDARIES.forEach((t) => {
    assert.ok(t.center.longitude >= b.west && t.center.longitude <= b.east, `${t.name} 中心经度应落在县域范围内`);
    assert.ok(t.center.latitude >= b.south && t.center.latitude <= b.north, `${t.name} 中心纬度应落在县域范围内`);
  });
});

test('烘焙底图范围在公里意义上接近正方形，且包住任意常见屏幕比例的视窗', () => {
  const size = geo.boundsSizeKm(geo.BAKE_BOUNDS);
  assert.ok(Math.abs(size.width - size.height) / size.width < 0.01, '烘焙范围应近似公里正方形');
  // 页面画布比例（宽/高）实测在 0.9~1.1 之间，取更宽的范围做兜底
  [0.7, 0.92, 1, 1.084, 1.4].forEach((aspect) => {
    const view = geo.viewFor(aspect);
    assert.ok(view.west >= geo.BAKE_BOUNDS.west - 1e-9, `比例 ${aspect} 的视窗西边界超出烘焙底图`);
    assert.ok(view.east <= geo.BAKE_BOUNDS.east + 1e-9, `比例 ${aspect} 的视窗东边界超出烘焙底图`);
    assert.ok(view.south >= geo.BAKE_BOUNDS.south - 1e-9, `比例 ${aspect} 的视窗南边界超出烘焙底图`);
    assert.ok(view.north <= geo.BAKE_BOUNDS.north + 1e-9, `比例 ${aspect} 的视窗北边界超出烘焙底图`);
  });
});

test('视窗比例与画布一致、县域完整可见且居中', () => {
  const aspect = 271 / 250;
  const view = geo.viewFor(aspect);
  const size = geo.boundsSizeKm(view);
  assert.ok(Math.abs(size.width / size.height - aspect) < 0.01, '视窗宽高比应等于画布宽高比');
  assert.ok(view.west <= geo.COUNTY_BOUNDS.west && view.east >= geo.COUNTY_BOUNDS.east, '视窗应完整包含县域经度范围');
  assert.ok(view.south <= geo.COUNTY_BOUNDS.south && view.north >= geo.COUNTY_BOUNDS.north, '视窗应完整包含县域纬度范围');
  const c = geo.boundsCenter(view), cc = geo.boundsCenter(geo.COUNTY_BOUNDS);
  assert.ok(Math.abs(c.longitude - cc.longitude) < 1e-6 && Math.abs(c.latitude - cc.latitude) < 1e-6, '视窗应以县域中心为中心');
});

test('投影是严格仿射的：四角与往返换算无误差', () => {
  const view = geo.viewFor(271 / 250);
  const p = geo.makeProjector(view, 271, 250);
  const nw = p.toPx(view.west, view.north), se = p.toPx(view.east, view.south);
  assert.ok(Math.abs(nw.x) < 1e-6 && Math.abs(nw.y) < 1e-6, '西北角应映射到 (0,0)');
  assert.ok(Math.abs(se.x - 271) < 1e-6 && Math.abs(se.y - 250) < 1e-6, '东南角应映射到 (宽,高)');
  const probe = { longitude: 110.1234, latitude: 27.4567 };
  const px = p.toPx(probe.longitude, probe.latitude);
  const back = p.toLngLat(px.x, px.y);
  assert.ok(Math.abs(back.longitude - probe.longitude) < 1e-9, '经度往返误差应可忽略');
  assert.ok(Math.abs(back.latitude - probe.latitude) < 1e-9, '纬度往返误差应可忽略');
});

test('底图矩形铺满并溢出画布（缩放后不会露白边）', () => {
  const view = geo.viewFor(271 / 250);
  const p = geo.makeProjector(view, 271, 250);
  const r = p.rectOfBounds(geo.BAKE_BOUNDS);
  assert.ok(r.x <= 0 && r.y <= 0, '底图矩形左上角应在画布之外');
  assert.ok(r.x + r.width >= 271 && r.y + r.height >= 250, '底图矩形右下角应覆盖画布');
});

test('墨卡托瓦片换算自洽，且瓦片集合覆盖整个视窗', () => {
  const view = geo.viewFor(271 / 250);
  assert.ok(Math.abs(geo.tileYToLat(geo.latToTileY(27.5, 9), 9) - 27.5) < 1e-9, '纬度与瓦片行号应可往返');
  assert.ok(Math.abs(geo.tileXToLng(geo.lngToTileX(110.1, 9), 9) - 110.1) < 1e-9, '经度与瓦片列号应可往返');
  const z = geo.pickZoom(view, 542);
  const range = geo.tileRange(view, z);
  const p = geo.makeProjector(view, 271, 250);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      const r = p.rectOfBounds(geo.tileBounds(z, x, y));
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
    }
  }
  assert.ok(minX <= 0.5 && minY <= 0.5, '瓦片集合应覆盖画布左上角');
  assert.ok(maxX >= 270.5 && maxY >= 249.5, '瓦片集合应覆盖画布右下角');
});

test('雷达层级受免费源限制：任何视窗都不会超过 z=7', () => {
  const aspect = 271 / 250;
  // 视窗越小需要的层级越高，这里断言被 MAX_ZOOM 兜住
  [geo.viewFor(aspect), geo.squareBoxKm(geo.COUNTY_CENTER, 20), geo.squareBoxKm(geo.COUNTY_CENTER, 5)].forEach((view) => {
    const z = geo.pickZoom(view, 542);
    assert.ok(z <= geo.LAYER.MAX_ZOOM, `层级 ${z} 超过了免费源可用上限 ${geo.LAYER.MAX_ZOOM}`);
    assert.ok(z === geo.LAYER.MAX_ZOOM, '小视窗应取到上限层级');
  });
  assert.strictEqual(geo.LAYER.MAX_ZOOM, 7, 'RainViewer 免费源实测 z≥8 恒为空瓦片，上限必须为 7');
});

test('距离换算符合常识', () => {
  const c = geo.COUNTY_CENTER;
  const km = geo.distanceKm(c.latitude, c.longitude, c.latitude + 1, c.longitude);
  assert.ok(Math.abs(km - 111.2) < 2, '1 度纬度应约等于 111km');
  assert.strictEqual(geo.distanceKm(c.latitude, c.longitude, c.latitude, c.longitude), 0);
});

test('缩放：中心锚点缩放后中心不变、跨度按比例变化', () => {
  const view = geo.viewFor(271 / 250);
  const before = geo.boundsSizeKm(view);
  const zoomed = geo.zoomView(view, 2, 0.5, 0.5, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  const after = geo.boundsSizeKm(zoomed);
  assert.ok(Math.abs(after.width - before.width / 2) < 1e-6, '放大 2 倍后视窗宽度应减半');
  assert.ok(Math.abs(after.height - before.height / 2) < 1e-6, '高度应同比减半');
  const c1 = geo.boundsCenter(view), c2 = geo.boundsCenter(zoomed);
  assert.ok(Math.abs(c1.longitude - c2.longitude) < 1e-9 && Math.abs(c1.latitude - c2.latitude) < 1e-9, '中心锚点缩放时中心不得漂移');
});

test('缩放：角锚点缩放后该角地理坐标固定（双指捏合的手感就靠这个）', () => {
  const view = geo.viewFor(271 / 250);
  const nw = geo.zoomView(view, 1.8, 0, 0, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  assert.ok(Math.abs(nw.west - view.west) < 1e-9, '左上锚点：西边界应固定');
  assert.ok(Math.abs(nw.north - view.north) < 1e-9, '左上锚点：北边界应固定');
  const se = geo.zoomView(view, 1.8, 1, 1, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  assert.ok(Math.abs(se.east - view.east) < 1e-9, '右下锚点：东边界应固定');
  assert.ok(Math.abs(se.south - view.south) < 1e-9, '右下锚点：南边界应固定');
});

test('缩放：受上下限约束，且始终留在烘焙底图范围内', () => {
  const view = geo.viewFor(271 / 250);
  let v = view;
  for (let i = 0; i < 20; i++) v = geo.zoomView(v, 1.6, 0.5, 0.5, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  assert.ok(geo.viewSpanKm(v) >= geo.LAYER.MIN_SPAN_KM - 1e-6, '连续放大不得突破下限');
  let w = view;
  for (let i = 0; i < 20; i++) w = geo.zoomView(w, 1 / 1.6, 0.5, 0.5, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  assert.ok(geo.viewSpanKm(w) <= geo.LAYER.MAX_SPAN_KM + 1e-6, '连续缩小不得突破上限');
  assert.ok(geo.viewSpanKm(w) <= geo.boundsSizeKm(geo.BAKE_BOUNDS).width, '缩小不得超过烘焙底图覆盖范围');
});

test('平移：拖动像素数与地理位移严格对应，方向符合直觉', () => {
  const view = geo.viewFor(271 / 250);
  const width = 271;
  const kmPerPx = geo.boundsSizeKm(view).width / width;
  const moved = geo.panView(view, 27, 0, width);
  const spanLng = (moved.east - moved.west);
  const expectDlng = (27 * kmPerPx) / geo.kmPerDegLng(geo.boundsCenter(view).latitude);
  assert.ok(Math.abs((view.west - moved.west) - expectDlng) < 1e-9, '向右拖动应让视窗向西移动');
  assert.ok(Math.abs(spanLng - (view.east - view.west)) < 1e-9, '平移不得改变视窗跨度');
  const down = geo.panView(view, 0, 27, width);
  assert.ok(down.north > view.north, '向下拖动应让视窗向北移动（露出北边）');
});

test('钳制：视窗不得越出允许范围（否则底图露白）', () => {
  const limit = geo.BAKE_BOUNDS;
  const inside = geo.viewFor(271 / 250);
  const same = geo.clampView(inside, limit);
  assert.ok(Math.abs(same.west - inside.west) < 1e-12 && Math.abs(same.north - inside.north) < 1e-12, '本就在范围内时不应改动');
  let far = inside;
  for (let i = 0; i < 30; i++) far = geo.panView(far, 400, 0, 271);
  const clamped = geo.clampView(far, limit);
  assert.ok(clamped.west >= limit.west - 1e-9 && clamped.east <= limit.east + 1e-9, '经度方向应被钳制在范围内');
  assert.ok(clamped.south >= limit.south - 1e-9 && clamped.north <= limit.north + 1e-9, '纬度方向应被钳制在范围内');
  const huge = geo.squareBoxKm(geo.COUNTY_CENTER, 400);
  const centered = geo.clampView(huge, limit);
  const c1 = geo.boundsCenter(centered), c2 = geo.boundsCenter(limit);
  assert.ok(Math.abs(c1.longitude - c2.longitude) < 1e-9 && Math.abs(c1.latitude - c2.latitude) < 1e-9, '视窗比允许范围还大时应居中');
});

test('风场取样范围：包住视窗且不越界', () => {
  const view = geo.viewFor(271 / 250);
  const box = geo.expandView(view, 1.3, geo.BAKE_BOUNDS);
  assert.ok(box.west <= view.west + 1e-9 && box.east >= view.east - 1e-9, '取样范围必须包住视窗经度');
  assert.ok(box.south <= view.south + 1e-9 && box.north >= view.north - 1e-9, '取样范围必须包住视窗纬度');
  assert.ok(box.west >= geo.BAKE_BOUNDS.west - 1e-9 && box.east <= geo.BAKE_BOUNDS.east + 1e-9, '取样范围不得越出允许范围');
});

test('缩放+平移后投影仍自洽（同一地理点在不同视窗下都可逆）', () => {
  let view = geo.viewFor(271 / 250);
  view = geo.zoomView(view, 2.4, 0.3, 0.7, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  view = geo.clampView(geo.panView(view, 40, -25, 271), geo.BAKE_BOUNDS);
  const p = geo.makeProjector(view, 271, 250);
  const probe = { longitude: 110.2, latitude: 27.55 };
  const px = p.toPx(probe.longitude, probe.latitude);
  const back = p.toLngLat(px.x, px.y);
  assert.ok(Math.abs(back.longitude - probe.longitude) < 1e-9 && Math.abs(back.latitude - probe.latitude) < 1e-9, '缩放平移后投影必须仍可逆');
});

console.log('气象图层几何与瓦片测试通过。');

test('卡片↔全屏切换：保持中心与纵向跨度，两轴像素比严格一致（不拉伸）', () => {
  const cardView = geo.viewFor(315 / 290);
  const fsView = geo.applyAspect(cardView, 351 / 372);
  const c0 = geo.boundsCenter(cardView);
  const c1 = geo.boundsCenter(fsView);
  assert.ok(Math.abs(c0.latitude - c1.latitude) < 1e-9, '中心纬度不得漂移');
  assert.ok(Math.abs(c0.longitude - c1.longitude) < 1e-9, '中心经度不得漂移');
  const s0 = geo.boundsSizeKm(cardView);
  const s1 = geo.boundsSizeKm(fsView);
  assert.ok(Math.abs(s1.height - s0.height) < 0.01, '纵向跨度应保持');
  const pxKmX = 351 / s1.width;
  const pxKmY = 372 / s1.height;
  assert.ok(Math.abs(pxKmX - pxKmY) < 1e-6, '两轴每公里像素必须相等，否则底图与站点被拉长');
});

test('「县域」取景：县域完整入画、比默认视窗更近、且不小于缩放下限', () => {
  const view = geo.viewForCounty(315 / 290);
  const b = geo.COUNTY_BOUNDS;
  assert.ok(view.west <= b.west && view.east >= b.east && view.south <= b.south && view.north >= b.north, '县域必须完整落在取景框内');
  assert.ok(geo.boundsSizeKm(view).width < geo.LAYER.VIEW_SPAN_KM, '应比默认 200km 视窗更近');
  assert.ok(geo.viewSpanKm(view) >= geo.LAYER.MIN_SPAN_KM, '不应小于缩放下限');
  const countyW = geo.boundsSizeKm(b).width;
  assert.ok(countyW / geo.boundsSizeKm(view).width > 0.6, '县域至少占画布宽 60%，否则谈不上「放大看」');
});

test('重定位：中心精确落位、跨度不变（只挪位置，不改缩放）', () => {
  const view = geo.viewFor(315 / 290);
  const target = geo.boundsCenter(geo.COUNTY_BOUNDS);
  const before = geo.boundsSizeKm(view);
  const moved = geo.recenterView(view, target);
  const after = geo.boundsSizeKm(moved);
  const c = geo.boundsCenter(moved);
  assert.ok(Math.abs(c.latitude - target.latitude) < 1e-9, '纬度中心应精确落位');
  assert.ok(Math.abs(c.longitude - target.longitude) < 1e-9, '经度中心应精确落位');
  assert.ok(Math.abs(after.width - before.width) < 1e-6, '东西跨度不得变化');
  assert.ok(Math.abs(after.height - before.height) < 1e-6, '南北跨度不得变化');
  // 被拖到角落的视窗也必须能被拉回县域中心
  const corner = { west: 110.4, east: 111.4, south: 26.3, north: 26.95 };
  const back = geo.boundsCenter(geo.recenterView(corner, target));
  assert.ok(Math.abs(back.longitude - target.longitude) < 1e-9 && Math.abs(back.latitude - target.latitude) < 1e-9, '角落视窗也要能回到县域中心');
});
