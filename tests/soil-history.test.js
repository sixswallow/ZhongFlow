const assert = require('assert');
const { formatSoilHistoryRow } = require('../utils/soilHistory.js');
const { buildSoilTrendOptions } = require('../utils/soilTrend.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('土壤时序保留平均值、三层含水量和相对含水率', () => {
  const item = formatSoilHistoryRow({
    TM: '2026-08-10T12:00:00.000Z',
    AVG: '21.4',
    SLM10: 16.9,
    SLM20: 24.6,
    SLM40: 22.6,
    XDSD: '82.24'
  });
  assert.strictEqual(item.averageMoisture, 21.4);
  assert.strictEqual(item.moisture10, 16.9);
  assert.strictEqual(item.moisture20, 24.6);
  assert.strictEqual(item.moisture40, 22.6);
  assert.strictEqual(item.relativeMoisture, 82.24);
  assert.strictEqual(item.value, 21.4);
});

test('趋势选项收敛为「整体 / 分层」两个视角，不再让每层各占一项', () => {
  const options = buildSoilTrendOptions([
    { averageMoisture: 20, moisture10: 15, moisture20: 22, moisture40: 21, relativeMoisture: 78 },
    { averageMoisture: 21, moisture10: 16, moisture20: 23, moisture40: 22, relativeMoisture: 80 }
  ]);
  assert.deepStrictEqual(options.map((item) => item.key), ['averageMoisture', 'layers']);
  assert.strictEqual(options[0].label, '平均含水量');
  assert.strictEqual(options[0].unit, '%');
  assert.strictEqual(options[1].label, '分层含水量');
  assert.strictEqual(options[1].unit, '%');
  // 分层视角把三层收进一组曲线，共用一套纵轴（同为 %，同轴才可比）
  assert.deepStrictEqual(options[1].series.map((layer) => layer.key), ['moisture10', 'moisture20', 'moisture40']);
  assert.deepStrictEqual(options[1].series.map((layer) => layer.label), ['10cm', '20cm', '40cm']);
  // 相对含水率是含水量的线性换算（除以该站土壤常数），曲线同形、只是刻度不同，不再单列
  assert.ok(!options.some((item) => item.key === 'relativeMoisture'), '相对含水率不应再作为常规趋势项');
  assert.ok(!options.some((item) => item.key === 'moisture10'), '10cm 不应再单独占一个趋势项');
});

test('只有分层数据时给出分层视角，绝不凭空标注不存在的指标', () => {
  const options = buildSoilTrendOptions([{ moisture10: 12 }]);
  assert.deepStrictEqual(options.map((item) => item.key), ['layers']);
  assert.strictEqual(options[0].label, '分层含水量');
});

test('上游只回相对含水率时兜底提供该视角，趋势卡不空转', () => {
  const options = buildSoilTrendOptions([{ relativeMoisture: 78 }, { relativeMoisture: 74 }]);
  assert.deepStrictEqual(options.map((item) => item.key), ['relativeMoisture']);
  assert.strictEqual(options[0].label, '相对含水率');
  assert.strictEqual(options[0].unit, '%');
});

test('完全没有含水量数据时不产生任何趋势项', () => {
  assert.deepStrictEqual(buildSoilTrendOptions([{ date: '8/10' }]), []);
  assert.deepStrictEqual(buildSoilTrendOptions([]), []);
});

console.log('土壤时序与趋势视角测试通过。');
