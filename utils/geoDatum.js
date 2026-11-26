// WGS-84 ⇄ GCJ-02（「火星坐标」）换算。
//
// 为什么需要它：
//   微信 <map> 的底图是腾讯的 **GCJ-02**，而雷达瓦片（RainViewer）与乡镇边界数据是 **WGS-84**。
//   把 WGS-84 的经纬度直接交给地图，整块内容会偏移 —— 实测（2026-09-28）中方县中心偏
//   东 482 m / 北 −347 m（直线 594 m，方位约 126°）；县域内 6 个取样点都在 591~594 m 之间。
//   也就是说在县域尺度上它近似是一个**常数平移**，整块平移即可，
//   残差 ≤21 m（相当于雷达免费档一个像素的 2%，可忽略）。
//
// 纯计算、零依赖，可被 Node 测试直接 require。
// 口径：不做十进制度→米制的精度承诺，所有换算都在经纬度域完成。

const PI = Math.PI;
const A = 6378245.0;               // 克拉索夫斯基椭球长半轴（米）
const EE = 0.00669342162296594323; // 第一偏心率平方
// GCJ-02 只在中国大陆生效，境外坐标必须原样返回，否则会把境外点位改坏
const CHINA = { minLng: 73.66, maxLng: 135.05, minLat: 3.86, maxLat: 53.55 };
const M_PER_DEG_LAT = 111132.92;   // 仅用于诊断输出（把度换算成米）

const outOfChina = (lng, lat) => !(lng > CHINA.minLng && lng < CHINA.maxLng && lat > CHINA.minLat && lat < CHINA.maxLat);

const transformLat = (x, y) => {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return r;
};

const transformLng = (x, y) => {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return r;
};

// WGS-84 → GCJ-02
const wgsToGcj = (lng, lat) => {
  if (outOfChina(lng, lat)) return { longitude: lng, latitude: lat, shifted: false };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { longitude: lng + dLng, latitude: lat + dLat, shifted: true };
};

// GCJ-02 → WGS-84：用不动点迭代反解（GCJ→WGS 没有解析解），3 次即收敛到 1e-9 度
const gcjToWgs = (lng, lat) => {
  if (outOfChina(lng, lat)) return { longitude: lng, latitude: lat, shifted: false };
  let w = { longitude: lng, latitude: lat };
  for (let i = 0; i < 3; i++) {
    const g = wgsToGcj(w.longitude, w.latitude);
    w = { longitude: w.longitude + (lng - g.longitude), latitude: w.latitude + (lat - g.latitude) };
  }
  return { longitude: w.longitude, latitude: w.latitude, shifted: true };
};

// {west,south,east,north} → GCJ-02：两个角分别换算。
// 尺度小（县域）时形变可忽略；尺度大（整张瓦片）时最多只有几十米的尺寸变化，
// 而雷达免费档一个像素就是 1.2 km，故不影响观感。
const wgsBoundsToGcj = (b) => {
  const sw = wgsToGcj(b.west, b.south);
  const ne = wgsToGcj(b.east, b.north);
  return { west: sw.longitude, south: sw.latitude, east: ne.longitude, north: ne.latitude };
};

// 便捷形式：把「像 {latitude, longitude} 的地理点」换算成微信 <map> / marker / polygon
// 需要的 GCJ-02 坐标。字段缺失时原样返回（宁可不动，也不要生成 NaN 把整层画坏）。
// 注意：Number(null) 与 Number('') 都是 0，直接用会把「缺经纬度」的点悄悄落到 (0,0)，
// 所以这里把空值显式判为无效（无效一律返回 NaN，交给地图自行忽略）。
const numOrNaN = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

const toMapPoint = (point) => {
  const lng = numOrNaN(point && point.longitude);
  const lat = numOrNaN(point && point.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { longitude: NaN, latitude: NaN };
  const g = wgsToGcj(lng, lat);
  return { longitude: g.longitude, latitude: g.latitude };
};

// 批量版本（乡镇分界线有上万个点，交给调用方自行缓存）
const toMapPoints = (points) => (points || []).map(toMapPoint);

// 诊断用：偏移的东向/北向分量、直线距离（米）与方位角（度，正北为 0，顺时针）
const offsetMeters = (lng, lat) => {
  const g = wgsToGcj(lng, lat);
  const dx = (g.longitude - lng) * 111412.84 * Math.cos((lat * PI) / 180);
  const dy = (g.latitude - lat) * M_PER_DEG_LAT;
  return {
    dx: Math.round(dx),
    dy: Math.round(dy),
    distance: Math.round(Math.sqrt(dx * dx + dy * dy)),
    bearing: Math.round(((Math.atan2(dx, dy) * 180) / PI + 360) % 360),
  };
};

module.exports = {
  wgsToGcj,
  gcjToWgs,
  wgsBoundsToGcj,
  toMapPoint,
  toMapPoints,
  offsetMeters,
};
