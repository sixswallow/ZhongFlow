/**
 * 阿里云函数 - 天气数据接口
 *
 * 功能：
 * 1. 实时天气 + 逐小时 + 7天预报（彩云/和风）
 * 2. 乡镇级短临降水预报（彩云天气 minutely）
 *
 * 调用方式：
 * - GET /?latitude=xxx&longitude=xxx&provider=caiyun
 * - GET /?mode=nowcast&townshipCode=xxx   # 乡镇短临预报
 * - GET /?mode=nowcast                    # 全县12乡镇短临预报
 */
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const radarTruth = require('./lib/radarTruth.js');
const { TOWNSHIP_RINGS } = require('./lib/radarTownships.js');

// 彩云天气 API 认证配置（推荐使用 App Key + App Secret 签名认证）
const CAIYUN_APP_KEY = process.env.CAIYUN_APP_KEY || 'YOUR_CAIYUN_APP_KEY';
const CAIYUN_APP_SECRET = process.env.CAIYUN_APP_SECRET || 'YOUR_CAIYUN_APP_SECRET';
const CAIYUN_TOKEN = process.env.CAIYUN_TOKEN || 'YOUR_CAIYUN_TOKEN'; // Token 认证（不推荐）

const QWEATHER_KEY = process.env.QWEATHER_KEY || 'YOUR_QWEATHER_KEY';
// 和风鉴权有两代：
//   新版（推荐）：自有 API Host + JWT（Ed25519 签名，Authorization: Bearer）。需要
//     QWEATHER_HOST（控制台-设置里的 API Host）/ QWEATHER_KID（凭据ID）/
//     QWEATHER_ISSUER（开发者ID，Q 开头 10 位）/ QWEATHER_PROJECT（项目ID）/
//     QWEATHER_PRIVATE_KEY（Ed25519 私钥 PEM 全文，换行可写成反斜杠加 n）或 QWEATHER_PRIVATE_KEY_B64。
//     公钥上传到和风控制台供其验签，私钥只留在云函数里。
//   旧版：公共地址 + URL 上的 ?key=（公共地址从 2026 年起逐步停止服务）
//   也可只用 API KEY 凭据：QWEATHER_HOST + QWEATHER_KEY
const QWEATHER_HOST = process.env.QWEATHER_HOST || 'devapi.qweather.com';
const QWEATHER_KID = process.env.QWEATHER_KID || '';
const QWEATHER_ISSUER = process.env.QWEATHER_ISSUER || '';
const QWEATHER_PROJECT = process.env.QWEATHER_PROJECT || '';
const QWEATHER_PRIVATE_KEY = process.env.QWEATHER_PRIVATE_KEY || '';
const QWEATHER_PRIVATE_KEY_B64 = process.env.QWEATHER_PRIVATE_KEY_B64 || '';
const QWEATHER_TOKEN = process.env.QWEATHER_TOKEN || '';   // 直接给现成 token（会过期，不推荐）
const QWEATHER_JWT_TTL_SEC = 900;                          // 和风允许最长 24 小时，这里取 15 分钟
let qweatherJwtCache = null;
// 短临数据源：auto = 配了和风就优先和风、失败回落彩云；也可强制 caiyun / qweather
const NOWCAST_PROVIDER = String(process.env.NOWCAST_PROVIDER || 'auto').toLowerCase();
// 和风有「每分钟请求数」限制（429 即超限）。12 个乡镇必须串行 + 间隔，绝不能并发一起打。
const NOWCAST_QPM_GAP_MS = 150;
const QWEATHER_SLOT_MIN = 5;         // 和风分钟级降水：每 5 分钟一档，共 24 档（未来 2 小时）
const QWEATHER_MINUTELY_PATH = '/v7/minutely/5m';
const MINUTE_SERIES_MAX = 120;       // 未来 2 小时 = 120 分钟
// 数据来源与人话标签（供载荷与日志使用，必须与实际数据源一致；界面上的来源由前端 sourceLabel 呈现）
const NOWCAST_SOURCE_LABEL = {
  caiyun: '彩云天气分钟级降雨预报 API（1 分钟一档）',
  qweather: '和风天气分钟级降水 API（1km，5 分钟一档）'
};
const NOWCAST_FAIL_LABEL = { caiyun: '彩云天气', qweather: '和风天气' };

const CAIYUN_HOST = 'api.caiyunapp.com';
const CAIYUN_VERSION = 'v2.6';

// 中方县12个现行乡镇：代码依据国家统计局2024区划目录，坐标取公开村级边界聚合后的面内中心。
const TOWNSHIPS = [
  { code: '431221100', name: '中方镇', lng: 109.956492, lat: 27.384400 },
  { code: '431221105', name: '桐木镇', lng: 109.841102, lat: 27.323124 },
  { code: '431221103', name: '花桥镇', lng: 110.198491, lat: 27.672248 },
  { code: '431221104', name: '铜湾镇', lng: 110.296347, lat: 27.577230 },
  { code: '431221102', name: '泸阳镇', lng: 110.109879, lat: 27.631673 },
  { code: '431221107', name: '新建镇', lng: 110.159791, lat: 27.528873 },
  { code: '431221108', name: '接龙镇', lng: 110.358992, lat: 27.535877 },
  { code: '431221106', name: '铁坡镇', lng: 110.392671, lat: 27.456497 },
  { code: '431221111', name: '袁家镇', lng: 110.200451, lat: 27.467097 },
  { code: '431221110', name: '新路河镇', lng: 110.298617, lat: 27.474079 },
  { code: '431221109', name: '铜鼎镇', lng: 110.303886, lat: 27.635909 },
  { code: '431221214', name: '蒿吉坪瑶族乡', lng: 110.434880, lat: 27.557058 }
];

const NOWCAST_STEP_MIN = 6;
const NOWCAST_FRAMES = 21;
// 起始 / 最强时刻改用彩云 precipitation_2h 的 1 分钟强度序列（mm/h）判定。
// 彩云 minutely 的 probability 只有 30 分钟一档，用它定「几分钟后开始下雨」会丢掉分钟级精度。
const NOWCAST_RAIN_THRESHOLD = 0.1;
let nowcastCache = null;

const weatherMap = {
  CLEAR_DAY: '晴', CLEAR_NIGHT: '晴',
  PARTLY_CLOUDY_DAY: '多云', PARTLY_CLOUDY_NIGHT: '多云',
  CLOUDY: '阴',
  LIGHT_HAZE: '轻度雾霾', MODERATE_HAZE: '中度雾霾', HEAVY_HAZE: '重度雾霾',
  LIGHT_RAIN: '小雨', MODERATE_RAIN: '中雨', HEAVY_RAIN: '大雨', STORM_RAIN: '暴雨',
  FOG: '雾',
  LIGHT_SNOW: '小雪', MODERATE_SNOW: '中雪', HEAVY_SNOW: '大雪', STORM_SNOW: '暴雪',
  DUST: '浮尘', SAND: '沙尘', WIND: '大风'
};

const windDirMap = {
  N: '北风', NNE: '东北偏北', NE: '东北风', ENE: '东北偏东',
  E: '东风', ESE: '东南偏东', SE: '东南风', SSE: '东南偏南',
  S: '南风', SSW: '西南偏南', SW: '西南风', WSW: '西南偏西',
  W: '西风', WNW: '西北偏西', NW: '西北风', NNW: '西北偏北'
};

exports.handler = async (event, context) => {
  const params = getParams(event);
  const { latitude, longitude, provider = 'caiyun', mode, townshipCode } = params;

  // 共享密钥校验（与 getStations 一致）：公网地址可被抓包滥用刷上游配额。
  // 环境变量 API_TOKEN 未配置时放行并告警，避免部署顺序造成线上不可用。
  if (!checkAuth(params)) {
    return respond(403, {
      success: false,
      message: '访问被拒绝：token 校验未通过'
    });
  }

  try {
    if (mode === 'nowcast') {
      return await getNowcast(townshipCode, provider);
    }

    if (mode === 'radar-verify') {
      return await getRadarVerify(params);
    }

    if (!latitude || !longitude) {
      return respond(400, {
        success: false,
        message: '缺少经纬度参数'
      });
    }

    if (provider === 'caiyun') {
      return await getCaiyunWeather(latitude, longitude);
    } else {
      return await getQWeather(latitude, longitude);
    }
  } catch (error) {
    console.error('天气API调用失败', error);
    return respond(500, {
      success: false,
      message: '天气数据获取失败',
      error: error.message
    });
  }
};

// 蒲福风力等级（GB/T 28591-2012）：先把 km/h 换成 m/s，再按级距判定。
// 彩云 realtime.wind.speed 的单位是 km/h（和风分支的 now.windScale 本身就是风级）。
const BEAUFORT_MS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
function beaufortFromKmh(kmh) {
  const ms = Number(kmh) / 3.6;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  for (let i = 0; i < BEAUFORT_MS.length; i++) {
    if (ms < BEAUFORT_MS[i]) return i;
  }
  return 12;
}

// 分钟级降水：取不到就说取不到。
// 2026-09-22 实测：彩云免费档的 /weather 响应里没有 minutely 对象，直连 /minutely 的 12 个
// 乡镇也全部失败。此时若沿用「未来2小时无降水」这类兜底串，页面上就会出现一句没有任何数据
// 支撑的「无降水」——那是假阴性（把「不知道」显示成「没事」）。所以只在真的拿到序列时才给结论。
function buildMinuteBlock(minutely, stepMinutes) {
  const series = minutely && Array.isArray(minutely.precipitation_2h) ? minutely.precipitation_2h : [];
  const available = series.length > 0;
  // 每档间隔：彩云是 1 分钟一档，和风是 5 分钟一档。旧实现把 1 分钟序列按 10 分钟标轴，
  // 一张「未来 2 小时」的图画出来却标到 11:50（等于谎报时段），这里按真实间隔标。
  const step = Number(stepMinutes) > 0 ? Number(stepMinutes) : 1;
  return {
    available,
    stepMinutes: step,
    summary: available ? (minutely.description || '分钟级降水数据已获取') : '分钟级数据暂不可用',
    precipitation: series.map((val, idx) => {
      const mm = Number(val);
      const minute = idx * step;
      return {
        time: String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'),
        value: Number.isFinite(mm) ? parseFloat(mm.toFixed(2)) : 0
      };
    })
  };
}

// 把数据源的错误归成一句人话（访问频率超限 / 超时 / 无权限 必须可分辨），供界面直接展示
function summarizeFailReason(list, label) {
  const joined = (list || []).join(' | ');
  const tag = label ? '（' + label + '）' : '';
  if (/429|rate limit|too many requests/i.test(joined)) return '数据源访问频率超限' + tag;
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(joined)) return '数据源响应超时' + tag;
  if (/403|401|forbidden|unauthorized|permission/i.test(joined)) return '数据源无权限访问' + tag;
  const first = String((list && list[0]) || "").slice(0, 100);
  return first || '未知原因';
}
// ==================== 上游配额保护 ====================
// 彩云免费档有频率/配额限制，超限返回 429（Rate limit exceeded），
// 结果就是「界面空白」——上游一抖动，用户什么都看不到。这里做三件事：
//   1) 成功结果按坐标缓存 WEATHER_CACHE_TTL（彩云自身粒度约 5 分钟，可安全缓存）；
//   2) 上游 429 时退避 UPSTREAM_BACKOFF_MS，不重复打上游；
//   3) 退避期间若手上有 WEATHER_STALE_MAX 以内的成功结果就回落到它，并标记 stale，
//      由界面上的更新时间体现数据新旧（绝不伪造时间）。
// 注意：不做无限期回落。超过 WEATHER_STALE_MAX 的旧预报不展示——按本项目的口径，
// 「宁可不显示，也不显示错值」，一个多小时前的逐小时预报会错位。
const WEATHER_CACHE_TTL = 5 * 60 * 1000;
const WEATHER_STALE_MAX = 40 * 60 * 1000;
const UPSTREAM_BACKOFF_MS = 90 * 1000;
const weatherCache = new Map();
const upstreamBlockUntil = new Map();
const isRateLimited = (msg) => /429|rate limit|too many requests/i.test(String(msg || ''));
const coordKey = (latitude, longitude) => Number(longitude).toFixed(4) + ',' + Number(latitude).toFixed(4);

// ==================== 常规天气 ====================
async function getCaiyunWeather(latitude, longitude) {
  const endpoint = `/${longitude},${latitude}/weather`;
  const query = { 
    lang: 'zh_CN', 
    unit: 'metric'
  };
  
  const key = coordKey(latitude, longitude);
  const nowMs = Date.now();
  const hit = weatherCache.get(key);
  const serveStale = (note) => respond(200, {
    success: true,
    stale: true,
    staleMinutes: Math.round((nowMs - hit.at) / 60000),
    message: note,
    data: hit.data
  });

  if (hit && nowMs - hit.at < WEATHER_CACHE_TTL) {
    return respond(200, { success: true, cached: true, data: hit.data });
  }

  const blockedUntil = upstreamBlockUntil.get(key) || 0;
  if (blockedUntil > nowMs) {
    if (hit && nowMs - hit.at < WEATHER_STALE_MAX) return serveStale('数据源访问频率超限，以下为上次成功结果');
    return respond(429, {
      success: false,
      message: '彩云天气访问频率超限，且没有可用的近期结果',
      retryAfterSec: Math.ceil((blockedUntil - nowMs) / 1000)
    });
  }

  let data;
  try {
    data = await httpsGetCaiyun(endpoint, query);
  } catch (e) {
    if (isRateLimited(e && e.message)) {
      upstreamBlockUntil.set(key, Date.now() + UPSTREAM_BACKOFF_MS);
      if (hit && Date.now() - hit.at < WEATHER_STALE_MAX) return serveStale('数据源访问频率超限，以下为上次成功结果');
      return respond(429, {
        success: false,
        message: '彩云天气访问频率超限',
        error: String(e.message).slice(0, 200)
      });
    }
    throw e;
  }

  if (data.status !== 'ok') {
    return respond(502, {
      success: false,
      message: data.error || '彩云天气API返回错误'
    });
  }

  const result = data.result;
  const realtime = result.realtime;
  const hourly = result.hourly;
  const daily = result.daily;
  const minutely = result.minutely;
  
  const serverTime = data.server_time ? new Date(data.server_time * 1000) : new Date();
  const todayBeijing = getBeijingDateStr(serverTime);

  const transformed = {
    current: {
      temperature: Math.round(realtime.temperature),
      feelsLike: Math.round(realtime.apparent_temperature),
      humidity: Math.round(realtime.humidity * 100),
      windDirection: formatWindDirection(realtime.wind.direction),
      // 界面上显示的是「N级」，必须真的是风力等级：
      // 旧写法 Math.round(speed * 3.6 / 1.6) 既不是 km/h 也不是 m/s，
      // 会把 5.3km/h 的微风（1 级）放大成「12级」台风级。
      windSpeed: beaufortFromKmh(realtime.wind.speed),
      windSpeedKmh: Math.round(realtime.wind.speed),
      windSpeedMs: Math.round((realtime.wind.speed / 3.6) * 10) / 10,
      weather: weatherMap[realtime.skycon] || realtime.skycon,
      weatherCode: realtime.skycon,
      pressure: Math.round(realtime.pres),
      visibility: Math.round(realtime.visibility),
      uvIndex: realtime.ultraviolet ? Math.round(realtime.ultraviolet.index) : 0,
      updateTime: formatDate(serverTime),
      dataTime: formatDate(serverTime)
    },
    hourly: hourly.temperature
      .filter(item => new Date(item.datetime) >= serverTime)
      .slice(0, 24)
      .map((item, index) => {
        const time = new Date(item.datetime);
        return {
          time: formatBeijingHour(time),
          temperature: Math.round(item.value),
          weather: weatherMap[hourly.skycon[index]?.value] || '未知',
          rain: hourly.precipitation?.[index]?.value || 0
        };
      }),
    daily: daily.temperature
      .filter(item => item.date >= todayBeijing)
      .map((item, index) => {
        const rainProb = daily.precipitation?.[index]?.probability || 0;
        return {
          date: formatBeijingDate(new Date(item.date)),
          dayWeather: weatherMap[daily.skycon_08h_20h?.[index]?.value] || '未知',
          nightWeather: weatherMap[daily.skycon_20h_32h?.[index]?.value] || '未知',
          high: Math.round(item.max),
          low: Math.round(item.min),
          rainProb: Math.min(100, Math.max(0, Math.round(rainProb)))
        };
      }),
    minute: buildMinuteBlock(minutely)
  };

  // 彩云免费档的 /weather 不返回 minutely（2026-09-22 线上实测），此时用和风分钟级补上；
  // 补不到就保持「暂不可用」，绝不换一句「无降水」。
  await fillMinuteFromQWeather(transformed, longitude, latitude);

  weatherCache.set(key, { at: Date.now(), data: transformed });
  return respond(200, { success: true, data: transformed });
}

// ==================== 和风常规天气（新 v1 与旧 v7 双形态） ====================
// 2026-09-23 核对官方文档发现：和风已把常规天气迁到新一套「路径 + 结构」——
//   实况   GET /weather/v1/current/{纬度}/{经度}
//   逐小时 GET /weather/v1/hourly/{纬度}/{经度}
//   逐日   GET /weather/v1/daily/{纬度}/{经度}
// 返回的是嵌套对象（temperature.value / hours[] / days[] / precipitation.probability），
// 不再是 /v7/weather/now|24h|7d 的扁平字段（now.temp / hourly[] / daily[]）。
// 而分钟级降水仍在 /v7/minutely/5m（官方文档原文），所以同一个 API Host 上两代路径并存。
// 另外注意 v1 的单位约定与 v7 不同：v1 的湿度与降水概率是 [0,1] 小数，v7 是百分比整数；
// v1 风速是 m/s，v7 是 km/h。混用会得到差 100 倍或 3.6 倍的错值，必须按代区分。
// 策略：先试 v1，不通退回 v7；两代都归一化成项目内部统一结构，并把实际生效的一代记住。
const QWEATHER_WEATHER_PATHS = {
  v1: {
    current: (lat, lon) => ({ path: '/weather/v1/current/' + lat + '/' + lon }),
    hourly: (lat, lon) => ({ path: '/weather/v1/hourly/' + lat + '/' + lon }),
    daily: (lat, lon) => ({ path: '/weather/v1/daily/' + lat + '/' + lon })
  },
  v7: {
    current: (lat, lon) => ({ path: '/v7/weather/now', query: { location: lon + ',' + lat } }),
    hourly: (lat, lon) => ({ path: '/v7/weather/24h', query: { location: lon + ',' + lat } }),
    daily: (lat, lon) => ({ path: '/v7/weather/7d', query: { location: lon + ',' + lat } })
  }
};
let qweatherWeatherFlavor = '';
let qweatherShapeLogged = false;

const pad2 = (n) => (n < 10 ? '0' : '') + n;
const round0 = (v) => (v === null || v === undefined ? null : Math.round(v));
const numOf = (v) => {
  const n = Number(v && typeof v === 'object' ? v.value : v);
  return isFinite(n) ? n : null;
};
// 和风 v1 的湿度 / 降水概率是 [0,1] 小数，界面要整数百分比
function pct(v, flavor) {
  const n = numOf(v);
  if (n === null) return null;
  const p = flavor === 'v1' ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(p)));
}
// v1 是小写英文罗盘（sw），v7 是中文（西南风）；统一成中文风向
function qweatherWindDir(v1Dir, v7Dir) {
  if (v7Dir) return v7Dir;
  const c = v1Dir && v1Dir.compass ? String(v1Dir.compass).toUpperCase() : '';
  return windDirMap[c] || c || '';
}
// 时间：和风 v1 官方示例给的是「Z」（UTC），按北京时间 +8 显示；若带显式偏移（+08:00）
// 说明它已经是当地时间，直接用墙钟时间——绝不把 UTC 当北京时间显示。
function qweatherClock(iso) {
  const s = String(iso || '').trim();
  // 时间部分可缺省：旧 v7 的逐日字段 fxDate 只有日期（2026-09-23），逐小时才有时刻
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const hasTime = m[4] !== undefined;
  let month = Number(m[2]);
  let day = Number(m[3]);
  let hour = hasTime ? Number(m[4]) : null;
  if (hasTime && /(?:Z|z)$/.test(s)) {
    // 上游给的是 UTC，换算成北京时间要 +8 小时，并且必须处理跨日
    // （逐日的 forecastStartTime 常是 22:00Z，+8 之后已经到第二天了）
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour + 8, Number(m[5])));
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
    hour = d.getUTCHours();
  }
  return {
    month: month,
    day: day,
    hour: hour,
    label: hasTime ? pad2(hour) + ':' + m[5] : '',
    date: month + '/' + day
  };
}

// —— 实况 ——
function normalizeQWeatherCurrent(d, flavor) {
  if (flavor === 'v1') {
    const wind = d.wind || {};
    const speedMs = numOf(wind.speed);
    const kmh = speedMs === null ? null : Math.round(speedMs * 3.6 * 10) / 10;
    const scale = Number(wind.scale);
    const visM = numOf(d.visibility);
    return {
      temperature: round0(numOf(d.temperature)),
      feelsLike: round0(numOf(d.feelsLike)),
      humidity: pct(d.humidity, 'v1'),
      windDirection: qweatherWindDir(wind.direction, ''),
      // 界面上的「N级」必须是真风级：和风 v1 直接给 scale，缺失时才自己按蒲福表算
      windSpeed: isFinite(scale) ? scale : (kmh === null ? null : beaufortFromKmh(kmh)),
      windSpeedKmh: kmh,
      windSpeedMs: speedMs === null ? null : Math.round(speedMs * 10) / 10,
      weather: (d.condition && d.condition.text) || '',
      weatherCode: (d.condition && d.condition.code) || '',
      pressure: round0(numOf(d.pressure)),
      // 和风给米，彩云给公里；统一成公里（界面不显示，但口径要一致）
      visibility: visM === null ? null : Math.round(visM / 100) / 10,
      uvIndex: numOf(d.uvIndex) === null ? null : Math.round(numOf(d.uvIndex)),
      updateTime: ''
    };
  }
  // v7：扁平字段，湿度是百分比整数、风速是 km/h
  const now = d.now || {};
  const kmh = numOf(now.windSpeed);
  const scale = Number(now.windScale);
  return {
    temperature: round0(numOf(now.temp)),
    feelsLike: round0(numOf(now.feelsLike)),
    humidity: pct(now.humidity, 'v7'),
    windDirection: now.windDir || '',
    windSpeed: isFinite(scale) ? scale : (kmh === null ? null : beaufortFromKmh(kmh)),
    windSpeedKmh: kmh,
    windSpeedMs: kmh === null ? null : Math.round((kmh / 3.6) * 10) / 10,
    weather: now.text || '',
    weatherCode: now.icon || '',
    pressure: round0(numOf(now.pressure)),
    // v7 的 vis 单位本身就是公里（v1 是米），别再除一次
    visibility: numOf(now.vis) === null ? null : Math.round(numOf(now.vis) * 10) / 10,
    uvIndex: numOf(now.uvIndex) === null ? null : Math.round(numOf(now.uvIndex)),
    updateTime: ''
  };
}

// —— 逐小时 ——
function normalizeQWeatherHourly(d, flavor) {
  const list = flavor === 'v1' ? d.hours : d.hourly;
  if (!list || !list.length) throw new Error('和风 ' + flavor + ' 逐小时返回结构不符（缺 ' + (flavor === 'v1' ? 'hours' : 'hourly') + '）');
  return list.map((item) => {
    const clock = qweatherClock(flavor === 'v1' ? item.forecastTime : item.fxTime);
    const rain = flavor === 'v1' ? numOf(item.precipitation && item.precipitation.amount) : numOf(item.precip);
    const prob = flavor === 'v1' ? (item.precipitation && item.precipitation.probability) : item.pop;
    const probPct = pct(prob, flavor);
    return {
      time: clock ? clock.label : '',
      temperature: flavor === 'v1' ? round0(numOf(item.temperature)) : round0(numOf(item.temp)),
      weather: (flavor === 'v1' ? item.condition && item.condition.text : item.text) || '',
      // 上游没给这一小时的雨量时：rain 保留 null，并置 rainKnown=false。
      // 界面据此显示「未知」——绝不把「没取到」显示成 0mm / 无雨（本项目口径）。
      rain,
      rainKnown: rain !== null,
      rainProb: probPct,
      hasRainProb: probPct !== null
    };
  });
}

// —— 逐日 ——
function normalizeQWeatherDaily(d, flavor) {
  const list = flavor === 'v1' ? d.days : d.daily;
  if (!list || !list.length) throw new Error('和风 ' + flavor + ' 逐日返回结构不符（缺 ' + (flavor === 'v1' ? 'days' : 'daily') + '）');
  return list.map((item) => {
    if (flavor === 'v1') {
      const day = item.daytime || {};
      const night = item.nighttime || {};
      const clock = qweatherClock(item.forecastStartTime);
      const probPct = pct(day.precipitation && day.precipitation.probability, 'v1');
      // 注意：旧实现把 precip（降水量 mm）当成 rainProb（降雨概率 %）填进去，
      // 界面上就会出现「12%」其实代表 12 毫米——本项目口径：宁可不显示，也不显示错值。
      return {
        date: clock ? clock.date : '',
        dayWeather: (day.condition && day.condition.text) || '',
        nightWeather: (night.condition && night.condition.text) || '',
        high: round0(numOf(item.temperatureMax)),
        low: round0(numOf(item.temperatureMin)),
        rain: numOf(day.precipitation && day.precipitation.amount),
        rainProb: probPct,
        hasRainProb: probPct !== null
      };
    }
    const probPct = pct(item.pop, 'v7');
    return {
      date: (function () { const c = qweatherClock(item.fxDate); return c ? c.date : ''; })(),
      dayWeather: item.textDay || '',
      nightWeather: item.textNight || '',
      high: round0(numOf(item.tempMax)),
      low: round0(numOf(item.tempMin)),
      rain: numOf(item.precip),
      rainProb: probPct,
      hasRainProb: probPct !== null
    };
  });
}

function normalizeQWeatherWeather(flavor, currentData, hourlyData, dailyData) {
  return {
    current: normalizeQWeatherCurrent(currentData, flavor),
    hourly: normalizeQWeatherHourly(hourlyData, flavor).slice(0, 24),
    daily: normalizeQWeatherDaily(dailyData, flavor)
  };
}

// 一行取回三个接口；v1/v7 都试，两代都不通就把每条原因一起抛出（便于定位）
async function fetchQWeatherWeather(latitude, longitude) {
  const lat = Number(latitude).toFixed(2);
  const lon = Number(longitude).toFixed(2);
  const flavors = qweatherWeatherFlavor ? [qweatherWeatherFlavor] : ['v1', 'v7'];
  const reasons = [];
  for (let i = 0; i < flavors.length; i++) {
    const flavor = flavors[i];
    const P = QWEATHER_WEATHER_PATHS[flavor];
    const auth = qweatherAuthHeaders();
    try {
      const reqs = ['current', 'hourly', 'daily'].map((k) => {
        const spec = P[k](lat, lon);
        return httpsGetJson(qweatherUrl(spec.path, spec.query || {}), auth);
      });
      const settled = await Promise.all(reqs);
      const bad = settled.find((x) => x && x.code && String(x.code) !== '200');
      if (bad) throw new Error('code=' + bad.code + (bad.message ? ' ' + bad.message : ''));
      const built = normalizeQWeatherWeather(flavor, settled[0], settled[1], settled[2]);
      built.current.updateTime = qweatherWallNow(settled[0]);
      built.shape = flavor;
      qweatherWeatherFlavor = flavor;
      return built;
    } catch (e) {
      reasons.push(flavor + '：' + String(e && e.message).slice(0, 90));
    }
  }
  throw new Error('和风天气取数失败（' + reasons.join('；') + '）');
}

// v1 的响应没有 updateTime 字段（旧 v7 有）；用响应里的 tag/或本地时间兜底，
// 但绝不伪造「看起来更新」的时间：没有就写本地时间并标明是本机时间。
function qweatherWallNow(currentData) {
  const t = currentData && (currentData.updateTime || currentData.metadata && currentData.metadata.updateTime);
  if (t) return t;
  return formatDate(new Date());
}

// 和风分支的常规天气：与彩云分支共用同一套缓存/退避/回落策略，
// 避免切源之后每次刷新都真打上游（3 个接口 + 1 次分钟级）。
async function getQWeather(latitude, longitude) {
  const key = coordKey(latitude, longitude);
  const nowMs = Date.now();
  const hit = weatherCache.get(key);
  const serveStale = (note) => respond(200, {
    success: true,
    stale: true,
    source: 'qweather',
    staleMinutes: Math.round((nowMs - hit.at) / 60000),
    message: note,
    data: hit.data
  });

  if (hit && nowMs - hit.at < WEATHER_CACHE_TTL) {
    return respond(200, { success: true, cached: true, source: 'qweather', data: hit.data });
  }

  const blockedUntil = upstreamBlockUntil.get(key) || 0;
  if (blockedUntil > nowMs) {
    if (hit && nowMs - hit.at < WEATHER_STALE_MAX) return serveStale('数据源访问频率超限，以下为上次成功结果');
    return respond(429, {
      success: false,
      source: 'qweather',
      message: '和风天气访问频率超限，且没有可用的近期结果',
      retryAfterSec: Math.ceil((blockedUntil - nowMs) / 1000)
    });
  }

  let transformed;
  try {
    transformed = await fetchQWeatherWeather(latitude, longitude);
  } catch (e) {
    if (isRateLimited(e && e.message)) {
      upstreamBlockUntil.set(key, Date.now() + UPSTREAM_BACKOFF_MS);
      if (hit && Date.now() - hit.at < WEATHER_STALE_MAX) return serveStale('数据源访问频率超限，以下为上次成功结果');
      return respond(429, {
        success: false,
        source: 'qweather',
        message: '和风天气访问频率超限',
        error: String(e.message).slice(0, 200),
        retryAfterSec: Math.ceil(UPSTREAM_BACKOFF_MS / 1000)
      });
    }
    return respond(502, {
      success: false,
      source: 'qweather',
      message: '和风天气取数失败',
      error: String((e && e.message) || e).slice(0, 300)
    });
  }

  transformed.minute = { available: false, summary: '分钟级降水数据暂不可用', precipitation: [] };
  transformed.source = 'qweather';

  // 和风分支本身的分钟级也来自和风（同一套 1km / 5 分钟产品）
  await fillMinuteFromQWeather(transformed, longitude, latitude);

  // 形态/单位/时区自检：只在首个真实响应打一次，把上游原始值和换算结果并排打出来，
  // 这样「形态选对了没、湿度是不是小数、时间是不是 UTC」当场就能核对，不用猜。
  if (!qweatherShapeLogged && transformed.hourly.length && transformed.daily.length) {
    qweatherShapeLogged = true;
    console.log('[qweather] 形态自检 ' + transformed.shape
      + '：实况湿度 → ' + transformed.current.humidity + '%，风级 → ' + transformed.current.windSpeed + '级'
      + '；首个逐小时 → ' + transformed.hourly[0].time + '，雨量 → '
      + (transformed.hourly[0].rain === null ? '未取到' : transformed.hourly[0].rain + 'mm')
      + '（rainKnown → ' + transformed.hourly[0].rainKnown + '，false 表示上游没给这一小时的雨量）'
      + '；首日 → ' + transformed.daily[0].date + '，概率 → ' + transformed.daily[0].rainProb
      + '（null 表示上游确实没给概率）');
  }

  weatherCache.set(key, { at: Date.now(), data: transformed });
  return respond(200, { success: true, source: 'qweather', data: transformed });
}

// ==================== 乡镇短临预报 ====================
async function getNowcast(townshipCode, providerParam) {
  const now = new Date();
  const t0 = new Date(Math.floor(now.getTime() / (NOWCAST_STEP_MIN * 60000)) * NOWCAST_STEP_MIN * 60000);
  const windowKey = t0.getTime();
  // 按优先级拿数据源：auto 且配了和风密钥时优先和风（免费额度内 1km / 5 分钟），失败回落彩云。
  const order = resolveNowcastProviders(providerParam);
  const cacheKey = order.join('>') + '|' + windowKey;

  let result;
  if (nowcastCache && nowcastCache.key === cacheKey) {
    result = nowcastCache.result;
  } else {
    const attempts = [];
    let picked = null;
    let last = null;
    for (let i = 0; i < order.length; i++) {
      const provider = order[i];
      const built = provider === 'qweather' ? await buildNowcastFromQWeather(t0) : await buildNowcastFromCaiyun(t0);
      last = built;
      attempts.push({ provider, okCount: built.okCount, failedReason: built.failedReason });
      if (built.okCount > 0) { picked = built; break; }
      if (i < order.length - 1) {
        console.error('[nowcast] ' + provider + ' 12 个乡镇全部取数失败，回落到 ' + order[i + 1]);
      }
    }
    result = picked || last;
    // 全部数据源都失败时，把每个源的原因都留给界面（否则用户只知道「失败」，不知道是谁失败）
    if (!picked && attempts.length > 1) {
      result.failedReason = attempts
        .map((a) => (NOWCAST_FAIL_LABEL[a.provider] || a.provider) + '：' + (a.failedReason || '未知原因'))
        .join('｜');
    }
    // 失败批次不写缓存：否则「取数失败」会在窗口内被反复当成「全县无降雨」展示
    if (result && shouldCacheNowcast(result.okCount, result.townshipCount)) {
      nowcastCache = { key: cacheKey, result };
    }
  }

  if (townshipCode) {
    const detail = result.townships.find(t => t.code === townshipCode);
    if (!detail) {
      return respond(404, { success: false, error: '乡镇代码不存在: ' + townshipCode });
    }
    return respond(200, Object.assign({}, result, { detail }));
  }

  return respond(200, result);
}

async function buildNowcastFromCaiyun(t0) {
  const settled = await Promise.all(
    TOWNSHIPS.map(tw =>
      fetchCaiyunMinutely(tw.lng, tw.lat).catch(err => {
        // 留痕：云函数日志里能直接看到「哪个乡镇、为什么没取到」
        console.error('[nowcast] ' + tw.name + ' 取数失败 :: ' + ((err && err.message) || '未知错误'));
        return { __error: String((err && err.message) || '未知错误') };
      })
    )
  );
  return aggregateNowcast(settled, t0);
}

// 数据源优先级：显式指定 > 环境变量 NOWCAST_PROVIDER > auto（有和风密钥则和风优先）
function resolveNowcastProviders(param) {
  const want = String(param || NOWCAST_PROVIDER || 'auto').toLowerCase();
  if (want === 'qweather') return ['qweather'];
  if (want === 'caiyun') return ['caiyun'];
  return hasQWeatherCreds() ? ['qweather', 'caiyun'] : ['caiyun'];
}

function hasQWeatherKey() {
  return !!QWEATHER_KEY && QWEATHER_KEY !== 'YOUR_QWEATHER_KEY';
}

function hasQWeatherCreds() {
  return hasQWeatherKey() || !!QWEATHER_TOKEN || qweatherJwtConfigured();
}

// JWT 的三段都必须用 Base64URL（不是 Base64）：无填充、加号换减号、斜杠换下划线
function base64Url(input) {
  return Buffer.from(input).toString('base64')
    .replace(new RegExp('\\+', 'g'), '-')
    .replace(new RegExp('/', 'g'), '_')
    .replace(new RegExp('=+$'), '');
}

// 环境变量里的 PEM 换行常被写成字面量，这里还原成真正的换行
// —— 私钥文本的容错 ——
// 控制台粘贴私钥有几种常见毁法，实测都会让 crypto.createPrivateKey 报
// error:1E08010C:DECODER routines::unsupported：
//   ① 换行全丢了，整份 PEM 被压成一行；
//   ② 整行 `QWEATHER_PRIVATE_KEY=...` 一起粘进了「值」里；
//   ③ 值被成对的引号包住；
//   ④ 把 PEM 原文错填进了 *_B64（会先被 base64 解一次，变成乱码）；
//   ⑤ 值被截断（这种无法还原，只能如实报错）。
// 这里统一修一遍，并按候选逐个尝试解析 —— 免得为了一个格式问题反复重部署。
function normalizePemText(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  // ② 变量名连着值一起被粘进来了。变量名是全大写下划线，base64 是大小写混合，不会误伤。
  s = s.replace(/^[A-Z][A-Z0-9_]{2,}=/, '');
  // ③ 去掉成对的包裹引号
  s = s.replace(/^["']+/, '').replace(/["']+$/, '').trim();
  // ① 换行有时被存成字面量 \n / \r
  s = s.split('\\n').join('\n').split('\\r').join('\r');
  // 前面还挂着别的东西时，从 BEGIN 处切开
  const bi = s.indexOf('-----BEGIN');
  if (bi > 0) s = s.slice(bi);
  // ① 换行全丢：按标准 PEM 每 64 字符重新折行
  if (s.indexOf('-----BEGIN') === 0 && s.indexOf('\n') < 0) {
    s = s.replace(/^(-----BEGIN [^-]+-----)([\s\S]*?)(-----END [^-]+-----)$/, (m, head, body, tail) => {
      const wrapped = body.replace(/\s+/g, '').match(/.{1,64}/g) || [];
      return head + '\n' + wrapped.join('\n') + '\n' + tail;
    });
  }
  return s;
}

// 末尾被截断的 PEM：正文完整、只有结束标记残缺时，补回标准结束行。
// 敢这么补的依据：PKCS8 的 DER 长度是严格的，正文哪怕少一个字节 createPrivateKey 都会失败，
// 所以「补完之后能解析」等价于「正文本身是完整的」——不会补出一个不同的密钥。
// 触发场景：从长文本里复制私钥时尾部没选全（实测线上就是把末尾 3 个字符 Qo= 漏掉了）。
function repairTruncatedPem(pemText) {
  const s = String(pemText || '');
  const m = s.match(/^-----BEGIN ([A-Z0-9 ]+)-----/);
  if (!m) return '';
  const label = m[1];
  const rest = s.slice(m[0].length);
  if (new RegExp('-----END ' + label + '-----').test(rest)) return ''; // 结束标记在，不需要修
  const body = rest.replace(/-----END[\s\S]*$/, '').replace(/[\s\r\n]+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return '';
  if (body.length % 4 !== 0) return ''; // 正文自身也不完整，不能猜
  let der;
  try { der = Buffer.from(body, 'base64'); } catch (e) { return ''; }
  if (!der.length) return '';
  if (der.toString('base64').replace(/=+$/, '') !== body.replace(/=+$/, '')) return ''; // 补位不对/有非法字符
  return '-----BEGIN ' + label + '-----\n' + (body.match(/.{1,64}/g) || []).join('\n')
    + '\n-----END ' + label + '-----\n';
}

// 私钥候选（按可靠程度排序）：先按 base64 解一份，再按原文各留一份；每个候选都附带「末尾补全版」。
function qweatherPemCandidates() {
  const out = [];
  const push = (v) => {
    const t = normalizePemText(v);
    if (!t) return;
    if (out.indexOf(t) < 0) out.push(t);
    const fixed = repairTruncatedPem(t);
    if (fixed && out.indexOf(fixed) < 0) out.push(fixed);
  };
  const raw64 = String(QWEATHER_PRIVATE_KEY_B64 || '').trim();
  if (raw64) {
    const cleaned = normalizePemText(raw64.replace(/^["']+|["']+$/g, ''));
    if (cleaned) {
      try { push(Buffer.from(cleaned, 'base64').toString('utf8')); } catch (e) { /* 原文兜底在下面 */ }
    }
    push(raw64);
  }
  push(QWEATHER_PRIVATE_KEY);
  return out;
}

// 只描述形状与可解析性，不回显密钥内容（私钥不能出现在日志或报错里）
function describePemCandidates() {
  const cs = qweatherPemCandidates();
  if (!cs.length) return '未读到 QWEATHER_PRIVATE_KEY_B64 / QWEATHER_PRIVATE_KEY（两个都没配）';
  return cs.map((t, i) => {
    const isPem = t.indexOf('-----BEGIN') === 0;
    let state;
    try {
      const k = crypto.createPrivateKey(t);
      state = k.asymmetricKeyType === 'ed25519' ? '可用' : ('类型是 ' + k.asymmetricKeyType + '，不是 ed25519');
    } catch (e) { state = '解析失败'; }
    return '候选' + (i + 1) + '：' + t.length + ' 字符，'
      + (isPem ? 'PEM' : '非 PEM（前 15 字符「' + t.slice(0, 15).replace(/[\u0000-\u001f\u007f\ufffd]/g, '·') + '」）')
      + '，' + state;
  }).join('；');
}

// 依次尝试候选，返回第一个「能解析且是 Ed25519」的；都不可用时返回第一个，交给调用方如实报错
function qweatherPrivateKeyPem() {
  const cs = qweatherPemCandidates();
  if (!cs.length) return '';
  for (let i = 0; i < cs.length; i++) {
    try {
      if (crypto.createPrivateKey(cs[i]).asymmetricKeyType === 'ed25519') return cs[i];
    } catch (e) { /* 试下一个候选 */ }
  }
  return cs[0];
}

function qweatherJwtConfigured() {
  return !!(QWEATHER_KID && QWEATHER_ISSUER && QWEATHER_PROJECT && (QWEATHER_PRIVATE_KEY || QWEATHER_PRIVATE_KEY_B64));
}

// 按和风规范就地签一个 JWT：header{alg:EdDSA,kid} + payload{iss,sub,iat,exp}，Ed25519 签名。
// 用现成 token 会过期（最长 24 小时）且要人工轮换，所以这里每次自己签、并缓存到临近过期。
function createQWeatherJwt(nowSec) {
  const iat = nowSec - 30;                     // 官方建议往前 30 秒，容忍时钟偏差
  const exp = iat + 30 + QWEATHER_JWT_TTL_SEC;
  const header = { alg: 'EdDSA', kid: QWEATHER_KID };
  const payload = { iss: QWEATHER_ISSUER, sub: QWEATHER_PROJECT, iat, exp };
  const signingInput = base64Url(JSON.stringify(header)) + '.' + base64Url(JSON.stringify(payload));
  let key;
  try {
    key = crypto.createPrivateKey(qweatherPrivateKeyPem());
  } catch (e) {
    throw new Error('和风私钥无法解析（请确认 QWEATHER_PRIVATE_KEY / QWEATHER_PRIVATE_KEY_B64 是 Ed25519 私钥 PEM 全文）：' + ((e && e.message) || '') + '；读到的是——' + describePemCandidates());
  }
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), key);
  return { token: signingInput + '.' + base64Url(signature), exp };
}

function qweatherJwt() {
  const now = Math.floor(Date.now() / 1000);
  // 留 60 秒余量，避免边界上刚好过期
  if (qweatherJwtCache && qweatherJwtCache.exp - 60 > now) return qweatherJwtCache.token;
  qweatherJwtCache = createQWeatherJwt(now);
  return qweatherJwtCache.token;
}

// JWT 优先；否则 API KEY（新账号也支持 key= 参数，旧账号只有这个）
function qweatherAuthHeaders() {
  if (qweatherJwtConfigured()) return { Authorization: 'Bearer ' + qweatherJwt() };
  if (QWEATHER_TOKEN) return { Authorization: 'Bearer ' + QWEATHER_TOKEN };
  return {};
}

// 控制台里的 API Host 常被整段复制成「https://xxx/」，这里统一成裸主机名，
// 否则会拼成 https://https://xxx（这也是最容易踩的一个坑）
function qweatherHost() {
  const raw = String(QWEATHER_HOST || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return raw || 'devapi.qweather.com';
}

function qweatherUrl(path, query) {
  const qs = Object.keys(query || {})
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
    .join('&');
  const base = 'https://' + qweatherHost() + path;
  // 已经有 Authorization 头时不再挂 key，避免「同时使用多种认证方式」被判失败
  if (!qweatherAuthHeaders().Authorization && hasQWeatherKey()) {
    return base + '?' + qs + '&key=' + encodeURIComponent(QWEATHER_KEY);
  }
  return qs ? base + '?' + qs : base;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 和风分钟级降水：GET /v7/minutely/5m?location=经度,纬度
// 返回 minutely[24]，每档 5 分钟，precip 是该档的降水量（mm）。取不到一律抛错（由上游统一留痕），
// 绝不返回空数组冒充「没有降雨」。
async function fetchQWeatherMinutely(lng, lat) {
  if (!hasQWeatherCreds()) {
    throw new Error('未配置和风天气凭据（JWT 用 QWEATHER_KID/QWEATHER_ISSUER/QWEATHER_PROJECT/QWEATHER_PRIVATE_KEY，API KEY 用 QWEATHER_KEY）');
  }
  const location = Number(lng).toFixed(4) + ',' + Number(lat).toFixed(4);
  const url = qweatherUrl(QWEATHER_MINUTELY_PATH, { location });
  const data = await httpsGetJson(url, qweatherAuthHeaders());
  const code = data && data.code !== undefined && data.code !== null ? String(data.code) : '';
  if (code !== '200') {
    throw new Error('和风分钟级降水 code=' + (code || '未知') + (data && data.message ? ' ' + data.message : ''));
  }
  const slots = data && Array.isArray(data.minutely) ? data.minutely : [];
  if (!slots.length) throw new Error('和风分钟级降水返回数据里没有 minutely 字段');
  return {
    updateTime: data.updateTime || '',
    summary: data.summary || '',
    stepMinutes: QWEATHER_SLOT_MIN,
    slots
  };
}

// 每档降水量（mm / 5 分钟）换算成强度 mm/h（×12），才能与全项目统一口径对齐
function qweatherSlotIntensity(slots) {
  return (slots || []).map((s) => {
    const mm = Number(s && s.precip);
    if (!Number.isFinite(mm) || mm <= 0) return 0;
    return parseFloat((mm * (60 / QWEATHER_SLOT_MIN)).toFixed(2));
  });
}

// 把每档强度展开成逐分钟序列（和风的 5 分钟档 → 120 个 1 分钟点）。
// 这样 findStartMinute / downsampleToFrames 这些按「分钟」计的下游逻辑不必分源写两套，
// 2 小时累计也能严格守恒（每档 5 分钟 × 同一强度 = 该档降水量）。
function expandSlotsToMinutes(values, stepMinutes) {
  const step = Number(stepMinutes) > 0 ? Number(stepMinutes) : QWEATHER_SLOT_MIN;
  const out = [];
  (values || []).forEach((v) => {
    for (let i = 0; i < step && out.length < MINUTE_SERIES_MAX; i++) out.push(v);
  });
  return out;
}

// 归一化成彩云同形状，让聚合/摘要逻辑只维护一套（概率为 null：和风不提供概率，绝不编）
function toInternalMinutely(rec) {
  return {
    result: {
      minutely: {
        precipitation_2h: expandSlotsToMinutes(qweatherSlotIntensity(rec.slots), rec.stepMinutes),
        probability: null
      }
    },
    __source: 'qweather'
  };
}

function minuteBlockFromQWeather(rec) {
  const block = buildMinuteBlock(
    { precipitation_2h: qweatherSlotIntensity(rec.slots), description: rec.summary || '' },
    rec.stepMinutes
  );
  block.source = 'qweather';
  block.updateTime = rec.updateTime || '';
  return block;
}

// 常规天气接口的分钟级兜底：彩云不给 minutely 时用和风补，补不到保持「暂不可用」并写明原因
async function fillMinuteFromQWeather(target, lng, lat) {
  if (!target || !target.minute) return target;
  if (target.minute.available) {
    target.minute.source = target.minute.source || 'caiyun';
    return target;
  }
  if (!hasQWeatherCreds()) return target;
  try {
    const rec = await fetchQWeatherMinutely(lng, lat);
    target.minute = minuteBlockFromQWeather(rec);
  } catch (e) {
    console.error('[minute] 和风分钟级取数失败 :: ' + ((e && e.message) || '未知错误'));
    target.minute.reason = summarizeFailReason([String((e && e.message) || '')], '和风天气');
  }
  return target;
}

// 12 个乡镇串行取数：和风按「每分钟请求数」计费限流，并发 12 个会直接吃 429
// （彩云就是这样全军覆没的）。串行 + 间隔约 1.8 秒完成一轮。
async function buildNowcastFromQWeather(t0) {
  const settled = [];
  for (let i = 0; i < TOWNSHIPS.length; i++) {
    const tw = TOWNSHIPS[i];
    try {
      const rec = await fetchQWeatherMinutely(tw.lng, tw.lat);
      // 口径自检（只记第一个乡镇）：和风每档是「该 5 分钟的降水量 mm」，我们按 ×12 换成 mm/h。
      // 这条日志把原始档位合计、换算后的强度峰值和和风自带的 summary 放在一起，
      // 首个真实响应就能自证换算没错（若相差 12 倍，就是单位理解错了）。
      if (i === 0) {
        const slotMm = rec.slots.reduce((s, x) => s + (Number(x.precip) || 0), 0);
        const peak = Math.max.apply(null, qweatherSlotIntensity(rec.slots));
        console.log('[nowcast-q] 口径自检 ' + tw.name + '：24 档合计 ' + slotMm.toFixed(2) + 'mm，强度峰值 ' + peak.toFixed(2) + 'mm/h，上游 summary「' + (rec.summary || '无') + '」');
      }
      settled.push(toInternalMinutely(rec));
    } catch (err) {
      // 留痕：云函数日志里能直接看到「哪个乡镇、为什么没取到」
      console.error('[nowcast] ' + tw.name + ' 取数失败 :: ' + ((err && err.message) || '未知错误'));
      settled.push({ __error: String((err && err.message) || '未知错误') });
    }
    if (i < TOWNSHIPS.length - 1) await sleep(NOWCAST_QPM_GAP_MS);
  }
  return aggregateNowcast(settled, t0, 'qweather');
}

// 聚合 12 个乡镇的原始响应。
// 关键口径：取数失败的乡镇**不能**被当成「无降雨」——否则彩云故障时界面会显示
// 「全县未来2小时无降水」，那是假阴性。失败乡镇 ok=false、totalRain=null、willRain=null，
// 由前端明确渲染为「数据缺失」。
function aggregateNowcast(settled, t0, source) {
  // source 决定 note / 失败标签：数据来源必须与真实取数一致，不能写死彩云
  const src = NOWCAST_SOURCE_LABEL[source] ? source : 'caiyun';
  const total = TOWNSHIPS.length;
  const townships = TOWNSHIPS.map((tw, idx) => summarizeTownship(settled[idx], tw));
  const okCount = townships.filter(t => t.ok).length;
  const failedCount = total - okCount;
  // 失败原因必须能带到界面上：否则用户只看到「数据缺失」，不知道是限流、超时还是没权限
  const failReasons = townships.filter(t => !t.ok && t.error).map(t => t.error);
  const failedReasons = Array.from(new Set(failReasons)).slice(0, 3);
  const failedReason = failedReasons.length ? summarizeFailReason(failedReasons, NOWCAST_FAIL_LABEL[src]) : "";

  const timeline = [];
  for (let i = 0; i < NOWCAST_FRAMES; i++) {
    const t = new Date(t0.getTime() + i * NOWCAST_STEP_MIN * 60000);
    timeline.push({ idx: i, minute: i * NOWCAST_STEP_MIN, time: formatDate(t) });
  }

  return {
    success: okCount > 0,               // 全军覆没必须是 false，前端据此进入「数据缺失」态
    mock: false,
    source: src,
    degraded: failedCount > 0,
    okCount,
    failedCount,
    failedReason,
    failedReasons,
    townshipCount: total,
    issueTime: formatDate(new Date()),  // 实际取数完成时刻；窗口对齐时刻另存 windowTime
    windowTime: formatDate(t0),
    stepMinutes: NOWCAST_STEP_MIN,
    totalMinutes: (NOWCAST_FRAMES - 1) * NOWCAST_STEP_MIN,
    frameCount: NOWCAST_FRAMES,
    timeline, townships,
    note: '数据来源：' + NOWCAST_SOURCE_LABEL[src]
  };
}

// 单个乡镇：分钟级起始 / 最强时刻取自 1 分钟强度序列，概率只作辅助（30 分钟一档）
function summarizeTownship(raw, tw) {
  const precip = getMinuteSeries(raw, 'precipitation_2h');
  const probability = getMinuteSeries(raw, 'probability');
  const ok = precip.length > 0 || probability.length > 0;
  // 失败时把上游原因留下来（限流 / 超时 / 无权限 / 字段缺失），界面才能说清「为什么」
  const upstreamError = raw && raw.__error ? String(raw.__error) : "";
  // 概率只在数据源真的给了概率序列时才成立（彩云给，和风不给）。旧实现用强度硬推一个
  // 「概率」，那是编出来的数——界面上的百分比必须有出处。
  const hasProbability = probability.length > 0;

  const frames = downsampleToFrames(raw);
  let peakFrame = frames[0];
  if (hasProbability) frames.forEach(f => { if (f.prob > peakFrame.prob) peakFrame = f; });

  const startMinute = findStartMinute(precip);
  const peakMinute = findPeakMinute(precip);
  const totalRain = +(frames.reduce((s, f) => s + f.intensity * (NOWCAST_STEP_MIN / 60), 0)).toFixed(1);

  return {
    code: tw.code, name: tw.name, lng: tw.lng, lat: tw.lat,
    ok,
    error: ok ? "" : (upstreamError || "返回数据里没有分钟级降水字段"),
    hasProbability: ok ? hasProbability : false,
    peakProb: ok && hasProbability ? peakFrame.prob : null,
    // 无雨时不得再退回 frames[0].minute —— 那会给「真无雨」的乡镇写上一个
    // 「第 0 分钟最强」的假结论（实测无雨时输出就是 0）。而且 willRain 为真时
    // findPeakMinute 必然有值，所以这个兜底在所有展示路径上都是死代码，只会污染数据。
    peakMinute: ok ? peakMinute : null,
    totalRain: ok ? totalRain : null,
    willRain: ok ? startMinute !== null : null,
    startMinute: ok ? startMinute : null,
    frames: ok ? frames : []
  };
}

// 取彩云 minutely 的分辨率序列；失败 / 缺字段一律返回空数组
function getMinuteSeries(raw, key) {
  const minutely = raw && !raw.__error && raw.result && raw.result.minutely;
  const arr = minutely ? minutely[key] : null;
  return Array.isArray(arr) ? arr : [];
}

// 第几分钟开始下雨（强度首次达到阈值的那一分钟）；2 小时内无降水返回 null
function findStartMinute(precip) {
  for (let i = 0; i < precip.length; i++) {
    if ((precip[i] || 0) >= NOWCAST_RAIN_THRESHOLD) return i;
  }
  return null;
}

// 强度最强的分钟；全为 0 返回 null
function findPeakMinute(precip) {
  let best = null, bestVal = 0;
  for (let i = 0; i < precip.length; i++) {
    const v = precip[i] || 0;
    if (v > bestVal) { bestVal = v; best = i; }
  }
  return best;
}

// 只有正常乡镇过半才写缓存：避免「大部分乡镇取数失败」的结果在窗口内被反复复用
function shouldCacheNowcast(okCount, total) {
  return okCount > 0 && okCount * 2 > total;
}

function fetchCaiyunMinutely(lng, lat) {
  const endpoint = `/${lng},${lat}/minutely`;
  return httpsGetCaiyun(endpoint);
}

function downsampleToFrames(raw) {
  const precip = getMinuteSeries(raw, 'precipitation_2h');
  const probability = getMinuteSeries(raw, 'probability');

  const frames = [];
  for (let i = 0; i < NOWCAST_FRAMES; i++) {
    const minute = i * NOWCAST_STEP_MIN;
    let intensity = 0;
    if (precip.length) {
      const start = Math.min(minute, precip.length - 1);
      const end = Math.min(minute + NOWCAST_STEP_MIN, precip.length);
      const slice = precip.slice(start, Math.max(end, start + 1));
      intensity = slice.reduce((s, v) => s + (v || 0), 0) / slice.length;
    }
    // 没有概率序列时 prob 为 null（不再用强度反推一个假概率）
    let prob = null;
    if (probability.length) {
      const segIdx = Math.min(Math.floor(minute / 30), probability.length - 1);
      prob = +Math.max(0, Math.min(1, probability[segIdx] || 0)).toFixed(3);
    }
    frames.push({
      idx: i, minute,
      prob,
      intensity: +intensity.toFixed(1)
    });
  }
  return frames;
}

// ==================== 雷达参照实况（短临事后对照） ====================

// 给定若干「观测时刻」（unix 秒），返回各乡镇在该时刻的雷达回波实况。
// 用途：短临预报的事后对照。雷达是遥感参照，只输出回波有无与强度档，绝不输出毫米数。
async function getRadarVerify(params) {
  const times = parseTimeList(params.times, 8);
  if (!times.length) {
    return respond(400, { success: false, message: '缺少 times 参数（unix 秒，逗号分隔，最多 8 个）' });
  }

  const meta = await httpsGetJson(radarTruth.RADAR_TRUTH.META_URL);
  const frames = ((meta.radar && meta.radar.past) || []).slice();
  if (!frames.length) {
    return respond(200, { success: false, message: '雷达帧列表为空' });
  }

  const zoom = radarTruth.RADAR_TRUTH.ZOOM;
  const tiles = radarTruth.tilesForRings(TOWNSHIP_RINGS, zoom);
  const observations = [];

  for (const t of times) {
    const pick = radarTruth.pickNearestFrame(frames, t, radarTruth.RADAR_TRUTH.MAX_FRAME_GAP_MIN);
    if (!pick) {
      observations.push({ requestedTime: t, ok: false, reason: '超出雷达可用时段（免费档仅过去约 2 小时）' });
      continue;
    }
    const imgs = {};
    for (const tl of tiles) {
      const url = radarTruth.tileUrl(meta.host, pick.frame.path, tl.z, tl.x, tl.y);
      try {
        imgs[tl.key] = radarTruth.decodePng(await httpsGetBuffer(url));
      } catch (e) {
        console.error('[radar-verify] 瓦片获取失败 ' + url + ' :: ' + e.message);
      }
    }
    observations.push({
      requestedTime: t,
      ok: true,
      frameTime: pick.frame.time,
      deltaMin: pick.deltaMin,
      townships: radarTruth.summarizeFrame(imgs, TOWNSHIP_RINGS, zoom)
    });
  }

  const usableCount = observations.filter(o => o.ok).length;
  return respond(200, {
    success: usableCount > 0,
    source: 'rainviewer',
    zoom,
    requestedCount: times.length,
    usableCount,
    townships: TOWNSHIPS.map(tw => ({ code: tw.code, name: tw.name })),
    observations,
    note: '雷达为遥感参照：只反映回波有无与强度档，不等于地面雨量；免费档最高层级 z=7（约 1.1km/像素），帧间隔 10 分钟。'
  });
}

function parseTimeList(raw, max) {
  return String(raw === undefined || raw === null ? '' : raw)
    .split(',')
    .map(s => parseInt(String(s).trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0)
    .slice(0, max || 8);
}

function httpsGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTPS ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(decodeHttpBuffer(Buffer.concat(chunks), res.headers && res.headers['content-encoding'])));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// ==================== 工具函数 ====================

function checkAuth(params) {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    console.warn('[auth] 未配置环境变量 API_TOKEN，本次请求未做密钥校验（请在阿里云控制台配置后重新部署）');
    return true;
  }
  const ok = String(params.token || '') === expected;
  if (!ok) console.error('[auth] token 缺失或不匹配，拒绝访问');
  return ok;
}

function getParams(event) {
  let eventObj = {};
  try {
    eventObj = JSON.parse(event.toString());
  } catch (e) {
    eventObj = event;
  }
  const params = eventObj.queryParameters || eventObj.queryStringParameters || {};
  const decoded = {};
  Object.keys(params).forEach(k => {
    try { decoded[k] = decodeURIComponent(params[k]); } catch(e) { decoded[k] = params[k]; }
  });
  return decoded;
}

// ==================== 彩云天气签名认证 ====================
function encodeQueryComponent(input) {
  return encodeURIComponent(String(input))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

function generateCaiyunSignature(method, path, query, nonce, timestamp) {
  const sortedKeys = Object.keys(query).sort();
  const queryStr = sortedKeys
    .map((key) => `${encodeQueryComponent(key)}=${encodeQueryComponent(query[key])}`)
    .join('&');
  
  const stringToSign = [method, path, queryStr, CAIYUN_APP_KEY, nonce, timestamp.toString()].join(':');
  
  const hmac = crypto.createHmac('sha256', CAIYUN_APP_SECRET);
  hmac.update(stringToSign);
  
  return hmac.digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateNonce() {
  return crypto.randomUUID();
}

// 检查是否配置了签名认证
function useSignatureAuth() {
  return CAIYUN_APP_KEY && 
         CAIYUN_APP_SECRET && 
         CAIYUN_APP_KEY !== 'YOUR_CAIYUN_APP_KEY' && 
         CAIYUN_APP_SECRET !== 'YOUR_CAIYUN_APP_SECRET';
}

function httpsGetCaiyun(endpoint, query = {}) {
  return new Promise((resolve, reject) => {
    // 判断使用签名认证还是Token认证
    if (useSignatureAuth()) {
      // 使用 App Key + App Secret 签名认证
      const nonce = generateNonce();
      const timestamp = Math.floor(Date.now() / 1000);
      const path = `/${CAIYUN_VERSION}/${CAIYUN_APP_KEY}${endpoint}`;
      
      const signature = generateCaiyunSignature('GET', path, query, nonce, timestamp);
      
      const queryStr = Object.keys(query)
        .sort()
        .map((k) => `${encodeQueryComponent(k)}=${encodeQueryComponent(query[k])}`)
        .join('&');
      
      const fullPath = queryStr ? `${path}?${queryStr}` : path;
      
      const options = {
        hostname: CAIYUN_HOST,
        path: fullPath,
        method: 'GET',
        headers: {
          'x-cy-nonce': nonce,
          'x-cy-timestamp': timestamp.toString(),
          'x-cy-signature': signature
        }
      };
      
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const data = decodeHttpBody(Buffer.concat(chunks), res.headers && res.headers['content-encoding']);
          if (res.statusCode !== 200) {
            reject(new Error(`HTTPS ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('JSON 解析失败'));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
      req.end();
    } else {
      // 回退到 Token 认证（不推荐）
      console.warn('[getWeather] 使用 Token 认证（不推荐），建议配置 CAIYUN_APP_KEY 和 CAIYUN_APP_SECRET');
      const queryStr = Object.keys(query)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
        .join('&');
      const url = `https://${CAIYUN_HOST}/${CAIYUN_VERSION}/${CAIYUN_TOKEN}${endpoint}?${queryStr}`;
      
      httpsGetJson(url).then(resolve).catch(reject);
    }
  });
}

// 统一的响应体解码。两个坑都要防：
// ① 上游（尤其和风新 API Host）会无条件返回 gzip —— 实测 /v7/minutely/5m 与
//    /weather/v1/* 都带 content-encoding: gzip。旧写法 `data += chunk` 是把压缩字节
//    当字符串拼，再 JSON.parse 必然失败（表现就是「JSON 解析失败」，和风分支全军覆没）。
// ② 分块边界可能切在多字节字符中间，必须先拼 Buffer、最后整体按 UTF-8 解码。
function decodeHttpBuffer(buffer, contentEncoding) {
  const enc = String(contentEncoding || '').toLowerCase();
  const looksGzip = buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  try {
    if (enc.indexOf('gzip') >= 0 || looksGzip) return zlib.gunzipSync(buffer);
    if (enc.indexOf('deflate') >= 0) return zlib.inflateSync(buffer);
    if (enc.indexOf('br') >= 0) return zlib.brotliDecompressSync(buffer);
  } catch (e) {
    // 解压失败就按原文交给上层，让「JSON 解析失败」如实报出来，不吞掉
    return buffer;
  }
  return buffer;
}

function decodeHttpBody(buffer, contentEncoding) {
  return decodeHttpBuffer(buffer, contentEncoding).toString('utf8');
}

function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const options = headers && Object.keys(headers).length ? { headers } : {};
    const req = https.get(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTPS ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(decodeHttpBody(Buffer.concat(chunks), res.headers && res.headers['content-encoding'])));
        } catch (e) {
          reject(new Error('JSON 解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}

function formatDate(date) {
  const utc = date.getTime();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijing = new Date(utc + beijingOffset);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const min = String(beijing.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

function getBeijingDate(date) {
  const utc = date.getTime();
  const beijingOffset = 8 * 60 * 60 * 1000;
  return new Date(utc + beijingOffset);
}

function formatBeijingHour(date) {
  const bj = getBeijingDate(date);
  return `${String(bj.getUTCHours()).padStart(2, '0')}:00`;
}

function formatBeijingDate(date) {
  const bj = getBeijingDate(date);
  return `${bj.getUTCMonth() + 1}/${bj.getUTCDate()}`;
}

function getBeijingDateStr(date) {
  const bj = getBeijingDate(date);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatWindDirection(direction) {
  if (direction === undefined || direction === null) return '未知';
  if (typeof direction === 'string') {
    return windDirMap[direction] || direction;
  }
  const deg = parseFloat(direction);
  if (isNaN(deg)) return '未知';
  const directions = ['北风', '东北偏北', '东北风', '东北偏东', '东风', '东南偏东', '东南风', '东南偏南', '南风', '西南偏南', '西南风', '西南偏西', '西风', '西北偏西', '西北风', '西北偏北'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
}

// —— 仅用于测试：导出纯函数便于离线单测（不参与线上 handler 逻辑）——
exports.__test = {
  aggregateNowcast,
  summarizeTownship,
  findStartMinute,
  findPeakMinute,
  getMinuteSeries,
  downsampleToFrames,
  shouldCacheNowcast,
  buildMinuteBlock,
  summarizeFailReason,
  decodeHttpBuffer,
  decodeHttpBody,
  resolveNowcastProviders,
  hasQWeatherCreds,
  qweatherHost,
  QWEATHER_WEATHER_PATHS,
  normalizeQWeatherWeather,
  normalizeQWeatherCurrent,
  normalizeQWeatherHourly,
  normalizeQWeatherDaily,
  qweatherClock,
  pct,
  fetchQWeatherWeather,
  setQWeatherFlavor: (f) => { qweatherWeatherFlavor = f; },
  qweatherUrl,
  qweatherAuthHeaders,
  base64Url,
  qweatherJwtConfigured,
  createQWeatherJwt,
  qweatherJwt,
  qweatherPrivateKeyPem,
  normalizePemText,
  qweatherPemCandidates,
  describePemCandidates,
  repairTruncatedPem,
  QWEATHER_JWT_TTL_SEC,
  qweatherSlotIntensity,
  expandSlotsToMinutes,
  toInternalMinutely,
  minuteBlockFromQWeather,
  fetchQWeatherMinutely,
  NOWCAST_SOURCE_LABEL,
  QWEATHER_SLOT_MIN,
  NOWCAST_RAIN_THRESHOLD,
  NOWCAST_STEP_MIN,
  NOWCAST_FRAMES,
  TOWNSHIPS,
  getRadarVerify,
  parseTimeList,
  beaufortFromKmh,
  BEAUFORT_MS,
  radarTruth,
  TOWNSHIP_RINGS
};
