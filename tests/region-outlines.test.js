// 周边区划轮廓（显示中方县与邻县的相对位置）
//
// 数据：怀化市 12 个区县边界，来自阿里云 DataV 公开 GeoJSON（431200_full）。
// 坐标系：经「最近距离评分」判定 DataV 是 **GCJ-02**（不换算 900m ↔ 换算后 602m，
//   最佳平行位移正是 594m 那个经典偏移），而本页底图是 WGS-84 ⇒ 绘制前必须 gcjToWgs。
// 本文件锁住：数据完整性、必须换算、只换算一次、绘制顺序，以及「中方县不重复画」。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(R, rel), 'utf8');
const REGION_DATA = require(path.join(R, 'utils/regionBoundaries.js')).REGION_BOUNDARIES;
const REGION_BOUNDARIES = REGION_DATA.regions;
const datum = require(path.join(R, 'utils/geoDatum.js'));
const geo = require(path.join(R, 'utils/geoLayer.js'));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (e) { failed += 1; console.error('✗ ' + name); console.error('   ' + ((e && e.message) || e)); }
}

test('数据完整性：怀化市 12 个区县，中方县标 self，其余都是邻县', () => {
  // 导出的是带元信息的包装对象：{ source, datum, minSpacingM, regions[] }
  assert.strictEqual(REGION_DATA.source, 'datav', '应记录数据来源');
  assert.strictEqual(REGION_DATA.city, '431200', '应记录市级区划码');
  assert.ok(REGION_DATA.minSpacingM > 0, '应记录抽稀间距');
  assert.ok(Array.isArray(REGION_BOUNDARIES), 'regions 必须是数组');
  assert.strictEqual(REGION_BOUNDARIES.length, 12, '怀化市应有 12 个区县');
  const self = REGION_BOUNDARIES.filter((r) => r.self === true);
  assert.strictEqual(self.length, 1, '只应有中方县标 self');
  assert.strictEqual(self[0].code, '431221');
  assert.strictEqual(self[0].name, '中方县');
  REGION_BOUNDARIES.forEach((r) => {
    assert.ok(r.rings.length >= 1, r.name + ' 缺环');
    const pts = r.rings.reduce((n, rr) => n + rr.length, 0);
    assert.ok(pts >= 4, r.name + ' 点数太少：' + pts);
    assert.ok(r.center && isFinite(r.center.longitude), r.name + ' 缺中心点');
  });
});

test('★ 坐标系：数据文件必须自己声明是 GCJ-02（否则以后没人知道要不要换算）', () => {
  const src = read('utils/regionBoundaries.js');
  assert.ok(/"datum":"gcj02"/.test(src), '应声明 datum=gcj02');
  assert.ok(/DataV/.test(src) && /geo\.datav\.aliyun\.com/.test(src), '应写明数据来源，便于追溯');
  assert.ok(/gcjToWgs/.test(src), '注释里应提醒换算方向');
});

test('★ 换算量级正确：GCJ→WGS 后应移动约 594m（方向不能反）', () => {
  const r = REGION_BOUNDARIES.filter((x) => x.self !== true)[0];
  const p = r.rings[0][0];
  const w = datum.gcjToWgs(p.longitude, p.latitude);
  const dx = (w.longitude - p.longitude) * 111412.84 * Math.cos((p.latitude * Math.PI) / 180);
  const dy = (w.latitude - p.latitude) * 111132.92;
  const dist = Math.hypot(dx, dy);
  assert.ok(dist > 500 && dist < 700, '位移应约 594m，实际 ' + dist.toFixed(0));
  // GCJ 点是「更靠东南」的，换算回 WGS 应该往西北走
  assert.ok(w.longitude < p.longitude && w.latitude > p.latitude, '方向应是向西北回退');
});

test('★ 只换算一次并缓存（每帧重算会白烧 CPU）', () => {
  const page = read('pages/rainfall/rainfall.js');
  assert.ok(/let REGION_WGS84 = null;/.test(page), '应有一个模块级缓存变量');
  const fn = page.slice(page.indexOf('const regionRingsWgs84 ='), page.indexOf('// ——— 「乡镇」取景'));
  assert.ok(/if \(!REGION_WGS84\)/.test(fn), '缓存未命中才换算');
  assert.ok(/REGION_WGS84 = REGION_BOUNDARIES/.test(fn), '应把换算结果写回缓存');
  assert.ok(/gcjToWgs/.test(fn), '换算应用 gcjToWgs');
});

test('★ 绘制顺序：周边区划先画，本县乡镇边界与名称压在其上', () => {
  const page = read('pages/rainfall/rainfall.js');
  const top = page.slice(page.indexOf('drawLayerTop(ctx) {'), page.indexOf('drawTownshipOutlines(ctx) {'));
  const iRegion = top.indexOf('this.drawRegionOutlines(ctx)');
  const iTown = top.indexOf('this.drawTownshipOutlines(ctx)');
  const iLabel = top.indexOf('this.drawTownshipLabels(ctx)');
  assert.ok(iRegion !== -1 && iTown !== -1 && iLabel !== -1, '三条调用都要在');
  assert.ok(iRegion < iTown && iTown < iLabel, '顺序必须是：周边区划 → 本县边界 → 本县乡镇名');
});

test('★ 中方县自己不会被重复画（它有自己的乡镇边界）', () => {
  const page = read('pages/rainfall/rainfall.js');
  assert.ok(/REGION_BOUNDARIES\.regions/.test(page), '页面应读包装对象的 regions 字段');
  assert.ok(/filter\(\(r\) => r\.self !== true\)/.test(page), '绘制前应过滤掉 self 的那一个');
});

test('体量：数据文件不能把包撑爆', () => {
  const bytes = fs.statSync(path.join(R, 'utils/regionBoundaries.js')).size;
  assert.ok(bytes < 250 * 1024, '周边区划数据应控制在 250KB 内，实际 ' + Math.round(bytes / 1024) + 'KB');
});

test('真视图下邻县确实会出现在画面里（不是白加数据）', () => {
  const ASPECT = 340 / Math.round(340 * 0.92);
  const view = geo.viewForCounty(ASPECT);
  const inView = REGION_BOUNDARIES.filter((r) => r.self !== true).filter((r) => {
    if (!r.center) return false;
    const w = datum.gcjToWgs(r.center.longitude, r.center.latitude);
    return w.longitude >= view.west && w.longitude <= view.east && w.latitude >= view.south && w.latitude <= view.north;
  });
  assert.ok(inView.length >= 3, '紧凑后的全县视野里至少应能看到 3 个邻县，实际 ' + inView.length + '（' + inView.map((r) => r.name).join('、') + '）');
});


test('★ 乡镇级自动隐藏邻县；全县视野仍显示', () => {
  const page = read('pages/rainfall/rainfall.js');
  const m = page.match(/const REGION_HIDE_SPAN_KM = (\d+);/);
  assert.ok(m, '应有 REGION_HIDE_SPAN_KM 常量');
  const threshold = Number(m[1]);
  assert.ok(threshold >= 30 && threshold <= 60, '阈值应落在合理区间，实际 ' + threshold);
  // 保护逻辑必须在真正绘制之前返回
  const fn = page.slice(page.indexOf('drawRegionOutlines(ctx) {'), page.indexOf('drawTownshipOutlines(ctx) {'));
  const iGuard = fn.indexOf('viewSpanKm(this.layerView) <= REGION_HIDE_SPAN_KM');
  const iDraw = fn.indexOf('ctx.strokeStyle');
  assert.ok(iGuard !== -1 && iDraw !== -1 && iGuard < iDraw, '应在绘制之前先判断是否隐藏');
  // 12 个乡镇的取景都必须低于阈值（会隐藏）
  const ASPECT = 340 / Math.round(340 * 0.92);
  const { TOWNSHIP_BOUNDARIES } = require(path.join(R, 'utils/townshipBoundaries.js'));
  TOWNSHIP_BOUNDARIES.forEach((tw) => {
    const span = geo.viewSpanKm(geo.fitView(tw.bounds, ASPECT, 1.18));
    assert.ok(span <= threshold, tw.name + ' 取景 ' + span.toFixed(1) + 'km 应低于阈值 ' + threshold + '（要隐藏邻县）');
  });
  // 全县视野必须高于阈值（要显示邻县）
  assert.ok(geo.viewSpanKm(geo.viewForCounty(ASPECT)) > threshold, '全县视野应显示邻县');
});

test('★ 地形晕渲：资源存在、与底图同范围、且用同一个 rect 绘制（不错位）', () => {
  const png = fs.readFileSync(path.join(R, 'assets/basemap/hillshade.png'));
  assert.ok(png.length > 1000 && png.length < 250 * 1024, '晕渲图体积应在合理区间，实际 ' + Math.round(png.length / 1024) + 'KB');
  // PNG 头里读宽高
  assert.strictEqual(png.readUInt32BE(16), 384, '宽度应为 384（降采样压体积）');
  assert.strictEqual(png.readUInt32BE(20), 384, '高度应为 384');
  assert.strictEqual(png[24], 8, '位深应为 8');
  assert.strictEqual(png[25], 0, '应为灰度（colorType 0）');
  const page = read('pages/rainfall/rainfall.js');
  assert.ok(/\/assets\/basemap\/hillshade\.png/.test(page), '页面应加载晕渲图');
  // 同一个 rect：底图与晕渲必须用同一组坐标绘制
  const block = page.slice(page.indexOf('this.basemapImage, rect.x'), page.indexOf('this.basemapImage, rect.x') + 420);
  assert.ok(/this\.hillshadeImage, rect\.x, rect\.y, rect\.width, rect\.height/.test(block), '晕渲必须用与底图相同的 rect，否则会错位');
  assert.ok(/globalAlpha/.test(block), '应以半透明叠加，别把底图盖住');
});

test('烘焙脚本可追溯：地形数据源与算法写在脚本里', () => {
  // ①：烘焙脚本已从 .ekko-tmp 挪到 scripts/（临时目录被清理也不该让测试变红）
  const bake = fs.readFileSync(path.join(R, 'scripts/bake-hillshade.js'), 'utf8');
  assert.strictEqual(fs.existsSync(path.join(R, '.ekko-tmp/bake-hillshade.js')), false, '不该再依赖 .ekko-tmp');
  assert.ok(/elevation-tiles-prod\/terrarium/.test(bake), '应写明地形瓦片来源');
  assert.ok(/315/.test(bake) && /45/.test(bake), '应写明光照方位（西北 315°/45°）');
});


test('★ 风场模式也要有地形起伏：晕渲画在「填色之上、粒子之下」', () => {
  const page = read('pages/rainfall/rainfall.js');
  const iFill = page.indexOf('this.drawWindFill(ctx)');
  const iShade = page.indexOf('this.overlayHillshade(ctx, 0.24)');
  const iPart = page.indexOf('this.drawWindParticles(ctx)');
  assert.ok(iFill !== -1 && iShade !== -1 && iPart !== -1, '三条调用都要在');
  assert.ok(iFill < iShade && iShade < iPart, '顺序必须是：填色 → 晕渲 → 粒子');
  // 两处风场绘制流程都要有
  assert.ok(page.split('this.overlayHillshade(ctx, 0.24)').length - 1 >= 2, 'drawLayer 与 drawWindFrame 两条路都要叠');
  // 叠加层的 alpha 必须比风速色阶的视觉权重低（0.24 < 0.32 上限），否则会压掉风速色阶
  const m = page.match(/overlayHillshade\(ctx, ([\d.]+)\)/);
  assert.ok(m && Number(m[1]) < 0.32, '叠加层 alpha 应低于 0.32，实际 ' + (m && m[1]));
  // rect 算法必须与底图一致（同一套），否则会错位
  const baseFn = page.slice(page.indexOf('drawBasemapLayer(ctx, w, h) {'), page.indexOf('drawWindFill(ctx) {'));
  const rectLine = (baseFn.match(/^\s*const rect = (.*)$/m) || [])[1];
  assert.ok(rectLine, '底图里应有 rect 计算');
  const helper = page.slice(page.indexOf('overlayHillshade(ctx, alpha) {'), page.indexOf('drawWindFill(ctx) {'));
  assert.ok(helper.indexOf(rectLine.trim().replace(/;$/, '')) !== -1, '叠加层必须用与底图相同的 rect 算法');
});

if (failed) { console.error('\n周边区划：失败 ' + failed + ' 项'); process.exitCode = 1; }
else console.log('\n周边区划：全部通过');
