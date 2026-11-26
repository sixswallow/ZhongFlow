// 雷达回波「乡镇实况」纯计算库（无网络、无 canvas，可被 Node 测试直接 require）
//
// 用途：把 RainViewer 的雷达瓦片解成「每个乡镇范围内有没有回波、多强」，
//       作为短临预报的事后参照（遥感参照，不是地面雨量）。
//
// 口径纪律（重要）：
//  · 本库只输出「回波有无 / 回波覆盖率 / 回波强度档（弱 中 强 特强）」，
//    绝不输出毫米数——雷达是遥感估算，不能当雨量筒。
//  · 免费档雷达瓦片在 z≥8 恒为空图，z=7（约 1.1km/像素）是有回波的最高层级。
//  · 整个中方县在 z=7 只落在 1 张瓦片内（x=103,y=53），单帧成本 1 张图。
const zlib = require('zlib');

const RADAR_TRUTH = {
  HOST: 'https://tilecache.rainviewer.com',
  META_URL: 'https://api.rainviewer.com/public/weather-maps.json',
  ZOOM: 7,
  TILE_SIZE: 256,
  COLOR_SCHEME: 2,
  // alpha ≤ 40 视为边缘/插值噪声（RainViewer 开启平滑后会产生低 alpha 拖尾）
  ECHO_ALPHA_MIN: 40,
  // 认定「该乡镇有降水」的门槛：覆盖率 ≥ 8% 且回波像素 ≥ 4 个（约 4.7km²）。
  // 两者取「与」：面内像素少的乡镇（如铜鼎镇仅 41 像素）由覆盖率兜底，
  // 大乡镇（如中方镇 242 像素）由 8% 兜底，避免门槛在不同乡镇之间不一致。
  MIN_COVERAGE: 0.08,
  MIN_ECHO_PIXELS: 4,
  // 目标时刻与可用雷达帧的最大容差（帧间隔 10 分钟）
  MAX_FRAME_GAP_MIN: 12,
  // 与页面图例（rainfall.wxss .legend-dot.lv-1..4）一致的四档配色
  LEVELS: [
    { level: 1, name: '弱', rgb: [217, 203, 147] },
    { level: 2, name: '中', rgb: [168, 156, 120] },
    { level: 3, name: '强', rgb: [27, 174, 226] },
    { level: 4, name: '特强', rgb: [0, 81, 128] }
  ]
};

// ==================== PNG 解码（8bit RGBA / RGB / 灰度，filter 0-4） ====================
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function decodePng(buf) {
  let off = 8, width = 0, height = 0, depth = 0, colorType = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('仅支持 8bit PNG，实际 ' + depth + 'bit');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error('不支持的 PNG colorType=' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
      cur[i] = v;
    }
  }
  return { width, height, channels, data: out };
}

// ==================== 瓦片 / 经纬度换算（Web Mercator） ====================
const lonToGlobalX = (lng, zoom) => ((lng + 180) / 360) * RADAR_TRUTH.TILE_SIZE * Math.pow(2, zoom);
const latToGlobalY = (lat, zoom) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * RADAR_TRUTH.TILE_SIZE * Math.pow(2, zoom);
};
const globalXToLon = (x, zoom) => (x / (RADAR_TRUTH.TILE_SIZE * Math.pow(2, zoom))) * 360 - 180;

// 覆盖一组环所需的瓦片
function tilesForRings(rings, zoom) {
  const z = zoom || RADAR_TRUTH.ZOOM;
  const seen = {};
  const out = [];
  for (const tw of rings) {
    for (const pt of tw.ring) {
      const x = Math.floor(lonToGlobalX(pt[0], z) / RADAR_TRUTH.TILE_SIZE);
      const y = Math.floor(latToGlobalY(pt[1], z) / RADAR_TRUTH.TILE_SIZE);
      const key = z + '/' + x + '/' + y;
      if (!seen[key]) { seen[key] = 1; out.push({ key, z, x, y }); }
    }
  }
  return out;
}

function tileUrl(host, framePath, z, x, y, scheme, smooth, snow) {
  return (host || RADAR_TRUTH.HOST) + framePath + '/' + RADAR_TRUTH.TILE_SIZE + '/' + z + '/' + x + '/' + y + '/' +
    (scheme || RADAR_TRUTH.COLOR_SCHEME) + '/' + (smooth === undefined ? 1 : smooth) + '_' + (snow === undefined ? 1 : snow) + '.png';
}

// ==================== 面内回波统计 ====================
// 射线法；ring 为已转成像素坐标的 [[x,y],...]
function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 环 → 该帧瓦片内的像素坐标；瓦片按「面外接框中心」选取。
// 若任一点落在该瓦片之外（spansTiles），调用方必须判为不可判定，绝不能静默漏算。
function ringToPixels(ring, zoom) {
  const z = zoom || RADAR_TRUTH.ZOOM;
  const size = RADAR_TRUTH.TILE_SIZE;
  const gx = ring.map((p) => lonToGlobalX(p[0], z));
  const gy = ring.map((p) => latToGlobalY(p[1], z));
  const cxp = (Math.min.apply(null, gx) + Math.max.apply(null, gx)) / 2;
  const cyp = (Math.min.apply(null, gy) + Math.max.apply(null, gy)) / 2;
  const tx = Math.floor(cxp / size), ty = Math.floor(cyp / size);
  const ox = tx * size, oy = ty * size;
  const pts = ring.map((p, i) => [gx[i] - ox, gy[i] - oy]);
  let spansTiles = false;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][0] < 0 || pts[i][0] > size || pts[i][1] < 0 || pts[i][1] > size) { spansTiles = true; break; }
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return {
    pts,
    spansTiles,
    tile: { z, x: tx, y: ty, key: z + '/' + tx + '/' + ty },
    bbox: {
      x0: Math.max(0, Math.floor(Math.min.apply(null, xs))),
      x1: Math.min(size - 1, Math.ceil(Math.max.apply(null, xs))),
      y0: Math.max(0, Math.floor(Math.min.apply(null, ys))),
      y1: Math.min(size - 1, Math.ceil(Math.max.apply(null, ys)))
    }
  };
}

// 统计一个乡镇在单张瓦片里的回波情况
function regionEcho(img, ringPixels) {
  const ch = img.channels;
  const { bbox, pts } = ringPixels;
  let inside = 0, echo = 0, rSum = 0, gSum = 0, bSum = 0, peakAlpha = 0;
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      if (!pointInRing(x + 0.5, y + 0.5, pts)) continue;
      inside++;
      const i = (y * img.width + x) * ch;
      const a = ch === 4 ? img.data[i + 3] : 255;
      if (a < RADAR_TRUTH.ECHO_ALPHA_MIN) continue;
      echo++;
      if (a > peakAlpha) peakAlpha = a;
      if (ch >= 3) { rSum += img.data[i]; gSum += img.data[i + 1]; bSum += img.data[i + 2]; }
    }
  }
  return {
    insidePixels: inside,
    echoPixels: echo,
    echoRatio: inside ? echo / inside : 0,
    peakAlpha,
    meanRgb: echo ? [Math.round(rSum / echo), Math.round(gSum / echo), Math.round(bSum / echo)] : null
  };
}

function nearestLevel(rgb) {
  if (!rgb) return null;
  let best = null, bestD = Infinity;
  for (const lv of RADAR_TRUTH.LEVELS) {
    const d = (rgb[0] - lv.rgb[0]) ** 2 + (rgb[1] - lv.rgb[1]) ** 2 + (rgb[2] - lv.rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = lv; }
  }
  return best;
}

// 判定「该乡镇此时有没有降水」
function judgeEcho(stats) {
  const hasRain = stats.echoPixels >= RADAR_TRUTH.MIN_ECHO_PIXELS &&
    stats.echoRatio >= RADAR_TRUTH.MIN_COVERAGE;
  const lv = hasRain ? nearestLevel(stats.meanRgb) : null;
  return {
    hasRain,
    echoRatio: +stats.echoRatio.toFixed(4),
    echoPixels: stats.echoPixels,
    insidePixels: stats.insidePixels,
    level: lv ? lv.level : null,
    levelName: lv ? lv.name : ''
  };
}

// 一帧 → 各乡镇实况（imgs 为 { 'z/x/y': 解码结果 }，ringPixelsCache 可复用）
function summarizeFrame(imgs, rings, zoom) {
  const z = zoom || RADAR_TRUTH.ZOOM;
  return rings.map((tw) => {
    const rp = ringToPixels(tw.ring, z);
    const base = { code: tw.code, name: tw.name };
    if (rp.spansTiles) {
      return Object.assign(base, {
        ok: false, reason: '该乡镇跨多张瓦片，当前层级无法判定',
        hasRain: null, level: null, echoRatio: null
      });
    }
    const img = imgs[rp.tile.key];
    if (!img) {
      return Object.assign(base, { ok: false, reason: '瓦片缺失', hasRain: null, level: null, echoRatio: null });
    }
    return Object.assign(base, { ok: true }, judgeEcho(regionEcho(img, rp)));
  });
}

// 找最接近目标时刻的可用帧
function pickNearestFrame(frames, targetSec, maxGapMin) {
  const tol = (maxGapMin === undefined ? RADAR_TRUTH.MAX_FRAME_GAP_MIN : maxGapMin) * 60;
  let best = null, bestD = Infinity;
  for (const f of frames) {
    const d = Math.abs(f.time - targetSec);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best || bestD > tol) return null;
  return { frame: best, deltaMin: +(bestD / 60).toFixed(1) };
}

module.exports = {
  RADAR_TRUTH,
  decodePng,
  lonToGlobalX,
  latToGlobalY,
  globalXToLon,
  tilesForRings,
  tileUrl,
  pointInRing,
  ringToPixels,
  regionEcho,
  nearestLevel,
  judgeEcho,
  summarizeFrame,
  pickNearestFrame
};
