const assert = require('assert');
const geo = require('../utils/geoLayer.js');
const radar = require('../utils/layerRadar.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const VIEW = geo.viewFor(271 / 250);
const HOST = 'https://tilecache.rainviewer.com';
// 2026-09-22 北京时间 18:40 = 10:40 UTC，用于校验时区无关的本地时间格式化
const T = 1790073600;
const meta = (n) => ({
  version: '2.0',
  host: HOST,
  radar: {
    past: Array.from({ length: n }, (_, i) => ({ time: T + (i - n + 1) * 600, path: '/v2/radar/' + (T + (i - n + 1) * 600) })),
    nowcast: [],
  },
  satellite: { infrared: [] },
});

test('帧列表按时间升序、末帧标记为最新，并带 HH:mm 本地时间标签', () => {
  const frames = radar.buildFrames(meta(12));
  assert.strictEqual(frames.length, 12);
  assert.strictEqual(frames[11].isLatest, true);
  assert.strictEqual(frames[0].isLatest, false);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].timeStamp > frames[i - 1].timeStamp, '帧时间必须严格递增');
  }
  const d = new Date(T * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  assert.strictEqual(frames[11].time, hh + ':' + String(d.getMinutes()).padStart(2, '0'), '时间标签应是设备本地时间的 HH:mm');
  assert.match(frames[0].time, /^\d{2}:\d{2}$/, '时间标签必须补零');
});

test('帧数量按上限截断（免费源只保留最近 12 帧）', () => {
  assert.strictEqual(radar.buildFrames(meta(30)).length, 12);
  assert.strictEqual(radar.buildFrames(meta(3)).length, 3);
});

test('元数据缺失或异常时安全降级为空列表', () => {
  assert.deepStrictEqual(radar.buildFrames(null), []);
  assert.deepStrictEqual(radar.buildFrames({}), []);
  assert.deepStrictEqual(radar.buildFrames({ radar: { past: null } }), []);
});

test('瓦片 URL 符合 RainViewer 规范', () => {
  const frames = radar.buildFrames(meta(12));
  const url = radar.tileUrl(HOST, frames[11], 7, 102, 53);
  assert.strictEqual(url, HOST + frames[11].path + '/256/7/102/53/4/1_1.png');
  assert.match(url, /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/\d+\/256\/7\/102\/53\/4\/1_1\.png$/);
});

test('瓦片规划：覆盖整个画布、层级不超上限、数量可控', () => {
  const frames = radar.buildFrames(meta(12));
  const plan = radar.planFrameTiles(HOST, frames[11], VIEW, { width: 271, height: 250 }, 542);
  assert.ok(plan.zoom <= geo.LAYER.MAX_ZOOM, '层级不得突破免费源上限');
  assert.strictEqual(plan.count, plan.tiles.length);
  assert.ok(plan.count <= 12, `单帧瓦片数应可控，实际 ${plan.count}`);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  plan.tiles.forEach((t) => {
    assert.match(t.url, /^https:\/\/tilecache\.rainviewer\.com\//, '瓦片地址必须指向 RainViewer');
    assert.ok(t.rect.width > 0 && t.rect.height > 0, '瓦片矩形必须有效');
    minX = Math.min(minX, t.rect.x); minY = Math.min(minY, t.rect.y);
    maxX = Math.max(maxX, t.rect.x + t.rect.width); maxY = Math.max(maxY, t.rect.y + t.rect.height);
  });
  assert.ok(minX <= 0.5 && minY <= 0.5, '瓦片必须覆盖画布左上角');
  assert.ok(maxX >= 270.5 && maxY >= 249.5, '瓦片必须覆盖画布右下角');
  const keys = new Set(plan.tiles.map((t) => t.key));
  assert.strictEqual(keys.size, plan.tiles.length, '同一帧内瓦片 key 不得重复');
});

test('瓦片 key 含时间戳，不同帧不会互相覆盖', () => {
  const a = radar.tileKey(1000, 7, 1, 2);
  const b = radar.tileKey(1600, 7, 1, 2);
  assert.notStrictEqual(a, b);
  assert.strictEqual(radar.tileKey(1000, 7, 1, 2), a);
});

test('LRU 缓存：超限淘汰最久未用，命中后刷新最近使用顺序', () => {
  const cache = radar.createCache(3);
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.strictEqual(cache.size(), 3);
  assert.strictEqual(cache.get('a'), 1, '应能命中');
  cache.set('d', 4);
  assert.strictEqual(cache.has('b'), false, 'b 最久未用应被淘汰');
  assert.strictEqual(cache.has('a'), true, 'a 因刚被访问过应保留');
  assert.deepStrictEqual(cache.keys().sort(), ['a', 'c', 'd']);
  assert.strictEqual(cache.get('nope'), undefined);
});

test('帧播放索引循环与边界钳制', () => {
  assert.strictEqual(radar.nextIndex(11, 12), 0, '末帧之后回到首帧');
  assert.strictEqual(radar.nextIndex(0, 12), 1);
  assert.strictEqual(radar.nextIndex(0, 0), 0, '空列表不得产生越界索引');
  assert.strictEqual(radar.clampIndex(99, 12), 11);
  assert.strictEqual(radar.clampIndex(-5, 12), 0);
  assert.strictEqual(radar.clampIndex(3, 0), 0);
});

console.log('雷达图层测试通过。');
