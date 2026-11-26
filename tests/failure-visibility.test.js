// 失败可见性回归测试
// 历史缺陷：utils/api.js 所有列表/历史接口在最外层把请求失败吞成空数组，
// 页面拿不到失败信号 —— 网络断掉时「失败」与「真的没数据」在界面上无法区分。
// 本测试锁定：默认对外仍返回空数组（兼容既有调用），但支持 throwOnError，
// 且首页/列表/地图/详情都有明确的失败态渲染。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const apiSource = read('utils/api.js');
const indexSource = read('pages/index/index.js');
const listSource = read('pages/list/list.js');
const listTemplate = read('pages/list/list.wxml');
const mapSource = read('pages/map/map.js');
const mapTemplate = read('pages/map/map.wxml');
const detailSource = read('pages/detail/detail.js');
const detailTemplate = read('pages/detail/detail.wxml');

// api 层：聚合接口带失败信号，历史接口支持严格模式
assert.match(apiSource, /getStationGroups/, 'api 应提供 getStationGroups 聚合接口');
assert.match(apiSource, /failedTypes/, '聚合结果应列出失败类别');
assert.match(apiSource, /if \(options\.throwOnError\) throw e;/, '列表与历史接口应支持 throwOnError 严格模式');
assert.match(detailSource, /getStationHistory\(station.id, dataType, chartDays, \{ throwOnError: true \}\)/, '详情页历史数据应以严格模式请求，失败要能暴露到页面');
assert.match(listSource, /api\.getStationGroups\(options\)/, '列表页应使用带失败信号的聚合接口');
assert.match(listSource, /loadFailed/, '列表页应维护失败标记');
assert.match(listTemplate, /load-failed-banner/, '列表页应渲染失败横幅');
assert.match(listTemplate, /retryLoad/, '列表页失败横幅应有重试入口');

assert.match(mapSource, /api\.getStationGroups\(options\)/, '地图页应使用带失败信号的聚合接口');
assert.match(mapSource, /retryLoad/, '地图页应有重试方法');
assert.match(mapTemplate, /map-load-failed/, '地图页应渲染失败提示');

assert.match(indexSource, /stationLoadFailed/, '首页应区分「失败」与「暂无数据」');
assert.match(indexSource, /站点数据获取失败/, '首页失败时应展示明确的失败文案');

assert.match(detailSource, /chartLoadFailed/, '详情页应维护历史数据失败标记');
assert.match(detailTemplate, /趋势数据加载失败/, '详情页历史数据失败时应给出可读提示');

console.log('失败可见性测试通过。');
