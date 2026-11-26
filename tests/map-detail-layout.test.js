const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wxss = fs.readFileSync(path.resolve(__dirname, '../pages/map/map.wxss'), 'utf8');
const statusRule = wxss.match(/\.panel-status\s*\{([\s\S]*?)\n\}/);

assert.ok(statusRule, '地图详情状态标签样式不存在');
assert.match(
  statusRule[1],
  /margin-right:\s*(?:5[0-9]|[6-9][0-9])rpx;/,
  '状态标签应为右上角关闭按钮预留至少 50rpx 的水平空间，避免重叠'
);

console.log('地图详情状态与关闭按钮避让测试通过。');
