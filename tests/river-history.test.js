const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const historyFunction = fs.readFileSync(path.join(root, 'cloudfunctions/getStationHistory/index.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8');
const detailSource = fs.readFileSync(path.join(root, 'pages/detail/detail.js'), 'utf8');
const detailTemplate = fs.readFileSync(path.join(root, 'pages/detail/detail.wxml'), 'utf8');

assert.match(historyFunction, /RIVER_PROCESS_PATH:\s*'\/newapi\/api\/v1\/ysq\/river\/process'/, '历史云函数应配置真实河道水文过程接口');
assert.match(historyFunction, /if \(type === 'river'\)/, '历史云函数应为河道建立独立分支');
assert.match(historyFunction, /stcd:\s*code/, '河道过程请求应使用小写 stcd 参数');
assert.match(historyFunction, /stm:\s*range\.begin/, '河道过程请求应使用小写 stm 参数');
assert.match(historyFunction, /etm:\s*range\.end/, '河道过程请求应使用小写 etm 参数');
assert.match(historyFunction, /waterLevel/, '河道过程响应应保留水位字段');
assert.match(historyFunction, /flow/, '河道过程响应应保留流量字段');
assert.match(historyFunction, /warningLevel/, '河道过程响应应保留警戒水位字段');

assert.doesNotMatch(apiSource, /河道历史数据暂无真实接口/, '前端不得再把河道历史固定为空');
assert.match(apiSource, /return getRiverHistory\(stationId, days/, '前端应路由河道历史请求');
assert.match(detailSource, /dataType = 'river'/, '详情页应请求河道历史数据');
assert.doesNotMatch(detailSource, /station\.type === 'river'\) return/, '详情页不得跳过河道历史加载');
assert.match(detailTemplate, /河道水文过程/, '河道详情应展示水文过程图');
assert.match(detailTemplate, /水位 \(m\)/, '河道过程图应标明水位单位');
assert.match(detailSource, /riverHasFlow/, '河道图应依据真实过程数据记录是否存在流量');
assert.match(detailSource, /showAllPoints = points\.length <= 12/, '河道图在记录较多时不得绘制所有数据标点');
assert.match(detailSource, /if \(i === 0 \|\| i === points\.length - 1\)/, '河道图应至少保留首尾数据标点');
assert.match(detailTemplate, /wx:if="\{\{riverHasFlow\}\}"/, '无流量数据时不得显示流量图例或单位');
assert.match(detailTemplate, /wx:if="\{\{!riverHasFlow\}\}"/, '无流量数据时应明确说明未获取到流量过程');

console.log('河道历史趋势接入测试通过。');
