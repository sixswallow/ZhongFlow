// 烘焙区域底图生成器（纯 Node，无第三方依赖）
//
// 输入：
//  · utils/townshipBoundaries.js 的真实乡镇聚合边界
//  · assets/basemap/hillshade.png 的真实 DEM 晕渲（由 bake-hillshade.js 从 AWS Terrain Tiles 生成）
//  · OSM 主要公路与河流（Overpass API，烘焙期拉取并缓存；拉不到时优雅降级为无路网）
// 输出：assets/basemap/zhongfang.png
//
// 为什么自己烘焙而不是拉在线瓦片：
//  1) 在线底图（天地图/高德）需要 key、授权与 downloadFile 白名单，且政府项目有合规风险；
//  2) 县域视野基本固定，一张按真实边界渲染的矢量底图已经足够，且与站点/雷达严格同源；
//  3) 运行期只需 drawImage 一次，零网络、零解析成本。
//
// 2026-11-25 视觉改版（用户反馈）：
//  · 撤掉「县境光晕」与 3.2px 粗乡镇界 —— 那种晕开的毛笔效果既不直观也无明确意义；
//  · 真实地形晕渲直接烘进底图（此前只靠运行期 0.32 半透明叠加，太弱看不出来）；
//  · 加主要公路与河流，给雷达/风场图提供方位参照。
//
// 用法：node scripts/bake-basemap.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const geo = require(path.join(ROOT, 'utils', 'geoLayer.js'));
const { TOWNSHIP_BOUNDARIES } = require(path.join(ROOT, 'utils', 'townshipBoundaries.js'));
const { decodePng } = require(path.join(ROOT, 'cloudfunctions', 'getWeather', 'lib', 'radarTruth.js'));

const PX = geo.LAYER.BAKE_PX;

// ============ 1. 极简 PNG 编码器（8bit RGBA，filter=Sub） ============
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const encodePNG = (w, h, rgba) => {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 1; // filter: Sub（对渐变友好）
    const src = y * stride;
    for (let i = 0; i < stride; i++) {
      const prev = i >= 4 ? rgba[src + i - 4] : 0;
      raw[o + 1 + i] = (rgba[src + i] - prev) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ============ 2. 光栅化工具 ============
const proj = geo.makeProjector(geo.BAKE_BOUNDS, PX, PX);
// 用 Float32Array 而不是 Buffer：Buffer 写入浮点会按 &255 环绕，破坏叠加运算
const buf = new Float32Array(PX * PX * 4);
for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
const px = (x, y) => (y * PX + x) * 4;
const setPx = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= PX || y >= PX) return;
  const i = px(x, y);
  if (a >= 1) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; return; }
  const inv = 1 - a;
  buf[i] = buf[i] * inv + r * a;
  buf[i + 1] = buf[i + 1] * inv + g * a;
  buf[i + 2] = buf[i + 2] * inv + b * a;
  buf[i + 3] = Math.max(buf[i + 3], 255 * a + buf[i + 3] * inv);
};
const getPx = (x, y) => {
  const i = px(x, y);
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};

// 把边界点数组切成闭合环（数据里每个环首尾点相同，环之间会出现大跳跃）
const splitRings = (points) => {
  const rings = [];
  let cur = [];
  points.forEach((p, i) => {
    if (i > 0 && cur.length > 0) {
      const first = cur[0];
      if (Math.abs(p.latitude - first.latitude) < 1e-9 && Math.abs(p.longitude - first.longitude) < 1e-9) {
        cur.push(p);
        rings.push(cur);
        cur = [];
        return;
      }
    }
    cur.push(p);
  });
  if (cur.length > 2) rings.push(cur);
  return rings;
};

const toPixelRings = (rings) => rings.map((ring) => ring.map((p) => proj.toPx(p.longitude, p.latitude)));

// 偶奇规则扫描线填充（多环一起参与，天然支持挖洞）
// 扫描线求交 + 偶奇配对（填色与剪影掩膜共用同一套几何判定）
const eachSpan = (pixelRings, cb) => {
  let minY = Infinity, maxY = -Infinity;
  pixelRings.forEach((ring) => ring.forEach((p) => { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(PX - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    pixelRings.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
          xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
    });
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      cb(y, Math.max(0, Math.round(xs[k])), Math.min(PX - 1, Math.round(xs[k + 1]) - 1));
    }
  }
};

const fillRings = (pixelRings, color, alpha) => {
  eachSpan(pixelRings, (y, x0, x1) => {
    for (let x = x0; x <= x1; x++) setPx(x, y, color[0], color[1], color[2], alpha);
  });
};

// 独立掩膜：不能借用 alpha 通道，因为底图本身是不透明的
const rasterizeMask = (pixelRings, target) => {
  eachSpan(pixelRings, (y, x0, x1) => { for (let x = x0; x <= x1; x++) target[y * PX + x] = 1; });
};

// 线条：按「像素中心到线段的距离」算覆盖度 —— 核心全实色、边缘 1px 过渡（抗锯齿）。
// 之前的四边形扫描线填充是二值覆盖，1.4~2px 细线全是阶梯锯齿；实色后锯齿尤其扎眼。
const strokeSegAA = (a, b, color, hw) => {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - hw - 1));
  const maxX = Math.min(PX - 1, Math.ceil(Math.max(a.x, b.x) + hw + 1));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - hw - 1));
  const maxY = Math.min(PX - 1, Math.ceil(Math.max(a.y, b.y) + hw + 1));
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5 - a.x, cy = y + 0.5 - a.y;
      const t = Math.max(0, Math.min(1, (cx * dx + cy * dy) / len2));
      const d = Math.hypot(x + 0.5 - (a.x + t * dx), y + 0.5 - (a.y + t * dy));
      const cov = Math.max(0, Math.min(1, hw + 0.5 - d));
      if (cov > 0) setPx(x, y, color[0], color[1], color[2], cov);
    }
  }
};
// 闭合环（乡镇界）
const strokeRing = (ring, color, width) => {
  for (let i = 0; i < ring.length - 1; i++) strokeSegAA(ring[i], ring[i + 1], color, width / 2);
};
// 折线（路网/水系）
const strokePolyline = (pts, color, width) => {
  for (let i = 0; i < pts.length - 1; i++) strokeSegAA(pts[i], pts[i + 1], color, width / 2);
};
// Chaikin 切角平滑：每轮把每段换成 25%/75% 两个点，2 轮后折线呈现自然弯曲线
const chaikin = (pts, iterations) => {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
};
// Douglas-Peucker 简化：OSM 河流顶点密度远高于显示分辨率（有的 234 个点挤在 20×20px 里），
// 不简化就剩一堆 1px 级噪声抖动，Chaikin 再怎么平滑也是锯齿。容差 ~1.2px。
const simplifyDP = (pts, tol) => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const seg = (i0, i1) => {
    if (i1 <= i0 + 1) return;
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) { keep[maxI] = 1; seg(i0, maxI); seg(maxI, i1); }
  };
  seg(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
};
// 简化 + 平滑一步到位（rivers/roads 共用）
const smoothLine = (pts) => chaikin(simplifyDP(pts, 1.2), 2);

// ============ 3. OSM 公路与河流（烘焙期拉取，带缓存与降级） ============
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const ROAD_CACHE = path.join(ROOT, '.ekko-tmp', 'roads-cache.json');

const httpGetJson = (url, body, timeoutMs) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = https.request({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: {
      'User-Agent': 'zhongflow-bake',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: timeoutMs,
  }, (res) => {
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
  });
  req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(body);
});

// 取景参照范围：县域向外扩约 50km。底图烘焙范围是 300km 方形，但用户绝大多数时间在看县域周边 ——
// 全域撒 1.3 万条路只会变成一锅毫无方位意义的 spaghetti；收进来之后路网才是「参照物」。
const FETCH_MARGIN_DEG = 0.5;
const fetchBounds = {
  west: geo.COUNTY_BOUNDS.west - FETCH_MARGIN_DEG,
  east: geo.COUNTY_BOUNDS.east + FETCH_MARGIN_DEG,
  south: geo.COUNTY_BOUNDS.south - FETCH_MARGIN_DEG,
  north: geo.COUNTY_BOUNDS.north + FETCH_MARGIN_DEG,
};
const fetchOsmFeatures = async (b) => {
  if (fs.existsSync(ROAD_CACHE)) {
    console.log('路网/水系：命中缓存 ' + ROAD_CACHE);
    return JSON.parse(fs.readFileSync(ROAD_CACHE, 'utf8'));
  }
  const bbox = b.south + ',' + b.west + ',' + b.north + ',' + b.east;
  const query = '[out:json][timeout:90];(' +
    'way["highway"~"^(motorway|trunk|primary)$"](' + bbox + ');' +
    'way["waterway"="river"](' + bbox + ');' +
    ');out geom;';
  const body = 'data=' + encodeURIComponent(query);
  for (const base of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log('路网/水系：请求 ' + base + (attempt ? '（重试）' : ''));
        const json = await httpGetJson(base, body, 120000);
        fs.mkdirSync(path.dirname(ROAD_CACHE), { recursive: true });
        fs.writeFileSync(ROAD_CACHE, JSON.stringify(json));
        return json;
      } catch (e) {
        console.log('  失败：' + (e && e.message));
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  return null;
};

// ============ 4. 底图内容 ============
// 4.1 背景：青黛浅色径向渐变（县外的部分由真实地形晕渲接管，不再编造假噪声）
const cx = PX * 0.5, cy = PX * 0.5;
const maxR = Math.hypot(cx, cy);
const BG_IN = [249, 252, 254], BG_OUT = [230, 241, 248];
for (let y = 0; y < PX; y++) {
  for (let x = 0; x < PX; x++) {
    const t = Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
    const i = px(x, y);
    buf[i] = BG_IN[0] + (BG_OUT[0] - BG_IN[0]) * t;
    buf[i + 1] = BG_IN[1] + (BG_OUT[1] - BG_IN[1]) * t;
    buf[i + 2] = BG_IN[2] + (BG_OUT[2] - BG_IN[2]) * t;
    buf[i + 3] = 255;
  }
}

// 4.2 乡镇环
const towns = TOWNSHIP_BOUNDARIES.map((t) => ({ name: t.name, rings: toPixelRings(splitRings(t.points)) }));
const totalRings = towns.reduce((s, t) => s + t.rings.length, 0);
const totalPts = towns.reduce((s, t) => s + t.rings.reduce((a, r) => a + r.length, 0), 0);

// 4.3 乡镇填色（四色循环，极低对比，保证可读且不抢雷达图层）
const FILLS = [[238, 247, 252], [233, 243, 250], [241, 249, 253], [230, 241, 249]];
towns.forEach((t, i) => {
  const color = FILLS[i % FILLS.length];
  t.rings.forEach((r) => fillRings([r], color, 1));
});

// 4.4 真实地形晕渲：hillshade.png（AWS Terrain Tiles 真实 DEM）与底图同范围（BAKE_BOUNDS），
//     双线性放大到 1024 后做「中性偏移叠加」：迎光坡提亮、背光坡压暗 —— 地形起伏一眼可读。
// ★ 注意「平地」的灰度不是 128：西北光 45° 光照模型下平地 shade=cos45°≈0.707 → 灰度约 171，
//   整体明显高于中灰。直接拿 128 当基准会把整张图均匀提亮、起伏反而被抹平（第一版就栽在这里），
//   所以先统计均值当「平地基准」，起伏=相对均值的偏差。
const HILL_STRENGTH = 1.1; // 偏差映射强度：晕渲实际灰度范围 121~206，相对均值 ±50 → 底图上 ±55
const hillFile = path.join(ROOT, 'assets', 'basemap', 'hillshade.png');
let hillReady = false;
if (fs.existsSync(hillFile)) {
  const hs = decodePng(fs.readFileSync(hillFile));
  if (hs.width > 0 && hs.channels >= 1) {
    let sum = 0, n = 0;
    for (let i = 0; i < hs.data.length; i += hs.channels) { sum += hs.data[i]; n++; }
    const flat = sum / n;
    const sx = hs.width / PX, sy = hs.height / PX;
    for (let y = 0; y < PX; y++) {
      const fy = Math.min(hs.height - 1.001, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < PX; x++) {
        const fx = Math.min(hs.width - 1.001, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx), tx = fx - x0;
        const at = (xx, yy) => hs.data[(yy * hs.width + xx) * hs.channels];
        const g = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
                  (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
        const delta = (g - flat) * HILL_STRENGTH;
        const i = px(x, y);
        buf[i] += delta; buf[i + 1] += delta; buf[i + 2] += delta * 0.9; // 蓝通道略轻，保住青黛色调
      }
    }
    hillReady = true;
    console.log('地形晕渲已烘进底图（' + hs.width + '×' + hs.height + ' 双线性 → ' + PX + '×' + PX +
      '，平地基准 ' + flat.toFixed(0) + '）');
  }
}
if (!hillReady) console.log('警告：hillshade.png 缺失，底图将没有地形起伏（先跑 scripts/bake-hillshade.js）');

// 4.5 经纬网（每 0.5°，专业感 + 便于估距）
const GRAT = [176, 203, 220];
for (let lng = Math.ceil(geo.BAKE_BOUNDS.west * 2) / 2; lng <= geo.BAKE_BOUNDS.east; lng += 0.5) {
  const x = Math.round(proj.toPx(lng, geo.BAKE_BOUNDS.north).x);
  for (let y = 0; y < PX; y++) setPx(x, y, GRAT[0], GRAT[1], GRAT[2], 0.3);
}
for (let lat = Math.ceil(geo.BAKE_BOUNDS.south * 2) / 2; lat <= geo.BAKE_BOUNDS.north; lat += 0.5) {
  const y = Math.round(proj.toPx(geo.BAKE_BOUNDS.west, lat).y);
  for (let x = 0; x < PX; x++) setPx(x, y, GRAT[0], GRAT[1], GRAT[2], 0.22);
}

// 4.6 主要公路与河流（方位参照：高速/国道一级公路 + 干流河道）
//     画在地形之上、边界线之下 —— 路网给「哪里」参照，边界给「哪个乡镇」归属。
//     Overpass 拉取是异步的，4.6 到输出整体放在 async 主体里（CommonJS 无顶层 await）。
(async () => {
const osm = await fetchOsmFeatures(fetchBounds);
const osmFeatures = osm && Array.isArray(osm.elements) ? osm.elements : null;
let roadCount = 0, riverCount = 0;
if (osmFeatures) {
  // 河流按实际长度过滤：OSM 里很多小溪也被标成 waterway=river，
  // 只保留 ≥12km 的干流河道（沅水、舞水这一级），否则又是满图细蓝线。
  const polylineKm = (pts) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * (geo.BAKE_BOUNDS.east - geo.BAKE_BOUNDS.west) * 98.6 / PX;
    }
    return s;
  };
  osmFeatures.forEach((el) => {
    if (el.type !== 'way' || !el.geometry) return;
    const tags = el.tags || {};
    const pts = el.geometry
      .filter((g) => g && isFinite(g.lat) && isFinite(g.lon))
      .map((g) => proj.toPx(g.lon, g.lat));
    if (pts.length < 2) return;
    if (tags.waterway === 'river') {
      if (polylineKm(pts) < 12) return;
      riverCount++;
      // 实色不透明（半透明蓝叠在晕渲上会显成一层「光晕」，用户已反馈）；
      // 简化+平滑去掉源数据在像素尺度上的噪声抖动（直角阶梯感）
      strokePolyline(smoothLine(pts), [88, 144, 186], 2.0);
    } else if (tags.highway === 'motorway' || tags.highway === 'trunk') {
      roadCount++;
      strokePolyline(smoothLine(pts), [196, 146, 82], 1.6);
    } else if (tags.highway === 'primary') {
      roadCount++;
      strokePolyline(smoothLine(pts), [208, 176, 124], 1.2);
    }
  });
  console.log('路网/水系：公路 ' + roadCount + ' 条、河流 ' + riverCount + ' 条');
} else {
  console.log('警告：Overpass 不可用，本次底图不含路网/水系（不影响其他内容，下次烘焙会补上）');
}

// 4.7 县境外轮廓：1px 清晰实线（半透明晕边 = 光晕，与河流互相干扰，已按用户要求删除）
const mask = new Float32Array(PX * PX);
towns.forEach((t) => t.rings.forEach((r) => rasterizeMask([r], mask)));
const edge = [];
for (let y = 1; y < PX - 1; y++) {
  for (let x = 1; x < PX - 1; x++) {
    if (mask[y * PX + x] > 0.5 && (mask[y * PX + x - 1] < 0.5 || mask[y * PX + x + 1] < 0.5 || mask[(y - 1) * PX + x] < 0.5 || mask[(y + 1) * PX + x] < 0.5)) edge.push([x, y]);
  }
}
edge.forEach(([x, y]) => setPx(x, y, 76, 124, 164, 1));

// 4.8 乡镇界：1.4px 细实线，全不透明（半透明会在段接缝处叠加出深色斑点）
towns.forEach((t) => t.rings.forEach((r) => strokeRing(r, [146, 182, 204], 1.4)));

// ============ 5. 输出 ============
const outDir = path.join(ROOT, 'assets', 'basemap');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'zhongfang.png');
const finalBuf = Buffer.alloc(PX * PX * 4);
let clipped = 0;
for (let i = 0; i < buf.length; i++) {
  const v = buf[i];
  if (v < 0 || v > 255) clipped++;
  finalBuf[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
fs.writeFileSync(outFile, encodePNG(PX, PX, finalBuf));
// 诊断：把光栅缓冲落盘，便于与 PNG 解码结果逐字节对拍
let nonFinite = 0;
for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) nonFinite++;
console.log('  非有限值像素分量 ' + nonFinite + ' 个');
fs.mkdirSync(path.join(ROOT, '.ekko-tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.ekko-tmp', 'basemap-raw.bin'), finalBuf);

console.log('烘焙底图: assets/basemap/zhongfang.png');
console.log('  尺寸 ' + PX + '×' + PX + '  字节 ' + fs.statSync(outFile).size);
console.log('  地理范围 W' + geo.BAKE_BOUNDS.west.toFixed(6) + ' E' + geo.BAKE_BOUNDS.east.toFixed(6) +
  ' S' + geo.BAKE_BOUNDS.south.toFixed(6) + ' N' + geo.BAKE_BOUNDS.north.toFixed(6));
console.log('  乡镇 ' + towns.length + ' 个 / 环 ' + totalRings + ' 个 / 边界点 ' + totalPts + ' 个');
console.log('  越界像素（已裁剪到 0~255）' + clipped + ' 个');

// 文字版自检：把剪影降采样成 ASCII，肉眼确认形状
console.log('\n剪影自检（# 为县域）:');
const CW = 56, CH = 26;
for (let ry = 0; ry < CH; ry++) {
  let line = '';
  for (let rx = 0; rx < CW; rx++) {
    let hit = 0, n = 0;
    for (let y = Math.floor((ry * PX) / CH); y < Math.floor(((ry + 1) * PX) / CH); y += 3) {
      for (let x = Math.floor((rx * PX) / CW); x < Math.floor(((rx + 1) * PX) / CW); x += 3) { n++; if (mask[y * PX + x] > 0.5) hit++; }
    }
    const r = n ? hit / n : 0;
    line += r > 0.6 ? '#' : r > 0.25 ? '+' : r > 0.05 ? '.' : ' ';
  }
  console.log('  ' + line);
}
})();
