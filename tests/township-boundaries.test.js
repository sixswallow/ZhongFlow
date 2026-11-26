const assert = require('assert');
const { TOWNSHIP_BOUNDARIES, getTownshipBoundary } = require('../utils/townshipBoundaries.js');

const expected = ['中方镇', '泸阳镇', '花桥镇', '铜湾镇', '桐木镇', '铁坡镇', '新建镇', '接龙镇', '铜鼎镇', '新路河镇', '袁家镇', '蒿吉坪瑶族乡'];
const pickerOrder = ['中方镇', '桐木镇', '花桥镇', '铜湾镇', '泸阳镇', '新建镇', '接龙镇', '铁坡镇', '袁家镇', '新路河镇', '铜鼎镇', '蒿吉坪瑶族乡'];

assert.strictEqual(TOWNSHIP_BOUNDARIES.length, 12, '应仅保留2024年统计区划确认的12个乡镇');
assert.deepStrictEqual(TOWNSHIP_BOUNDARIES.map((item) => item.name), expected);
assert.strictEqual(getTownshipBoundary('黄岩乡'), null, '已不在当前选择列表的黄岩乡不得渲染为当前乡镇边界');

const { getTownshipOptions, resolveTownshipLocation } = require('../utils/locationOptions.js');
assert.deepStrictEqual(getTownshipOptions(), ['中方县（全县）'].concat(pickerOrder), '地区选择顺序应保持原有业务顺序');
pickerOrder.forEach((name) => {
  const location = resolveTownshipLocation(name);
  const boundary = getTownshipBoundary(name);
  assert.strictEqual(location.latitude, boundary.center.latitude, `${name} 应使用聚合边界中心点`);
  assert.strictEqual(location.longitude, boundary.center.longitude, `${name} 应使用聚合边界中心点`);
});

TOWNSHIP_BOUNDARIES.forEach((item) => {
  assert.ok(item.code && item.code.length === 9, `${item.name} 缺少乡镇代码`);
  assert.ok(Array.isArray(item.points) && item.points.length >= 4, `${item.name} 缺少有效边界点`);
  assert.ok(item.center && Number.isFinite(item.center.latitude) && Number.isFinite(item.center.longitude), `${item.name} 缺少面内中心点`);
});

{
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.resolve(__dirname, '../pages/map/map.js'), 'utf8');
  const template = fs.readFileSync(path.resolve(__dirname, '../pages/map/map.wxml'), 'utf8');
  assert.ok(source.includes('TOWNSHIP_BOUNDARIES'));
  assert.ok(source.includes('townshipPolygons'));
  assert.ok(template.includes('polygons="{{townshipPolygons}}"'));
}

console.log('中方县乡镇边界资源测试通过。');
