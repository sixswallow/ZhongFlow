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

const root = path.resolve(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.wxss'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.js'), 'utf8');

test('画布使用 type="2d" 且 id 与查询选择器一致（不一致会静默取到 null，整块空白）', () => {
  assert.match(wxml, /<canvas type="2d" id="layerCanvas"/, '图层画布必须是 type="2d" 且 id 为 layerCanvas');
  assert.match(js, /select\('#layerCanvas'\)/, '节点查询必须与画布 id 一致');
  assert.match(js, /node\.getContext\('2d'\)/, '必须取 2d 上下文');
  assert.match(js, /wx\.nextTick/, '取节点必须等 wx:if 渲染完成后进行');
});

test('图层切换：两个页签均绑定真实处理函数', () => {
  ['radar', 'wind'].forEach((mode) => {
    assert.ok(wxml.includes(`data-mode="${mode}"`), `缺少 ${mode} 图层页签`);
  });
  assert.match(wxml, /bindtap="onLayerMode"/, '图层页签必须绑定 onLayerMode');
  assert.match(js, /onLayerMode\(e\)\s*\{/, '缺少 onLayerMode 实现');
  assert.match(wxml, /雷达回波/, '缺少雷达回波文案');
  assert.match(wxml, /风向风速/, '缺少风向风速文案');
});

test('雷达时间轴进度条与播放：绑定与实现齐备，且播放可停止', () => {
  assert.match(wxml, /bindchange="onRadarSlideChange"/, '时间轴进度条必须可拖动选帧');
  assert.match(wxml, /bindchanging="onRadarSlideChanging"/, '拖动过程需要实时预览帧');
  assert.match(wxml, /max="\{\{radarFrames\.length - 1\}\}"/, '进度条范围必须来自真实帧列表');
  assert.match(wxml, /bindtap="toggleLayerPlay"/, '必须有播放/暂停按钮');
  assert.match(js, /toggleLayerPlay\(\)\s*\{/, '缺少 toggleLayerPlay 实现');
  assert.match(js, /stopLayerPlay\(\)\s*\{/, '必须有停止播放的实现（离开页面/切换图层都要停）');
  assert.match(js, /clearInterval\(this\.layerTimer\)/, '停止播放必须清理定时器');
  // 播放到最后一帧自动停在最新回波；停在某帧再按播放则从头播
  assert.match(js, /nextRadarFrame\(\)\s*\{[\s\S]*?radarFrameIndex >= radarFrames\.length - 1[\s\S]*?stopLayerPlay\(\)/,
    '播放到最后一帧必须自动暂停');
  assert.match(js, /toggleLayerPlay\(\)\s*\{[\s\S]*?radarFrameIndex >= radarFrames\.length - 1[\s\S]*?radarFrameIndex: 0/,
    '停在末帧再按播放必须回到第一帧');
});

test('进度条必须跟随当前帧（播放时滑块前移，当前时刻单独标出）', () => {
  assert.match(wxml, /value="\{\{radarFrameIndex\}\}"/, '滑块值应绑定当前帧序号');
  assert.match(wxml, /\{\{layerTimeText\}\}/, '当前时刻需要单独显示（滑块上没有文字）');
  ['radarFrameIndex: last', 'radarFrameIndex: next', 'radarFrameIndex: i']
    .forEach((snippet) => assert.ok(js.includes(snippet), '帧切换必须更新滑块位置：' + snippet));
});

test('无回波必须如实告知，不能静默留白', () => {
  assert.ok(js.includes('当前时刻该区域无雷达回波'), '无回波时必须给出明确说明');
  assert.match(js, /!this\.radarDrawn/, '无回波提示必须由「已加载瓦片但画不出回波」判定');
  assert.match(js, /this\.radarPending/, '仍在校验「是否还有瓦片未到位」，避免误报无回波');
  assert.ok(js.includes('正在加载雷达瓦片'), '加载中与无回波必须是两种不同提示');
});

test('数据来源署名在界面上可见（RainViewer / Open-Meteo 都要求署名）', () => {
  assert.ok(wxml.includes('RainViewer'), '界面必须标明雷达数据来源');
  assert.ok(wxml.includes('Open-Meteo'), '界面必须标明风场数据来源');
});

test('图例色块与真实瓦片调色板一致，且条目数与档位数相等', () => {
  const hex = { 'lv-1': '#8ccf6f', 'lv-2': '#f7d549', 'lv-3': '#f2873c', 'lv-4': '#d93b3b' };
  Object.keys(hex).forEach((cls) => {
    assert.ok(wxss.includes(`.legend-dot.${cls}{background:${hex[cls]}}`), `${cls} 色块必须使用采集自真实瓦片的色值 ${hex[cls]}`);
  });
  Object.keys(hex).forEach((cls) => {
    assert.ok(wxml.includes(`legend-dot ${cls}`), `图例缺少 ${cls} 条目`);
  });
  assert.match(wxss, /\.legend-dot\.wind\{background:linear-gradient/, '风场图例应有独立色块');
});

test('距离环与县名标注：给「多远、哪里」提供参照', () => {
  assert.match(js, /\[25, 50, 100\]\.forEach/, '必须绘制 25/50/100km 距离环');
  assert.match(js, /geoLayer\.COUNTY_CENTER/, '距离环应以县域中心为圆心');
  assert.match(js, /drawPlaceLabel\(ctx\)/, '必须标注县名');
  assert.ok(js.includes("strokeText('中方县'"), '县名需要白色描边以保证在底图上可读');
});

test('旧「合成云图」实现已彻底移除，不留悬空引用', () => {
  assert.doesNotMatch(js, /buildWeatherVisualFrames|weatherVisual|visualFrame\b/, '页面不得再引用旧云图实现');
  assert.ok(!fs.existsSync(path.join(root, 'utils/weatherVisual.js')), 'utils/weatherVisual.js 应已删除');
  assert.doesNotMatch(wxml, /weather-visual|visual-legend/, '模板不得残留旧类名');
});

test('烘焙底图以本地资源加载，运行期不依赖任何地图瓦片服务', () => {
  assert.match(js, /img\.src = '\/assets\/basemap\/zhongfang\.png'/, '必须加载烘焙底图');
  assert.ok(fs.existsSync(path.join(root, 'assets/basemap/zhongfang.png')), '烘焙底图资源必须存在');
  assert.doesNotMatch(js, /tianditu|amap|gaode|map\.qq\.com/, '不得引入第三方底图服务');
});

test('真机兼容：新增样式不使用 flex gap，也不使用真机不支持的伪类', () => {
  assert.doesNotMatch(wxss, /gap\s*:/, '真机不支持 flex gap，会让整条规则失效');
  // 逐个选择器判断：剥掉 ::after/::before 后不应再残留任何「:」
  const selectors = Array.from(wxss.matchAll(/(?:^|\n)\s*([^{}\n]+?)\s*\{/g)).map((m) => m[1]);
  const owned = ['.layer-tab', '.layer-retry', '.layer-switch', '.layer-source', '.layer-legend', '.weather-layer', '.legend-dot'];
  selectors.forEach((sel) => {
    if (!owned.some((cls) => sel.includes(cls))) return;
    const stripped = sel.replace(/::(after|before)/g, '');
    assert.ok(!stripped.includes(':'), `${sel.trim()} 使用了除 ::after/::before 之外的伪类，真机会整条失效`);
  });
});

test('生命周期：切走页面必须停掉风场动画与帧播放，避免后台空转', () => {
  const hide = js.match(/onHide\(\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(hide, '必须有 onHide');
  assert.match(hide[0], /stopWindLoop\(\)/, 'onHide 必须停止风场动画');
  assert.match(hide[0], /stopLayerPlay\(\)/, 'onHide 必须停止帧播放');
  const unload = js.match(/onUnload\(\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(unload, '必须有 onUnload');
  assert.match(unload[0], /stopWindLoop\(\)/, 'onUnload 必须停止风场动画');
  assert.match(js, /cancelAnimationFrame\(this\.layerRaf\)/, '必须取消动画帧回调');
});

test('瓦片下载受并发上限约束，且缓存可淘汰', () => {
  assert.match(js, /const MAX = 4/, '必须有并发上限');
  assert.match(js, /activeDownloads < MAX/, '必须按并发上限出队');
  assert.match(js, /class|createCache/, '瓦片必须走缓存');
  assert.match(js, /layerRadar\.createCache\(/, '必须使用 LRU 缓存');
});

test('风场动画使用 canvas 的 requestAnimationFrame，而不是定时器', () => {
  assert.match(js, /requestAnimationFrame\(tick\)/, '风场必须用 canvas 帧回调驱动');
  assert.doesNotMatch(js.match(/startWindLoop\(\)\s*\{[\s\S]*?\n  \},/)[0], /setInterval/, '风场动画不应使用 setInterval');
});

test('★ 全屏查看已移除（2026-09-30 用户要求）：不得再有入口、状态、工具条与容器样式', () => {
  const w = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.wxml'), 'utf8');
  const j = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.js'), 'utf8');
  const s = require('fs').readFileSync(require('path').join(__dirname, '..', 'pages/rainfall/rainfall.wxss'), 'utf8');
  assert.strictEqual(/onLayerFullscreen/.test(w + j), false, '不该再有全屏处理函数与入口');
  assert.strictEqual(/layerFullscreen/.test(w + j), false, '不该再有全屏状态');
  assert.strictEqual(/layer-fs-/.test(w + s), false, '不该再有全屏工具条与样式（留着会撞死样式门禁）');
  assert.strictEqual(/\.weather-layer\.fullscreen\{/.test(s), false, '不该再有全屏容器样式');
  assert.ok(/<view class="weather-layer card">/.test(w), '容器类名应恢复为常态');
  // 卡片本身仍要在（删的是全屏，不是这一块）
  assert.ok(/class="layer-switch"/.test(w), '模式切换不能一起被误删');
  assert.ok(/id="layerCanvas"/.test(w), '画布不能一起被误删');
});

test('画布手势：用 catch 绑定（否则平移会把整页一起拖动）', () => {
  assert.match(wxml, /catchtouchstart="onLayerTouchStart"/, '必须 catch 触摸开始');
  assert.match(wxml, /catchtouchmove="onLayerTouchMove"/, '必须 catch 触摸移动');
  assert.match(wxml, /catchtouchend="onLayerTouchEnd"/, '必须 catch 触摸结束');
  assert.doesNotMatch(wxml, /bindtouchmove="onLayerTouchMove"/, '不得改用 bind（会冒泡导致页面滚动）');
  ['onLayerTouchStart', 'onLayerTouchMove', 'onLayerTouchEnd'].forEach((m) => {
    assert.match(js, new RegExp(m + '\\([^)]*\\)\\s*\\{'), `缺少 ${m} 实现`);
  });
});

test('缩放平移：走共享几何、受上下限约束、且必须钳制在底图范围内', () => {
  assert.match(js, /geoLayer\.zoomView\(/, '缩放必须走 geoLayer.zoomView');
  assert.match(js, /geoLayer\.panView\(/, '平移必须走 geoLayer.panView');
  assert.match(js, /geoLayer\.LAYER\.MIN_SPAN_KM, geoLayer\.LAYER\.MAX_SPAN_KM/, '缩放必须带上限');
  assert.match(js, /geoLayer\.clampView\(this\.layerView, geoLayer\.BAKE_BOUNDS\)/, '视窗必须钳制在烘焙底图范围内，否则会露白');
  assert.match(js, /anchorFromClient\(/, '捏合应以双指中点为锚点');
});

test('缩放后风场不得跟着视窗变形：必须按经纬度采样', () => {
  assert.match(js, /layerWind\.sampleFieldAt\(/, '必须按经纬度采样（不是按画布归一化坐标）');
  assert.match(js, /proj\.toLngLat\(x, y\)/, '采样器应先把画布像素反算成经纬度');
  assert.match(js, /advanceParticles\(this\.particles, this\.windSampler,/, '粒子推进必须使用注入的采样器');
  assert.doesNotMatch(js, /advanceParticles\(this\.particles, this\.windField,/, '不得再用字段直接按归一化坐标采样');
});

test('放大后按需换更密的风场网格，且避免频繁请求', () => {
  assert.match(js, /layerWind\.needsDenserGrid\(/, '需要判断网格是否已偏粗');
  assert.match(js, /layerWind\.fieldCovers\(/, '需要判断视窗是否还在已取范围内');
  assert.match(js, /layerWind\.spanBucket\(/, '需要用跨度分档避免同尺度重复请求');
  assert.match(js, /geoLayer\.expandView\(target, 1\.3, geoLayer\.BAKE_BOUNDS\)/, '取样范围应比视窗大一圈');
  assert.match(js, /scheduleViewSync\(\)\s*\{/, '需要防抖的视窗同步');
  assert.match(js, /setTimeout\(/, '视窗同步应防抖');
  assert.match(js, /clearTimeout\(this\.viewSyncTimer\)/, '离开页面时必须清理防抖定时器');
});



test('缩放提示与当前视野：文案随图层与倍率变化', () => {
  assert.match(js, /updateLayerHint\(\)\s*\{/, '需要分辨率提示');
  // 2026-11-25 用户反馈：说明文字过多。雷达提示精简为一句「放大后为插值效果」
  assert.ok(js.includes('放大后为插值效果'), '雷达放大后应说明插值（一句即可）');
  assert.ok(js.includes('风速色阶 '), '风场应说明色阶范围');
  assert.match(js, /updateSpanText\(\)\s*\{/, '需要显示当前视野范围');
  assert.match(wxml, /\{\{layerZoomHint\}\}/, '提示需要渲染到界面');
  assert.match(wxml, /\{\{layerSpanText\}\}/, '视野范围需要渲染到界面');
});

test('缩放只走手势：卡片与全屏都能双指放大，且不得按全屏状态做分支', () => {
  const methodBody = (name) => {
    const m = new RegExp(name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\},').exec(js);
    return m ? m[1] : '';
  };
  ['onLayerTouchStart', 'onLayerTouchMove', 'onLayerTouchEnd'].forEach((m) => {
    const body = methodBody(m);
    assert.ok(body.length > 40, m + ' 实现为空');
    assert.ok(!body.includes('layerFullscreen'), m + ' 不得按全屏状态分支——卡片态同样要能双指缩放');
  });
  assert.match(js, /onLayerTouchStart\(e\)\s*\{[\s\S]*?touches\.length >= 2/, '双指分支必须按手指数量判断');
  assert.match(wxml, /catchtouchstart="onLayerTouchStart"/, '画布必须 catch 触摸');
  // 缩放按钮已按要求撤掉，只保留「重定位」
  assert.doesNotMatch(wxml, /onLayerZoom/, '不应再保留缩放按钮');
  assert.doesNotMatch(wxml, /data-dir="/, '不应再保留 data-dir 按钮');
  assert.match(wxml, /class="layer-recenter" bindtap="onLayerRecenter"/, '需要「重定位」按钮');
  assert.match(js, /onLayerRecenter\(\)\s*\{/, '缺少 onLayerRecenter 实现');
  assert.match(js, /geoLayer\.recenterView\(/, '重定位必须走 geoLayer.recenterView');
  assert.match(wxml, /\{\{layerSpanText\}\}/, '当前视野范围要看得见，捏合缩放才有反馈');
  assert.match(wxml, /双指缩放/, '卡片态也要提示可以双指缩放，否则没人知道');
});


console.log('气象图层集成测试通过。');
