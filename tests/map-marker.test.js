const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

test('水库站点使用品牌蓝水滴图标与水库标签', () => {
  const visual = buildMarkerVisual({ type: 'reservoir', status: 'normal' });
  assert.strictEqual(visual.iconPath, '/assets/map-markers/reservoir.png');
  assert.strictEqual(visual.callout.content, '💧 水库');
  assert.strictEqual(visual.callout.color, '#0b4f8a');
});

test('河道水位偏低站点使用青色图标与「水位偏低」标签（不表述为洪水预警）', () => {
  const visual = buildMarkerVisual({ type: 'river', status: 'warning' });
  assert.strictEqual(visual.iconPath, '/assets/map-markers/river.png');
  assert.strictEqual(visual.callout.content, '水位偏低');
  assert.strictEqual(visual.callout.color, '#d49a2a');
  assert.doesNotMatch(visual.callout.content, /预警/, '水位低于死水位属于供水不足，不得表述为洪水预警');
});

test('土壤干旱站点使用绿色叶片图标与干旱状态标签', () => {
  const visual = buildMarkerVisual({ type: 'soil', status: 'drought' });
  assert.strictEqual(visual.iconPath, '/assets/map-markers/soil.png');
  assert.strictEqual(visual.callout.content, '干旱');
  assert.strictEqual(visual.callout.color, '#d95f5f');
});

test('水库超汛限使用与图表警戒线一致的告警红', () => {
  const visual = buildMarkerVisual({ type: 'reservoir', status: 'danger' });
  assert.strictEqual(visual.callout.content, '超汛限', '水库的控制水位是汛限水位，不叫警戒水位');
  assert.strictEqual(visual.callout.color, '#d95f5f');
});

test('河道达到警戒水位仍表述为「超警戒」', () => {
  const visual = buildMarkerVisual({ type: 'river', status: 'danger' });
  assert.strictEqual(visual.callout.content, '超警戒');
  assert.strictEqual(visual.callout.color, '#d95f5f');
});

test('无监测数据时标注为「暂无数据」而不推断旱涝等级', () => {
  const visual = buildMarkerVisual({ type: 'soil', status: 'unknown' });
  assert.strictEqual(visual.callout.content, '暂无数据');
  assert.strictEqual(visual.callout.color, '#5e7f90');
});

test('未知类型回退为通用标记', () => {
  const visual = buildMarkerVisual({ type: 'unknown', status: 'normal' });
  assert.strictEqual(visual.iconPath, '/assets/map-markers/default.png');
  assert.strictEqual(visual.callout.content, '站点');
});

test('地图标注不得残留 antd 旧配色', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'mapMarker.js'), 'utf8');
  assert.doesNotMatch(source, /#1677ff|#08979c|#389e0d|#d48806|#d4380d|#fff7e6|#fff2e8|#e6f4ff/);
});

console.log('地图标记视觉配置测试通过。');
