// 站点列表缓存回归测试
// 历史缺陷：列表请求在 stationCache 内部 try/catch 后返回 []，
// 这份「请求失败的空数组」会被缓存当作有效数据存满整个 TTL（默认 5 分钟），
// 于是上游抖一次，站点列表与详情页会同时空掉，而且不会自动恢复。
const assert = require('assert');

const STATIONS = [
  { id: 'R1', name: '测试水库', type: 'reservoir', status: 'normal', statusText: '正常', currentLevel: 100 }
];

let mode = 'fail';
let requests = 0;

global.wx = {
  request: (opt) => {
    requests++;
    if (mode === 'fail') {
      opt.fail && opt.fail(new Error('network down'));
      return;
    }
    opt.success && opt.success({ statusCode: 200, data: { list: STATIONS } });
  }
};

const api = require('../utils/api.js');

(async () => {
  // 1. 端点抖动：对外行为不变，仍是空数组
  mode = 'fail';
  const failed = await api.getStations('reservoir');
  assert.deepStrictEqual(failed, [], '请求失败时对外仍应返回空数组');

  // 2. 端点恢复：不带 forceRefresh 也必须立刻拿到真实数据（修复前这里会命中缓存的空数组）
  mode = 'ok';
  const recovered = await api.getStations('reservoir');
  assert.strictEqual(recovered.length, 1, '失败不得污染缓存：恢复后应立即拿到真实站点列表');
  assert.strictEqual(recovered[0].id, 'R1');

  // 3. 详情页同样自愈
  const detail = await api.getStationDetail('R1');
  assert.ok(detail && detail.id === 'R1', '详情页应能在端点恢复后找到站点');

  // 4. 成功结果仍应被缓存，避免每次进入列表都重复请求
  const before = requests;
  const cached = await api.getStations('reservoir');
  assert.strictEqual(cached.length, 1);
  assert.strictEqual(requests, before, '成功结果应命中缓存，不再发起请求');

  console.log('站点列表缓存不被失败污染测试通过。');
})().catch((e) => {
  console.error('✗ 站点列表缓存测试失败');
  console.error(e && e.message);
  process.exit(1);
});
