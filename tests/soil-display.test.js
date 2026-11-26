const assert = require('assert');
const { buildSoilDisplay } = require('../utils/soilDisplay.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('完整土壤站按深度、平均值和旱情指标分别组织展示', () => {
  const display = buildSoilDisplay({
    moisture: 18.2,
    moisture10: 16.8,
    moisture20: 18.1,
    moisture40: 19.7,
    averageMoisture: 18.2,
    saturatedMoisture: 26.02,
    relativeMoisture: 58.8,
    temperature: 24.5
  });
  assert.strictEqual(display.averageMoistureText, '18.2');
  assert.strictEqual(display.averageMoistureLabel, '平均土壤含水量');
  assert.strictEqual(display.moisture10Text, '16.8');
  assert.strictEqual(display.moisture20Text, '18.1');
  assert.strictEqual(display.moisture40Text, '19.7');
  assert.strictEqual(display.saturatedMoistureText, '26.0');
  assert.strictEqual(display.relativeMoistureText, '58.8');
  assert.strictEqual(display.showDepthMoistures, true);
  assert.strictEqual(display.showDroughtIndicators, true);
});

test('仅接收到平均墒情的站点只显示可用指标', () => {
  const display = buildSoilDisplay({ moisture: 23.4, averageMoisture: 23.4 });
  assert.strictEqual(display.showAverageMoisture, true);
  assert.strictEqual(display.showDepthMoistures, false);
  assert.strictEqual(display.showDroughtIndicators, false);
  assert.strictEqual(display.averageMoistureText, '23.4');
});

test('0 和空值不会被误当作有效层次数据', () => {
  const display = buildSoilDisplay({ moisture: 0, moisture10: 0, relativeMoisture: null });
  assert.strictEqual(display.showAverageMoisture, false);
  assert.strictEqual(display.showMoisture10, false);
  assert.strictEqual(display.showDroughtIndicators, false);
});

console.log('土壤墒情展示模型测试通过。');
