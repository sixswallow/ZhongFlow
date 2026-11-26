/**
 * 部署后自查：直接请求线上云函数公网地址，核对
 *   ① 云函数是否已是新版代码
 *   ② 和风凭据是否真的生效（环境变量填了没、格式对不对、重新部署了没）
 *   ③ 短临是否能取满 12 个乡镇
 *   ④ 顺带核对站点列表
 *
 * 用法：node.exe scripts/check-deployed.js
 * 退出码：0 = 全部符合预期；1 = 有项目不符合（会打印原因与下一步）
 */
const config = require('../utils/config.js');

const WEATHER = config.ALIYUN_FUNCTION_WEATHER_URL;
const STATIONS = config.ALIYUN_FUNCTION_STATIONS_URL;
const CENTER = config.ZHONGFANG_CENTER;

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, ms: Date.now() - t0, body, text, bytes: Buffer.byteLength(text, 'utf8') };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' ｜ ' + detail : ''));
}

(async () => {
  console.log('线上函数自查（' + new Date().toLocaleString('zh-CN') + '）\n');

  // ── ① 常规天气 ──────────────────────────────────────────────
  const wUrl = WEATHER + '?latitude=' + CENTER.latitude + '&longitude=' + CENTER.longitude + '&provider=qweather&token=' + encodeURIComponent(config.API_TOKEN || '');
  console.log('① 常规天气 ' + wUrl);
  let cur = null, wSource = null, wErr = '', wStatus = 0;
  try {
    const r = await get(wUrl);
    wStatus = r.status;
    const d = (r.body && r.body.data) || {};
    cur = d.current || null;
    wSource = d.source || (r.body && r.body.source) || null;
    wErr = d.failedReason || (r.body && (r.body.error || r.body.message)) || '';
    console.log('    HTTP ' + r.status + ' ｜ ' + r.ms + 'ms ｜ ' + r.bytes + 'B ｜ success=' + (r.body && r.body.success) + ' ｜ source=' + show(wSource));
    if (cur) {
      console.log('    current: ' + JSON.stringify({
        temperature: cur.temperature, humidity: cur.humidity, windDirection: cur.windDirection,
        windSpeed: cur.windSpeed, windSpeedKmh: cur.windSpeedKmh, windSpeedMs: cur.windSpeedMs,
        weather: cur.weather, pressure: cur.pressure, visibility: cur.visibility,
        uvIndex: cur.uvIndex, updateTime: cur.updateTime
      }));
      console.log('    current 字段数：' + Object.keys(cur).length + ' → ' + Object.keys(cur).join(', '));
    }
    if (wErr) console.log('    失败原因: ' + wErr);
  } catch (e) {
    console.log('    请求异常：' + e.message);
  }

  // ── ② 乡镇短临 ──────────────────────────────────────────────
  console.log('\n② 乡镇短临 ?mode=nowcast&provider=qweather');
  let nSource = null, nErr = '', nNote = '', okCount = null;
  try {
    const r = await get(WEATHER + '?mode=nowcast&provider=qweather&token=' + encodeURIComponent(config.API_TOKEN || ''));
    const d = r.body || {};
    nSource = d.source || null;
    nErr = d.failedReason || (d.townships && d.townships[0] && d.townships[0].error) || '';
    nNote = d.note || '';
    okCount = d.okCount;
    console.log('    HTTP ' + r.status + ' ｜ ' + r.ms + 'ms ｜ ' + r.bytes + 'B ｜ success=' + d.success
      + ' ｜ source=' + show(nSource) + ' ｜ ok=' + d.okCount + '/' + (d.townships || []).length
      + ' ｜ failed=' + d.failedCount + ' ｜ degraded=' + d.degraded);
    if (nNote) console.log('    note: ' + nNote);
    if (nErr) console.log('    failedReason: ' + nErr);
    const t = (d.townships || [])[0];
    if (t) console.log('    样例乡镇: ' + JSON.stringify({
      name: t.name, ok: t.ok, willRain: t.willRain, startMinute: t.startMinute,
      peakMinute: t.peakMinute, totalRain: t.totalRain, hasProbability: t.hasProbability, error: t.error
    }));
  } catch (e) {
    console.log('    请求异常：' + e.message);
  }

  // ── ③ 站点列表 ──────────────────────────────────────────────
  console.log('\n③ 站点列表（顺带）');
  try {
    const r = await get(STATIONS + '?type=reservoir&adcd=' + config.ADCD + '&keyword=&token=' + encodeURIComponent(config.API_TOKEN || ''));
    const n = (r.body && r.body.list && r.body.list.length) || 0;
    console.log('    HTTP ' + r.status + ' ｜ ' + r.ms + 'ms ｜ ' + r.bytes + 'B ｜ 水库站点 ' + n + ' 个');
    check('站点列表可用', r.status === 200 && n > 0, n + ' 个');
  } catch (e) {
    console.log('    请求异常：' + e.message);
    check('站点列表可用', false, e.message);
  }

  // ── 判定 ────────────────────────────────────────────────────
  console.log('\n=== 判定 ===');
  const pemBroken = /私钥无法解析|DECODER routines/.test(wErr + ' ' + nErr);
  const qweatherLabel = /和风天气分钟级降水 API/.test(nNote + ' ' + nErr);
  const newCode = wSource === 'qweather' || nSource === 'qweather' || pemBroken || qweatherLabel;
  const hasNewFields = !!(cur && ('windSpeedKmh' in cur));

  check('云函数已是新版代码', newCode,
    newCode
      ? '证据：' + (qweatherLabel || nSource === 'qweather' ? '短临走和风分支'
        : pemBroken ? '返回了新版才有的私钥报错文案' : '响应里带 source 字段')
      : '响应里没有任何新版特征（source / 新文案都没有）⇒ 线上还是旧代码');
  check('和风凭据可用（常规天气取到数，且字段为新版）',
    !!(cur && cur.temperature != null && hasNewFields),
    cur && cur.temperature != null
      ? ('气温 ' + cur.temperature + '℃ ｜ 湿度 ' + cur.humidity + '% ｜ ' + cur.weather + ' ｜ windSpeedKmh ' + cur.windSpeedKmh)
      : ('HTTP ' + wStatus + ' ｜ ' + (wErr || '没有数据')));
  check('短临可取满 12 个乡镇', nSource === 'qweather' && okCount === 12,
    'source=' + show(nSource) + ' ｜ ok=' + okCount + (nErr ? ' ｜ ' + nErr : ''));

  if (pemBroken) {
    console.log('\n⚠️ 私钥环境变量读不出 PEM（粘贴时被毁掉了）。按顺序改：');
    console.log('   1) 只保留 QWEATHER_PRIVATE_KEY_B64 一个变量，删掉 QWEATHER_PRIVATE_KEY（两个都填会先取 _B64）；');
    console.log('   2) 值 = env-paste.txt 里那一整行（单行 base64，不要换行、不要引号、不要连 KEY= 一起粘）；');
    console.log('   3) 保存后必须重新部署才生效；');
    console.log('   4) 若还失败，把上面「读到的是——候选N…」那句原样发出来 —— 它能直接说明是哪种粘贴失误。');
  }
  if (qweatherLabel && !hasNewFields && wStatus !== 200) {
    console.log('\n提示：短临已经走和风了，说明新版代码在跑；但常规天气还没取到数，先解决上面那条失败原因。');
  }

  const bad = checks.filter(c => !c.ok);
  console.log('\n' + (bad.length === 0
    ? '全部符合预期 ✅'
    : bad.length + ' 项不符合 ❌\n' + bad.map(c => '  · ' + c.name + ' → ' + c.detail).join('\n')));
  process.exit(bad.length === 0 ? 0 : 1);
})();

function show(v) { return v === null || v === undefined ? '(无)' : String(v); }
