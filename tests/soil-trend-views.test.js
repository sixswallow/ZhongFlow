const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSoilTrendOptions } = require('../utils/soilTrend.js');

// 测试按注册顺序执行；绘制类用例是异步的（2d 迁移后取画布节点经 SelectorQuery），
// 因此统一收进队列、在文件末尾串行 await 跑完。
const testQueue = [];
function test(name, fn) {
  testQueue.push({ name, fn });
}

const root = path.join(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'pages/detail', 'detail.wxml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'pages/detail', 'detail.js'), 'utf8');

// 用桩 canvas 记录真实绘制调用：验证的是页面里真正跑的那段绘制代码，
// 而不是测试里另写一份「应该怎么画」。
// canvas type="2d" 迁移后：上下文从节点 getContext('2d') 获得（经 SelectorQuery），
// 颜色等改为属性赋值（记录为 set:fillStyle 等），不再有旧 API 的 ctx.draw() 提交。
function runLayersChart(chartData) {
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

  const data = {
    chartData,
    canvasWidth: 320,
    canvasHeight: 200,
    soilTrendOptions: buildSoilTrendOptions(chartData),
    activeSoilTrend: 'layers'
  };
  const promise = pageDef.drawSoilLayersChart.call({ data, setData: () => {} });
  return promise.then(() => calls);
}

const pick = (calls, prop) => calls.filter((call) => call.prop === prop);
const layerRecords = () => ([
  { date: '8/10', moisture10: 16.9, moisture20: 24.6, moisture40: 22.6 },
  { date: '8/11', moisture10: 16.2, moisture20: 24.1, moisture40: 22.4 },
  { date: '8/12', moisture10: 17.8, moisture20: 25.0, moisture40: 22.9 },
  { date: '8/13', moisture10: 18.4, moisture20: 25.4, moisture40: 23.1 },
  { date: '8/14', moisture10: 17.1, moisture20: 24.8, moisture40: 22.7 },
  { date: '8/15', moisture10: 15.6, moisture20: 23.9, moisture40: 22.2 },
  { date: '8/16', moisture10: 15.2, moisture20: 23.5, moisture40: 21.9 }
]);

test('趋势 chip 用全称渲染，不再依赖深度简称', () => {
  const chipLine = wxml.split('\n').find((line) => line.indexOf('soil-trend-tab') >= 0 && line.indexOf('wx:for') >= 0);
  assert.ok(chipLine, '找不到趋势 chip 的渲染行');
  assert.match(chipLine, /\{\{item\.label\}\}/, 'chip 应渲染 item.label');
  assert.ok(chipLine.indexOf('item.short') < 0, '不再需要 depth 简称字段');
});

test('分层由数据驱动，模板里不得写死某一层', () => {
  assert.ok(wxml.indexOf('data-key="moisture') < 0, '模板不应写死 10/20/40cm 的 key');
});

test('detail.js 有分层多线绘制路径，且由 activeSoilTrend === layers 路由', () => {
  assert.match(source, /drawSoilLayersChart\s*\(\)\s*\{/, '缺少 drawSoilLayersChart');
  assert.match(source, /activeSoilTrend === 'layers'/, '缺少分层视角的路由分支');
  assert.match(source, /const series = option\.series\.filter\(/, '分层的曲线组应来自 option.series');
});

test('三层同图：三种颜色各画一条曲线，图例只列真有数据的层', async () => {
  const calls = await runLayersChart(layerRecords());
  const colors = pick(calls, 'set:strokeStyle').map((call) => call.args[0]);
  ['#1f8fc4', '#12a5ac', '#7a63c9'].forEach((color) => {
    assert.ok(colors.indexOf(color) >= 0, `缺少分层颜色 ${color}`);
  });
  const labels = pick(calls, 'fillText').map((call) => call.args[0]);
  ['10cm', '20cm', '40cm'].forEach((label) => {
    assert.ok(labels.indexOf(label) >= 0, `图例缺少 ${label}`);
  });
  // 7 条记录、<=12 点，每条曲线每个点画「白底 + 色点」两个圆
  assert.strictEqual(pick(calls, 'arc').length, 3 * 7 * 2, '三条曲线应各画出 7 个数据点');
  // 2d 模式没有 ctx.draw() 提交概念；末次调用应是最后一个数据点的填色
  assert.strictEqual(calls[calls.length - 1].prop, 'fill', '最后一步应是数据点填色');
});

test('三层共用一套纵轴：刻度标签恰好 5 个，不做双轴', async () => {
  const calls = await runLayersChart(layerRecords());
  const numeric = pick(calls, 'fillText')
    .map((call) => call.args[0])
    .filter((text) => /^-?\d+\.\d+$/.test(String(text)));
  assert.strictEqual(numeric.length, 5, `纵轴刻度应只有 5 个，实际 ${numeric.length} 个`);
});

test('只有一层有数据时，图例与曲线都只出现这一层', async () => {
  const calls = await runLayersChart([
    { date: '8/10', moisture10: 16.9 },
    { date: '8/11', moisture10: 16.2 }
  ]);
  const labels = pick(calls, 'fillText').map((call) => call.args[0]);
  assert.ok(labels.indexOf('10cm') >= 0, '应图例列出 10cm');
  assert.ok(labels.indexOf('20cm') < 0, '没有数据的层不得出现在图例里');
  assert.ok(labels.indexOf('40cm') < 0, '没有数据的层不得出现在图例里');
  assert.strictEqual(pick(calls, 'arc').length, 1 * 2 * 2, '只应画出这一层的两个数据点');
});

test('完全没有分层数据时一次绘制调用都不发', async () => {
  assert.strictEqual((await runLayersChart([{ date: '8/10' }])).length, 0);
  assert.strictEqual((await runLayersChart([])).length, 0);
});

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
  console.log('土壤趋势视角测试通过。');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
