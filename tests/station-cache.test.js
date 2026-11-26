const assert = require('assert');
const { createStationCache } = require('../utils/stationCache.js');

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✓ ${name}`));
}

(async () => {
  let now = 1000;
  let callCount = 0;
  const cache = createStationCache({ ttl: 300000, now: () => now });
  const fetchStations = async () => {
    callCount += 1;
    return [{ id: `S-${callCount}` }];
  };

  await test('缓存有效期内重复读取只请求一次', async () => {
    assert.deepStrictEqual(await cache.get('reservoir', fetchStations), [{ id: 'S-1' }]);
    assert.deepStrictEqual(await cache.get('reservoir', fetchStations), [{ id: 'S-1' }]);
    assert.strictEqual(callCount, 1);
  });

  await test('同一类型的并发读取合并为一次请求', async () => {
    cache.clear();
    callCount = 0;
    let resolveRequest;
    const pendingRequest = new Promise((resolve) => { resolveRequest = resolve; });
    const fetchPending = () => {
      callCount += 1;
      return pendingRequest;
    };
    const first = cache.get('river', fetchPending);
    const second = cache.get('river', fetchPending);
    resolveRequest([{ id: 'R-1' }]);
    assert.deepStrictEqual(await Promise.all([first, second]), [[{ id: 'R-1' }], [{ id: 'R-1' }]]);
    assert.strictEqual(callCount, 1);
  });

  await test('缓存过期后重新请求', async () => {
    cache.clear();
    callCount = 0;
    await cache.get('soil', fetchStations);
    now += 300001;
    assert.deepStrictEqual(await cache.get('soil', fetchStations), [{ id: 'S-2' }]);
    assert.strictEqual(callCount, 2);
  });

  await test('强制刷新绕过缓存并更新缓存结果', async () => {
    cache.clear();
    callCount = 0;
    await cache.get('reservoir', fetchStations);
    assert.deepStrictEqual(await cache.get('reservoir', fetchStations, { forceRefresh: true }), [{ id: 'S-2' }]);
    assert.deepStrictEqual(await cache.get('reservoir', fetchStations), [{ id: 'S-2' }]);
    assert.strictEqual(callCount, 2);
  });

  console.log('站点缓存测试通过。');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
