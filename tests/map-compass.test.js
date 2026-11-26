const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mapTemplate = fs.readFileSync(path.resolve(__dirname, '../pages/map/map.wxml'), 'utf8');

assert.match(
  mapTemplate,
  /show-compass="\{\{false\}\}"/,
  '地图应关闭原生指南针，避免右上角控件遮挡且视觉风格不一致'
);
assert.doesNotMatch(mapTemplate, /show-compass="\{\{true\}\}"/);

console.log('地图指南针视觉配置测试通过。');
