// 详情页「监测数据」分区布局回归测试
// 锁定三件事：
//   1. hasMonitoringData 必须精确等价于「模板里至少会渲染出一个元素」，
//      否则会出现「空态提示与指标同时出现」或「只剩标题的空卡片」；
//   2. 栅格只放指标块，土壤剖面/分区标题等全宽区块不得混入，否则奇数项必然留空洞；
//   3. 警戒差值不得再渲染成「超警戒 -2.35m」。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

global.wx = new Proxy({}, { get: () => () => ({}) });
global.getApp = () => ({ globalData: {} });
let pageDef = null;
global.Page = (o) => { pageDef = o; };
require('../pages/detail/detail.js');

const display = (station) => pageDef.processStationDisplay.call(pageDef, station);

// 严格镜像 detail.wxml 的渲染条件
function renderedElements(station, d) {
  const out = [];
  if (station.type === 'reservoir' && d.currentLevelText !== '--') out.push('水库主指标');
  if (station.type === 'river' && d.waterLevelText !== '--') out.push('河道主指标');
  if (station.type === 'soil' && d.showAverageMoisture) out.push('墒情主指标');
  if (station.type === 'soil' && d.showRelativeMoisture) out.push('墒情相对含水率');
  if (station.type === 'soil' && d.showDepthMoistures) out.push('分层含水量');
  if (station.type === 'reservoir') {
    if (d.showVolume) out.push('当前库容');
    if (d.showInflow) out.push('入库流量');
    if (d.showOutflow) out.push('出库流量');
  }
  if (station.type === 'river') {
    if (d.showFlow) out.push('流量');
    if (d.showTemperature) out.push('水温');
    if (d.showWaterQuality) out.push('水质');
  }
  if (station.type === 'soil') {
    // 饱和含水率已归入「站点信息」（土壤物理属性，不随时间变），相对含水率已升入主指标带
    if (d.showTemperature) out.push('地温');
  }
  return out;
}

// 内联样本站点：覆盖各类型「有/无监测数据」的字段形态
//（原先从 utils/mockData.js 取样，随死代码清理改为内联，字段落点与线上真实结构一致）
const stations = [
  { id: 'R0', type: 'reservoir', name: '全指标水库', currentLevel: 193.6, warningLevel: 198, currentVolume: 980, inflow: 2.5, outflow: 1.8 },
  { id: 'X1', type: 'reservoir', name: '仅水位水库', currentLevel: 120.5 },
  { id: 'X2', type: 'reservoir', name: '无数据水库' },
  { id: 'V0', type: 'river', name: '全指标河道', waterLevel: 165.8, flow: 125.6, warningLevel: 170.5 },
  { id: 'V2', type: 'river', name: '无流量河道', waterLevel: 170.2 },
  { id: 'X3', type: 'river', name: '超警戒河道', waterLevel: 105.2, warningLevel: 103 },
  { id: 'S0', type: 'soil', name: '全指标墒情站', moisture: 42.5, temperature: 26.8, relativeMoisture: 72.8, status: 'normal' },
  { id: 'S2', type: 'soil', name: '仅含水量墒情站', moisture: 28.3, status: 'dry' },
  { id: 'X4', type: 'soil', name: '无数据墒情站' },
  { id: 'X5', type: 'soil', name: '只有地温的墒情站', temperature: 27.4, status: 'normal' },
  // X6 是「饱和含水率」的判据隔离样本：它是站点属性、已移出监测区。
  // 若 hasMonitoringData 又退回用 showDroughtIndicators 判定，本样本会立刻不一致。
  { id: 'X6', type: 'soil', name: '只有饱和含水率的墒情站', saturatedMoisture: 45.0 }
];

for (const st of stations) {
  const d = display(st);
  const rendered = renderedElements(st, d);
  assert.strictEqual(
    d.hasMonitoringData,
    rendered.length > 0,
    `${st.name || st.id}: hasMonitoringData=${d.hasMonitoringData} 与实际渲染元素 [${rendered.join('/')}] 不一致`
  );
}

// 超警戒不得再出现负号
const over = display({ type: 'river', waterLevel: 105.2, warningLevel: 103 });
assert.strictEqual(over.warningDiff, '-2.20');
assert.strictEqual(over.warningDiffAbs, '2.20', '超警戒差值必须取绝对值');
assert.strictEqual(over.warningDiffState, 'over', '超警戒应标记 over 以显示告警色');
const near = display({ type: 'reservoir', currentLevel: 100, warningLevel: 104 });
assert.strictEqual(near.warningDiffState, undefined, '水库不再产出距汛限相对量（上游水位与官方特征水位不同口径）');

// 模板结构约定
const tpl = fs.readFileSync(path.join(root, 'pages/detail/detail.wxml'), 'utf8');
const cardStart = tpl.indexOf('<view class="card anim-up d1">');
const cardEnd = tpl.indexOf('<view class="card anim-up d2"');
assert.ok(cardStart >= 0 && cardEnd > cardStart, '未定位到监测数据卡片');
const monitorCard = tpl.slice(cardStart, cardEnd);
const grid = monitorCard.slice(monitorCard.indexOf('<view class="realtime-grid">'));

assert.doesNotMatch(grid, /soil-profile|soil-section-title|metric-hero|section-hint|metric-empty/,
  '监测数据栅格内不得混入全宽区块（否则奇数项必然留空洞）');
assert.match(grid, /class="realtime-item/, '栅格应由 realtime-item 组成');
assert.ok(monitorCard.includes('class="metric-hero'), '监测数据卡片应有主指标区');
assert.ok(monitorCard.indexOf('metric-hero') < monitorCard.indexOf('realtime-grid'), '主指标应排在次级指标之前');
assert.doesNotMatch(monitorCard, /土壤类型|默认监测层/, '静态属性不应放在监测数据卡片内');

const infoCard = tpl.slice(tpl.indexOf('<view class="info-list">'));
assert.ok(infoCard.includes('土壤类型') && infoCard.includes('默认监测层'), '静态属性应回归站点信息卡片');

// 样式约定：落单项必须铺满整行
const css = fs.readFileSync(path.join(root, 'pages/detail/detail.wxss'), 'utf8');
assert.match(css, /\.realtime-grid \.realtime-item:last-child:nth-child\(odd\)\{width:100%\}/,
  '缺少「落单指标铺满整行」规则，奇数项会留下空洞');
assert.doesNotMatch(css, /\.soil-overview/, '旧的 .soil-overview 规则应已被 .metric-hero 取代');
assert.match(css, /\.realtime-item-wide\{float:none;width:100%\}/, '落单项必须有显式整行规则（真机不保证支持伪类选择器）');
assert.match(monitorCard, /realtime-item soil-indicator realtime-item-wide/, '墒情站的「地温」应带显式整行类');


// 结构约定（2026-09-22 按「同类并排」重排）：同类的两个主指标必须在同一个主指标带内并排，
// 次级指标才进栅格；否则「入库流量/出库流量」这类成对指标会被拆到不同行，读起来不符合逻辑。
const bandText = monitorCard.slice(monitorCard.indexOf('class="metric-hero'), monitorCard.indexOf('<view class="realtime-grid">'));
assert.ok(bandText.includes('当前库水位（海拔）') && bandText.includes('当前库容'),
  '水库主指标带应并排容纳「当前库水位（海拔）」与「当前库容」（同为一类，不可拆行）');
assert.ok(bandText.includes('>水位（海拔）<') && bandText.includes('>流量<'),
  '河道主指标带应并排容纳「水位（海拔）」与「流量」（河道水文过程的两条曲线，不可拆行）');
assert.ok(!bandText.includes('入库') && !bandText.includes('出库'),
  '「入库流量/出库流量」是次级指标，不应放进主指标带');
assert.ok(!grid.includes('当前库容'), '「当前库容」已并入主指标带，不应重复出现在栅格');
assert.ok(!grid.includes('>流量<'), '「流量」已并入主指标带，不应重复出现在栅格');
assert.ok(grid.includes('>入库流量<') && grid.includes('>出库流量<'), '入库/出库流量应成对出现在同一栅格行');
assert.ok(grid.includes('>水温<') && grid.includes('>水质<'), '水温/水质应成对出现在同一栅格行');
// 信息密度约定（2026-09-26）：墒情站曾同时渲染「平均含水量 + 分层 3 条 + 旱情 3 格」共 7 个数据点，
// 是水库/河道（各 4 个）的近两倍，且「相对含水率」既在指标格里又在趋势 chip 里。
// 现按「监测区只放会变的数」收敛：相对含水率升入主指标带、饱和含水率移入站点信息、删掉分区标题与说明行。
assert.ok(bandText.includes('相对含水率'), '「相对含水率」（旱情程度）应提升到墒情主指标带');
assert.doesNotMatch(monitorCard, /饱和含水率/, '「饱和含水率」是土壤物理属性，不应留在监测数据卡');
assert.doesNotMatch(monitorCard, /墒情与旱情指标|section-hint/, '旱情分区标题与说明行已并入主指标带，不应再出现');
assert.doesNotMatch(monitorCard, /土壤剖面/, '分区标题应已简化为「分层含水量」');
assert.ok(infoCard.includes('饱和含水率'), '「饱和含水率」应出现在站点信息卡');
assert.doesNotMatch(tpl, /当前曲线：/, '趋势说明不应重复 chip 已高亮的曲线名');
assert.doesNotMatch(css, /.section-hint/, '说明行已删除，样式不应残留');

console.log('详情页监测数据分区布局测试通过。');
