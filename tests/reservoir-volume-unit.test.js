// 水库蓄量单位与容量口径回归测试
//
// 背景：上游水库接口的蓄量 W 与相应库容 FSLTDW 的量纲是 10^6 m³，
// 而界面一直按「万m³」显示，两者差 100 倍；数字对不上标签，等于显示错值。
// 本测试锁定：① 云函数做且只做一次 ×100 换算；② 换算不改变任何比值；
//            ③ 界面上这四个位置继续按「万m³」标注，不许把标签改回去；
//            ④ 该字段不是「总库容」——见文件末尾的口径说明。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
const stationsFunction = fs.readFileSync(path.join(root, 'cloudfunctions/getStations/index.js'), 'utf8');
const detailTemplate = fs.readFileSync(path.join(root, 'pages/detail/detail.wxml'), 'utf8');
const listTemplate = fs.readFileSync(path.join(root, 'pages/list/list.wxml'), 'utf8');
const mapTemplate = fs.readFileSync(path.join(root, 'pages/map/map.wxml'), 'utf8');
const { formatReservoirItem, RESERVOIR_VOLUME_SCALE, toWanCubicMeters } = require('../cloudfunctions/getStations/index.js');

// 线上真实原始记录（2026-09-26 取自 /newapi/api/v1/ysq/rsvr/list）
const TONGWAN_RAW = {
  STCD: '613K0912', STNM: '铜湾', RZ: 151.86, W: 112.55, INQ: 302.43, OTQ: 269.1,
  FSLTDZ: 152.5, FSLTDW: 120, LTTD: 27.5, LGTD: 110.1
};
const WULONGXI_RAW = { STCD: '613K0907', STNM: '五龙溪', RZ: 266.75, W: 5.2, INQ: 0.341, OTQ: 0.92, FSLTDZ: 274, FSLTDW: 8.3 };

test('换算常量是 100（10^6 m³ → 万m³），且注释里留了核算依据', () => {
  assert.strictEqual(RESERVOIR_VOLUME_SCALE, 100);
  assert.match(stationsFunction, /RESERVOIR_VOLUME_SCALE = 100/, '换算常量应是一个可直接找到的命名常量');
  assert.match(stationsFunction, /10\^6 m³/, '缺少蓄量量纲说明');
  assert.match(stationsFunction, /水量平衡/, '缺少反推量纲的方法说明，后人无法复核');
  // 三个站的反推结果都写进注释，便于与数据源核对
  ['1,035,627', '833,760', '664,615'].forEach((value) => {
    assert.ok(stationsFunction.indexOf(value) >= 0, `注释缺少 ${value} 这一反推结果`);
  });
});

test('当前库容与相应库容都换算到万m³（铜湾 112.55 → 11255 万m³）', () => {
  const station = formatReservoirItem(TONGWAN_RAW);
  assert.strictEqual(station.currentVolume, 11255, '当前库容应为 11255 万m³');
  assert.strictEqual(station.capacity, 12000, '相应库容应为 12000 万m³');
  const small = formatReservoirItem(WULONGXI_RAW);
  assert.strictEqual(small.currentVolume, 520, '五龙溪当前库容应为 520 万m³');
  assert.strictEqual(small.capacity, 830, '五龙溪相应库容应为 830 万m³');
});

test('换算不改变任何比值（「占…%」与换算前一致）', () => {
  const station = formatReservoirItem(TONGWAN_RAW);
  const after = (station.currentVolume / station.capacity * 100).toFixed(1);
  const before = (TONGWAN_RAW.W / TONGWAN_RAW.FSLTDW * 100).toFixed(1);
  assert.strictEqual(after, before);
  assert.strictEqual(after, '93.8');
});

test('流量字段不参与换算，单位仍是 m³/s', () => {
  const station = formatReservoirItem(TONGWAN_RAW);
  assert.strictEqual(station.inflow, 302.43);
  assert.strictEqual(station.outflow, 269.1);
  assert.match(detailTemplate, /display\.inflowText}}<text class="realtime-unit">m³\/s</, '入库流量单位应为 m³/s');
});

test('缺失蓄量保持 null，不伪造 0 值', () => {
  const station = formatReservoirItem({ STCD: '613X0001', STNM: '只有水位', RZ: 320.37 });
  assert.strictEqual(station.currentVolume, null);
  assert.strictEqual(station.capacity, null);
  assert.strictEqual(toWanCubicMeters(0), 0);
});

test('浮点尾数不得写进响应（112.55 × 100 必须是整数）', () => {
  assert.strictEqual(toWanCubicMeters(112.55), 11255);
  assert.strictEqual(toWanCubicMeters(0.63), 63);
  assert.strictEqual(toWanCubicMeters(8.3), 830);
  assert.strictEqual(toWanCubicMeters(29.42), 2942);
});

test('界面上四个库容位置仍按「万m³」标注（数字与标签必须同一口径）', () => {
  assert.match(detailTemplate, /display\.currentVolumeText}}<text class="realtime-unit">万m³<\/text>/, '详情页当前库容应标万m³');
  assert.match(detailTemplate, /\{\{station\.capacity\}\} 万m³/, '详情页站点信息容量应标万m³');
  assert.match(listTemplate, /\{\{item\.currentVolume\}\}万m³/, '列表页库容应标万m³');
  assert.match(mapTemplate, /data-unit">万m³<\/text>/, '地图页库容应标万m³');
});

test('该字段的界面口径是「汛限水位库容」，不再是「总库容」', () => {
  // 反推证据：铜湾 FSLTDW − W = 120 − 112.55 = 7.45，水位差 FSLTDZ − RZ = 0.64 m，
  // 由该站 169 个逐时点算出的真实水面面积 A = Δ蓄量/Δ水位 = 11.63 km²，
  // 而 7.45 / 0.64 = 11.64 —— 与 A 吻合到三位有效数字，说明它不是「总库容」，
  // 而是「汛限（防洪限制）水位相应库容」。
  assert.match(detailTemplate, /汛限水位库容/, '容量字段应标为汛限水位库容');
  assert.doesNotMatch(detailTemplate, /总库容/, '「总库容」与字段口径不符，不应再出现');
  // 占位口径同步
  const percentNote = detailTemplate.split('\n').find((line) => line.indexOf('volumePercent') >= 0);
  assert.ok(percentNote, '找不到库容占比说明行');
  assert.match(percentNote, /占汛限水位库容/, '占比说明应写清分母是什么');
});

console.log('水库蓄量单位与容量口径测试通过。');
