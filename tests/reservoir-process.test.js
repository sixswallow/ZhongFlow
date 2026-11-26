// 水库水文过程回归测试
//
// 三件事：
//   ① 入库/出库序列是否可用，必须在真实数据上判对（夹具为线上真实序列）；
//   ② 判定通过时，页面里真正跑的 drawReservoirProcessChart 要画出水位 + 入库 + 出库三条线、
//      双纵轴（水位一套、入库出库共用一套），且抽稀到画布能承受的点数；
//   ③ 判定不通过时必须退回单线水位，且「净入库/净出库」只作为数字出现在监测数据卡里，
//      **不得**被画成第三条曲线（净入就是水位曲线的斜率，画上去是重复指标）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildReservoirProcess, decimate, MAX_CHART_POINTS } = require('../utils/reservoirProcess.js');

// 测试按注册顺序执行；绘制类用例是异步的（2d 迁移后取画布节点经 SelectorQuery），
// 因此统一收进队列、在文件末尾串行 await 跑完。
const testQueue = [];
function test(name, fn) {
  testQueue.push({ name, fn });
}

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pages/detail', 'detail.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'pages/detail', 'detail.wxml'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pages/detail', 'detail.wxss'), 'utf8');
const historyFunction = fs.readFileSync(path.join(root, 'cloudfunctions/getStationHistory/index.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'reservoir-process.json'), 'utf8'));

const rows = (code) => fixture.stations[code].rows;
const judge = (code) => buildReservoirProcess(rows(code));

// 用桩 canvas 记录真实绘制调用：验证页面里真正跑的绘制代码，而不是另写一份「应该怎么画」。
// canvas type="2d" 迁移后：上下文从节点 getContext('2d') 获得（经 SelectorQuery），
// 颜色/字体等改为属性赋值（记录为 set:strokeStyle 等），不再有旧 API 的 ctx.draw() 提交。
function runReservoirChart(config) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return (...args) => { calls.push({ prop: String(prop), args }); };
    },
    set(_target, prop, value) {
      calls.push({ prop: 'set:' + String(prop), args: [value] });
      return true;
    }
  });
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    createSelectorQuery: () => {
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
  const modulePath = require.resolve('../pages/detail/detail.js');
  delete require.cache[modulePath];
  require(modulePath);

  const data = Object.assign({
    chartData: rows('613K0912'),
    canvasWidth: 320,
    canvasHeight: 200,
    reservoirHasFlow: true
  }, config);
  const promise = pageDef.drawReservoirProcessChart.call({ data, setData: () => {} });
  return promise.then(() => calls);
}

const pick = (calls, prop) => calls.filter((call) => call.prop === prop);
const texts = (calls) => pick(calls, 'fillText').map((call) => String(call.args[0]));

/* ---------- ① 真实数据上的判定 ---------- */
test('云函数把蓄量/入库/出库三条序列一并带回（此前只取了水位）', () => {
  assert.match(historyFunction, /inflow: numOrNull\(row\.inq \?\? row\.INQ\)/, '缺少入库序列');
  assert.match(historyFunction, /outflow: numOrNull\(row\.otq \?\? row\.OTQ\)/, '缺少出库序列');
  assert.match(historyFunction, /volume: numOrNull\(row\.w \?\? row\.W\)/, '缺少蓄量序列');
  assert.match(historyFunction, /value: num\(row\.RZ \|\| row\.rz\)/, '单线降级路径的水位字段必须保留');
});

test('铜湾（169 个逐时点）：判为可画，并抽稀到画布承受的点数', () => {
  const result = judge('613K0912');
  assert.strictEqual(result.reason, 'ok');
  assert.strictEqual(result.hasFlow, true);
  assert.strictEqual(result.records.length, MAX_CHART_POINTS);
  const all = rows('613K0912');
  assert.strictEqual(result.records[0], all[0], '抽稀必须保留首点');
  assert.strictEqual(result.records[all.length - 1], undefined);
  assert.strictEqual(result.records[result.records.length - 1], all[all.length - 1], '抽稀必须保留末点');
});

test('五龙溪：入库/出库 7 天恒定不变，判为抄录值不画', () => {
  const result = judge('613K0907');
  assert.strictEqual(result.reason, 'constant');
  assert.strictEqual(result.hasFlow, false);
  assert.strictEqual(result.records.length, rows('613K0907').length, '判负时记录原样返回，供单线水位使用');
});

test('柏坡洞、白沙：流量与蓄量自相矛盾，判为不可信不画', () => {
  ['613K0919', '613K0901'].forEach((code) => {
    const result = judge(code);
    assert.strictEqual(result.reason, 'inconsistent', `${fixture.stations[code].name} 应与蓄量变化矛盾`);
    assert.strictEqual(result.hasFlow, false);
  });
});

test('三角滩：进出库有变化且水量平衡同号，判为可画', () => {
  assert.strictEqual(judge('613K0920').hasFlow, true);
});

test('点太少或没有蓄量序列时不得误判为有问题', () => {
  assert.strictEqual(buildReservoirProcess([]).reason, 'insufficient');
  assert.strictEqual(buildReservoirProcess(null).records.length, 0);
  // 只有两条记录不足以画过程
  assert.strictEqual(buildReservoirProcess(rows('613K0907').slice(0, 2)).reason, 'insufficient');
  // 没有蓄量列 → 跳过水量平衡核验，不因此判负
  const noVolume = rows('613K0912').map((item) => ({ date: item.date, timestamp: item.timestamp, inflow: item.inflow, outflow: item.outflow, waterLevel: item.waterLevel }));
  assert.strictEqual(buildReservoirProcess(noVolume).hasFlow, true);
});

test('抽稀只发生在点太多时，且保持原有顺序', () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ index: i }));
  const cut = decimate(list, 10);
  assert.strictEqual(cut.length, 10);
  assert.strictEqual(cut[0].index, 0);
  assert.strictEqual(cut[cut.length - 1].index, 99);
  assert.deepStrictEqual(cut.map((item) => item.index), cut.map((item) => item.index).slice().sort((a, b) => a - b));
  assert.strictEqual(decimate(list.slice(0, 10), 10).length, 10);
});

/* ---------- ② 绘制 ---------- */
test('三条线三种颜色同图，2d 迁移后以属性赋值设置颜色', async () => {
  const calls = await runReservoirChart();
  const colors = pick(calls, 'set:strokeStyle').map((call) => call.args[0]);
  ['#0e9bb8', '#0b4f8a', '#7a63c9'].forEach((color) => {
    assert.ok(colors.indexOf(color) >= 0, `缺少曲线颜色 ${color}`);
  });
  // 2d 模式没有 ctx.draw() 提交概念；末次调用应是横轴日期标签，说明完整画完
  assert.strictEqual(calls[calls.length - 1].prop, 'fillText', '最后一步应是横轴日期标签');
});

test('水位一套纵轴、入库与出库共用另一套：双轴而不是三轴', async () => {
  // 两条流量线必须传同一个 flowRange，否则就是各画一轴、不可比
  assert.match(source, /drawSeries\('inflow', flowRange, '#0b4f8a'\)/, '入库线应使用共用的流量轴');
  assert.match(source, /drawSeries\('outflow', flowRange, '#7a63c9'\)/, '出库线应使用共用的流量轴');
  const calls = await runReservoirChart();
  const labels = texts(calls);
  // 画布顶部只允许出现两个坐标轴名称
  const axisTitles = labels.filter((text) => /\(m\)|\(m³\/s\)/.test(text) && text.indexOf('/') < 0);
  assert.deepStrictEqual(axisTitles, ['水位 (m)'], '左侧只应有一套水位轴');
  assert.ok(labels.indexOf('入库 / 出库 (m³/s)') >= 0, '右侧应只有一套流量轴');
  // 刻度：左轴 5 个两位小数 + 右轴 5 个整数
  const decimals = labels.filter((text) => /^-?\d+\.\d{2}$/.test(text));
  const integers = labels.filter((text) => /^-?\d+$/.test(text));
  assert.strictEqual(decimals.length, 5, '水位轴应恰好 5 个刻度');
  assert.strictEqual(integers.length, 5, '流量轴应恰好 5 个刻度（铜湾流量上千，刻度不带小数）');
});

test('流量轴不得出现负刻度（入库/出库最小就是 0）', async () => {
  const calls = await runReservoirChart();
  const negatives = texts(calls).filter((text) => /^-\d+(\.\d+)?$/.test(text));
  assert.deepStrictEqual(negatives, [], '流量轴底部被留白压成了负数：' + negatives.join('/'));
});

test('蓄量按数量级取小数位，主指标带里不会把单位挤到下一行', () => {
  const pageDef2 = loadDetailPage();
  const big = pageDef2.processStationDisplay.call(pageDef2, { type: 'reservoir', currentLevel: 151.86, currentVolume: 11255, capacity: 12000 });
  assert.strictEqual(big.currentVolumeText, '11255', '五位数不应带小数');
  const mid = pageDef2.processStationDisplay.call(pageDef2, { type: 'reservoir', currentVolume: 520, capacity: 830 });
  assert.strictEqual(mid.currentVolumeText, '520.0', '三位数保留一位小数');
  const small = pageDef2.processStationDisplay.call(pageDef2, { type: 'reservoir', currentVolume: 12.3 });
  assert.strictEqual(small.currentVolumeText, '12.30', '两位数保留两位小数');
});

test('水量平衡不可用时一律不画流量线', async () => {
  assert.strictEqual((await runReservoirChart({ reservoirHasFlow: false })).length, 0, '判负时不得发起任何绘制');
  assert.strictEqual((await runReservoirChart({ chartData: [] })).length, 0);
  assert.strictEqual((await runReservoirChart({ chartData: rows('613K0907').map((item) => ({ date: item.date, waterLevel: item.waterLevel })) })).length, 0, '没有流量列时一次都不该画');
});

test('页面按判定结果路由：可画走过程图，否则退回单线水位', () => {
  assert.match(source, /buildReservoirProcess\(historyData\)/, '水库历史必须过一遍可用性判定');
  assert.match(source, /station\.type === 'reservoir' && this\.data\.reservoirHasFlow/, '缺少水库过程图路由分支');
  assert.match(source, /reservoirProcessTitle: process\.hasFlow \? '水库水文过程' : '水位趋势'/, '标题应随数据变化，101 座无流量水库保持原样');
});

test('模板：图例只在真有流量序列时出现，标题由数据决定', () => {
  const card = template.slice(template.indexOf('wx:if="{{station.type === \'reservoir\'}}"'));
  const reservoirCard = card.slice(0, card.indexOf('含水量趋势'));
  assert.match(reservoirCard, /\{\{reservoirProcessTitle\}\}/, '标题应取 reservoirProcessTitle');
  assert.ok(reservoirCard.indexOf('水位趋势') < 0, '模板里不得再写死「水位趋势」');
  // 逐项锁定：只给其中一个图例项加 wx:if，等于另一个无条件显示（正是这条假断言漏掉的情形）
  assert.match(reservoirCard, /class="process-legend-item" wx:if="\{\{reservoirHasFlow\}\}"><text class="process-legend-line inflow"/, '入库图例必须只在真有流量序列时显示');
  assert.match(reservoirCard, /class="process-legend-item" wx:if="\{\{reservoirHasFlow\}\}"><text class="process-legend-line outflow"/, '出库图例必须只在真有流量序列时显示');
  assert.match(css, /\.process-legend-line\.inflow\{background:#0b4f8a\}/, '入库图例色应与曲线一致');
  assert.match(css, /\.process-legend-line\.outflow\{background:#7a63c9\}/, '出库图例色应与曲线一致');
});

/* ---------- ③ 净入库只作为数字 ---------- */
test('净入库/净出库：只陈述两个数之差，且只在两个数都有时出现', () => {
  const station = { type: 'reservoir', currentLevel: 151.86, inflow: 302.43, outflow: 269.1 };
  const pageDef = loadDetailPage();
  const display = pageDef.processStationDisplay.call(pageDef, station);
  assert.strictEqual(display.hasNetFlow, true);
  assert.strictEqual(display.netFlowLabel, '净入库');
  assert.strictEqual(display.netFlowValue, '33.33');

  const lower = pageDef.processStationDisplay.call(pageDef, { type: 'reservoir', inflow: 1.2, outflow: 4.5 });
  assert.strictEqual(lower.netFlowLabel, '净出库');
  assert.strictEqual(lower.netFlowValue, '3.30');

  const equal = pageDef.processStationDisplay.call(pageDef, { type: 'reservoir', inflow: 2.5, outflow: 2.5 });
  assert.strictEqual(equal.netFlowLabel, '入库与出库持平');
  assert.strictEqual(equal.netFlowValue, '', '持平时不带数值');

  const onlyIn = pageDef.processStationDisplay.call(pageDef, { type: 'reservoir', inflow: 2.5 });
  assert.ok(!onlyIn.hasNetFlow, '只有一个数时不得给出差值');
});

test('净入库不得被画成第三条曲线，只能作为监测数据卡里的一行文字', () => {
  assert.doesNotMatch(source, /drawSeries\([^)]*net/i, '净入/净出不是一条曲线');
  assert.doesNotMatch(source, /reservoirProcessTitle[\s\S]{0,200}netFlow/, '净入不应进入过程图标题逻辑');
  const grid = template.slice(template.indexOf('<view class="realtime-grid">'));
  assert.ok(grid.indexOf('realtime-note') >= 0, '净差值行应排在指标栅格之后');
  assert.ok(grid.lastIndexOf('class="realtime-item') < grid.indexOf('class="realtime-note"'), '净差值行必须排在所有指标块之后，否则会混进栅格破坏两列布局');
  assert.match(css, /\.realtime-note\{[^}]*text-align:center/, '净差值行应居中');
});

var cachedPage = null;
function loadDetailPage() {
  if (cachedPage) return cachedPage;
  global.wx = { getSystemInfoSync: () => ({ windowWidth: 375 }) };
  global.getApp = () => ({ globalData: {} });
  let pageDef = null;
  global.Page = (options) => { pageDef = options; };
  const modulePath = require.resolve('../pages/detail/detail.js');
  delete require.cache[modulePath];
  require(modulePath);
  cachedPage = pageDef;
  return pageDef;
}

(async () => {
  for (const { name, fn } of testQueue) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      throw error;
    }
  }
  console.log('水库水文过程测试通过。');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
