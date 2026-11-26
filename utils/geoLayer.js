// 气象图层共享几何：视窗、投影、瓦片换算。
// pages/rainfall 与 scripts/bake-basemap.js 共用本模块，
// 保证「烘焙底图」与「雷达瓦片 / 风场网格」严格配准。
//
// 投影选择说明：
// 县域尺度（约 100km）下使用等距圆柱投影并对经度做 cos(lat) 修正，
// 它在局部与墨卡托的差异远小于 1 个像素，但它是严格仿射的——
// 因此烘焙底图可以用 drawImage 等比缩放而不产生错位。
// 墨卡托是非线性映射，用它反而会让「先烘焙、后缩放」出现边缘偏移。

const { TOWNSHIP_BOUNDARIES } = require('./townshipBoundaries.js');

const DEG2RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 111.32; // 纬度 1° 约 111.32km
const EARTH_KM = 6371.0088;

// —— 图层参数 ——
const LAYER = {
  // 视窗边长（公里）。县域约 73×53km，取 200km 后县域占画布宽约 1/3，
  // 周边约 100km 的雨带也能进入视野（支撑「降雨带距离」这类信息）。
  VIEW_SPAN_KM: 200,
  BAKE_PAD: 1.5,    // 烘焙底图余量：必须覆盖任意画布比例下的视窗
  BAKE_PX: 768,     // 烘焙底图边长像素（768：县域视野显示宽 ~340px 已过采样；1024 时 PNG 达 750KB 会顶爆主包 2MB）
  // 全屏查看时的缩放下限/上限（视窗宽度，公里）。上限不能超过烘焙底图覆盖范围，
  // 否则平移/zoom out 会露出没有底图的白边。
  MIN_SPAN_KM: 28,
  MAX_SPAN_KM: 260,
  // 「县域」取景跨度（公里）：县域完整入画并留约 12% 余量。
  // 实测这是「想看得大一点」最常用的一档，比默认 200km 视窗近一倍以上。
  COUNTY_SPAN_KM: 92,
  MIN_ZOOM: 6,
  // ⚠️ 实测结论（2026-09-22）：RainViewer 免费雷达瓦片在 z≥8 恒定返回空瓦片
  // （恒为 1370 字节），只有 z≤7 有回波数据（约 1.2km/像素）。
  // 故可用层级上限为 7；配合 200km 视窗 + 2 倍屏，雷达仅被放大 1.3 倍，接近原始分辨率。
  MAX_ZOOM: 7,
};

// —— 由真实乡镇边界推导县域范围（不硬编码坐标，避免与数据源漂移）——
const collectPoints = (boundaries) => {
  const pts = [];
  boundaries.forEach((item) => {
    (item.points || []).forEach((p) => {
      if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
        pts.push({ latitude: p.latitude, longitude: p.longitude });
      }
    });
  });
  return pts;
};

const boundsOfPoints = (pts) => {
  if (!pts.length) return { west: 0, south: 0, east: 0, north: 0 };
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  pts.forEach((p) => {
    west = Math.min(west, p.longitude);
    east = Math.max(east, p.longitude);
    south = Math.min(south, p.latitude);
    north = Math.max(north, p.latitude);
  });
  return { west, south, east, north };
};

const COUNTY_POINTS = collectPoints(TOWNSHIP_BOUNDARIES);
const COUNTY_BOUNDS = boundsOfPoints(COUNTY_POINTS);

const kmPerDegLng = (lat) => KM_PER_DEG_LAT * Math.cos(lat * DEG2RAD);

const boundsCenter = (b) => ({
  latitude: (b.south + b.north) / 2,
  longitude: (b.west + b.east) / 2,
});

// 以某个中心取「公里正方形」范围
const squareBoxKm = (center, spanKm) => {
  const dLat = spanKm / 2 / KM_PER_DEG_LAT;
  const dLng = spanKm / 2 / kmPerDegLng(center.latitude);
  return { west: center.longitude - dLng, east: center.longitude + dLng, south: center.latitude - dLat, north: center.latitude + dLat };
};

const boundsSizeKm = (b) => {
  const c = boundsCenter(b);
  return { width: (b.east - b.west) * kmPerDegLng(c.latitude), height: (b.north - b.south) * KM_PER_DEG_LAT };
};

// 把内容范围按指定画布比例外扩成视窗（保证内容完整可见并留边）
const fitView = (b, aspect, pad) => {
  const c = boundsCenter(b);
  const size = boundsSizeKm(b);
  let wKm = size.width * pad;
  let hKm = size.height * pad;
  if (wKm / hKm < aspect) wKm = hKm * aspect; else hKm = wKm / aspect;
  const dLat = hKm / 2 / KM_PER_DEG_LAT;
  const dLng = wKm / 2 / kmPerDegLng(c.latitude);
  return { west: c.longitude - dLng, east: c.longitude + dLng, south: c.latitude - dLat, north: c.latitude + dLat };
};

// 等距圆柱投影：lng/lat <-> 画布像素（严格仿射）
const makeProjector = (bounds, width, height) => {
  const c = boundsCenter(bounds);
  const scale = width / ((bounds.east - bounds.west) * kmPerDegLng(c.latitude)); // px per km
  const kx = kmPerDegLng(c.latitude) * scale;
  const ky = KM_PER_DEG_LAT * scale;
  return {
    width,
    height,
    bounds,
    pxPerKm: scale,
    toPx: (lng, lat) => ({ x: (lng - bounds.west) * kx, y: (bounds.north - lat) * ky }),
    toLngLat: (x, y) => ({ longitude: bounds.west + x / kx, latitude: bounds.north - y / ky }),
    // 供瓦片定位：给定瓦片的地理边界，算出它在画布上的矩形
    rectOfBounds: (t) => {
      const a = { x: (t.west - bounds.west) * kx, y: (bounds.north - t.north) * ky };
      const b = { x: (t.east - bounds.west) * kx, y: (bounds.north - t.south) * ky };
      return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    },
  };
};

// —— Web 墨卡托瓦片（RainViewer 用标准 slippy 瓦片）——
const lngToTileX = (lng, z) => ((lng + 180) / 360) * Math.pow(2, z);
const latToTileY = (lat, z) => {
  const s = Math.sin(lat * DEG2RAD);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
};
const tileXToLng = (x, z) => (x / Math.pow(2, z)) * 360 - 180;
const tileYToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const tileBounds = (z, x, y) => ({
  west: tileXToLng(x, z),
  east: tileXToLng(x + 1, z),
  north: tileYToLat(y, z),
  south: tileYToLat(y + 1, z),
});

const tileRange = (bounds, z) => {
  const n = Math.pow(2, z);
  const clamp = (v) => Math.max(0, Math.min(n - 1, v));
  return {
    z,
    x0: clamp(Math.floor(lngToTileX(bounds.west, z))),
    x1: clamp(Math.ceil(lngToTileX(bounds.east, z)) - 1),
    y0: clamp(Math.floor(latToTileY(bounds.north, z))),
    y1: clamp(Math.ceil(latToTileY(bounds.south, z)) - 1),
  };
};

// 选满足目标像素密度的最小层级，并受 MAX_ZOOM 限制
const pickZoom = (bounds, targetPx) => {
  const spanDeg = bounds.east - bounds.west;
  const needPxPerDeg = targetPx / spanDeg;
  for (let z = LAYER.MIN_ZOOM; z <= LAYER.MAX_ZOOM; z++) {
    const pxPerDeg = (256 * Math.pow(2, z)) / 360;
    if (pxPerDeg >= needPxPerDeg) return z;
  }
  return LAYER.MAX_ZOOM;
};

// —— 视窗交互（全屏查看：双指缩放 / 拖动平移）——

const clampSpan = (km, minKm, maxKm) => Math.max(minKm, Math.min(maxKm, km));

const viewSpanKm = (view) => boundsSizeKm(view).width;

// 以归一化锚点 (ax, ay)（相对画布，左上为 0）为中心缩放；factor > 1 为放大
const zoomView = (view, factor, ax, ay, minSpanKm, maxSpanKm) => {
  const size = boundsSizeKm(view);
  const target = clampSpan(size.width / factor, minSpanKm, maxSpanKm);
  const scale = target / size.width;
  const anchorX = typeof ax === 'number' ? ax : 0.5;
  const anchorY = typeof ay === 'number' ? ay : 0.5;
  const anchorLng = view.west + (view.east - view.west) * anchorX;
  const anchorLat = view.north - (view.north - view.south) * anchorY;
  const spanLng = (size.width * scale) / kmPerDegLng(anchorLat);
  const spanLat = (size.height * scale) / KM_PER_DEG_LAT;
  const west = anchorLng - anchorX * spanLng;
  const north = anchorLat + anchorY * spanLat;
  return { west, east: west + spanLng, north, south: north - spanLat };
};

// 按屏幕像素平移：手指往哪边拖，地图内容就往哪边走
const panView = (view, dxPx, dyPx, width) => {
  const kmPerPx = boundsSizeKm(view).width / width;
  const c = boundsCenter(view);
  const dLng = (dxPx * kmPerPx) / kmPerDegLng(c.latitude);
  const dLat = (dyPx * kmPerPx) / KM_PER_DEG_LAT;
  return { west: view.west - dLng, east: view.east - dLng, north: view.north + dLat, south: view.south + dLat };
};

// 把视窗限制在允许范围内（超出烘焙底图范围就会露白边）
const clampView = (view, limit) => {
  const spanLng = view.east - view.west;
  const spanLat = view.north - view.south;
  const limitLng = limit.east - limit.west;
  const limitLat = limit.north - limit.south;
  let west;
  if (spanLng >= limitLng) west = limit.west + (limitLng - spanLng) / 2;
  else west = Math.max(limit.west, Math.min(limit.east - spanLng, view.west));
  let north;
  // 北边界 = 允许范围的北边界再向上让出「跨度差的一半」，这样中心才落在允许范围中心
  if (spanLat >= limitLat) north = limit.north + (spanLat - limitLat) / 2;
  else north = Math.min(limit.north, Math.max(limit.south + spanLat, view.north));
  return { west, east: west + spanLng, north, south: north - spanLat };
};

// 风场网格取样范围：视窗外扩一定比例（平移时不至于立刻越界），并限制在允许范围内
const expandView = (view, factor, limit) => {
  const size = boundsSizeKm(view);
  return clampView(squareBoxKm(boundsCenter(view), Math.max(size.width, size.height) * factor), limit);
};

const distanceKm = (lat1, lng1, lat2, lng2) => {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

// 运行时视窗：按画布比例把 200km 方框铺满（县域恒定居中）
const viewFor = (aspect) => fitView(squareBoxKm(boundsCenter(COUNTY_BOUNDS), LAYER.VIEW_SPAN_KM), aspect, 1);

// 「县域」取景：县域完整可见且尽量大（「县域」按钮、进入全屏时的默认视野）
// 「全县」取景：**刚好把县域全域框进展示框**（2026-09-30 用户要求）。
// 1.03 倍留白只是不让最外圈的边界线贴边，不再是 100km 的方形盒
//（那会在框的两侧各多出十几公里没有信息的视野）。
const COUNTY_VIEW_PAD = 1.03;
const viewForCounty = (aspect) => fitView(COUNTY_BOUNDS, aspect, COUNTY_VIEW_PAD);

// 保持跨度与宽高比，把视窗中心移到指定点（「重定位」用）
const recenterView = (view, center) => {
  const size = boundsSizeKm(view);
  const dLat = size.height / 2 / KM_PER_DEG_LAT;
  const dLng = size.width / 2 / kmPerDegLng(center.latitude);
  return { west: center.longitude - dLng, east: center.longitude + dLng, south: center.latitude - dLat, north: center.latitude + dLat };
};

// 画布宽高比变化（卡片 ↔ 全屏）时保留中心与纵向跨度，东西跨度由宽高比推导。
// 这样两轴「每公里像素」严格相等——否则底图与站点会被拉长。
const applyAspect = (view, aspect) => {
  const c = boundsCenter(view);
  const size = boundsSizeKm(view);
  const hKm = size.height;
  const wKm = hKm * aspect;
  const dLat = hKm / 2 / KM_PER_DEG_LAT;
  const dLng = wKm / 2 / kmPerDegLng(c.latitude);
  return { west: c.longitude - dLng, east: c.longitude + dLng, south: c.latitude - dLat, north: c.latitude + dLat };
};

// 烘焙底图覆盖范围（脚本与页面共用，必须包住任意比例下的视窗）
const BAKE_BOUNDS = squareBoxKm(boundsCenter(COUNTY_BOUNDS), LAYER.VIEW_SPAN_KM * LAYER.BAKE_PAD);

module.exports = {
  LAYER,
  COUNTY_BOUNDS,
  COUNTY_CENTER: boundsCenter(COUNTY_BOUNDS),
  BAKE_BOUNDS,
  boundsCenter,
  boundsSizeKm,
  kmPerDegLng,
  squareBoxKm,
  viewFor,
  viewForCounty,
  applyAspect,
  recenterView,
  fitView,
  viewSpanKm,
  zoomView,
  panView,
  clampView,
  expandView,
  makeProjector,
  lngToTileX,
  latToTileY,
  tileXToLng,
  tileYToLat,
  tileBounds,
  tileRange,
  pickZoom,
  distanceKm,
};
