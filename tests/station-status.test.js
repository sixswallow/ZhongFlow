// C 批次回归：站点状态语义边界与「无数据」口径
// 覆盖三处曾引起误解的实现：
//   1. 水库「正常水位」被回退成「警戒水位」；
//   2. 河道「保证水位」被回退成「警戒水位」；
//   3. 墒情站无数据被判定为「干旱」，且状态文案把供水不足说成洪水「预警」。
const assert = require('assert');

const {
  STATUS_TEXT,
  RESERVOIR_STATUS_TEXT,
  SOIL_MOISTURE_THRESHOLDS,
  formatReservoirItem,
  formatRiverItem,
  formatSoilItem
} = require('../cloudfunctions/getStations/index.js');
const { getStationStatusText, STATION_STATUS_TEXT } = require('../utils/stationStatus.js');

/* ---------- 1. 状态文案：供水不足 ≠ 洪水预警 ---------- */
assert.strictEqual(STATUS_TEXT.warning, '水位偏低', 'warning 只用于水库低于死水位，应为「水位偏低」');
assert.doesNotMatch(STATUS_TEXT.warning, /预警/, '不得把供水不足表述为预警');
assert.strictEqual(getStationStatusText('warning'), '水位偏低');
assert.strictEqual(getStationStatusText('unknown'), '暂无数据');
// danger 的称谓按站点类型分：水库的控制水位是「汛限水位」，河道才是「警戒水位」
assert.strictEqual(getStationStatusText('danger', 'reservoir'), '超汛限');
assert.strictEqual(getStationStatusText('danger', 'river'), '超警戒');
assert.strictEqual(getStationStatusText('danger'), '超警戒', '未指明类型时保持河道口径');
assert.deepStrictEqual(
  Object.keys(STATUS_TEXT).sort(),
  Object.keys(STATION_STATUS_TEXT).sort(),
  '云函数与前端的状态词汇表必须一致'
);
for (const key of Object.keys(STATUS_TEXT)) {
  assert.strictEqual(STATION_STATUS_TEXT[key], STATUS_TEXT[key], `状态文案不一致: ${key}`);
}
assert.doesNotMatch(getStationStatusText('danger'), /预警/);

/* ---------- 2. 水库：正常蓄水位不得等于警戒水位 ---------- */
const noNormal = formatReservoirItem({ STCD: 'R1', STNM: '测试水库', RZ: 100, FSLTDZ: 105, DDZ: 90 });
assert.strictEqual(noNormal.normalLevel, null, '上游未提供 XXZ 时正常水位必须为空');
assert.notStrictEqual(noNormal.normalLevel, noNormal.warningLevel, '正常水位不得回退为警戒水位');
assert.strictEqual(noNormal.warningLevel, 105);
assert.strictEqual(noNormal.status, 'normal');

const withNormal = formatReservoirItem({ STCD: 'R2', STNM: '测试水库2', RZ: 100, FSLTDZ: 105, XXZ: 98 });
assert.strictEqual(withNormal.normalLevel, 98, '上游提供 XXZ 时应如实采用');

const belowDead = formatReservoirItem({ STCD: 'R3', STNM: '测试水库3', RZ: 88, DDZ: 90, FSLTDZ: 105 });
assert.strictEqual(belowDead.status, 'warning');
assert.strictEqual(belowDead.statusText, '水位偏低');

const overFlood = formatReservoirItem({ STCD: 'R4', STNM: '测试水库4', RZ: 110, FSLTDZ: 105, DDZ: 90 });
assert.strictEqual(overFlood.status, 'danger');
assert.strictEqual(overFlood.statusText, '超汛限', '水库的控制水位是汛限水位，不叫警戒水位');
assert.strictEqual(STATUS_TEXT.danger, '超警戒', '基础词汇表保持河道口径');
assert.strictEqual(RESERVOIR_STATUS_TEXT.danger, '超汛限', '水库口径单独一份');

/* ---------- 3. 河道：保证水位不得等于警戒水位 ---------- */
const noGuaranteed = formatRiverItem({ STCD: 'V1', STNM: '测试河道', Z: 50, HLZ: 52 });
assert.strictEqual(noGuaranteed.guaranteedLevel, null, '上游未提供 BZSWZ 时保证水位必须为空');
assert.notStrictEqual(noGuaranteed.guaranteedLevel, noGuaranteed.warningLevel, '保证水位不得回退为警戒水位');

const withGuaranteed = formatRiverItem({ STCD: 'V2', STNM: '测试河道2', Z: 50, HLZ: 52, BZSWZ: 54 });
assert.strictEqual(withGuaranteed.guaranteedLevel, 54);
assert.strictEqual(withGuaranteed.status, 'normal');

const riverDanger = formatRiverItem({ STCD: 'V3', STNM: '测试河道3', Z: 53, HLZ: 52 });
assert.strictEqual(riverDanger.status, 'danger');
assert.strictEqual(riverDanger.statusText, '超警戒', '河道达到警戒水位仍叫「超警戒」');

/* ---------- 4. 墒情：无数据不得判为干旱 ---------- */
const noData = formatSoilItem({ STCD: 'S0', STNM: '测试墒情站' });
assert.strictEqual(noData.status, 'unknown', '无任何含水量数据时不得推断旱情等级');
assert.strictEqual(noData.statusText, '暂无数据');
assert.strictEqual(noData.moisture, null, '无数据时含水量应为 null 而不是 0');

assert.strictEqual(formatSoilItem({ AVG: 70 }).status, 'wet');
assert.strictEqual(formatSoilItem({ AVG: 45 }).status, 'normal');
assert.strictEqual(formatSoilItem({ AVG: 25 }).status, 'dry');
assert.strictEqual(formatSoilItem({ AVG: 10 }).status, 'drought');

// 阈值边界：固定阈值应集中为具名常量，便于核对与后续替换
assert.deepStrictEqual(SOIL_MOISTURE_THRESHOLDS, { wet: 60, normal: 40, dry: 20 });
assert.strictEqual(formatSoilItem({ AVG: 60 }).status, 'wet');
assert.strictEqual(formatSoilItem({ AVG: 59.9 }).status, 'normal');
assert.strictEqual(formatSoilItem({ AVG: 40 }).status, 'normal');
assert.strictEqual(formatSoilItem({ AVG: 20 }).status, 'dry');

// 平均值缺失时应回退到分层数据
assert.strictEqual(formatSoilItem({ SLM10: 30 }).status, 'dry');
assert.strictEqual(formatSoilItem({ SLM20: 70 }).status, 'wet');

/* ---------- 5. 死代码不得回流 ---------- */
const fs = require('fs');
const path = require('path');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'api.js'), 'utf8');
assert.doesNotMatch(apiSource, /getWarningList/, '未被调用的预警列表接口应已移除');
const rainfallSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'rainfall', 'rainfall.js'), 'utf8');
assert.strictEqual(
  (rainfallSource.match(/WEATHER_ICON_MAP\s*=\s*\{/g) || []).length,
  1,
  '天气图标映射应只有一份定义'
);

console.log('站点状态语义与数据口径测试通过。');
