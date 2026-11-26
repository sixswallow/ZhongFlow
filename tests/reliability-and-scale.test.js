const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rainfallSource = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.js'), 'utf8');
const rainfallTemplate = fs.readFileSync(path.join(root, 'pages/rainfall/rainfall.wxml'), 'utf8');
const detailTemplate = fs.readFileSync(path.join(root, 'pages/detail/detail.wxml'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'utils/config.js'), 'utf8');
const mapSource = fs.readFileSync(path.join(root, 'pages/map/map.js'), 'utf8');

assert.match(rainfallSource, /weatherStatus:\s*'loading'/, '天气页需要显式数据状态');
assert.match(rainfallSource, /weatherStatus:\s*'success'/, '天气成功后需要更新成功状态');
assert.match(rainfallSource, /weatherStatus:\s*'error'/, '天气失败后需要更新失败状态');
assert.match(rainfallTemplate, /wx:if="\{\{weatherStatus === 'error'\}\}"/, '天气页需要提供错误空态');
assert.match(rainfallTemplate, /bindtap="onRefresh"/, '天气错误空态需要允许用户重试');
assert.doesNotMatch(rainfallSource.match(/async loadWeather\(\)[\s\S]*?\n  \},\n\n  processWeatherDisplay/)[0], /util\.showLoading/, '子级天气请求不应自行管理全局 Loading');

assert.match(detailTemplate, /wx:if="\{\{station\.type === 'river'\}\}"/, '河道详情需要显示历史数据区域');
assert.match(detailTemplate, /河道水文过程/, '河道详情应展示真实水文过程图');
assert.match(detailTemplate, /当前时间范围内暂无河道水文过程记录/, '河道无记录时应展示明确空态');
assert.match(detailTemplate, /暂未获取站点坐标/, '详情页应对缺失坐标展示明确空态');
assert.match(fs.readFileSync(path.join(root, 'pages/detail/detail.js'), 'utf8'), /hasCoordinates/, '详情页应仅在经纬度同时有效时显示坐标');

assert.doesNotMatch(configSource, /CAIYUN_TOKEN\s*:/, '前端配置不应保留天气 Token 占位字段');
assert.match(mapSource, /MAX_MAP_MARKERS/, '地图应存在 Marker 上限保护');
assert.match(mapSource, /visibleMarkerCount/, '地图应反馈当前可见点位数量');
assert.match(fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8'), /weatherStatus:\s*'loading'/, '首页天气需要显式数据状态');
assert.match(fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8'), /wx:if="\{\{weatherStatus === 'error'\}\}"/, '首页天气失败时需要展示错误状态');

console.log('第二、三批可靠性与规模预案测试通过。');
