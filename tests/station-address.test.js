const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeAddress, getStationAddress } = require('../cloudfunctions/getStations/index.js');

assert.strictEqual(getStationAddress('613H0938', '怀化市中方县接龙镇��溪村部'), '怀化市中方县接龙镇龙溪村部');
assert.strictEqual(normalizeAddress('怀化市中方县花桥镇花桥村'), '怀化市中方县花桥镇花桥村');
assert.strictEqual(normalizeAddress(''), '中方县');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'getStations', 'index.js'), 'utf8');
assert.match(source, /ADDRESS_CORRECTIONS/, '站点云函数应维护经核验的地址纠错映射');
assert.match(source, /return normalizeAddress\(ADDRESS_CORRECTIONS\[stationId\] \|\| address\)/, '地址纠错应在标准化前按站号应用');

console.log('站点地址纠错测试通过。');
