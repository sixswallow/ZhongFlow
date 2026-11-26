// 气象图层的「乡镇级取景」与分辨率如实标注
//
// 起因：用户反馈「雷达/风场图的视野太大（约 200km），对中方县来说太大，无法观测每个乡镇的大致情况」。
// 实测（2026-09-28）：
//   · RainViewer 免费档只有 z≤7 有数据 —— 在有强回波的雨区实测 z8~z13 全是同一张 1370 字节空瓦片，
//     所以最细就是 1.079 km/像素（≈1.08），再放大只是插值。
//   · 县域 73×53km；12 个乡镇东西向 8.4~22.9km。
//   · 1km 的格子在 375px 屏上：200km 视野时只有 1.9px（看不出落区），20km 视野时约 19px。
// 本文件锁住：取景确实收到乡镇级、格子的像素数如实标注、放大到 3 倍以上改用不插值渲染。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(R, rel), 'utf8');
const geo = require(path.join(R, 'utils/geoLayer.js'));
const radar = require(path.join(R, 'utils/layerRadar.js'));
const { TOWNSHIP_BOUNDARIES } = require(path.join(R, 'utils/townshipBoundaries.js'));

// 典型卡片画布：340 CSS px 宽、0.92 比例、dpr 2
const W = 340;
const H = Math.round(W * 0.92);
const ASPECT = W / H;
const DEVICE_PX = W * 2;

const findTownship = (name) => TOWNSHIP_BOUNDARIES.filter((t) => t.name === name)[0];

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

/* ---------------- 一、乡镇级取景 ---------------- */

test('12 个乡镇逐个取景：视野都落在乡镇级（≤32km）而不是县域级', () => {
  // 界面「全县」取景已按县域包围盒收紧（2026-09-30 用户要求），这里改用界面真正用的那个
  const countySpan = geo.viewSpanKm(geo.viewForCounty(ASPECT));
  assert.ok(countySpan > 66 && countySpan < 90, '全县取景应刚好框住县域（约 73~76km），实际 ' + countySpan.toFixed(0));
  assert.ok(countySpan < geo.viewSpanKm(geo.viewFor(ASPECT)) * 0.8, '应明显小于 200km 的兜底跨度');
  TOWNSHIP_BOUNDARIES.forEach((t) => {
    const view = geo.fitView(t.bounds, ASPECT, 1.18);
    const span = geo.viewSpanKm(view);
    assert.ok(span <= 32, t.name + ' 取景视野应 ≤32km，实际 ' + span.toFixed(1));
    assert.ok(span >= 8, t.name + ' 取景视野不该小于乡镇本身，实际 ' + span.toFixed(1));
    const c = { latitude: t.center.latitude, longitude: t.center.longitude };
    assert.ok(c.longitude >= view.west && c.longitude <= view.east, t.name + ' 乡镇中心应在视野内（经度）');
    assert.ok(c.latitude >= view.south && c.latitude <= view.north, t.name + ' 乡镇中心应在视野内（纬度）');
  });
});

test('★ 乡镇取景下，1km 的格子至少有 12 像素（这才是「看得出落区」）', () => {
  let worst = Infinity;
  let worstName = '';
  TOWNSHIP_BOUNDARIES.forEach((t) => {
    const span = geo.viewSpanKm(geo.fitView(t.bounds, ASPECT, 1.18));
    const boxPx = (DEVICE_PX / span) * radar.RADAR.SOURCE_KM_PER_PX;
    if (boxPx < worst) { worst = boxPx; worstName = t.name; }
  });
  assert.ok(worst >= 12, '最差的一档（' + worstName + '）1km 格子只有 ' + worst.toFixed(1) + ' px');
  // 反向对照：县域视野下必然看不出落区（这正是用户反馈的问题）
  // 全县视野收紧到 100km 后，1km 格子从约 3px 变成约 7px —— 仍是「个位数像素」，
  // 所以要看落区还是得选乡镇（这句断言随取景收紧同步更新，不是放宽）
  const countyPx = (DEVICE_PX / geo.viewSpanKm(geo.viewForCounty(ASPECT))) * radar.RADAR.SOURCE_KM_PER_PX;
  assert.ok(countyPx < 12, '全县视野下 1km 格子应仍是十来个像素，实际 ' + countyPx.toFixed(1));
  assert.ok(countyPx > 4, '收紧后不该还是 3px 量级（否则说明收紧没生效），实际 ' + countyPx.toFixed(1));
});

test('乡镇取景也必须被夹在烘焙底图范围内（否则会露白边）', () => {
  TOWNSHIP_BOUNDARIES.forEach((t) => {
    const raw = geo.fitView(t.bounds, ASPECT, 1.18);
    const clamped = geo.clampView(raw, geo.BAKE_BOUNDS);
    assert.ok(clamped.west >= geo.BAKE_BOUNDS.west - 1e-9, t.name + ' 取景越出左边界');
    assert.ok(clamped.east <= geo.BAKE_BOUNDS.east + 1e-9, t.name + ' 取景越出右边界');
    assert.ok(clamped.south >= geo.BAKE_BOUNDS.south - 1e-9, t.name + ' 取景越出下边界');
    assert.ok(clamped.north <= geo.BAKE_BOUNDS.north + 1e-9, t.name + ' 取景越出上边界');
  });
});

/* ---------------- 二、不插值渲染 ---------------- */

test('放大 ≥3 倍改用不插值（0_1），否则用平滑（1_1）', () => {
  assert.strictEqual(radar.RADAR.SMOOTH_OPTIONS, '1_1');
  assert.strictEqual(radar.RADAR.SHARP_OPTIONS, '0_1');
  assert.strictEqual(radar.optionsForUpscale(8), '0_1');
  assert.strictEqual(radar.optionsForUpscale(3), '0_1');
  assert.strictEqual(radar.optionsForUpscale(2.9), '1_1');
  assert.strictEqual(radar.optionsForUpscale(1), '1_1');
  assert.strictEqual(radar.optionsForUpscale(undefined), '1_1', '缺参数时必须退回原行为');
});

test('tileUrl 的默认行为没变（不传 options 仍是 1_1）', () => {
  const frame = { timeStamp: 1790538000, path: '/v2/radar/1790538000' };
  assert.ok(radar.tileUrl('https://tilecache.rainviewer.com', frame, 7, 103, 53).endsWith('/4/1_1.png'));
  assert.ok(radar.tileUrl('https://tilecache.rainviewer.com', frame, 7, 103, 53, '0_1').endsWith('/4/0_1.png'));
});

test('瓦片规划把 options 透传下去（canvas 与地图两条路都要）', () => {
  const frame = { timeStamp: 1790538000, path: '/v2/radar/1790538000', time: '03:40', timeCst: '03:40' };
  const view = geo.fitView(findTownship('中方镇').bounds, ASPECT, 1.18);
  const canvasPlan = radar.planFrameTiles('https://tilecache.rainviewer.com', frame, view, { width: W, height: H }, DEVICE_PX, '0_1');
  assert.ok(canvasPlan.tiles.length > 0);
  canvasPlan.tiles.forEach((t) => assert.ok(t.url.endsWith('/4/0_1.png'), 'canvas 路径未透传：' + t.url));
  const mapPlan = radar.planMapOverlays('https://tilecache.rainviewer.com', frame, geo.COUNTY_BOUNDS, '0_1');
  mapPlan.tiles.forEach((t) => assert.ok(t.url.endsWith('/4/0_1.png'), '地图路径未透传：' + t.url));
});

/* ---------------- 三、分辨率如实标注 ---------------- */

test('★ 分辨率文案不许比数据源更细（单一出处 SOURCE_KM_PER_PX）', () => {
  assert.ok(radar.RADAR.SOURCE_KM_PER_PX >= 1, '数据源实测 1.079km/像素，不许声称小于 1km');
  const text = radar.radarGridText(20, DEVICE_PX);
  assert.ok(text.indexOf('约 1 km') !== -1, '应写明「约 1 km」，实际：' + text);
  assert.strictEqual(text.indexOf('px'), -1, '不该再报像素数（2026-11-25 用户反馈：技术细节看不懂）');
  assert.strictEqual(/0\.[0-9]\s*km|500\s*m|250\s*m/.test(text), false, '不得声称亚公里级分辨率');
});

test('只有放大到极端才提「更细是插值」（乡镇级说了是噪音）', () => {
  const extreme = radar.radarGridText(3, DEVICE_PX);
  assert.ok(extreme.indexOf('插值') !== -1, '视野 3km 时必须说明更细是插值，实际：' + extreme);
  // 乡镇级（1 格 15~40px）：像素数本身已经说明问题，不该再挂一句
  TOWNSHIP_BOUNDARIES.forEach((t2) => {
    const span = geo.viewSpanKm(geo.fitView(t2.bounds, ASPECT, 1.18));
    const text = radar.radarGridText(span, DEVICE_PX);
    assert.strictEqual(text.indexOf('插值'), -1, t2.name + ' 的乡镇级文案不该带插值提示：' + text);
  });
  // 全县视野同理
  assert.strictEqual(radar.radarGridText(geo.viewSpanKm(geo.viewFor(ASPECT)), DEVICE_PX).indexOf('插值'), -1);
});

test('极端的视野跨度不得产生 NaN/Infinity', () => {
  assert.strictEqual(radar.radarGridText(0, DEVICE_PX).indexOf('NaN'), -1);
  assert.strictEqual(radar.radarGridText(0, DEVICE_PX).indexOf('Infinity'), -1);
  assert.ok(radar.radarGridText(-5, DEVICE_PX).length > 0);
});

/* ---------------- 四、页面接线 ---------------- */

const js = read('pages/rainfall/rainfall.js');
const wxml = read('pages/rainfall/rainfall.wxml');
const wxss = read('pages/rainfall/rainfall.wxss');
const scopeFn = js.slice(js.indexOf('onLayerScope(e)'), js.indexOf('currentUpscale()'));
// ★ 必须从「函数定义」切，不能从调用点切（调用点在定义之前，上一版就切错了）
const labelStart = js.indexOf('drawTownshipLabels(ctx) {');
const labelFn = js.slice(labelStart, labelStart + 1200);

test('页面提供乡镇选择器，且用真实边界取景', () => {
  // 2026-09-30 用户要求：乡镇选择合并到顶部实况，图层卡不再有自己的选择器，但保留只读范围标签
  assert.strictEqual(/bindchange="onLayerScope"/.test(wxml), false, '图层卡不该再有自己的乡镇选择器');
  assert.ok(/<view class="layer-scope">\{\{layerScope\}\}<\/view>/.test(wxml), '应保留只读的范围标签');
  assert.ok(/\{\{layerScope\}\}/.test(wxml), '必须显示当前取景范围');
  assert.ok(scopeFn.indexOf('TOWNSHIP_BOUNDARIES') !== -1, '取景应来自真实乡镇边界');
  assert.ok(/geoLayer\.fitView\(t\.bounds,\s*aspect,\s*[\d.]+\)/.test(scopeFn), '必须按「该乡镇的包围盒」取景（不能拿全县范围充数）');
  assert.ok(scopeFn.indexOf('geoLayer.clampView(') !== -1, '取景必须夹在底图范围内');
});

test('★ 乡镇选择要同步顶部实况的乡镇（2026-09-30 用户要求：两处共用一个乡镇）', () => {
  // 旧断言是"图层不得碰 townshipIndex"（防误耦合）；现在共用一个乡镇正是需求本身，
  // 所以改成：必须写自己的 layerScopeIndex，并通过统一的 syncWeatherLocation 去同步顶部实况
  // （而不是在别处零散地 setData，那样会绕过去重、触发重复请求）。
  assert.ok(/this\.setData\(\{ layerScopeIndex: index, layerScope: name \}\);/.test(scopeFn), '应写自己的 layerScopeIndex 与 layerScope');
  assert.ok(/this\.syncWeatherLocation\(index, name\)/.test(scopeFn), '应调用统一的同步函数');
  assert.strictEqual(/townshipIndex\s*:/.test(scopeFn), false, '图层里不得直接写 townshipIndex（交给 syncWeatherLocation 统一处理）');
});

test('乡镇名标注：只在乡镇级视野画，且与县名互斥（阈值必须一致）', () => {
  assert.ok(labelFn.indexOf('TOWNSHIP_BOUNDARIES.forEach') !== -1, '应遍历真实乡镇');
  // 注意：守卫里也有 t.center，必须锁住真正用于投影的那一处
  assert.ok(/proj\.toPx\(t\.center\.longitude,\s*t\.center\.latitude\)/.test(labelFn), '必须按数据里的真实中心点投影');
  const labelThreshold = (labelFn.match(/viewSpanKm\(this\.layerView\)\s*>\s*(\d+)/) || [])[1];
  assert.ok(labelThreshold, 'drawTownshipLabels 缺少视野阈值');
  // 同样必须从「函数定义」切（两个函数的调用点相邻，从调用点切会得到空片段）
  const placeFn = js.slice(js.indexOf('drawPlaceLabel(ctx) {'), labelStart);
  const placeThreshold = (placeFn.match(/viewSpanKm\(this\.layerView\)\s*<=\s*(\d+)/) || [])[1];
  assert.ok(placeThreshold, '县名标注缺少互斥阈值');
  assert.strictEqual(placeThreshold, labelThreshold, '两个阈值必须相同，否则会出现「既没县名也没乡镇名」或两个名字叠在一起');
});

test('网格像素文案由 updateLayerHint 统一刷新（不会残留旧值）', () => {
  const hintFn = js.slice(js.indexOf('updateLayerHint() {'), js.indexOf('// ---------------- 绘制'));
  assert.ok(hintFn.indexOf('this.updateLayerGridText()') !== -1, '视野一变就要刷新分辨率文案');
  assert.ok(js.indexOf('layerGridText') !== -1 && wxml.indexOf('{{layerGridText}}') !== -1, '文案要真的渲染出来');
});

test('取瓦片的两条路都走同一个插值策略（不允许各写各的）', () => {
  const calls = js.split('layerRadar.planFrameTiles(').length - 1;
  assert.ok(calls >= 2, '应有两处规划瓦片（预取 + 绘制）');
  const withOptions = js.split('this.radarTileOptions()').length - 1;
  assert.ok(withOptions >= calls, '每一处规划都要带插值策略，实际 ' + withOptions + ' < ' + calls);
});

test('摸不到的放大倍数不得把不插值策略漏掉（阈值只有一处定义）', () => {
  const src = read('utils/layerRadar.js');
  assert.strictEqual(src.split('SHARP_UPSCALE').length - 1 >= 2, true, '阈值应由常量统一给出');
  assert.strictEqual(/upscale\s*>=\s*3\b/.test(src), false, '不得在函数里再写死一个 3');
  assert.ok(src.indexOf('INTERP_NOTE_PX') !== -1, '插值提示阈值也要是常量，不许和放大阈值混用');
});

test('新增样式不含真机不支持的 flex gap 与不可靠伪类', () => {
  assert.ok(wxss.indexOf('.layer-scope{') !== -1, '缺少选择器样式');
  const block = wxss.slice(wxss.indexOf('.layer-scope{'), wxss.indexOf('.layer-scope{') + 400);
  assert.strictEqual(/(^|[^-\w])gap\s*:/.test(block), false, '不得使用 flex gap');
  assert.strictEqual(/:(hover|focus|nth-child|empty)\b/.test(block), false, '不得依赖真机不可靠伪类');
  assert.strictEqual(/:active/.test(block), false, '范围标签是只读文本，不该加 :active');
  assert.strictEqual(/\.layer-scope:[a-z-]+/.test(wxss), false, '只读标签不许加伪类');
});


test('★ 界面「全县」取景：刚好框住县域全域（不是 100km 方形盒，也不是 200km 兜底）', () => {
  const page = read('pages/rainfall/rainfall.js');
  assert.ok(/geoLayer\.viewForCounty\(/.test(page), '应改用 viewForCounty');
  assert.strictEqual(/geoLayer\.viewFor\(/.test(page), false, '界面不该再用兜底跨度');
  // 县域必须完整包在视野里（收紧不等于切边）
  const v = geo.viewForCounty(ASPECT);
  assert.ok(v.west <= geo.COUNTY_BOUNDS.west && v.east >= geo.COUNTY_BOUNDS.east, '经度方向要包住县域');
  assert.ok(v.south <= geo.COUNTY_BOUNDS.south && v.north >= geo.COUNTY_BOUNDS.north, '纬度方向要包住县域');
});


test('★ 「刚好框住」：县域全域在框内，且四周都留了一点点（不贴边也不浪费）', () => {
  const [W2, H2] = [340, Math.round(340 * 0.92)];
  const aspect2 = W2 / H2;
  const v2 = geo.viewForCounty(aspect2);
  const size = geo.boundsSizeKm(geo.COUNTY_BOUNDS);
  // ① 全域必须在框内
  assert.ok(v2.west <= geo.COUNTY_BOUNDS.west && v2.east >= geo.COUNTY_BOUNDS.east, '经度必须完整包住');
  assert.ok(v2.south <= geo.COUNTY_BOUNDS.south && v2.north >= geo.COUNTY_BOUNDS.north, '纬度必须完整包住');
  // ② 宽的那一边不能浪费太多（留白应远小于县域宽度本身）
  const span = geo.viewSpanKm(v2);
  assert.ok(span - size.width < size.width * 0.35, '横向不该多出太多空视野，实际多出 ' + (span - size.width).toFixed(1) + 'km');
  // ③ 也不能贴到边（外圈边界线要看得见）
  const marginW = ((span - size.width) / 2);
  assert.ok(marginW > 0.5, '横向至少要留一点边距，实际 ' + marginW.toFixed(2) + 'km');
  // ④ 换一个更扁的展示框也要成立（全屏时比例会变）
  const wide = geo.viewForCounty(1.9);
  assert.ok(geo.viewSpanKm(wide) >= size.width, '更扁的框也要装得下县域');
  assert.ok(wide.west <= geo.COUNTY_BOUNDS.west && wide.north >= geo.COUNTY_BOUNDS.north, '更扁的框同样要包住');
});

if (failed) {
  console.error('\n乡镇级取景与分辨率标注：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n乡镇级取景与分辨率标注：全部通过');
}
