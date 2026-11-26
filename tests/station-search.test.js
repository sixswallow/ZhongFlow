const assert = require('assert');
const { filterStations } = require('../utils/stationSearch');

const stations = [
  { id: 'r1', name: '花桥', address: '怀化市中方县花桥镇花桥村' },
  { id: 'r2', name: '白牛铺', address: '怀化市中方县花桥镇火马塘村白牛铺' },
  { id: 's1', name: '石宝', address: '怀化市中方县新路河镇鱼龙桥村六组' },
  { id: 's2', name: '蒿吉坪', address: '怀化市中方县蒿吉坪瑶族乡中方县蒿吉坪民族学校' },
  { id: 'x1', name: '花桥水库', address: '怀化市中方县中方镇' }
];

assert.deepStrictEqual(filterStations(stations, '花桥镇').map((item) => item.id), ['r1', 'r2']);
assert.deepStrictEqual(filterStations(stations, '花桥').map((item) => item.id), ['r1', 'r2', 'x1']);
assert.deepStrictEqual(filterStations(stations, '新路河镇').map((item) => item.id), ['s1']);
assert.deepStrictEqual(filterStations(stations, '蒿吉坪瑶族乡').map((item) => item.id), ['s2']);
assert.deepStrictEqual(filterStations(stations, '白牛铺').map((item) => item.id), ['r2']);
assert.strictEqual(filterStations(stations, '  ').length, stations.length);

console.log('站点乡镇与名称搜索测试通过。');
