// 「控制水位」称谓回归：水库叫汛限水位，河道才叫警戒水位
//
// 背景与口径：水库的上游字段 FSLTDZ 是防汛（防洪限制）水位，河道字段 HLZ 才是警戒水位。
// 两类站此前共用一套 danger 文案，水库也标成「超警戒」——而水库不用「警戒水位」这个说法。
// 更糟的是同一个页面上，控制水位的**高程**叫「警戒水位」、相应**库容**叫「汛限水位库容」。
//
// 本文件锁住四件事：
//   ① 云函数与前端两套词汇表各自按站点类型输出（水库 = 超汛限，河道 = 超警戒）；
//   ② 详情页文案：水库「距汛限/超汛限」，河道「距警戒/超警戒」；站点信息标签各用各的；
//   ③ 两类站不得互相串味：水库水文过程卡不出现「警戒」，河道卡不出现「汛限」；
//   ④ 列表/地图的状态文字只能来自数据（云函数 statusText），不得写死某一类的用词。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  STATUS_TEXT,
  RESERVOIR_STATUS_TEXT,
  formatReservoirItem,
  formatRiverItem
} = require('../cloudfunctions/getStations/index.js');
const { getStationStatusText, STATION_STATUS_TEXT, DANGER_TEXT_BY_TYPE } = require('../utils/stationStatus.js');
const { buildMarkerVisual } = require('../utils/mapMarker.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'pages/detail', 'detail.wxml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'pages/detail', 'detail.js'), 'utf8');

// 桩加载详情页，调用页面里真正跑的 processStationDisplay（而不是另写一份「应该怎么渲染」）
// canvas type="2d" 迁移后：绘制走 SelectorQuery 取节点，本测试不触发绘制路径，给兜底桩
global.wx = {
  getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  createSelectorQuery: () => {
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    const node = { width: 0, height: 0, getContext: () => ctx };
    const query = {
      in() { return query; },
      select() { return query; },
      fields() { return query; },
      exec(cb) { cb([{ node, width: 320, height: 200 }]); }
    };
    return query;
  },
  setNavigationBarTitle: () => {},
  stopPullDownRefresh: () => {}
};
global.getApp = () => ({ globalData: {} });
let pageDef = null;
global.Page = (options) => { pageDef = options; };
require(path.join(root, 'pages', 'detail', 'detail.js'));
const display = (station) => pageDef.processStationDisplay.call(pageDef, station);

/* ---------- ① 两套词汇表 ---------- */
test('云函数：水库达到汛限水位表述为「超汛限」', () => {
  const over = formatReservoirItem({ STCD: 'R9', STNM: '测试水库', RZ: 110, FSLTDZ: 105 });
  assert.strictEqual(over.status, 'danger');
  assert.strictEqual(over.statusText, '超汛限');
});

test('云函数：河道达到警戒水位仍表述为「超警戒」', () => {
  const over = formatRiverItem({ STCD: 'V9', STNM: '测试河道', Z: 53, HLZ: 52 });
  assert.strictEqual(over.status, 'danger');
  assert.strictEqual(over.statusText, '超警戒');
});

test('基础词汇表保持河道口径，水库口径单独一份、且只差 danger 一项', () => {
  assert.strictEqual(STATUS_TEXT.danger, '超警戒');
  assert.strictEqual(STATION_STATUS_TEXT.danger, '超警戒');
  assert.strictEqual(RESERVOIR_STATUS_TEXT.danger, '超汛限');
  assert.deepStrictEqual(
    Object.keys(RESERVOIR_STATUS_TEXT).sort(),
    Object.keys(STATUS_TEXT).sort(),
    '两级词汇表的键必须一致'
  );
  Object.keys(STATUS_TEXT)
    .filter((key) => key !== 'danger')
    .forEach((key) => {
      assert.strictEqual(RESERVOIR_STATUS_TEXT[key], STATUS_TEXT[key], '除 danger 外不应有任何差异: ' + key);
    });
});

test('前端状态文案按站点类型区分控制水位称谓', () => {
  assert.strictEqual(getStationStatusText('danger', 'reservoir'), '超汛限');
  assert.strictEqual(getStationStatusText('danger', 'river'), '超警戒');
  assert.strictEqual(getStationStatusText('danger'), '超警戒', '未指明类型时保持河道口径');
  assert.strictEqual(getStationStatusText('warning', 'reservoir'), '水位偏低', '非 danger 状态不受类型影响');
  assert.deepStrictEqual(DANGER_TEXT_BY_TYPE, { reservoir: '超汛限', river: '超警戒' });
});

test('地图气泡按站点类型用词', () => {
  assert.strictEqual(buildMarkerVisual({ type: 'reservoir', status: 'danger' }).callout.content, '超汛限');
  assert.strictEqual(buildMarkerVisual({ type: 'river', status: 'danger' }).callout.content, '超警戒');
});

/* ---------- ② 详情页文案 ---------- */
test('详情页：水库不再展示「距汛限/超汛限」相对量（2026-11-25 全县核对：上游水位与官方特征水位不同口径，相对量不可信）', () => {
  const near = display({ type: 'reservoir', status: 'normal', currentLevel: 100, warningLevel: 104 });
  assert.strictEqual(near.warningDiffText, undefined, '水库不得再产出「距汛限」相对量');
  assert.strictEqual(near.warningDiffState, undefined);

  const over = display({ type: 'reservoir', status: 'danger', currentLevel: 110, warningLevel: 105 });
  assert.strictEqual(over.warningDiffText, undefined, '水库不得再产出「超汛限」相对量');
  // statusText 来自上游 status 字段（utils/stationStatus.js 的词表），不在本次移除范围
  assert.strictEqual(over.statusText, '超汛限');
});

test('详情页：河道控制水位文案仍是「警戒」', () => {
  const near = display({ type: 'river', status: 'normal', waterLevel: 50, warningLevel: 52 });
  assert.strictEqual(near.warningDiffText, '距警戒');

  const over = display({ type: 'river', status: 'danger', waterLevel: 53, warningLevel: 52 });
  assert.strictEqual(over.warningDiffText, '超警戒');
  assert.strictEqual(over.statusText, '超警戒');
});

test('站点信息卡：水库标「汛限水位」、河道标「警戒水位」', () => {
  assert.match(
    template,
    /station\.type === 'reservoir' && station\.warningLevel\}\}">\s*<view class="info-label">汛限水位<\/view>/,
    '水库站点信息里控制水位应标「汛限水位」'
  );
  assert.match(
    template,
    /station\.type === 'river' && station\.warningLevel\}\}">\s*<view class="info-label">警戒水位<\/view>/,
    '河道站点信息里控制水位应保持「警戒水位」'
  );
  assert.match(
    template,
    /占汛限水位库容 \{\{display\.volumePercent\}\}%/,
    '主指标带应按汛限水位库容口径说明占比'
  );
  assert.doesNotMatch(template, /总库容/, '界面不得再出现「总库容」');
  assert.doesNotMatch(template, /占总库容/, '不得再按总库容口径说明占比');
});

/* ---------- ③ 两类站不得互相串味 ---------- */
// 用卡片起始标记切片：模板里注释也出现过「河道水文过程」字样，按文字切会把注释算进来
const RES_CARD = `<view class="card anim-up d2" wx:if="{{station.type === 'reservoir'}}">`;
const SOIL_CARD = `<view class="card anim-up d2" wx:if="{{station.type === 'soil'}}">`;
const RIVER_CARD = `<view class="card anim-up d2" wx:if="{{station.type === 'river'}}">`;
const INFO_CARD = `<view class="card anim-up d3">`;

const cardSlice = (startMarker, endMarker, label) => {
  assert.strictEqual(template.split(startMarker).length - 1, 1, label + ' 的起始标记应只有一处');
  assert.strictEqual(template.split(endMarker).length - 1, 1, label + ' 的结束标记应只有一处');
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker);
  assert.ok(end > start, label + ' 的结束标记应在其起始标记之后');
  return template.slice(start, end);
};

test('水库水文过程卡不得出现「警戒」', () => {
  const reservoirCard = cardSlice(RES_CARD, SOIL_CARD, '水库过程卡');
  assert.doesNotMatch(reservoirCard, /警戒/, '水库水文过程卡不得出现「警戒」字样');
  assert.match(reservoirCard, /入库 \(m³\/s\)/, '水库过程图应有入库图例');
  assert.match(reservoirCard, /出库 \(m³\/s\)/, '水库过程图应有出库图例');
});

test('河道水文过程卡不得出现「汛限」', () => {
  const riverCard = cardSlice(RIVER_CARD, INFO_CARD, '河道过程卡');
  assert.doesNotMatch(riverCard, /汛限/, '河道水文过程卡不得出现「汛限」字样');
  assert.match(riverCard, /警戒水位 \(m\)/, '河道图例应保留警戒水位参考线');
});

/* ---------- ④ 状态文字只能来自数据 ---------- */
test('列表与地图的状态文字必须来自云函数 statusText，不得写死某一类的用词', () => {
  const list = fs.readFileSync(path.join(root, 'pages', 'list', 'list.wxml'), 'utf8');
  const map = fs.readFileSync(path.join(root, 'pages', 'map', 'map.wxml'), 'utf8');
  assert.match(list, /item\.statusText/, '列表状态胶囊应渲染 item.statusText');
  assert.match(map, /selectedStation\.statusText/, '地图面板应渲染 selectedStation.statusText');
  assert.doesNotMatch(list, /超警戒|超汛限/, '列表不得写死状态文字');
  assert.doesNotMatch(map, /超警戒|超汛限/, '地图不得写死状态文字');
});

test('页面不得改用 util 里返回「超警戒」的旧水位判定函数', () => {
  const consumers = [
    ['pages', 'detail', 'detail.js'],
    ['pages', 'list', 'list.js'],
    ['pages', 'map', 'map.js'],
    ['pages', 'index', 'index.js']
  ];
  consumers.forEach((parts) => {
    const text = fs.readFileSync(path.join(root, ...parts), 'utf8');
    assert.doesNotMatch(text, /getWaterLevelStatus/, parts.join('/') + ' 不得改用旧的水位判定函数');
  });
});

test('详情页状态文案由类型参入，不得只传 status', () => {
  assert.match(source, /getStatusText\(station\.status, station\.type\)/, '详情页状态文案应带上站点类型');
  assert.match(source, /getStationStatusText\(status, type\)/, 'getStatusText 应把类型透传给共用文案函数');
});

console.log('控制水位称谓（汛限水位 / 警戒水位）测试通过。');
