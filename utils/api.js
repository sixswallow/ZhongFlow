const config = require('./config.js');
const { createStationCache } = require('./stationCache.js');

const stationCache = createStationCache({ ttl: config.STATION_CACHE_TTL });

const httpGet = (baseUrl, params = {}) => {
  return new Promise((resolve, reject) => {
    // 每个请求统一携带共享密钥（云函数侧校验，防公网地址被滥用）
    const fullParams = { ...params, token: config.API_TOKEN };
    const queryString = Object.keys(fullParams)
      .filter(k => fullParams[k] !== undefined && fullParams[k] !== null)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(fullParams[k])}`)
      .join('&');

    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    console.log('[api] 请求:', url);

    wx.request({
      url,
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200) {
          let data = res.data;

          // 兼容阿里云函数返回的字符串 body
          if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) {
              reject(new Error('响应解析失败'));
              return;
            }
          }

          // 兼容阿里云函数返回的 { statusCode, headers, body } 包装格式
          if (data && (data.body !== undefined || data.statusCode !== undefined)) {
            if (typeof data.body === 'string') {
              try { 
                data = JSON.parse(data.body);
              }
              catch (e) {
                reject(new Error('body 解析失败'));
                return;
              }
            } else if (typeof data.body === 'object') {
              data = data.body;
            }
          }

          resolve({ success: true, data });
        } else {
          // 失败时尽量带上云函数给的 message/error：否则只剩一个状态码，看不出是限流还是崩溃
          let detail = '';
          const body = res.data;
          if (body && typeof body === 'object') detail = body.message || body.error || '';
          else if (typeof body === 'string') detail = body;
          detail = String(detail).replace(/\s+/g, ' ').slice(0, 120);
          reject(new Error(`HTTP错误: ${res.statusCode}${detail ? ' · ' + detail : ''}`));
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
};

// 把底层失败翻译成一句人能看懂的原因。
// 目的：页面不再只显示「暂未获取到天气数据」这种什么都看不出的提示，
// 排查时能一眼区分「域名没配」「网络不通」「接口报错」「返回格式不对」。
const describeError = (err) => {
  const msg = String((err && (err.errMsg || err.message)) || '').trim();
  if (/url not in domain list|domain list/.test(msg)) return '请求域名未配置：需在微信公众平台加入 request 合法域名';
  if (/timeout|超时/i.test(msg)) return '请求超时';
  if (/abort/i.test(msg)) return '请求被中断';
  if (/rate limit|限流|too many requests/i.test(msg)) return '数据源访问频率超限，请稍后重试';
  if (/HTTP错误:\s*429/.test(msg)) return '数据源访问频率超限，请稍后重试';
  if (/HTTP错误:\s*(\d+)/.test(msg)) return msg.replace(/\s+/g, ' ').slice(0, 80);
  if (/解析/.test(msg)) return '返回格式无法解析';
  if (/^request:fail/.test(msg)) return '网络请求失败（域名或网络）';
  if (msg) return msg.replace(/^Error:\s*/, '').slice(0, 60);
  return '未知原因';
};

// ==================== 站点列表接口 ====================

const getReservoirList = async (keyword = '', options = {}) => {
  const { forceRefresh = false } = options;
  const cacheKey = `reservoir:${keyword}`;

  return stationCache.get(cacheKey, async () => {
    const res = await httpGet(config.ALIYUN_FUNCTION_STATIONS_URL, {
      type: 'reservoir',
      adcd: config.ADCD,
      keyword
    });
    return res.data?.list || [];
    // 注意：必须让这里的 Promise 失败，不能在缓存内部吞掉错误 ——
    // 否则「请求失败后返回的空数组」会被缓存当作有效数据存满整个 TTL（默认 5 分钟），
    // 上游抖一次就会让站点列表与详情页同时空掉，且不会自动恢复。
  }, { forceRefresh }).catch((e) => {
    console.error('获取水库列表失败', e);
    // throwOnError：页面需要区分「失败」与「真的没数据」时用；默认仍返回空数组（兼容既有调用）
    if (options.throwOnError) throw e;
    return [];
  });
};

const getRiverList = async (keyword = '', options = {}) => {
  const { forceRefresh = false } = options;
  const cacheKey = `river:${keyword}`;

  return stationCache.get(cacheKey, async () => {
    const res = await httpGet(config.ALIYUN_FUNCTION_STATIONS_URL, {
      type: 'river',
      adcd: config.ADCD,
      keyword
    });
    return res.data?.list || [];
    // 注意：必须让这里的 Promise 失败，不能在缓存内部吞掉错误 ——
    // 否则「请求失败后返回的空数组」会被缓存当作有效数据存满整个 TTL（默认 5 分钟），
    // 上游抖一次就会让站点列表与详情页同时空掉，且不会自动恢复。
  }, { forceRefresh }).catch((e) => {
    console.error('获取河道列表失败', e);
    if (options.throwOnError) throw e;
    return [];
  });
};

const getSoilList = async (options = {}) => {
  const { forceRefresh = false } = options;

  return stationCache.get('soil', async () => {
    const res = await httpGet(config.ALIYUN_FUNCTION_STATIONS_URL, {
      type: 'soil',
      adcd: config.ADCD
    });
    return res.data?.list || [];
    // 注意：必须让这里的 Promise 失败，不能在缓存内部吞掉错误 ——
    // 否则「请求失败后返回的空数组」会被缓存当作有效数据存满整个 TTL（默认 5 分钟），
    // 上游抖一次就会让站点列表与详情页同时空掉，且不会自动恢复。
  }, { forceRefresh }).catch((e) => {
    console.error('获取土壤墒情列表失败', e);
    if (options.throwOnError) throw e;
    return [];
  });
};

const getStations = async (type = 'all', keyword = '', options = {}) => {
  if (type === 'all') {
    const [reservoirs, rivers, soils] = await Promise.all([
      getReservoirList(keyword, options),
      getRiverList(keyword, options),
      getSoilList(options)
    ]);
    return [...reservoirs, ...rivers, ...soils];
  }
  if (type === 'reservoir') return getReservoirList(keyword, options);
  if (type === 'river') return getRiverList(keyword, options);
  if (type === 'soil') return getSoilList(options);
  return [];
};

// 一次取回三类站点并保留失败信号：页面据此区分「请求失败」与「真的没有数据」。
// 单类失败不影响其它两类（allSettled），failedTypes 列出失败类别，error 是首个失败原因。
const getStationGroups = async (options = {}) => {
  const strict = { ...options, throwOnError: true };
  const settled = await Promise.allSettled([
    getReservoirList('', strict),
    getRiverList('', strict),
    getSoilList(strict)
  ]);
  const keys = ['reservoir', 'river', 'soil'];
  const failedTypes = [];
  let firstError = null;
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      failedTypes.push(keys[i]);
      if (!firstError) firstError = result.reason;
    }
  });
  const groups = settled.map((result) => (result.status === 'fulfilled' ? result.value : []));
  return {
    reservoirs: groups[0],
    rivers: groups[1],
    soils: groups[2],
    list: [...groups[0], ...groups[1], ...groups[2]],
    failedTypes,
    failed: failedTypes.length > 0,
    error: firstError
  };
};

const getStationDetail = async (id, options = {}) => {
  const sid = String(id);
  const { forceRefresh = false } = options;

  const pick = (list) => (list || []).find(s => String(s.id) === sid) || null;

  try {
    const hit = pick(await getStations('all', '', { forceRefresh }));
    if (hit) return hit;
    // 未命中：列表可能来自缓存中的一份空/过期结果（上游短暂异常时会被缓存整个 TTL），
    // 因此强制回源再找一次，避免详情页在缓存期内一直「找不到站点」。
    if (!forceRefresh) {
      return pick(await getStations('all', '', { forceRefresh: true }));
    }
    return null;
  } catch (e) {
    console.error('获取站点详情失败', e);
    return null;
  }
};

// ==================== 时序数据接口 ====================

const getStationHistory = (stationId, type = 'level', days = 7, options = {}) => {
  if (type === 'soil' || type === 'moisture') {
    return getSoilHistory(stationId, days, options);
  }
  if (type === 'river') {
    return getRiverHistory(stationId, days, options);
  }
  return getReservoirHistory(stationId, days, options);
};

const getReservoirHistory = async (code, days = 7, options = {}) => {
  try {
    const res = await httpGet(config.ALIYUN_FUNCTION_HISTORY_URL, {
      stationId: code,
      type: 'level',
      days
    });
    return res.data?.list || [];
  } catch (e) {
    console.error('获取水库历史数据失败', e);
    if (options.throwOnError) throw e;
    return [];
  }
};

const getRiverHistory = async (code, days = 7, options = {}) => {
  try {
    const res = await httpGet(config.ALIYUN_FUNCTION_HISTORY_URL, {
      stationId: code,
      type: 'river',
      days
    });
    return res.data?.list || [];
  } catch (e) {
    console.error('获取河道历史数据失败', e);
    if (options.throwOnError) throw e;
    return [];
  }
};

const getSoilHistory = async (stcd, days = 7, options = {}) => {
  try {
    const res = await httpGet(config.ALIYUN_FUNCTION_HISTORY_URL, {
      stationId: stcd,
      type: 'soil',
      days
    });
    return res.data?.list || [];
  } catch (e) {
    console.error('获取土壤历史数据失败', e);
    if (options.throwOnError) throw e;
    return [];
  }
};

// ==================== 天气接口 ====================

const getNowcast = async (townshipCode) => {
  try {
    // 与常规天气共用同一个数据源开关：显式传 provider 后，云函数只会用这一个源，
    // 不会在失败时悄悄回落到另一个源（单一数据源，失败原因也只有一个来源）
    const params = { mode: 'nowcast', provider: config.WEATHER_PROVIDER };
    if (townshipCode) params.townshipCode = townshipCode;
    const res = await httpGet(config.ALIYUN_FUNCTION_WEATHER_URL, params);
    return res.data;
  } catch (e) {
    console.error('获取短临预报失败', e);
    return null;
  }
};

const getWeather = async (latitude, longitude) => {
  try {
    const res = await httpGet(config.ALIYUN_FUNCTION_WEATHER_URL, {
      latitude,
      longitude,
      provider: config.WEATHER_PROVIDER
    });
    
    return res.data?.data || null;
  } catch (e) {
    console.error('获取天气数据失败：' + describeError(e), e);
    return null;
  }
};

module.exports = {
  getStations,
  getStationGroups,
  getStationDetail,
  getStationHistory,
  getReservoirHistory,
  getSoilHistory,
  getWeather,
  getNowcast,
  describeError
};
