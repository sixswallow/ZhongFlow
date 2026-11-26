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

test('上游未返回土壤类型和默认监测层时不展示元数据卡片', () => {
  const display = buildSoilDisplay({ moisture: 20, averageMoisture: 20 });
  assert.strictEqual(display.showDepth, false);
  assert.strictEqual(display.showSoilType, false);
});

test('上游明确返回土壤类型和默认监测层时才展示元数据卡片', () => {
  const display = buildSoilDisplay({
    moisture: 20,
    averageMoisture: 20,
    depth: '10cm',
    soilType: '红壤'
  });
  assert.strictEqual(display.showDepth, true);
  assert.strictEqual(display.showSoilType, true);
  assert.strictEqual(display.depthText, '10cm');
  assert.strictEqual(display.soilTypeText, '红壤');
});

console.log('土壤元数据展示测试通过。');
