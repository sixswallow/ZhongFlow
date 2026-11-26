/**
 * 阿里云函数 - 获取站点列表
 *
 * 功能：
 * 1. 水库列表 (reservoir)
 * 2. 河道列表 (river)
 * 3. 土壤墒情列表 (soil)
 * 4. 全部站点 (all)
 * 5. 单个站点详情 (stationId)
 *
 * 调用方式：
 * - GET /?type=reservoir&adcd=431221
 * - GET /?type=river&keyword=xxx
 * - GET /?type=soil&adcd=431221
 * - GET /?type=all
 * - GET /?stationId=xxxx
 */
const http = require('http');

const CONFIG = {
  NEW_API_HOST: '58.20.42.94',
  NEW_API_PORT: 9090,
  NEW_API_PATH: '/newapi/api/v1/ysq',
  SOIL_API_PATH: '/api/core/soil/detail',
  ADCD: '431221'
};

// 站点状态文案。语义边界（前端 utils/stationStatus.js 必须与此保持一致）：
// - warning 专指「水库水位低于死水位 DDZ」，属供水不足提示，不是洪水预警结论；
// - unknown 指上游未返回可用监测数据，不得据此推断旱涝等级。
const STATUS_TEXT = {
  normal: '正常',
  unknown: '暂无数据',
  warning: '水位偏低',
  danger: '超警戒',
  dry: '偏干',
  drought: '干旱',
  wet: '过湿'
};

// 水库的控制水位叫「汛限水位」（上游字段 FSLTDZ），河道的才叫「警戒水位」（HLZ）——
// 同一个「水位达到控制水位」的状态，两类站用词不同，不能共用一个 danger 文案。
const RESERVOIR_STATUS_TEXT = Object.assign({}, STATUS_TEXT, { danger: '超汛限' });

const VERSION = '2026-09-26-v8';

// 中方县现行乡镇（11镇1民族乡）：名称规范化映射
// 依据：2015年11月24日湖南省民政厅（湘民行发[2015]68号）批复的中方县乡镇区划调整方案
// 中方镇、牌楼镇、炉亭坳乡 → 中方镇
// 泸阳镇、聂家村乡、下坪乡 → 泸阳镇
// 花桥镇、龙场乡 → 花桥镇
// 石宝乡、新路河镇 → 新路河镇
// 袁家乡、蒋家乡 → 袁家镇
// 铜湾镇、丁家乡 → 铜湾镇
// 撤销活水、锦溪2个乡建制，调整铁坡镇、蒿吉坪瑶族乡的部分行政区域
const TOWNSHIP_NAME_MAP = {
  '牌楼坳镇': '中方镇',
  '牌楼镇': '中方镇',
  '炉亭坳乡': '中方镇',
  '聂家村乡': '泸阳镇',
  '聂家村': '泸阳镇',
  '下坪乡': '泸阳镇',
  '龙场乡': '花桥镇',
  '新路河乡': '新路河镇',
  '石宝乡': '新路河镇',
  '袁家乡': '袁家镇',
  '蒋家乡': '袁家镇',
  '丁家乡': '铜湾镇',
  '新建乡': '新建镇',
  '铜鼎乡': '铜鼎镇',
  '接龙乡': '接龙镇',
  '蒿吉坪乡': '蒿吉坪瑶族乡',
  '活水乡': '',
  '锦溪乡': '',
  '活水': '',
  '锦溪': ''
};

// 中方县现行有效乡镇清单，用于校验
const VALID_TOWNSHIPS = new Set([
  '中方镇', '桐木镇', '花桥镇', '铜湾镇', '泸阳镇', '新建镇',
  '接龙镇', '铁坡镇', '袁家镇', '新路河镇', '铜鼎镇', '蒿吉坪瑶族乡'
]);

// 上游列表中已核验的单站地址异常：仅修正明确站号，绝不按乱码字符猜测批量替换。
const ADDRESS_CORRECTIONS = {
  '613H0938': '怀化市中方县接龙镇龙溪村部'
};

exports.handler = async (event, context) => {
  const params = getParams(event);
  const { type = 'all', stationId, keyword, adcd } = params;

  // 共享密钥校验：公网地址写在小程序包里，谁都能抓到，不加校验会被第三方
  // 直接刷上游配额。密钥配在环境变量 API_TOKEN（与前端 utils/config.js 的
  // API_TOKEN 同值）；环境变量未配置时放行并打警告，避免部署顺序造成线上不可用。
  if (!checkAuth(params)) {
    return respond(403, {
      success: false,
      message: '访问被拒绝：token 校验未通过'
    });
  }

  try {
    if (stationId) {
      return await getStationById(stationId, adcd || CONFIG.ADCD);
    }
    return await getStationsByType(type, keyword, adcd || CONFIG.ADCD);
  } catch (error) {
    console.error('站点数据获取失败', error);
    return respond(500, {
      success: false,
      message: '数据获取失败',
      error: error.message
    });
  }
};

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

// ==================== 列表结果缓存 ====================
// 站点列表上游较慢且偶发抖动。这里做三件事：
//   1) 成功结果缓存 LIST_CACHE_TTL，短时间内的重复请求不再打上游；
//   2) 部分类别失败时不写缓存（下次请求可补齐），只把成功的类别返回；
//   3) 全部类别失败时，LIST_STALE_MAX 内有成功结果就回落（数据偏旧但可用），
//      否则如实返回 502 —— 前端会把它当失败渲染出来（可重试），绝不当成「没有站点」。
const LIST_CACHE_TTL = 2 * 60 * 1000;
const LIST_STALE_MAX = 30 * 60 * 1000;
const listCache = new Map();

async function getStationsByType(type, keyword, adcd) {
  const cacheKey = `${type}|${keyword || ''}|${adcd}`;
  const now = Date.now();
  const cached = listCache.get(cacheKey);

  if (cached && now - cached.at < LIST_CACHE_TTL) {
    return cached.response;
  }

  try {
    const response = await fetchStationsResponse(type, keyword, adcd);
    // 全部类别都失败时响应是 success:false（502），不写缓存
    const body = JSON.parse(response.body);
    if (body.success !== false) {
      listCache.set(cacheKey, { at: now, response });
    }
    return response;
  } catch (error) {
    if (cached && now - cached.at < LIST_STALE_MAX) {
      console.error('[getStations] 上游取数失败，回落过期缓存（stale）:', error && error.message);
      return cached.response;
    }
    throw error;
  }
}

async function fetchStationsResponse(type, keyword, adcd) {
  const labels = [];
  const promises = [];

  if (type === 'all' || type === 'reservoir') {
    labels.push('reservoir');
    promises.push(fetchReservoirList(adcd, keyword));
  }
  if (type === 'all' || type === 'river') {
    labels.push('river');
    promises.push(fetchRiverList(adcd, keyword));
  }
  if (type === 'all' || type === 'soil') {
    labels.push('soil');
    promises.push(fetchSoilList(adcd));
  }

  // 使用 allSettled 防止单个类型失败导致整体 500
  const settled = await Promise.allSettled(promises);
  const list = [];
  const failedTypes = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      list.push(...result.value);
    } else {
      console.error(`${labels[i]}数据获取失败:`, result.reason);
      failedTypes.push(labels[i]);
    }
  });

  // 全部类别都失败：不能把「失败」伪装成「没有站点」（success:false + 502，前端据此进入失败态）
  if (failedTypes.length === labels.length) {
    return respond(502, {
      success: false,
      message: '上游数据源全部取数失败',
      failedTypes,
      queryTime: formatBeijingTime(new Date()),
      timezone: 'Asia/Shanghai (UTC+8)'
    });
  }

  return respond(200, {
    success: true,
    version: VERSION,
    queryTime: formatBeijingTime(new Date()),
    timezone: 'Asia/Shanghai (UTC+8)',
    // degraded/failedTypes：部分类别失败时如实告知（前端可据此提示「数据不完整」）
    degraded: failedTypes.length > 0,
    failedTypes,
    total: list.length,
    list
  });
}

async function getStationById(stationId, adcd) {
  const all = await getStationsByType('all', '', adcd);
  const parsed = JSON.parse(all.body);
  const sid = String(stationId);
  // 上游全部失败时 parsed.list 不存在，不能在这里抛 TypeError
  const station = (parsed.list || []).find(s => String(s.id) === sid);

  if (station) {
    return respond(200, { success: true, data: station });
  }
  return respond(404, { success: false, message: '未找到该站点' });
}

// ==================== 水库 ====================
async function fetchReservoirList(adcd, keyword) {
  const { begin, end } = getTimeRange();
  console.log('[getStations] 水库时间范围:', begin, '->', end);

  const postData = JSON.stringify({
    adcd,
    stm: begin,
    etm: end,
    keyword: keyword || ''
  });

  const options = {
    hostname: CONFIG.NEW_API_HOST,
    port: CONFIG.NEW_API_PORT,
    path: `${CONFIG.NEW_API_PATH}/rsvr/list`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 15000
  };

  const raw = await httpRequest(options, postData);
  const list = extractList(raw);
  console.log('[getStations] 水库上游返回条数:', list.length);
  if (list.length > 0) {
    const latest = list.reduce((a, b) => (a.TM > b.TM ? a : b));
    console.log('[getStations] 最新记录时间:', latest.TM);
  }

  return list.map(formatReservoirItem);
}

// 上游水库的蓄量 W 与相应库容 FSLTDW 的量纲是 10^6 m³（百万立方米），
// 而详情 / 列表 / 地图统一按「万m³」展示，因此在这里换算一次：1 单位 = 100 万m³。
//
// 依据（2026-09-26 用同一接口自带的入库/出库流量做水量平衡核算）：
// 若 inq/otq 的单位是 m³/s（水文要素代码 Q 的规定单位，也是界面上标注的单位），
// 那么 Σ(入库 − 出库) × Δt ÷ Δ蓄量 就是蓄量的量纲：
//   · 铜湾 613K0912（7 天 169 个逐时点）Σ = 4,577,472 m³，蓄量变化 4.42 单位 → 1,035,627 m³/单位；
//   · 五龙溪 613K0907 Σ = −300,154 m³，蓄量变化 −0.36 单位 → 833,760 m³/单位；
//   · 三角滩 613K0920 Σ = 1,296,000 m³，蓄量变化 1.95 单位 → 664,615 m³/单位。
// 三个独立站点都落在 10^6 m³ 量级，与 10^4 m³（万m³）差两个数量级。点越密反推越准（铜湾最接近 10^6）；
// 稀疏站的「净入」只是一个瞬时快照、而记录间隔 12–24 小时，反推必然偏小。
// 若上游日后调整口径，只需改这一个常量。
const RESERVOIR_VOLUME_SCALE = 100;

// 换算到「万m³」并保留两位小数：先乘后四舍五入，避免 112.55 * 100 这类浮点尾数写进响应
const toWanCubicMeters = (value) => (value ? Math.round(value * RESERVOIR_VOLUME_SCALE * 100) / 100 : 0);

function formatReservoirItem(item) {
  const currentLevel = num(getVal(item, ['RZ', 'rz', 'currentLevel', 'waterLevel', 'level']));
  const currentVolume = num(getVal(item, ['W', 'w', 'currentVolume', 'capacity']));
  const inflow = num(getVal(item, ['INQ', 'inq', 'inflow']));
  const outflow = num(getVal(item, ['OTQ', 'otq', 'outflow']));
  // FSLTDZ：汛限（防洪限制）水位，FSLTDW：汛限水位相应库容，XXZ：正常蓄水位
  const warningLevel = num(getVal(item, ['FSLTDZ', 'fsltdz', 'yjswz', 'warningLevel']));
  // 正常蓄水位与汛限/警戒水位是两个不同指标：上游未提供 XXZ 时必须为空，
  // 不得回退为汛限水位，否则详情页会把「正常水位」显示成「汛限水位」。
  const normalLevel = num(getVal(item, ['XXZ', 'xxz', 'normalLevel']));
  const deadLevel = num(getVal(item, ['DDZ', 'ddz', 'deadLevel']));
  const capacity = num(getVal(item, ['FSLTDW', 'fsltdw', 'rtw', 'totalCapacity', 'capacity']));

  // 高于汛限水位 → 超汛限（danger）；低于死水位 → 水位偏低（warning，供水不足，非洪水预警）
  let status = 'normal';
  if (currentLevel > 0 && warningLevel > 0 && currentLevel >= warningLevel) status = 'danger';
  else if (currentLevel > 0 && deadLevel > 0 && currentLevel <= deadLevel) status = 'warning';

  return {
    id: getStr(item, ['STCD', 'stcd', 'code', 'id']),
    name: getStr(item, ['STNM', 'stnm', 'name']),
    type: 'reservoir',
    currentLevel,
    currentVolume: toWanCubicMeters(currentVolume) || null,
    inflow: inflow || null,
    outflow: outflow || null,
    warningLevel: warningLevel || null,
    deadLevel: deadLevel || null,
    normalLevel: normalLevel || null,
    capacity: toWanCubicMeters(capacity) || null,
    latitude: numOrNull(getVal(item, ['LTTD', 'lttd', 'lat', 'latitude'])),
    longitude: numOrNull(getVal(item, ['LGTD', 'lgtd', 'lng', 'longitude'])),
    address: getStationAddress(getStr(item, ['STCD', 'stcd', 'code', 'id']), getStr(item, ['STLC', 'stlc', 'addr', 'address', 'loc'])),
    updateTime: getStr(item, ['TM', 'tm', 'updateTime', 'time']),
    status,
    statusText: RESERVOIR_STATUS_TEXT[status] || status
  };
}

// ==================== 河道 ====================
async function fetchRiverList(adcd, keyword) {
  const postData = JSON.stringify({
    adcd,
    stm: getTimeRange().begin,
    etm: getTimeRange().end,
    keyword: keyword || ''
  });

  const options = {
    hostname: CONFIG.NEW_API_HOST,
    port: CONFIG.NEW_API_PORT,
    path: `${CONFIG.NEW_API_PATH}/river/list`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 15000
  };

  const raw = await httpRequest(options, postData);
  const list = extractList(raw);
  return list.map(formatRiverItem);
}

function formatRiverItem(item) {
  const waterLevel = num(getVal(item, ['Z', 'z', 'waterLevel', 'level']));
  const flow = num(getVal(item, ['Q', 'q', 'flow']));
  // 上游部分河道有 HLZ，没有时取 0
  const warningLevel = num(getVal(item, ['HLZ', 'hlz', 'YJSWZ', 'yjswz', 'warningLevel']));
  // 保证水位（BZSWZ）高于警戒水位，是独立指标：上游未提供时必须为空，
  // 不得回退为警戒水位，否则详情页会把「保证水位」显示成「警戒水位」。
  const guaranteedLevel = num(getVal(item, ['BZSWZ', 'bzswz', 'guaranteedLevel']));

  let status = 'normal';
  if (waterLevel > 0 && warningLevel > 0 && waterLevel >= warningLevel) status = 'danger';

  return {
    id: getStr(item, ['STCD', 'stcd', 'code', 'id']),
    name: getStr(item, ['STNM', 'stnm', 'name']),
    type: 'river',
    waterLevel,
    flow: flow || null,
    warningLevel: warningLevel || null,
    guaranteedLevel: guaranteedLevel || null,
    waterQuality: getStr(item, ['waterQuality', 'wq']) || null,
    temperature: num(getVal(item, ['WT', 'wt', 'temperature'])) || null,
    latitude: numOrNull(getVal(item, ['LTTD', 'lttd', 'lat', 'latitude'])),
    longitude: numOrNull(getVal(item, ['LGTD', 'lgtd', 'lng', 'longitude'])),
    address: getStationAddress(getStr(item, ['STCD', 'stcd', 'code', 'id']), getStr(item, ['STLC', 'stlc', 'addr', 'address', 'loc'])),
    updateTime: getStr(item, ['TM', 'tm', 'updateTime', 'time']),
    status,
    statusText: STATUS_TEXT[status] || status
  };
}

// ==================== 土壤 ====================
async function fetchSoilList(adcd) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d} ${h}:00`;

  const options = {
    hostname: CONFIG.NEW_API_HOST,
    port: CONFIG.NEW_API_PORT,
    path: `${CONFIG.SOIL_API_PATH}/${encodeURIComponent(dateStr)}/${adcd}`,
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    timeout: 15000
  };

  const raw = await httpRequest(options);
  const list = extractList(raw);
  return list.map(formatSoilItem);
}

// 土壤墒情等级阈值（土壤体积含水量，单位 %）。
// 这些是现行固定阈值，上游未提供逐站点的墒情等级阈值字段；
// 上游部分站点提供 FDCP（饱和含水率）与 XDSD（相对含水率），
// 若今后需要按土壤类型分级，应由上游阈值字段驱动，不在前端或此处按经验推断。
const SOIL_MOISTURE_THRESHOLDS = { wet: 60, normal: 40, dry: 20 };

function formatSoilItem(item) {
  // 土壤墒情：保留各层、平均值及上游可选旱情指标；无数据的字段返回 null，供前端自适应展示
  const moisture10 = numOrNull(getVal(item, ['SLM10', 'slm10', 'moisture10']));
  const moisture20 = numOrNull(getVal(item, ['SLM20', 'slm20', 'moisture20']));
  const moisture40 = numOrNull(getVal(item, ['SLM40', 'slm40', 'moisture40']));
  const averageMoisture = numOrNull(getVal(item, ['AVG', 'avg', 'SMV', 'smv', 'moisture', 'soilMoisture']));
  // 全部层位均无数据时 moisture 保持 null（与「无数据字段返回 null」的约定一致），
  // 此前回退为 0 会被判定为「干旱」，属误报。
  const moisture = averageMoisture !== null
    ? averageMoisture
    : (moisture10 !== null ? moisture10 : (moisture20 !== null ? moisture20 : (moisture40 !== null ? moisture40 : null)));
  const temperature = numOrNull(getVal(item, ['TEMP', 'temp', 'SLMT', 'slmt', 'temperature', 'soilTemp']));
  // FDCP：饱和含水率；XDSD：相对含水率，均由上游在部分站点提供
  const saturatedMoisture = numOrNull(getVal(item, ['FDCP', 'fdcp', 'saturatedMoisture']));
  const relativeMoisture = numOrNull(getVal(item, ['XDSD', 'xdsd', 'relativeMoisture']));

  // 无任何含水量数据时不得推断旱情等级（显示为「暂无数据」）
  let status = 'unknown';
  if (moisture !== null) {
    if (moisture >= SOIL_MOISTURE_THRESHOLDS.wet) status = 'wet';
    else if (moisture >= SOIL_MOISTURE_THRESHOLDS.normal) status = 'normal';
    else if (moisture >= SOIL_MOISTURE_THRESHOLDS.dry) status = 'dry';
    else status = 'drought';
  }

  return {
    id: getStr(item, ['STCD', 'stcd', 'code', 'id']),
    name: getStr(item, ['STNM', 'stnm', 'name']),
    type: 'soil',
    moisture,
    averageMoisture,
    moisture10,
    moisture20,
    moisture40,
    saturatedMoisture,
    relativeMoisture,
    temperature,
    depth: getStr(item, ['depth']) || null,
    soilType: getStr(item, ['soilType']) || null,
    latitude: numOrNull(getVal(item, ['LTTD', 'lttd', 'lat', 'latitude'])),
    longitude: numOrNull(getVal(item, ['LGTD', 'lgtd', 'lng', 'longitude'])),
    address: getStationAddress(getStr(item, ['STCD', 'stcd', 'code', 'id']), getStr(item, ['STLC', 'stlc', 'addr', 'address', 'loc'])),
    updateTime: getStr(item, ['TM', 'tm', 'updateTime', 'time']),
    status,
    statusText: STATUS_TEXT[status] || status
  };
}

// ==================== 工具函数 ====================

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

function extractList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const keys = ['data', 'list', 'rows', 'result', 'records', 'items', 'datas'];
  for (const k of keys) {
    if (Array.isArray(raw[k])) return raw[k];
  }
  for (const k of keys) {
    if (raw[k] && typeof raw[k] === 'object') {
      const nested = extractList(raw[k]);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function getVal(item, keys, defaultValue) {
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
      return item[k];
    }
  }
  return defaultValue !== undefined ? defaultValue : '';
}

function getStr(item, keys) {
  const v = getVal(item, keys, '');
  return String(v).trim();
}

function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (postData) req.write(postData);
    req.end();
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

function getTimeRange() {
  const now = new Date();
  const begin = new Date(now.getTime() - 24 * 3600000);
  return { begin: formatDate(begin), end: formatDate(now) };
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

function formatBeijingTime(date) {
  const utc = date.getTime();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijing = new Date(utc + beijingOffset);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const min = String(beijing.getUTCMinutes()).padStart(2, '0');
  const sec = String(beijing.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${sec}`;
}

exports.normalizeAddress = normalizeAddress;
exports.getStationAddress = getStationAddress;
// 以下导出仅用于单元测试（云函数运行时只依赖 handler）
exports.formatReservoirItem = formatReservoirItem;
exports.RESERVOIR_VOLUME_SCALE = RESERVOIR_VOLUME_SCALE;
exports.toWanCubicMeters = toWanCubicMeters;
exports.formatRiverItem = formatRiverItem;
exports.formatSoilItem = formatSoilItem;
exports.STATUS_TEXT = STATUS_TEXT;
exports.RESERVOIR_STATUS_TEXT = RESERVOIR_STATUS_TEXT;
exports.SOIL_MOISTURE_THRESHOLDS = SOIL_MOISTURE_THRESHOLDS;

function getStationAddress(stationId, address) {
  return normalizeAddress(ADDRESS_CORRECTIONS[stationId] || address);
}

function normalizeAddress(address) {
  if (!address) return '中方县';
  // 去除所有空格，避免 "聂家村 乡" 这类带空格的地址无法匹配
  let result = String(address).replace(/\s+/g, '');

  // 规范化错误乡镇名：按名称长度降序处理，避免短词错误匹配长词子串
  const sortedWrongNames = Object.keys(TOWNSHIP_NAME_MAP).sort((a, b) => b.length - a.length);
  for (const wrong of sortedWrongNames) {
    if (!result.includes(wrong)) continue;
    const correct = TOWNSHIP_NAME_MAP[wrong];
    if (correct) {
      result = result.replace(new RegExp(wrong, 'g'), correct);
    } else {
      // 已撤销/不存在的乡镇，连同后续村名一并移除
      result = result.replace(new RegExp(wrong + '[\\u4e00-\\u9fa5]*', 'g'), '');
    }
  }

  // 清理末尾多余的分隔符
  result = result.replace(/[，,]+$/g, '').replace(/中方县$/, '中方县').trim();
  return result || '中方县';
}
