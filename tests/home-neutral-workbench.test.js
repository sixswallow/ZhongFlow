const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');

assert.doesNotMatch(source, /buildOperationalStatus/, '首页不得再根据站点状态构建预警或风险态势');
assert.doesNotMatch(source, /buildFocusList/, '首页不得再筛选重点关注站点');
assert.doesNotMatch(source, /dangerCount|warningCount|abnormalCount/, '首页不得再展示风险或预警数量');
assert.match(source, /latestUpdateTime/, '首页应展示真实最新数据更新时间');
assert.match(source, /recentList:\s*recentList\.slice\(0, 3\)/, '首页最近更新保留三条');

assert.doesNotMatch(template, /运行态势|重点关注|重点风险|需关注|预警|风险/, '首页界面不得显示预警或风险措辞');
assert.match(template, /数据概览/, '首页应使用中性的真实数据概览');
assert.match(template, /查看地图/, '首页应保留地图主入口');
assert.match(template, /最新数据/, '首页应保留最近更新数据');
assert.match(fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8'), /\.content\s*\{[^}]*margin-top:\s*0/s, '首页内容区不得以负外边距覆盖天气区域');
assert.match(source, /zhongfangStationCount/, '全县站点数量应使用明确的中方县字段名');
assert.doesNotMatch(template, /\{\{location\.city\}\}监测数据/, '查看区域名称不得与全县总站点数并列造成范围误解');
assert.match(template, /中方县全域纳入监测站点/, '总站点数必须明确为中方县全域口径');
assert.match(template, /\{\{item\.stationTypeLabel\}\}/, '最近数据必须显示完整站点类型名称');
assert.doesNotMatch(template, /<text wx:if="\{\{item\.type === 'reservoir'\}\}">水<\/text>/, '最近数据不得使用含义不明的单字类型标识');

assert.match(fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8'), /#0e4d64/, '首页应使用青黛设计系统品牌主色');
assert.match(fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8'), /#f4f8fc/, '首页背景应采用统一雾白蓝底色');
assert.match(fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8'), /linear-gradient\(150deg,#0e4d64 0%,#0b4f8a/, '首页顶部应使用青黛水文渐变');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8'), /#123e57|#10384e|#146788|#1b839d/, '首页不得继续使用与其他板块割裂的深青色主视觉');

console.log('首页无预警中性工作台测试通过。');
