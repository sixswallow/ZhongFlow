/**
 * 烘焙地形晕渲（hillshade）
 * 数据：AWS Open Data 的 Terrain Tiles（Terrarium 编码，免 key）
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *   高程 = (R*256 + G + B/256) - 32768 （米）
 * 输出：assets/basemap/hillshade.png —— 512×512 灰度，覆盖范围与烘焙底图完全一致（geoLayer.BAKE_BOUNDS），
 *   这样在 canvas 里可以用与底图相同的矩形直接叠上去，不会错位。
 */
const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const R = path.join(__dirname, '..') + path.sep;
const geo = require(R + 'utils/geoLayer.js');
const { decodePng } = require(R + 'cloudfunctions/getWeather/lib/radarTruth.js');

const TILE = 256;
const OUT_PX = 384; // 2026-09-30 降采样压体积：384×384（约 780m/像素），起伏用它当背景足够
const Z = 9; // 约 271 m/像素，和 512px/300km（586m/px）匹配得足够好
const B = geo.BAKE_BOUNDS;

const get = (url) => new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'User-Agent': 'zhongflow-bake' } }, (res) => {
    const c = [];
    res.on('data', (d) => c.push(d));
    res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c) }));
  });
  req.setTimeout(40 * 1000, () => req.destroy(new Error('timeout')));
  req.on('error', reject);
});
const gx = (lng, z) => ((lng + 180) / 360) * TILE * Math.pow(2, z);
const gy = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
};

// 最小 PNG 编码器（灰度 8 位，filter 0）—— 只在 Node 侧用，小程序只需读
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
};
const encodeGrayPng = (px, w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit 灰度
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; px.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

(async () => {
  const x0 = Math.floor(gx(B.west, Z) / TILE), x1 = Math.floor(gx(B.east, Z) / TILE);
  const y0 = Math.floor(gy(B.north, Z) / TILE), y1 = Math.floor(gy(B.south, Z) / TILE);
  console.log('范围 W' + B.west.toFixed(3) + ' E' + B.east.toFixed(3) + ' / S' + B.south.toFixed(3) + ' N' + B.north.toFixed(3));
  console.log('z' + Z + ' 瓦片 ' + (x1 - x0 + 1) + '×' + (y1 - y0 + 1) + ' = ' + ((x1 - x0 + 1) * (y1 - y0 + 1)) + ' 张');

  const elev = new Float32Array(OUT_PX * OUT_PX).fill(NaN);
  let ok = 0, fail = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + Z + '/' + x + '/' + y + '.png';
      let img = null;
      for (let attempt = 0; attempt < 3 && !img; attempt++) {
        try {
          const r = await get(url);
          if (r.status === 200) { img = decodePng(r.buf); ok++; }
          else if (attempt === 2) fail++;
          else await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        } catch (e) {
          if (attempt === 2) fail++;
          else await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        }
      }
      if (!img) continue;
      // 把该瓦片逐像素写进输出栅格（x、y 两个方向都要遍历）
      const world = TILE * Math.pow(2, Z);
      for (let py = 0; py < TILE; py++) {
        const tGy = y * TILE + py + 0.5;
        const n = Math.PI - (2 * Math.PI * tGy) / world;
        const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        const oy = Math.round(((B.north - lat) / (B.north - B.south)) * (OUT_PX - 1));
        if (oy < 0 || oy >= OUT_PX) continue;
        for (let px = 0; px < TILE; px++) {
          const tGx = x * TILE + px + 0.5;
          const lng = (tGx / world) * 360 - 180;
          const ox = Math.round(((lng - B.west) / (B.east - B.west)) * (OUT_PX - 1));
          if (ox < 0 || ox >= OUT_PX) continue;
          const i = (py * img.width + Math.min(img.width - 1, px)) * img.channels;
          elev[oy * OUT_PX + ox] = (img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256) - 32768;
        }
      }
    }
  }
  console.log('瓦片成功 ' + ok + ' / 失败 ' + fail);
  // 异常高程（空瓦片/边缘）标为 NaN，再用有效邻域填补 —— 否则会算出假的陡坡
  let bad = 0;
  for (let i = 0; i < elev.length; i++) {
    if (!isFinite(elev[i]) || elev[i] < -50 || elev[i] > 3000) { elev[i] = NaN; bad++; }
  }
  console.log('剔除异常高程 ' + bad + ' 个像素');
  for (let pass = 0; pass < 6; pass++) {
    let filled = 0;
    const copy = Float32Array.from(elev);
    for (let y = 0; y < OUT_PX; y++) {
      for (let x = 0; x < OUT_PX; x++) {
        const i = y * OUT_PX + x;
        if (isFinite(copy[i])) continue;
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= OUT_PX || yy < 0 || yy >= OUT_PX) continue;
            const v = copy[yy * OUT_PX + xx];
            if (isFinite(v)) { sum += v; n++; }
          }
        }
        if (n) { elev[i] = sum / n; filled++; }
      }
    }
    if (!filled) break;
  }
  let mn = 1e9, mx = -1e9, n = 0;
  for (let i = 0; i < elev.length; i++) if (isFinite(elev[i])) { if (elev[i] < mn) mn = elev[i]; if (elev[i] > mx) mx = elev[i]; n++; }
  console.log('高程范围 ' + mn.toFixed(0) + ' ~ ' + mx.toFixed(0) + ' m；有效像素 ' + n + '/' + elev.length);
  if (n < elev.length * 0.85) { console.log('有效数据不足，先不写文件'); process.exit(1); }

  // 晕渲：西北方向光照（方位 315°，高度角 45°）
  const pxPerM = (Math.abs(B.east - B.west) * 111412.84 * Math.cos(27.5 * Math.PI / 180)) / OUT_PX;
  const az = (360 - 315 + 90) * Math.PI / 180;
  const alt = 45 * Math.PI / 180;
  const out = Buffer.alloc(OUT_PX * OUT_PX);
  const at = (x, y) => elev[Math.max(0, Math.min(OUT_PX - 1, y)) * OUT_PX + Math.max(0, Math.min(OUT_PX - 1, x))];
  for (let y = 0; y < OUT_PX; y++) {
    for (let x = 0; x < OUT_PX; x++) {
      const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * pxPerM);
      const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * pxPerM);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let shade = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);
      shade = Math.max(0, Math.min(1, shade));
      // 归一化成灰度：中等灰＝平地，亮＝迎光坡，暗＝背光坡
      out[y * OUT_PX + x] = Math.round(128 + (shade - 0.5) * 210);
    }
  }
  // 平滑两遍：去掉 DEM 的逐像素噪声（也让 PNG 明显变小）。晕渲只作视觉参考，平滑不影响它「看出山谷山脊」的用途。
  let blurred = out;
  for (let pass = 0; pass < 2; pass++) {
    const next = Buffer.alloc(OUT_PX * OUT_PX);
    for (let y = 0; y < OUT_PX; y++) {
      for (let x = 0; x < OUT_PX; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= OUT_PX || yy < 0 || yy >= OUT_PX) continue;
            sum += blurred[yy * OUT_PX + xx]; n++;
          }
        }
        next[y * OUT_PX + x] = Math.round(sum / n);
      }
    }
    blurred = next;
  }
  const buf = encodeGrayPng(blurred, OUT_PX, OUT_PX);
  fs.mkdirSync(R + 'assets/basemap', { recursive: true });
  fs.writeFileSync(R + 'assets/basemap/hillshade.png', buf);
  console.log('已写入 assets/basemap/hillshade.png  ' + buf.length + ' 字节（' + OUT_PX + '×' + OUT_PX + ' 灰度）');
  console.log('每像素约 ' + pxPerM.toFixed(0) + ' m');
})();
