/**
 * 阿里云函数 - 获取站点历史时序数据
 *
 * 功能：
 * 1. 水库水位时序 (reservoir)
 * 2. 土壤墒情时序 (soil)
 *
 * 调用方式：
 * - GET /?stationId=xxx&type=reservoir&dateBegin=xxx&dateEnd=xxx
 * - GET /?stationId=xxx&type=soil&days=7
 */
const http = require('http');
const { formatSoilHistoryRow } = require('./soilHistory.js');

// 与 getStations 一样带一个版本号：水库历史这一轮新增了蓄量/入库/出库三个序列，
// 部署后可以直接从接口响应里看出新代码到底上线没有。
const VERSION = '2026-09-26-v1';

const CONFIG = {
  HN_API_HOST: 'www.hnswkcj.com',
  HN_API_PORT: 80,
  HN_API_PATH: '/wxhn/data/rthyinfo/rsvr/proc/one.json',

  NEW_API_HOST: '58.20.42.94',
  NEW_API_PORT: 9090,
  SOIL_DETAIL_PATH: '/api/core/soil/soildr',
  RIVER_PROCESS_PATH: '/newapi/api/v1/ysq/river/process'
};

exports.handler = async (event, context) => {
  const params = getParams(event);
  const { stationId, type = 'level', days = 7, dateBegin, dateEnd } = params;

  // 共享密钥校验（与 getStations 一致）：环境变量 API_TOKEN 未配置时放行并告警
  if (!checkAuth(params)) {
    return respond(403, {
      success: false,
      message: '访问被拒绝：token 校验未通过'
    });
  }

  if (!stationId) {
    return respond(400, {
      success: false,
      message: '缺少站点ID参数'
    });
  }

  try {
    let data;
    if (type === 'soil') {
      data = await getSoilHistory(stationId, dateBegin, dateEnd, days);
    } else if (type === 'river') {
      data = await getRiverHistory(stationId, dateBegin, dateEnd, days);
    } else {
      data = await getReservoirHistory(stationId, dateBegin, dateEnd, days);
    }

    return respond(200, {
      success: true,
      version: VERSION,
      total: data.length,
      list: data
    });
  } catch (error) {
    console.error('历史数据获取失败', error);
    return respond(500, {
      success: false,
      message: '历史数据获取失败',
      error: error.message
    });
  }
};

// ==================== 水库时序 ====================
async function getReservoirHistory(code, dateBegin, dateEnd, days) {
  const range = getDateRange(dateBegin, dateEnd, days);

  const options = {
    hostname: CONFIG.HN_API_HOST,
    port: CONFIG.HN_API_PORT,
    path: `${CONFIG.HN_API_PATH}?code=${encodeURIComponent(code)}&dateBegin=${encodeURIComponent(range.begin)}&dateEnd=${encodeURIComponent(range.end)}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'http://www.hnswkcj.com/wxhn/html/index.html',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    timeout: 15000
  };

  const raw = await httpRequest(options);
  const rows = extractList(raw);

  return rows.map(row => {
    const tm = row.TM || row.tm || '';
    let date = '';
    let timestamp = 0;
    if (tm) {
      const d = new Date(tm);
      date = `${d.getMonth() + 1}/${d.getDate()}`;
      timestamp = d.getTime();
    }
    // 上游同一个接口就带回了蓄量 w、入库 inq、出库 otq 三条序列，此前只取了 rz（水位），
    // 所以水库站只有一条水位线可画。量纲：水位 m、流量 m³/s、蓄量 10^6 m³
    //（蓄量量纲的核算过程见 getStations/index.js 里 RESERVOIR_VOLUME_SCALE 的注释）。
    // value 继续保留水位，供「流量序列不可用」时的单线降级路径使用。
    return {
      date,
      timestamp,
      waterLevel: numOrNull(row.rz ?? row.RZ),
      volume: numOrNull(row.w ?? row.W),
      inflow: numOrNull(row.inq ?? row.INQ),
      outflow: numOrNull(row.otq ?? row.OTQ),
      value: num(row.RZ || row.rz)
    };
  });
}

// ==================== 河道水文过程 ====================
async function getRiverHistory(code, dateBegin, dateEnd, days) {
  const range = getDateRange(dateBegin, dateEnd, days);
  const postData = JSON.stringify({
    stcd: code,
    stm: range.begin,
    etm: range.end
  });
  const options = {
    hostname: CONFIG.NEW_API_HOST,
    port: CONFIG.NEW_API_PORT,
    path: CONFIG.RIVER_PROCESS_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 15000
  };
  const raw = await httpRequest(options, postData);
  const rows = extractList(raw);
  return rows.map((row) => {
    const tm = row.TM || row.tm || '';
    const time = tm ? new Date(tm) : null;
    const timestamp = time && !Number.isNaN(time.getTime()) ? time.getTime() : 0;
    return {
      date: timestamp ? `${time.getMonth() + 1}/${time.getDate()}` : '',
      timestamp,
      waterLevel: numOrNull(row.Z ?? row.z),
      flow: numOrNull(row.Q ?? row.q),
      warningLevel: numOrNull(row.GRZ ?? row.grz),
      value: numOrNull(row.Z ?? row.z)
    };
  });
}

// ==================== 土壤时序 ====================
async function getSoilHistory(stcd, dateBegin, dateEnd, days) {
  const range = getDateRange(dateBegin, dateEnd, days);

  const options = {
    hostname: CONFIG.NEW_API_HOST,
    port: CONFIG.NEW_API_PORT,
    path: `${CONFIG.SOIL_DETAIL_PATH}/${stcd}/${encodeURIComponent(range.begin)}/${encodeURIComponent(range.end)}`,
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    timeout: 15000
  };

  const raw = await httpRequest(options);
  const rows = extractList(raw);

  return rows.map(formatSoilHistoryRow);
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

function getDateRange(dateBegin, dateEnd, days) {
  if (dateBegin && dateEnd) {
    return {
      begin: dateBegin.replace('+', ' '),
      end: dateEnd.replace('+', ' ')
    };
  }
  const now = new Date();
  const begin = new Date(now.getTime() - (parseInt(days) || 7) * 24 * 3600000);
  return {
    begin: formatDate(begin),
    end: formatDate(now)
  };
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
