// 风场图层（Open-Meteo 免费接口 + canvas 粒子平流）
//
// 数据：一次 GET 取回整片网格的风速/风向（实测 99 点约 40KB，坐标会被吸附到模式网格）。
// 算法：把风向转成屏幕坐标下的 u/v 分量，用双线性插值采样，驱动粒子在画布上平流，
//       每帧用半透明矩形「淡化」上一帧形成拖尾（而不是清屏）。
//
// ⚠️ 风向是「来向」（气象惯例）：wind_direction_10m = 0 表示北风（自北方吹来、向南运动）。
//    屏幕坐标系 y 向下，故：u = -speed·sin(θ)，v = +speed·cos(θ)。
//    这一处最易写错，已在 tests/layer-wind.test.js 里锁定方向语义。
//
// 本模块只做纯计算（可被 Node 直接 require）：取点、拼 URL、解析、插值、粒子推进。

const geo = require('./geoLayer.js');

const WIND = {
  API: 'https://api.open-meteo.com/v1/forecast',
  GRID_X: 11,          // 经度方向网格数
  GRID_Y: 9,           // 纬度方向网格数
  SPEED_UNIT: 'ms',
  TTL: 30 * 60 * 1000, // 风场缓存 30 分钟（Open-Meteo 15 分钟更新一次）
  // 显示换算：1 m/s 对应每秒移动的 CSS 像素。偏夸张是风场动画的惯例，
  // 2m/s 时约 60px/s，横穿 271px 画布约 4.5 秒。
  PX_PER_MS_PER_SEC: 30,
  PARTICLE_AREA: 220,  // 每个粒子分摊的画布面积（CSS 像素²）
  PARTICLE_MIN: 200,
  PARTICLE_MAX: 900,
  // 每个粒子保留的历史位置点数：直接画折线形成流线拖尾，
  // 免去「离屏画布 + 每帧淡化」那套（真机上更稳、更省）。
  TRAIL_LEN: 24,          // 拖尾加长（真机预览验证过：7 帧像散点，24 帧才是流线）
  // 粒子密度按预览的效果定：620×520 画布用 350 个 ≈ 每 900px² 一个
  PARTICLE_AREA: 900,
  PARTICLE_MIN: 140,
  PARTICLE_MAX: 700,
  // 逐小时时段（未来）：风场有未来数据，这是雷达回波给不了的
  HOURS: 12,
  // 风速填色：8 档色带（浅青 → 紫红）
  FILL_RAMP: [
    [214, 236, 245, 150], [170, 214, 233, 168], [128, 190, 224, 182], [96, 196, 196, 190],
    [126, 205, 142, 194], [222, 214, 108, 198], [236, 168, 82, 204], [214, 96, 116, 210],
  ],
  // 色阶最小跨度（m/s）：自适应但不能让微风看起来像大风
  MIN_SPEED_SPAN: 4,
  SOURCE_NOTE: '模式预报 · ICON 11km · 非实测',
};

// 行优先网格：j（纬度，北→南）外层，i（经度，西→东）内层
const buildPoints = (view, gridX, gridY) => {
  const gx = gridX || WIND.GRID_X, gy = gridY || WIND.GRID_Y;
  const points = [];
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      points.push({
        latitude: Number((view.north - (view.north - view.south) * (j / (gy - 1))).toFixed(6)),
        longitude: Number((view.west + (view.east - view.west) * (i / (gx - 1))).toFixed(6)),
      });
    }
  }
  return points;
};

const buildUrl = (points) => WIND.API +
  '?latitude=' + points.map((p) => p.latitude).join(',') +
  '&longitude=' + points.map((p) => p.longitude).join(',') +
  '&current=wind_speed_10m,wind_direction_10m' +
  '&wind_speed_unit=' + WIND.SPEED_UNIT +
  '&timezone=auto';

// 逐小时风场：一次请求拿回整片网格未来若干小时的序列
const buildHourlyUrl = (points, hours) =>
  WIND.API +
  '?latitude=' + points.map((p) => p.latitude).join(',') +
  '&longitude=' + points.map((p) => p.longitude).join(',') +
  '&hourly=wind_speed_10m,wind_direction_10m' +
  '&wind_speed_unit=' + WIND.SPEED_UNIT +
  '&forecast_days=2&timezone=Asia%2FShanghai&models=icon_seamless';

// 由「某一时刻的 u/v 数组」拼出一个与 parseField 完全同形的 field，
// 这样粒子推进与采样代码不用为「未来时段」写第二套。
const fieldFromFrame = (u, v, speed, direction, gx, gy, bounds, timeStamp) => {
  let minSpeed = Infinity, maxSpeed = -Infinity, sumU = 0, sumV = 0, valid = 0;
  for (let k = 0; k < u.length; k++) {
    sumU += u[k]; sumV += v[k];
    if (speed[k] >= 0) { minSpeed = Math.min(minSpeed, speed[k]); maxSpeed = Math.max(maxSpeed, speed[k]); valid++; }
  }
  if (!valid) { minSpeed = 0; maxSpeed = 0; }
  return {
    gx, gy, u, v, speed, direction, valid,
    minSpeed, maxSpeed,
    meanU: sumU / u.length, meanV: sumV / u.length,
    timeStamp,
    bounds: bounds || null,
  };
};

// 北京时间「现在」在时间轴上的下标（返回的时刻串是 Asia/Shanghai，不能用 toISOString 直接比）
const hourIndex = (times, nowMs) => {
  const t = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
  for (let i = 0; i < times.length; i++) if (times[i] >= t) return i;
  return Math.max(0, times.length - 1);
};

// 时间轴：现在起若干小时，标签「现在 / +1 小时 / …」
const hourlyPlan = (times, nowMs, hours) => {
  const start = hourIndex(times, nowMs);
  const out = [];
  const n = hours || WIND.HOURS;
  for (let k = 0; k < n && start + k < times.length; k++) {
    out.push({ index: start + k, time: times[start + k], label: k === 0 ? '现在' : '+' + k + ' 小时' });
  }
  return out;
};

const parseHourly = (json, gridX, gridY, bounds, nowMs) => {
  const gx = gridX || WIND.GRID_X, gy = gridY || WIND.GRID_Y;
  const items = Array.isArray(json) ? json : (json && Array.isArray(json.results) ? json.results : [json]);
  if (items.length !== gx * gy) {
    throw new Error('风场网格数量不符：期望 ' + (gx * gy) + '，实际 ' + items.length);
  }
  const times = (items[0] && items[0].hourly && items[0].hourly.time) || [];
  if (!times.length) throw new Error('风场数据里没有逐小时时段');
  const plan = hourlyPlan(times, nowMs);
  const frames = plan.map((p) => {
    const u = new Float32Array(items.length);
    const v = new Float32Array(items.length);
    const speed = new Float32Array(items.length);
    const direction = new Float32Array(items.length);
    for (let k = 0; k < items.length; k++) {
      const h = items[k].hourly || {};
      const sp = Number((h.wind_speed_10m || [])[p.index]);
      const dir = Number((h.wind_direction_10m || [])[p.index]);
      const ok = isFinite(sp) && isFinite(dir);
      const theta = (ok ? dir : 0) * Math.PI / 180;
      u[k] = ok ? -sp * Math.sin(theta) : 0;
      v[k] = ok ? sp * Math.cos(theta) : 0;
      speed[k] = ok ? sp : -1;
      direction[k] = ok ? ((dir % 360) + 360) % 360 : 0;
    }
    return {
      index: p.index, time: p.time, label: p.label,
      field: fieldFromFrame(u, v, speed, direction, gx, gy, bounds, Date.parse(p.time.replace('T', ' ') + ':00Z')),
    };
  });
  return { times, grid: { gx, gy }, frames };
};

const readCurrent = (item) => {
  if (!item) return null;
  const cur = item.current || item;
  const speed = Number(cur.wind_speed_10m);
  const dir = Number(cur.wind_direction_10m);
  if (!isFinite(speed) || !isFinite(dir)) return null;
  return { speed, direction: ((dir % 360) + 360) % 360 };
};

// 解析多点返回：按数组顺序对应网格（Open-Meteo 可能缺省首个 location_id，故不依赖它）
const parseField = (json, gridX, gridY, timeStamp, bounds) => {
  const gx = gridX || WIND.GRID_X, gy = gridY || WIND.GRID_Y;
  const items = Array.isArray(json) ? json : (json && Array.isArray(json.results) ? json.results : [json]);
  if (items.length !== gx * gy) {
    throw new Error('风场网格数量不符：期望 ' + (gx * gy) + '，实际 ' + items.length);
  }
  const u = new Float32Array(gx * gy);
  const v = new Float32Array(gx * gy);
  const speed = new Float32Array(gx * gy);
  const direction = new Float32Array(gx * gy);
  let minSpeed = Infinity, maxSpeed = -Infinity, sumU = 0, sumV = 0, valid = 0;
  for (let k = 0; k < items.length; k++) {
    const c = readCurrent(items[k]);
    const s = c ? c.speed : 0;
    const theta = c ? c.direction * Math.PI / 180 : 0;
    // 来向 → 运动方向（屏幕 y 向下）
    const uu = -s * Math.sin(theta);
    const vv = s * Math.cos(theta);
    u[k] = uu; v[k] = vv; speed[k] = s; direction[k] = c ? c.direction : 0;
    sumU += uu; sumV += vv;
    if (c) { minSpeed = Math.min(minSpeed, s); maxSpeed = Math.max(maxSpeed, s); valid++; }
  }
  if (!valid) { minSpeed = 0; maxSpeed = 0; }
  return {
    gx, gy, u, v, speed, direction, valid,
    minSpeed, maxSpeed,
    meanU: sumU / items.length, meanV: sumV / items.length,
    timeStamp: timeStamp || Date.now(),
    // 取样范围：缩放/平移后靠它把画布像素反算成经纬度再采样，风场因此不会跟着视窗一起变形
    bounds: bounds || null,
  };
};

// 自适应色阶：按本帧实际风速范围分 8 档，但保证最小跨度，
// 免得「微风」被画成「大风」的错觉。图例里显示的就是这里算出来的真实数值。
const scaleForField = (field) => {
  const lo = field && isFinite(field.minSpeed) ? field.minSpeed : 0;
  const hiRaw = field && isFinite(field.maxSpeed) ? field.maxSpeed : 0;
  const span = Math.max(WIND.MIN_SPEED_SPAN, hiRaw - lo);
  const hi = lo + span;
  const steps = WIND.FILL_RAMP.map((c, i) => ({
    lo: lo + (span * i) / WIND.FILL_RAMP.length,
    hi: lo + (span * (i + 1)) / WIND.FILL_RAMP.length,
    rgba: 'rgba(' + c.join(',') + ')',
  }));
  return { lo, hi, steps };
};

const fillColorAt = (speed, scale) => {
  if (!scale) return null;
  const t = (speed - scale.lo) / (scale.hi - scale.lo);
  let i = Math.floor(t * scale.steps.length);
  i = Math.max(0, Math.min(scale.steps.length - 1, i));
  return scale.steps[i].rgba;
};

// 图例：真实数值（不是硬编码的分级）
const speedLegend = (scale) => (scale ? scale.steps.slice().reverse().map((s2) => ({ lo: s2.lo, hi: s2.hi, color: s2.rgba })) : []);

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// 按归一化坐标（0~1）双线性采样
const sampleField = (field, nx, ny) => {
  if (!field) return { u: 0, v: 0 };
  const fx = clamp01(nx) * (field.gx - 1);
  const fy = clamp01(ny) * (field.gy - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const i1 = Math.min(field.gx - 1, i0 + 1), j1 = Math.min(field.gy - 1, j0 + 1);
  const tx = fx - i0, ty = fy - j0;
  const at = (arr, i, j) => arr[j * field.gx + i];
  const mix = (arr) =>
    (at(arr, i0, j0) * (1 - tx) + at(arr, i1, j0) * tx) * (1 - ty) +
    (at(arr, i0, j1) * (1 - tx) + at(arr, i1, j1) * tx) * ty;
  return { u: mix(field.u), v: mix(field.v) };
};

// 视窗是否仍落在已取回的风场范围内（margin 为按风场跨度折算的安全边距）
const fieldCovers = (field, view, margin) => {
  if (!field || !field.bounds || !view) return false;
  const b = field.bounds;
  const m = (margin || 0) * Math.max(b.east - b.west, b.north - b.south);
  return view.west >= b.west + m && view.east <= b.east - m &&
    view.south >= b.south + m && view.north <= b.north - m;
};

// 网格相对视窗是否已经太粗（放大后应换更密的网格，越放大越细腻）
const needsDenserGrid = (field, view, ratio) => {
  if (!field || !field.bounds || !view) return false;
  const fieldKm = (field.bounds.east - field.bounds.west) *
    (111.32 * Math.cos(((field.bounds.north + field.bounds.south) / 2) * Math.PI / 180));
  const viewKm = (view.east - view.west) *
    (111.32 * Math.cos(((view.north + view.south) / 2) * Math.PI / 180));
  if (viewKm <= 0) return false;
  return fieldKm / viewKm > (ratio || 2.2);
};

// 跨度分档（1.4 倍一档）：档位不变就不必重新请求
const spanBucket = (spanKm) => Math.round(Math.log(Math.max(1, spanKm) / 25) / Math.log(1.4));

// 按经纬度采样（画布像素 -> 经纬度 -> 网格），这是缩放平移下风场不变形的前提
const sampleFieldAt = (field, lng, lat) => {
  if (!field || !field.bounds) return { u: 0, v: 0 };
  const b = field.bounds;
  const nx = (lng - b.west) / (b.east - b.west);
  const ny = (b.north - lat) / (b.north - b.south);
  return sampleField(field, nx, ny);
};

const particleCountFor = (width, height) => {
  const n = Math.round((width * height) / WIND.PARTICLE_AREA);
  return Math.max(WIND.PARTICLE_MIN, Math.min(WIND.PARTICLE_MAX, n));
};

const createParticles = (count, width, height, rng, trailLen) => {
  const r = rng || Math.random;
  const len = trailLen || WIND.TRAIL_LEN;
  const list = [];
  for (let i = 0; i < count; i++) {
    const x = r() * width, y = r() * height;
    list.push({ x, y, x0: x, y0: y, age: 0, maxAge: 60 + Math.floor(r() * 90), trailLen: len, trail: [{ x, y }] });
  }
  return list;
};

// 每帧推进一步：先记录旧位置（供画线段），再按风场位移；越界或超龄则重生
// sampler(x, y) 由页面按当前视窗注入（画布像素 -> 风矢量），这样缩放平移都不会让风场变形
const advanceParticles = (particles, sampler, dtSec, width, height, rng) => {
  const r = rng || Math.random;
  const k = WIND.PX_PER_MS_PER_SEC * dtSec;
  const sample = typeof sampler === 'function' ? sampler : () => ({ u: 0, v: 0 });
  let respawned = 0;
  for (let n = 0; n < particles.length; n++) {
    const p = particles[n];
    p.x0 = p.x; p.y0 = p.y;
    const s = sample(p.x, p.y);
    p.x += s.u * k;
    p.y += s.v * k;
    p.age++;
    if (!p.trail) p.trail = [{ x: p.x0, y: p.y0 }]; // 容错：外部构造的粒子也要能推进
    p.trail.push({ x: p.x, y: p.y });
    const cap = p.trailLen || WIND.TRAIL_LEN;
    while (p.trail.length > cap) p.trail.shift();
    if (p.age > p.maxAge || p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
      p.x = r() * width; p.y = r() * height;
      p.x0 = p.x; p.y0 = p.y;
      p.age = 0; p.maxAge = 60 + Math.floor(r() * 90);
      p.trail = [{ x: p.x, y: p.y }];
      respawned++;
    }
  }
  return { moved: particles.length, respawned };
};

// 蒲福风级（与项目其它位置的风级口径一致）
const beaufort = (ms) => {
  const t = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  for (let i = 0; i < t.length; i++) if (ms < t[i]) return i;
  return 12;
};

const DIRECTION_LABELS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const directionLabel = (deg) => DIRECTION_LABELS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// 某个经纬度上的风：给值班直接读数用（如「铜湾 2 级东北风 3.1m/s」）
const describePoint = (field, lng, lat) => {
  const s2 = sampleFieldAt(field, lng, lat);
  const speed = Math.sqrt(s2.u * s2.u + s2.v * s2.v);
  if (speed < 0.05) return { speed: 0, level: 0, label: '静风', text: '静风' };
  // 反解来向：u = -s·sin(θ), v = +s·cos(θ) ⇒ θ = atan2(-u, v)。与 meanVector 用同一个式子，
  // 写错就会整体反 180°（本项目的老坑，已有测试锁定）。
  const from = ((Math.atan2(-s2.u, s2.v) * 180) / Math.PI + 360) % 360;
  const label = directionLabel(from) + '风';
  const level = beaufort(speed);
  return { speed, level, label, text: level + ' 级' + label + ' ' + speed.toFixed(1) + 'm/s' };
};

const meanVector = (field) => {
  if (!field) return { speed: 0, direction: 0, label: '静风' };
  const u = field.meanU, v = field.meanV;
  const speed = Math.sqrt(u * u + v * v);
  if (speed < 0.05) return { speed: 0, direction: 0, label: '静风' };
  // 反解来向：u = -s·sin(θ), v = +s·cos(θ)
  const theta = (Math.atan2(-u, v) * 180) / Math.PI;
  const direction = ((theta % 360) + 360) % 360;
  return { speed, direction, label: directionLabel(direction) + '风' };
};

module.exports = {
  WIND,
  buildPoints,
  buildUrl,
  buildHourlyUrl,
  parseHourly,
  hourlyPlan,
  hourIndex,
  scaleForField,
  fillColorAt,
  speedLegend,
  describePoint,
  parseField,
  sampleField,
  sampleFieldAt,
  fieldCovers,
  needsDenserGrid,
  spanBucket,
  particleCountFor,
  createParticles,
  advanceParticles,
  beaufort,
  directionLabel,
  meanVector,
};
