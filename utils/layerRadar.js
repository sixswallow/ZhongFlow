// 雷达回波图层（RainViewer 免费接口）
//
// 实测结论（2026-09-22）：
//  · radar.past 只给「过去约 2 小时、每 10 分钟一帧」共 12 帧；radar.nowcast 恒为空数组
//    → 免费源没有「未来帧」，时间轴只能做「过去 → 现在」，不能像彩云那样预报演进。
//  · 瓦片在 z≥8 恒定返回空图（恒为 1370 字节），z≤7 才有回波（约 1.2km/像素）。
//    层级上限由 geoLayer.LAYER.MAX_ZOOM = 7 兜底；配合 200km 视窗 + 2 倍屏仅放大 1.3 倍。
//  · 若后续切彩云「雷达图 / 预报雷达图」（企业套餐），只需替换本文件的取帧与取图实现。
//
// 本模块只做纯计算（可被 Node 测试直接 require）：帧列表、瓦片 URL、瓦片规划、LRU 缓存。
// 网络与 canvas 由页面负责，便于在真机上控制并发与缓存。

const geo = require('./geoLayer.js');
const geoDatum = require('./geoDatum.js');

const RADAR = {
  META_URL: 'https://api.rainviewer.com/public/weather-maps.json',
  // 4 = The Weather Channel（绿→黄→红 经典气象雷达配色）。
  // 曾用 2 = Universal Blue：蓝青色调与青黛底图、河道颜色互相干扰，用户反馈不直观，已弃用。
  COLOR_SCHEME: 4,
  SMOOTH: 1,
  SNOW: 1,
  MAX_FRAMES: 12,
  TILE_SIZE: 256,
  // 数据源实测分辨率（2026-09-28 复核）：z7 在中方县纬度是 1.079 km/像素（≈1.08km）。
  // 界面上的「回波 1 km/格」一律读这里，不许在模板里另写一个数字。
  SOURCE_KM_PER_PX: 1.08,
  // 瓦片末尾的 options：{平滑}_{雪}。
  // 拉到 3 倍以上改用「不插值」，让 1km 的格子保持清晰，而不是糊成一片。
  SMOOTH_OPTIONS: '1_1',
  SHARP_OPTIONS: '0_1',
  SHARP_UPSCALE: 3,
  // 只有把 1km 格子拉到这么大（≈视野 12km 以内）才值得提「更细是插值」，
  // 乡镇级（1 格 15~40px）说这句是噪音：上面的像素数已经说清楚了。
  INTERP_NOTE_PX: 60,
  // 四档图例：与数据源调色板（COLOR_SCHEME = 4 The Weather Channel，绿→黄→红）一致，
  // 也必须与气象页 pages/rainfall/rainfall.wxss 的 .legend-dot.lv-* 一致
  // —— 两处同步由 tests/map-radar-offset.test.js 锁住。
  LEGEND: [
    { level: 1, label: '弱', color: '#8ccf6f' },
    { level: 2, label: '中', color: '#f7d549' },
    { level: 3, label: '强', color: '#f2873c' },
    { level: 4, label: '特强', color: '#d93b3b' },
  ],
};

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

// 北京时间 HH:mm：显式按 UTC+8 计算，不依赖设备时区，
// 这样界面才敢如实标注「北京时间」。
const timeCst = (sec) => {
  const d = new Date((sec + 8 * 3600) * 1000);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
};

// 这一帧回波距今几分钟：免费档只有历史帧，界面必须能说「约 N 分钟前」而不是「实况」
const frameAgeMinutes = (timeStamp, nowSec) => {
  const now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
  return Math.max(0, Math.round((now - timeStamp) / 60));
};

// meta → 播放帧列表（按时间升序，末帧为最新）
const buildFrames = (meta, maxFrames) => {
  const limit = maxFrames || RADAR.MAX_FRAMES;
  const past = ((meta && meta.radar && meta.radar.past) || []).slice(-limit);
  return past.map((f, i) => {
    const d = new Date(f.time * 1000);
    return {
      index: i,
      timeStamp: f.time,
      time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
      timeCst: timeCst(f.time),
      path: f.path,
      isLatest: i === past.length - 1,
    };
  });
};

const tileUrl = (host, frame, zoom, x, y, options) =>
  host + frame.path + '/' + RADAR.TILE_SIZE + '/' + zoom + '/' + x + '/' + y + '/' +
  RADAR.COLOR_SCHEME + '/' + (options || RADAR.SMOOTH_OPTIONS) + '.png';

// 放大倍数 → 是否插值：>= SHARP_UPSCALE 倍就用不插值（乡镇级视野下就是这种情况）
const optionsForUpscale = (upscale) =>
  (typeof upscale === 'number' && upscale >= RADAR.SHARP_UPSCALE ? RADAR.SHARP_OPTIONS : RADAR.SMOOTH_OPTIONS);

// 分辨率如实标注：数据源一格约 1km。只在放大到明显插值时补一句提示。
// devicePx 是画布的设备像素宽（CSS 宽 × dpr），viewSpanKm 是当前视野宽度。
const radarGridText = (viewSpanKm, devicePx) => {
  const pxPerKm = viewSpanKm > 0 ? devicePx / viewSpanKm : 0;
  const boxPx = Math.round(pxPerKm * RADAR.SOURCE_KM_PER_PX);
  return '回波分辨率约 1 km' +
    (boxPx >= RADAR.INTERP_NOTE_PX ? ' · 放大后为插值效果' : '');
};

const tileKey = (timeStamp, zoom, x, y) => timeStamp + ':' + zoom + ':' + x + ':' + y;

// 一帧在某视窗下需要的瓦片 + 每张瓦片在画布上的矩形（CSS 像素）
// devicePx 用于选层级：保证瓦片密度不低于屏幕像素密度
const planFrameTiles = (host, frame, view, size, devicePx, options) => {
  const zoom = geo.pickZoom(view, devicePx);
  const range = geo.tileRange(view, zoom);
  const proj = geo.makeProjector(view, size.width, size.height);
  const tiles = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      tiles.push({
        key: tileKey(frame.timeStamp, zoom, x, y),
        url: tileUrl(host, frame, zoom, x, y, options),
        zoom, x, y,
        rect: proj.rectOfBounds(geo.tileBounds(zoom, x, y)),
      });
    }
  }
  return { zoom, count: tiles.length, tiles };
};

// 帧播放索引推演（播放/暂停/点选共用一套规则）
const nextIndex = (current, total) => (total <= 0 ? 0 : (current + 1) % total);
const clampIndex = (index, total) => (total <= 0 ? 0 : Math.max(0, Math.min(total - 1, index)));

// —— 叠在微信原生地图上的图片图层（MapContext.addGroundOverlay）——
// 与 planFrameTiles 的区别：那边是「给 canvas 画」，需要投影与像素矩形；
// 这边只要「瓦片地址 + 经纬度范围」，缩放与平移全部交给地图组件，因此无需投影。
// ★ 瓦片是 WGS-84，而地图底图是 GCJ-02：bounds 必须换算，否则整片回波会偏约 594 m。

// groundOverlay 的 id 必须是数字；由「层级 + 瓦片号」推导，保证同一块瓦片每次都是同一个 id
const overlayId = (zoom, x, y) => zoom * 1000000 + x * 1000 + y;

const planMapOverlays = (host, frame, bounds, options) => {
  const zoom = geo.LAYER.MAX_ZOOM; // 免费档数据上限：z≥8 恒返回空瓦片（1.2 km/像素）
  const range = geo.tileRange(bounds, zoom);
  const centerLat = (bounds.north + bounds.south) / 2;
  const kmPerPx = (40075 * Math.cos((centerLat * Math.PI) / 180)) / (RADAR.TILE_SIZE * Math.pow(2, zoom));
  const tiles = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      const wgsBounds = geo.tileBounds(zoom, x, y);
      tiles.push({
        id: overlayId(zoom, x, y),
        key: tileKey(frame.timeStamp, zoom, x, y),
        url: tileUrl(host, frame, zoom, x, y, options),
        zoom, x, y,
        sourceBounds: wgsBounds,                    // 瓦片自身的 WGS-84 范围（诊断用）
        bounds: geoDatum.wgsBoundsToGcj(wgsBounds),  // ★ 真正交给地图的范围：GCJ-02
      });
    }
  }
  return { zoom, count: tiles.length, kmPerPx, tiles };
};

// 简单 LRU：真机上按帧缓存瓦片，避免来回拖动时间轴时重复下载
const createCache = (limit) => {
  const map = new Map();
  const drop = () => {
    while (map.size > limit) map.delete(map.keys().next().value);
  };
  return {
    get: (key) => {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key); map.set(key, value); // 命中后置为最近使用
      return value;
    },
    set: (key, value) => {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      drop();
      return value;
    },
    has: (key) => map.has(key),
    keys: () => Array.from(map.keys()),
    size: () => map.size,
  };
};

module.exports = {
  RADAR,
  buildFrames,
  timeCst,
  frameAgeMinutes,
  tileUrl,
  optionsForUpscale,
  radarGridText,
  tileKey,
  planFrameTiles,
  planMapOverlays,
  nextIndex,
  clampIndex,
  createCache,
};
