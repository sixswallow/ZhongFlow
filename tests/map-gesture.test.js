const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mapConfig = JSON.parse(fs.readFileSync(path.join(root, 'pages', 'map', 'map.json'), 'utf8'));
const mapSource = fs.readFileSync(path.join(root, 'pages', 'map', 'map.js'), 'utf8');

assert.strictEqual(mapConfig.enablePullDownRefresh, false, '地图页必须关闭原生下拉刷新，避免与地图拖动手势冲突');
assert.strictEqual(/onPullDownRefresh\s*\(/.test(mapSource), false, '地图页不应注册下拉刷新处理函数');
console.log('地图手势冲突配置测试通过。');
