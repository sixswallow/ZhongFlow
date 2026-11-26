// Canvas 2d 迁移回归测试
//
// 背景：wx.createCanvasContext 旧版 CanvasContext 基础库 2.9 起废弃——无同层渲染、
// 真机性能差、方法签名（setFillStyle/setLineDash(arr,0) 等）与标准 Canvas 不一致，
// 还因此踩过「ctx.fillStyle = gradient 属性赋值不生效」的坑。
// 本文件锁定迁移结果：
//   ① 页面代码不得再出现 wx.createCanvasContext / canvas-id 旧写法；
//   ② 所有图表 canvas 一律 <canvas type="2d" id="...">；
//   ③ 绘制统一经 utils/canvas2d.js 取上下文（含 dpr 缩放与节点重试）。
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

const root = path.join(__dirname, '..');
const readPage = (page, file) => fs.readFileSync(path.join(root, 'pages', page, file), 'utf8');

const jsPages = ['detail/detail.js', 'rainfall/rainfall.js', 'index/index.js', 'list/list.js', 'map/map.js'];
const wxmlPages = ['detail/detail.wxml', 'rainfall/rainfall.wxml', 'index/index.wxml', 'list/list.wxml', 'map/map.wxml'];

test('页面代码不得再调用废弃的 wx.createCanvasContext', () => {
  jsPages.forEach((page) => {
    const src = readPage(...page.split('/'));
    assert.doesNotMatch(src, /wx\.createCanvasContext/, 'pages/' + page + ' 仍在使用旧版 CanvasContext');
  });
});

test('模板不得再使用 canvas-id，图表画布一律 type="2d"', () => {
  wxmlPages.forEach((page) => {
    const src = readPage(...page.split('/'));
    assert.doesNotMatch(src, /canvas-id=/, 'pages/' + page + ' 仍在使用 canvas-id');
  });
  const detail = readPage('detail', 'detail.wxml');
  ['#levelChart', '#moistureChart', '#riverChart'].forEach((id) => {
    const name = id.slice(1);
    assert.match(detail, new RegExp('<canvas type="2d" id="' + name + '"'), '详情页缺少 type="2d" 的 ' + name);
  });
  const rainfall = readPage('rainfall', 'rainfall.wxml');
  assert.match(rainfall, /<canvas type="2d" id="rainChart"/, '雨量图应为 type="2d" 画布');
});

test('图表上下文统一经 utils/canvas2d.js 获取，且助手处理 dpr 缩放', () => {
  const detail = readPage('detail', 'detail.js');
  const rainfall = readPage('rainfall', 'rainfall.js');
  const helper = fs.readFileSync(path.join(root, 'utils', 'canvas2d.js'), 'utf8');

  assert.match(detail, /canvas2d\.get2dContext\(/, '详情页图表应经统一助手取 2d 上下文');
  assert.match(rainfall, /canvas2d\.get2dContext\(/, '雨量图应经统一助手取 2d 上下文');
  // 高清屏上 2d 画布默认只有 CSS 尺寸分辨率，不按 pixelRatio 缩放会糊
  assert.match(helper, /pixelRatio/, '助手必须按 pixelRatio 缩放');
  assert.match(helper, /getContext\('2d'\)/, '助手应从节点取标准 2d 上下文');
});

test('绘制代码使用标准 2d API：属性赋值配色，不再有旧式 setter', () => {
  const detail = readPage('detail', 'detail.js');
  const rainfall = readPage('rainfall', 'rainfall.js');
  [detail, rainfall].forEach((src, i) => {
    assert.doesNotMatch(src, /ctx\.setStrokeStyle|ctx\.setFillStyle|ctx\.setFontSize|ctx\.setTextAlign/,
      (i === 0 ? 'detail.js' : 'rainfall.js') + ' 仍保留旧式 setter');
    assert.doesNotMatch(src, /ctx\.draw\(\)/, '标准 2d 上下文不需要 ctx.draw()');
  });
  assert.match(detail, /ctx\.font = 10 \+ 'px sans-serif'/, '字号应写入标准 ctx.font');
});

console.log('Canvas 2d 迁移回归测试通过。');
