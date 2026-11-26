// 风场图层新能力：逐小时时段、自适应风速填色、点位读数
//
// 背景：用户决定风向图「主要看天气全貌、重点在动效」，并按真机预览挑定了画法：
//   风速填色（色阶按当前帧自适应，但有最小跨度防止微风被画成大风）+ 粒子流线（拖尾 24 帧）
//   + 乡镇边界压在填色之上 + 逐小时时间轴（风场有未来数据，雷达回波没有）。
// 本文件锁住纯逻辑部分；界面接线（canvas 分层、时间轴 UI）另测。
const assert = require('assert');
const wind = require('../utils/layerWind.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (e) { failed += 1; console.error('✗ ' + name); console.error('   ' + ((e && e.message) || e)); }
}

const GX = wind.WIND.GRID_X, GY = wind.WIND.GRID_Y, N = GX * GY;
const BOUNDS = { west: 109.45, east: 110.75, south: 26.95, north: 28.05 };

const mkItem = (times, speeds, dirs) => ({ hourly: { time: times, wind_speed_10m: speeds, wind_direction_10m: dirs } });
const mkJson = (hours, fn) => {
  const times = [];
  for (let h = 0; h < hours; h++) times.push('2026-09-30T' + String(8 + h).padStart(2, '0') + ':00');
  const items = [];
  for (let k = 0; k < N; k++) {
    const speeds = [], dirs = [];
    for (let h = 0; h < hours; h++) { const v = fn(k, h); speeds.push(v.speed); dirs.push(v.dir); }
    items.push(mkItem(times, speeds, dirs));
  }
  return items;
};

test('逐小时 URL：按北京时区、取最细的免费模式、风速用 m/s', () => {
  const u = wind.buildHourlyUrl(wind.buildPoints(BOUNDS));
  assert.ok(u.indexOf('hourly=wind_speed_10m,wind_direction_10m') !== -1);
  assert.ok(u.indexOf('timezone=Asia%2FShanghai') !== -1, '必须按北京时间取，否则时段会错 8 小时');
  assert.ok(u.indexOf('models=icon_seamless') !== -1, '应用最细的免费模式（ICON 11km）');
  assert.ok(u.indexOf('wind_speed_unit=ms') !== -1);
  assert.ok(u.split(',').length > 100, '应一次请求整片网格');
});

test('★ 时段规划按北京时间（用 toISOString 直接比会差 8 小时）', () => {
  const times = ['2026-09-30T08:00', '2026-09-30T16:00', '2026-09-30T17:00', '2026-09-30T18:00'];
  const now = Date.UTC(2026, 8, 30, 8, 10); // UTC 08:10 = 北京 16:10
  assert.strictEqual(wind.hourIndex(times, now), 1, '北京 16:10 应定位到 16:00');
  const plan = wind.hourlyPlan(times, now, 3);
  assert.strictEqual(plan.length, 3);
  assert.strictEqual(plan[0].label, '现在');
  assert.strictEqual(plan[1].label, '+1 小时');
  assert.strictEqual(plan[0].time, '2026-09-30T16:00');
});

test('★ 逐小时解析出的每一帧，与实时帧结构完全同形（粒子代码不用写第二套）', () => {
  const json = mkJson(4, (k, h) => ({ speed: 2 + (k % 5) + h, dir: 0 }));
  const out = wind.parseHourly(json, GX, GY, BOUNDS, Date.UTC(2026, 8, 30, 0, 5));
  assert.ok(out.frames.length >= 4, '应给出未来若干时段');
  const f = out.frames[0].field;
  ['gx', 'gy', 'u', 'v', 'speed', 'direction', 'minSpeed', 'maxSpeed', 'meanU', 'meanV', 'bounds'].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(f, key), '缺字段 ' + key);
  });
  assert.strictEqual(f.u.length, N);
  assert.strictEqual(f.bounds.west, BOUNDS.west);
  // 每帧的风速应随小时变化（不然时间轴没意义）
  assert.notStrictEqual(out.frames[0].field.maxSpeed, out.frames[out.frames.length - 1].field.maxSpeed);
});

test('★ 方向语义不能反：北风（0°）应往南吹（屏幕 y 增大）', () => {
  const json = mkJson(2, () => ({ speed: 6, dir: 0 }));
  const f = wind.parseHourly(json, GX, GY, BOUNDS, Date.UTC(2026, 8, 30, 0, 5)).frames[0].field;
  const s = wind.sampleFieldAt(f, 110.1, 27.5);
  assert.ok(s.v > 0, '北风应 South（v>0），实际 v=' + s.v);
  assert.ok(Math.abs(s.u) < 1e-6, '正北风不该有东西向分量');
  const d = wind.describePoint(f, 110.1, 27.5);
  assert.strictEqual(d.label, '北风');
  assert.strictEqual(d.level, wind.beaufort(6));
});

test('★ 自适应色阶：按本帧范围分档，但最小跨度 4m/s（防止微风看起来像大风）', () => {
  const calm = wind.scaleForField({ minSpeed: 0.1, maxSpeed: 0.3 });
  assert.ok(Math.abs((calm.hi - calm.lo) - wind.WIND.MIN_SPEED_SPAN) < 1e-9, '微风时色阶应被撑到最小跨度 4');
  const windy = wind.scaleForField({ minSpeed: 2, maxSpeed: 12 });
  assert.ok(Math.abs((windy.hi - windy.lo) - 10) < 1e-9, '风大时应按真实范围 10');
  assert.strictEqual(windy.steps.length, wind.WIND.FILL_RAMP.length);
  assert.strictEqual(wind.speedLegend(windy).length, windy.steps.length);
  // 图例数值必须来自色阶本身（不是模板里写死的）
  const lg = wind.speedLegend(windy);
  assert.ok(Math.abs(lg[0].hi - windy.hi) < 1e-9, '图例顶端应是本帧真实上限');
});

test('填色取色：越界自动收敛，且深色档比浅色档更不透明', () => {
  const sc = wind.scaleForField({ minSpeed: 0, maxSpeed: 8 });
  const low = wind.fillColorAt(0, sc).match(/[\d.]+/g).map(Number)[3];
  const high = wind.fillColorAt(8, sc).match(/[\d.]+/g).map(Number)[3];
  assert.ok(high > low, '大风档应更实，浅色=' + low + ' 深色=' + high);
  assert.ok(wind.fillColorAt(-99, sc) !== null && wind.fillColorAt(999, sc) !== null, '越界也要给出颜色，不能崩');
  assert.strictEqual(wind.fillColorAt(3, null), null);
});

test('点位读数：给出蒲福级 + 风向 + 数值，静风时不编造方向', () => {
  const json = mkJson(2, (k, h) => ({ speed: 5.6, dir: 45 }));
  const f = wind.parseHourly(json, GX, GY, BOUNDS, Date.UTC(2026, 8, 30, 0, 5)).frames[0].field;
  const d = wind.describePoint(f, 110.1, 27.5);
  assert.ok(/级/.test(d.text) && /风/.test(d.text), '读数应含级与风向，实际 ' + d.text);
  assert.strictEqual(d.label, '东北风');
  assert.ok(d.speed > 5 && d.speed < 6.2, '东北风 5.6m/s 的量值应保住，实际 ' + d.speed);
  const calm = wind.describePoint({ bounds: BOUNDS, gx: 2, gy: 2, u: new Float32Array([0, 0, 0, 0]), v: new Float32Array([0, 0, 0, 0]) }, 110.1, 27.5);
  assert.strictEqual(calm.text, '静风', '静风不能说成某方向的风');
});

test('参数：拖尾够长（7 帧像散点）、粒子密度按预览效果', () => {
  assert.ok(wind.WIND.TRAIL_LEN >= 20, '拖尾至少 20 帧才成为流线，实际 ' + wind.WIND.TRAIL_LEN);
  const n = wind.particleCountFor(340, 313); // 天气页那张卡片的尺寸
  assert.ok(n >= 100 && n <= 400, '卡片尺寸下粒子数应适中，实际 ' + n);
  const big = wind.particleCountFor(1200, 900);
  assert.ok(big <= wind.WIND.PARTICLE_MAX, '大画布也要封顶');
});

test('诚实标注：明确是模式预报、非实测', () => {
  assert.ok(/非实测/.test(wind.WIND.SOURCE_NOTE), '必须说明不是实测');
  assert.ok(/11/.test(wind.WIND.SOURCE_NOTE), '必须写明分辨率量级');
});

test('极端输入不产生 NaN（缺时次/非法数值）', () => {
  const json = mkJson(3, (k, h) => ({ speed: h === 1 ? NaN : 3, dir: 180 }));
  const out = wind.parseHourly(json, GX, GY, BOUNDS, Date.UTC(2026, 8, 30, 0, 5));
  out.frames.forEach((fr) => {
    const s = wind.sampleFieldAt(fr.field, 110.1, 27.5);
    assert.ok(!isNaN(s.u) && !isNaN(s.v), '缺时次不得产生 NaN');
  });
  assert.throws(() => wind.parseHourly([{ hourly: { time: [] } }], GX, GY, BOUNDS), /没有逐小时时段|网格数量不符/);
});


/* ---------------- 界面接线：绘制层次 ---------------- */

const pageSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.js'), 'utf8');

test('★ 层次：底图 → 风速填色 → 粒子 → 乡镇边界/名称（预览里就是填色把乡镇盖住了）', () => {
  const iFill = pageSrc.indexOf('this.drawWindFill(ctx)');
  const iParticles = pageSrc.indexOf('this.drawWindParticles(ctx)');
  const iTop = pageSrc.lastIndexOf('this.drawLayerTop(ctx)');
  assert.ok(iFill !== -1 && iParticles !== -1 && iTop !== -1, '三条绘制调用都必须存在');
  assert.ok(iFill < iParticles, '填色必须在粒子之前（否则粒子被盖住）');
  assert.ok(iParticles < iTop, '乡镇边界/名称必须在粒子之后（否则被填色盖住）');
  // 乡镇名不能再留在底图层里画
  const base = pageSrc.slice(pageSrc.indexOf('drawBasemapLayer(ctx, w, h) {'), pageSrc.indexOf('drawWindFill(ctx) {'));
  assert.strictEqual(/drawTownshipLabels\(ctx\)/.test(base), false, '乡镇名不该再画在底图层（会被填色盖住）');
});

test('★ 填色按经纬度采样，而不是按画布归一化坐标（否则缩放后跟着变形）', () => {
  const fill = pageSrc.slice(pageSrc.indexOf('drawWindFill(ctx) {'), pageSrc.indexOf('drawLayerTop(ctx) {'));
  assert.ok(/proj\.toLngLat\(/.test(fill), '必须把画布像素反算成经纬度再采样');
  assert.ok(/layerWind\.fillColorAt\(/.test(fill), '取色必须走统一的色阶函数');
  assert.ok(/this\.windScale/.test(fill), '色阶必须来自按本帧算出的 windScale');
});

test('★ 色阶必须在载入风场时算好，并把真实数值写进提示（不能模板里写死）', () => {
  assert.ok(/this\.windScale = layerWind\.scaleForField\(/.test(pageSrc), '载入时就要算色阶');
  assert.ok(/this\.windScale = layerWind\.scaleForField\(this\.windField\)/.test(pageSrc), '切帧时也要按新帧重算色阶');
  assert.ok(/风速色阶 ' \+ scale\.lo\.toFixed\(1\)/.test(pageSrc), '提示里应给真实色阶数值');
});


test('★ 卡片取数已改成「未来逐小时」（不再是实况单帧）', () => {
  assert.ok(/layerWind\.buildHourlyUrl\(/.test(pageSrc), '应使用逐小时接口');
  assert.ok(/layerWind\.parseHourly\(/.test(pageSrc), '应解析成多帧');
  assert.strictEqual(/layerWind\.buildUrl\(/.test(pageSrc), false, '不应再用实况单帧接口');
  assert.strictEqual(/layerWind\.parseField\(/.test(pageSrc), false, '不应再用单帧解析');
  assert.ok(/this\.windFrames = parsed\.frames/.test(pageSrc), '应把帧列表存下来');
});

test('★ 时间轴控件按模式分流：风场切小时帧，雷达切雷达帧', () => {
  const fn = pageSrc.slice(pageSrc.indexOf('nextRadarFrame() {'), pageSrc.indexOf('scrubRadarFrame(index) {'));
  assert.ok(/isWindMode\(\) && \(this\.windFrames \|\| \[\]\)\.length/.test(fn), '应先判断风场模式');
  assert.ok(fn.indexOf('this.setWindFrame(') < fn.indexOf('const { radarFrames, radarFrameIndex } = this.data;'), '风场分支必须在雷达逻辑之前');
});

test('★ 切帧只换风场、不重建粒子（动画要连续）', () => {
  const fn = pageSrc.slice(pageSrc.indexOf('setWindFrame(index) {'), pageSrc.indexOf('startWindLoop() {'));
  assert.ok(/this\.windField = frames\[i2\]\.field/.test(fn), '应换当前帧的场');
  assert.strictEqual(/this\.particles\s*=/.test(fn), false, '不得重建粒子（否则动画会跳）');
  assert.ok(/this\.windScale = layerWind\.scaleForField/.test(fn), '色阶要跟着帧重算（自适应）');
});

test('★ 界面要能看出这是「未来几小时」', () => {
  assert.ok(/publishWindFrame\(\)/.test(pageSrc), '应有发布帧信息的函数');
  assert.ok(/未来 ' \+ \(this\.windFrames\.length - 1\) \+ ' 小时可播放/.test(pageSrc), '应说明可播放时长');
  assert.ok(/slice\(11, 16\)/.test(pageSrc), '应显示具体时刻（HH:mm）');
});

test('★ 进度条只在雷达模式显示（免得显示雷达时刻却切着小时帧）', () => {
  const wxml = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.wxml'), 'utf8');
  const i = wxml.indexOf('bindchange="onRadarSlideChange"');
  assert.ok(i !== -1, '找不到时间轴进度条');
  const controls = wxml.slice(wxml.indexOf('visual-controls'), i);
  assert.ok(/wx:if="\{\{layerMode === 'radar'\}\}"/.test(controls), '进度条应只在雷达模式显示');
  assert.strictEqual(wxml.includes('scroll-into-view'), false, '旧滚动胶囊条应已移除（换成进度条）');
});


test('★ 取数函数里不得残留旧的 field 变量（改名后漏改会直接抛错＝界面显示暂不可用）', () => {
  const fn = pageSrc.slice(pageSrc.indexOf('async loadWindField('), pageSrc.indexOf('// 风场帧 → 界面文案'));
  assert.ok(fn.length > 200, '应能取到 loadWindField 全文');
  const bare = fn.split('\n').filter((l) => /(^|[^.\w])field([^\w]|$)/.test(l.replace(/this\.windField/g, '').replace(/windField/g, '')));
  assert.strictEqual(bare.length, 0, '仍有裸引用 field：' + bare.map((l) => l.trim()).join(' | '));
  assert.ok(/layerWind\.meanVector\(this\.windField\)/.test(fn), 'mean 必须基于 this.windField 计算');
  assert.strictEqual(/layerTimeText: '实况'/.test(fn), false, '不该再把时间轴写死成「实况」（那是逐小时之前的行为）');
});


test('★ 顶部实况与气象图层共用同一个「当前乡镇」（双向联动）', () => {
  const page = pageSrc;
  // 正向：图层选乡镇 → 顶部实况跟过去
  const scopeFn = page.slice(page.indexOf('onLayerScope(e) {'), page.indexOf('onLayerReset') === -1 ? page.indexOf('onLayerScope(e) {') + 1600 : page.indexOf('onLayerReset'));
  assert.ok(/this\.syncWeatherLocation\(index, name\)/.test(scopeFn), '图层选乡镇后应同步顶部实况');
  // 反向：顶部选乡镇 → 图层取景过去（复用 onLayerScope，不写第二套）
  const townFn = page.slice(page.indexOf('onTownshipChange(e) {'), page.indexOf('onTownshipChange(e) {') + 900);
  assert.ok(/this\.onLayerScope\(\{ detail: \{ value: index \} \}\)/.test(townFn), '顶部选乡镇后应让图层取景过去');
  // ★ 联动不能把原有逻辑吃掉（上一版补丁把这两处 setData 整行删了，靠测试才发现）
  assert.ok(/this\.setData\(\{ location: newLocation, townshipIndex: index \}\);/.test(townFn), '顶部原有的 setData 必须保留');
  assert.ok(/this\.setData\(\{ layerScopeIndex: index, layerScope: name \}\);/.test(page), '图层原有的 setData 必须保留');
  // 去重：同一个乡镇不重复请求（联动闭环不来回打）
  const helper = page.slice(page.indexOf('syncWeatherLocation(index, name) {'), page.indexOf('updateSpanText() {'));
  assert.ok(/this\.data\.location\.city === loc\.city && this\.data\.townshipIndex === index/.test(helper),
    '同一乡镇应直接返回，不重复请求');
  // 「全县」＝与其他页面同一个县城中心（走统一的 resolveTownshipLocation，不再各算各的）
  assert.ok(/resolveTownshipLocation\(index > 0 \? name : '中方县（全县）'\)/.test(helper), '全县/乡镇都应走统一的定位解析');
  assert.strictEqual(/geoLayer\.COUNTY_CENTER/.test(helper), false, '不应再绕过统一解析自算县城中心');
  // ★ 全局统一（2026-11-25 用户要求）：图层联动选中的乡镇要写回全局定位，首页/地图跟着走
  assert.ok(/app\.setLocation\(loc\)/.test(helper), '联动选乡镇必须写回全局定位');
  // 重定位回到全县时，顶部也要跟着回县城
  const recenter = page.slice(page.indexOf('onLayerRecenter() {'), page.indexOf('onLayerRecenter() {') + 700);
  assert.ok(/syncWeatherLocation\(0,/.test(recenter), '重定位回全县时顶部也要回县城');
  // ★ 全局统一（2026-11-25）：三个页面都要在 onShow 回读全局定位
  assert.ok(/getTownshipIndex\(location\)/.test(page), '天气页应回读全局定位');
  const indexSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/index/index.js'), 'utf8');
  const indexOnShow = indexSrc.slice(indexSrc.indexOf('onShow() {'), indexSrc.indexOf('onPullDownRefresh'));
  assert.ok(/getTownshipIndex\(location\)/.test(indexOnShow), '首页应在 onShow 回读全局定位');
  assert.ok(/this\.loadWeather\(\)/.test(indexOnShow), '首页定位变化后应刷新天气');
  assert.ok(/app\.setLocation/.test(indexSrc), '首页选乡镇应写回全局定位');
});


test('★ 短临列表不做高亮；图层卡不再有自己的选择器', () => {
  const wxml = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.wxml'), 'utf8');
  const wxss = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.wxss'), 'utf8');
  // 2026-09-30 用户明确「短临不需要高亮」——锁成"不得有"，免得以后又被好心加回来
  assert.strictEqual(/township-item-active/.test(wxml), false, '短临列表项不该有选中态绑定');
  assert.strictEqual(/\.township-item-active\{/.test(wxss), false, '不该留选中态样式（否则会撞死样式门禁）');
  // 图层卡的选择权已合并到顶部，但仍要显示当前范围
  assert.strictEqual(/bindchange="onLayerScope"/.test(wxml), false, '图层卡不该再有自己的选择器');
  assert.ok(/\{\{layerScope\}\}/.test(wxml), '但应保留只读的范围标签');
});

if (failed) { console.error('\n风场新能力：失败 ' + failed + ' 项'); process.exitCode = 1; }
else console.log('\n风场新能力：全部通过');
