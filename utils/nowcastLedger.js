// 短临预报「存档 + 雷达参照对照」（纯计算，可被 Node 测试直接 require）
//
// 背景：本项目没有实测雨量站，短临预报的「准确率」没有标尺可测。
// 折中做法（用户确认的方案）：
//   1) 每次拿到短临结果时存档一份「各乡镇未来 2 小时有无雨」；
//   2) 30 / 60 分钟之后，用雷达回波实况（云函数 mode=radar-verify）当事后参照；
//   3) 累积「有无雨是否一致」的对照记录，并在短临卡片上给出一行结论。
//
// 口径纪律（必须遵守）：
//   · 雷达是遥感参照，不是地面雨量 → 结论只讲「一致」，不讲「准确率」，不讲毫米数；
//   · 失败 / 缺失的乡镇一律不参与对照（宁可不计入，也不计入错值）；
//   · 样本太少时不出百分比，只显示「样本累积中」。
//
// 存储由页面负责（wx.getStorageSync / wx.setStorageSync），本模块不碰 wx，便于单测与降级。

const LEDGER = {
  SAMPLE_KEY: 'zf_nowcast_samples_v1',
  RESULT_KEY: 'zf_nowcast_results_v1',
  // 每 30 分钟最多存一个样本：雷达帧间隔 10 分钟，再密也是重复观测
  THROTTLE_MS: 30 * 60 * 1000,
  LEADS: [30, 60],
  OBS_MIN_AGE_MS: 5 * 60 * 1000,    // 观测时刻至少过去 5 分钟（雷达有发布延迟）
  OBS_MAX_AGE_MS: 110 * 60 * 1000,  // 且不超过 110 分钟（免费档只有过去约 2 小时）
  MAX_SAMPLES: 120,                 // 约 2.5 天
  MAX_RESULTS: 600,
  MIN_REPORT: 12,                   // 对照条数少于此值不出百分比
};

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

// 把一次短临结果转成存档样本；全部乡镇都取数失败时返回 null（不存不可用样本）
function buildSample(nowcast, nowMs, options) {
  const opt = options || {};
  if (!nowcast || !Array.isArray(nowcast.townships) || !nowcast.townships.length) return null;
  const items = [];
  for (const t of nowcast.townships) {
    if (!t || t.ok === false) continue;          // 取数失败：不进样本
    if (typeof t.willRain !== 'boolean') continue; // 语义不明的值：不进样本
    items.push({
      code: t.code,
      name: t.name || '',
      willRain: t.willRain,
      startMinute: typeof t.startMinute === 'number' ? t.startMinute : null,
    });
  }
  if (!items.length) return null;
  return {
    t: opt.t || Math.floor((nowMs || Date.now()) / 1000), // 预测时刻（unix 秒）
    wall: opt.wall || (nowMs || Date.now()),
    s: opt.source || (nowcast.source || ''),
    items,
    done: {},
  };
}

// 追加样本（带节流与上限），返回 { changed, samples }
function appendSample(samples, sample) {
  const list = Array.isArray(samples) ? samples.slice() : [];
  if (!sample) return { changed: false, samples: list };
  const last = list[list.length - 1];
  if (last && sample.wall - last.wall < LEDGER.THROTTLE_MS) {
    return { changed: false, samples: list };
  }
  list.push(sample);
  const over = list.length - LEDGER.MAX_SAMPLES;
  const out = over > 0 ? list.slice(over) : list;
  return { changed: true, samples: out };
}

// 找出「现在可核对」的（样本 × 提前量）组合
// 返回 [{ sampleIndex, t, lead, observeTime, key }]
function planDuePairs(samples, results, nowMs) {
  const list = Array.isArray(samples) ? samples : [];
  const rows = Array.isArray(results) ? results : [];
  const doneKeys = {};
  for (const r of rows) doneKeys[r.t + ':' + r.lead] = 1;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    for (const lead of LEDGER.LEADS) {
      if (s.done && s.done[lead]) continue;
      const key = s.t + ':' + lead;
      if (doneKeys[key]) continue;
      const observeTime = s.t + lead * 60;
      const age = nowMs - observeTime * 1000;
      if (age < LEDGER.OBS_MIN_AGE_MS) continue;        // 还没到时候
      if (age > LEDGER.OBS_MAX_AGE_MS) {                 // 已超出雷达可用时段，标掉不再重试
        out.push({ sampleIndex: i, t: s.t, lead, observeTime, key, expired: true });
        continue;
      }
      out.push({ sampleIndex: i, t: s.t, lead, observeTime, key, expired: false });
    }
  }
  return out;
}

// 用云函数返回的雷达实况回填对照结果
// observations: [{ requestedTime, ok, frameTime, deltaMin, townships:[{code, ok, hasRain}] }]
// 返回 { samples, results, applied, expired, unusable }
function applyObservations(samples, results, observations, pairs, nowMs) {
  const list = (Array.isArray(samples) ? samples : []).map((s) =>
    Object.assign({}, s, { done: Object.assign({}, s.done || {}) }));
  const rows = (Array.isArray(results) ? results : []).slice();
  const byTime = {};
  for (const o of observations || []) byTime[o.requestedTime] = o;

  let applied = 0, expired = 0, unusable = 0;
  for (const p of pairs || []) {
    const sample = list[p.sampleIndex];
    if (!sample) continue;
    if (p.expired) {
      if (sample.done) sample.done[p.lead] = true;
      expired++;
      continue;
    }
    const obs = byTime[p.observeTime];
    if (!obs || !obs.ok || !Array.isArray(obs.townships)) { unusable++; continue; }
    if (obs.deltaMin !== null && obs.deltaMin !== undefined && obs.deltaMin > 8) { unusable++; continue; }

    const obsByCode = {};
    for (const t of obs.townships) obsByCode[t.code] = t;
    let n = 0, agree = 0, missed = 0, falseAlarm = 0, bothRain = 0, bothDry = 0;
    for (const item of sample.items) {
      const o = obsByCode[item.code];
      if (!o || o.ok === false || o.hasRain === null || o.hasRain === undefined) continue; // 无视可判
      n++;
      const same = item.willRain === o.hasRain;
      if (same) agree++;
      if (item.willRain && o.hasRain) bothRain++;
      if (!item.willRain && !o.hasRain) bothDry++;
      if (!item.willRain && o.hasRain) missed++;      // 漏报：说有雨却实无 —— 防汛最在意这一头
      if (item.willRain && !o.hasRain) falseAlarm++;   // 空报
    }
    if (sample.done) sample.done[p.lead] = true;
    if (!n) { unusable++; continue; }
    rows.push({
      t: p.t, lead: p.lead, frameDeltaMin: obs.deltaMin === undefined ? null : obs.deltaMin,
      n, agree, missed, falseAlarm, bothRain, bothDry,
      at: Math.floor((nowMs || Date.now()) / 1000),
    });
    applied++;
  }

  const over = rows.length - LEDGER.MAX_RESULTS;
  const kept = over > 0 ? rows.slice(over) : rows;
  return { samples: list, results: kept, applied, expired, unusable };
}

// 累计统计与展示文案
function summarize(results) {
  const rows = Array.isArray(results) ? results : [];
  const byLead = {};
  for (const lead of LEDGER.LEADS) byLead[lead] = { n: 0, agree: 0, missed: 0, falseAlarm: 0, samples: 0 };
  for (const r of rows) {
    const b = byLead[r.lead];
    if (!b) continue;
    b.n += r.n; b.agree += r.agree; b.missed += r.missed; b.falseAlarm += r.falseAlarm; b.samples++;
  }
  let lastAt = 0;
  for (const r of rows) if (r.at > lastAt) lastAt = r.at;

  const usable = LEDGER.LEADS.filter((l) => byLead[l].n >= LEDGER.MIN_REPORT);
  let text = '';
  if (!rows.length) {
    text = '';
  } else if (!usable.length) {
    const maxN = Math.max.apply(null, LEDGER.LEADS.map((l) => byLead[l].n));
    text = '雷达参照对照：样本累积中（' + maxN + '/' + LEDGER.MIN_REPORT + '）';
  } else {
    const parts = usable.map((l) => {
      const b = byLead[l];
      const rate = ((b.agree / b.n) * 100).toFixed(0);
      return l + ' 分钟一致 ' + rate + '%（漏报 ' + b.missed + '/' + b.n + '）';
    });
    text = '雷达参照对照：' + parts.join('，');
  }
  return { byLead, lastAt, text, total: rows.length, hasPercent: !!usable.length };
}

module.exports = { LEDGER, buildSample, appendSample, planDuePairs, applyObservations, summarize, pad2 };
