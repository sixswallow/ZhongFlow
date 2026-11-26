const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pages = ['index', 'map', 'list', 'detail', 'rainfall'];

pages.forEach((page) => {
  const css = fs.readFileSync(path.join(root, 'pages', page, `${page}.wxss`), 'utf8');
  assert.match(css, /#0b4f8a/, `${page} 页应采用统一深水蓝品牌色`);
  assert.match(css, /#f4f8fc/, `${page} 页应采用统一雾白蓝背景`);
  assert.match(css, /border-radius:\s*(?:20|22|24|28)rpx/, `${page} 页应采用统一圆角卡片语言`);
});

const indexCss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8');
const mapCss = fs.readFileSync(path.join(root, 'pages/map/map.wxss'), 'utf8');
const listCss = fs.readFileSync(path.join(root, 'pages/list/list.wxss'), 'utf8');
const detailCss = fs.readFileSync(path.join(root, 'pages/detail/detail.wxss'), 'utf8');
const rainfallCss = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.wxss'), 'utf8');

assert.match(indexCss, /\.hero-surface/, '首页应具备重新设计的水文品牌头部');
assert.match(mapCss, /\.station-panel/, '地图应保留并重设计站点底部详情面板');
assert.match(listCss, /\.station-item/, '站点列表应保留并重设计站点卡片');
assert.match(detailCss, /\.header\.reservoir/, '详情页应保留按站点类型区分的头部');
assert.match(rainfallCss, /\.weather-layer/, '气象图层卡片应保留可视化画布');

console.log('全局 UI 重设计视觉系统测试通过。');
