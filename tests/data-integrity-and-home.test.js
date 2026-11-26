const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const weatherFunction = fs.readFileSync(path.join(root, 'cloudfunctions/getWeather/index.js'), 'utf8');
const stationsFunction = fs.readFileSync(path.join(root, 'cloudfunctions/getStations/index.js'), 'utf8');
const mapSource = fs.readFileSync(path.join(root, 'pages/map/map.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');

assert.match(weatherFunction, /code:\s*'431221100'/, '天气云函数应使用现行中方镇代码');
assert.match(weatherFunction, /lng:\s*109\.956492,\s*lat:\s*27\.3844/, '天气云函数应使用边界聚合后的中方镇中心点');
assert.match(weatherFunction, /code:\s*'431221214'/, '天气云函数应使用现行蒿吉坪瑶族乡代码');
assert.doesNotMatch(weatherFunction, /code:\s*'431221200'/, '天气云函数不得保留旧蒿吉坪瑶族乡代码');

assert.doesNotMatch(stationsFunction, /latitude:\s*num\([^\n]+,\s*27\.475\)/, '缺失站点纬度不得伪造为县中心');
assert.doesNotMatch(stationsFunction, /longitude:\s*num\([^\n]+,\s*109\.967\)/, '缺失站点经度不得伪造为县中心');
assert.match(mapSource, /\.filter\(hasValidCoordinates\)/, '地图应过滤没有有效坐标的站点');

assert.doesNotMatch(indexSource, /buildReservoirWarningDescription|buildRiverWarningDescription/, '首页不应依据未核验阈值生成预警文案');
assert.match(indexSource, /api\.getStationGroups\(options\)/, '首页应通过聚合接口一次性取回全部站点');
assert.match(indexSource, /groups\.list/, '首页最新数据应从全部站点统一排序');
assert.doesNotMatch(indexSource, /reservoirs\.slice\(0, 3\)/, '首页不得先截取水库前3条再排序');

console.log('第一批数据真实性与首页排序优化测试通过。');
