const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getTownshipOptions, resolveTownshipLocation, ZHONGFANG_CENTER } = require('../utils/locationOptions.js');
const { getTownshipBoundary } = require('../utils/townshipBoundaries.js');
const locationOptions = getTownshipOptions();

const buildPickerState = (location) => ({
  options: locationOptions,
  index: Math.max(0, locationOptions.indexOf(location.city === '中方县' ? '中方县（全县）' : location.city))
});

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('提供中方县及12个乡镇的手动选择项', () => {
  const options = getTownshipOptions();
  assert.strictEqual(options.length, 13);
  assert.strictEqual(options[0], '中方县（全县）');
  assert.ok(options.includes('中方镇'));
  assert.ok(options.includes('蒿吉坪瑶族乡'));
});

test('按名称返回聚合行政区边界计算的中心坐标', () => {
  const location = resolveTownshipLocation('中方镇');
  const boundary = getTownshipBoundary('中方镇');
  assert.deepStrictEqual(location, {
    city: '中方镇',
    latitude: boundary.center.latitude,
    longitude: boundary.center.longitude
  });
});

test('未知名称安全回退到天地图县级边界计算的中方县中心', () => {
  const location = resolveTownshipLocation('不存在的地区');
  assert.deepStrictEqual(location, ZHONGFANG_CENTER);
});

test('picker 可将默认中方县映射为全县选项', () => {
  const picker = buildPickerState({ city: '中方县' });
  assert.strictEqual(picker.options[picker.index], '中方县（全县）');
});

test('picker 可将已选择的乡镇映射为对应选项', () => {
  const picker = buildPickerState({ city: '蒿吉坪瑶族乡' });
  assert.strictEqual(picker.options[picker.index], '蒿吉坪瑶族乡');
});

test('地区选择使用 picker，避免原生操作菜单超过上限导致无响应', () => {
  const root = path.resolve(__dirname, '..');
  ['pages/index/index.wxml', 'pages/rainfall/rainfall.wxml', 'pages/map/map.wxml'].forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(source.includes('<picker'), `${file} 缺少 picker`);
  });
  ['pages/index/index.js', 'pages/rainfall/rainfall.js', 'pages/map/map.js'].forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.strictEqual(source.includes('wx.showActionSheet'), false, `${file} 仍使用 showActionSheet`);
  });
});

console.log('手动行政区位置选择测试通过。');
