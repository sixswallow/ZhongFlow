const assert = require('assert');
const geo = require('../utils/geoLayer.js');
const wind = require('../utils/layerWind.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const VIEW = geo.viewFor(271 / 250);
const GX = wind.WIND.GRID_X, GY = wind.WIND.GRID_Y;
const proj = geo.makeProjector(VIEW, 271, 250);
// 与页面一致：先把画布像素反算成经纬度，再按经纬度采样
const samplerFor = (field) => (x, y) => {
  const g = proj.toLngLat(x, y);
  return wind.sampleFieldAt(field, g.longitude, g.latitude);
};

// 构造多点返回：direction 为「来向」，speed 单位 m/s
const fakeResponse = (direction, speed) =>
  Array.from({ length: GX * GY }, (_, i) => ({
    latitude: 27 + i * 0.01, longitude: 110 + i * 0.01,
    ...(i === 0 ? {} : { location_id: i }),
    current: { time: '2026-09-22T19:00', wind_speed_10m: speed, wind_direction_10m: direction },
  }));

test('网格点位：数量正确、行优先、第一点西北、末点东南且落在视窗内', () => {
  const pts = wind.buildPoints(VIEW, GX, GY);
  assert.strictEqual(pts.length, GX * GY);
  assert.ok(Math.abs(pts[0].latitude - VIEW.north) < 1e-5 && Math.abs(pts[0].longitude - VIEW.west) < 1e-5, '首点应为西北角');
  assert.ok(Math.abs(pts[pts.length - 1].latitude - VIEW.south) < 1e-5 && Math.abs(pts[pts.length - 1].longitude - VIEW.east) < 1e-5, '末点应为东南角');
  pts.forEach((p, i) => {
    assert.ok(p.latitude <= VIEW.north + 1e-6 && p.latitude >= VIEW.south - 1e-6, `第 ${i} 点纬度越界`);
    assert.ok(p.longitude >= VIEW.west - 1e-6 && p.longitude <= VIEW.east + 1e-6, `第 ${i} 点经度越界`);
  });
  // 同一行内纬度不变、经度递增
  assert.strictEqual(pts[0].latitude, pts[1].latitude);
  assert.ok(pts[1].longitude > pts[0].longitude);
  assert.ok(pts[GX].latitude < pts[0].latitude, '换行后纬度应减小');
});

test('请求 URL 含全部坐标与所需字段', () => {
  const pts = wind.buildPoints(VIEW, GX, GY);
  const url = wind.buildUrl(pts);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'), '必须指向 Open-Meteo');
  assert.ok(url.includes('current=wind_speed_10m,wind_direction_10m'), '必须请求风速风向');
  assert.ok(url.includes('wind_speed_unit=ms'), '必须统一为 m/s');
  assert.strictEqual(url.split('latitude=')[1].split('&')[0].split(',').length, GX * GY);
  assert.strictEqual(url.split('longitude=')[1].split('&')[0].split(',').length, GX * GY);
});

test('风向语义（最易写错处）：来向 → 屏幕运动方向', () => {
  // 北风(0°)：自北吹来 → 向南运动 = 屏幕 +y
  const north = wind.parseField(fakeResponse(0, 10), GX, GY, 0, VIEW);
  assert.ok(north.v[0] > 9.9, '北风应产生向南(+y)的正分量');
  assert.ok(Math.abs(north.u[0]) < 1e-6, '北风不应有东西向分量');
  // 东风(90°)：自东吹来 → 向西运动 = 屏幕 -x
  const east = wind.parseField(fakeResponse(90, 10), GX, GY, 0, VIEW);
  assert.ok(east.u[0] < -9.9, '东风应产生向西(-x)的负分量');
  assert.ok(Math.abs(east.v[0]) < 1e-6, '东风不应有南北向分量');
  // 南风(180°)：自南吹来 → 向北运动 = 屏幕 -y
  const south = wind.parseField(fakeResponse(180, 10), GX, GY, 0, VIEW);
  assert.ok(south.v[0] < -9.9, '南风应产生向北(-y)的负分量');
  // 西风(270°)：自西吹来 → 向东运动 = 屏幕 +x
  const west = wind.parseField(fakeResponse(270, 10), GX, GY, 0, VIEW);
  assert.ok(west.u[0] > 9.9, '西风应产生向东(+x)的正分量');
});

test('解析结果：风速统计、静风与缺值降级', () => {
  const field = wind.parseField(fakeResponse(45, 4), GX, GY, 0, VIEW);
  assert.strictEqual(field.gx, GX);
  assert.strictEqual(field.gy, GY);
  assert.ok(Math.abs(field.minSpeed - 4) < 1e-6 && Math.abs(field.maxSpeed - 4) < 1e-6);
  assert.strictEqual(field.valid, GX * GY);
  const still = wind.parseField(fakeResponse(0, 0), GX, GY, 0, VIEW);
  assert.strictEqual(still.maxSpeed, 0);
  assert.deepStrictEqual(wind.meanVector(still), { speed: 0, direction: 0, label: '静风' });
  // 缺字段不得抛错，按 0 处理
  const broken = wind.parseField(Array.from({ length: GX * GY }, () => ({ current: {} })), GX, GY, 0, VIEW);
  assert.strictEqual(broken.valid, 0);
  assert.strictEqual(broken.maxSpeed, 0);
});

test('网格数量不符时明确报错，而不是静默错位', () => {
  assert.throws(() => wind.parseField(fakeResponse(0, 1).slice(0, 5), GX, GY, 0, VIEW), /风场网格数量不符/);
});

test('兼容扁平返回结构（无 current 包裹）', () => {
  const flat = Array.from({ length: GX * GY }, () => ({ wind_speed_10m: 2, wind_direction_10m: 180 }));
  const field = wind.parseField(flat, GX, GY, 0, VIEW);
  assert.ok(field.v[0] < -1.9, '扁平结构同样应正确解析方向');
});

test('双线性插值：节点值精确、中点取平均、越界钳制', () => {
  const four = Array.from({ length: 4 }, () => ({ current: { wind_speed_10m: 10, wind_direction_10m: 0 } }));
  const field = wind.parseField(four, 2, 2);
  assert.ok(Math.abs(wind.sampleField(field, 0, 0).v - 10) < 1e-6, '左上角应等于节点值');
  assert.ok(Math.abs(wind.sampleField(field, 1, 1).v - 10) < 1e-6, '右下角应等于节点值');
  assert.ok(Math.abs(wind.sampleField(field, 0.5, 0.5).v - 10) < 1e-6, '均匀场中值仍为原值');
  assert.ok(Math.abs(wind.sampleField(field, -3, 5).v - 10) < 1e-6, '越界坐标应钳制');
  assert.deepStrictEqual(wind.sampleField(null, 0.5, 0.5), { u: 0, v: 0 });
});

test('均值风向：均匀东风应报「东风」，蒲福风级换算符合国标区间', () => {
  const east = wind.parseField(fakeResponse(90, 3), GX, GY, 0, VIEW);
  const mean = wind.meanVector(east);
  assert.strictEqual(mean.label, '东风');
  assert.ok(Math.abs(mean.direction - 90) < 1e-6);
  assert.strictEqual(wind.beaufort(0.2), 0);
  assert.strictEqual(wind.beaufort(2), 2);
  assert.strictEqual(wind.beaufort(3.5), 3);
  assert.strictEqual(wind.beaufort(12), 6);
  assert.strictEqual(wind.directionLabel(0), '北');
  assert.strictEqual(wind.directionLabel(45), '东北');
  assert.strictEqual(wind.directionLabel(180), '南');
  assert.strictEqual(wind.directionLabel(270), '西');
  assert.strictEqual(wind.directionLabel(350), '北');
});

test('粒子：数量随画布面积变化且在上下限内，注入随机源后完全可复现', () => {
  assert.ok(wind.particleCountFor(271, 250) >= wind.WIND.PARTICLE_MIN);
  assert.ok(wind.particleCountFor(10000, 10000) <= wind.WIND.PARTICLE_MAX);
  assert.ok(wind.particleCountFor(10, 10) >= wind.WIND.PARTICLE_MIN);
  const rng = () => 0.5;
  const a = wind.createParticles(5, 271, 250, rng);
  const b = wind.createParticles(5, 271, 250, rng);
  assert.deepStrictEqual(a.map((p) => [p.x, p.y]), b.map((p) => [p.x, p.y]));
  assert.ok(Math.abs(a[0].x - 135.5) < 1e-9 && Math.abs(a[0].y - 125) < 1e-9);
  assert.strictEqual(a[0].trail.length, 1, '初始拖尾只含当前位置');
  assert.strictEqual(a[0].trailLen, wind.WIND.TRAIL_LEN);
});

test('粒子拖尾：长度受上限约束，末点即当前位置，重播后清零', () => {
  const field = wind.parseField(fakeResponse(0, 2), GX, GY, 0, VIEW);
  const parts = wind.createParticles(1, 271, 250, () => 0.5);
  for (let i = 0; i < 30; i++) wind.advanceParticles(parts, samplerFor(field), 1 / 60, 271, 250, () => 0.5);
  assert.strictEqual(parts[0].trail.length, wind.WIND.TRAIL_LEN, '拖尾长度不得超过上限');
  const last = parts[0].trail[parts[0].trail.length - 1];
  assert.ok(Math.abs(last.x - parts[0].x) < 1e-9 && Math.abs(last.y - parts[0].y) < 1e-9, '拖尾末点应为当前位置');
  assert.ok(parts[0].trail[0].y < last.y, '北风下拖尾应从北向南延伸');
  // 强制越界重播
  const out = [{ x: 270, y: 249, x0: 0, y0: 0, age: 0, maxAge: 1, trailLen: 7, trail: [{ x: 1, y: 1 }] }];
  wind.advanceParticles(out, samplerFor(field), 1, 271, 250, () => 0.5);
  assert.strictEqual(out[0].trail.length, 1, '重播后拖尾应重置');
});

test('粒子推进：均匀场中位移等于风速×换算系数，越界粒子被重播', () => {
  const field = wind.parseField(fakeResponse(0, 2), GX, GY, 0, VIEW); // 北风 → 向南
  const rng = () => 0.4;
  const parts = [{ x: 100, y: 50, x0: 0, y0: 0, age: 0, maxAge: 999 }];
  const dt = 1 / 30;
  wind.advanceParticles(parts, samplerFor(field), dt, 271, 250, rng);
  const expected = 2 * wind.WIND.PX_PER_MS_PER_SEC * dt;
  assert.ok(Math.abs(parts[0].x - 100) < 1e-9, '北风不应产生横向位移');
  assert.ok(Math.abs((parts[0].y - 50) - expected) < 1e-6, '纵向位移应等于风速×换算系数×时间');
  assert.strictEqual(parts[0].x0, 100, '应保留旧位置供画线段');
  assert.strictEqual(parts[0].y0, 50);
  // 越界重播
  const out = [{ x: 270, y: 249, x0: 0, y0: 0, age: 0, maxAge: 999 }];
  const r = wind.advanceParticles(out, samplerFor(field), 1, 271, 250, rng);
  assert.strictEqual(r.respawned, 1);
  assert.ok(out[0].x >= 0 && out[0].x <= 271 && out[0].y >= 0 && out[0].y <= 250, '重播后必须落在画布内');
  assert.strictEqual(out[0].age, 0, '重播后寿命应清零');
  // 超龄重播
  const old = [{ x: 10, y: 10, x0: 0, y0: 0, age: 99, maxAge: 99 }];
  assert.strictEqual(wind.advanceParticles(old, samplerFor(field), 1 / 30, 271, 250, rng).respawned, 1);
});

test('按经纬度采样：均匀场处处一致，越出范围被钳制', () => {
  const field = wind.parseField(fakeResponse(0, 5), GX, GY, 0, VIEW);
  assert.ok(Math.abs(wind.sampleFieldAt(field, VIEW.west + 0.01, VIEW.north - 0.01).v - 5) < 1e-6, '视窗内采样应等于场值');
  assert.ok(Math.abs(wind.sampleFieldAt(field, 100, 20).v - 5) < 1e-6, '越出范围应钳制而不是发散');
  assert.deepStrictEqual(wind.sampleFieldAt(null, 110, 27), { u: 0, v: 0 });
  assert.deepStrictEqual(wind.sampleFieldAt(wind.parseField(fakeResponse(0, 5), GX, GY, 0, null), 110, 27), { u: 0, v: 0 }, '没有取样范围时不得瞎猜');
});

test('缩放不变形：同一地理点在放大后的视窗里风矢量完全一致', () => {
  const field = wind.parseField(fakeResponse(45, 6), GX, GY, 0, VIEW);
  const probe = { longitude: 110.15, latitude: 27.5 };
  const before = wind.sampleFieldAt(field, probe.longitude, probe.latitude);
  const zoomed = geo.zoomView(VIEW, 3, 0.5, 0.5, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  const proj2 = geo.makeProjector(zoomed, 271, 250);
  const px2 = proj2.toPx(probe.longitude, probe.latitude);
  const g2 = proj2.toLngLat(px2.x, px2.y);
  const after = wind.sampleFieldAt(field, g2.longitude, g2.latitude);
  assert.ok(Math.abs(after.u - before.u) < 1e-6 && Math.abs(after.v - before.v) < 1e-6, '放大后同一地理点的风矢量必须不变（风场不能跟着视窗缩放）');
});

test('取样范围判断与网格分档：决定何时重新请求风场', () => {
  const box = geo.expandView(VIEW, 1.3, geo.BAKE_BOUNDS);
  const field = wind.parseField(fakeResponse(0, 3), GX, GY, 0, box);
  assert.strictEqual(wind.fieldCovers(field, VIEW, 0), true, '视窗在范围内应判定为覆盖');
  assert.strictEqual(wind.fieldCovers(field, geo.squareBoxKm(geo.COUNTY_CENTER, 900), 0), false, '视窗超出范围应判定为不覆盖');
  const zoomed = geo.zoomView(VIEW, 4, 0.5, 0.5, geo.LAYER.MIN_SPAN_KM, geo.LAYER.MAX_SPAN_KM);
  assert.strictEqual(wind.needsDenserGrid(field, zoomed, 2.2), true, '放大 4 倍后应换更密的网格');
  assert.strictEqual(wind.needsDenserGrid(field, VIEW, 2.2), false, '同尺度不需要换网格');
  assert.strictEqual(wind.spanBucket(200), wind.spanBucket(210), '同档位不应重复请求');
  assert.notStrictEqual(wind.spanBucket(200), wind.spanBucket(60), '跨档位应重新请求');
});

console.log('风场图层测试通过。');
